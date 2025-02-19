import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { discordClient, respond } from "../index.js";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import { fetchHMAC } from "../fetch.js";
import youtubeClient from "../oauth/youtube.js";
import { extname } from "node:path";
import config, { siteUrl } from "../config.js";
import confirm from "../confirm.js";
import { Motion } from "../types/motion.js";

const validExtensions = [".mp4", ".mov", ".mkv", ".avi", ".wmv"];

const command: Command = {
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
                .setName("show_colour")
                .setDescription("Show your colour on site (default: true")
                .setRequired(false)
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
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim());
        const thumbnail = interaction.options.getAttachment("thumbnail");
        const showColour = interaction.options.getBoolean("show_colour");

        if (video === null || title === null) {
            await respond(interaction, { content: "You must provide both a video file, and a title", ephemeral: true });
            return;
        }

        // Check if the image file is a png or jpg
        if (thumbnail && (!thumbnail.name.endsWith(".png") && !thumbnail.name.endsWith(".jpg"))) {
            await respond(interaction, { content: "The thumbnail must be a png or jpg file", ephemeral: true });
            return;
        }

        // Check if the video file is suitable for youtube
        await mkdir(".tmp", { recursive: true });
        const videoPath = `./.tmp/${interaction.user.id}.mp4`;
        if (video) {
            if (!validExtensions.includes(extname(video.name))) {
                await respond(interaction, { content: "The video file must be an mp4 file", ephemeral: true });
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
                        let audioStreams = 0;
                        for (const line of lines) {
                            if (line.startsWith("codec_name="))
                                if (!["h264", "aac"].includes(line.split("=")[1]))
                                    return reject("The video file must be h264 video and aac audio");

                            if (line.startsWith("codec_type=video")) {
                                videoStream = true;
                                videoStreams++;
                            } else if (line.startsWith("codec_type=audio"))
                                audioStreams++;
                        }
                        if (!videoStream || videoStreams !== 1 || audioStreams !== 1)
                            return reject("The video file must have exactly one video stream and less than two audio streams");

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
        const update = await confirm(interaction, `Title: ${title}\nDescription: ${description || "N/A"}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}\n\nNote that if your video has a vertical (tall)/square aspect ratio, it may end up being uploaded as a short instead.\nIf you don't want, then ensure your video is wide\n\nIs all of your information correct?`);
        if (!update)
            return;

        const ownWork = await confirm(interaction, "This is for content that you made yourself, and doesn't contain content that would nuke the channels\nIs this your own work?");
        if (!ownWork)
            return;

        let imagePath: string | undefined = undefined;
        if (thumbnail) {
            imagePath = `./.tmp/${createHash("sha256").update(thumbnail.url).digest("hex")}${thumbnail.name.endsWith(".png") ? ".png" : ".jpg"}`;
            await fetch(thumbnail.url)
                .then(async response => writeFile(imagePath!, Buffer.from(await response.arrayBuffer())));
        }

        try {
            // Upload the video to YouTube
            const ytData = await youtubeClient.upload(title, `${description}\n\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}`, tags, videoPath, "motions", imagePath);
            if (ytData.status?.uploadStatus !== "uploaded") {
                await respond(interaction, {
                    content: `An error occurred while uploading the video\n\`\`\`\n${JSON.stringify(ytData, null, 2)}\n\`\`\``,
                    ephemeral: true
                });
                return;
            }
            const youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;

            // Send to the config.discord.feed channel too
            discordClient.channels.fetch(config.discord.feed)
                .then(async channel => {
                    if (channel?.isSendable())
                        await channel.send({ content: `<@${interaction.user.id}> uploaded a motion\nTitle: ${title}\nYouTube: ${youtubeUrl}` });
                    else
                        console.error("Failed to send message to feed channel: Channel is not sendable");
                })
                .catch(err => console.error("Failed to send message to feed channel", err));

            const motionData = {
                title,
                youtubeUrl,
                memberDiscord: interaction.user.id,
                showColour: showColour === false ? false : true,
                date: new Date(),
                tags,
            }

            await fetchHMAC<Motion>(siteUrl("/api/motions"), "POST", motionData)
                .then(async (motion) => {
                    if (!motion)
                        throw new Error("Failed to create motion");
                    await respond(interaction, { content: `Uploaded to YouTube: ${youtubeUrl}` });
                })
                .catch(async (err) => await respond(interaction, { content: `An error occurred while uploading the song\n\`\`\`\n${err}\n\`\`\``, ephemeral: true }));
        } catch (err) {
            await respond(interaction, {
                content: `An error occurred while creating the video\n\`\`\`\n${err}\n\`\`\``,
                ephemeral: true
            });
        }
        await Promise.allSettled([
            imagePath ? unlink(imagePath) : Promise.resolve(),
            unlink(videoPath),
        ]).catch((error) => console.error("Failed to delete temporary files", error));
        return;
    },
}

export default command;
