import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";
import change from "./change.js";
import confirm from "./confirm.js";
import help from "./help.js";
import info from "./info.js";
import join from "./join.js";
import ping from "./ping.js";
import upload from "./upload.js";
import word from "./word.js";
export interface Command {
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    run: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: Command[] = [];

commands.push(change);
commands.push(confirm);
commands.push(help);
commands.push(info);
commands.push(join);
commands.push(ping);
commands.push(upload);
commands.push(word);

export { commands };