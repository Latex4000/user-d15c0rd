import { ChatInputCommandInteraction, SlashCommandBuilder, SlashCommandOptionsOnlyBuilder } from "discord.js";
import action from "./action.js";
import change from "./change.js";
import confirm from "./confirm.js";
import del from "./delete.js";
import help from "./help.js";
import info from "./info.js";
import join from "./join.js";
import motion from "./motion.js";
import ping from "./ping.js";
import restore from "./restore.js";
import sound from "./sound.js";
import word from "./word.js";
export interface Command {
    data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder;
    run: (interaction: ChatInputCommandInteraction) => Promise<void>;
}

const commands: Command[] = [];

commands.push(action);
commands.push(change);
commands.push(confirm);
commands.push(del);
commands.push(help);
commands.push(info);
commands.push(join);
commands.push(motion);
commands.push(ping);
commands.push(restore);
commands.push(sound);
commands.push(word);

export { commands };