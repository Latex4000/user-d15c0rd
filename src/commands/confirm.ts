import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import * as config from "../../config.json";
import { fetchHMAC } from "../fetch";
import { Member } from "../types/member";

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

        if (data[i].addedRingToSite) {
            await interaction.followUp({ content: "You have already confirmed your webring membership", ephemeral: true });
            return;
        }

        data[i].addedRingToSite = true;

        await fetchHMAC(config.collective.site_url + "/api/member", "PUT", data[i])
            .then(async () => await interaction.followUp({ content: "You have confirmed your webring membership" }))
            .catch(async (err) => await interaction.followUp({ content: "An error occurred while confirming your webring membership\n\`\`\`\n" + err + "\n\`\`\`", ephemeral: true }));
    },
}

export default command;