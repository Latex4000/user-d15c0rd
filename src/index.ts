import { AttachmentPayload, ChatInputCommandInteraction, Client, DiscordAPIError, GatewayIntentBits, Message, REST, Routes } from "discord.js";
import * as config from "../config.json";
import { commands } from "./commands";
import { getYoutubeAccessToken } from "./oauth/youtube";

const rest = new REST({ version: "10" }).setToken(config.discord.token);
(async () => {
    console.log("Started refreshing slash (/) commands.");

    await rest.put(
        Routes.applicationCommands(config.discord.client_id),
        { body: commands.map(c => c.data) }
    );
})()
    .then(() => console.log(`Successfully refreshed slash (/) commands`))
    .catch((error) => console.error("An error has occurred in refreshing slash (/) commands", error));

const discordClient = new Client({
    intents: [
        GatewayIntentBits.Guilds,
    ],
});

discordClient.login(config.discord.token).then(async () => {
    console.log("Logged in as " + discordClient.user?.tag);

    const url = await getYoutubeAccessToken();
    if (!url)
        return; // Already authenticated

    try {
        const owner = await discordClient.users.fetch(config.discord.owner_id);
        await owner.send(`Click here to authenticate with youtube: ${url}`);
    } catch (err) {
        console.log("Failed to send message to owner. Click here to authenticate with youtube: " + url);
        console.error(err);
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

export async function respond (interaction: ChatInputCommandInteraction, messageData: { content?: string, files?: AttachmentPayload[] | string[], ephemeral?: boolean }) {
    if (interaction.replied || interaction.deferred)
        return interaction.editReply(messageData);
    else
        return interaction.reply(messageData);
}