import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { fetchHMAC } from "../fetch.js";
import { Member, memberInfo } from "../types/member.js";
import { siteUrl } from "../config.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("join")
        .setDescription("Join the webring")
        .addStringOption(option =>
            option
                .setName("alias")
                .setDescription("Your online alias for the webring")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("site")
                .setDescription("The URL of your site (include https://)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("color")
                .setDescription("(hex code) colour used to sign your posts created")
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.Guild,
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        let member: Member | undefined = undefined;
        const data: Member[] = await fetchHMAC(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
        if (data.length)
            member = data[0];

        if (member) {
            if (member.addedRingToSite)
                await interaction.followUp({ content: "You have already confirmed your webring membership", ephemeral: true });
            else if (!member.site)
                await interaction.followUp({ content: "You have not added your site URL. Run `/change` to add your site URL", ephemeral: true });
            else
                await interaction.followUp({ content: "You are already in the webring, run `/confirm` to confirm your webring membership", ephemeral: true });
            return;
        }

        const alias = interaction.options.getString("alias");
        let site = interaction.options.getString("site");
        let color = interaction.options.getString("color");

        if (!alias) {
            await interaction.followUp({ content: "You must provide your online alias.\nOptionally, a site URL, and a hex code color as well", ephemeral: true });
            return;
        }

        // Check if the site URL is valid
        if (site)
            try {
                const url = new URL(site);

                if (url.protocol !== 'https:') // Checks if URL is HTTPS
                    throw new Error;
                if (!url.hostname.includes(".")) // Checks if URL contains at least one dot
                    throw new Error;
                if (url.hostname.split(".")[url.hostname.split(".").length - 1].length < 2) // Checks if TLD is at least 2 characters long
                    throw new Error;

                site = url.toString();
            } catch {
                await interaction.followUp({ content: "The site URL is invalid, make sure it starts with https:// (http:// will not be accepted) and contains a TLD (e.g. `https://example.com`)", ephemeral: true });
                return;
            }

        // Check if the alias is alphanumeric
        if (!/^[a-zA-Z0-9 ]+$/.test(alias)) {
            await interaction.followUp({ content: "The alias must be alphanumeric", ephemeral: true });
            return;
        }

        // Check if the color is a valid hex code
        if (color && !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            // Check if valid without #
            if (!/^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
                await interaction.followUp({ content: "The color must be a valid hex code (e.g. `#FF0000`)", ephemeral: true });
                return;
            }
            color = "#" + color;
        }

        await fetchHMAC<Member[]>(siteUrl("/api/member"), "POST", {
            discord: interaction.user.id,
            alias,
            site: site || undefined,
            color: color || undefined,
            addedRingToSite: false
        })
        .then(async members => {
            const member = members[0];
            if (!member)
                throw new Error("Member not found in response");
            await interaction.followUp({ embeds: [memberInfo(member)], ephemeral: true });
        });
    },
}

export default command;
