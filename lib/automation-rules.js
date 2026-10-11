import { normalizeEmailDesign, renderEmailDesign } from "./email-design.js";
import { normalizeRules } from "./segments.js";

export const AUTOMATION_TRIGGERS = [
	"subscribed",
	"order.paid",
	"cart.abandoned",
];
export const NODE_TYPES = ["email", "wait", "condition", "tag", "end"];
const ID = /^[a-zA-Z0-9_-]{1,60}$/;

export function normalizeDefinition(input) {
	if (
		!input ||
		!Array.isArray(input.nodes) ||
		input.nodes.length < 1 ||
		input.nodes.length > 50 ||
		!ID.test(input.start)
	)
		throw new Error("A flow needs 1 to 50 steps and a start step");
	const ids = new Set();
	const nodes = input.nodes.map((node) => {
		if (
			!node ||
			!ID.test(node.id) ||
			ids.has(node.id) ||
			!NODE_TYPES.includes(node.type)
		)
			throw new Error("Invalid or duplicate step");
		ids.add(node.id);
		const result = {
			id: node.id,
			type: node.type,
			label: String(node.label || node.type).slice(0, 100),
		};
		if (node.type === "end") return result;
		if (node.type === "condition") {
			return {
				...result,
				rules: normalizeRules(node.rules),
				yes: node.yes,
				no: node.no,
			};
		}
		result.next = node.next;
		if (node.type === "wait") {
			const minutes = Number(node.minutes);
			if (!Number.isInteger(minutes) || minutes < 1 || minutes > 43200)
				throw new Error("Wait between 1 minute and 30 days");
			result.minutes = minutes;
		}
		if (node.type === "tag") {
			if (
				typeof node.tag !== "string" ||
				!node.tag.trim() ||
				node.tag.length > 80
			)
				throw new Error("Add a tag (up to 80 characters)");
			result.tag = node.tag.trim();
		}
		if (node.type === "email") {
			if (
				typeof node.subject !== "string" ||
				!node.subject.trim() ||
				node.subject.length > 200 ||
				/[\r\n]/.test(node.subject)
			)
				throw new Error("Add an email subject (up to 200 characters)");
			const design = node.design ? normalizeEmailDesign(node.design) : undefined;
			const format = design ? "html" : (node.format || "markdown");
			if (!["markdown", "html"].includes(format))
				throw new Error("Choose Markdown or HTML");
			const body = design ? renderEmailDesign(design) : (format === "html" ? node.html : node.markdown);
			if (
				typeof body !== "string" ||
				!body.trim() ||
				new TextEncoder().encode(body).length > 80000
			)
				throw new Error("Add email content (up to 80 KB)");
			Object.assign(result, {
				subject: node.subject.trim(),
				previewText: String(node.previewText || "").slice(0, 300),
				format,
				...(design && { design }),
				[format === "html" ? "html" : "markdown"]: body,
			});
		}
		return result;
	});
	const byId = new Map(nodes.map((node) => [node.id, node]));
	const visited = new Set();
	const visiting = new Set();
	function walk(id) {
		if (!byId.has(id))
			throw new Error("Every branch must lead to an existing step");
		if (visiting.has(id)) throw new Error("Loops are not allowed");
		if (visited.has(id)) return;
		visiting.add(id);
		const node = byId.get(id);
		for (const target of node.type === "condition"
			? [node.yes, node.no]
			: node.type === "end"
				? []
				: [node.next])
			walk(target);
		visiting.delete(id);
		visited.add(id);
	}
	walk(input.start);
	if (visited.size !== nodes.length)
		throw new Error("Connect or remove unused steps");
	return { start: input.start, nodes };
}

export function starterDefinition(trigger) {
	const cart = trigger === "cart.abandoned";
	return {
		start: "email",
		nodes: [
			{
				id: "email",
				type: "email",
				label: cart ? "Cart reminder" : "First email",
				subject: cart
					? "Du har något kvar i varukorgen"
					: "Välkommen till Kamado Sumo",
				previewText: "",
				markdown: cart
					? "Hej {{firstName}},\n\nDin varukorg finns kvar.\n\n[Återgå till varukorgen]({{checkoutUrl}})"
					: "Hej {{firstName}},\n\nHär börjar din grillresa med oss.",
				next: "end",
			},
			{ id: "end", type: "end", label: "Completed" },
		],
	};
}

export function runStopReason({
	contact,
	suppressed,
	automation,
	cart,
	run,
	now = new Date(),
}) {
	if (!contact || contact.status !== "active" || suppressed)
		return "Contact cannot receive marketing";
	if (!automation || automation.status !== "active") return "Flow is paused";
	if (run.trigger === "cart.abandoned") {
		if (!cart || cart.status !== "open") return "Cart was recovered or closed";
		if (cart.email !== contact.email) return "Cart identity changed";
		if (
			new Date(cart.version).getTime() !==
			new Date(run.context.cartVersion).getTime()
		)
			return "Cart changed";
		if (!cart.checkoutUrl || new Date(cart.expiresAt) <= now)
			return "Recovery link expired";
		if (
			contact.commerce?.lastPlacedOrderAt &&
			new Date(contact.commerce.lastPlacedOrderAt) >= new Date(cart.version)
		)
			return "Customer placed an order";
	}
	return null;
}
