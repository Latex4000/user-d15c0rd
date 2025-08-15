import { createHash, randomUUID } from "node:crypto";
import { openAsBlob } from "node:fs";
import { mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import AdmZip from "adm-zip";
import { ActionRowBuilder, ButtonBuilder, ButtonInteraction, ButtonStyle, ChatInputCommandInteraction, ComponentType, InteractionContextType, MessageFlags, ModalActionRowComponentBuilder, ModalBuilder, SlashCommandBuilder, TextInputBuilder, TextInputStyle } from "discord.js";
import { Command } from "./index.js";
import { respond } from "../index.js";
import { fetchHMAC } from "../fetch.js";
import { siteUrl } from "../config.js";
import confirm from "../confirm.js";
import { levenshteinDistance } from "../levenshtein.js";
import { simpleChoose } from "../choose.js";
import { Tunicwild } from "../types/tunicwild.js";
import { execFileAsync } from "../helpers/process.js";

/**
 * Test if a file can be parsed by FFmpeg and contains at least one audio track.
 */
async function testAudioFile(path: string): Promise<boolean> {
    // TODO handle error?
    const stdout = await execFileAsync("ffprobe", [
        "-v", "error",
        "-select_streams", "a:0",
        "-show_entries", "stream=index",
        "-output_format", "json",
        path,
    ]);

    return JSON.parse(stdout).streams?.length === 1;
}

interface FfprobeMetadata {
    composer: string | undefined;
    title: string | undefined;
}

/**
 * Get composer and title metadata from an audio file using FFprobe. For composer, the "artist" field is also used as a fallback.
 */
async function getMetadataFromFfprobe(path: string): Promise<FfprobeMetadata> {
    const stdout = await execFileAsync("ffprobe", [
        "-v", "error",
        "-show_entries", "format_tags=title,artist,composer",
        "-output_format", "json",
        path,
    ]);
    const parsed = JSON.parse(stdout).format?.tags;

    return {
        composer: parsed?.composer || parsed?.artist || undefined,
        title: parsed?.title || undefined,
    };
}

interface MetadataForUpload {
    composer: string;
    path: string;
    title: string;
}

/**
 * Decide the metadata to use for songs uploaded in a batch. From highest to lowest priority:
 * 1. Composer given via {@link composerOverride}
 * 2. Metadata tags in the audio file
 * 3. Prompt for a user-provided regular expression to parse audio filenames
 */
async function decideMetadataForUpload(interaction: ChatInputCommandInteraction, paths: readonly string[], composerOverride: string | undefined): Promise<MetadataForUpload[] | undefined> {
    const metadatas: MetadataForUpload[] = [];

    for (const path of paths) {
        const ffprobeMetadata = await getMetadataFromFfprobe(path);

        const composer = composerOverride ?? ffprobeMetadata.composer;
        const title = ffprobeMetadata.title;

        // If the composer or title can't be determined for some audio files, fall back to regex prompt
        if (composer == null || title == null) {
            return decideMetadataForUploadByRegex(interaction, paths, composerOverride);
        }

        metadatas.push({ composer, path, title });
    }

    // TODO confirm metadata with user

    return metadatas;
}

async function decideMetadataForUploadByRegex(interaction: ChatInputCommandInteraction, paths: readonly string[], composerOverride: string | undefined): Promise<MetadataForUpload[] | undefined> {
    const requiresComposer = composerOverride == null;
    const placeholder = requiresComposer ? "^(?<composer>.+?) - (?<title>.+)$" : "^.+? - (?<title>.+)$";

    let regexString = await promptForRegex(interaction, `
Some of the tracks you're trying to upload don't have metadata provided by the audio file itself.

If the ${requiresComposer ? "composer and title are" : "title is"} present in each of the filenames, you can write a regular expression with ${requiresComposer ? "capture groups for `composer` and `title`" : "a capture group for `title`"} to fill in the metadata.

Alternatively, cancel the upload, edit the tags of the audio files, and try again.
        `.trim(), placeholder);

    const metadatas: MetadataForUpload[] = [];

    while (true) {
        if (regexString == null) {
            return;
        }

        try {
            const regex = new RegExp(regexString);

            for (const path of paths) {
                const matches = regex.exec(path);
                const composer = composerOverride ?? matches?.groups?.composer;
                const title = matches?.groups?.title;

                if (composer == null || title == null) {
                    throw new Error();
                }

                metadatas.push({ composer, path, title });
            }
        } catch {
            regexString = await promptForRegex(interaction, `
The provided regular expression was either invalid or didn't match all of the filenames.

Make sure the expression includes ${requiresComposer ? "capture groups for `composer` and `title`" : "a capture group for `title`"}.
                `.trim(), placeholder);
        }

        const okButtonId = randomUUID();
        const retryButtonId = randomUUID();
        const cancelButtonId = randomUUID();
        const message = await interaction.followUp({
            content: "Do these metadata matches look correct? (only first 3 shown)\n\n" +
                 metadatas
                    .slice(0, 3)
                    .map((metadata) => `Composer: \`${metadata.composer}\`\nTitle: \`${metadata.title}\``)
                    .join("\n\n"),
            components: [
                new ActionRowBuilder<ButtonBuilder>().addComponents(
                    new ButtonBuilder()
                        .setCustomId(okButtonId)
                        .setLabel("Looks good!")
                        .setStyle(ButtonStyle.Success),
                    new ButtonBuilder()
                        .setCustomId(retryButtonId)
                        .setLabel("Change regex")
                        .setStyle(ButtonStyle.Primary),
                    new ButtonBuilder()
                        .setCustomId(cancelButtonId)
                        .setLabel("Cancel")
                        .setStyle(ButtonStyle.Danger),
                ),
            ],
            flags: MessageFlags.Ephemeral,
            withResponse: true,
        });

        let buttonInteraction: ButtonInteraction;
        try {
            buttonInteraction = await message.awaitMessageComponent<ComponentType.Button>({
                dispose: true, // TODO ??
                filter: (buttonInteraction) => buttonInteraction.user.id === interaction.user.id,
                time: 60 * 1000,
            });
        } catch {
            // Timed out
            return;
        }
        // TODO delete message in finally block?

        switch (buttonInteraction.customId) {
            case okButtonId:
                return metadatas;

            // TODO dedupe
            case retryButtonId:
                await buttonInteraction.showModal(
                    new ModalBuilder()
                        .addComponents(
                            new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
                                new TextInputBuilder()
                                    .setLabel("Regex")
                                    .setPlaceholder(placeholder)
                                    .setRequired(true)
                                    .setStyle(TextInputStyle.Short),
                            ),
                        )
                        .setTitle("Audio filename regular expression"),
                );

                try {
                    const modalInteraction = await buttonInteraction.awaitModalSubmit({
                        filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id,
                        time: 30 * 60 * 1000,
                    });

                    regexString = modalInteraction.components[0].components[0].value;
                } catch {
                    // Timed out
                    return;
                }

                break;

            case cancelButtonId:
                return;

            default:
                throw new Error("Received invalid component interaction");
        }
    }
}

