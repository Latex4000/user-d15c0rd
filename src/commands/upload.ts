import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, MessageComponentInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { discordClient, respond } from "../index.js";
import { uploadSoundcloud } from "../oauth/soundcloud.js";
import { exec } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { fetchHMAC } from "../fetch.js";
import youtubeClient from "../oauth/youtube.js";
import { openAsBlob } from "node:fs";
import { extname } from "node:path";
import config, { canUseSoundcloud, canUseYoutube, siteUrl } from "../config.js";

const validExtensions = [".mp4", ".mov", ".mkv", ".avi", ".wmv"];

async function uploadToYoutubeAndSoundcloud(
    interaction: ChatInputCommandInteraction,
    audioPath: string,
    imagePath: string,
    videoPath: string,
    title: string,
    description: string,
    tags: string[],
    uploadThumbnail: boolean
) {
    let soundcloudUrl = "https://example.com/";
    let youtubeUrl = "https://example.com/";

    // Upload to YouTube
    if (canUseYoutube) {
        const ytData = await youtubeClient.upload(title, `${description}\n\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}`, tags, videoPath, uploadThumbnail ? imagePath : undefined);
        if (ytData.status?.uploadStatus !== "uploaded") {
            await respond(interaction, {
                content: `An error occurred while uploading the video\n\`\`\`\n${JSON.stringify(ytData, null, 2)}\n\`\`\``,
                ephemeral: true
            });
            return;
        }
        youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;
    }

    // Upload to SoundCloud
    if (canUseSoundcloud) {
        soundcloudUrl = await uploadSoundcloud(title, `${description}\n\nTags: ${tags ? tags.join(", ") : "N/A"}`, tags || [], audioPath, imagePath);
    }

    // Send to the config.discord.feed channel too
    discordClient.channels.fetch(config.discord.feed)
        .then(async channel => {
            if (channel?.isSendable())
                await channel.send({ content: `Uploaded by <@${interaction.user.id}>\nTitle: ${title}\nYouTube: ${youtubeUrl}\nSoundCloud: ${soundcloudUrl}` });
            else
                console.error("Failed to send message to feed channel: Channel is not sendable");
        })
        .catch(err => console.error("Failed to send message to feed channel", err));

    return {
        youtubeUrl,
        soundcloudUrl
    }
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
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        if (!interaction.channel?.isSendable()) {
            // WHAT?
            await respond(interaction, { content: "I cannot send messages in this channel", ephemeral: true });
            return;
        }

        const audio = interaction.options.getAttachment("audio");
        const image = interaction.options.getAttachment("image");
        const video = interaction.options.getAttachment("video");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description") || "";
        const tagsString = interaction.options.getString("tags") ?? "";
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim());

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

        // Check if the video file is suitable for youtube
        const videoPath = `./.tmp/${interaction.user.id}.mp4`;
        if (video) {
            if (!validExtensions.includes(extname(video.name))) {
                await respond(interaction, { content: "The video file must be an mp4 file", ephemeral: true });
                return;
            }
            await fetch(video.url).then(res => res.blob()).then(async blob => {
                await writeFile(videoPath, Buffer.from(await blob.arrayBuffer()));
            });

            // Run ffprobe to check the video file
            try {
                await new Promise<void>((resolve, reject) => {
                    exec(`ffprobe -v error -show_entries format=filename,format_name,duration -show_entries stream=index,codec_name,codec_type,width,height,r_frame_rate -of default=noprint_wrappers=1 ${videoPath}`, async (err, stdout, stderr) => {
                        if (err)
                            return reject(err);

                        // Check if the container and codec are suitable, and if there is audio (and only one audio stream)
                        const lines = stdout.split("\n");
                        let videoStream = false;
                        let videoStreams = 0;
                        let audioStream = false;
                        let audioStreams = 0;
                        for (const line of lines) {
                            if (line.startsWith("codec_name="))
                                if (!["h264", "aac"].includes(line.split("=")[1])) 
                                    return reject("The video file must be h264 video and aac audio");

                            if (line.startsWith("codec_type=video")) {
                                videoStream = true;
                                videoStreams++;
                            } else if (line.startsWith("codec_type=audio")) {
                                audioStream = true;
                                audioStreams++;
                            }
                        }
                        if (!videoStream || !audioStream || videoStreams !== 1 || audioStreams !== 1)
                            return reject("The video file must have exactly one video stream and one audio stream");

                        resolve();
                    });
                });
            } catch (err) {
                await respond(interaction, {
                    content: `An error occurred while checking the video file\n\`\`\`\n${err}\n\`\`\``,
                    ephemeral: true
                });
                await unlink(videoPath);
                return;
            }
        }

        // Confirmation that the person's information is correct, and the image aspect ratio is correct
        const ids = {
            yes: randomUUID(),
            no: randomUUID(),
        };
        const update = await interaction.channel.send({
            content: `Title: ${title}\nDescription: ${description || "N/A"}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}\n\nNote that if your image has a vertical (tall)/square aspect ratio, it may end up being uploaded as a short instead.\nIf you don't want, then ensure your image is wide\n\nIs all of your information correct?`,
            components: [
                new ActionRowBuilder<ButtonBuilder>()
                    .addComponents(
                        new ButtonBuilder()
                            .setCustomId(ids.yes)
                            .setLabel("Yes")
                            .setStyle(ButtonStyle.Success),
                        new ButtonBuilder()
                            .setCustomId(ids.no)
                            .setLabel("No")
                            .setStyle(ButtonStyle.Danger)
                    )
            ]
        });

        const result = await new Promise<boolean>(resolve => {
            const filter = (i: MessageComponentInteraction) => i.user.id === interaction.user.id;
            const confirmationCollector = update.createMessageComponentCollector({ filter, time: 60000 });
            let timeout = true;
            confirmationCollector.on("collect", async i => {
                timeout = false;
                if (i.customId === ids.yes) {
                    await update.delete();
                    confirmationCollector.stop();
                    resolve(true);
                } else if (i.customId === ids.no) {
                    await update.delete();
                    confirmationCollector.stop();
                    resolve(false);
                }
            });
            confirmationCollector.on("end", () => {
                if (timeout) {
                    interaction.followUp({ content: "You took too long to respond", ephemeral: true });
                    resolve(false);
                }
            });
        });

        if (!result) {
            await respond(interaction, { content: "Cancelled", ephemeral: true });
            return;
        }

        await mkdir(".tmp", { recursive: true });

        // Download files and save them with a hashed name
        const audioPath = `./.tmp/${createHash("sha256").update(audio.url).digest("hex")}${audio.name.endsWith(".mp3") ? ".mp3" : ".wav"}`;
        const imagePath = `./.tmp/${createHash("sha256").update(image.url).digest("hex")}${image.name.endsWith(".png") ? ".png" : ".jpg"}`;
        await fetch(audio.url).then(res => res.blob()).then(async blob => {
            await writeFile(audioPath, Buffer.from(await blob.arrayBuffer()));
        });
        await fetch(image.url).then(res => res.blob()).then(async blob => {
            await writeFile(imagePath, Buffer.from(await blob.arrayBuffer()));
        });

        // Const to delete the temporary video file and the downloaded files
        const deleteTemporaryFiles = () => Promise.allSettled([
            canUseYoutube ? unlink(videoPath) : Promise.resolve(),
            unlink(audioPath),
            unlink(imagePath),
        ]).catch((error) => console.error("Failed to delete temporary files", error));
        
        try {
            if (canUseYoutube && !video) {
                // Run ffmpeg to create a video file
                await new Promise<void>((resolve, reject) => {
                    exec(`ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "scale='min(1920, floor(iw/2)*2)':-2,format=yuv420p" -c:v libx264 -preset medium -profile:v main -c:a aac -shortest -movflags +faststart ${videoPath}`, async (err, stdout, stderr) => {
                        if (err)
                            return reject(err);
                        resolve();
                    });
                });
            }

            // Upload the video to YouTube
            let urls: { youtubeUrl: string, soundcloudUrl: string } | undefined = undefined;
            try {
                urls = await uploadToYoutubeAndSoundcloud(interaction, audioPath, imagePath, videoPath, title, description, tags, video ? true : false);
            } catch (err) {
                await respond(interaction, {
                    content: `An error occurred while uploading the video\n\`\`\`\n${err}\n\`\`\``,
                    ephemeral: true
                });
                return;
            }

            if (!urls) {
                await deleteTemporaryFiles();
                return;
            }

            const formData = new FormData();
            formData.append("title", title);
            formData.append("soundcloudUrl", urls.soundcloudUrl);
            formData.append("youtubeUrl", urls.youtubeUrl);
            formData.append("track", await openAsBlob(audioPath), `track${extname(audioPath)}`);
            formData.append("cover", await openAsBlob(imagePath), `cover${extname(imagePath)}`);
            if (tagsString)
                formData.append("tags", tagsString);

            await fetchHMAC(siteUrl("/api/sound"), "POST", formData)
                .then(async () => await respond(interaction, { content: `Uploaded to YouTube: ${urls.youtubeUrl}\nUploaded to SoundCloud: ${urls.soundcloudUrl}` }))
                .catch(async (err) => await respond(interaction, { content: `An error occurred while uploading the song\n\`\`\`\n${err}\n\`\`\``, ephemeral: true }));
        } catch (err) {
            await respond(interaction, {
                content: `An error occurred while creating the video\n\`\`\`\n${err}\n\`\`\``,
                ephemeral: true
            });
        }
        await deleteTemporaryFiles();
        return;
    },
}

export default command;
