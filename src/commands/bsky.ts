import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member } from "../types/member.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import { getHosts, addAtprotoRecord, setHosts, memberAliasToHostName } from "../namecheap.js";
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

        let member: Member | undefined;
        try {
            const data = await fetchHMAC<Member[]>(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
            if (data.length)
                member = data[0];
        } catch (e) {
            await interaction.editReply(`An error occurred while fetching member data\n\`\`\`\n${e}\n\`\`\``);
            console.error(e);
            return;
        }

        if (!member) {
            await interaction.editReply("You are not registered on the site. Run `/join` first");
            return;
        }

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

        try {
            const hosts = await getHosts();
            addAtprotoRecord(hosts, subdomain, did);
            await setHosts(hosts);
        } catch (e) {
            await interaction.followUp(`An error occurred while updating DNS records\n\`\`\`\n${e}\n\`\`\``);
            console.error(e);
            return;
        }

        await interaction.followUp(`You can now use \`${subdomain}.nonacademic.net\` as your bsky handle. It may take a few minutes for bsky to recognize this change`);
    },
}

export default command;
