import { Member } from "./member.js";

export interface Motion {
    title: string;
    youtubeUrl: string;
    memberDiscord: Member["discord"];
    date: Date;
    tags: string[];
}