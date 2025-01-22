import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { Member } from "../types/member";
import * as config from "../../config.json";
import htmlGenerator from "../htmlGenerator";
import { fetchHMAC } from "../fetch";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("change")
        .setDescription("Change your alias or site link in the webring")
        .addStringOption(option => 
            option
                .setName("alias")
                .setDescription("Your online alias for the webring")
                .setRequired(false)
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
                .setDescription("Colour used to sign your posts created (hex code)")
                .setRequired(false)
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        let data: Member[] = [];
        try {
            data = await fetchHMAC(`${config.collective.site_url}/api/members.json`, "GET");
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the JSON data\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            console.error(e);
            return;
        }

        const i = data.findIndex(member => member.discord === interaction.user.id);
        if (i === -1) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        const member = data[i];
        
        const alias = interaction.options.getString("alias");
        let site = interaction.options.getString("site");
        const color = interaction.options.getString("color");

        // Check if the site URL is valid
        if (site)
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
        if (alias && !/^[a-zA-Z0-9 ]+$/.test(alias)) {
            await interaction.followUp({ content: "The alias must be alphanumeric", ephemeral: true });
            return;
        }

        // Check if the color is a valid hex code
        if (color && !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            await interaction.followUp({ content: "The color must be a valid hex code", ephemeral: true });
            return;
        }

        if (alias) member.alias = alias;
        if (site) member.site = site;
        if (color) member.color = color;
        await fetchHMAC(config.collective.site_url + "/api/member", "PUT", member)
            .then(async () => await interaction.followUp({ content: `You have updated your webring membership\n${alias ? `HTML update:\n${htmlGenerator(member.alias)}\n` : ""}\n${!member.addedRingToSite ? "You still need to confirm your webring membership by adding the HTML to your site and running \`/confirm\`" : ""}` }))
            .catch(async (err) => await interaction.followUp({ content: "An error occurred while updating your webring membership\n\`\`\`\n" + err + "\n\`\`\`", ephemeral: true }));
    },
}

export default command;