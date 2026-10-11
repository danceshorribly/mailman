import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
	normalizeEmailDesign,
	renderEmailDesign,
	renderEmailBlock,
	safeEmailUrl,
	sanitizeEmailText,
	moveEmailBlock,
	newEmailBlock,
} from "../lib/email-design.js";
import {
	listEmailTemplates,
	loadEmailTemplate,
} from "../lib/email-templates.js";
import { normalizeDefinition } from "../lib/automation-rules.js";
import Campaign from "../models/Campaign.js";
const design = () => ({
	version: 1,
	language: "sv",
	blocks: [
		{
			id: "title",
			type: "heading",
			level: 1,
			title: "Hej <Sumo> & vänner",
			kicker: "Välkommen",
		},
		{
			id: "copy",
			type: "text",
			html: "<p>Text &amp; <strong>format</strong></p>",
		},
		{
			id: "cta",
			type: "button",
			label: "Till varukorgen",
			url: "{{checkoutUrl}}",
		},
	],
});

test("visual designs round trip, keep formatting and escape headings", () => {
	const normalized = normalizeEmailDesign(design());
	assert.deepEqual(
		normalizeEmailDesign(JSON.parse(JSON.stringify(normalized))),
		normalized,
	);
	const html = renderEmailDesign(normalized);
	assert.match(html, /Hej &lt;Sumo&gt; &amp; vänner/);
	assert.match(html, /Text &amp; <strong>format<\/strong>/);
	assert.match(html, /\{\{unsubscribe_url\}\}/);
	assert.equal((html.match(/href="\{\{checkoutUrl\}\}"/g) || []).length, 2);
});

test("visual text removes executable markup, attributes and unsafe destinations", () => {
	const cleaned = sanitizeEmailText(
		'<script>alert(1)</script><p onclick="bad()">Hej <strong style="color:red">du</strong><img src="https://example.com/a" onerror="bad()"><svg onload="bad()"></svg><a href="javascript:bad()">bad</a><a href="https://example.com/?a=1&amp;b=2" target="x">safe</a></p>',
	);
	assert.doesNotMatch(
		cleaned,
		/script|onclick|style=|onerror|svg|javascript|target=|<img/,
	);
	assert.match(cleaned, /href="https:\/\/example.com\/\?a=1&amp;b=2"/);
	assert.equal(sanitizeEmailText(cleaned), cleaned);
	for (const payload of [
		"<scr<script>ipt>alert(1)</scr</script>ipt>",
		'<img_ onerror="bad()">',
		'<a href="https://example.com/&#34;onclick=bad()">x</a>',
	])
		assert.doesNotMatch(
			sanitizeEmailText(payload),
			/<script|"\s+onclick=|"\s+onerror=/,
		);
});

test("only public HTTPS images and safe links can be saved", () => {
	for (const url of [
		"javascript:alert(1)",
		"data:image/svg+xml,a",
		"//example.com",
		"http://example.com",
		"https://user:pass@example.com",
		"https://exa\nmple.com",
	])
		assert.equal(safeEmailUrl(url), "");
	assert.equal(safeEmailUrl("{{checkoutUrl}}", true), "");
	assert.equal(
		safeEmailUrl("mailto:info@kamadosumo.com"),
		"mailto:info@kamadosumo.com",
	);
	const input = design();
	input.blocks[2].url = "javascript:bad()";
	assert.throws(() => normalizeEmailDesign(input), /HTTPS/);
	assert.equal(
		renderEmailBlock(input.blocks[2]),
		"",
		"invalid links stay inert in the editor",
	);
});

test("invalid, duplicate and oversized designs are rejected", () => {
	for (const patch of [
		{ version: 2 },
		{ language: "xx" },
		{ blocks: [] },
		{ blocks: Array(41).fill(design().blocks[0]) },
	])
		assert.throws(() => normalizeEmailDesign({ ...design(), ...patch }));
	const invalidId = design();
	invalidId.blocks[0].id = null;
	assert.throws(() => normalizeEmailDesign(invalidId), /Invalid/);
	const duplicate = design();
	duplicate.blocks.push(duplicate.blocks[0]);
	assert.throws(() => normalizeEmailDesign(duplicate), /duplicate/);
	const headings = design();
	headings.blocks.push({ ...headings.blocks[0], id: "second" });
	assert.throws(() => normalizeEmailDesign(headings), /main title/);
	assert.throws(
		() => normalizeEmailDesign({ ...design(), unwanted: "x".repeat(80000) }),
		/too large/,
	);
});

test("reordering preserves all block content and supports both directions", () => {
	const blocks = design().blocks;
	assert.deepEqual(
		moveEmailBlock(blocks, "cta", "title").map((b) => b.id),
		["cta", "title", "copy"],
	);
	assert.deepEqual(
		moveEmailBlock(blocks, "title", "cta", true).map((b) => b.id),
		["copy", "cta", "title"],
	);
	assert.equal(moveEmailBlock(blocks, "missing", "title"), blocks);
	for (const type of ["heading", "text", "image", "button", "product"])
		assert.doesNotThrow(() =>
			normalizeEmailDesign({
				version: 1,
				language: "en",
				blocks: [newEmailBlock(type, "en")],
			}),
		);
});

test("automation save compiles the design instead of trusting submitted HTML", () => {
	const definition = normalizeDefinition({
		start: "email",
		nodes: [
			{
				id: "email",
				type: "email",
				subject: "Hej",
				format: "html",
				html: "<script>forged</script>",
				design: design(),
				next: "end",
			},
			{ id: "end", type: "end" },
		],
	});
	const email = definition.nodes[0];
	assert.deepEqual(email.design, normalizeEmailDesign(design()));
	assert.equal(email.html, renderEmailDesign(email.design));
	assert.doesNotMatch(email.html, /forged/);
	const campaign = new Campaign({
		newsletterId: "507f1f77bcf86cd799439011",
		format: "html",
		html: email.html,
		design: email.design,
	});
	assert.deepEqual(
		campaign.toObject().design,
		email.design,
		"campaign schema keeps the editable structure",
	);
});

for (const template of listEmailTemplates({ trigger: "cart.abandoned" }))
	test(`${template.id}: published HTML matches its editable structure`, async () => {
		const base = new URL(
			`../public/email-templates/${template.id}`,
			import.meta.url,
		);
		const input = JSON.parse(
			await readFile(new URL(base.href + ".json"), "utf8"),
		);
		const html = await readFile(new URL(base.href + ".html"), "utf8");
		assert.equal(renderEmailDesign(normalizeEmailDesign(input)), html);
	});

test("template loader returns a validated editable structure and fails atomically", async (t) => {
	t.mock.method(globalThis, "fetch", async (url) => ({
		ok: true,
		text: async () =>
			readFile(new URL("../public" + url, import.meta.url), "utf8"),
		json: async () =>
			JSON.parse(
				await readFile(new URL("../public" + url, import.meta.url), "utf8"),
			),
	}));
	const result = await loadEmailTemplate("welcome-sv", { campaign: true });
	assert.equal(result.design.version, 1);
	assert.equal(result.html, renderEmailDesign(result.design));
	t.mock.method(globalThis, "fetch", async () => ({ ok: false }));
	await assert.rejects(loadEmailTemplate("welcome-sv"), /load this template/);
});
