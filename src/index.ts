import { AttachmentPayload, ChatInputCommandInteraction, Client, DiscordAPIError, GatewayIntentBits, Message, REST, Routes } from "discord.js";
import config from "../config.json" with { type: "json" };
import { commands } from "./commands/index.js";
import youtubeClient from "./oauth/youtube.js";

const rest = new REST({ version: "10" }).setToken(config.discord.token);

console.log("Started refreshing slash (/) commands.");
await rest.put(
    Routes.applicationCommands(config.discord.client_id),
    { body: commands.map(c => c.data) },
)
    .then(() => console.log(`Successfully refreshed slash (/) commands`))
    .catch((error) => console.error("An error has occurred in refreshing slash (/) commands", error));

const discordClient = new Client({
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

let shuttingDown = false;
process.on("SIGINT", async () => {
    if (shuttingDown)
        return;

    shuttingDown = true;
    console.log("Shutting down...");

    // Delete all commands in development mode
    if (process.env.NODE_ENV === "development")
        await rest.put(
            Routes.applicationCommands(config.discord.client_id),
            { body: [] }
        );

    await discordClient.destroy();
    process.exit(0);
});

await discordClient.login(config.discord.token);

export { discordClient };