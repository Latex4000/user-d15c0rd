import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import { ThingType, Things } from "../types/thing.js";
import { choose } from "../choose.js";
import { changeStatusSoundcloud } from "../oauth/soundcloud.js";
import youtubeClient from "../oauth/youtube.js";
import confirm from "../confirm.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("delete")
        .setDescription("Delete a thing u created from the webring")
        .addStringOption(option =>
            option
                .setName("thing_type")
                .setDescription("The type of thing u want to delete")
                .addChoices(Things.map(type => ({ name: type, value: type })))
                .setRequired(true)
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const thingType = interaction.options.getString("thing_type")! as ThingType;
        const thing = await choose(interaction, thingType, false);
        if (!thing)
            return;

        const confirmation = await confirm(interaction, `Are you sure you want to delete the ${thingType} \`${thing.title}\`?`);
        if (!confirmation)
            return;

        try {
            await fetchHMAC(siteUrl(`/api/${thingType}?discord=${interaction.user.id}&id=${thing.id}`), "DELETE");
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while deleting the ${thingType}\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            return;
        }

        // Based on thingType, decide the functionality to perform in other places (yt/sc etc) it's a switch block cuz it shouldn't be too massive for each case
        switch (thingType) {
            case "actions":
            case "words":
                break;
            case "sounds":
                if (!("soundcloudUrl" in thing) || !("youtubeUrl" in thing) || typeof thing.soundcloudUrl !== "string" || typeof thing.youtubeUrl !== "string") {
                    await interaction.followUp({ content: `The ${thingType} \`${thing.title}\` has been removed, but it was not found on SoundCloud/YouTube. If wanted, you can restore it with \/restore` });
                    return;
                }
                await changeStatusSoundcloud(thing.soundcloudUrl, "private");
                await youtubeClient.statusChange(thing.youtubeUrl, "private");
                break;
            case "motions":
                if (!("youtubeUrl" in thing) || typeof thing.youtubeUrl !== "string") {
                    await interaction.followUp({ content: `The ${thingType} \`${thing.title}\` has been removed, but it was not found on YouTube. If wanted, you can restore it with \/restore` });
                    return;
                }
                await youtubeClient.statusChange(thing.youtubeUrl, "private");
                break;
        }

        await interaction.followUp({ content: `The ${thingType} \`${thing.title}\` has been removed. If wanted, you can restore it with \/restore` });
    },
}

export default command;