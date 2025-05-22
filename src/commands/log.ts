import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { readFile } from "fs/promises";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("log")
        .setDescription("Get the output.log file from the main directory")
        .setContexts([
            InteractionContextType.Guild,
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        // Get output.log file
        const filePath = `${process.cwd()}/output.log`;
        try {
            const file = await readFile(filePath);
            // Send the file to the user
            await interaction.followUp({
                content: "Here is the output.log file:",
                files: [{
                    name: "output.log",
                    attachment: file,
                }],
                ephemeral: true,
            });
        } catch (error) {
            await interaction.followUp({
                content: `\n\`\`\`${error}\`\`\``,
                ephemeral: true,
            });
        }
    },
}

export default command;