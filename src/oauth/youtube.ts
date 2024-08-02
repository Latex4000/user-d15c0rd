import { google } from "googleapis";
import { IttyRouter } from "itty-router"
import config from "../../config.json";
import { createReadStream } from "node:fs";

const auth = new google.auth.OAuth2(config.youtube.client_id, config.youtube.client_secret, config.youtube.redirect_uris[0]);
const youtube = google.youtube("v3");

// Callback server
const port = parseInt(config.youtube.redirect_uris[0].split(":")[2].split("/")[0]) || 8000;
const router = IttyRouter({ port });
router.get("/", async ({ query }) => {
    const code = query.code;
    if (!code)
        return new Response("No code provided", { status: 400 });

    const { tokens } = await auth.getToken(typeof code === "string" ? code : code[0]);
    auth.setCredentials(tokens);
    try {
        await Bun.write("token.json", JSON.stringify(tokens));
    } catch (err) {
        if (err) {
            console.error(err);
            return new Response("Failed to write token to file", { status: 500 });
        }
    }
    uploadYoutube("Test", "Test", [], "test.mp4");
    return new Response("Successfully authenticated");
});
router.all("*", () => new Response("Not found", { status: 404 }));

export async function getYoutubeAccessToken() {
    const tokenFile = Bun.file("token.json");
    if (await tokenFile.exists()) {
        const token = JSON.parse(await tokenFile.text());
        auth.setCredentials(token);
        return;
    }

    const authUrl = auth.generateAuthUrl({
        access_type: "offline",
        scope: ["https://www.googleapis.com/auth/youtube.upload"],
    });
    return authUrl;
}

export async function uploadYoutube(title: string, description: string, tags: string[], videoPath: string) {
    if (await Bun.file(videoPath).exists() === false)
        throw "Video file does not exist";

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

Bun.serve({
    fetch: router.fetch,
    port,
});

// getYoutubeAccessToken()
//     .then((url) => {
//         if (url)
//             console.log(`Click here to authenticate with youtube: ${url}`);
//         else
//             uploadYoutube("Test", "Test", [], "test.mp4")
//                 .then(console.log)
//                 .catch(console.error);
//     })
//     .catch(console.error);