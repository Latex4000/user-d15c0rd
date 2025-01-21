import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { Member } from "../types/member";
import * as config from "../../config.json";
import htmlGenerator from "../htmlGenerator";
import { fetchHMAC } from "../hmac";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("html")
        .setDescription("Get your premade HTML for the webring")
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        // Get JSON Data
        let data: Member[] = [];
        try {
            data = await fetchHMAC(`${config.collective.site_url}/api/members.json`, "GET").then(res => res.json());
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

        const member = data[i];
        const html = htmlGenerator(member.alias);
        await interaction.followUp({ content: `Here is the HTML for your site:\n${html}` });
    },
}

export default command;