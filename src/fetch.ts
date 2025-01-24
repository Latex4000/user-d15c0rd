import { fetchWithHmac } from "@latex4000/fetch-hmac";
import config from "./config.js";

export function fetchHMAC<T> (url: string | URL | globalThis.Request, method: string = "POST", data?: any) {
    const body: string | FormData | undefined = data ? data instanceof FormData ? data : JSON.stringify(data) : undefined;
    const headers: Record<string, string> = {};
    if (!(body instanceof FormData))
        headers["Content-Type"] = "application/json";
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