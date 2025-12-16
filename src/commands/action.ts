import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { siteUrl } from "../config.js";
import confirm from "../confirm.js";
import { submitAction } from "../thingSubmissions/action.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("action")
        .setDescription("Add your social media link to site")
        .addStringOption(option =>
            option.setName("link")
                .setDescription("Link to your social media acc, ideally rss/atom link")
                .setRequired(true),
        )
        .addBooleanOption(option =>
            option.setName("is_rss")
                .setDescription("Is the link an RSS/Atom feed? (if not, title and desc. are required)")
                .setRequired(true),
        )
        .addStringOption(option =>
            option.setName("title")
                .setDescription("A custom title for the link")
                .setRequired(false),
        )
        .addStringOption(option =>
            option.setName("description")
                .setDescription("A custom description for the link")
                .setRequired(false),
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const link = interaction.options.getString("link")!;
        const isRSS = interaction.options.getBoolean("is_rss")!;
        let title = interaction.options.getString("title");
        let description = interaction.options.getString("description");

        if (!URL.canParse(link)) {
            await interaction.editReply("Invalid URL provided");
            return;
        }

        if (!isRSS) {
            if (!title || !description) {
                await interaction.editReply("Title and description are required for non-RSS/Atom feeds");
                return;
            }

            const noRSSConfirm = await confirm(interaction, `The link provided is not an RSS/Atom feed. Are you sure you want to continue?\nThis means new posts/content will not be shown in the feed on the [actions](<${siteUrl("/actions")}>) page, and the link will only show on the left sidebar\n\n# Most sites have RSS/atom feeds...\n## if you're unsure, check the site for a link to an RSS/atom feed before continuing\n## or potentially use a service like [fetchrss.com](<https://fetchrss.com/>) or [rsshub.app](<https://rsshub.app/>) to create a feed\n\nhttps://discord.com/channels/305538303179096065/1325576293881872386/1331567646747004971 also contains examples for popular sites`);
            if (!noRSSConfirm)
                return;
        }

        try {
            await submitAction({
                memberDiscord: interaction.user.id,
                link,
                isRSS,
                title: title ?? undefined,
                description: description ?? undefined,
            });
            await interaction.editReply(`Added\nshould be visible on the site at ${siteUrl("/actions")}`);
        } catch (error) {
            const message = error instanceof Error ? error.message : "Failed to add action";
            await interaction.editReply(`Failed to add action:\n\`\`\`${message}\`\`\``);
        }

    },
}

export default command;
