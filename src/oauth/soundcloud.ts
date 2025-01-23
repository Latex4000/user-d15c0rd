import { readFile, writeFile } from "node:fs/promises";
import config from "../../config.json" with { type: "json" };
import { createReadStream } from "node:fs";

if (!config.soundcloud.client_id) {
    console.error("SoundCloud client not provided, tracks will not be uploaded");
}

interface SoundcloudToken {
    access_token: string;
    token_type: string;
    expires_in: number;
    refresh_token: string;
    last_updated: number;
}

type RefreshTokenResponse = Omit<SoundcloudToken, "last_updated">;

async function getSoundcloudAccessToken() {
    const tokenFile = await readFile("scToken.json", "utf-8");
    let token: SoundcloudToken = JSON.parse(tokenFile);
    const lastUpdated = new Date(token.last_updated || 0);
    if (lastUpdated.getTime() + (token.expires_in || 0) * 1000 < Date.now()) {
        // Refresh token
        const res: RefreshTokenResponse = await fetch("https://secure.soundcloud.com/oauth/token", {
            method: "POST",
            headers: {
                "Accept": "application/json; charset=utf-8",
                "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
                grant_type: "refresh_token",
                client_id: config.soundcloud.client_id,
                client_secret: config.soundcloud.client_secret,
                refresh_token: token.refresh_token,
            }),
        }).then(res => res.json() as Promise<RefreshTokenResponse>);
        token = {
            ...token,
            ...res,
            last_updated: new Date().getTime(),
        };
        await writeFile("scToken.json", JSON.stringify(token));
    }
    return token.access_token;
}

export async function uploadSoundcloud(title: string, description: string, tags: string[], audioPath: string, imagePath: string) {
    const formData = new FormData();
    formData.append("track[title]", title);
    formData.append("track[sharing]", "public");
    formData.append("track[description]", description);
    formData.append("track[tags]", tags.join(" "));
    formData.append("track[asset_data]", new Blob([await readFile(audioPath)]));
    formData.append("track[artwork_data]", new Blob([await readFile(imagePath)]));

    const res: { permalink_url: string } = await fetch("https://api.soundcloud.com/tracks", {
        method: "POST",
        headers: {
            "Authorization": `OAuth ${await getSoundcloudAccessToken()}`,
        },
        body: formData,
    }).then(res => res.json() as Promise<{ permalink_url: string }>);

    return res.permalink_url;
}
