import { Thing } from "./thing.js";

export interface Sound extends Thing {
    youtubeUrl: string;
    soundcloudUrl: string;
    date: string;
}