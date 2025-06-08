import { ChatInputCommandInteraction, InteractionContextType, MessageFlags, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import config from "../config.js";
import { execFileSync, spawn } from "node:child_process";
import { discordClient } from "../index.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("update-and-restart")
        .setDescription("Update and restart the bot")
        .setContexts(InteractionContextType.Guild)
        .setDefaultMemberPermissions(0)
        .addBooleanOption(option =>
            option
                .setName("stop")
                .setDescription("Update and stop instead of restarting")
                .setRequired(false)
        ),
    run: async (interaction: ChatInputCommandInteraction) => {
        if (!config.discord.admin_ids.includes(interaction.user.id)) {
            await interaction.reply({
                content: "This command can only be used by admins",
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (interaction.channelId !== config.discord.collective_channel_id) {
            await interaction.reply({
                content: `This command can only be used in <#${config.discord.collective_channel_id}>`,
                flags: MessageFlags.Ephemeral,
            });
            return;
        }

        if (process.env.NODE_ENV !== "development") {
            await interaction.reply("Pulling from GitHub and building...");

            console.log("Running git pull");
            execFileSync("git", ["pull"], { stdio: "ignore" });
            console.log("Running npm install");
            execFileSync("npm", ["install"], { stdio: "ignore" });
            console.log("Running npm run build");
            execFileSync("npm", ["run", "build"], { stdio: "ignore" });
        }

        const stop = interaction.options.getBoolean("stop");

        await interaction.editReply(stop ? "Stopping!" : "Restarting!");

        await discordClient.destroy();

        // Wait a little bit just in case rate limits could be an issue idk
        await new Promise((resolve) => setTimeout(resolve, 2000));

        if (!stop && process.env.NODE_ENV !== "development") {
            // Start new detached process but keep IO on the same terminal
            spawn("npm", ["run", "start"], {
                detached: true,
                stdio: "inherit",
            }).unref();
        }
    },
}

export default command;
