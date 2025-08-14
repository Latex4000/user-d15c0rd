import { ChatInputCommandInteraction, InteractionContextType, SlashCommandBuilder, TextChannel } from "discord.js";
import { Command } from "./index.js";
import { mkdir, readdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
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

interface ParsedFilename {
    title: string;
    composer: string;
}

interface ParseConfig {
    regex?: RegExp;
    titleSegments?: number[];
    composerSegments?: number[];
}

// Checks if the audio file is actually mp3/wav/ogg/opus and extract metadata/ID3 tags if available
async function checkAudio(folder: string, interaction: ChatInputCommandInteraction, setComposer?: string | null, setTitle?: string | null): Promise<{ title: string, composer: string, filename: string }[]> {
    try {
        const files = await readdir(folder);
        const audioFiles = files.filter(file => {
            const ext = extname(file).toLowerCase();
            return ['.mp3', '.wav', '.ogg', '.opus'].includes(ext);
        });
        
        let parseConfig: ParseConfig | null = null;
        
        // If processing multiple files and neither title nor composer is set, ask for parsing preference
        if (audioFiles.length > 1 && (!setTitle || !setComposer)) {
            const parsingChoice = await simpleChoose(interaction, [
                "Use regex pattern",
                "Choose segments manually",
                "Auto split by '-' delimiter",
            ]);
            
            if (!parsingChoice)
                throw new Error("No parsing method selected");
            
            if (parsingChoice === "Use regex pattern")
                parseConfig = await getRegexConfig(interaction, audioFiles);
            else if (parsingChoice === "Choose segments manually")
                parseConfig = await getSegmentConfig(interaction, audioFiles[0]); // Use first file as example
        }
        
        const results = await Promise.all(
            audioFiles.map(async (file): Promise<{
                title: string;
                composer: string;
                filename: string;
            }> => {
                const filePath = join(folder, file);
                const ext = extname(file).toLowerCase();
                if (!['.mp3', '.wav', '.ogg', '.opus'].includes(ext))
                    throw new Error(`Unsupported audio format: ${ext}`);
                
                let title = setTitle;
                let composer = setComposer;
                
                if (title && composer)
                    return { title, composer, filename: filePath };

                // Extract metadata for supported formats
                const metadata = await new Promise<{ title?: string, artist?: string, composer?: string }>((resolve, reject) => {
                    exec(`ffprobe -v error -show_entries format_tags=title,artist,composer -of json "${filePath}"`, (error, stdout, stderr) => {
                        if (error) reject(error);
                            else {
                            try {
                                const parsed = JSON.parse(stdout);
                                resolve(parsed.format?.tags || {});
                            } catch (parseError) {
                                reject(parseError);
                            }
                        }
                    });
                });
                
                title = title || metadata.title || undefined;
                composer = composer || metadata.artist || metadata.composer || undefined;
                if (title && composer)
                    return { title, composer, filename: filePath };
                
                const parsed = await parseFilename(file, interaction, composer, parseConfig);
                return {
                    ...parsed,
                    filename: filePath
                };
            })
        );
        
        return results;
    } catch (error) {
        throw new Error(`Failed to read directory ${folder}: ${error}`);
    }
}

async function getRegexConfig(interaction: ChatInputCommandInteraction, audioFiles: string[]): Promise<ParseConfig> {
    const message = await interaction.followUp({
        content: `Please provide a regex pattern to parse the filenames. The pattern should have named groups 'title' and 'composer'.\n\nExample files:\n${audioFiles.slice(0, 3).map(f => `\`${basename(f, extname(f))}\``).join('\n')}\n\nExample regex: \`^(?<title>.+?)\\s*-\\s*(?<composer>.+?)$\`\n\nEnter your regex pattern:`
    });
    
    try {
        const response = await (interaction.channel as TextChannel).awaitMessages({
            filter: (m) => m.author.id === interaction.user.id,
            max: 1,
            time: 60000,
            errors: ['time']
        });
        
        if (!response?.first()?.content)
            throw new Error("No regex pattern provided");
        
        const regexStr = response.first()!.content.trim();
        const regex = new RegExp(regexStr);
        
        // Test the regex on the first file
        const testFile = basename(audioFiles[0], extname(audioFiles[0]));
        const testMatch = testFile.match(regex);
        
        if (!testMatch?.groups?.title || !testMatch?.groups?.composer)
            throw new Error("Regex pattern doesn't match expected groups 'title' and 'composer'");
        
        // Show preview of how it would parse the first few files
        const preview = audioFiles.slice(0, 3).map(file => {
            const cleanName = basename(file, extname(file));
            const match = cleanName.match(regex);
            return `\`${cleanName}\` → Title: "${match?.groups?.title || 'N/A'}", Composer: "${match?.groups?.composer || 'N/A'}"`;
        }).join('\n');
        
        const confirmMessage = await interaction.followUp({
            content: `Preview of regex parsing:\n${preview}\n\nIs this correct?`
        });
        
        const confirmed = await confirm(interaction, "Is this parsing correct?");
        await confirmMessage.delete();
        
        if (!confirmed)
            throw new Error("Regex parsing not confirmed");
        
        return { regex };
    } catch (error) {
        await message.delete();
        throw new Error(`Failed to get regex config: ${error}`);
    }
}

