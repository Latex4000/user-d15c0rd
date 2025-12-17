import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { respond } from "../index.js";
import confirm from "../confirm.js";
import { submitMotion } from "../thingSubmissions/motion.js";
import { createWorkDir, cleanupWorkDir, downloadAttachmentToLocalFile } from "../commandUploads.js";

const motion: Command = {
    data: new SlashCommandBuilder()
        .setName("motion")
        .setDescription("Upload a motion u made to the webring")
        .addAttachmentOption(option =>
            option
                .setName("video")
                .setDescription("The video file to upload (mp4 recommended)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("title")
                .setDescription("The title of the motion")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("description")
                .setDescription("A description for the motion if wanted")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("tags")
                .setDescription("Optional comma-separated tags for the motion")
                .setRequired(false)
        )
        .addAttachmentOption(option =>
            option
                .setName("thumbnail")
                .setDescription("Thumbnail image for motion")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("hide_colour")
                .setDescription("Hide your colour on the site for this motion")
                .setRequired(false),
        )
        .addBooleanOption(option =>
            option
                .setName("allow_youtube_shorts")
                .setDescription("Allow this motion to be uploaded as a YouTube Short")
                .setRequired(false),
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const video = interaction.options.getAttachment("video");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description") || "";
        const tagsString = interaction.options.getString("tags") ?? "";
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const thumbnail = interaction.options.getAttachment("thumbnail");
        const hideColour = interaction.options.getBoolean("hide_colour") ?? false;
        const allowYoutubeShorts = interaction.options.getBoolean("allow_youtube_shorts") ?? false;

        if (video === null || title === null) {
            await respond(interaction, { content: "You must provide both a video file, and a title", ephemeral: true });
            return;
        }

        // Confirmation that the person's information is correct
        const update = await confirm(interaction, `Title: ${title}\nDescription: ${description || "N/A"}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}\n\nNote that if your video has a vertical (tall)/square aspect ratio, it may end up being uploaded as a short instead.\nIf you don't want, then ensure your video is wide\n\nIs all of your information correct?`);
        if (!update)
            return;

        const ownWork = await confirm(interaction, "This is for content that you made yourself, and doesn't contain content that would nuke the channels\nIs this your own work?");
        if (!ownWork)
            return;

        let workDir: string | null = null;
        try {
            workDir = await createWorkDir("motion");
            const videoFile = await downloadAttachmentToLocalFile(video, workDir, "video");
            const thumbnailFile = thumbnail
                ? await downloadAttachmentToLocalFile(thumbnail, workDir, "thumbnail")
                : null;

            const result = await submitMotion({
                memberDiscord: interaction.user.id,
                title,
                description,
                tags,
                hideColour,
                allowYoutubeShorts,
                video: videoFile,
                thumbnail: thumbnailFile,
            });

            await respond(interaction, {
                content: `Uploaded motion: ${result.uploads.youtubeUrl}`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await respond(interaction, {
                content: `Failed to upload motion:\n\`\`\`\n${message}\n\`\`\``,
                ephemeral: true,
            });
        } finally {
            if (workDir)
                await cleanupWorkDir(workDir);
        }
    },
}

export default motion;
