import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { respond } from "../index.js";
import confirm from "../confirm.js";
import { submitSound } from "../thingSubmissions/sound.js";
import { createWorkDir, cleanupWorkDir, downloadAttachmentToLocalFile } from "../commandUploads.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("sound")
        .setDescription("Upload a song u made to the webring")
        .addAttachmentOption(option =>
            option
                .setName("audio")
                .setDescription("The audio file to upload")
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName("image")
                .setDescription("The image file to upload")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("title")
                .setDescription("The title of the song")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("genre")
                .setDescription("Main genre/descriptor for song")
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName("video")
                .setDescription("The video file to upload for youtube (mp4 recommended)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("description")
                .setDescription("A description for the song if wanted")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("tags")
                .setDescription("Optional comma-separated tags for the song")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("hide_colour")
                .setDescription("Hide your colour on the site for this sound")
                .setRequired(false),
        )
        .addBooleanOption(option =>
            option
                .setName("allow_youtube_shorts")
                .setDescription("Allow this sound to be uploaded as a YouTube Short")
                .setRequired(false),
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const audio = interaction.options.getAttachment("audio");
        const image = interaction.options.getAttachment("image");
        const video = interaction.options.getAttachment("video");
        const title = interaction.options.getString("title");
        const genre = interaction.options.getString("genre");
        const description = interaction.options.getString("description") || "";
        const tagsString = interaction.options.getString("tags") ?? "";
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const hideColour = interaction.options.getBoolean("hide_colour") ?? false;
        const allowShorts = interaction.options.getBoolean("allow_youtube_shorts") ?? false;

        if (!audio || !image || !title || !genre) {
            await respond(interaction, { content: "You must provide both an audio and image file, a title, and a genre", ephemeral: true });
            return;
        }
        const shortWarning = allowShorts ? "\n\n**You've enabled the 'allow_youtube_shorts' option, so your content may be uploaded as a short.**" : "";
        const update = await confirm(interaction, `Title: ${title}\nDescription: ${description || "N/A"}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}${shortWarning}\n\nIs all of your information correct?`);
        if (!update) {
            return;
        }

        const ownWork = await confirm(interaction, "This is for content that you made yourself, and doesn't contain content that would nuke the channels\nIs this your own work?");
        if (!ownWork) {
            return;
        }
        let workDir: string | null = null;
        try {
            workDir = await createWorkDir("sound");
            const audioFile = await downloadAttachmentToLocalFile(audio, workDir, "audio");
            const imageFile = await downloadAttachmentToLocalFile(image, workDir, "image");
            const videoFile = video ? await downloadAttachmentToLocalFile(video, workDir, "video") : null;

            const result = await submitSound({
                memberDiscord: interaction.user.id,
                title,
                genre,
                description,
                tags,
                hideColour,
                allowYoutubeShorts: allowShorts,
                confirmInformation: true,
                confirmOwnWork: true,
                audio: audioFile,
                image: imageFile,
                video: videoFile,
                workDir,
            });

            const lines = [
                `Uploaded sound: ${result.sound.title}`,
                result.uploads.youtubeUrl ? `YouTube: ${result.uploads.youtubeUrl}` : null,
                result.uploads.soundcloudUrl ? `SoundCloud: ${result.uploads.soundcloudUrl}` : null,
            ].filter(Boolean).join("\n");

            await respond(interaction, { content: lines.length > 0 ? lines : "Sound uploaded." });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await respond(interaction, {
                content: `Failed to upload sound:\n\`\`\`\n${message}\n\`\`\``,
                ephemeral: true,
            });
        } finally {
            if (workDir)
                await cleanupWorkDir(workDir);
        }
    },
}

export default command;
