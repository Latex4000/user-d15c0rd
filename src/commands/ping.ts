import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("ping")
        .setDescription("Ping the bot")
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        await interaction.followUp({ content: `Yo, this is being sent at ${Date.now() - interaction.createdTimestamp}ms!` });
    },
}

export default command;