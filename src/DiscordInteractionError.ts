import { MessageFlags, type ChatInputCommandInteraction, type InteractionReplyOptions } from "discord.js";

export default class DiscordInteractionError extends Error {
    readonly #interactionReply: InteractionReplyOptions | string;

    constructor(message: InteractionReplyOptions | string) {
        super();

        if (typeof message === "string") {
            message = { content: message };
        }

        this.#interactionReply = { ...message, flags: MessageFlags.Ephemeral };

        Object.setPrototypeOf(this, DiscordInteractionError.prototype);
    }

    send(interaction: ChatInputCommandInteraction): Promise<unknown> {
        return interaction.deferred
            ? interaction.editReply(this.#interactionReply)
            : interaction.reply(this.#interactionReply);
    }
}
