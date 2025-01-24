import config from "./config.js";

export default function htmlGenerator(alias: string) {
    return `\`\`\`html
<div class="${config.collective.name_condensed}Webring">
    <a href="${config.collective.site_url}" title="Collective">${config.collective.name}</a>
    <div class="${config.collective.name_condensed}WebringButtons">
        <a href="${config.collective.site_url}/ring?action=prev&amp;from=${alias}" title="Previous">←</a>
        <a href="${config.collective.site_url}/ring?action=rand&amp;from=${alias}" title="Random">Random</a>
        <a href="${config.collective.site_url}/ring?action=next&amp;from=${alias}" title="Next">→</a>
    </div>
</div>
\`\`\``;
}