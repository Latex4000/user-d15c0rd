import { extname } from "node:path";
import { checkVideoForYoutube } from "../video.js";
import youtubeClient from "../oauth/youtube.js";
import { canUseYoutube, siteUrl } from "../config.js";
import { fetchHMAC } from "../fetch.js";
import { postToFeed } from "../discordFeed.js";
import type { Motion } from "../types/motion.js";
import type { LocalFile } from "../types/io.js";

const validVideoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".wmv"]);
const validThumbnailExtensions = new Set([".png", ".jpg", ".jpeg"]);

export interface MotionSubmissionInput {
    memberDiscord: string;
    title: string;
    description: string;
    tags: string[];
    hideColour: boolean;
    allowYoutubeShorts: boolean;
    video: LocalFile;
    thumbnail?: LocalFile | null;
}

export interface MotionSubmissionResult {
    motion: Motion;
    uploads: { youtubeUrl: string };
}

function ensureExtension(file: LocalFile, allowed: Set<string>, message: string): void {
    const ext = extname(file.originalName).toLowerCase();
    if (!allowed.has(ext))
        throw new Error(message);
}

export async function submitMotion(input: MotionSubmissionInput): Promise<MotionSubmissionResult> {
    if (!canUseYoutube)
        throw new Error("YouTube uploads are disabled");

    if (!input.title.trim())
        throw new Error("Title is required");

    ensureExtension(input.video, validVideoExtensions, "Video file must be mp4/mov/mkv/avi/wmv");

    if (input.thumbnail)
        ensureExtension(input.thumbnail, validThumbnailExtensions, "Thumbnail must be png or jpg");

    const videoErrors = await checkVideoForYoutube(input.video.path, {
        allowYoutubeShorts: input.allowYoutubeShorts,
        requireAudio: false,
    });
    if (videoErrors.length)
        throw new Error(videoErrors.join("\n"));

    const thumbnailPath = input.thumbnail?.path;
    const ytData = await youtubeClient.upload(
        input.title,
        `${input.description ?? ""}\n\nTags: ${input.tags.join(", ")}`,
        input.tags,
        input.video.path,
        "motions",
        thumbnailPath,
    );

    if (ytData.status?.uploadStatus !== "uploaded" || !ytData.id)
        throw new Error("Failed to upload motion to YouTube");

    const youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;

    const motion = await fetchHMAC<Motion>(
        siteUrl("/api/motions"),
        "POST",
        {
            title: input.title,
            youtubeUrl,
            memberDiscord: input.memberDiscord,
            tags: input.tags,
            showColour: !input.hideColour,
            date: new Date(),
        },
    );

    await postToFeed(
        `<@${input.memberDiscord}> uploaded a motion\nTitle: ${input.title}\nYouTube: ${youtubeUrl}`,
    );

    return {
        motion,
        uploads: { youtubeUrl },
    };
}
