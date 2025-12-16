import AdmZip from "adm-zip";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import type { Word } from "../types/word.js";
import { postToFeed } from "../discordFeed.js";
import type { LocalFile } from "../types/io.js";

const markdownLimit = 2 ** 20;
const assetSizeLimit = 2 ** 20;

export interface WordSubmissionInput {
    memberDiscord: string;
    title: string;
    markdown: string;
    tags: string[];
    showColour: boolean;
    confirmInformation: boolean;
    confirmOwnWork: boolean;
    assetsZip?: LocalFile | null;
}

async function extractAssets(zipFile?: LocalFile | null): Promise<{ buffer: Buffer; filename: string }[]> {
    if (!zipFile)
        return [];

    const zip = new AdmZip(zipFile.path);
    const entries = zip.getEntries();
    if (!entries.length)
        throw new Error("No assets found in the zip file");

    const files: { buffer: Buffer; filename: string }[] = [];
    for (const entry of entries) {
        if (entry.isDirectory)
            throw new Error("Zip file cannot contain directories. Please flatten assets");

        const data = entry.getData();
        if (data.length > assetSizeLimit)
            throw new Error(`File "${entry.entryName}" exceeds the 1 MiB limit`);

        files.push({ buffer: data, filename: entry.entryName });
    }

    return files;
}

export async function submitWord(input: WordSubmissionInput): Promise<{ word: Word }> {
    if (!input.confirmInformation || !input.confirmOwnWork)
        throw new Error("Please confirm the submission details and ownership");

    if (input.markdown.length > markdownLimit)
        throw new Error("Markdown content is too long");

    const assets = await extractAssets(input.assetsZip);

    const formData = new FormData();
    formData.set("discord", input.memberDiscord);
    formData.set("title", input.title.trim());
    formData.set("md", input.markdown);
    if (input.tags.length)
        formData.set("tags", input.tags.join(","));
    formData.set("colour", input.showColour ? "true" : "false");

    for (const asset of assets)
        formData.append("assets", new Blob([asset.buffer]), asset.filename);

    const word = await fetchHMAC<Word>(siteUrl("/api/words"), "POST", formData);

    const slug = Math.floor(new Date(word.date).getTime() / 1000).toString(10);
    await postToFeed(
        `<@${input.memberDiscord}> uploaded a word\nLink: ${siteUrl(`/words/${slug}`)}`,
    );

    return { word };
}
