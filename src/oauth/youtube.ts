import { Auth, google, youtube_v3 } from "googleapis";
import config from "../../config.json" with { type: "json" };
import { createReadStream } from "node:fs";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";

class YoutubeClient {
    hasAccessToken: boolean = false;

    private auth: Auth.OAuth2Client | undefined;
    private youtube: youtube_v3.Youtube | undefined;

    async initialize(): Promise<boolean | undefined> {
        if (!config.youtube.client_id)
            return;

        this.auth = new google.auth.OAuth2(config.youtube.client_id, config.youtube.client_secret, config.youtube.redirect_uris[0]);
        this.youtube = google.youtube("v3");

        try {
            const tokenFile = await readFile("ytToken.json", "utf-8");
            const token = JSON.parse(tokenFile);
            this.auth.setCredentials(token);
            return this.hasAccessToken = true;
        } catch {
            return false;
        }
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
                const url = new URL(req.url ?? "/");
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
            scope: ["https://www.googleapis.com/auth/youtube.upload"],
        });
        await _sendMessageToOwner(`Click here to authenticate with YouTube: ${url}`);

        try {
            const code = await codePromise;
            const { tokens } = await this.auth.getToken(code);

            this.auth.setCredentials(tokens);
            await writeFile("ytToken.json", JSON.stringify(tokens));
            this.hasAccessToken = true;
        } catch (error) {
            await _sendMessageToOwner("Failed to get token for YouTube");
            throw error;
        }
    }

    async upload(title: string, description: string, tags: string[], videoPath: string): Promise<youtube_v3.Schema$Video> {
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
                },
            },
            media: {
                body: createReadStream(videoPath),
            },
        });
        return res.data;
    }
}

const youtubeClient = new YoutubeClient();
export default youtubeClient;
