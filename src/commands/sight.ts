import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import AdmZip from "adm-zip";
import { fetchHMAC } from "../fetch.js";
import config, { siteUrl } from "../config.js";
import { discordClient } from "../index.js";
import confirm from "../confirm.js";
import { Sight } from "../types/sight.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("sight")
        .setDescription("Upload images/an image u drew to the webring; all files have a 1 MB limit")
        .addAttachmentOption(option =>
            option
                .setName("images")
                .setDescription("The image(s) to upload (either a single image or a zip file)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("title")
                .setDescription("The title of the image(s)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("description")
                .setDescription("The description of the image(s)")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("tags")
                .setDescription("The tags of the image(s) (comma separated)")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("is_pixel_art")
                .setDescription("Is this pixel art? (default: false)")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("show_colour")
                .setDescription("Show your colour on site (default: true")
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const images = interaction.options.getAttachment("images");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const tags = interaction.options.getString("tags");
        const pixelated = interaction.options.getBoolean("is_pixel_art");
        const showColour = interaction.options.getBoolean("show_colour");

        // Check for missing required options
        if (!images || !title || !description) {
            await interaction.followUp({ content: "You must provide at least images, a title, and a description", ephemeral: true });
            return;
        }

        const ownWork = await confirm(interaction, "This is for content that you made yourself\nIs this your own work?");
        if (!ownWork)
            return;

        const formData = new FormData();
        formData.set("discord", interaction.user.id);
        formData.set("title", title);
        formData.set("description", description);
        formData.set("pixelated", pixelated ? true : false);
        formData.set("colour", showColour === false ? false : true);
        if (tags)
            formData.set("tags", tags);

        // Extract zip and append every single file data into "assets" form data key
        try {
            const buffer = await fetch(images.url)
                .then(res => res.arrayBuffer());

            // Try extracting as zip first, if it fails, assume it's a single image
            try {
                const zip = new AdmZip(Buffer.from(buffer));
                const entries = zip.getEntries();

                for (const entry of entries) {
                    if (entry.isDirectory)
                        throw new Error(`Zip file cannot contain directories. Please only include files, and reference them in the markdown file`);

                    const file = entry.getData();

                    formData.append("assets", new Blob([file]), entry.entryName);
                }
            } catch (e) {
                if (formData.has("assets"))
                    throw e;

                formData.append("assets", new Blob([buffer]), images.name);
            }
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while processing the assets\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            return;
        }

        if (!formData.has("assets")) {
            await interaction.followUp({ content: "No images found", ephemeral: true });
            return;
        }

        // Send form data to the server
        await fetchHMAC<Sight>(siteUrl("/api/sights"), "POST", formData)
            .then(async sight => {
                discordClient.channels.fetch(config.discord.feed_channel_id)
                    .then(async channel => {
                        if (channel?.isSendable())
                            await channel.send({ content: `<@${interaction.user.id}> uploaded a sight\n**Link:** ${config.collective.site_url}/sights` });
                        else
                            console.error("Failed to send message to feed channel: Channel is not sendable");
                    })
                    .catch(err => console.error("Failed to send message to feed channel", err));
                await interaction.followUp({ content: `Image(s) uploaded successfully\n**Link:** ${siteUrl(`/sights`)}` });
            })
            .catch(async e => {
                await interaction.followUp({ content: `An error occurred while uploading the post\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
                return;
            });
    },
}

export default command;