async function getSegmentConfig(interaction: ChatInputCommandInteraction, exampleFile: string): Promise<ParseConfig> {
    const cleanName = basename(exampleFile, extname(exampleFile));
    
    // Remove track numbers (patterns like "01.", "1 -", etc.)
    const withoutTrackNumbers = cleanName.replace(/^\d+[\.\-\s]+/, '');
    
    // Split by common delimiters
    const segments = withoutTrackNumbers.split(/[-_]/).map(part => part.trim()).filter(part => part.length > 0);
    
    if (segments.length < 2)
        throw new Error("Not enough segments to choose from");
    
    const segmentOptions = segments.map((segment, index) => `${index + 1}. ${segment}`);
    
    const message = await interaction.followUp({
        content: `Example file: \`${cleanName}\`\nSegments found:\n${segmentOptions.join('\n')}\n\nWhich segments should be used for the **title**? (comma-separated numbers, e.g., "1,2")`
    });
    
    try {
        const titleResponse = await (interaction.channel as TextChannel).awaitMessages({
            filter: (m) => m.author.id === interaction.user.id,
            max: 1,
            time: 60000,
            errors: ['time']
        });
        
        if (!titleResponse?.first()?.content)
            throw new Error("No title segments provided");
        
        const titleSegments = titleResponse.first()!.content.trim().split(',').map(n => parseInt(n.trim()) - 1);
        
        const composerMessage = await interaction.followUp({
            content: `Which segments should be used for the **composer**? (comma-separated numbers, e.g., "3")`
        });
        
        const composerResponse = await (interaction.channel as TextChannel).awaitMessages({
            filter: (m) => m.author.id === interaction.user.id,
            max: 1,
            time: 60000,
            errors: ['time']
        });
        
        if (!composerResponse?.first()?.content)
            throw new Error("No composer segments provided");
        
        const composerSegments = composerResponse.first()!.content.trim().split(',').map(n => parseInt(n.trim()) - 1);
        
        // Validate segments
        const maxIndex = segments.length - 1;
        const invalidTitle = titleSegments.some(i => i < 0 || i > maxIndex);
        const invalidComposer = composerSegments.some(i => i < 0 || i > maxIndex);
        
        if (invalidTitle || invalidComposer)
            throw new Error("Invalid segment numbers provided");
        
        // Show preview
        const titlePreview = titleSegments.map(i => segments[i]).join(' ');
        const composerPreview = composerSegments.map(i => segments[i]).join(' ');
        
        const previewMessage = await interaction.followUp({
            content: `Preview: Title: "${titlePreview}", Composer: "${composerPreview}"\n\nIs this correct?`
        });
        
        const confirmed = await confirm(interaction, "Is this segment selection correct?");
        await previewMessage.delete();
        await message.delete();
        await composerMessage.delete();
        
        if (!confirmed)
            throw new Error("Segment selection not confirmed");
        
        return { titleSegments, composerSegments };
    } catch (error) {
        await message.delete();
        throw new Error(`Failed to get segment config: ${error}`);
    }
}

