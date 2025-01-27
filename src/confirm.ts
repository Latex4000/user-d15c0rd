import { randomUUID } from "crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, MessageComponentInteraction } from "discord.js";

export default async function confirm(interaction: ChatInputCommandInteraction, content: string) {
    if (!interaction.channel?.isSendable()) {
        await interaction.reply({ content: "I cannot send messages in that channel", ephemeral: true });
        return false;
    }

    const ids = {
        yes: randomUUID(),
        no: randomUUID(),
    };
    const update = await interaction.channel.send({
        content,
        components: [
            new ActionRowBuilder<ButtonBuilder>()
                .addComponents(
                    new ButtonBuilder()
                        .setCustomId(ids.yes)
                        .setLabel("Yes")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(ids.no)
                        .setLabel("No")
                        .setStyle(ButtonStyle.Danger)
                )
        ]
    });

    return new Promise<boolean>(resolve => {
        const filter = (i: MessageComponentInteraction) => i.user.id === interaction.user.id;
        const confirmationCollector = update.createMessageComponentCollector({ filter, time: 60000 });
        let timeout = true;
        confirmationCollector.on("collect", async i => {
            if (i.customId === ids.yes) {
                timeout = false;
                await update.delete();
                confirmationCollector.stop();
                resolve(true);
            } else if (i.customId === ids.no) {
                timeout = false;
                await update.delete();
                confirmationCollector.stop();
                await interaction.followUp({ content: "Cancelled", ephemeral: true });
                resolve(false);
            }
        });
        confirmationCollector.on("end", async () => {
            if (timeout) {
                await interaction.followUp({ content: "You took too long to respond", ephemeral: true });
                resolve(false);
            }
        });
    });
}