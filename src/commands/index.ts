import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";
import change from "./change";
import confirm from "./confirm";
import html from "./html";
import join from "./join";
import ping from "./ping";
import upload from "./upload";

export interface Command {
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    run: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: Command[] = [];

commands.push(change);
commands.push(confirm);
commands.push(html);
commands.push(join);
commands.push(ping);
commands.push(upload);

export { commands };