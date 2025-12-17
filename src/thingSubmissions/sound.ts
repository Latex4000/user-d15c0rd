import { exec } from "node:child_process";
import { extname, join } from "node:path";
import { openAsBlob } from "node:fs";
import { checkVideoForYoutube, renderStillVideoForYoutube } from "../video.js";
import youtubeClient from "../oauth/youtube.js";
import config, { canUseSoundcloud, canUseYoutube, siteUrl } from "../config.js";
import { uploadSoundcloud, changeSoundcloudDescription } from "../oauth/soundcloud.js";
import { fetchHMAC } from "../fetch.js";
import type { Sound } from "../types/sound.js";
import { postToFeed } from "../discordFeed.js";
import type { LocalFile, UploadedMedia } from "../types/io.js";

const validAudioExtensions = new Set([".mp3", ".wav"]);
const validImageExtensions = new Set([".png", ".jpg", ".jpeg"]);
const validVideoExtensions = new Set([".mp4", ".mov", ".mkv", ".avi", ".wmv"]);
const verticalAspectRatioThresh = 1.34;

interface ImageAspectResult {
    isHorizontal: boolean;
    width: number;
    height: number;
}

function getExtension(name: string): string {
    return extname(name).toLowerCase();
}

function ensureExtension(file: LocalFile, allowed: Set<string>, message: string): void {
    if (!allowed.has(getExtension(file.originalName)))
        throw new Error(message);
}

function checkImageAspectRatio(imagePath: string): Promise<ImageAspectResult> {
    return new Promise((resolve, reject) => {
        exec(
            `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=s=x:p=0 "${imagePath}"`,
            (err, stdout) => {
                if (err) {
                    reject(err);
                    return;
                }

                const [widthString, heightString] = stdout.trim().split("x");
                const width = Number.parseFloat(widthString);
                const height = Number.parseFloat(heightString);

                if (!Number.isFinite(width) || !Number.isFinite(height)) {
                    reject(new Error("Failed to get image dimensions"));
                    return;
                }

                resolve({
                    isHorizontal: width / height >= verticalAspectRatioThresh,
                    width,
                    height,
                });
            },
        );
    });
}

async function ensureHorizontalCover(imagePath: string, allowVertical: boolean): Promise<void> {
    const { isHorizontal, width, height } = await checkImageAspectRatio(imagePath);
    if (!isHorizontal && !allowVertical)
        throw new Error(
            `Your image has a vertical/square aspect ratio (**${width}x${height}**, aspect ratio ${(width / height).toFixed(2)}). Enable the vertical option to continue or provide a horizontal image.`,
        );
}

async function uploadToPlatforms(params: {
    title: string;
    description: string;
    genre: string;
    tags: string[];
    allowYoutubeShorts: boolean;
    audioPath: string;
    imagePath: string;
    videoPath: string;
    uploadThumbnail: boolean;
}): Promise<UploadedMedia> {
    const uploads: UploadedMedia = { youtubeUrl: null, soundcloudUrl: null };

    const allTags = [...params.tags];
    if (params.genre)
        allTags.push(params.genre);

    const defaultTags = [
        "music",
        "indie music",
        "unsigned artist",
        "original music",
        "new music",
        "collective music",
        "group music",
        "collective",
        "group",
        config.collective.name.toLowerCase(),
    ];

    const hashtags = allTags.map((tag) => `#${tag.replace(/\s+/g, "")}`).join(" ");
    let uniqueTags = [...new Set([...allTags, ...defaultTags])].filter((tag) => tag.length > 0);
    while (uniqueTags.join(", ").length > 300) {
        const last = uniqueTags.pop();
        if (last && uniqueTags.join("").length < 200) {
            uniqueTags.push(last);
            break;
        }
    }

    const releaseDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
    });

    const baseDescription = `${params.description.length > 0 ? `${params.description}\n\n` : ""}Genre: ${params.genre}\n${hashtags.length > 0 ? `Tags: ${hashtags}\n` : ""}Released: ${releaseDate}\n\nSite: ${config.collective.site_url}`;

    if (canUseYoutube) {
        const ytData = await youtubeClient.upload(
            params.title,
            baseDescription,
            uniqueTags,
            params.videoPath,
            "sounds",
            params.uploadThumbnail ? params.imagePath : undefined,
        );

        if (ytData.status?.uploadStatus !== "uploaded" || !ytData.id)
            throw new Error("Failed to upload to YouTube");

        uploads.youtubeUrl = `https://www.youtube.com/watch?v=${ytData.id}`;
    }

    const scDescription = `${baseDescription}\nYouTube: ${uploads.youtubeUrl ?? "N/A"}\n\nMusic from LaTeX 4000.\nUse our music however you want, just give credit to the collective`;

    if (canUseSoundcloud)
        uploads.soundcloudUrl = await uploadSoundcloud(params.title, scDescription, uniqueTags, params.audioPath, params.imagePath);

    if (canUseYoutube && uploads.youtubeUrl && uploads.soundcloudUrl) {
        const video = await youtubeClient.getVideo(uploads.youtubeUrl);
        await youtubeClient.updateDescription(
            video,
            `${baseDescription}\nSoundCloud: ${uploads.soundcloudUrl}\n\nMusic from LaTeX 4000.\nUse our music however you want, just give credit to the collective`,
        );
    }

    if (uploads.soundcloudUrl && !canUseYoutube)
        await changeSoundcloudDescription(uploads.soundcloudUrl, scDescription);

    return uploads;
}

