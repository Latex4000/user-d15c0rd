import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { unlink } from "node:fs/promises";
import * as config from "../../config.json";

interface Member {
    discord: string;
    alias: string;
    aliasEncoded: string;
    site: string;
    addedRingToSite: boolean;
}

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
                .setDescription("The URL of your site")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("encoded_alias")
                .setDescription("Custom encoded alias for the webring (default is lowercased and hyphenated alias)")
                .setRequired(false)
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const alias = interaction.options.getString("alias");
        const site = interaction.options.getString("site");

        if (alias === null || site === null) {
            await interaction.followUp({ content: "You must provide an alias and a site URL", ephemeral: true });
            return;
        }

        const encodedAlias = interaction.options.getString("encoded_alias") || alias.toLowerCase().replace(" ", "_");

        // Check if the site URL is valid
        try {
            const url = new URL(site);
            if (url.protocol !== 'http' && url.protocol !== 'https') throw new Error();
        } catch {
            await interaction.followUp({ content: "The site URL is invalid", ephemeral: true });
            return;
        }

        // Check if the alias is alphanumeric
        if (!/^[a-zA-Z0-9 ]+$/.test(alias)) {
            await interaction.followUp({ content: "The alias must be alphanumeric", ephemeral: true });
            return;
        }

        // Check if the encoded alias is alphanumeric
        if (!/^[a-zA-Z0-9_-]+$/.test(encodedAlias)) {
            await interaction.followUp({ content: "The encoded alias must be alphanumeric", ephemeral: true });
            return;
        }

        // Get JSON Data
        let data: Member[] = [];
        try {
            data = await fetch(`${config.collective.site_url}/members.json`).then(res => res.json());
        } catch (e) {
            await interaction.followUp({ content: "An error occurred while fetching the JSON data", ephemeral: true });
            console.error(e);
            return;
        }
        
        // Check if user is already in the webring, if so, ask if they want to update their site
        const i = data.findIndex(member => member.discord === interaction.user.id);
        if (i !== -1) {
            const update = await interaction.followUp({ content: "You are already in the webring. Would you like to update your site?", fetchReply: true });
            await update.react("✅");
            await update.react("❌");

            const filter = (reaction, user) => user.id === interaction.user.id && ["✅", "❌"].includes(reaction.emoji.name);
            const collected = await update.awaitReactions({ filter, max: 1, time: 60000 });

            if (collected.size === 0) {
                await interaction.followUp({ content: "You did not respond in time", ephemeral: true });
                return;
            }

            if (!collected.first() || collected.first()!.emoji.name === "❌") {
                await interaction.followUp({ content: "Cancelled", ephemeral: true });
                return;
            }

            // Update site
            data[i].alias = alias;
            data[i].aliasEncoded = encodedAlias;
            data[i].site = site;
        } else // Add user to the webring
            data.push({
                discord: interaction.user.id,
                alias,
                aliasEncoded: encodedAlias,
                site,
                addedRingToSite: false
            });

        // Save JSON Date to a file, upload it using Neocities CLI, and then delete the file
        const jsonPath = "./tmp/members.json";
        await Bun.write(jsonPath, JSON.stringify(data, null, 4));
        const proc = Bun.spawn(["neocities", "upload", "members.json"], { cwd: "./tmp" });
        
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
            await interaction.followUp({ content: `An error occurred while uploading the file. Exit code: ${exitCode}`, ephemeral: true });
            return;
        }

        await interaction.followUp({ content: i !== -1 ? `site updated\nyou do not need to confirm again` : `site added to the webring
add the webring to your site by adding the following HTML to your site:
\`\`\`html
<div class="${config.collective.name_condensed}Webring">
    <a href="${config.collective.site_url}" title="Collective">${config.collective.name}</a>
    <div class="${config.collective.name_condensed}WebringButtons">
        <a href="${config.collective.site_url}" id="${config.collective.name_condensed}Prev" title="Previous">←</a>
        <a href="#" id="${config.collective.name_condensed}Random" title="Random">Random</a>
        <a href="${config.collective.site_url}" id="${config.collective.name_condensed}Next" title="Next">→</a>
    </div>
    <script id="${config.collective.name_condensed}Webring" src="${config.collective.site_url}/webring.min.js" data-alias="${encodedAlias}"></script>
</div>
\`\`\`
and run \`/confirm\` to fully add your site to the webring` });

        // Delete the temporary JSON file
        await unlink(jsonPath);
        return;
    },
}

export default command;