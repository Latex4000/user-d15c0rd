import { readFile, writeFile } from "node:fs/promises";
import { createReadStream, openAsBlob } from "node:fs";
import config from "../config.js";

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
    formData.set("track[title]", title);
    formData.set("track[sharing]", "public");
    formData.set("track[description]", description);
    formData.set("track[tags]", tags.join(" "));
    formData.set("track[asset_data]", await openAsBlob(audioPath));
    formData.set("track[artwork_data]", await openAsBlob(imagePath));

    const res: { id: number; permalink_url: string } = await fetch("https://api.soundcloud.com/tracks", {
        method: "POST",
        headers: {
            "Authorization": `OAuth ${await getSoundcloudAccessToken()}`,
        },
        body: formData,
    }).then(res => res.json() as Promise<{ id: number; permalink_url: string }>);

    const permalinkUrl = new URL(res.permalink_url);
    permalinkUrl.search = "";
    permalinkUrl.hash = "";
    return `${permalinkUrl.toString()}?id=${res.id}`;
}

export async function changeStatusSoundcloud(url: string, sharing: "public" | "private") {
    const id = new URL(url).searchParams.get("id");
    if (!id)
        throw new Error("Invalid Soundcloud URL");

    await fetch(`https://api.soundcloud.com/tracks/${id}`, {
        method: "PUT",
        headers: {
            "Authorization": `OAuth ${await getSoundcloudAccessToken()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ track: { sharing } })
    });
}

export async function changeSoundcloudDescription(url: string, description: string) {
    const id = new URL(url).searchParams.get("id");
    if (!id)
        throw new Error("Invalid Soundcloud URL");

    await fetch(`https://api.soundcloud.com/tracks/${id}`, {
        method: "PUT",
        headers: {
            "Authorization": `OAuth ${await getSoundcloudAccessToken()}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ track: { description } })
    });
}