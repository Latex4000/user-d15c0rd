import { Member } from "./member.js";

export interface Thing {
    id: number;
    title: string;
    memberDiscord: Member["discord"];
}

export type ThingType = "sounds" | "words" | "motions";