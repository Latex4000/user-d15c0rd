import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import AdmZip from "adm-zip";
import { fetchHMAC } from "../fetch.js";
import { Word } from "../types/word.js";
import config, { siteUrl } from "../config.js";
import { discordClient } from "../index.js";
import confirm from "../confirm.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("word")
        .setDescription("Upload a writeup u made to the webring; all files have a 1 MB limit")
        .addAttachmentOption(option =>
            option
                .setName("md_txt_file")
                .setDescription("The md or txt file to upload")
                .setRequired(true)
        )
        .addStringOption(option =>
            option
                .setName("title")
                .setDescription("The title of the post")
                .setRequired(true)
        )
        .addAttachmentOption(option =>
            option
                .setName("assets")
                .setDescription("The assets (images etc) to upload (in a zip file)")
                .setRequired(false)
        )
        .addStringOption(option =>
            option
                .setName("tags")
                .setDescription("The tags of the post (comma separated)")
                .setRequired(false)
        )
        .addBooleanOption(option =>
            option
                .setName("hide_colour")
                .setDescription("Hide your colour on the site for this word")
                .setRequired(false),
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const attachment = interaction.options.getAttachment("md_txt_file");
        const assets = interaction.options.getAttachment("assets");

        const title = interaction.options.getString("title");
        const tags = interaction.options.getString("tags");
        const hideColour = interaction.options.getBoolean("hide_colour") ?? false;

        // Check for missing required options
        if (!attachment || !title) {
            await interaction.followUp({ content: "You must provide at least a post file and a title", ephemeral: true });
            return;
        }

        // Check if the file is a markdown or text file
        if (!attachment.name.endsWith(".md") && !attachment.name.endsWith(".txt")) {
            await interaction.followUp({ content: "The post file must be a markdown or text file", ephemeral: true });
            return;
        }

        // Get file content
        const content = await fetch(attachment.url).then(res => res.text());

        // Check if the assets file is a zip file
        if (assets && !assets.name.endsWith(".zip")) {
            await interaction.followUp({ content: "The assets file must be a zip file", ephemeral: true });
            return;
        }

        // If attachment is a txt file, do not allow assets
        if (attachment.name.endsWith(".txt") && assets) {
            await interaction.followUp({ content: "You cannot include assets with a `.txt` file.\nAssets are primarily only for markdown files for if you need to attach images to them.\nPlease remove the assets file and try again.", ephemeral: true });
            return;
        }

        const ownWork = await confirm(interaction, "This is for content that you made yourself\nIs this your own work?");
        if (!ownWork)
            return;

        const formData = new FormData();
        formData.set("discord", interaction.user.id);
        formData.set("title", title);
        formData.set("md", content);
        formData.set("colour", !hideColour);
        if (tags)
            formData.set("tags", tags);

        // Extract zip and append every single file data into "assets" form data key
        if (assets) {
            const buffer = await fetch(assets.url)
                .then(res => res.arrayBuffer());

            const zip = new AdmZip(Buffer.from(buffer));
            const entries = zip.getEntries();

            for (const entry of entries) {
                if (entry.isDirectory)
                    throw new Error(`Zip file cannot contain directories. Please only include files, and reference them in the markdown file`);

                const file = entry.getData();

                formData.append("assets", new Blob([file]), entry.entryName);
            }

            if (!formData.has("assets")) {
                await interaction.followUp({ content: "No assets found in the zip file", ephemeral: true });
                return;
            }
        }

        // Send form data to the server
        await fetchHMAC<Word>(siteUrl("/api/words"), "POST", formData)
            .then(async word => {
                discordClient.channels.fetch(config.discord.feed_channel_id)
                    .then(async channel => {
                        if (channel?.isSendable())
                            await channel.send({ content: `<@${interaction.user.id}> uploaded a word\n**Link:** ${config.collective.site_url}/words/${Math.floor(new Date(word.date).getTime() / 1000).toString(10)}` });
                        else
                            console.error("Failed to send message to feed channel: Channel is not sendable");
                    })
                    .catch(err => console.error("Failed to send message to feed channel", err));
                await interaction.followUp({ content: `Post uploaded successfully\n**Link:** ${siteUrl(`/words/${Math.floor(new Date(word.date).getTime() / 1000).toString(10)}`)}` });
            });
    },
}

export default command;
