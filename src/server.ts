import { createWriteStream } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { IncomingMessage, ServerResponse } from "node:http";
import { once } from "node:events";
import { join } from "node:path";
import { randomUUID, createHmac, timingSafeEqual } from "node:crypto";
import Busboy from "busboy";
import config from "./config.js";
import { submitAction } from "./thingSubmissions/action.js";
import { submitMotion } from "./thingSubmissions/motion.js";
import { submitSound } from "./thingSubmissions/sound.js";
import { submitSight } from "./thingSubmissions/sight.js";
import { submitWord } from "./thingSubmissions/word.js";
import type { LocalFile } from "./types/io.js";

interface ParsedFormData {
    fields: Map<string, string[]>;
    files: LocalFile[];
    workDir: string;
}

function getHost(req: IncomingMessage): string {
    return req.headers.host ?? `localhost:${config.http.port}`;
}

function getCanonicalUrl(req: IncomingMessage): string {
    return `http://${getHost(req)}${req.url ?? "/"}`;
}

function getHeader(req: IncomingMessage, name: string): string | null {
    const value = req.headers[name.toLowerCase()];
    if (!value)
        return null;
    return Array.isArray(value) ? value[0] : value;
}

async function validateTimestamp(timestampHeader: string | null): Promise<number> {
    if (!timestampHeader)
        throw new Error("Missing HMAC timestamp");
    const timestamp = Number.parseInt(timestampHeader, 10);
    if (Number.isNaN(timestamp))
        throw new Error("Invalid HMAC timestamp");
    if (Math.abs(Date.now() - timestamp) > 5 * 60 * 1000)
        throw new Error("Expired HMAC timestamp");
    return timestamp;
}

function createHmacValidator(req: IncomingMessage, canonicalUrl: string) {
    const signatureHeader = getHeader(req, "x-hmac-signature");
    const timestampHeader = getHeader(req, "x-hmac-timestamp");

    return {
        async verifySignature(bodyDigest: Buffer): Promise<void> {
            if (!signatureHeader)
                throw new Error("Missing HMAC signature");
            await validateTimestamp(timestampHeader);
            const expected = Buffer.from(signatureHeader, "base64");
            if (!timingSafeEqual(expected, bodyDigest))
                throw new Error("Invalid HMAC signature");
        },
        createHasher() {
            const hmac = createHmac("sha256", config.secret_hmac);
            hmac.update(`${req.method}\r\n${canonicalUrl}\r\n${getHeader(req, "content-type") ?? ""}\r\n${timestampHeader ?? ""}\r\n`);
            return hmac;
        },
    };
}

async function parseJsonBody(req: IncomingMessage, canonicalUrl: string): Promise<any> {
    const validator = createHmacValidator(req, canonicalUrl);
    const hmac = validator.createHasher();
    const chunks: Buffer[] = [];

    req.on("data", (chunk) => {
        hmac.update(chunk);
        chunks.push(chunk);
    });

    await once(req, "end");
    const body = Buffer.concat(chunks);
    await validator.verifySignature(hmac.digest());

    try {
        return JSON.parse(body.toString("utf-8"));
    } catch {
        throw new Error("Invalid JSON payload");
    }
}

async function parseMultipart(req: IncomingMessage, canonicalUrl: string): Promise<ParsedFormData> {
    const validator = createHmacValidator(req, canonicalUrl);
    const hmac = validator.createHasher();
    const baseDir = join(process.cwd(), ".tmp", "http");
    await mkdir(baseDir, { recursive: true });
    const workDir = await mkdtemp(join(baseDir, "upload-"));

    const fields = new Map<string, string[]>();
    const files: LocalFile[] = [];

    const busboy = Busboy({ headers: req.headers });

    busboy.on("field", (name, value) => {
        const existing = fields.get(name);
        if (existing)
            existing.push(value);
        else
            fields.set(name, [value]);
    });

    busboy.on("file", (name, stream, info) => {
        const originalName = info.filename?.trim() ?? "";

        // Browsers still emit a "file" part even when no file was chosen; skip those.
        if (!originalName) {
            stream.resume();
            return;
        }

        const filename = originalName || "upload";
        const destination = join(workDir, `${Date.now()}-${randomUUID()}-${filename}`);
        const writeStream = createWriteStream(destination);
        stream.pipe(writeStream);
        const record: LocalFile = {
            path: destination,
            originalName: originalName,
            mimeType: info.mimeType,
            fieldName: name,
        };
        files.push(record);
    });

    req.on("data", (chunk) => {
        hmac.update(chunk);
    });

    const reqEndPromise = once(req, "end");
    req.pipe(busboy);
    await once(busboy, "finish");
    await reqEndPromise;
    await validator.verifySignature(hmac.digest());

    return { fields, files, workDir };
}

function getField(fields: Map<string, string[]>, name: string, required = true): string | null {
    const value = fields.get(name)?.[0] ?? null;
    if (value == null && required)
        throw new Error(`Missing field "${name}"`);
    return value;
}

function parseBoolean(value: string | null, defaultValue: boolean): boolean {
    if (value == null)
        return defaultValue;
    return value === "true" || value === "on";
}

function parseTags(value: string | null): string[] {
    if (!value)
        return [];
    return value.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
}

