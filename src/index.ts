import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { AttachmentPayload, ChatInputCommandInteraction, Client, DiscordAPIError, GatewayIntentBits, REST, RESTPutAPIApplicationCommandsJSONBody, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import youtubeClient from "./oauth/youtube.js";
import config from "./config.js";
import DiscordInteractionError from "./DiscordInteractionError.js";

const rest = new REST({ version: "10" }).setToken(config.discord.token);

console.log("Started refreshing slash (/) commands.");
await rest.put(
    Routes.applicationCommands(config.discord.client_id),
    { body: commands.map(c => c.data.toJSON()) satisfies RESTPutAPIApplicationCommandsJSONBody },
);
console.log(`Successfully refreshed slash (/) commands`);

export const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
});

discordClient.on("ready", async (discordClient) => {
    console.log("Logged in as " + discordClient.user.tag);

    if (await youtubeClient.initialize() === false) {
        const owner = await discordClient.users.fetch(config.discord.owner_id);
        await youtubeClient.getAccessToken((message) => owner.send(message))
    }

    await discordClient.channels.fetch(config.discord.collective_channel_id)
        .then(async channel => {
            if (channel?.isSendable())
                await channel.send("Gm");
            else
                console.error("Failed to send Gm: Channel is not sendable");
        })
        .catch(err => console.error("Failed to send Gm", err));
});

discordClient.on("interactionCreate", async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.find(c => c.data.name === interaction.commandName);
    if (!command) {
        console.error(`No command matching ${interaction.commandName} was found`);
        return;
    }

    try {
        await command.run(interaction);
    } catch (err) {
        if (!err)
            return;

        if (err instanceof DiscordInteractionError) {
            await err.send(interaction);
            return;
        }

        console.error(err);

        if (!(err instanceof DiscordAPIError))
            return;

        if (err.code === 50027) {
            if (interaction.channel?.isSendable())
                await interaction.channel.send(`Ur command timed out Lol try again <@${interaction.user.id}>`);
            await interaction.deleteReply();
        } else {
            await respond(interaction, { content: `The command was unable to be fulfilled.\nA discord error (code \`${err.code}\`) was received:\n\`\`\`\n${err.message}\n\`\`\`` });
        }
    }
});

export async function respond (interaction: ChatInputCommandInteraction, messageData: { content?: string, files?: AttachmentPayload[], ephemeral?: boolean }) {
    // Send content as file if larger than 2000 characters
    if (messageData.content && messageData.content.length > 2000) {
        messageData.files = [...(messageData.files || []), { attachment: Buffer.from(messageData.content), name: "message.txt" }];
        messageData.content = "Message too long; sending as file";
    }

    if (interaction.replied || interaction.deferred)
        return interaction.editReply(messageData);
    else
        return interaction.reply(messageData);
}

await discordClient.login(config.discord.token);

const httpServer = createServer((request, response) => {
    response.writeHead(404);
    response.end();
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
    await discordClient.destroy();
}
