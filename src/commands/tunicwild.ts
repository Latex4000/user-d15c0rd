import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder } from "discord.js";
import { Command } from "./index.js";
import { mkdir, readdir, readFile, unlink, writeFile } from "node:fs/promises";
import { respond } from "../index.js";
import { exec } from "node:child_process";
import { createHash } from "node:crypto";
import AdmZip from "adm-zip";
import { fetchHMAC } from "../fetch.js";
import { basename, extname, join } from "node:path";
import { siteUrl } from "../config.js";
import confirm from "../confirm.js";
import { levenshteinDistance } from "../levenshtein.js";
import { simpleChoose } from "../choose.js";
import { Tunicwild } from "../types/tunicwild.js";

// Checks if the audio file is actually mp3/wav/ogg/opus and extract metadata/ID3 tags if available
async function checkAudio(folder: string): Promise<{ title?: string, composer?: string, filename: string }[]> {
    try {
        const files = await readdir(folder);
        const audioFiles = files.filter(file => {
            const ext = extname(file).toLowerCase();
            return ['.mp3', '.wav', '.ogg', '.opus'].includes(ext);
        });
        
        const results = await Promise.all(
            audioFiles.map(async (file) => {
                const filePath = join(folder, file);
                const ext = extname(file).toLowerCase();
                
                let title: string | undefined;
                let composer: string | undefined;
                
                // Extract metadata for supported formats
                if (['.mp3', '.wav', '.ogg', '.opus'].includes(ext)) {
                    try {
                        const metadata = await new Promise<string>((resolve, reject) => {
                            exec(`ffprobe -v error -show_entries format_tags=title,composer -of default=noprint_wrappers=1:nokey=1 "${filePath}"`, (error, stdout, stderr) => {
                                if (error) reject(error);
                                else resolve(stdout);
                            });
                        });
                        
                        const tags = metadata.split("\n").filter(line => line.trim() !== "");
                        title = tags[0] || parseFilenameTitle(filePath);
                        composer = tags[1] || undefined;
                    } catch (error) {
                        console.warn(`Failed to extract metadata from ${filePath}:`, error);
                    }
                }
                
                return { title, composer, filename: filePath };
            })
        );
        
        return results;
    } catch (error) {
        throw new Error(`Failed to read directory ${folder}: ${error}`);
    }
}

function parseFilenameTitle(filename: string): string {
    let title = basename(filename, extname(filename));
    
    // Common filename patterns to clean up
    title = title
        .replace(/^\d{1,3}[\.\-_\s]+/, '')
        .replace(/^(track|song)[\.\-_\s]+/i, '')
        .replace(/[_\.]/g, ' ')
        .replace(/-+/g, ' - ')
        .replace(/\s+/g, ' ')
        .trim();
    
    // If title is empty after cleaning, use original filename without extension
    if (!title)
        title = basename(filename, extname(filename));
    
    return title;
}

function getContentType(filename: string): string {
    const ext = extname(filename).toLowerCase();
    switch (ext) {
        case '.mp3': return 'audio/mpeg';
        case '.wav': return 'audio/wav';
        case '.ogg': return 'audio/ogg';
        case '.opus': return 'audio/opus';
        default: return 'audio/mpeg';
    }
}

