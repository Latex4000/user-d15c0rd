import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type { Attachment } from "discord.js";
import type { LocalFile } from "./types/io.js";

const baseTmpDir = join(process.cwd(), ".tmp", "commands");

export async function createWorkDir(kind: string): Promise<string> {
    await mkdir(baseTmpDir, { recursive: true });
    return mkdtemp(join(baseTmpDir, `${kind}-`));
}

export async function cleanupWorkDir(dir: string): Promise<void> {
    await rm(dir, { recursive: true, force: true });
}

export async function downloadAttachmentToLocalFile(
    attachment: Attachment,
    workDir: string,
    fieldName?: string,
): Promise<LocalFile> {
    const originalName = attachment.name ?? "upload";
    const destination = join(workDir, `${Date.now()}-${randomUUID()}-${originalName}`);
    const response = await fetch(attachment.url);
    if (!response.ok)
        throw new Error(`Failed to download attachment: ${originalName}`);

    const buffer = Buffer.from(await response.arrayBuffer());
    await writeFile(destination, buffer);

    return {
        path: destination,
        originalName,
        mimeType: attachment.contentType ?? undefined,
        fieldName,
    };
}
