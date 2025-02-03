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
        let feed: {[key: string]: any} & Parser.Output<{[key: string]: any}> | undefined = undefined;
        try {
            feed = await parser.parseURL(rss);
            if (!feed.link || !feed.items)
                throw new Error("Invalid RSS/Atom feed (missing link or items)");
            if (feed.items.length && !feed.items[0].link)
                throw new Error("Invalid RSS/Atom feed items (missing title or link)");
            if ((!feed.title && !title) || (!feed.description && !description))
                throw new Error(`RSS/Atom feed does not have a ${!feed.title && !title ? "title" : ""}${!feed.title && !title && !feed.description && !description ? " or " : ""}${!feed.description && !description ? "description" : ""}, please provide custom ${!feed.title && !title ? "title" : ""}${!feed.title && !title && !feed.description && !description ? " and " : ""}${!feed.description && !description ? "description" : ""}`);
        } catch (error) {
            if (error instanceof Error)
                await interaction.editReply(error.message);
            else {
                console.error(error);
                await interaction.editReply("Invalid RSS/Atom feed");
            }

            if (feed && interaction.channel?.isSendable()) {
                await interaction.channel.send({
                    content: "Feed data parsed below for reference:",
                    files: [{
                        attachment: Buffer.from(JSON.stringify(feed, null, 2)),
                        name: "feed.json"
                    }]
                })
            }
            return;
        }


        await fetchHMAC(siteUrl("/api/actions"), "POST", {
            url: rss,
            memberDiscord: interaction.user.id,
            title: title || feed.title,
            description: description || feed.description,
        })
            .then(async res => {
                if (!res)
                    throw new Error("Failed to add action");
                await interaction.editReply(`Added\nshuold be visible on the site at ${siteUrl("/actions")}`);
            })
            .catch(async (err) => await interaction.editReply(`An error occurred while adding action\n\`\`\`\n${err}\n\`\`\``));

    },
}

export default command;