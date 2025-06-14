import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member, memberAliasToHostName } from "../types/member.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import confirm from "../confirm.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("bsky")
        .setDescription("Add bsky for your custom DNS as [alias].nonacademic.net")
        .addStringOption(option =>
            option.setName("did")
                .setDescription("Your DID from the bsky dashboard (did:plc:1234 or did=did:plc:1234)")
                .setRequired(true),
        )
        .setContexts([
            InteractionContextType.Guild,
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        const data = await fetchHMAC<Member[]>(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
        if (!data.length) {
            await interaction.editReply("You are not registered on the site. Run `/join` first");
            return;
        }

        const member = data[0];

        const subdomain = memberAliasToHostName(member.alias);
        if (!subdomain) {
            await interaction.editReply(`Your alias (\`${member.alias}\`) must contain alphanumeric characters to be a valid bsky handle. Please change your alias with \`/change\``);
            return;
        }

        const subdomainCheck = await confirm(interaction, `Are you sure you want to add \`${subdomain}.nonacademic.net\` as your bsky handle?\nIf not, please change your alias with \`/change\``);
        if (!subdomainCheck) return;

        const did = interaction.options.getString("did", true).replace(/^did=/, "");
        if (!/^did:plc:\S+$/.test(did)) {
            await interaction.followUp("Invalid DID provided. It must be in the format of `did:plc:1234` or `did=did:plc:1234`");
            return;
        }

        await fetchHMAC(siteUrl(`/api/atproto-dns`), "PUT", {
            did,
            subdomain,
        });

        await interaction.followUp(`You can now use \`${subdomain}.nonacademic.net\` as your bsky handle. It may take a few minutes for bsky to recognize this change`);
    },
}

export default command;
