import { Member } from "./member.js";
import { Thing } from "./thing.js";

export interface Sound extends Thing {
    youtubeUrl: string;
    soundcloudUrl: string;
    memberDiscord: Member['discord'];
    date: string;
}