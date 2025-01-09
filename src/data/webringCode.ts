export interface Member {
    discord: string;
    alias: string;
    aliasEncoded: string;
    site: string;
    addedRingToSite: boolean;
} 

export function webringJS (sites: Member[]): string {
    return `(()=>{let e=${JSON.stringify(sites)};if(!Array.isArray(e))return;e=e.filter((e=>e.addedRingToSite));const t=e.findIndex((e=>e.aliasEncoded===document.getElementById("latex4000Webring").dataset.alias.toLowerCase()));if(-1===t)return;document.getElementById("latex4000Prev").href=e[(t-1+e.length)%e.length].site;const n=n=>{let r=Math.floor(Math.random()*(e.length-1));r>=t&&r++,n.currentTarget.href=e[r].site},r=document.getElementById("latex4000Random");r.addEventListener("click",n),r.addEventListener("auxclick",n),document.getElementById("latex4000Next").href=e[(t+1)%e.length].site})();`
}