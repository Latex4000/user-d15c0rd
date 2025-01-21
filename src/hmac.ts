import * as config from "../config.json";
import crypto from "crypto";

export function fetchHMAC (url: string | URL | globalThis.Request, method: string = "POST", data?: any) {
    const body: string | undefined = data ? JSON.stringify(data) : undefined;
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac("sha256", config.secret_hmac).update(body ? `${timestamp}.${body}` : timestamp).digest("hex");
    return fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
            "X-Signature": hmac,
            "X-Timestamp": timestamp
        },
        body
    });
}