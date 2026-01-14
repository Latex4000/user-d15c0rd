import { fetchWithHmac } from "@latex4000/fetch-hmac";
import config from "./config.js";

export async function fetchHMAC<T>(url: string | URL | globalThis.Request, method: string = "POST", data?: any) {
    let body: string | Uint8Array | undefined = undefined;
    const headers: Record<string, string> = {};

    // Handles no re-use of Request objects
    if (data instanceof FormData) {
        const formResponse = new Response(data);

        const arrayBuffer = await formResponse.arrayBuffer();
        body = new Uint8Array(arrayBuffer);
        const contentType = formResponse.headers.get("content-type");
        if (contentType)
            headers["Content-Type"] = contentType;
    } else if (data != null) {
        body = JSON.stringify(data);
        headers["Content-Type"] = "application/json";
    }

    return fetchWithHmac(config.secret_hmac, url, {
        method,
        headers,
        body
    })
        .then(async res => {
            if (res.ok)
                return res.json() as Promise<T>;
            throw new Error(`HTTP Error: ${res.status} ${res.statusText}\n${await (res.json() as Promise<{ error: string }>).then(data => data.error).catch(() => "")}`);
        });
}