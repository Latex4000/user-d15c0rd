import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { fetchHMAC } from "../fetch.js";
import { Member, memberAliasToHostName, memberInfo } from "../types/member.js";
import config, { siteUrl } from "../config.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("unconfirm")
        .setDescription("Unconfirm someone's webring membership")
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(0)
        .addUserOption(option =>
            option
                .setName("user")
                .setDescription("The user to unconfirm the site for")
                .setRequired(true)
        ),
    run: async (interaction: ChatInputCommandInteraction) => {
        if (!config.discord.admin_ids.includes(interaction.user.id)) {
            await interaction.reply({
                content: "This command can only be used by admins",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }
        await interaction.deferReply();

        const targetUser = interaction.options.getUser("user", true);

        const data: Member[] = await fetchHMAC(siteUrl(`/api/member?id=${targetUser.id}`), "GET");
        if (!data.length) {
            await interaction.followUp({ content: "They are not in the webring.", ephemeral: true });
            return;
        }

        const member = data[0];

        if (!member.site) {
            await interaction.followUp({ content: "They have not added their site URL.", ephemeral: true });
            return;
        }

        if (!member.addedRingToSite) {
            await interaction.followUp({ content: "They have not confirmed their webring membership", ephemeral: true });
            return;
        }

        member.addedRingToSite = false;

        await fetchHMAC<Member[]>(siteUrl("/api/member"), "PUT", member)
            .then(async members => {
                const memberRes = members[0];
                if (!memberRes)
                    throw new Error("Member not found in response");

                await interaction.followUp({ content: `You have unconfirmed webring membership for them.`, embeds: [memberInfo(memberRes)], ephemeral: true });
            });
    },
}

export default command;
