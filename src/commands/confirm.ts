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

        // Save JSON Date to a file, upload it using Neocities CLI, and then delete the file
        const jsonPath = "./tmp/members.json";
        await Bun.write(jsonPath, JSON.stringify(data, null, 4));
        const proc = Bun.spawn(["neocities", "upload", "members.json"], { cwd: "./tmp" });
        
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
            await interaction.followUp({ content: `An error occurred while uploading the file. Exit code: ${exitCode}`, ephemeral: true });
            return;
        }

        await unlink(jsonPath);

        await interaction.followUp({ content: "Webring membership confirmed" });
        return;
    },
}

export default command;