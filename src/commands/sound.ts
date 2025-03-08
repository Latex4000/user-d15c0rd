import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { discordClient, respond } from "../index.js";
import { uploadSoundcloud } from "../oauth/soundcloud.js";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { fetchHMAC } from "../fetch.js";
import youtubeClient from "../oauth/youtube.js";
import { extname } from "node:path";
import config, { canUseSoundcloud, canUseYoutube, siteUrl } from "../config.js";
import confirm from "../confirm.js";

const verticalAspectRatioThresh = 1.34;
const validExtensions = [".mp4", ".mov", ".mkv", ".avi", ".wmv"];

async function uploadToYoutubeAndSoundcloud(
    interaction: ChatInputCommandInteraction,
    audioPath: string,
    imagePath: string,
    videoPath: string,
    title: string,
    description: string,
    tags: string[],
    uploadThumbnail: boolean,
) {
    let soundcloudUrl = "https://example.com/";
    let youtubeUrl = "https://example.com/";

    // Upload to YouTube
    if (canUseYoutube) {
        try {
            const ytData = await youtubeClient.upload(title, `${description}\n\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}`, tags, videoPath, "sounds", uploadThumbnail ? imagePath : undefined);
            if (ytData.status?.uploadStatus !== "uploaded") {
                await respond(interaction, {
                    content: `An error occurred while uploading the video\n\`\`\`\n${JSON.stringify(ytData, null, 2)}\n\`\`\``,
                    ephemeral: true
                });
                return;
            }
            youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;
        } catch (err) {
            console.error(err);
            await respond(interaction, {
                content: `An error occurred while uploading to youtube \n\`\`\`\n${err}\n\`\`\``,
                ephemeral: true
            });
            return;
        }
    }

    // Upload to SoundCloud
    if (canUseSoundcloud) {
        try {
            soundcloudUrl = await uploadSoundcloud(title, `${description}\n\nTags: ${tags ? tags.join(", ") : "N/A"}`, tags || [], audioPath, imagePath);
        } catch (err) {
            console.error(err);
            await respond(interaction, {
                content: `An error occurred while uploading to soundcloud\n\`\`\`\n${err}\n\`\`\``,
                ephemeral: true
            });
            return;
        }
    }

    // Send to the config.discord.feed channel too
    
    discordClient.channels.fetch(config.discord.feed)
        .then(async channel => {
            if (channel?.isSendable())
                await channel.send({ content: `<@${interaction.user.id}> uploaded a sound\nTitle: ${title}\nYouTube: ${youtubeUrl}\nSoundCloud: ${soundcloudUrl}` });
            else
                console.error("Failed to send message to feed channel: Channel is not sendable");
        })
        .catch(err => console.error("Failed to send message to feed channel", err));

    return {
        youtubeUrl,
        soundcloudUrl
    }
}

