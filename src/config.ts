import config from "../config.json" with { type: "json" };
import type exampleConfig from "../config.example.json";

// Test if config matches the shape of the config example at compile time
const _invalidConfigError: typeof exampleConfig = config;

if (process.env.NODE_ENV === "development") {
	const devConfig = {
		secret_hmac: "dev",
		collective: {
			name: "Latex 4000 (dev)",
			name_condensed: "latex4000Dev",
			site_url: "http://localhost:4321"
		},
	};

	Object.assign(config, devConfig);
}

if (
	!config.secret_hmac ||
	!config.collective.name ||
	!config.collective.name_condensed ||
	!URL.canParse(config.collective.site_url) ||
	!config.discord.client_id ||
	!config.discord.token ||
	!config.discord.owner_id ||
	!config.discord.feed_channel_id ||
	!config.discord.collective_channel_id ||
	!Array.isArray(config.discord.admin_ids) ||
	config.discord.admin_ids.some((id) => !id) ||
	!config.discord.guild_id
) {
	console.error("Invalid required config (secret_hmac, collective, discord)");
	process.exit(1);
}

export const canUseSoundcloud = Boolean(config.soundcloud.client_id);
export const canUseYoutube = Boolean(config.youtube.client_id);

if (!canUseSoundcloud) {
	console.error("SoundCloud client not provided, tracks will not be uploaded");
}

if (!canUseYoutube) {
	console.error("YouTube client not provided, videos will not be uploaded");
}

export function siteUrl(url: string | { toString: () => string }): URL {
	return new URL(url, config.collective.site_url);
}

export default config;