function pickFile(files: LocalFile[], field: string, optional = false): LocalFile | null {
    const file = files.find((entry) => entry.fieldName === field);
    if (!file && !optional)
        throw new Error(`Missing file "${field}"`);
    return file ?? null;
}

function pickFiles(files: LocalFile[], field: string): LocalFile[] {
    const matches = files.filter((entry) => entry.fieldName === field);
    if (!matches.length)
        throw new Error(`Missing file "${field}"`);
    return matches;
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
    const body = JSON.stringify(data);
    res.writeHead(status, {
        "Content-Type": "application/json",
        "Content-Length": Buffer.byteLength(body),
    });
    res.end(body);
}

async function withWorkDir<T>(form: ParsedFormData, fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } finally {
        await rm(form.workDir, { recursive: true, force: true });
    }
}

export async function handleHttpRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== "POST") {
        sendJson(res, 405, { error: "Method not allowed" });
        return;
    }

    const canonicalUrl = getCanonicalUrl(req);
    const url = new URL(canonicalUrl);

    try {
        switch (url.pathname) {
            case "/things/actions": {
                const body = await parseJsonBody(req, canonicalUrl);
                const result = await submitAction({
                    memberDiscord: body.discord,
                    link: body.link,
                    isRSS: Boolean(body.isRSS),
                    title: body.title,
                    description: body.description,
                });
                sendJson(res, 200, result);
                return;
            }
            case "/things/motions": {
                const form = await parseMultipart(req, canonicalUrl);
                const result = await withWorkDir(form, async () => {
                    const tagsValue = getField(form.fields, "tags", false);
                    return submitMotion({
                        memberDiscord: getField(form.fields, "discord")!,
                        title: getField(form.fields, "title")!,
                        description: getField(form.fields, "description", false) ?? "",
                        tags: parseTags(tagsValue),
                        hideColour: !parseBoolean(getField(form.fields, "colour", false), true),
                        allowYoutubeShorts: parseBoolean(getField(form.fields, "allowYoutubeShorts", false), false),
                        video: pickFile(form.files, "video")!,
                        thumbnail: pickFile(form.files, "thumbnail", true),
                    });
                });
                sendJson(res, 200, result);
                return;
            }
            case "/things/sounds": {
                const form = await parseMultipart(req, canonicalUrl);
                const result = await withWorkDir(form, async () => {
                    const tagsValue = getField(form.fields, "tags", false);
                    return submitSound({
                        memberDiscord: getField(form.fields, "discord")!,
                        title: getField(form.fields, "title")!,
                        genre: getField(form.fields, "genre")!,
                        description: getField(form.fields, "description", false) ?? "",
                        tags: parseTags(tagsValue),
                        hideColour: !parseBoolean(getField(form.fields, "colour", false), true),
                        allowYoutubeShorts: parseBoolean(getField(form.fields, "allowYoutubeShorts", false), false),
                        confirmInformation: parseBoolean(getField(form.fields, "confirmInformation", false), false),
                        confirmOwnWork: parseBoolean(getField(form.fields, "confirmOwnWork", false), false),
                        audio: pickFile(form.files, "audio")!,
                        image: pickFile(form.files, "image")!,
                        video: pickFile(form.files, "video", true),
                        workDir: form.workDir,
                    });
                });
                sendJson(res, 200, result);
                return;
            }
            case "/things/sights": {
                console.log("Processing sight submission");
                const form = await parseMultipart(req, canonicalUrl);
                console.log("Parsed multipart form");
                const result = await withWorkDir(form, async () =>
                    submitSight({
                        memberDiscord: getField(form.fields, "discord")!,
                        title: getField(form.fields, "title")!,
                        description: getField(form.fields, "description")!,
                        tags: parseTags(getField(form.fields, "tags", false)),
                        pixelated: parseBoolean(getField(form.fields, "pixelated", false), false),
                        showColour: parseBoolean(getField(form.fields, "colour", false), true),
                        confirmInformation: parseBoolean(getField(form.fields, "confirmInformation", false), false),
                        confirmOwnWork: parseBoolean(getField(form.fields, "confirmOwnWork", false), false),
                        assets: pickFiles(form.files, "assets"),
                    }),
                );
                sendJson(res, 200, result);
                return;
            }
            case "/things/words": {
                const form = await parseMultipart(req, canonicalUrl);
                const result = await withWorkDir(form, async () =>
                    submitWord({
                        memberDiscord: getField(form.fields, "discord")!,
                        title: getField(form.fields, "title")!,
                        markdown: getField(form.fields, "md")!,
                        tags: parseTags(getField(form.fields, "tags", false)),
                        showColour: parseBoolean(getField(form.fields, "colour", false), true),
                        confirmInformation: parseBoolean(getField(form.fields, "confirmInformation", false), false),
                        confirmOwnWork: parseBoolean(getField(form.fields, "confirmOwnWork", false), false),
                        assetsZip: pickFile(form.files, "assets", true),
                    }),
                );
                sendJson(res, 200, result);
                return;
            }
            default:
                sendJson(res, 404, { error: "Not found" });
                return;
        }
    } catch (error) {
        if (error instanceof Error) {
            console.error("Thing processor error", error);
            sendJson(res, 400, { error: error.message });
            return;
        }
        console.error("Unknown error", error);
        sendJson(res, 500, { error: "Internal server error" });
    }
}