async function parseFilename(filename: string, interaction: ChatInputCommandInteraction, composer?: string | null, parseConfig?: ParseConfig | null): Promise<ParsedFilename> {
    let cleanName = basename(filename, extname(filename));
    
    // Remove track numbers (patterns like "01.", "1 -", etc.)
    cleanName = cleanName.replace(/^\d+[\.\-\s]+/, '');
    
    // If we have a regex config, use it
    if (parseConfig?.regex) {
        const match = cleanName.match(parseConfig.regex);
        if (match?.groups?.title && match?.groups?.composer) {
            return {
                title: match.groups.title.trim(),
                composer: composer || match.groups.composer.trim()
            };
        }
        throw new Error(`Regex pattern didn't match filename: ${filename}`);
    }
    
    // If we have segment config, use it
    if (parseConfig?.titleSegments && parseConfig?.composerSegments) {
        const segments = cleanName.split(/[-_]/).map(part => part.trim()).filter(part => part.length > 0);
        
        const title = parseConfig.titleSegments.map(i => segments[i]).filter(s => s).join(' ');
        const composerFromSegments = parseConfig.composerSegments.map(i => segments[i]).filter(s => s).join(' ');
        
        if (!title)
            throw new Error(`Could not extract title from filename: ${filename}`);
        
        return {
            title,
            composer: composer || composerFromSegments || 'Unknown'
        };
    }
    
    // Fall back to original individual parsing logic
    const parts = cleanName.split(/[-_]/).map(part => part.trim()).filter(part => part.length > 0);

    if (parts.length === 0)
        throw new Error(`No valid parts found in filename: ${filename}`);
    if (parts.length === 1) {
        if (composer && await confirm(interaction, `The filename only contains one part: \`${parts[0]}\`. Do you want to use this as the title and the composer as \`${composer}\`?`))
            return { title: parts[0], composer: composer };
        throw new Error(`Filename \`${filename}\` does not contain enough information to extract title and composer. Please provide them manually.`);
    }

    if (parts.length === 2) {
        // Ask them if it's title - composer or composer - title
        const message = await interaction.followUp({
            content: `The filename \`${filename}\` contains two parts: \`${parts[0]}\` and \`${parts[1]}\`. Are they \`Title - Composer\` or \`Composer - Title\`?`,
        });
        const res = await simpleChoose(interaction, ["Title - Composer", "Composer - Title"]);
        await message.delete();
        if (!res)
            throw new Error(`User did not choose a valid option for filename \`${filename}\``);
        return res === "Title - Composer" ? { title: parts[0], composer: composer || parts[1] } : { title: parts[1], composer: composer || parts[0] };
    }

    throw new Error(`Filename \`${filename}\` has too many parts to automatically determine title and composer. Please use regex or segment selection.`);
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
        const audio = interaction.options.getAttachment("audio");
        let game = interaction.options.getString("game");
        const releaseDate = interaction.options.getString("release_date");
        const officialLink = interaction.options.getString("official_link");
        const title = interaction.options.getString("title");
        const composer = interaction.options.getString("composer");

        if (!audio || !game || !releaseDate || !officialLink) {
            await respond(interaction, { content: "You must provide an audio file, game name, release date, and official link", ephemeral: true });
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
            title: string;
            composer: string;
            filename: string;
        }[] = [];

        try {
            audioFiles = await checkAudio(folder, interaction, composer, title);
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
        
                    formData.set("discord", interaction.user.id);
                    formData.set("file", file);
                    formData.set("game", game);
                    formData.set("title", audioFile.title);
                    formData.set("composer", audioFile.composer);
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
                successes.length > 0 ? `✅ Successfully added:\n${successes.join("\n")}` : "",
                failures.length > 0 ? `❌ Failed to add:\n${failures.join("\n")}` : ""
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
                
                formData.set("discord", interaction.user.id);
                formData.set("file", file);
                formData.set("game", game);
                formData.set("title", title || audioFiles[0].title);
                formData.set("composer", composer || audioFiles[0].composer);
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
            await rm(folder, { recursive: true, force: true });
        } catch (error) {
            console.warn(`Failed to clean up temporary files: ${error}`);
        }
    }
}

export default command;
