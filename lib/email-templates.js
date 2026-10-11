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
	const response = await fetch(`/email-templates/${template.id}.html`, {
		signal: options.signal,
	});
	if (!response.ok)
		throw new Error("Couldn't load this template. Please try again.");
	const html = await response.text();
	if (
		!html.startsWith("<!doctype html>") ||
		!html.includes("{{unsubscribe_url}}")
	)
		throw new Error("This template is incomplete. Please try again.");
	return { ...template, html, format: "html" };
}
