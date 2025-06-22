import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder, SlashCommandSubcommandsOnlyBuilder } from "discord.js";
import action from "./action.js";
import bsky from "./bsky.js";
import change from "./change.js";
import confirm from "./confirm.js";
import del from "./delete.js";
import help from "./help.js";
import info from "./info.js";
import join from "./join.js";
import log from "./log.js";
import motion from "./motion.js";
import ping from "./ping.js";
import restore from "./restore.js";
import sight from "./sight.js";
import sound from "./sound.js";
import ticket from "./ticket.js";
import tunicwild from "./tunicwild.js";
import updateandrestart from "./updateandrestart.js";
import word from "./word.js";
export interface Command {
    data: SlashCommandBuilder | SlashCommandSubcommandsOnlyBuilder | SlashCommandOptionsOnlyBuilder;
    run: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: Command[] = [];

commands.push(action);
commands.push(bsky);
commands.push(change);
commands.push(confirm);
commands.push(del);
commands.push(help);
commands.push(info);
commands.push(join);
commands.push(log);
commands.push(motion);
commands.push(ping);
commands.push(restore);
commands.push(sight);
commands.push(sound);
commands.push(ticket);
commands.push(tunicwild);
commands.push(updateandrestart);
commands.push(word);

export { commands };
