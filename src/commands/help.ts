import { ChatInputCommandInteraction, SlashCommandBuilder, ApplicationCommandOptionType, ActionRowBuilder, StringSelectMenuBuilder, ComponentType, Message, RepliableInteraction, ButtonBuilder, ButtonStyle } from "discord.js";
import { Command, commands } from ".";
import { levenshteinDistance } from "../levenshtein";

async function sendCommandText (interaction: RepliableInteraction, command: Command, message?: Message) {
    const options = [...command.data.options];
    options.sort((a, b) => a.toJSON().required === b.toJSON().required ? 0 : a.toJSON().required ? -1 : 1);
    if (!message)
        message = await interaction.followUp({ content: `# /${command.data.name}\n## ${command.data.description}\n\nUsage:\n${options.length ? options.map(option => {
            const optionJSON = option.toJSON();
            return `### \`${optionJSON.name}\`${optionJSON.required ? " - **Required**" : ""}\nType: \`${ApplicationCommandOptionType[optionJSON.type] === "String" ? "Text" : ApplicationCommandOptionType[optionJSON.type]}\`\n${optionJSON.description}`;
        }).join("\n") : "No options"}` });
    else
        message = await message.edit({ content: `# /${command.data.name}\n## ${command.data.description}\n\nUsage:\n${options.length ? options.map(option => {
            const optionJSON = option.toJSON();
            return `### \`${optionJSON.name}\`${optionJSON.required ? " - **Required**" : ""}\nType: \`${ApplicationCommandOptionType[optionJSON.type] === "String" ? "Text" : ApplicationCommandOptionType[optionJSON.type]}\`\n${optionJSON.description}`;
        }).join("\n") : "No options"}` });

    return message;
}

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
            const message = await interaction.followUp({ content: "Here is a list of commands. Click them to get more information", components: [
                new ActionRowBuilder<StringSelectMenuBuilder>()
                    .addComponents(
                        new StringSelectMenuBuilder()
                            .setCustomId("help")
                            .setPlaceholder("Select a command")
                            .addOptions(commands.map(command => ({
                                label: command.data.name,
                                value: command.data.name
                            })))
                    ),
                new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId("close")
                            .setLabel("Close")
                            .setStyle(ButtonStyle.Danger)
                    )
            ] });

            let respondMessage: Message | undefined = undefined;
            const collector = message.createMessageComponentCollector<ComponentType.StringSelect | ComponentType.Button>({ time: 60000 });
            collector.on("collect", async interaction => {
                await interaction.deferUpdate();
                if (interaction.isButton()) {
                    if (interaction.customId === "close") {
                        collector.stop();
                        await message.delete();
                        if (respondMessage)
                            await respondMessage.delete();
                    }
                    return;
                }

                const command = commands.find(command => command.data.name === interaction.values[0]);
                if (!command) {
                    if (!respondMessage)
                        respondMessage = await interaction.followUp({ content: "Command not found" });
                    else
                        await respondMessage.edit({ content: "Command not found" });
                    return;
                }

                respondMessage = await sendCommandText(interaction, command, respondMessage);
            });
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

        await sendCommandText(interaction, command);
    },
}

export default command;