import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { Member, memberInfo } from "../types/member";
import * as config from "../../config.json";
import { fetchHMAC } from "../fetch";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("info")
        .setDescription("Get your information from the webring")
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
        if (i === -1) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        const member = data[i];
        await interaction.followUp({ embeds: [memberInfo(member)], ephemeral: true });
    },
}

export default command;