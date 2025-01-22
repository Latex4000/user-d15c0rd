import { fetchWithHmac } from "@latex4000/fetch-hmac";
import * as config from "../config.json";

export function fetchHMAC (url: string | URL | globalThis.Request, method: string = "POST", data?: any) {
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
                return res.json();
            throw new Error(`HTTP Error: ${res.status} ${res.statusText}\n${await res.json().then(data => data.error).catch(() => "")}`);
        });
}