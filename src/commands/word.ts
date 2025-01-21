import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from ".";
import AdmZip from "adm-zip";
import { fetchHMAC } from "../hmac";
import * as config from "../../config.json";

const fileSizeLimit = 2 ** 20; // 1 MB

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("word")
        .setDescription("Upload post to the webring; all files have a 1 MB limit")
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
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const attachment = interaction.options.getAttachment("md_txt_file");
        const assets = interaction.options.getAttachment("assets");

        const title = interaction.options.getString("title");
        const tags = interaction.options.getString("tags");

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
        let content: string;
        try {
            content = await fetch(attachment.url).then(res => res.text());
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the md/txt file\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            return;
        }

        // Check if the assets file is a zip file
        if (assets && !assets.name.endsWith(".zip")) {
            await interaction.followUp({ content: "The assets file must be a zip file", ephemeral: true });
            return;
        }

        const formData = new FormData();
        formData.append("title", title);
        formData.append("tags", tags || "");
        formData.append("md", content);

        // Extract zip and append every single file data into "assets" form data key
        if (assets) {
            await fetch(assets.url)
                .then(res => res.arrayBuffer())
                .then(async buffer => {
                    const zip = new AdmZip(Buffer.from(buffer));
                    const entries = zip.getEntries();

                    for (const entry of entries) {
                        if (entry.isDirectory)
                            continue;

                        const file = entry.getData();
                        if (file.length > fileSizeLimit)
                            throw new Error(`File ${entry.entryName} exceeds the size limit of 1 MB`);

                        formData.append("assets", new Blob([file]), entry.entryName);
                    }
                })
                .catch(async e => {
                    await interaction.followUp({ content: `An error occurred while extracting the zip file\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
                    return;
                });
        }

        // Send form data to the server
        await fetchHMAC(`${config.collective.site_url}/api/words`, "POST", formData)
            .then(async res => {
                if (res.status === 200)
                    await interaction.followUp({ content: "Post uploaded successfully" });
                else
                    await interaction.followUp({ content: `An error occurred while uploading the post\n\`\`\`\n${await res.text()}\n\`\`\``, ephemeral: true });
            })
            .catch(async e => {
                await interaction.followUp({ content: `An error occurred while uploading the post\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
                return;
            });
    },
}

export default command;