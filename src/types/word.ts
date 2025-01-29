import { Member } from "./member.js";
import { Thing } from "./thing.js";

export interface Word extends Thing {
    date: Date;
    memberDiscord: Member['discord'];
    tags: string[];
}