import * as config from "../config.json";
import crypto from "crypto";

export function fetchHMAC (url: string | URL | globalThis.Request, method: string = "POST", data?: any) {
    const body: string | FormData | undefined = data ? data instanceof FormData ? data : JSON.stringify(data) : undefined;
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac("sha256", config.secret_hmac).update(`${timestamp}.${body ? body instanceof FormData ? body.get("title") : body : ""}`).digest("hex");
    return fetch(url, {
        method,
        headers: {
            "Content-Type": body instanceof FormData ? "multipart/form-data" : "application/json",
            "X-Signature": hmac,
            "X-Timestamp": timestamp
        },
        body
    })
        .then(async res => {
            if (res.ok)
                return res.json();
            throw new Error(`HTTP Error: ${res.status} ${res.statusText}\n${await res.json().then(data => data.error).catch(() => "")}`);
        });
}