
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
    return `(()=>{let e=${JSON.stringify([mainSite, ...sites])};if(!Array.isArray(e))return;e=e.filter((e=>e.addedRingToSite));const t=e.findIndex((e=>e.aliasEncoded===document.getElementById("latex4000Webring").dataset.alias.toLowerCase()));if(-1===t)return;document.getElementById("latex4000Prev").href=e[(t-1+e.length)%e.length].site;const n=n=>{let r=Math.floor(Math.random()*(e.length-1));r>=t&&r++,n.currentTarget.href=e[r].site},r=document.getElementById("latex4000Random");r.addEventListener("load",n),document.getElementById("latex4000Next").href=e[(t+1)%e.length].site})();`
}