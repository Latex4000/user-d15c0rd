import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { discordClient, respond } from "../index.js";
import { createHash } from "node:crypto";
import { fetchHMAC } from "../fetch.js";
import youtubeClient from "../oauth/youtube.js";
import { extname } from "node:path";
import config, { siteUrl } from "../config.js";
import confirm from "../confirm.js";
import { Motion } from "../types/motion.js";
import { checkVideoForYoutube } from "../video.js";

const validExtensions = [".mp4", ".mov", ".mkv", ".avi", ".wmv"];

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
                .setRequired(false)
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
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim());
        const thumbnail = interaction.options.getAttachment("thumbnail");
        const hideColour = interaction.options.getBoolean("hide_colour") ?? false;

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

            try {
                const errors = await checkVideoForYoutube(videoPath, {
                    allowYoutubeShorts: interaction.options.getBoolean("allow_youtube_shorts") ?? false,
                    requireAudio: false,
                });

                if (errors.length > 0) {
                    await respond(interaction, {
                        content: `Invalid video format for YouTube:\n${errors.map((error) => "- " + error).join("\n")}`,
                        ephemeral: true,
                    });
                    await unlink(videoPath);
                    return;
                }
            } catch (error) {
                await respond(interaction, {
                    content: `Error getting video format info:\n\`\`\`\n${error}\n\`\`\``,
                    ephemeral: true,
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

            // Send to the feed channel too
            discordClient.channels.fetch(config.discord.feed_channel_id)
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
                showColour: !hideColour,
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

export default motion;
