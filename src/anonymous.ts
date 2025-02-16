import { ChatInputCommandInteraction } from "discord.js";
import confirm from "./confirm.js";

export async function anonymousConfirmation (interaction: ChatInputCommandInteraction, anonymous: boolean): Promise<boolean> {
    if (!anonymous && !interaction.inGuild()) {
        const confirmation = await confirm(interaction, "You are posting in my DMs/a private channel, but you aren't posting your work fully anonymously.\nYour discord will be linked to the post, and people in the server can know who posted this work\n\nIf you don't want this, set `anonymous` to `true`\n\nAre you sure you want to post with your discord linked?");
        if (!confirmation)
            return false;
    }

    if (!anonymous)
        return true;

    if (interaction.inGuild()) {
        await interaction.followUp({ content: "You cannot post anonymously in the guild, do it in my DMs... there's no point otherwise", ephemeral: true });
        return false;
    }

    const confirmation = await confirm(interaction, "Anonymous posts will not have a colour on the site, a discord link, or a name attached to it\nPeople in the server will not be able to know who posted this\n\n**You will not be able to claim/delete it later either**\n\nAre you sure you want to post anonymously?")
    if (!confirmation)
        return false;  
    
    return true;
}