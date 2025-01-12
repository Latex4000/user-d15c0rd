import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import { unlink, writeFile } from "node:fs/promises";
import { respond } from "..";
import { uploadYoutube } from "../oauth/youtube";
import { uploadSoundcloud } from "../oauth/soundcloud";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";

async function uploadToYoutubeAndSoundcloud (
    interaction: ChatInputCommandInteraction,
    audioPath: string,
    imagePath: string,
    videoPath: string,
    title: string,
    description: string,
    tags: string[]
) {
    // Upload to YouTube
    const ytData = await uploadYoutube(title, `${description}\n\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}`, tags, videoPath);
    if (!ytData.status || ytData.status?.uploadStatus !== "uploaded") {
        await respond(interaction, {
            content: `An error occurred while uploading the video\n\`\`\`\n${JSON.stringify(ytData, null, 2)}\n\`\`\``,
            ephemeral: true
        });
        return;
    }
    const youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;

    // Upload to SoundCloud
    const soundcloudUrl = await uploadSoundcloud(title, `${description}\n\nTags: ${tags ? tags.join(", ") : "N/A"}`, tags || [], audioPath, imagePath);

    // Respond to the user
    await respond(interaction, {
        content: `Uploaded to YouTube: ${youtubeUrl}\nUploaded to SoundCloud: ${soundcloudUrl}`,
        ephemeral: true
    });
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
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const audio = interaction.options.getAttachment("audio");
        const image = interaction.options.getAttachment("image");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description") || "";
        const tags = interaction.options.getString("tags")?.split(",").map(tag => tag.trim()) || [];
        
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
        const audioPath = `./tmp/${createHash("sha256").update(audio.url).digest("hex")}${audio.url.endsWith(".mp3") ? ".mp3" : ".wav"}`;
        const imagePath = `./tmp/${createHash("sha256").update(image.url).digest("hex")}${image.url.endsWith(".png") ? ".png" : ".jpg"}`;
        await fetch(audio.url).then(res => res.blob()).then(async blob => {
            await writeFile(audioPath, Buffer.from(await blob.arrayBuffer()));
        });
        await fetch(image.url).then(res => res.blob()).then(async blob => {
            await writeFile(imagePath, Buffer.from(await blob.arrayBuffer()));
        });
        
        // Run ffmpeg to create a video file
        const videoPath = `./tmp/${interaction.user.id}.mp4`;
        exec(`ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "scale='min(1280,iw)':-2,format=yuv420p" -c:v libx264 -preset medium -profile:v main -c:a aac -shortest -movflags +faststart ${videoPath}`, async (err, stdout, stderr) => {
            if (err) {
                await respond(interaction, { 
                    content: `An error occurred while processing the files\n\`\`\`\n${stderr}\n\`\`\``,
                    ephemeral: true,
                });
                return;
            }

            // Upload the video to YouTube
            try {
                await uploadToYoutubeAndSoundcloud(interaction, audioPath, imagePath, videoPath, title, description, tags);
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
        });
    },
}

export default command;