async function promptForRegex(interaction: ChatInputCommandInteraction, prompt: string, placeholder: string): Promise<string | undefined> {
    const continueButtonId = randomUUID();
    const cancelButtonId = randomUUID();
    const message = await interaction.followUp({
        content: prompt,
        components: [
            new ActionRowBuilder<ButtonBuilder>().addComponents(
                new ButtonBuilder()
                    .setCustomId(continueButtonId)
                    .setLabel("Enter regex")
                    .setStyle(ButtonStyle.Success),
                new ButtonBuilder()
                    .setCustomId(cancelButtonId)
                    .setLabel("Cancel")
                    .setStyle(ButtonStyle.Danger),
            ),
        ],
        flags: MessageFlags.Ephemeral,
        withResponse: true,
    });

    let buttonInteraction: ButtonInteraction;
    try {
        buttonInteraction = await message.awaitMessageComponent<ComponentType.Button>({
            dispose: true, // TODO ??
            filter: (buttonInteraction) => buttonInteraction.user.id === interaction.user.id,
            time: 60 * 1000,
        });
    } catch {
        // Timed out
        return;
    }
    // TODO delete message in finally block?

    switch (buttonInteraction.customId) {
        case continueButtonId:
            await buttonInteraction.showModal(
                new ModalBuilder()
                    .addComponents(
                        new ActionRowBuilder<ModalActionRowComponentBuilder>().addComponents(
                            new TextInputBuilder()
                                .setLabel("Regex")
                                .setPlaceholder(placeholder)
                                .setRequired(true)
                                .setStyle(TextInputStyle.Short),
                        ),
                    )
                    .setTitle("Audio filename regular expression"),
            );

            try {
                const modalInteraction = await buttonInteraction.awaitModalSubmit({
                    filter: (modalInteraction) => modalInteraction.user.id === interaction.user.id,
                    time: 30 * 60 * 1000,
                });

                return modalInteraction.components[0].components[0].value;
            } catch {
                // Timed out
                return;
            }

        case cancelButtonId:
            return;

        default:
            throw new Error("Received invalid component interaction");
    }
}

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("tunicwilds")
        .setDescription("Add a song or songs to Tunicwilds")
        .addSubcommand(subcommand =>
            subcommand
                .setName("batch")
                .setDescription("Add a batch of songs to Tunicwilds")
                .addAttachmentOption(option =>
                    option
                        .setName("audio")
                        .setDescription("The batch of audio files in a zip file (must be mp3 or wav)")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("game")
                        .setDescription("The game the songs are from")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("release_date")
                        .setDescription("Release date of the songs or game (YYYY-MM-DD)")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("official_link")
                        .setDescription("An official link to the game's OST")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("composer")
                        .setDescription("The composer of the songs"))

        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("single")
                .setDescription("Add a song to Tunicwilds")
                .addAttachmentOption(option =>
                    option
                        .setName("audio")
                        .setDescription("The audio file (must be mp3 or wav)")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("game")
                        .setDescription("The game the song is from")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("release_date")
                        .setDescription("Release date of the song or game (YYYY-MM-DD)")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("official_link")
                        .setDescription("An official link to the game's OST")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("title")
                        .setDescription("The title of the song"))
                .addStringOption(option =>
                    option
                        .setName("composer")
                        .setDescription("The composer of the song"))
        )
        .setContexts([
            InteractionContextType.BotDM,
            InteractionContextType.Guild,
            InteractionContextType.PrivateChannel,
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        if (!interaction.channel?.isSendable()) {
            // WHAT?
            await respond(interaction, { content: "I cannot send messages in this channel", ephemeral: true });
            return;
        }

        const commandType = interaction.options.getSubcommand();
        const audio = interaction.options.getAttachment("audio", true);
        let game = interaction.options.getString("game", true);
        const releaseDate = interaction.options.getString("release_date", true);
        const officialLink = interaction.options.getString("official_link", true);
        const title = interaction.options.getString("title");
        const composer = interaction.options.getString("composer");

        if (!audio || !game || !releaseDate || !officialLink) {
            await respond(interaction, { content: "You must provide an audio file, game name, release date, and official link", ephemeral: true });
            return;
        }

        await using disposables = new AsyncDisposableStack();

        // Create the directory where the audio file(s) will be downloaded
        const batchPath = join(tmpdir(), createHash("md5").update(audio.url).digest("hex"));
        await mkdir(batchPath);
        disposables.defer(() => rm(batchPath, { recursive: true, force: true }));

        const audioAttachmentBuffer = await fetch(audio.url).then((response) => response.arrayBuffer());

        // Write the audio file(s) to the directory
        switch (commandType) {
            case "single":
                await writeFile(join(batchPath, audio.name), Buffer.from(audioAttachmentBuffer));
                break;

            case "batch":
                try {
                    new AdmZip(Buffer.from(audioAttachmentBuffer)).extractAllTo(batchPath);
                } catch {
                    await respond(interaction, {
                        content: "Invalid ZIP archive",
                        ephemeral: true,
                    });
                    return;
                }
                break;

            default:
                throw new Error("Unreachable");
        }

        // Get paths of valid audio files
        const audioPaths: string[] = [];

        for (const path of (await readdir(batchPath)).map((filename) => join(batchPath, filename))) {
            if (await testAudioFile(path)) {
                audioPaths.push(path);
            }
        }

        // Check that the correct number of audio files are being uploaded
        switch (commandType) {
            case "single":
                if (audioPaths.length !== 1) {
                    await respond(interaction, {
                        content: "Invalid audio file",
                        ephemeral: true,
                    });
                    return;
                }
                break;

            case "batch":
                if (audioPaths.length === 0) {
                    await respond(interaction, {
                        content: "The ZIP archive has no valid audio files",
                        ephemeral: true,
                    });
                    return;
                }

                if (!await confirm(interaction, `You are about to add ${audioPaths.length} songs to the game **${game}**. Do you want to proceed?`)) {
                    return;
                }

                break;

            default:
                throw new Error("Unreachable");
        }

        // Get metadata for audio files
        let audioMetadata: MetadataForUpload[];

        switch (commandType) {
            case "single":
                const ffprobeMetadata = await getMetadataFromFfprobe(audioPaths[0]);

                const composer2 = composer ?? ffprobeMetadata.composer;
                const title2 = title ?? ffprobeMetadata.title;

                if (composer2 == null) {
                    await respond(interaction, {
                        content: "No composer provided!",
                        ephemeral: true,
                    });
                    return;
                }

                if (title2 == null) {
                    await respond(interaction, {
                        content: "No title provided!",
                        ephemeral: true,
                    });
                    return;
                }

                // If any FFprobe metadata was used, confirm that it's correct
                if (composer == null || title == null) {
                    if (!await confirm(interaction, `Does this metadata look correct?\n\nComposer: \`${composer2}\`\nTitle: \`${title2}\``)) {
                        return;
                    }
                }

                audioMetadata = [{
                    composer: composer2,
                    path: audioPaths[0],
                    title: title2,
                }];

                break;

            case "batch":
                const metadatas = await decideMetadataForUpload(interaction, audioPaths, composer ?? undefined);

                if (metadatas == null) {
                    return;
                }

                audioMetadata = metadatas;

                break;

            default:
                throw new Error("Unreachable");
        }

        // Check for existing games and correct possible typos
        const games = (await fetchHMAC<{ game: string }[]>(siteUrl("/api/tunicwilds/games"), "GET"))
            .map((group) => group.game);

        if (games.length > 0) {
            games.sort((a, b) =>
                levenshteinDistance(a.toLowerCase(), game.toLowerCase()) -
                levenshteinDistance(b.toLowerCase(), game.toLowerCase()),
            );

            // If the exact match for the game exists in the database, use it (with the database's capitalization)
            if (games[0].toLowerCase() === game.toLowerCase()) {
                game = games[0];
            }
            // If there are close matches in the database, ask the user if they want to use any
            else if (games.filter((g) => levenshteinDistance(g.toLowerCase(), game.toLowerCase()) <= 3).length > 0) {
                const choice = await simpleChoose(interaction, ["Add a new game", ...games.slice(0, 24)], "There are already games in the database that closely match the game you entered. Please confirm if you want to add a new game, or use one of the existing options:");

                if (choice == null) {
                    return;
                }

                if (choice !== "Add a new game") {
                    game = choice;
                }
            }

            // Check if any of the songs have already been uploaded for the selected game
            const existingSongs = await fetchHMAC<Tunicwild[]>(siteUrl(`/api/tunicwilds?game=${encodeURIComponent(game)}`), "GET");

            if (existingSongs.length > 0) {
                const existingTitles = existingSongs.map((song) => song.title.toLowerCase());
                const duplicates = audioMetadata.filter((metadata) => existingTitles.includes(metadata.title.toLowerCase()));

                if (duplicates.length > 0) {
                    if (commandType === "single") {
                        await respond(interaction, {
                            content: "This song has already been uploaded!",
                            flags: MessageFlags.Ephemeral,
                        });
                        return;
                    }

                    if (!await confirm(interaction, `The following titles already exist for **${game}**:\n${duplicates.map((metadata) => `- ${metadata.title}`).join("\n")}\nDo you want to continue uploading the remaining songs?`)) {
                        return;
                    }

                    audioMetadata = audioMetadata.filter((metadata) => !duplicates.includes(metadata));
                }
            }
        }

        // Upload the songs
        const successes: string[] = [];
        const failures: string[] = [];

        for (const metadata of audioMetadata) {
            try {
                const formData = new FormData();

                formData.set("discord", interaction.user.id);
                formData.set("file", new File([await openAsBlob(metadata.path)], basename(metadata.path)));
                formData.set("game", game);
                formData.set("title", metadata.title);
                formData.set("composer", metadata.composer);
                formData.set("releaseDate", new Date(releaseDate).toISOString().split("T")[0]);
                formData.set("officialLink", officialLink);

                await fetchHMAC(siteUrl("/api/tunicwilds"), "POST", formData);
                successes.push(metadata.title);
            } catch (error) {
                console.error(`Failed to upload ${metadata.path}:`, error);
                failures.push(metadata.title);
            }
        }

        // TODO better message for non-batch
        const resultMessage = [
            `Upload complete!`,
            successes.length > 0 && `✅ Successfully added:\n${successes.join("\n")}`,
            failures.length > 0 && `❌ Failed to add:\n${failures.join("\n")}`,
        ].filter(Boolean).join("\n");

        await respond(interaction, { content: resultMessage });
    }
}

export default command;