// Checks if an image aspect ratio is considered horizontal
async function checkImageAspectRatio(imagePath: string): Promise<{ isHorizontal: boolean, width: number, height: number }> {
    return new Promise((resolve, reject) => {
        exec(`ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${imagePath}"`, (err, stdout, stderr) => {
            if (err) {
                return reject(err);
            }
            
            const dimensions = stdout.trim().split('x');
            if (dimensions.length !== 2) {
                return reject(new Error('Failed to get image dimensions'));
            }
            
            const width = parseInt(dimensions[0]);
            const height = parseInt(dimensions[1]);
            
            if (isNaN(width) || isNaN(height)) {
                return reject(new Error('Invalid image dimensions'));
            }
            
            // Consider the image horizontal if the aspect ratio is greater than threshold
            const isHorizontal = width / height >= verticalAspectRatioThresh;
            
            resolve({isHorizontal, width, height});
        });
    });
}

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
                .setName("show_colour")
                .setDescription("Show your colour on site (default: true")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("allow_vertical")
                .setDescription("Allow vertical/square image (may be uploaded as a short)")
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
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
        const showColour = interaction.options.getBoolean("show_colour");
        const allowVertical = interaction.options.getBoolean("allow_vertical") || false;

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

        await mkdir(".tmp", { recursive: true });

        // Download the image file first and check its aspect ratio
        const imagePath = `./.tmp/${createHash("sha256").update(image.url).digest("hex")}${image.name.endsWith(".png") ? ".png" : ".jpg"}`;
        await fetch(image.url)
            .then(async response => writeFile(imagePath, Buffer.from(await response.arrayBuffer())));

        try {
            const { isHorizontal, width, height } = await checkImageAspectRatio(imagePath);
            
            if (!isHorizontal && !allowVertical) {
                await respond(interaction, { 
                    content: `Your image has a vertical/square aspect ratio (**${width}x${height}**; aspect ratio: **${(width / height).toFixed(2)}**; aspect ratio threshold: **${verticalAspectRatioThresh}**).\nThis may be uploaded as a short on YouTube, which you probably don't want.\nIf you want to continue anyway, please use the \`allow_vertical\` option or provide a horizontal image.`, 
                    ephemeral: true 
                });
                await unlink(imagePath);
                return;
            }
        } catch (err) {
            console.error("Failed to check image aspect ratio", err);
            await respond(interaction, { 
                content: `Failed to check image aspect ratio. Please ensure your image is horizontal.\n\`\`\`\n${err}\n\`\`\``, 
                ephemeral: true 
            });
            await unlink(imagePath);
            return;
        }

        // Check if the video file is suitable for youtube
        const videoPath = `./.tmp/${interaction.user.id}.mp4`;
        if (video) {
            if (!validExtensions.includes(extname(video.name))) {
                await respond(interaction, { content: "The video file must be an mp4 file", ephemeral: true });
                await unlink(imagePath);
                return;
            }
            await fetch(video.url)
                .then(async response => writeFile(videoPath, Buffer.from(await response.arrayBuffer())));

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
                        let isVideoHorizontal = true;
                        let videoWidth = 0;
                        let videoHeight = 0;

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
                            } else if (line.startsWith("width=")) {
                                videoWidth = parseInt(line.split("=")[1]);
                            } else if (line.startsWith("height=")) {
                                videoHeight = parseInt(line.split("=")[1]);
                            }
                        }

                        if (videoWidth > 0 && videoHeight > 0) {
                            isVideoHorizontal = videoWidth / videoHeight >= verticalAspectRatioThresh;
                            if (!isVideoHorizontal && !allowVertical) {
                                return reject(`Your video has a vertical/square aspect ratio (${videoWidth}x${videoHeight}). This may be uploaded as a short on YouTube. If you want to continue anyway, please use the \`allow_vertical\` option or provide a horizontal video.`);
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
                await unlink(imagePath);
                return;
            }
        }

        // Confirmation that the person's information is correct
        const shortWarning = allowVertical ? "\n\n**You've enabled the 'allow_vertical' option, so your content may be uploaded as a short.**" : "";
        const update = await confirm(interaction, `Title: ${title}\nDescription: ${description || "N/A"}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}${shortWarning}\n\nIs all of your information correct?`);
        if (!update) {
            await unlink(imagePath);
            if (video)
                await unlink(videoPath);
            return;
        }

        const ownWork = await confirm(interaction, "This is for content that you made yourself, and doesn't contain content that would nuke the channels\nIs this your own work?");
        if (!ownWork) {
            await unlink(imagePath);
            if (video)
                await unlink(videoPath);
            return;
        }

        // Download files and save them with a hashed name
        const audioPath = `./.tmp/${createHash("sha256").update(audio.url).digest("hex")}${audio.name.endsWith(".mp3") ? ".mp3" : ".wav"}`;
        await fetch(audio.url)
            .then(async response => writeFile(audioPath, Buffer.from(await response.arrayBuffer())));

        // Const to delete the temporary video file and the downloaded files
        const deleteTemporaryFiles = () => Promise.allSettled([
            canUseYoutube ? unlink(videoPath) : Promise.resolve(),
            unlink(audioPath),
            unlink(imagePath),
        ]).catch((error) => console.error("Failed to delete temporary files", error));

        try {
            if (canUseYoutube && !video) {
                // Run ffmpeg to create a video file
                const waitMessage = await interaction.channel.send("Creating the video...");
                await new Promise<void>((resolve, reject) => {
                    exec(`ffmpeg -loop 1 -i "${imagePath}" -i "${audioPath}" -vf "scale='min(1920, floor(iw/2)*2)':-2,format=yuv420p" -c:v libx264 -preset medium -profile:v main -c:a aac -shortest -movflags +faststart ${videoPath}`, async (err, stdout, stderr) => {
                        await waitMessage.delete();
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
            formData.set("discord", interaction.user.id);
            formData.set("title", title);
            formData.set("soundcloudUrl", urls.soundcloudUrl);
            formData.set("youtubeUrl", urls.youtubeUrl);
            formData.set("track", audio.url);
            formData.set("cover", image.url);
            formData.set("colour", showColour === false ? false : true);
            if (tagsString)
                formData.set("tags", tagsString);

            await fetchHMAC(siteUrl("/api/sounds"), "POST", formData)
                .then(async () => await respond(interaction, { content: `Uploaded to YouTube: ${urls.youtubeUrl}\nUploaded to SoundCloud: ${urls.soundcloudUrl}` }))
                .catch(async (err) => await respond(interaction, { content: `An error occurred while uploading the song\n\`\`\`\n${err}\n\`\`\``, ephemeral: true }));
        } catch (err) {
            console.error(err);
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