export interface SoundSubmissionInput {
    memberDiscord: string;
    title: string;
    genre: string;
    description: string;
    tags: string[];
    hideColour: boolean;
    allowYoutubeShorts: boolean;
    confirmInformation: boolean;
    confirmOwnWork: boolean;
    audio: LocalFile;
    image: LocalFile;
    video?: LocalFile | null;
    workDir: string;
}

export async function submitSound(input: SoundSubmissionInput): Promise<{ sound: Sound; uploads: UploadedMedia }> {
    if (!input.confirmInformation || !input.confirmOwnWork)
        throw new Error("Please confirm the submission details and ownership");

    ensureExtension(input.audio, validAudioExtensions, "Audio file must be an mp3 or wav file");
    ensureExtension(input.image, validImageExtensions, "The image file must be a png or jpg file");

    await ensureHorizontalCover(input.image.path, input.allowYoutubeShorts);

    let uploadVideoPath = input.video?.path ?? "";
    if (input.video) {
        ensureExtension(input.video, validVideoExtensions, "Video file must be mp4/mov/mkv/avi/wmv");
        const errors = await checkVideoForYoutube(input.video.path, {
            allowYoutubeShorts: input.allowYoutubeShorts,
            requireAudio: false,
        });
        if (errors.length)
            throw new Error(errors.join("\n"));
    } else if (canUseYoutube) {
        uploadVideoPath = join(input.workDir, `sound-${Date.now()}.mp4`);
        await renderStillVideoForYoutube(input.image.path, input.audio.path, uploadVideoPath);
    }

    const uploads = await uploadToPlatforms({
        title: input.title,
        description: input.description,
        genre: input.genre,
        tags: input.tags,
        allowYoutubeShorts: input.allowYoutubeShorts,
        audioPath: input.audio.path,
        imagePath: input.image.path,
        videoPath: uploadVideoPath,
        uploadThumbnail: Boolean(input.video),
    });

    const formData = new FormData();
    formData.set("discord", input.memberDiscord);
    formData.set("title", input.title.trim());
    if (uploads.soundcloudUrl)
        formData.set("soundcloudUrl", uploads.soundcloudUrl);
    if (uploads.youtubeUrl)
        formData.set("youtubeUrl", uploads.youtubeUrl);
    formData.set("track", await openAsBlob(input.audio.path), input.audio.originalName);
    formData.set("cover", await openAsBlob(input.image.path), input.image.originalName);

    const dbTags = [input.genre, ...input.tags].map((tag) => tag.trim()).filter((tag) => tag.length > 0);
    if (dbTags.length)
        formData.set("tags", dbTags.join(","));

    formData.set("colour", (!input.hideColour).toString());

    const sound = await fetchHMAC<Sound>(siteUrl("/api/sounds"), "POST", formData);

    const feedLines = [
        `<@${input.memberDiscord}> uploaded a sound`,
        `Title: ${input.title}`,
    ];
    if (uploads.youtubeUrl)
        feedLines.push(`YouTube: ${uploads.youtubeUrl}`);
    if (uploads.soundcloudUrl)
        feedLines.push(`SoundCloud: ${uploads.soundcloudUrl}`);

    await postToFeed(feedLines.join("\n"));

    return { sound, uploads };
}
