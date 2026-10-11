import { normalizeEmailDesign, renderEmailDesign } from "./email-design.js";
import catalog from "./email-templates.json" with { type: "json" };

export function listEmailTemplates({ trigger, campaign = false } = {}) {
	return catalog.filter(
		(template) =>
			!template.cartOnly || (!campaign && trigger === "cart.abandoned"),
	);
}

export async function loadEmailTemplate(id, options = {}) {
	const template = listEmailTemplates(options).find((item) => item.id === id);
	if (!template) throw new Error("Choose an available template");
	const [response, designResponse] = await Promise.all([
		fetch(`/email-templates/${template.id}.html`, { signal: options.signal }),
		fetch(`/email-templates/${template.id}.json`, { signal: options.signal }),
	]);
	if (!response.ok || !designResponse.ok)
		throw new Error("Couldn't load this template. Please try again.");
	const [html, input] = await Promise.all([response.text(), designResponse.json()]);
	if (!html.startsWith("<!doctype html>") || !html.includes("{{unsubscribe_url}}"))
		throw new Error("This template is incomplete. Please try again.");
	const design = normalizeEmailDesign(input);
	return { ...template, design, html: renderEmailDesign(design), format: "html" };
}
