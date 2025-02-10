import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import Parser from 'rss-parser';
import { Command } from "./index.js";
import { siteUrl } from "../config.js";
import { fetchHMAC } from "../fetch.js";
import confirm from "../confirm.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("action")
        .setDescription("Add your social media link to site")
        .addStringOption(option =>
            option.setName("link")
                .setDescription("Link to your social media acc, ideally rss/atom link")
                .setRequired(true),
        )
        .addBooleanOption(option =>
            option.setName("is_rss")
                .setDescription("Is the link an RSS/Atom feed? (if not, title and desc. are required)")
                .setRequired(true),
        )
        .addStringOption(option =>
            option.setName("title")
                .setDescription("A custom title for the link")
                .setRequired(false),
        )
        .addStringOption(option =>
            option.setName("description")
                .setDescription("A custom description for the link")
                .setRequired(false),
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const link = interaction.options.getString("link")!;
        const isRSS = interaction.options.getBoolean("is_rss")!;
        let title = interaction.options.getString("title");
        let description = interaction.options.getString("description");

        try {
            new URL(link);
        } catch {
            await interaction.editReply("Invalid URL provided");
            return;
        }

        if (!isRSS) {
            if (!title || !description) {
                await interaction.editReply("Title and description are required for non-RSS/Atom feeds");
                return;
            }

            const noRSSConfirm = await confirm(interaction, `The link provided is not an RSS/Atom feed. Are you sure you want to continue?\nThis means new posts/content will not be shown in the feed on the [actions](<${siteUrl("/actions")}>) page, and the link will only show on the left sidebar\n\n# Most sites have RSS/atom feeds...\n## if you're unsure, check the site for a link to an RSS/atom feed before continuing\n## or potentially use a service like [fetchrss.com](<https://fetchrss.com/>) or [rsshub.app](<https://rsshub.app/>) to create a feed\n\nhttps://discord.com/channels/305538303179096065/1325576293881872386/1331567646747004971 also contains examples for popular sites`);
            if (!noRSSConfirm)
                return;
        } else {
            // Check if rss is valid rss/atom feed
            const parser = new Parser();
            let feed: {[key: string]: any} & Parser.Output<{[key: string]: any}> | undefined = undefined;
            try {
                feed = await parser.parseURL(link);
                if (!feed.link || !feed.items)
                    throw new Error("Invalid RSS/Atom feed (missing link or items)");
                if (feed.items.length && !feed.items[0].link)
                    throw new Error("Invalid RSS/Atom feed items (missing title or link)");
                if ((!feed.title && !title) || (!feed.description && !description))
                    throw new Error(`RSS/Atom feed does not have a ${!feed.title && !title ? "title" : ""}${!feed.title && !title && !feed.description && !description ? " or " : ""}${!feed.description && !description ? "description" : ""}, please provide custom ${!feed.title && !title ? "title" : ""}${!feed.title && !title && !feed.description && !description ? " and " : ""}${!feed.description && !description ? "description" : ""}`);
                if (!title)
                    title = feed.title ?? null;
                if (!description)
                    description = feed.description ?? null;
            } catch (error) {
                if (error instanceof Error)
                    await interaction.editReply(`Could not reach/parse RSS/Atom feed\n\`\`\`\n${error}\n\`\`\`${error.message.includes("403") ? "\nThe website the feed is from may be blocking the bot" : ""}`);
                else
                    await interaction.editReply("Invalid RSS/Atom feed");

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
        }

        if (!title || !description) {
            await interaction.editReply("Title and description are required");
            return;
        }

        await fetchHMAC(siteUrl("/api/actions"), "POST", {
            url: link,
            siteUrl: link,
            memberDiscord: interaction.user.id,
            title,
            description,
            isRSS,
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