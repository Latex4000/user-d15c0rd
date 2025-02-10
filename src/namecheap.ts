import { Parser } from "xml2js";
import config from "./config.js";

interface HostRecord {
    HostName: string;       // e.g. "@" or "www" or "_atproto.username"
    RecordType: string;     // e.g. "A", "TXT", ...
    Address: string;        // e.g. "1.2.3.4" or "did=..."
    TTL?: number;
}

export const memberAliasToHostName = (alias: string) => alias
    .toLowerCase()
    .replace(/[^a-z0-9-_]/g, "")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

export async function getHosts(): Promise<HostRecord[]> {
    const url = new URL("https://api.namecheap.com/xml.response");
    url.searchParams.append("ApiUser", config.namecheap.username);
    url.searchParams.append("ApiKey", config.namecheap.key);
    url.searchParams.append("UserName", config.namecheap.username);
    url.searchParams.append("Command", "namecheap.domains.dns.getHosts");
    url.searchParams.append("ClientIp", config.namecheap.client_ip);
    url.searchParams.append("SLD", config.namecheap.sld);
    url.searchParams.append("TLD", config.namecheap.tld);

    const response = await fetch(url.toString());
    const text = await response.text();

    const parser = new Parser();
    const data = await parser.parseStringPromise(text);
    const rawHostsData = data["ApiResponse"]["CommandResponse"][0]["DomainDNSGetHostsResult"][0]["host"];
    return rawHostsData.map((host: any) => ({
        HostName: host["$"]["Name"],
        RecordType: host["$"]["Type"],
        Address: host["$"]["Address"],
        TTL: host["$"]["TTL"],
    }));
}

export function addAtprotoRecord (existingHosts: HostRecord[], subdomain: string, did: string) {
    const recordName = `_atproto.${subdomain}`;
    const recordType = "TXT";
    const i = existingHosts.findIndex(record => record.HostName === recordName && record.RecordType === recordType);
    if (i === -1)
        existingHosts.push({
            HostName: recordName,
            RecordType: recordType,
            Address: `did=${did}`,
            TTL: 1799,
        });
    else
        existingHosts[i].Address = `did=${did}`;

    return existingHosts;
}

export function addRedirectRecord (existingHosts: HostRecord[], username: string, site: string) {
    const recordName = username;
    const recordType = "URL";
    const i = existingHosts.findIndex(record => record.HostName === recordName && record.RecordType === recordType);
    if (i === -1)
        existingHosts.push({
            HostName: recordName,
            RecordType: recordType,
            Address: site,
            TTL: 1799,
        });
    else
        existingHosts[i].Address = site;

    return existingHosts;
}

export async function setHosts(hostRecords: HostRecord[]) {
    const url = "https://api.namecheap.com/xml.response";
    const params = new URLSearchParams();
    params.append("ApiUser", config.namecheap.username);
    params.append("ApiKey", config.namecheap.key);
    params.append("UserName", config.namecheap.username);
    params.append("Command", "namecheap.domains.dns.setHosts");
    params.append("ClientIp", config.namecheap.client_ip);
    params.append("SLD", config.namecheap.sld);
    params.append("TLD", config.namecheap.tld);
    hostRecords.forEach((record, i) => {
        params.append(`HostName${i + 1}`, record.HostName);
        params.append(`RecordType${i + 1}`, record.RecordType);
        params.append(`Address${i + 1}`, record.Address);
        if (record.TTL)
            params.append(`TTL${i + 1}`, record.TTL.toString());
    });

    const response = await fetch(url, {
        method: "POST",
        headers: {
            "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params,
    });

    const text = await response.text();
    const parser = new Parser();
    const data = await parser.parseStringPromise(text);
    const responeStatus = data["ApiResponse"]["$"]["Status"];
    if (responeStatus === "ERROR")
        throw new Error(data["ApiResponse"]["Errors"][0]["Error"][0]["$"]["Number"] + ": " + data["ApiResponse"]["Errors"][0]["Error"][0]["_"]);

    return data;
}