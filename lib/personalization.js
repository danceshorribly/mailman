import { escapeHtml } from "./render-email.js";
const TOKEN =
	/\{\{(firstName|lastName|fullName|language|country|checkoutUrl)\}\}/g;
export function personalize(text, contact, checkoutUrl = "", html = false) {
	const source = String(text || "").replaceAll(
		/%7B%7BcheckoutUrl%7D%7D/gi,
		"{{checkoutUrl}}",
	);
	const replace = (part, attributes = false) =>
		part.replace(TOKEN, (token, key) => {
			// Names are text, never URL or attribute values. Only a validated shop URL fills hrefs.
			if (attributes && key !== "checkoutUrl") return token;
			const value =
				key === "checkoutUrl"
					? checkoutUrl
					: key === "fullName"
						? contact.fullName ||
							[contact.firstName, contact.lastName].filter(Boolean).join(" ")
						: contact[key];
			return html
				? escapeHtml(value || "")
				: String(value || "").replace(/[\r\n]/g, " ");
		});
	return html
		? source
				.split(/(<[^>]*>)/g)
				.map((part) => replace(part, part.startsWith("<")))
				.join("")
		: replace(source);
}
