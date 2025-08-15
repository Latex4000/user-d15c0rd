import { randomUUID } from "crypto";
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, ChatInputCommandInteraction, Interaction, MessageFlags, StringSelectMenuBuilder, StringSelectMenuInteraction } from "discord.js";
import { Thing, ThingType } from "./types/thing.js";
import { fetchHMAC } from "./fetch.js";
import { siteUrl } from "./config.js";

interface PaginatedResponse {
    things: Thing[];
    prevCursor: number | undefined
    nextCursor: number | undefined;
}

async function paginateFetch (interaction: ChatInputCommandInteraction, thingType: ThingType, discord: string, showDeleted: boolean, cursor?: number, direction: "prev" | "next" = "next") {
    let data: PaginatedResponse;
    try {
        data = await fetchHMAC(
            siteUrl(`/api/${thingType}?discord=${discord}&cursor=${cursor || "0"}&direction=${direction}&showDeleted=${showDeleted}`),
            "GET"
        );
    } catch (e) {
        await interaction.followUp({
            content: `Error fetching data: \n\`\`\`\n${e}\n\`\`\``,
            flags: MessageFlags.Ephemeral,
        });
        return {};
    }
    return { things: data.things, prevCursor: data.prevCursor, nextCursor: data.nextCursor };
}

function stringMenu (things: Thing[], thingType: ThingType, selectMenuID: string, placeholderText?: string) {
    return new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(selectMenuID)
            .setPlaceholder(placeholderText ?? `Choose a ${thingType} to delete`)
            .addOptions(
                things.map(thing => ({
                    label: thing.title.length > 100 ? thing.title.slice(0, 97) + "..." : thing.title,
                    value: thing.id.toString()
                }))
            )
    );
}

function buttons (disablePrev: boolean, disableNext: boolean) {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
            .setCustomId(`prev-${randomUUID()}`)
            .setLabel("Previous")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disablePrev),
        new ButtonBuilder()
            .setCustomId(`next-${randomUUID()}`)
            .setLabel("Next")
            .setStyle(ButtonStyle.Primary)
            .setDisabled(disableNext),
        new ButtonBuilder()
            .setCustomId(`cancel-${randomUUID()}`)
            .setLabel("Cancel")
            .setStyle(ButtonStyle.Danger)
    );
}

export async function choose(interaction: ChatInputCommandInteraction, thingType: ThingType, showDeleted: boolean, placeholderText?: string): Promise<Thing | null> {
    if (!interaction.channel?.isSendable()) {
        await interaction.reply({ content: "I cannot send messages in that channel", flags: MessageFlags.Ephemeral });
        return null;
    }

    let { things, prevCursor, nextCursor } = await paginateFetch(interaction, thingType, interaction.user.id, showDeleted);
    if (!things)
        return null;

    if (!things.length) {
        await interaction.followUp({
            content: `No ${thingType} found.`,
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    const firstThing = things[0];

    let selectMenuID = randomUUID();
    let menuRow = stringMenu(things, thingType, selectMenuID, placeholderText);
    let buttonRow = buttons(firstThing.id === prevCursor || !prevCursor, !nextCursor);

    const update = await interaction.followUp({
        content: `Showing up to 10 ${thingType}...`,
        components: [menuRow, buttonRow],
        flags: MessageFlags.Ephemeral,
    });

    return new Promise<Thing | null>(resolve => {
        const filter = (i: Interaction) => i.user.id === interaction.user.id;
        const collector = update.createMessageComponentCollector({ filter, time: 900000 });

        let timeout = true;

        collector.on("collect", async i => {
            if (i.customId === selectMenuID) {
                timeout = false;
                await update.delete();
                collector.stop();
                resolve(things?.find(t => t.id.toString() === (i as StringSelectMenuInteraction).values[0]) || null);
                return;
            } else if (i.isButton()) {
                // Prev/next/cancel button

                const [newDirection] = i.customId.split("-") as ["prev" | "next" | "cancel", string, string];
                if (newDirection === "cancel") {
                    timeout = false;
                    await update.delete();
                    collector.stop();
                    await interaction.followUp({ content: "Cancelled",flags: MessageFlags.Ephemeral });
                    resolve(null);
                    return;
                }

                if (newDirection !== "prev" && newDirection !== "next") {
                    await i.followUp({ content: "Invalid button", flags: MessageFlags.Ephemeral });
                    return;
                }

                const { things: newThings, prevCursor: newPrevCursor, nextCursor: newNextCursor } = await paginateFetch(interaction, thingType, i.user.id, showDeleted, newDirection === "prev" ? prevCursor : nextCursor, newDirection);
                if (!newThings) {
                    timeout = false;
                    await update.delete();
                    collector.stop();
                    resolve(null);
                    return;
                }

                if (!newThings.length) {
                    await i.followUp({ content: "No more things to show", flags: MessageFlags.Ephemeral });
                    return;
                }

                things = newThings;
                prevCursor = newPrevCursor;
                nextCursor = newNextCursor;

                selectMenuID = randomUUID();
                menuRow = stringMenu(things, thingType, selectMenuID, placeholderText);
                buttonRow = buttons(firstThing.id === prevCursor || !prevCursor, !nextCursor);

                await update.edit({
                    content: `Showing up to 10 ${thingType}...`,
                    components: [menuRow, buttonRow],
                });

                await i.reply({ content: "Updated", flags: MessageFlags.Ephemeral });
            }
        });

        collector.on("end", async () => {
            if (timeout) {
                await update.delete();
                await interaction.followUp({ content: "You took too long to respond. Cancelling.", flags: MessageFlags.Ephemeral });
                resolve(null);
            }
        });
    });
}

export async function simpleChoose(interaction: ChatInputCommandInteraction, items: string[], messageContent = "Choose an item:"): Promise<string | null> {
    if (!interaction.channel?.isSendable()) {
        await interaction.reply({ content: "I cannot send messages in that channel", flags: MessageFlags.Ephemeral });
        return null;
    }

    if (!items.length) {
        await interaction.followUp({
            content: "No items found.",
            flags: MessageFlags.Ephemeral,
        });
        return null;
    }

    const selectMenuID = randomUUID();
    const menuRow = new ActionRowBuilder<StringSelectMenuBuilder>().addComponents(
        new StringSelectMenuBuilder()
            .setCustomId(selectMenuID)
            .setPlaceholder("Choose an item")
            .addOptions(
                items.map((item, index) => ({
                    label: item.length > 100 ? item.slice(0, 97) + "..." : item,
                    value: index.toString()
                }))
            )
    );

    const update = await interaction.followUp({
        content: messageContent,
        components: [menuRow],
        flags: MessageFlags.Ephemeral,
    });

    return new Promise<string | null>(resolve => {
        const filter = (i: Interaction) => i.user.id === interaction.user.id;
        const collector = update.createMessageComponentCollector({ filter, time: 900000 });

        let timeout = true;

        collector.on("collect", async i => {
            if (i.customId === selectMenuID) {
                timeout = false;
                await update.delete();
                collector.stop();
                resolve(items[parseInt((i as StringSelectMenuInteraction).values[0])]);
                return;
            }
        });

        collector.on("end", async () => {
            if (timeout) {
                await update.delete();
                await interaction.followUp({ content: "You took too long to respond. Cancelling.", flags: MessageFlags.Ephemeral });
                resolve(null);
            }
        });
    });
} 