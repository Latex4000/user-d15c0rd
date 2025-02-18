import { Thing } from "./thing.js";

export interface Sight extends Thing {
    description: string;
    date: Date;
    tags: string[];
}