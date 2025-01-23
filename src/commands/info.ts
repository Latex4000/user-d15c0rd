import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member, memberInfo } from "../types/member.js";
import config from "../../config.json" with { type: "json" };
import { fetchHMAC } from "../fetch.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("info")
        .setDescription("Get your information from the webring")
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        // Get JSON Data
        let member: Member | undefined = undefined;
        try {
            const data: Member[] = await fetchHMAC(`${config.collective.site_url}/api/member?id=${interaction.user.id}`, "GET");
            if (data.length)
                member = data[0];
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the JSON data\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            console.error(e);
            return;
        }

        if (!member) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        await interaction.followUp({ embeds: [memberInfo(member)], ephemeral: true });
    },
}

export default command;