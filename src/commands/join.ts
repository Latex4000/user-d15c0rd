import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, MessageComponentInteraction, MessageReaction, SlashCommandBuilder, User } from "discord.js";
import { Command } from ".";
import { unlink, writeFile } from "node:fs/promises";
import * as config from "../../config.json";
import { exec } from "node:child_process";
import { Member, webringJS } from "../data/webringCode";
import { randomUUID } from "node:crypto";

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
        let site = interaction.options.getString("site");

        if (alias === null || site === null) {
            await interaction.followUp({ content: "You must provide an alias and a site URL", ephemeral: true });
            return;
        }

        const encodedAlias = interaction.options.getString("encoded_alias") || alias.toLowerCase().replace(" ", "_");

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
            const ids = {
                yes: randomUUID(),
                no: randomUUID(),
            };
            const update = await interaction.followUp({
                content: "You are already in the webring. Would you like to update your site?",
                components: [
                    new ActionRowBuilder<ButtonBuilder>()
                        .addComponents(
                            new ButtonBuilder()
                                .setCustomId(ids.yes)
                                .setLabel("Yes")
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId(ids.no)
                                .setLabel("No")
                                .setStyle(ButtonStyle.Danger)),
                ],
            });

            const result = await new Promise<boolean>(resolve => {
                const filter = (i: MessageComponentInteraction) => i.user.id === interaction.user.id;
                const confirmationCollector = update.createMessageComponentCollector({ filter, time: 60000 });
                let timeout = true;
                confirmationCollector.on("collect", async i => {
                    timeout = false;
                    if (i.customId === ids.yes) {
                        await update.delete();
                        confirmationCollector.stop();
                        resolve(true);
                    } else if (i.customId === ids.no) {
                        await update.delete();
                        confirmationCollector.stop();
                        resolve(false);
                    }
                });
                confirmationCollector.on("end", () => {
                    if (timeout) {
                        interaction.followUp({ content: "You took too long to respond", ephemeral: true });
                        resolve(false);
                    }
                });
            });

            if (!result)
                return;

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

        // Save JSON Date to a file, upload it using scp, and then delete the file
        const jsonPath = "./tmp/members.json";
        await writeFile(jsonPath, JSON.stringify(data, null, 4));
        exec(`scp ${jsonPath} ${config.scp.user}@${config.scp.hostname}:${config.scp.path}/members.json`, async (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                interaction.followUp({ content: `An error occurred while uploading the file. Exit code: ${err.code}`, ephemeral: true });
                return;
            }
            
            if (interaction.channel?.isSendable())
                await interaction.channel.send({ content: "JSON data for safekeeping:", files: [jsonPath] });

            unlink(jsonPath);
            interaction.followUp({ content: i !== -1 ? `site updated\nyou do not need to confirm again` : `site added to the webring
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

            const jsPath = "./tmp/webring.min.js";
            await writeFile(jsPath, webringJS(data));
            exec(`scp ${jsPath} ${config.scp.user}@${config.scp.hostname}:${config.scp.path}/webring.min.js`, (err, stdout, stderr) => {
                if (err) {
                    console.error(err);
                    console.error(stderr);
                    if (interaction.channel?.isSendable())
                        interaction.channel.send({ content: `An error occurred while uploading the JS file. Exit code: ${err.code}` });
                    return;
                }
                unlink(jsPath);
            });
        });
    },
}

export default command;