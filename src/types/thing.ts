import { Member } from "./member.js";

export interface Thing {
    id: number;
    title: string;
    memberDiscord: Member["discord"];
}

export const Things = ["sights", "words", "sounds", "motions"] as const;

export type ThingType = typeof Things[number];

export const ThingVisibilityChoices = [
    { name: "Post With Colour", value: "normal" },
    { name: "Post Without Colour", value: "no_colour" },
    { name: "Post Fully Anonymously", value: "anonymous" }
] 

export const ThingVisibility = ["normal", "no_colour", "anonymous"] as const;

export type ThingVisibilityType = typeof ThingVisibility[number];