import { Member } from "./member.js";

export interface Word {
    date: Date;
    memberDiscord: Member['discord'];
    tags: string[];
    title: string;
}