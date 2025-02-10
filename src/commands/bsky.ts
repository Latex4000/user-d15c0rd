import { ChatInputCommandInteraction, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { Member } from "../types/member.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import { getHosts, addAtprotoRecord, setHosts, memberAliasToHostName } from "../namecheap.js";
import confirm from "../confirm.js";

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("bsky")
        .setDescription("Add bsky for your custom DNS as [youralias].nonacademic.net")
        .addStringOption(option =>
            option.setName("did")
                .setDescription("Your DID from the bsky dashboard (did:plc:1234 or did=did:plc:1234)")
                .setRequired(true),
        )
        .setDMPermission(false),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();
        let member: Member | undefined = undefined;
        try {
            const data: Member[] = await fetchHMAC(siteUrl(`/api/member?id=${interaction.user.id}`), "GET");
            if (data.length)
                member = data[0];
        } catch (e) {
            await interaction.followUp({ content: `An error occurred while fetching the JSON data\n\`\`\`\n${e}\n\`\`\``, ephemeral: true });
            console.error(e);
            return;
        }

        if (!member) {
            await interaction.followUp({ content: "You are not in the webring. Run `/join` to join the webring", ephemeral: true });
            return;
        }

        const subdomain = memberAliasToHostName(member.alias);
        if (!subdomain) {
            await interaction.followUp({ content: "You do not have a valid alias. Please change your alias to something more suitable with `/change`", ephemeral: true });
            return;
        }

        const subdomainCheck = await confirm(interaction, `Are you sure you want to add bsky as \`${subdomain}.nonacademic.net\`?\nIf not, please change your alias with \`/change\``);
        if (!subdomainCheck) return;

        let did = interaction.options.getString("did")!;
        // Check if DID is valid format of either did=did:plc:1234 or did:plc:1234
        if (!did.match(/^(did:plc:|did=did:plc:)\S+$/)) {
            await interaction.editReply("Invalid DID provided. It must be in the format of `did:plc:1234` or `did=did:plc:1234`");
            return;
        }
        did = did.replace("did=", "");

        try {
            const hosts = await getHosts();
            addAtprotoRecord(hosts, subdomain, did);
            await setHosts(hosts);
        } catch (e) {
            await interaction.editReply(`An error occurred while fetching the DNS data\n\`\`\`\n${e}\n\`\`\``);
            console.error(e);
            return;
        }
        
        await interaction.editReply(`bsky should be added as \`${subdomain}.nonacademic.net\`\nPlease allow up to 24 hours for the DNS to propagate`);
    },
}

export default command;