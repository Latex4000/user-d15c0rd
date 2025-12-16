import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { format } from "node:util";
import { ApplicationCommandOptionType, ChatInputCommandInteraction, Client, DiscordAPIError, GatewayIntentBits, InteractionReplyOptions, InteractionResponse, Message, MessageCreateOptions, messageLink, REST, RESTPutAPIApplicationCommandsJSONBody, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import youtubeClient from "./oauth/youtube.js";
import config from "./config.js";
import DiscordInteractionError from "./DiscordInteractionError.js";
import { handleHttpRequest } from "./server.js";

const discordDisabled = config.discord.enable === false;
if (discordDisabled)
    console.warn("Discord disabled – skipping Discord login/command registration. HTTP server will still run.\n\n");

if (!discordDisabled) {
    const rest = new REST({ version: "10" }).setToken(config.discord.token);

    console.log("Started refreshing slash (/) commands.");
    await rest.put(
        Routes.applicationCommands(config.discord.client_id),
        { body: commands.map((c) => c.data.toJSON()) satisfies RESTPutAPIApplicationCommandsJSONBody },
    );
    console.log("Successfully refreshed slash (/) commands");
}

export const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
});

async function sendToCollectiveChannel(options: MessageCreateOptions | string): Promise<Message<true>> {
    if (discordDisabled) {
        console.warn("Discord disabled - skipping collective channel send.");
        return undefined as unknown as Message<true>;
    }

    const channel = await discordClient.channels.fetch(config.discord.collective_channel_id);
    if (!channel?.isSendable() || channel.isDMBased()) {
        throw new Error("Invalid collective_channel_id");
    }

    if (typeof options === "string") {
        options = { content: options };
    }

    if (options.content != null && options.content.length > 2000) {
        options.files = [
            ...(options.files ?? []),
            { attachment: options.content, name: "message.txt" },
        ];
        delete options.content;
    }

    return channel.send(options);
}

async function logErrorToCollectiveChannel(message: string): Promise<Message<true> | undefined> {
    try {
        return sendToCollectiveChannel({
            allowedMentions: { users: config.discord.admin_ids },
            content: `${message}\n\n${config.discord.admin_ids.map((id) => `<@${id}>`).join(" ")}`,
        });
    } catch {
        message = message
            .split("\n")
            .map((line) => `  ${line}`)
            .join("\n");
        console.error(`Failed to send the following error to #collective:\n${message}`);
    }
}

process.on("uncaughtException", (error) => {
    logErrorToCollectiveChannel(`Uncaught exception:\n\`\`\`\n${format(error)}\n\`\`\``);
});

process.on("unhandledRejection", (reason) => {
    logErrorToCollectiveChannel(`Unhandled Promise rejection:\n\`\`\`\n${format(reason)}\n\`\`\``);
});

discordClient.on("error", (error) => {
    logErrorToCollectiveChannel(`Unhandled Discord client error:\n\`\`\`\n${format(error)}\n\`\`\``);
});

discordClient.on("ready", async (discordClient) => {
    console.log("Logged in as " + discordClient.user.tag);

    if (await youtubeClient.initialize() === false) {
        const owner = await discordClient.users.fetch(config.discord.owner_id);
        await youtubeClient.getAccessToken((message) => owner.send(message))
    }

    await sendToCollectiveChannel("Gm");
});

discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) {
        return;
    }

    const command = commands.find((command) => command.data.name === interaction.commandName);

    if (command == null) {
        console.error(`No command matching ${interaction.commandName} was found`);
        return;
    }

    try {
        await command.run(interaction);
    } catch (error) {
        if (error instanceof DiscordInteractionError) {
            await error.send(interaction);
            return;
        }

        const optionData = interaction.options.data.filter((option) =>
            option.type !== ApplicationCommandOptionType.Subcommand &&
            option.type !== ApplicationCommandOptionType.SubcommandGroup,
        );
        const interactionSummary = [
            interaction.createdAt.toUTCString(),
            `Command: \`${[
                interaction.commandName,
                interaction.options.getSubcommandGroup(false),
                interaction.options.getSubcommand(false),
            ].filter(Boolean).join(" ")}\``,
            `Options:${optionData.length ? "" : " None"}`,
            optionData
                .map((option) => `- \`${option.name}\`: \`${JSON.stringify(option.value)}\``)
                .join("\n"),
            `User: \`${interaction.user.displayName}\` (\`${interaction.user.id}\`)`,
            `Channel: ${interaction.channel == null ? "None" : "name" in interaction.channel ? `\`${interaction.channel.name}\`` : "DM"} (<#${interaction.channelId}>)`,
        ].filter(Boolean).join("\n");

        const collectiveMessage = await logErrorToCollectiveChannel(`${interactionSummary}\n\n\`\`\`\n${format(error)}\n\`\`\``);

        // If the error was an interaction timeout, we can't use the interaction to reply anymore
        if (error instanceof DiscordAPIError && error.code === 50027) {
            if (interaction.channel?.isSendable()) {
                await interaction.channel.send(`Ur command timed out Lol try again <@${interaction.user.id}>`);
            }

            await interaction.deleteReply();
        } else {
            await respond(interaction, {
                content: collectiveMessage != null
                    ? `An error occurred while responding to your command. See ${messageLink(collectiveMessage.channelId, collectiveMessage.id, collectiveMessage.guildId)} for details`
                    : "An error occurred while responding to your command",
                ephemeral: true,
            });
        }
    }
});

export async function respond(interaction: ChatInputCommandInteraction, options: InteractionReplyOptions | string): Promise<InteractionResponse | Message> {
    if (typeof options === "string") {
        options = { content: options };
    }

    if (options.content != null && options.content.length > 2000) {
        options.files = [
            ...(options.files ?? []),
            { attachment: options.content, name: "message.txt" },
        ];
        delete options.content;
    }

    return interaction.replied || interaction.deferred
        ? interaction.editReply(options)
        : interaction.reply(options);
}

if (!discordDisabled)
    await discordClient.login(config.discord.token);

const httpServer = createServer((request, response) => {
    void handleHttpRequest(request, response)
        .catch((error) => {
            console.error("HTTP handler error", error);
            if (!response.headersSent)
                response.writeHead(500, { "Content-Type": "application/json" });
            if (!response.writableEnded)
                response.end(JSON.stringify({ error: "Internal server error" }));
        });
});
httpServer.listen(config.http.port, "localhost");

// Forward connections from the server to local http server
const autossh = !config.http.ssh_tunnel_host ? null : spawn("autossh", [
    // autossh options
    "-M", "0",
    // ssh options
    "-N",
    "-o", "ExitOnForwardFailure yes",
    "-o", "ServerAliveCountMax 3",
    "-o", "ServerAliveInterval 15",
    "-R", `localhost:5556:localhost:${config.http.port}`,
    config.http.ssh_tunnel_host,
], { stdio: ["ignore", "ignore", "inherit"] });

export async function shutdown() {
    if (autossh != null && !autossh.kill()) {
        autossh.kill("SIGKILL");
    }

    await new Promise((resolve) => httpServer.close(resolve));
    if (!discordDisabled)
        await discordClient.destroy();
}

export { discordDisabled };
