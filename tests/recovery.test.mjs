import assert from "node:assert/strict";
import { test } from "node:test";
import {
	createRecoveryToken,
	readRecoveryToken,
	withRecoveryAttribution,
	RECOVERY_WINDOW_MS,
} from "../lib/recovery-tokens.js";
import { recoveryMatches } from "../lib/recovery-attribution.js";
import { normalizeCommerceEvent } from "../lib/commerce-rules.js";
import { buildRecipientEmail } from "../lib/sending-rules.js";
import { readClickToken } from "../lib/tracking.js";
import { readFile } from "node:fs/promises";
process.env.SESSION_SECRET =
	"recovery-tests-secret-with-more-than-32-characters";
const id = "111111111111111111111111";
function fixture() {
	const sent = Date.now() - 3600000,
		clicked = sent + 60000;
	return {
		message: {
			kind: "automation",
			_id: id,
			sentAt: new Date(sent),
			email: "a@example.com",
			automationRunId: "run",
			automationId: "flow",
			newsletterId: "list",
			contactId: "contact",
			automationNodeId: "email",
		},
		run: {
			_id: "run",
			automationId: "flow",
			newsletterId: "list",
			contactId: "contact",
			trigger: "cart.abandoned",
			definition: { nodes: [{ id: "email", type: "email" }] },
			context: {
				storeId: "store",
				cartId: "cart",
				cartExternalId: "cart-1",
				cartVersion: new Date(sent - 3600000),
				currency: "SEK",
				cartItems: [{ productId: "314", variationId: "0" }],
			},
		},
		order: {
			storeId: "store",
			newsletterId: "list",
			email: "a@example.com",
			currency: "SEK",
			placedAt: new Date(clicked + 60000),
			items: [{ productId: "314", variationId: "0" }],
		},
		touch: {
			cartExternalId: "cart-1",
			cartVersion: new Date(sent - 3600000),
			touchedAt: new Date(clicked),
		},
	};
}
test("recovery token is signed, scoped to a message and invalidated on secret rotation", () => {
	const token = createRecoveryToken(id);
	assert.equal(readRecoveryToken(token), id);
	assert.equal(
		readRecoveryToken(token.replace(id, "222222222222222222222222")),
		null,
	);
	for (const bad of [null, "", `${token}x`, token.slice(0, -1), id])
		assert.equal(readRecoveryToken(bad), null);
	const secret = process.env.SESSION_SECRET;
	process.env.SESSION_SECRET = "another-secret-with-more-than-32-characters";
	assert.equal(readRecoveryToken(token), null);
	process.env.SESSION_SECRET = secret;
	assert.throws(() => createRecoveryToken("invalid"));
});
test("recovery URL preserves the cart token, query and fragment without duplicate attribution", () => {
	const url = new URL(
		withRecoveryAttribution(
			"https://shop.example/cart?mailman_recover=abc&lang=sv&mailman_attribution=old#checkout",
			id,
		),
	);
	assert.equal(url.searchParams.get("mailman_recover"), "abc");
	assert.equal(url.searchParams.get("lang"), "sv");
	assert.equal(url.hash, "#checkout");
	assert.equal(url.searchParams.getAll("mailman_attribution").length, 1);
	assert.equal(
		readRecoveryToken(url.searchParams.get("mailman_attribution")),
		id,
	);
	assert.equal(withRecoveryAttribution(undefined, id), undefined);
});
test("cart templates carry attribution in tracked HTML, plain text and Outlook VML buttons", async () => {
	const html = await readFile(
		new URL("../public/email-templates/cart-reminder-sv.html", import.meta.url),
		"utf8",
	);
	const email = buildRecipientEmail({
		campaign: {
			format: "html",
			html,
			subject: "Cart",
			checkoutUrl: "https://shop.example/cart?mailman_recover=abc",
		},
		newsletter: { _id: id, name: "Test", fromEmail: "a@example.com" },
		contact: { _id: id, email: "a@example.com" },
		messageId: id,
	});
	const token = createRecoveryToken(id);
	assert.ok(email.text.includes(`mailman_attribution=${token}`));
	assert.match(
		email.html,
		new RegExp(
			`<v:roundrect[^>]*href="[^"]*mailman_attribution=${token.replace(".", "\\.")}"`,
		),
	);
	const clicks = [...email.html.matchAll(/href="([^\"]*\/c\/[^\"]+)"/g)]
		.map((match) => readClickToken(match[1].split("/").pop()))
		.filter(Boolean);
	assert.ok(
		clicks.some((click) => click.url.includes(`mailman_attribution=${token}`)),
	);
});
test("attribution requires the exact sent cart message, customer, shop, cart version and original product", () => {
	assert.equal(recoveryMatches(fixture()), true);
	const mutations = [
		(f) => (f.message.sentAt = null),
		(f) => (f.message.kind = "campaign"),
		(f) => (f.run.trigger = "order.paid"),
		(f) => (f.order.email = "other@example.com"),
		(f) => (f.order.storeId = "other"),
		(f) => (f.order.newsletterId = "other"),
		(f) => (f.message.newsletterId = "other"),
		(f) => (f.message.contactId = "other"),
		(f) => (f.message.automationRunId = "other"),
		(f) => (f.message.automationId = "other"),
		(f) => (f.message.automationNodeId = "missing"),
		(f) => (f.touch.cartExternalId = "other"),
		(f) => (f.touch.cartVersion = new Date(0)),
		(f) => (f.order.currency = "EUR"),
		(f) => (f.order.items = [{ productId: "999" }]),
		(f) => (f.order.items[0].variationId = "5"),
		(f) => delete f.run.context.cartItems,
	];
	for (const mutate of mutations) {
		const f = fixture();
		mutate(f);
		assert.equal(recoveryMatches(f), false);
	}
});
test("seven-day boundaries use placement, so later payment does not extend the order window", () => {
	const f = fixture();
	f.order.placedAt = new Date(+f.touch.touchedAt + RECOVERY_WINDOW_MS);
	assert.equal(recoveryMatches(f), true);
	f.order.placedAt = new Date(+f.order.placedAt + 1);
	assert.equal(recoveryMatches(f), false);
	f.order.placedAt = new Date(+f.touch.touchedAt - 1);
	assert.equal(recoveryMatches(f), false);
	f.touch.touchedAt = new Date(+f.message.sentAt + RECOVERY_WINDOW_MS + 1);
	f.order.placedAt = new Date(+f.touch.touchedAt + 1);
	assert.equal(recoveryMatches(f), false);
});
test("commerce input rejects malformed and future recovery metadata and paid-before-placed orders", () => {
	const f = fixture();
	const data = {
		externalId: "wc:1",
		email: f.order.email,
		currency: "SEK",
		total: 10,
		items: [{ productId: "314", quantity: 1 }],
		status: "paid",
		placedAt: f.order.placedAt.toISOString(),
		paidAt: new Date().toISOString(),
		updatedAt: new Date().toISOString(),
		recoveryTouch: { ...f.touch, token: createRecoveryToken(id) },
	};
	const normalize = (value) =>
		normalizeCommerceEvent(
			{ id: "evt", type: "order.updated", data: value },
			{},
		);
	assert.equal(
		normalize(data).data.recoveryTouch.token,
		createRecoveryToken(id),
	);
	for (const touch of [
		{ ...data.recoveryTouch, token: "forged" },
		{ ...data.recoveryTouch, touchedAt: new Date(Date.now() + 1000) },
		{ ...data.recoveryTouch, cartVersion: "invalid" },
		{ ...data.recoveryTouch, cartExternalId: "../../escape" },
	])
		assert.throws(
			() => normalize({ ...data, recoveryTouch: touch }),
			/recovery/,
		);
	assert.throws(() => normalize({ ...data, paidAt: new Date(0) }), /paidAt/);
});
