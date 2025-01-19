import * as config from "../config.json";
import crypto from "crypto";

export function fetchHMAC (url: string | URL | globalThis.Request, method: string = "POST", body: any) {
    const req = JSON.stringify(body);
    const timestamp = Date.now().toString();
    const hmac = crypto.createHmac("sha256", config.secret_hmac).update(`${timestamp}.${req}`).digest("hex");
    return fetch(url, {
        method,
        headers: {
            "Content-Type": "application/json",
            "X-Signature": hmac,
            "X-Timestamp": timestamp
        },
        body: req
    });
}