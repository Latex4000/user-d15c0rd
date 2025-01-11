
import * as config from "../../config.json";

export interface Member {
    discord: string;
    alias: string;
    aliasEncoded: string;
    site: string;
    addedRingToSite: boolean;
}

const mainSite: Member = {
    discord: "",
    alias: config.collective.name,
    aliasEncoded: config.collective.name_condensed,
    site: config.collective.site_url,
    addedRingToSite: true,
}

export function webringJS (sites: Member[]): string {
    return `(()=>{let e=${JSON.stringify([mainSite, ...sites])};if(!Array.isArray(e))return;e=e.filter((e=>e.addedRingToSite));const t=e.findIndex((e=>e.aliasEncoded===document.getElementById("${config.collective.name_condensed}Webring").dataset.alias.toLowerCase()));if(-1===t)return;document.getElementById("${config.collective.name_condensed}Prev").href=e[(t-1+e.length)%e.length].site;let n=Math.floor(Math.random()*(e.length-1));n>=t&&n++;document.getElementById("${config.collective.name_condensed}Random").href=e[n].site;document.getElementById("${config.collective.name_condensed}Next").href=e[(t+1)%e.length].site})();`
}