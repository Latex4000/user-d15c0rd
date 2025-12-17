import { readFile } from "node:fs/promises";
import AdmZip from "adm-zip";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import type { Sight } from "../types/sight.js";
import { postToFeed } from "../discordFeed.js";
import type { LocalFile } from "../types/io.js";

export interface SightSubmissionInput {
    memberDiscord: string;
    title: string;
    description: string;
    tags: string[];
    pixelated: boolean;
    showColour: boolean;
    confirmInformation: boolean;
    confirmOwnWork: boolean;
    assets: LocalFile[];
}

async function expandAssets(files: LocalFile[]): Promise<{ buffer: Buffer; filename: string }[]> {
    const expanded: { buffer: Buffer; filename: string }[] = [];

    for (const file of files) {
        if (file.originalName.toLowerCase().endsWith(".zip")) {
            const zip = new AdmZip(file.path);
            const entries = zip.getEntries();
            if (!entries.length)
                throw new Error("Zip file contained no assets");

            for (const entry of entries) {
                if (entry.isDirectory)
                    throw new Error("Zip file cannot contain directories");

                expanded.push({
                    buffer: entry.getData(),
                    filename: entry.entryName,
                });
            }
        } else {
            expanded.push({
                buffer: await readFile(file.path),
                filename: file.originalName,
            });
        }
    }

    if (!expanded.length)
        throw new Error("At least one asset is required");

    return expanded;
}

export async function submitSight(input: SightSubmissionInput): Promise<{ sight: Sight }> {
    if (!input.confirmInformation || !input.confirmOwnWork)
        throw new Error("Please confirm the submission details and ownership");

    const assets = await expandAssets(input.assets);

    const formData = new FormData();
    formData.set("discord", input.memberDiscord);
    formData.set("title", input.title.trim());
    formData.set("description", input.description.trim());
    if (input.tags.length)
        formData.set("tags", input.tags.join(","));
    formData.set("pixelated", input.pixelated ? "true" : "false");
    formData.set("colour", input.showColour ? "true" : "false");

    for (const asset of assets)
        formData.append("assets", new Blob([asset.buffer]), asset.filename);

    const sight = await fetchHMAC<Sight>(siteUrl("/api/sights"), "POST", formData);

    await postToFeed(
        `<@${input.memberDiscord}> uploaded a sight\nLink: ${siteUrl("/sights")}`,
    );

    return { sight };
}
