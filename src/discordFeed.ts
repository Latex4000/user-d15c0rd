import config from "./config.js";
import { discordClient, discordDisabled } from "./index.js";

export async function postToFeed(content: string): Promise<void> {
    if (discordDisabled) {
        console.info("Discord disabled; skipping feed post:", content);
        return;
    }

    try {
        const channel = await discordClient.channels.fetch(config.discord.feed_channel_id);
        if (!channel || !channel.isSendable())
            throw new Error("Feed channel is not sendable");
        await channel.send({ content });
    } catch (error) {
        console.error("Failed to post to feed channel", error);
    }
}