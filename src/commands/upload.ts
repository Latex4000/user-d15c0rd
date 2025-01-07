import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { unlink } from "node:fs/promises";
import { hash } from "bun";
import { respond } from "..";
import { uploadYoutube } from "../oauth/youtube";

async function uploadToYoutubeAndSoundcloud (
    interaction: ChatInputCommandInteraction,
    videoPath: string,
    title: string,
    tags: string[],
    attribution: string
) {
    const ytData = await uploadYoutube(title, `Attribution: ${attribution}\n\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}`, tags, videoPath);
    if (!ytData.status || ytData.status?.uploadStatus !== "uploaded") {
        await respond(interaction, {
            content: `An error occurred while uploading the video\n\`\`\`\n${JSON.stringify(ytData, null, 2)}\n\`\`\``,
            ephemeral: true
        });
        return;
    }
    const youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;

    await respond(interaction, {
        content: `Successfully uploaded the video to YouTube! ${youtubeUrl}`,
        ephemeral: true
    })

    // Upload to SoundCloud
    // const scData = await uploadSoundcloud(title, `Attribution: ${attribution}\n\nTags: ${tags ? tags.join(", ") : "N/A"}`, tags || [], videoPath);
}

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("upload")
        .setDescription("Upload a song to the funny collective channel")
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
                .setName("tags")
                .setDescription("Optional comma-separated tags for the song")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("attribution")
                .setDescription("Who should the song be attributed to in the description? (Default/Empty: No attribution)")
                .setRequired(false)
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const audio = interaction.options.getAttachment("audio");
        const image = interaction.options.getAttachment("image");
        const title = interaction.options.getString("title");
        const tags = interaction.options.getString("tags")?.split(",").map(tag => tag.trim()) || [];
        const attribution = interaction.options.getString("attribution") || "";
        
        if (audio === null || image === null || title === null) {
            await respond(interaction, { content: "You must provide both an audio and image file, and a title", ephemeral: true });
            return;
        }

        // Check if the audio file is an mp3 or wav
        if (!audio.name.endsWith(".mp3") && !audio.name.endsWith(".wav")) {
            await respond(interaction, { content: "The audio file must be an mp3 or wav file", ephemeral: true });
            return;
        }

        // Check if the image file is a png or jpg
        if (!image.name.endsWith(".png") && !image.name.endsWith(".jpg")) {
            await respond(interaction, { content: "The image file must be a png or jpg file", ephemeral: true });
            return;
        }

        // Download files and save them with a hashed name
        const audioPath = `./tmp/${hash(audio.url)}${audio.url.endsWith(".mp3") ? ".mp3" : ".wav"}`;
        const imagePath = `./tmp/${hash(image.url)}${image.url.endsWith(".png") ? ".png" : ".jpg"}`;
        await fetch(audio.url).then(res => res.blob()).then(blob => {
            Bun.write(audioPath, blob);
        });
        await fetch(image.url).then(res => res.blob()).then(blob => {
            Bun.write(imagePath, blob);
        });
        
        // Run ffmpeg to create a video file
        const videoPath = `./tmp/${interaction.user.id}.mp4`;
        const proc = Bun.spawn(["ffmpeg", "-loop", "1", "-i", imagePath, "-i", audioPath, "-vf", "scale='min(1280,iw)':-2,format=yuv420p", "-c:v", "libx264", "-preset", "medium", "-profile:v", "main", "-c:a", "aac", "-shortest", "-movflags", "+faststart", videoPath]);

        // Wait for the process to finish
        const exitCode = await proc.exited;
        if (exitCode !== 0) {
            await respond(interaction, { 
                content: `An error occurred while processing the files. Exit code: ${exitCode}`,
                ephemeral: true,
            });
            return;
        }

        // Upload the video to YouTube
        try {
            await uploadToYoutubeAndSoundcloud(interaction, videoPath, title, tags, attribution);
        } catch (err) {
            await respond(interaction, {
                content: `An error occurred while uploading the video\n\`\`\`\n${err}\n\`\`\``,
                ephemeral: true
            });
            return;
        }
        
        // Delete the temporary video file and the downloaded files
        try {
            await Promise.all([
                unlink(videoPath),
                unlink(audioPath),
                unlink(imagePath),
            ]);
        } catch (err) {
            console.error("Failed to delete temporary files", err);
        }
    },
}

export default command;