// Recompile static HTML and optional review previews from shared shell + structured content. Sends nothing.
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import catalog from "../lib/email-templates.json" with { type: "json" };
import {
	normalizeEmailDesign,
	renderEmailDesign,
} from "../lib/email-design.js";
import { renderEmail, UNSUBSCRIBE_PLACEHOLDER } from "../lib/render-email.js";
import { personalize } from "../lib/personalization.js";
const previewDir = process.argv.includes("--preview-dir")
	? process.argv[process.argv.indexOf("--preview-dir") + 1]
	: null;
for (const template of catalog) {
	const base = new URL(
		`../public/email-templates/${template.id}`,
		import.meta.url,
	);
	const design = normalizeEmailDesign(
		JSON.parse(await readFile(`${base.pathname}.json`, "utf8")),
	);
	const html = renderEmailDesign(design);
	await writeFile(`${base.pathname}.html`, html);
	if (previewDir) {
		const rendered = renderEmail({
			...template,
			format: "html",
			html,
			newsletter: { postalAddress: "Exempeladress, Sverige" },
		});
		await writeFile(
			resolve(previewDir, `${template.id}.html`),
			personalize(
				rendered.html,
				{},
				"https://kamadosumo.com/cart/",
				true,
			).replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#unsubscribe-preview"),
		);
	}
}
console.log(`Compiled ${catalog.length} visual templates; no email sent`);
