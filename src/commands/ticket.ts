import { InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { siteUrl } from "../config.js";
import { fetchHMAC } from "../fetch.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("ticket")
        .setDescription("Get a ticket to sign on to corporate")
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel,
        ]),
    run: async (interaction) => {
        await interaction.deferReply({ flags: MessageFlags.Ephemeral });

        const ticket = await fetchHMAC<string>(siteUrl("/api/corporate-ticket"), "POST", {
            memberDiscord: interaction.user.id,
        });

        await interaction.editReply(`The following ticket can be used to sign on to [corporate](https://corp.nonacademic.net/sso/begin):\n\n\`\`\`\n${ticket}\n\`\`\`\n\nThe ticket will expire in one minute.`);
    },
}

export default command;
