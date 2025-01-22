import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";
import change from "./change";
import confirm from "./confirm";
import help from "./help";
import info from "./info";
import join from "./join";
import ping from "./ping";
import upload from "./upload";
import word from "./word";
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