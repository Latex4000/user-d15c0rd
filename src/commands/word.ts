import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import confirm from "../confirm.js";
import { respond } from "../index.js";
import { siteUrl } from "../config.js";
import { submitWord } from "../thingSubmissions/word.js";
import { createWorkDir, cleanupWorkDir, downloadAttachmentToLocalFile } from "../commandUploads.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("word")
        .setDescription("Upload a writeup u made to the webring; all files have a 1 MB limit")
        .addAttachmentOption(option =>
            option
                .setName("md_txt_file")
                .setDescription("The md or txt file to upload")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("title")
                .setDescription("The title of the post")
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName("assets")
                .setDescription("The assets (images etc) to upload (in a zip file)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("tags")
                .setDescription("The tags of the post (comma separated)")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("hide_colour")
                .setDescription("Hide your colour on the site for this word")
                .setRequired(false),
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const attachment = interaction.options.getAttachment("md_txt_file");
        const assets = interaction.options.getAttachment("assets");

        const title = interaction.options.getString("title");
        const tagsString = interaction.options.getString("tags") ?? "";
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const hideColour = interaction.options.getBoolean("hide_colour") ?? false;

        // Check for missing required options
        if (!attachment || !title) {
            await respond(interaction, { content: "You must provide at least a post file and a title", ephemeral: true });
            return;
        }

        // Check if the file is a markdown or text file
        if (!attachment.name.endsWith(".md") && !attachment.name.endsWith(".txt")) {
            await respond(interaction, { content: "The post file must be a markdown or text file", ephemeral: true });
            return;
        }

        // Get file content
        const content = await fetch(attachment.url).then(res => res.text());

        // Check if the assets file is a zip file
        if (assets && !assets.name.endsWith(".zip")) {
            await respond(interaction, { content: "The assets file must be a zip file", ephemeral: true });
            return;
        }

        // If attachment is a txt file, do not allow assets
        if (attachment.name.endsWith(".txt") && assets) {
            await respond(interaction, { content: "You cannot include assets with a `.txt` file.\nAssets are primarily only for markdown files for if you need to attach images to them.\nPlease remove the assets file and try again.", ephemeral: true });
            return;
        }

        const infoConfirmed = await confirm(interaction, `Title: ${title}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}\n\nIs all of your information correct?`);
        if (!infoConfirmed)
            return;

        const ownWork = await confirm(interaction, "This is for content that you made yourself\nIs this your own work?");
        if (!ownWork)
            return;

        let workDir: string | null = null;
        try {
            let assetsFile = null;
            if (assets) {
                workDir = await createWorkDir("word");
                assetsFile = await downloadAttachmentToLocalFile(assets, workDir, "assets");
            }

            const result = await submitWord({
                memberDiscord: interaction.user.id,
                title,
                markdown: content,
                tags,
                showColour: !hideColour,
                confirmInformation: infoConfirmed,
                confirmOwnWork: true,
                assetsZip: assetsFile,
            });

            const slug = Math.floor(new Date(result.word.date).getTime() / 1000).toString(10);
            await respond(interaction, {
                content: `Post uploaded successfully. Link: ${siteUrl(`/words/${slug}`)}`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await respond(interaction, {
                content: `Failed to upload word:\n\`\`\`\n${message}\n\`\`\``,
                ephemeral: true,
            });
        } finally {
            if (workDir)
                await cleanupWorkDir(workDir);
        }
    },
}

export default command;
