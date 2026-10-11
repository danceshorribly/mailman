import assert from "node:assert/strict";
import { test } from "node:test";
import {
	normalizeDefinition,
	starterDefinition,
	runStopReason,
} from "../lib/automation-rules.js";
import { normalizeRules, matchesRules, rulesToQuery } from "../lib/segments.js";
import {
	normalizeCommerceEvent,
	commerceSummary,
} from "../lib/commerce-rules.js";
import { mapColumns, normalizeImportRow } from "../lib/csv-import.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import { mailchimpMemberRow } from "../lib/mailchimp-import.js";

test("nested AND/OR rules reject query injection, oversized input and unknown fields", () => {
	const rules = {
		mode: "all",
		rules: [
			{ field: "country", op: "eq", value: "SE" },
			{
				mode: "any",
				rules: [
					{ field: "language", op: "eq", value: "sv" },
					{ field: "tags", op: "contains", value: "vip" },
				],
			},
		],
	};
	assert.equal(
		matchesRules(rules, { country: "SE", language: "en", tags: ["vip"] }),
		true,
	);
	assert.equal(matchesRules(rules, { country: "NO", language: "sv" }), false);
	assert.throws(() =>
		normalizeRules({ field: "$where", op: "eq", value: "code" }),
	);
	assert.throws(() =>
		normalizeRules({ field: "language", op: "eq", value: { $ne: null } }),
	);
	assert.throws(() =>
		normalizeRules({
			mode: "all",
			rules: Array(51).fill({ field: "language", op: "eq", value: "sv" }),
		}),
	);
	assert.throws(() =>
		normalizeRules({ field: "constructor", op: "eq", value: "sv" }),
	);
	assert.deepEqual(rulesToQuery({ field: "language", op: "ne", value: "sv" }), {
		language: { $exists: true, $nin: [null, "sv"] },
	});
	assert.equal(
		matchesRules({ field: "language", op: "ne", value: "sv" }, {}),
		false,
	);
});

test("relative date rules share a fixed clock and do not treat missing data as old", () => {
	const rule = {
		field: "commerce.lastOrderAt",
		op: "olderThanDays",
		value: 30,
	};
	const now = new Date("2026-10-11T12:00:00Z");
	assert.equal(
		matchesRules(rule, { commerce: { lastOrderAt: "2026-09-01" } }, now),
		true,
	);
	assert.equal(matchesRules(rule, {}, now), false);
	assert.equal(
		rulesToQuery(rule, now)["commerce.lastOrderAt"].$lt.toISOString(),
		"2026-09-11T12:00:00.000Z",
	);
});

test("flows reject loops, dangling branches, orphan steps and invalid email headers", () => {
	const valid = starterDefinition("cart.abandoned");
	assert.equal(normalizeDefinition(valid).nodes.length, 2);
	assert.throws(
		() =>
			normalizeDefinition({
				...valid,
				nodes: [{ ...valid.nodes[0], next: "email" }, valid.nodes[1]],
			}),
		/Loops/,
	);
	assert.throws(
		() =>
			normalizeDefinition({
				...valid,
				nodes: [{ ...valid.nodes[0], next: "missing" }, valid.nodes[1]],
			}),
		/existing step/,
	);
	assert.throws(
		() =>
			normalizeDefinition({
				...valid,
				nodes: [...valid.nodes, { id: "unused", type: "end" }],
			}),
		/unused/,
	);
	assert.throws(
		() =>
			normalizeDefinition({
				...valid,
				nodes: [
					{ ...valid.nodes[0], subject: "Test\nBcc: x@example.com" },
					valid.nodes[1],
				],
			}),
		/subject/,
	);
});

test("cart guards stop recovered, changed, expired and purchased carts", () => {
	const version = new Date("2026-10-11T10:00:00Z");
	const base = {
		contact: { email: "alex@example.com", status: "active" },
		automation: { status: "active" },
		run: { trigger: "cart.abandoned", context: { cartVersion: version } },
		cart: {
			email: "alex@example.com",
			status: "open",
			version,
			checkoutUrl: "https://shop.example/cart",
			expiresAt: new Date("2026-10-20"),
		},
		now: new Date("2026-10-11T12:00:00Z"),
	};
	assert.equal(runStopReason(base), null);
	assert.match(
		runStopReason({ ...base, cart: { ...base.cart, status: "closed" } }),
		/closed/,
	);
	assert.match(
		runStopReason({
			...base,
			cart: { ...base.cart, version: new Date("2026-10-11T11:00:00Z") },
		}),
		/changed/,
	);
	assert.match(
		runStopReason({
			...base,
			contact: { ...base.contact, commerce: { lastPlacedOrderAt: version } },
		}),
		/order/,
	);
	assert.match(
		runStopReason({
			...base,
			cart: { ...base.cart, expiresAt: new Date("2026-10-10") },
		}),
		/expired/,
	);
	assert.match(runStopReason({ ...base, suppressed: true }), /marketing/);
});

