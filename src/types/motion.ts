import { Member } from "./member.js";
import { Thing } from "./thing.js";

export interface Motion extends Thing {
    youtubeUrl: string;
    memberDiscord: Member["discord"];
    date: Date;
    tags: string[];
}