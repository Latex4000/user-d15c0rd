import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import confirm from "../confirm.js";
import { respond } from "../index.js";
import { submitSight } from "../thingSubmissions/sight.js";
import { createWorkDir, cleanupWorkDir, downloadAttachmentToLocalFile } from "../commandUploads.js";

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
                .setName("hide_colour")
                .setDescription("Hide your colour on the site for this sight")
                .setRequired(false),
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
        const tagsString = interaction.options.getString("tags") ?? "";
        const tags = tagsString.length === 0 ? [] : tagsString.split(",").map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        const pixelated = interaction.options.getBoolean("is_pixel_art") ?? false;
        const hideColour = interaction.options.getBoolean("hide_colour") ?? false;

        // Check for missing required options
        if (!images || !title || !description) {
            await respond(interaction, { content: "You must provide at least images, a title, and a description", ephemeral: true });
            return;
        }

        const infoConfirmed = await confirm(interaction, `Title: ${title}\nDescription: ${description}\nTags: ${tags.length > 0 ? tags.join(", ") : "N/A"}\n\nIs all of your information correct?`);
        if (!infoConfirmed)
            return;

        const ownWork = await confirm(interaction, "This is for content that you made yourself\nIs this your own work?");
        if (!ownWork)
            return;

        let workDir: string | null = null;
        try {
            workDir = await createWorkDir("sight");
            const assetFile = await downloadAttachmentToLocalFile(images, workDir, "assets");

            const result = await submitSight({
                memberDiscord: interaction.user.id,
                title,
                description,
                tags,
                pixelated,
                showColour: !hideColour,
                confirmInformation: infoConfirmed,
                confirmOwnWork: true,
                assets: [assetFile],
            });

            await respond(interaction, {
                content: `Image(s) uploaded successfully. Check ${result.sight.title} on the site soon!`,
            });
        } catch (error) {
            const message = error instanceof Error ? error.message : "Unknown error";
            await respond(interaction, {
                content: `Failed to upload sight:\n\`\`\`\n${message}\n\`\`\``,
                ephemeral: true,
            });
        } finally {
            if (workDir)
                await cleanupWorkDir(workDir);
        }
    },
}

export default command;