const command: Command = {
    data: new SlashCommandBuilder()
        .setName("tunicwild")
        .setDescription("Add a song/songs to the indie game heardle")
        .addSubcommand(subcommand =>
            subcommand
                .setName("batch")
                .setDescription("Add a batch of songs to the indie game heardle")
                .addAttachmentOption(option =>
                    option
                        .setName("audio")
                        .setDescription("The batch of audio files in a zip file (must be mp3 or wav)")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("game")
                        .setDescription("The game the song is from")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("extra_hint")
                        .setDescription("An extra hint for the song")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("release_date")
                        .setDescription("Release date of the song/game (YYYY-MM-DD)")
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName("official_link")
                        .setDescription("An official link to the song/game's OST")
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName("composer")
                        .setDescription("The composer of the song"))
                        
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName("single")
                .setDescription("Add a single song to the indie game heardle")
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
                        .setName("extra_hint")
                        .setDescription("An extra hint for the song")
                        .setRequired(true))
                .addStringOption(option =>
                    option
                        .setName("release_date")
                        .setDescription("Release date of the song/game (YYYY-MM-DD)")
                        .setRequired(false))
                .addStringOption(option =>
                    option
                        .setName("official_link")
                        .setDescription("An official link to the song/game's OST")
                        .setRequired(false))
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
            InteractionContextType.PrivateChannel
        ]),
    run: async (interaction: ChatInputCommandInteraction) => {
        await interaction.deferReply();

        if (!interaction.channel?.isSendable()) {
            // WHAT?
            await respond(interaction, { content: "I cannot send messages in this channel", ephemeral: true });
            return;
        }

        const commandType = interaction.options.getSubcommand();
        const audio = interaction.options.getAttachment("audio");
        let game = interaction.options.getString("game");
        const releaseDate = interaction.options.getString("release_date");
        const officialLink = interaction.options.getString("official_link");
        const extraHint = interaction.options.getString("extra_hint");
        const title = interaction.options.getString("title");
        const composer = interaction.options.getString("composer");

        if (!audio || !game || !extraHint || !releaseDate || !officialLink) {
            await respond(interaction, { content: "You must provide an audio file, game name, extra hint, release date, and official link", ephemeral: true });
            return;
        }

        // Check if the audio file is an mp3 or wav or ogg or opus
        if (commandType === "single" && !audio.name.endsWith(".mp3") && !audio.name.endsWith(".wav") && !audio.name.endsWith(".ogg") && !audio.name.endsWith(".opus")) {
            await respond(interaction, { content: "The audio file param must be an mp3, wav, ogg, or opus file for the \`single\` subcommand", ephemeral: true });
            return;
        }

        if (commandType === "batch" && !audio.name.endsWith(".zip")) {
            await respond(interaction, { content: "The audio file param must be a zip file for the \`batch\` subcommand", ephemeral: true });
            return;
        }

        await mkdir(".tmp", { recursive: true });

        const folder = `./.tmp/${createHash("sha256").update(audio.url).digest("hex")}`;
        try {
            await mkdir(folder, { recursive: true });
        } catch (error) {
            await respond(interaction, { content: `Failed to create temporary folder: ${error}`, ephemeral: true });
            return;
        }

        const response = await fetch(audio.url);
        if (!response.ok) {
            await respond(interaction, { content: `Failed to download audio file: ${response.statusText}`, ephemeral: true });
            return;
        }

        if (commandType === "single") {
            const filePath = `${folder}/${audio.name}`;
            await writeFile(filePath, await response.arrayBuffer().then(buffer => Buffer.from(buffer)));
        } else if (commandType === "batch") {
            const buffer = await response.arrayBuffer();

            const zip = new AdmZip(Buffer.from(buffer));
            const entries = zip.getEntries();
            for (const entry of entries) {
                if (!entry.isDirectory && (entry.entryName.endsWith(".mp3") || entry.entryName.endsWith(".wav") || entry.entryName.endsWith(".ogg") || entry.entryName.endsWith(".opus"))) {
                    const filePath = `${folder}/${entry.entryName}`;
                    await writeFile(filePath, entry.getData());
                }
            }
        }

        let audioFiles: {
            title?: string;
            composer?: string;
            filename: string;
        }[] = [];

        try {
            audioFiles = await checkAudio(folder);
        } catch (error) {
            await respond(interaction, { content: `Failed to check audio files: ${error}`, ephemeral: true });
            return;
        }

        if (audioFiles.length === 0) {
            await respond(interaction, { content: "No valid audio files found in the provided zip file", ephemeral: true });
            return;
        }
        if (audioFiles.length > 1 && commandType === "single") {
            await respond(interaction, { content: "You can only add one song at a time with the single command", ephemeral: true });
            return;
        }

        if (commandType === "batch") {
            const confirmation = await confirm(interaction, `You are about to add ${audioFiles.length} songs to the game **${game}**. Do you want to proceed?`);
            if (!confirmation) {
                return;
            }
        }

        // Check if game exists/if it's a typo of a currently existing game
        const games = await fetchHMAC<{game: string}[]>(siteUrl(`/api/tunicwilds/games`), "GET").then(res => res.map(g => g.game));
        if (games.length) {
            games.sort((a, b) => levenshteinDistance(a.toLowerCase(), game!.toLowerCase()) - levenshteinDistance(b.toLowerCase(), game!.toLowerCase()));

            if (levenshteinDistance(games[0].toLowerCase(), game.toLowerCase()) === 0) {
                // Exact match found
                if (!await confirm(interaction, `Are you sure you want to add the song(s) to the game **${games[0]}**?`))
                    return;
                game = games[0];
            } else if (games.filter(g => levenshteinDistance(g.toLowerCase(), game!.toLowerCase()) <= 3).length > 0) {
                const res = await simpleChoose(interaction, ["New Game", ...games]);
                if (!res)
                    return;

                if (res === "New Game") {
                    if (!await confirm(interaction, `Are you sure you want to add the song(s) to a new game called **${game}**?`))
                        return;
                } else {
                    if (!await confirm(interaction, `Are you sure you want to add the song(s) to the game **${res}**?`))
                        return;
                    game = res;
                }
            }

            // Now check if this song already exists in the game
            const existingSongs = await fetchHMAC<Tunicwild[]>(siteUrl(`/api/tunicwilds?game=${encodeURIComponent(game)}`), "GET");
            if (existingSongs.length > 0) {
                const existingTitles = existingSongs.map(song => song.title?.toLowerCase()).filter(title => title);
                const newTitles = audioFiles.map(song => ({...song, title: song.title?.toLowerCase() }));

                const duplicates = newTitles.filter(title => title.title && existingTitles.includes(title.title));
                if (duplicates.length > 0) {
                    if (!await confirm(interaction, `The following titles already exist in the game **${game}**: ${duplicates.join(", ")}. Do you want to proceed with those songs deleted?`))
                        return;

                    // Delete the duplicates from the folder
                    for (const song of duplicates) {
                        const filePath = join(folder, song.filename);
                        try {
                            await unlink(filePath);
                        } catch (error) {
                            console.warn(`Failed to delete duplicate file ${filePath}:`, error);
                        }
                    }
                }
            }
        } else {
            if (!await confirm(interaction, `No songs found for this game. Are you sure you want to add the song(s) to a new game called **${game}**?`))
                return;
        }

        if (commandType === "batch") {
            const successes: string[] = [];
            const failures: string[] = [];
        
            for (const audioFile of audioFiles) {
                try {
                    const formData = new FormData();
                    
                    // Read the actual file content
                    const fileBuffer = await readFile(audioFile.filename);
                    const fileName = basename(audioFile.filename);
                    const blob = new Blob([fileBuffer]);
                    const file = new File([blob], fileName, { 
                        type: getContentType(fileName) 
                    });
        
                    formData.set("file", file);
                    formData.set("game", game);
                    formData.set("extraHint", extraHint);
                    formData.set("title", audioFile.title || parseFilenameTitle(audioFile.filename));
                    formData.set("composer", audioFile.composer || composer || "Unknown");
                    formData.set("releaseDate", new Date(releaseDate).toISOString().split("T")[0]);
                    formData.set("officialLink", officialLink);
        
                    await fetchHMAC(siteUrl(`/api/tunicwilds`), "POST", formData);
                    successes.push(audioFile.title || fileName);
                } catch (error) {
                    console.error(`Failed to upload ${audioFile.filename}:`, error);
                    failures.push(audioFile.title || basename(audioFile.filename));
                }
            }
        
            const resultMessage = [
                `Upload complete!`,
                successes.length > 0 ? `✅ Successfully added: ${successes.join(", ")}` : "",
                failures.length > 0 ? `❌ Failed to add: ${failures.join(", ")}` : ""
            ].filter(Boolean).join("\n");
        
            await respond(interaction, { content: resultMessage });
        } else {
            // Single file upload
            try {
                const formData = new FormData();
                
                // Read the actual file content
                const fileBuffer = await readFile(audioFiles[0].filename);
                const blob = new Blob([fileBuffer]);
                const file = new File([blob], audio.name, { 
                    type: getContentType(audio.name) 
                });
        
                formData.set("file", file);
                formData.set("game", game);
                formData.set("extraHint", extraHint);
                formData.set("title", title || audioFiles[0].title || parseFilenameTitle(audio.name));
                formData.set("composer", composer || audioFiles[0].composer || "Unknown");
                formData.set("releaseDate", new Date(releaseDate).toISOString().split("T")[0]);
                formData.set("officialLink", officialLink);
        
                await fetchHMAC(siteUrl(`/api/tunicwilds`), "POST", formData);
                await respond(interaction, { content: `Successfully added song to **${game}**!` });
            } catch (error) {
                await respond(interaction, { content: `Failed to add song: ${error}` });
            }
        }

        // Clean up the temporary folder
        try {
            await unlink(folder);
        } catch (error) {
            console.warn(`Failed to clean up temporary files: ${error}`);
        }
    }
}

export default command;
