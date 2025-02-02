import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import Parser from 'rss-parser';
import { Command } from "./index.js";
import { siteUrl } from "../config.js";
import { fetchHMAC } from "../fetch.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("action")
        .setDescription("Add your social media link to site")
        .addStringOption(option =>
            option.setName("rss")
                .setDescription("An rss/atom feed link")
                .setRequired(true),
        )
        .addStringOption(option =>
            option.setName("title")
                .setDescription("A custom title for the feed")
                .setRequired(false),
        )
        .addStringOption(option =>
            option.setName("description")
                .setDescription("A custom description for the feed")
                .setRequired(false),
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const rss = interaction.options.getString("rss")!;
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");

        // Check if rss is valid rss/atom feed
        const parser = new Parser();
        let feed: {[key: string]: any} & Parser.Output<{[key: string]: any}>
        try {
            feed = await parser.parseURL(rss);
            if (!feed.link || !feed.items)
                throw new Error("Invalid RSS/Atom feed (missing link or items)");
            if (feed.items.length && (!feed.items[0].title || !feed.items[0].link))
                throw new Error("Invalid RSS/Atom feed items (missing title or link)");
            if (!feed.title && !title) {
                await interaction.editReply("RSS/Atom feed does not have a title, please provide a custom one");
                return
            }
            if (!feed.description && !description) {
                await interaction.editReply("RSS/Atom feed does not have a description, please provide a custom one");
                return
            }
        } catch (error) {
            await interaction.editReply("Invalid RSS/Atom feed");
            return;
        }

        await fetchHMAC(siteUrl("/api/actions"), "POST", {
            rss,
            memberDiscord: interaction.user.id,
            title: title || feed.title,
            description: description || feed.description,
        });

        await interaction.editReply(`Added\nshuold be visible on the site at ${siteUrl("/actions")}`);
    },
}

export default command;