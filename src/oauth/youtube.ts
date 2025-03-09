import { Auth, google, youtube_v3 } from "googleapis";
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import config, { canUseYoutube } from "../config.js";

class YoutubeClient {
    private auth: Auth.OAuth2Client | undefined;
    private hasAccessToken: boolean = false;
    private youtube: youtube_v3.Youtube | undefined;

    async initialize(): Promise<boolean | undefined> {
        if (!canUseYoutube) {
            return;
        }

        this.auth = new google.auth.OAuth2(config.youtube.client_id, config.youtube.client_secret, config.youtube.redirect_uris[0]);
        this.youtube = google.youtube("v3");

        try {
            const tokenFile = await readFile("ytToken.json", "utf-8");
            const token = JSON.parse(tokenFile);
            this.auth.setCredentials(token);
            this.updateTokens();
            return this.hasAccessToken = true;
        } catch {
            return false;
        }
    }

    updateTokens () {
        if (!this.auth)
            return;

        // https://developers.google.com/identity/protocols/oauth2/web-server#node.js_8
        this.auth.on("tokens", async (tokens) => {
            if (tokens.refresh_token)
                await writeFile("ytToken.json", JSON.stringify(tokens));
        });
    }

    async getAccessToken(sendMessageToOwner: (message: string) => Promise<unknown>): Promise<void> {
        if (this.auth == null || this.youtube == null)
            throw new Error("YouTube client not initialized");

        const port = parseInt(config.youtube.redirect_uris[0].split(":")[2].split("/")[0]) || 8000;
        const _sendMessageToOwner = (message: string) => sendMessageToOwner(message).catch((error) => {
            console.error(message);
            console.error(error);
        });

        const codePromise = new Promise<string>((resolve, reject) => {
            const httpServer = createServer();
            httpServer.on("request", (req, res) => {
                const url = new URL(req.url ?? "/", "http://localhost/");
                const code = url.searchParams.get("code");

                if (!code) {
                    res.writeHead(400);
                    res.write("No code provided\n");

                    reject();
                } else {
                    res.writeHead(200);
                    res.write("Successfully authenticated\n");

                    resolve(code);
                }

                res.end(() => httpServer.close());
            });
            httpServer.listen(port);
        });

        const url = this.auth.generateAuthUrl({
            access_type: "offline",
            scope: ["https://www.googleapis.com/auth/youtube", "https://www.googleapis.com/auth/youtube.upload"],
        });
        await _sendMessageToOwner(`Click here to authenticate with YouTube: ${url}`);

        try {
            const code = await codePromise;
            const { tokens } = await this.auth.getToken(code);

            this.auth.setCredentials(tokens);
            await writeFile("ytToken.json", JSON.stringify(tokens));
            this.updateTokens();
            this.hasAccessToken = true;
        } catch (error) {
            await _sendMessageToOwner("Failed to get token for YouTube");
            throw error;
        }
    }

    async upload(title: string, description: string, tags: string[], videoPath: string, uploadType: "sounds" | "motions", imagePath?: string): Promise<youtube_v3.Schema$Video> {
        if (this.auth == null || this.youtube == null || !this.hasAccessToken)
            throw new Error("YouTube client not initialized");

        const res = await this.youtube.videos.insert({
            auth: this.auth,
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
                    selfDeclaredMadeForKids: false,
                    containsSyntheticMedia: false,
                    license: "creativeCommon",
                },
            },
            media: {
                body: createReadStream(videoPath),
            },
        });
        const video = res.data;
        const videoID = video.id;

        if (videoID == null)
            throw new Error("Failed to upload video");

        if (imagePath)
            await this.youtube.thumbnails.set({
                auth: this.auth,
                videoId: videoID,
                media: {
                    body: createReadStream(imagePath),
                },
            })

        // Add to playlist
        const playlistID = config.youtube.playlists[uploadType];
        if (playlistID)
            await this.youtube.playlistItems.insert({
                auth: this.auth,
                part: ["snippet"],
                requestBody: {
                    snippet: {
                        playlistId: playlistID,
                        resourceId: {
                            kind: "youtube#video",
                            videoId: videoID,
                        },
                    },
                },
            });

        return video;
    }

    async updateDescription(url: string, description: string): Promise<void> {
        if (this.auth == null || this.youtube == null || !this.hasAccessToken)
            throw new Error("YouTube client not initialized");

        // Should be a link of the format https://www.youtube.com/watch?v=VIDEO_ID
        const videoID = new URL(url).searchParams.get("v");
        if (videoID == null)
            throw new Error("Invalid video URL");

        await this.youtube.videos.update({
            auth: this.auth,
            part: ["snippet"],
            requestBody: {
                id: videoID,
                snippet: {
                    description,
                },
            },
        });
    }

    async statusChange(url: string, privacyStatus: "public" | "private"): Promise<void> {
        if (this.auth == null || this.youtube == null || !this.hasAccessToken)
            throw new Error("YouTube client not initialized");

        // Should be a link of the format https://www.youtube.com/watch?v=VIDEO_ID
        const videoID = new URL(url).searchParams.get("v");
        if (videoID == null)
            throw new Error("Invalid video URL");

        await this.youtube.videos.update({
            auth: this.auth,
            part: ["status"],
            requestBody: {
                id: videoID,
                status: {
                    privacyStatus,
                },
            },
        });
    }
}

const youtubeClient = new YoutubeClient();
export default youtubeClient;
