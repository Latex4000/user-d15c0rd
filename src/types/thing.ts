import { Member } from "./member.js";

export interface Thing {
    id: number;
    title: string;
    memberDiscord: Member["discord"];
}

export const Things = ["actions", "sights", "words", "sounds", "motions"] as const;

export type ThingType = typeof Things[number];