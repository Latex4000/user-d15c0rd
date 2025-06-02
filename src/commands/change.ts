import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member, memberAliasToHostName, memberInfo } from "../types/member.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("change")
        .setDescription("Change your alias or site link in the webring")
        .addStringOption(option =>
            option
                .setName("alias")
                .setDescription("Your online alias for the webring")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("site")
                .setDescription("The URL of your site (include https://)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("color")
                .setDescription("Colour used to sign your posts created (hex code)")
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        let member: Member | undefined = undefined;
        try {
            const data: Member[] = await fetchHMAC(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
            if (data.length)
                member = data[0];
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the JSON data\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            console.error(e);
            return;
        }

        if (!member) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        const alias = interaction.options.getString("alias");
        let site = interaction.options.getString("site");
        let color = interaction.options.getString("color");

        const oldAlias = member.alias;

        // Check if the site URL is valid
        if (site)
            try {
                const url = new URL(site);

                if (url.protocol !== 'http:' && url.protocol !== 'https:') // Checks if URL is HTTP or HTTPS
                    throw new Error;
                if (!url.hostname.includes(".")) // Checks if URL contains at least one dot
                    throw new Error;
                if (url.hostname.split(".")[url.hostname.split(".").length - 1].length < 2) // Checks if TLD is at least 2 characters long
                    throw new Error;

                site = url.toString();
            } catch {
                await interaction.followUp({ content: "The site URL is invalid, make sure it starts with http:// or https:// and contains a TLD (e.g. `https://example.com`)", ephemeral: true });
                return;
            }

        // Check if the alias is alphanumeric
        if (alias && !/^[a-zA-Z0-9 ]+$/.test(alias)) {
            await interaction.followUp({ content: "The alias must be alphanumeric", ephemeral: true });
            return;
        }

        // Check if the color is a valid hex code
        if (color && !/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
            // Check if valid without #
            if (!/^([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/.test(color)) {
                await interaction.followUp({ content: "The color must be a valid hex code (e.g. `#FF0000`)", ephemeral: true });
                return;
            }
            color = "#" + color;
        }

        if (alias) member.alias = alias;
        if (site) member.site = site;
        if (color) member.color = color;
        await fetchHMAC<Member[]>(siteUrl("/api/member"), "PUT", member)
            .then(async members => {
                const memberRes = members[0];
                if (!memberRes)
                    throw new Error("Member not found in response");

                if (!alias && !site) {
                    await interaction.followUp({ content: `You have updated your webring membership`, embeds: [memberInfo(memberRes)], ephemeral: true });
                    return;
                }

                try {
                    const oldAliasHostName = memberAliasToHostName(oldAlias);
                    const newAliasHostName = memberAliasToHostName(memberRes.alias);
                    if (!newAliasHostName) {
                        await interaction.followUp({ content: `You have updated your webring membership, but your alias is invalid for DNS records (bsky, site redirect)`, embeds: [memberInfo(memberRes)], ephemeral: true });
                        return;
                    }

                    let atprotoEnabled = false;

                    if (oldAliasHostName !== newAliasHostName) {
                        const did = await fetchHMAC<string | null>(siteUrl(`/api/atproto-dns`), "DELETE", {
                            subdomain: oldAliasHostName,
                        });

                        if (did != null) {
                            await fetchHMAC(siteUrl(`/api/atproto-dns`), "PUT", {
                                did,
                                subdomain: newAliasHostName,
                            });
                            atprotoEnabled = true;
                        }
                    }

                    await interaction.followUp({ content: `You have updated your webring membership and your DNS records (allow ~30 minutes for them to be accepted by the internet)\n${atprotoEnabled ? `Updated bsky handle to \`${newAliasHostName}.nonacademic.net\`\n` : ""}${site && member.addedRingToSite ? `Updated site redirect to \`${newAliasHostName}.nonacademic.net\`\n` : ""}`, embeds: [memberInfo(memberRes)], ephemeral: true });
                } catch (e) {
                    await interaction.editReply(`An error occurred while fetching the DNS data\n\`\`\`\n${e}\n\`\`\``);
                    console.error(e);
                    return;
                }
            })
            .catch(async (err) => await interaction.followUp({ content: "An error occurred while updating your webring membership\n\`\`\`\n" + err + "\n\`\`\`", ephemeral: true }));
    },
}

export default command;
