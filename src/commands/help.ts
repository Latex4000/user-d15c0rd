import { ChatInputCommandInteraction, SlashCommandBuilder, ApplicationCommandOptionType } from "discord.js";
import { Command, commands } from ".";
import { levenshteinDistance } from "../levenshtein";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("help")
        .setDescription("Get help with the bot")
        .addStringOption(option => 
            option
                .setName("command")
                .setDescription("The command you want help with")
                .setRequired(false)
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        const commandName = interaction.options.getString("command");
        if (!commandName) {
            await interaction.followUp({ content: `Here is a list of commands:\n${commands.map(command => `\`/${command.data.name}\``).join(" ")}` });
            return;
        }

        // Check with levenstein distance
        let command = commands.find(command => command.data.name === commandName);
        if (!command) {
            const suggestions: [string, number][] = commands.map(command => [command.data.name, levenshteinDistance(command.data.name, commandName)]);
            suggestions.sort((a, b) => a[1] - b[1]);
            if (suggestions[0][1] > 3) {
                await interaction.followUp({ content: `Command not found. Did you mean ${suggestions[0][0]}?` });
                return;
            }
            command = commands.find(command => command.data.name === suggestions[0][0])!;
        }

        const options = [...command.data.options];
        options.sort((a, b) => a.toJSON().required === b.toJSON().required ? 0 : a.toJSON().required ? -1 : 1);
        await interaction.followUp({ content: `# /${command.data.name}\n## ${command.data.description}\n\nUsage:\n${options.map(option => {
            const optionJSON = option.toJSON();
            return `**${optionJSON.name}**${optionJSON.required ? " - Required" : ""}\nType:${ApplicationCommandOptionType[optionJSON.type]}\n${optionJSON.description}`;
        }).join(" ")}` });
    },
}

export default command;