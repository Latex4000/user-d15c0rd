import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { unlink, writeFile } from "node:fs/promises";
import * as config from "../../config.json";
import { exec } from "node:child_process";
import { Member, webringJS } from "../data/webringCode";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("confirm")
        .setDescription("Confirm webring membership after adding designated HTML to your site")
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        // Get JSON Data
        let data: Member[] = [];
        try {
            data = await fetch(`${config.collective.site_url}/members.json`).then(res => res.json());
        } catch (e) {
            await interaction.followUp({ content: "An error occurred while fetching the JSON data", ephemeral: true });
            console.error(e);
            return;
        }

        const i = data.findIndex(member => member.discord === interaction.user.id);
        if (i === -1) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        if (data[i].addedRingToSite) {
            await interaction.followUp({ content: "You have already confirmed your webring membership", ephemeral: true });
            return;
        }

        data[i].addedRingToSite = true;

        // Save JSON Date to a file, upload it using scp, send the JSON file to discord, and then delete the file
        const jsonPath = "./tmp/members.json";
        await writeFile(jsonPath, JSON.stringify(data, null, 4));
        exec(`scp ${jsonPath} ${config.scp.user}@${config.scp.hostname}:${config.scp.path}/members.json`, async (err, stdout, stderr) => {
            if (err) {
                console.error(err);
                interaction.followUp({ content: `An error occurred while uploading the JSON file. Exit code: ${err.code}`, ephemeral: true });
                return;
            }

            if (interaction.channel?.isSendable())
                await interaction.channel.send({ content: "JSON data for safekeeping:", files: [jsonPath] });

            unlink(jsonPath);
            interaction.followUp({ content: "Webring membership confirmed" });

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