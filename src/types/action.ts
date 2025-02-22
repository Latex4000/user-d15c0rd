import { Thing } from "./thing.js";

export interface Action extends Thing {
    title: string;
    description: string;
    url: string;
    siteUrl: string;
    isRSS: boolean;
}