test("commerce validation locks recovery links to the registered shop", () => {
	const data = {
		externalId: "cart-1",
		email: "Alex@example.com",
		updatedAt: "2026-10-11T10:00:00Z",
		status: "open",
		currency: "SEK",
		total: 100,
		items: [{ productId: "314", quantity: 1 }],
		checkoutUrl: "https://shop.example/cart/?token=123",
		expiresAt: "2026-10-18T10:00:00Z",
	};
	const event = { id: "cart:1", type: "cart.updated", data };
	assert.equal(
		normalizeCommerceEvent(
			event,
			{ origin: "https://shop.example" },
			new Date("2026-10-11T11:00:00Z"),
		).data.email,
		"alex@example.com",
	);
	for (const checkoutUrl of [
		"https://evil.example/cart",
		"javascript:alert(1)",
		"https://user:pass@shop.example/cart",
	])
		assert.throws(() =>
			normalizeCommerceEvent(
				{ ...event, data: { ...data, checkoutUrl } },
				{ origin: "https://shop.example" },
			),
		);
	assert.throws(() =>
		normalizeCommerceEvent(
			{
				...event,
				data: { ...data, items: [{ productId: "314", quantity: -1 }] },
			},
			{ origin: "https://shop.example" },
		),
	);
});

test("net spend and purchased product segments stay separate by currency and exclude refunds", () => {
	const order = {
		status: "paid",
		paidAt: "2026-10-10",
		placedAt: "2026-10-09",
		currency: "SEK",
		total: 100,
		items: [{ productId: "314" }],
	};
	const result = commerceSummary([
		order,
		{ ...order, currency: "EUR", total: 10 },
		{ ...order, status: "refunded", total: 0 },
	]);
	assert.equal(result.orderCount, 2);
	assert.deepEqual(result.spendByCurrency, { SEK: 100, EUR: 10 });
	assert.deepEqual(result.productIds, ["314"]);
});

test("Mailchimp customer fields normalize without changing imported subscription status", () => {
	const columns = mapColumns([
		"Email Address",
		"FNAME",
		"LNAME",
		"FULLNAME",
		"LANGUAGE",
		"COUNTRY",
		"Tags",
		"Status",
	]);
	const row = normalizeImportRow(
		{
			"Email Address": "Alex@example.com",
			FNAME: "Alex",
			LNAME: "Sumo",
			FULLNAME: "Alex Sumo",
			LANGUAGE: "Swedish",
			COUNTRY: "Sweden",
			Tags: "vip, grill, vip",
			Status: "unsubscribed",
		},
		columns,
	);
	assert.equal(row.firstName, "Alex");
	assert.equal(row.language, "sv");
	assert.equal(row.country, "SE");
	assert.equal(row.status, "unsubscribed");
	assert.deepEqual(row.tags, ["vip", "grill"]);
});

test("personalized recovery links work after Markdown encoding, escape customer input and keep one-click opt-out", () => {
	process.env.SESSION_SECRET =
		"test-secret-that-is-more-than-thirty-two-characters";
	const email = buildRecipientEmail({
		campaign: {
			format: "markdown",
			subject: "Hej {{firstName}}",
			markdown: "Hej {{firstName}}. [Cart]({{checkoutUrl}})",
			checkoutUrl: "https://shop.example/cart/?token=123&lang=sv",
		},
		newsletter: {
			_id: "111111111111111111111111",
			name: "Test",
			fromEmail: "mail@example.com",
		},
		contact: {
			_id: "222222222222222222222222",
			email: "alex@example.com",
			firstName: "<img src=x onerror=alert(1)>",
		},
	});
	assert.ok(
		email.html.includes(
			'href="https://shop.example/cart/?token=123&amp;lang=sv"',
		),
	);
	assert.ok(email.html.includes("&lt;img"));
	assert.ok(!email.html.includes("<img src=x"));
	assert.ok(
		email.text.includes("https://shop.example/cart/?token=123&lang=sv"),
	);
	assert.equal(
		email.headers["List-Unsubscribe-Post"],
		"List-Unsubscribe=One-Click",
	);
});

test("Mailchimp importer never promotes transactional, pending or unknown statuses", () => {
	const member = {
		email_address: "alex@example.com",
		merge_fields: {
			FULLNAME: "Alex Sumo",
			LANGUAGE: "Swedish",
			COUNTRY: "Sweden",
		},
		tags: [{ name: "vip" }],
		stats: { avg_open_rate: 0.8, avg_click_rate: 0.2 },
	};
	for (const status of ["transactional", "pending", "unknown", "archived"])
		assert.equal(mailchimpMemberRow({ ...member, status }).status, "dormant");
	assert.equal(
		mailchimpMemberRow({ ...member, status: "cleaned" }).status,
		"bounced",
	);
	const active = mailchimpMemberRow({ ...member, status: "subscribed" });
	assert.equal(active.language, "sv");
	assert.equal(active.country, "SE");
	assert.deepEqual(active.tags, ["vip"]);
	assert.equal(active.openRate, 0.8);
});

test("HTML journey steps preserve existing branded templates and validate their payload", () => {
	const definition = starterDefinition("subscribed");
	definition.nodes[0] = {
		...definition.nodes[0],
		format: "html",
		html: "<html><body><p>Hej {{firstName}}</p></body></html>",
		markdown: undefined,
	};
	const validated = normalizeDefinition(definition);
	assert.equal(validated.nodes[0].format, "html");
	assert.ok(validated.nodes[0].html.includes("<html>"));
	assert.throws(() =>
		normalizeDefinition({
			...definition,
			nodes: [{ ...definition.nodes[0], html: "" }, definition.nodes[1]],
		}),
	);
});
