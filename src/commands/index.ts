import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";
import confirm from "./confirm";
import join from "./join";
import ping from "./ping";
import upload from "./upload";

export interface Command {
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    run: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: Command[] = [];

commands.push(confirm);
commands.push(join);
commands.push(ping);
commands.push(upload);

export { commands };