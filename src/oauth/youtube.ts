import { google } from "googleapis";
import { IttyRouter } from "itty-router";
import { createServerAdapter } from '@whatwg-node/server';
import config from "../../config.json";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";

const auth = new google.auth.OAuth2(config.youtube.client_id, config.youtube.client_secret, config.youtube.redirect_uris[0]);
const youtube = google.youtube("v3");

// Callback server
const port = parseInt(config.youtube.redirect_uris[0].split(":")[2].split("/")[0]) || 8000;
const router = IttyRouter();
router.get("/", async ({ query }) => {
    const code = query.code;
    if (!code)
        return new Response("No code provided", { status: 400 });

    const { tokens } = await auth.getToken(typeof code === "string" ? code : code[0]);
    auth.setCredentials(tokens);
    try {
        await writeFile("ytToken.json", JSON.stringify(tokens));
    } catch (err) {
        if (err) {
            console.error(err);
            return new Response("Failed to write token to file", { status: 500 });
        }
    }
    return new Response("Successfully authenticated");
});
router.all("*", () => new Response("Not found", { status: 404 }));

const ittyServer = createServerAdapter(router.fetch);
const httpServer = createServer(ittyServer)
httpServer.listen(port);

// The actual functions
export async function getYoutubeAccessToken() {
    try {
        const tokenFile = await readFile("ytToken.json", "utf-8");
        const token = JSON.parse(tokenFile);
        auth.setCredentials(token);
        return;
    } catch (e) {
        const authUrl = auth.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/youtube.upload"],
        });
        return authUrl;
    }
}

export async function uploadYoutube(title: string, description: string, tags: string[], videoPath: string) {
    try {
        await readFile(videoPath);
    } catch (e) {
        throw "Video file does not exist";
    }

    const res = await youtube.videos.insert({
        auth,
        part: ["snippet", "status"],
        requestBody: {
            snippet: {
                categoryId: "10",
                title,
                description,
                tags,
            },
            status: {
                privacyStatus: "public",
            },
        },
        media: {
            body: createReadStream(videoPath),
        },
    });
    return res.data;
}
