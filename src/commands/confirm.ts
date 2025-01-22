import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import config from "../../config.json" with { type: "json" };
import { fetchHMAC } from "../fetch.js";
import { Member, memberInfo } from "../types/member.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("confirm")
        .setDescription("Confirm webring membership after adding designated HTML to your site")
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        // Get JSON Data
        let data: Member[] = [];
        try {
            data = await fetchHMAC(`${config.collective.site_url}/api/members.json`, "GET");
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the JSON data\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            console.error(e);
            return;
        }

        const i = data.findIndex(member => member.discord === interaction.user.id);
        if (i === -1) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        if (!data[i].site) {
            await interaction.followUp({ content: "You have not added your site URL. Run `/change` to add your site URL", ephemeral: true });
            return;
        }

        if (data[i].addedRingToSite) {
            await interaction.followUp({ content: "You have already confirmed your webring membership", ephemeral: true });
            return;
        }

        data[i].addedRingToSite = true;

        await fetchHMAC(config.collective.site_url + "/api/member", "PUT", data[i])
            .then(async (members: Member[]) => {
                const member = members[0];
                if (!member)
                    throw new Error("Member not found in response");
                await interaction.followUp({ content: `You have confirmed your webring membership`, embeds: [memberInfo(member)], ephemeral: true });
            })
            .catch(async (err) => await interaction.followUp({ content: "An error occurred while confirming your webring membership\n\`\`\`\n" + err + "\n\`\`\`", ephemeral: true }));
    },
}

export default command;