import assets from "./email-design-assets.json" with { type: "json" };
import { cleanRichHtml } from "./clean-html.js";
import { escapeHtml } from "./render-email.js";

export const EMAIL_BLOCK_TYPES = [
	"heading",
	"text",
	"image",
	"button",
	"product",
];
export const EMAIL_BRAND = assets.brand;
export const MAX_EMAIL_BLOCKS = 40;
const ID = /^[a-zA-Z0-9_-]{1,80}$/;
const TEXT_TAGS = new Set([
	"p",
	"strong",
	"b",
	"em",
	"i",
	"br",
	"ul",
	"ol",
	"li",
	"a",
	"span",
]);

export function safeEmailUrl(value, image = false) {
	const text = String(value || "").trim();
	if (!image && text === "{{checkoutUrl}}") return text;
	if (!text || /[\u0000-\u0020\u007f]/.test(text)) return "";
	try {
		const url = new URL(text);
		if (
			url.protocol === "https:" &&
			url.hostname &&
			!url.username &&
			!url.password
		)
			return url.href;
		if (
			!image &&
			url.protocol === "mailto:" &&
			/^[^?]+@[^?]+/.test(url.pathname)
		)
			return text;
	} catch {
		/* Incomplete links stay inert while typing. */
	}
	return "";
}

export function sanitizeEmailText(html) {
	return cleanRichHtml(String(html || "")).replace(
		/<\/?([a-z][a-z0-9]*)\b[^>]*>/gi,
		(tag, name) => {
			name = name.toLowerCase();
			if (!TEXT_TAGS.has(name)) return "";
			if (tag.startsWith("</")) return `</${name}>`;
			if (name === "a") {
				const href = /href="([^"]*)"/i.exec(tag)?.[1]?.replaceAll("&amp;", "&");
				const url = safeEmailUrl(href);
				return url ? `<a href="${escapeHtml(url)}">` : "<a>";
			}
			return `<${name}>`;
		},
	);
}

export function normalizeEmailDesign(input) {
	if (
		!input ||
		input.version !== 1 ||
		!["sv", "en", "sv-en"].includes(input.language) ||
		!Array.isArray(input.blocks) ||
		!input.blocks.length ||
		input.blocks.length > MAX_EMAIL_BLOCKS
	)
		throw new Error(
			"A visual email needs 1 to 40 blocks and a supported language",
		);
	if (new TextEncoder().encode(JSON.stringify(input)).length > 80000)
		throw new Error("The email design is too large (80 KB maximum)");
	const ids = new Set();
	let mainHeadings = 0;
	function text(value, max = 400) {
		if (typeof value !== "string" || value.length > max)
			throw new Error(`Keep block text under ${max} characters`);
		return value;
	}
	function url(value, image = false) {
		const raw = text(value || "", 2048).trim();
		if (raw && !safeEmailUrl(raw, image))
			throw new Error(
				image
					? "Images need a public HTTPS address"
					: "Use a full HTTPS link, email address or the cart recovery link",
			);
		return safeEmailUrl(raw, image);
	}
	const blocks = input.blocks.map((block) => {
		if (
			!block ||
			typeof block.id !== "string" ||
			!ID.test(block.id) ||
			ids.has(block.id) ||
			!EMAIL_BLOCK_TYPES.includes(block.type)
		)
			throw new Error("Invalid or duplicate email block");
		ids.add(block.id);
		const result = { id: block.id, type: block.type };
		if (block.type === "heading") {
			if (![1, 2].includes(block.level))
				throw new Error("Choose a title or section heading");
			if (block.level === 1 && ++mainHeadings > 1)
				throw new Error("Use one main title per email");
			Object.assign(result, {
				level: block.level,
				title: text(block.title),
				kicker: text(block.kicker || "", 100),
			});
		}
		if (["text", "product"].includes(block.type))
			result.html = sanitizeEmailText(text(block.html, 12000));
		if (["image", "product"].includes(block.type))
			Object.assign(result, {
				src: url(block.src, true),
				alt: text(block.alt || ""),
				url: url(block.url),
			});
		if (["button", "product"].includes(block.type))
			Object.assign(result, {
				label: text(block.label || "", 100),
				url: url(block.url),
			});
		if (block.type === "product") result.title = text(block.title);
		return result;
	});
	return { version: 1, language: input.language, blocks };
}

