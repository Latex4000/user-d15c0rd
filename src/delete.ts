import { REST, Routes } from "discord.js";
import config from "./config.js";

const rest = new REST({ version: "10" }).setToken(config.discord.token);
await rest.put(
    Routes.applicationCommands(config.discord.client_id),
    { body: [] }
).catch(console.error);

console.log("Discord commands deleted");