import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
	listEmailTemplates,
	loadEmailTemplate,
} from "../lib/email-templates.js";
import { renderEmail, UNSUBSCRIBE_PLACEHOLDER } from "../lib/render-email.js";
import { personalize } from "../lib/personalization.js";
import { normalizeDefinition } from "../lib/automation-rules.js";

const newsletter = {
	name: "Kamado Sumo",
	postalAddress: "Street <7> & Co\nStockholm",
};
const templates = listEmailTemplates({ trigger: "cart.abandoned" });

test("cart templates are available only for cart journeys", () => {
	assert.equal(templates.length, 15);
	assert.equal(listEmailTemplates({ campaign: true }).length, 11);
	assert.equal(listEmailTemplates({ trigger: "order.paid" }).length, 11);
	assert.equal(listEmailTemplates({ trigger: "subscribed" }).length, 11);
	assert.equal(new Set(templates.map((t) => t.id)).size, 15);
});

for (const template of templates) {
	test(`${template.id}: portable HTML renders with real address, safe customer and working placeholders`, async () => {
		const html = await readFile(
			new URL(`../public/email-templates/${template.id}.html`, import.meta.url),
			"utf8",
		);
		assert.ok(Buffer.byteLength(html) < 80000);
		assert.doesNotMatch(html, /\*\||mc:edit|\u2014|\.\.\/assets|\.webp/i);
		assert.match(
			html,
			new RegExp(
				`<html lang="${template.language === "en" ? "en" : "sv"}" dir="ltr"`,
			),
		);
		assert.match(html, /<table lang="(?:sv|en)" dir="ltr" role="presentation"/);
		assert.equal((html.match(/<h1\b/g) || []).length, 1);
		assert.ok(
			[...html.matchAll(/<img\b[^>]*>/g)].every(([tag]) =>
				/\balt="[^"]+"/.test(tag),
			),
		);
		assert.match(html, /logo-with-slogan\.png/);
		assert.match(html, /kamado-sumo-email-footer\.jpg/);
		assert.match(html, /padding:0;/);
		assert.match(html, /\{\{postal_address\}\}/);
		assert.equal((html.match(/\{\{unsubscribe_url\}\}/g) || []).length, 1);
		assert.equal(html.includes("{{checkoutUrl}}"), template.cartOnly);
		const campaign = { ...template, html, format: "html" };
		const rendered = renderEmail({ ...campaign, newsletter });
		assert.match(rendered.html, /Street &lt;7&gt; &amp; Co<br>Stockholm/);
		assert.ok(rendered.text.includes("Street <7> & Co"));
		assert.ok(rendered.text.includes("Kamado Sumo"));
		assert.ok(rendered.html.includes(`<title>${template.subject}</title>`));
		assert.doesNotMatch(
			rendered.html,
			/\{\{(?:postal_address|subject|preview_text)\}\}/,
		);
		assert.equal(
			(rendered.html.match(/\{\{unsubscribe_url\}\}/g) || []).length,
			1,
			"no second fallback footer",
		);
		const filled = personalize(
			rendered.html,
			{ firstName: '<img src=x onerror="alert(1)">' },
			"https://kamadosumo.com/cart/?token=abc&lang=sv",
			true,
		).replaceAll(
			UNSUBSCRIBE_PLACEHOLDER,
			"https://mail.example.com/unsubscribe/signed",
		);
		assert.doesNotMatch(filled, /\{\{|\*\|/);
		assert.match(filled, /https:\/\/mail\.example\.com\/unsubscribe\/signed/);
		if (template.cartOnly)
			assert.equal(
				(
					filled.match(
						/href="https:\/\/kamadosumo\.com\/cart\/\?token=abc&amp;lang=sv"/g,
					) || []
				).length,
				2,
				"HTML and Outlook buttons use the same real cart URL",
			);
		assert.doesNotThrow(() =>
			normalizeDefinition({
				start: "email",
				nodes: [
					{
						id: "email",
						type: "email",
						label: "Test",
						next: "end",
						...campaign,
					},
					{ id: "end", type: "end" },
				].map((node, i) => ({ ...node, id: i ? "end" : "email" })),
			}),
		);
	});
}

test("template loading rejects incompatible or unknown IDs before fetching", async () => {
	await assert.rejects(
		loadEmailTemplate("../../private"),
		/available template/,
	);
	await assert.rejects(
		loadEmailTemplate("cart-sv", { campaign: true }),
		/available template/,
	);
});

test("language choice is a real email reply, not an unsupported profile page", async () => {
	const html = await readFile(
		new URL(
			"../public/email-templates/preferences-sv-en.html",
			import.meta.url,
		),
		"utf8",
	);
	assert.match(html, /mailto:info@kamadosumo.com\?subject=/);
	assert.doesNotMatch(html, /UPDATE_PROFILE|ARCHIVE/);
});
