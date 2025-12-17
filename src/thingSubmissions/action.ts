import Parser from "rss-parser";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import type { Action } from "../types/action.js";
import { postToFeed } from "../discordFeed.js";

const parser = new Parser();

export interface ActionSubmissionRequest {
    memberDiscord: string;
    link: string;
    isRSS: boolean;
    title?: string | null;
    description?: string | null;
}

export interface ActionSubmissionResponse {
    action: Action;
    feedTitle?: string | null;
}

function ensureUrl(link: string): URL {
    try {
        return new URL(link);
    } catch {
        throw new Error("Invalid URL provided");
    }
}

export async function submitAction(request: ActionSubmissionRequest): Promise<ActionSubmissionResponse> {
    const link = ensureUrl(request.link).toString();
    let title = request.title?.trim() ?? "";
    let description = request.description?.trim() ?? "";
    let feedTitle: string | undefined;

    if (!request.isRSS) {
        if (!title || !description)
            throw new Error("Title and description are required for non-RSS/Atom feeds");
    } else {
        const feed = await parser.parseURL(link).catch((error: unknown) => {
            if (error instanceof Error)
                throw new Error(`Could not reach/parse RSS/Atom feed\n${error.message}`);
            throw new Error("Invalid RSS/Atom feed");
        });

        if (!feed.link || !feed.items)
            throw new Error("Invalid RSS/Atom feed (missing link or items)");

        if (feed.items.length && !feed.items[0]?.link)
            throw new Error("Invalid RSS/Atom feed items (missing title or link)");

        if ((!feed.title && !title) || (!feed.description && !description)) {
            const missingTitle = !feed.title && !title;
            const missingDescription = !feed.description && !description;
            const messageParts = [] as string[];
            if (missingTitle)
                messageParts.push("title");
            if (missingDescription)
                messageParts.push("description");
            throw new Error(`RSS/Atom feed missing ${messageParts.join(" and ")}. Provide custom metadata and try again.`);
        }

        if (feed.title)
            feedTitle = feed.title;

        if (!title)
            title = feed.title ?? "";
        if (!description)
            description = feed.description ?? "";
    }

    if (!title || !description)
        throw new Error("Title and description are required");

    const action = await fetchHMAC<Action>(siteUrl("/api/actions"), "POST", {
        url: link,
        siteUrl: link,
        memberDiscord: request.memberDiscord,
        title,
        description,
        isRSS: request.isRSS,
    });

    await postToFeed(
        `<@${request.memberDiscord}> added an action\nTitle: ${action.title}\nLink: ${action.siteUrl}`,
    );

    return { action, feedTitle: request.isRSS ? feedTitle ?? null : null };
}
