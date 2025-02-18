import { Thing } from "./thing.js";

export interface Motion extends Thing {
    youtubeUrl: string;
    date: Date;
    tags: string[];
}