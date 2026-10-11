// A small, deliberately closed rule language. Never accept a MongoDB query from a client.
export const SEGMENT_FIELDS = {
	language: { label: "Language", type: "string" },
	country: { label: "Country", type: "string" },
	source: { label: "Source", type: "string" },
	tags: { label: "Tag", type: "tags" },
	"commerce.orderCount": { label: "Paid orders", type: "number" },
	"commerce.spendByCurrency.SEK": { label: "Net spend (SEK)", type: "number" },
	"commerce.spendByCurrency.EUR": { label: "Net spend (EUR)", type: "number" },
	"commerce.productIds": { label: "Purchased product ID", type: "tags" },
	"commerce.lastOrderAt": { label: "Last paid order", type: "date" },
	lastClickAt: { label: "Last email click", type: "date" },
	subscribedAt: { label: "Subscribed", type: "date" },
};
export const SEGMENT_OPERATORS = {
	string: ["eq", "ne", "exists", "missing"],
	tags: ["contains", "notContains", "exists", "missing"],
	number: ["eq", "gt", "gte", "lt", "lte", "exists", "missing"],
	date: ["before", "after", "withinDays", "olderThanDays", "exists", "missing"],
};

export function normalizeRules(input, depth = 0, budget = { count: 0 }) {
	if (
		!input ||
		typeof input !== "object" ||
		Array.isArray(input) ||
		depth > 4 ||
		++budget.count > 50
	)
		throw new Error("Invalid or oversized rules");
	if (input.mode) {
		if (
			!["all", "any"].includes(input.mode) ||
			!Array.isArray(input.rules) ||
			!input.rules.length
		)
			throw new Error("Add at least one condition");
		return {
			mode: input.mode,
			rules: input.rules.map((rule) => normalizeRules(rule, depth + 1, budget)),
		};
	}
	const definition =
		Object.hasOwn(SEGMENT_FIELDS, input.field) && SEGMENT_FIELDS[input.field];
	if (!definition || !SEGMENT_OPERATORS[definition.type].includes(input.op))
		throw new Error("Unknown field or operator");
	const { field, op } = input;
	if (["exists", "missing"].includes(op)) return { field, op };
	let value = input.value;
	if (
		definition.type === "number" ||
		["withinDays", "olderThanDays"].includes(op)
	) {
		if (
			value === "" ||
			value == null ||
			!["string", "number"].includes(typeof value)
		)
			throw new Error("Enter a number");
		value = Number(value);
		if (!Number.isFinite(value) || value < 0 || value > 1e9)
			throw new Error("Invalid number");
	} else if (definition.type === "date") {
		if (
			typeof value !== "string" ||
			!/^\d{4}-\d{2}-\d{2}/.test(value) ||
			!Number.isFinite(Date.parse(value))
		)
			throw new Error("Enter an ISO date");
		value = new Date(value).toISOString();
	} else {
		if (typeof value !== "string" || !value.trim() || value.length > 200)
			throw new Error("Enter a value (up to 200 characters)");
		value = value.trim();
	}
	return { field, op, value };
}

export function rulesToQuery(input, now = new Date()) {
	const rule = normalizeRules(input);
	function compile(r) {
		if (r.mode)
			return { [r.mode === "all" ? "$and" : "$or"]: r.rules.map(compile) };
		const { field, op, value } = r;
		if (op === "missing") return { [field]: null };
		if (op === "exists") return { [field]: { $ne: null } };
		if (op === "contains") return { [field]: value };
		// Missing data never satisfies negative conditions accidentally.
		if (["ne", "notContains"].includes(op))
			return { [field]: { $exists: true, $nin: [null, value] } };
		const operator = {
			eq: "$eq",
			gt: "$gt",
			gte: "$gte",
			lt: "$lt",
			lte: "$lte",
			before: "$lt",
			after: "$gt",
			withinDays: "$gte",
			olderThanDays: "$lt",
		}[op];
		const operand = ["withinDays", "olderThanDays"].includes(op)
			? new Date(now.getTime() - value * 86400000)
			: SEGMENT_FIELDS[field].type === "date"
				? new Date(value)
				: value;
		return { [field]: { $ne: null, [operator]: operand } };
	}
	return compile(rule);
}

export function matchesRules(input, contact, now = new Date()) {
	const rule = normalizeRules(input);
	function match(r) {
		if (r.mode)
			return r.mode === "all" ? r.rules.every(match) : r.rules.some(match);
		let actual = r.field.split(".").reduce((obj, key) => obj?.[key], contact);
		if (r.op === "missing") return actual == null;
		if (r.op === "exists") return actual != null;
		if (actual == null) return false;
		if (r.op === "contains")
			return Array.isArray(actual) && actual.includes(r.value);
		if (r.op === "notContains")
			return Array.isArray(actual) && !actual.includes(r.value);
		let expected = r.value;
		if (SEGMENT_FIELDS[r.field].type === "date") {
			actual = new Date(actual).getTime();
			expected = ["withinDays", "olderThanDays"].includes(r.op)
				? now.getTime() - r.value * 86400000
				: Date.parse(r.value);
		}
		return {
			eq: () => actual === expected,
			ne: () => actual !== expected,
			gt: () => actual > expected,
			gte: () => actual >= expected,
			lt: () => actual < expected,
			lte: () => actual <= expected,
			before: () => actual < expected,
			after: () => actual > expected,
			withinDays: () => actual >= expected,
			olderThanDays: () => actual < expected,
		}[r.op]();
	}
	return match(rule);
}
