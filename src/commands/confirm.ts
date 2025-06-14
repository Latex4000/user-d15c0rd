import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { fetchHMAC } from "../fetch.js";
import { Member, memberAliasToHostName, memberInfo } from "../types/member.js";
import config, { siteUrl } from "../config.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("confirm")
        .setDescription("Confirm webring membership after adding designated HTML to your site")
        .setContexts([
            InteractionContextType.Guild,
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const data: Member[] = await fetchHMAC(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
        if (!data.length) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        const member = data[0];

        if (!member.site) {
            await interaction.followUp({ content: "You have not added your site URL. Run `/change` to add your site URL", ephemeral: true });
            return;
        }

        if (member.addedRingToSite) {
            await interaction.followUp({ content: "You have already confirmed your webring membership", ephemeral: true });
            return;
        }

        member.addedRingToSite = true;

        await fetchHMAC<Member[]>(siteUrl("/api/member"), "PUT", member)
            .then(async members => {
                const memberRes = members[0];
                if (!memberRes)
                    throw new Error("Member not found in response");

                let err: unknown | undefined = undefined;
                try {
                    const aliasHostName = memberAliasToHostName(memberRes.alias);
                    if (!aliasHostName) {
                        await interaction.followUp({ content: `You have confirmed your webring membership, but your alias is invalid for DNS records (no redirect is set from \`YOURUSERNAME.nonacademic.net\` to ${member.site!})`, embeds: [memberInfo(memberRes)], ephemeral: true });
                        return;
                    }
                } catch (e) {
                    console.error(e);
                    err = e;
                }

                await interaction.followUp({ content: `You have confirmed your webring membership ${!err ? `and added the redirect from \`${memberAliasToHostName(memberRes.alias)}.nonacademic.net\` to ${member.site!}\nallow ~30 minutes for the redirect to be accepted by the internet` : `but an error occurred while adding the redirect to DNS records <@${config.discord.owner_id}>\n\`\`\`\n${err}\n\`\`\``}`, embeds: [memberInfo(memberRes)], ephemeral: true });
            });
    },
}

export default command;
