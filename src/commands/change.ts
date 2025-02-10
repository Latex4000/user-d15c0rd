import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member, memberInfo } from "../types/member.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import { addRedirectRecord, getHosts, memberAliasToHostName, setHosts } from "../namecheap.js";

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
        .setDMPermission(false),
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
                    let hosts = await getHosts();

                    const oldAliasHostName = memberAliasToHostName(oldAlias);
                    const newAliasHostName = memberAliasToHostName(memberRes.alias);
                    if (!newAliasHostName) {
                        await interaction.followUp({ content: `You have updated your webring membership, but your alias is invalid for DNS records (bsky, site redirect)`, embeds: [memberInfo(memberRes)], ephemeral: true });
                        return;
                    }

                    // See if theres an atproto TXT record and if there's a redirect record
                    const atprotoIndex = hosts.findIndex(record => record.HostName === `_atproto.${oldAliasHostName}` && record.RecordType === "TXT");
                    const redirectIndex = hosts.findIndex(record => record.HostName === oldAliasHostName && record.RecordType === "URL");

                    // If the alias has changed, update the TXT record
                    if (atprotoIndex !== -1)
                        hosts[atprotoIndex].HostName = `_atproto.${newAliasHostName}`;

                    if (redirectIndex !== -1) {
                        hosts[redirectIndex].HostName = newAliasHostName;
                        hosts[redirectIndex].Address = member.site!;
                    } else if (member.site && member.addedRingToSite)
                        hosts = addRedirectRecord(hosts, newAliasHostName, member.site);

                    console.log(atprotoIndex, redirectIndex, site && member.addedRingToSite, hosts);

                    await setHosts(hosts);

                    await interaction.followUp({ content: `You have updated your webring membership and your DNS records (allow ~30 minutes for them to be accepted by the internet)\n${atprotoIndex !== -1 ? `Updated ${oldAliasHostName}.nonacademic.net to ${newAliasHostName}.nonacademic.net for bsky\n` : ""}${redirectIndex !== -1 ? `Updated ${oldAliasHostName}.nonacademic.net to ${newAliasHostName}.nonacademic.net for your site redirect\n` : site && member.addedRingToSite ? `Added ${newAliasHostName}.nonacademic.net for your site redirect\n` : ""}`, embeds: [memberInfo(memberRes)], ephemeral: true });
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