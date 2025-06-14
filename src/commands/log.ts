import { ChatInputCommandInteraction, EmbedBuilder, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { readFile } from "fs/promises";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";

async function runDiscordBotSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const filePath = `${process.cwd()}/output.log`;
    const file = await readFile(filePath);

    await interaction.followUp({
        files: [{
            name: "output.log",
            attachment: file,
        }],
    });
}

interface WebJournal {
    message: string;
    priority: number;
    timestamp: string;
}

async function runWebServerSubcommand(interaction: ChatInputCommandInteraction): Promise<void> {
    await interaction.deferReply({ ephemeral: true });

    const combinedJournals: WebJournal[] = [];
    let currentCombinedJournal: WebJournal | undefined;
    const journals = await fetchHMAC<WebJournal[]>(siteUrl("/api/journal"), "GET");

    for (const journal of journals) {
        if (currentCombinedJournal == null) {
            currentCombinedJournal = journal;
            continue;
        }

        if (
            currentCombinedJournal.priority !== journal.priority ||
            currentCombinedJournal.timestamp !== journal.timestamp
        ) {
            combinedJournals.push(currentCombinedJournal);
            currentCombinedJournal = journal;
            continue;
        }

        currentCombinedJournal.message += "\n" + journal.message;
    }

    if (currentCombinedJournal != null) {
        combinedJournals.push(currentCombinedJournal);
    }

    const embedPriorityColors = [
        "DarkRed",
        "DarkRed",
        "Red",
        "Red",
        "Yellow",
        "Yellow",
        "Yellow",
        "Grey",
    ] as const;

    await interaction.editReply({
        embeds: combinedJournals.slice(-10).map((journal) => new EmbedBuilder()
            .setColor(embedPriorityColors[Math.min(7, journal.priority)])
            .setDescription("```\n" + journal.message + "\n```")
            .setTimestamp(Number.parseInt(journal.timestamp.slice(0, -3), 10))
        ),
    });
}

const subcommandFns: Record<string, (interaction: ChatInputCommandInteraction) => Promise<void>> = {
    "discord-bot": runDiscordBotSubcommand,
    "web-server": runWebServerSubcommand,
};

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("log")
        .setDescription("View logs from the bot or web server")
        .addSubcommand((builder) => builder
            .setName("discord-bot")
            .setDescription("Print logs from the Discord bot")
        )
        .addSubcommand((builder) => builder
            .setName("web-server")
            .setDescription("Print the last week of logs from the web server")
        )
        .setContexts([
            InteractionContextType.Guild,
        ]),
    run: (interaction) =>
        subcommandFns[interaction.options.getSubcommand()](interaction),
}

export default command;
