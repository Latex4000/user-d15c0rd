import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import * as config from "../../config.json";
import { fetchHMAC } from "../fetch";
import htmlGenerator from "../htmlGenerator";
import { Member } from "../types/member";

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
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("color")
                .setDescription("(hex code) colour used to sign your posts created (write 'none' for random color)")
                .setRequired(true)
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        // Get JSON Data
        let data: Member[] = [];
        try {
            data = await fetchHMAC(`${config.collective.site_url}/api/members.json`, "GET");
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the JSON data\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            console.error(e);
            return;
        }

        const i = data.findIndex(member => member.discord === interaction.user.id);
        if (i !== -1) {
            if (data[i].addedRingToSite)
                await interaction.followUp({ content: "You have already confirmed your webring membership", ephemeral: true });
            else
                await interaction.followUp({ content: "You are already in the webring, run `/confirm` to confirm your webring membership", ephemeral: true });
            return;
        }

        const alias = interaction.options.getString("alias");
        let site = interaction.options.getString("site");
        let color = interaction.options.getString("color");

        if (alias === null || site === null || color === null) {
            await interaction.followUp({ content: "You must provide an alias, a site URL, and a hex code color or 'none' for random color", ephemeral: true });
            return;
        }

        // Check if the site URL is valid
        try {
            const url = new URL(site);

            if (url.protocol !== 'http:' && url.protocol !== 'https:') // Checks if URL is HTTP or HTTPS
                throw new Error;
            if (!url.hostname.includes(".")) // Checks if URL contains at least one dot
                throw new Error;
            if (url.hostname.split(".")[url.hostname.split(".").length - 1].length < 2) // Checks if TLD is at least 2 characters long
                throw new Error;

            site = url.toString();
        } catch {
            await interaction.followUp({ content: "The site URL is invalid, make sure it starts with http:// or https:// and contains a TLD (e.g. `https://example.com`)", ephemeral: true });
            return;
        }

        // Check if the alias is alphanumeric
        if (!/^[a-zA-Z0-9 ]+$/.test(alias)) {
            await interaction.followUp({ content: "The alias must be alphanumeric", ephemeral: true });
            return;
        }

        // Check if the color is a valid hex code
        if (color !== "none" && !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            await interaction.followUp({ content: "The color must be a valid hex code (e.g. `#FF0000`)", ephemeral: true });
            return;
        }

        await fetchHMAC(config.collective.site_url + "/api/member", "POST", {
            discord: interaction.user.id,
            alias,
            site,
            color: color !== "none" ? color : undefined,
            addedRingToSite: false
        })
        .then(async () => await interaction.followUp({ content: `You have joined the webring\nAdd the webring to your site by adding the following HTML (receivable again via \`/html\`):\n${htmlGenerator(alias)}\nand run \`/confirm\` to fully add your site to the webring` }))
        .catch(async (err) => await interaction.followUp({ content: "An error occurred while joining the webring\n\`\`\`\n" + err + "\n\`\`\`", ephemeral: true }));
        
    },
}

export default command;