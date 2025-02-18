import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import AdmZip from "adm-zip";
import { fetchHMAC } from "../fetch.js";
import config, { siteUrl } from "../config.js";
import { discordClient } from "../index.js";
import confirm from "../confirm.js";
import { anonymousConfirmation } from "../anonymous.js";
import { Sight } from "../types/sight.js";

const fileSizeLimit = 2 ** 20; // 1 MB

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
                .setName("anonymous")
                .setDescription("Whether to post fully anonymously (no colour on site, no discord link, no name)")
                .setRequired(false)
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        
        const anonymous = interaction.options.getBoolean("anonymous") ?? false;
        const anonCheck = await anonymousConfirmation(interaction, anonymous);
        if (!anonCheck)
            return;

        const images = interaction.options.getAttachment("images");
        const title = interaction.options.getString("title");
        const description = interaction.options.getString("description");
        const tags = interaction.options.getString("tags");

        // Check for missing required options
        if (!images || !title || !description) {
            await interaction.followUp({ content: "You must provide at least images, a title, and a description", ephemeral: true });
            return;
        }

        // Check if the images file is a zip or an image
        if (images && !images.name.endsWith(".zip") && !images.name.endsWith(".png") && !images.name.endsWith(".jpg") && !images.name.endsWith(".jpeg") && !images.name.endsWith(".gif") && !images.name.endsWith(".webp")) {
            await interaction.followUp({ content: "The assets file must be a zip file", ephemeral: true });
            return;
        }

        const ownWork = await confirm(interaction, "This is for content that you made yourself\nIs this your own work?");
        if (!ownWork)
            return;

        const formData = new FormData();
        if (!anonymous)
            formData.set("discord", interaction.user.id);
        formData.set("title", title);
        formData.set("description", description);
        if (tags)
            formData.set("tags", tags);

        // Extract zip and append every single file data into "assets" form data key
        const files: Buffer[] = [];
        await fetch(images.url)
            .then(res => res.arrayBuffer())
            .then(async buffer => {
                if (images.name.endsWith(".png") || images.name.endsWith(".jpg") || images.name.endsWith(".jpeg") || images.name.endsWith(".gif") || images.name.endsWith(".webp")) {
                    const file = Buffer.from(buffer);
                    if (file.length > fileSizeLimit)
                        throw new Error(`File ${images.name} exceeds the size limit of 1 MB`);

                    files.push(file);
                    return;
                } else if (images.name.endsWith(".zip")) {
                    const zip = new AdmZip(Buffer.from(buffer));
                    const entries = zip.getEntries();

                    for (const entry of entries) {
                        if (entry.isDirectory)
                            throw new Error(`Zip file cannot contain directories. Please only include files, and reference them in the markdown file`);

                        const file = entry.getData();
                        if (file.length > fileSizeLimit)
                            throw new Error(`File ${entry.entryName} exceeds the size limit of 1 MB`);

                        files.push(file);
                    }
                }

                return;
            })
            .catch(async e => {
                await interaction.followUp({ content: `An error occurred while extracting the zip file\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
                return;
            });
        formData.set("assets", new Blob(files), images.name);
        console.log(formData);

        // Send form data to the server
        await fetchHMAC<Sight>(siteUrl("/api/sights"), "POST", formData)
            .then(async sight => {
                discordClient.channels.fetch(config.discord.feed)
                    .then(async channel => {
                        if (channel?.isSendable())
                            await channel.send({ content: `${anonymous ? "An anonymous user" : `<@${interaction.user.id}>`} uploaded a sight\n**Link:** ${config.collective.site_url}/sights/${Math.floor(new Date(sight.date).getTime() / 1000).toString(10)}` });
                        else
                            console.error("Failed to send message to feed channel: Channel is not sendable");
                    })
                    .catch(err => console.error("Failed to send message to feed channel", err));
                await interaction.followUp({ content: `Image(s) uploaded successfully\n**Link:** ${siteUrl(`/sights/${Math.floor(new Date(sight.date).getTime() / 1000).toString(10)}`)}` });
            })
            .catch(async e => {
                await interaction.followUp({ content: `An error occurred while uploading the post\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
                return;
            });
    },
}

export default command;
