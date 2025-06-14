import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member, memberInfo } from "../types/member.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("info")
        .setDescription("Get your information from the webring")
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const data: Member[] = await fetchHMAC(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
        if (!data.length) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        const member = data[0];

        await interaction.followUp({ embeds: [memberInfo(member)], ephemeral: true });
    },
}

export default command;
