import * as config from "../config.json";

export default function htmlGenerator(site: string) {
    return `\`\`\`html
    <div class="${config.collective.name_condensed}Webring">
        <a href="${config.collective.site_url}" title="Collective">${config.collective.name}</a>
        <div class="${config.collective.name_condensed}WebringButtons">
            <a href="/ring?action=prev&from=${site}" title="Previous">←</a>
            <a href="/ring?action=rand&from=${site}" title="Random">Random</a>
            <a href="/ring?action=next&from=${site}" title="Next">→</a>
        </div>
    </div>
\`\`\``;
}