// Fragments and shell are generated from Kamado's shared Python renderer, never hand-copied per email.
function fill(fragment, values, raw = []) {
	return fragment.replace(/\{\{([a-zA-Z0-9_]+)\}\}/g, (token, key) =>
		key in values
			? raw.includes(key)
				? values[key]
				: escapeHtml(values[key]).replaceAll("\n", "<br>")
			: token,
	);
}
export function renderEmailBlock(block) {
	const values = {
		...block,
		url: safeEmailUrl(block.url),
		src: safeEmailUrl(block.src, true),
		html: styleEmailText(sanitizeEmailText(block.html)),
	};
	let kind = block.type;
	if (kind === "heading") kind += block.level === 1 ? "1" : "2";
	if (kind === "image" && !values.src) return "";
	if (kind === "product") {
		values.image = values.src
			? `<img src="${escapeHtml(values.src)}" alt="${escapeHtml(values.alt)}" width="560" style="display:block;border:0;width:100%;max-width:560px;height:auto;border-radius:14px;margin:0 0 24px;" />`
			: "";
		values.button =
			values.label && values.url ? fill(assets.fragments.button, values) : "";
		// A product's CTA belongs to its existing cell, not another nested row.
		values.button = values.button
			.replace(/^<tr><td[^>]*>/, "")
			.replace(/<\/td><\/tr>$/, "");
	}
	let result = fill(assets.fragments[kind] || "", values, [
		"html",
		"image",
		"button",
	]);
	if (kind === "image" && !values.url)
		result = result.replace(/<a\b[^>]*>|<\/a>/g, "");
	if (kind === "button" && (!values.url || !values.label)) return "";
	return result;
}
export function renderEmailDesign(design) {
	return (
		assets.shells[design.language]?.replace(
			"{{content_blocks}}",
			design.blocks.map(renderEmailBlock).join("\n"),
		) || ""
	);
}
export function styleEmailText(html) {
	return html
		.replace(
			/<p>/g,
			'<p style="margin:0 0 22px;font-family:Montserrat,Arial,sans-serif;font-size:16px;line-height:1.65;color:#191918;">',
		)
		.replace(
			/<(ul|ol)>/g,
			'<$1 style="margin:0 0 22px;padding-left:24px;font-family:Montserrat,Arial,sans-serif;font-size:16px;line-height:1.65;color:#191918;">',
		)
		.replace(
			/<a href=/g,
			'<a style="color:#a40000;text-decoration:underline;" href=',
		);
}
export function moveEmailBlock(blocks, id, targetId, after = false) {
	if (id === targetId) return blocks;
	const source = blocks.find((item) => item.id === id);
	if (!source || !blocks.some((item) => item.id === targetId)) return blocks;
	const next = blocks.filter((item) => item.id !== id);
	next.splice(
		next.findIndex((item) => item.id === targetId) + Number(after),
		0,
		source,
	);
	return next;
}
export function newEmailBlock(type, language = "sv") {
	const en = language === "en";
	const url = en ? "https://kamadosumo.com/" : "https://kamadosumo.com/sv/";
	const base = { id: crypto.randomUUID(), type };
	if (type === "heading")
		return {
			...base,
			level: 2,
			kicker: "",
			title: en ? "Your next idea" : "Din nästa idé",
		};
	if (type === "text")
		return {
			...base,
			html: en
				? "<p>Write your message here.</p>"
				: "<p>Skriv din text här.</p>",
		};
	if (type === "button")
		return {
			...base,
			label: en ? "Explore Kamado Sumo" : "Upptäck Kamado Sumo",
			url,
		};
	return {
		...base,
		src: "https://kamadosumo.com/wp-content/uploads/2026/02/icon-line.jpg",
		alt: "Kamado Sumo Icon",
		url,
		...(type === "product" && {
			title: "Icon",
			html: en
				? "<p>Describe the product here.</p>"
				: "<p>Beskriv produkten här.</p>",
			label: en ? "Discover Icon" : "Upptäck Icon",
		}),
	};
}
