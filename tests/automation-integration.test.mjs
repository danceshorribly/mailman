import { readFile } from "node:fs/promises";
import { renderEmailDesign } from "../lib/email-design.js";
import assert from "node:assert/strict";
import { test, before, after, beforeEach } from "node:test";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Automation from "../models/Automation.js";
import AutomationRun from "../models/AutomationRun.js";
import AutomationEvent from "../models/AutomationEvent.js";
import CommerceRecord from "../models/CommerceRecord.js";
import CommerceStore from "../models/CommerceStore.js";
import Contact from "../models/Contact.js";
import Message from "../models/Message.js";
import Suppression from "../models/Suppression.js";
import Newsletter from "../models/Newsletter.js";
import WorkerLease from "../models/WorkerLease.js";
import {
	tickAutomations,
	acceptCommerceEvent,
	recordSignup,
	pauseUnhealthyAutomation,
	stepRun,
} from "../lib/automation-engine.js";
import { normalizeCommerceEvent } from "../lib/commerce-rules.js";
import {
	normalizeDefinition,
	starterDefinition,
} from "../lib/automation-rules.js";
import { rulesToQuery, matchesRules } from "../lib/segments.js";
import { importContactRows } from "../lib/contact-import.js";

let mongo, newsletter, store, sends;
const models = [
	Automation,
	AutomationRun,
	AutomationEvent,
	CommerceRecord,
	CommerceStore,
	Contact,
	Message,
	Suppression,
	Newsletter,
	WorkerLease,
];
before(async () => {
	mongo = await MongoMemoryServer.create();
	await mongoose.connect(mongo.getUri());
	await Promise.all(models.map((model) => model.init()));
});
after(async () => {
	await mongoose.disconnect();
	if (mongo) await mongo.stop();
});
beforeEach(async () => {
	await Promise.all(models.map((model) => model.deleteMany({})));
	process.env.AUTOMATIONS_ENABLED = "true";
	process.env.SENDING_ENABLED = "true";
	sends = 0;
	newsletter = await Newsletter.create({
		name: "Test",
		slug: "test",
		fromEmail: "news@example.com",
		postalAddress: "Test Street",
	});
	store = await CommerceStore.create({
		name: "Test",
		newsletterId: newsletter._id,
		apiKeyId: new mongoose.Types.ObjectId(),
		origin: "https://shop.example",
	});
});
const hoursAgo = (hours) => new Date(Date.now() - hours * 3600000);
async function contact(status = "active", email = "alex@example.com") {
	return Contact.create({
		newsletterId: newsletter._id,
		email,
		status,
		language: "sv",
	});
}
async function flow(trigger, definition = starterDefinition(trigger)) {
	return Automation.create({
		newsletterId: newsletter._id,
		name: "Test",
		trigger,
		definition,
		status: "active",
		activatedAt: hoursAgo(48),
	});
}
const cartData = () => ({
	externalId: "cart-1",
	email: "alex@example.com",
	updatedAt: hoursAgo(2).toISOString(),
	currency: "SEK",
	total: 100,
	items: [{ productId: "314", quantity: 1 }],
	status: "open",
	checkoutUrl: "https://shop.example/cart/?token=123",
	expiresAt: new Date(Date.now() + 86400000).toISOString(),
});
const orderData = () => ({
	externalId: "wc:100",
	email: "alex@example.com",
	updatedAt: new Date().toISOString(),
	placedAt: hoursAgo(0.5).toISOString(),
	paidAt: hoursAgo(0.25).toISOString(),
	currency: "SEK",
	total: 100,
	items: [{ productId: "314", quantity: 1 }],
	status: "paid",
});
async function receive(
	type,
	data,
	id = crypto.randomUUID(),
	historical = false,
) {
	return acceptCommerceEvent(
		normalizeCommerceEvent({ id, type, data, historical }, store),
		store,
	);
}
async function sendBatch(ids) {
	for (const _id of ids) {
		const result = await Message.updateOne(
			{ _id, status: "queued" },
			{ $set: { status: "sent", sentAt: new Date(), sesMessageId: "mock" } },
		);
		sends += result.modifiedCount;
	}
}
async function tick() {
	return tickAutomations({ sendBatch });
}

test("real MongoDB: duplicate commerce events and repeated workers produce one run and one email", async () => {
	await contact();
	await flow("cart.abandoned");
	const data = cartData();
	await receive("cart.updated", data, "stable-event");
	assert.equal(
		(await receive("cart.updated", data, "stable-event")).duplicate,
		true,
	);
	await tick();
	await tick();
	assert.equal(await AutomationRun.countDocuments(), 1);
	assert.equal(await Message.countDocuments(), 1);
	assert.equal(sends, 1);
	assert.equal((await AutomationRun.findOne()).status, "completed");
});

test("real MongoDB: a paid order received during a wait stops a cart run before delivery", async () => {
	await contact();
	const definition = starterDefinition("cart.abandoned");
	definition.start = "wait";
	definition.nodes.unshift({
		id: "wait",
		type: "wait",
		label: "Wait",
		minutes: 60,
		next: "email",
	});
	await flow("cart.abandoned", definition);
	await receive("cart.updated", cartData());
	await tick();
	assert.equal((await AutomationRun.findOne()).nodeId, "email");
	assert.equal(sends, 0);
	await receive("order.updated", orderData()); // Receipt-time guard does not depend on journal processing.
	assert.equal(
		(await CommerceRecord.findOne({ kind: "cart" })).status,
		"closed",
	);
	await AutomationRun.updateMany({}, { $set: { nextAt: new Date(0) } });
	await tick();
	assert.equal((await AutomationRun.findOne()).status, "stopped");
	assert.equal(sends, 0);
});

test("real MongoDB: unsubscribes and global complaints win over queued journeys", async () => {
	const customer = await contact();
	const automation = await flow("subscribed");
	await recordSignup(customer);
	process.env.SENDING_ENABLED = "false";
	await tick();
	assert.equal(sends, 0);
	await Contact.updateOne(
		{ _id: customer._id },
		{ $set: { status: "unsubscribed" } },
	);
	process.env.SENDING_ENABLED = "true";
	await AutomationRun.updateMany({}, { $set: { nextAt: new Date(0) } });
	await tick();
	assert.equal(
		(await AutomationRun.findOne({ automationId: automation._id })).status,
		"stopped",
	);
	const second = await contact("active", "other@example.com");
	await Suppression.create({ email: second.email, reason: "complaint" });
	await recordSignup(second);
	await tick();
	assert.equal(await AutomationRun.countDocuments(), 1);
	assert.equal(sends, 0);
});

test("real MongoDB: historical orders build currency-safe profiles without enrolling anyone", async () => {
	await contact();
	await flow("order.paid");
	await receive("order.updated", orderData(), "historic-1", true);
	await receive(
		"order.updated",
		{ ...orderData(), externalId: "wc:101", currency: "EUR", total: 20 },
		"historic-2",
		true,
	);
	await tick();
	const customer = await Contact.findOne({ email: "alex@example.com" }).lean();
	assert.equal(customer.commerce.orderCount, 2);
	assert.deepEqual(customer.commerce.spendByCurrency, { SEK: 100, EUR: 20 });
	assert.equal(await AutomationRun.countDocuments(), 0);
	assert.equal(sends, 0);
	await receive("order.updated", {
		...orderData(),
		externalId: "wc:100",
		updatedAt: new Date(Date.now() + 1000).toISOString(),
		status: "refunded",
		paidAt: undefined,
		total: 0,
	});
	await tick();
	assert.equal((await Contact.findById(customer._id)).commerce.orderCount, 1);
});

test("real MongoDB: commerce never activates unknown or opted-out customers; imports preserve restrictions", async () => {
	await flow("order.paid");
	await receive("order.updated", orderData());
	await tick();
	let customer = await Contact.findOne({ email: "alex@example.com" });
	assert.equal(customer.status, "dormant");
	assert.equal(sends, 0);
	await Contact.updateOne(
		{ _id: customer._id },
		{ $set: { status: "unsubscribed" } },
	);
	await importContactRows({
		newsletterId: newsletter._id,
		rows: [
			{
				email: customer.email,
				status: "active",
				firstName: "Alex",
				language: "sv",
			},
		],
	});
	customer = await Contact.findById(customer._id);
	assert.equal(customer.status, "unsubscribed");
	assert.equal(customer.firstName, "Alex");
});

test("real MongoDB: stale cart events cannot undo a newer closed cart", async () => {
	await contact();
	await flow("cart.abandoned");
	const data = cartData();
	await receive("cart.updated", {
		...data,
		status: "closed",
		updatedAt: hoursAgo(1).toISOString(),
	});
	await tick();
	await receive("cart.updated", data);
	await tick();
	assert.equal((await CommerceRecord.findOne()).status, "closed");
	assert.equal(sends, 0);
});

test("real MongoDB: if/else uses current profile; runs keep their original published definition", async () => {
	const customer = await contact();
	const definition = {
		start: "condition",
		nodes: [
			{
				id: "condition",
				type: "condition",
				label: "Swedish?",
				rules: { field: "language", op: "eq", value: "sv" },
				yes: "tag",
				no: "end",
			},
			{ id: "tag", type: "tag", label: "Tag", tag: "sv-journey", next: "end" },
			{ id: "end", type: "end", label: "Done" },
		],
	};
	const automation = await flow("subscribed", definition);
	await recordSignup(customer);
	await Automation.updateOne(
		{ _id: automation._id },
		{ $set: { status: "paused" } },
	);
	await tick();
	assert.equal(await AutomationRun.countDocuments(), 0);
	await Automation.updateOne(
		{ _id: automation._id },
		{ $set: { status: "active" } },
	);
	await recordSignup({
		...customer.toObject(),
		subscribedAt: new Date(Date.now() + 1),
	});
	await tick();
	assert.ok((await Contact.findById(customer._id)).tags.includes("sv-journey"));
	const run = await AutomationRun.findOne();
	await Automation.updateOne(
		{ _id: automation._id },
		{ $set: { definition: starterDefinition("subscribed") } },
	);
	assert.equal(
		(await AutomationRun.findById(run._id)).definition.start,
		"condition",
	);
});

test("real MongoDB: uncertain delivery fails for human review and never sends a second copy", async () => {
	const customer = await contact();
	await flow("subscribed");
	await recordSignup(customer);
	const uncertain = async (ids) => {
		sends++;
		await Message.updateMany(
			{ _id: { $in: ids } },
			{ $set: { status: "sent" } },
		);
	};
	await tickAutomations({ sendBatch: uncertain });
	await tick();
	assert.equal((await AutomationRun.findOne()).status, "failed");
	assert.match((await AutomationRun.findOne()).error, /uncertain/);
	assert.equal(sends, 1);
});

test("real MongoDB: worker lease excludes concurrent ticks and both feature switches default off", async () => {
	await WorkerLease.create({
		_id: "automations",
		token: "another-worker",
		expiresAt: new Date(Date.now() + 60000),
	});
	assert.deepEqual(await tick(), { busy: true });
	delete process.env.AUTOMATIONS_ENABLED;
	assert.deepEqual(await tick(), { disabled: true });
});

test("real MongoDB: segment query results equal in-memory decisions, including missing fields", async () => {
	await contact();
	await Contact.create({
		newsletterId: newsletter._id,
		email: "missing@example.com",
		status: "active",
	});
	await Contact.create({
		newsletterId: newsletter._id,
		email: "en@example.com",
		language: "en",
		status: "active",
	});
	const rules = { field: "language", op: "ne", value: "sv" };
	const rows = await Contact.find().lean();
	const selected = await Contact.find(rulesToQuery(rules)).lean();
	assert.deepEqual(
		selected.map((c) => c.email),
		rows.filter((c) => matchesRules(rules, c)).map((c) => c.email),
	);
});

test("real MongoDB: new paid purchases enroll once, even when their status is synced again", async () => {
	await contact();
	await flow("order.paid");
	await receive("order.updated", orderData());
	await tick();
	await receive("order.updated", {
		...orderData(),
		updatedAt: new Date(Date.now() + 1000).toISOString(),
	});
	await tick();
	assert.equal(await AutomationRun.countDocuments(), 1);
	assert.equal(sends, 1);
});

test("real MongoDB: changing or revoking a cart retires the old snapshot at receipt time", async () => {
	await contact();
	await flow("cart.abandoned");
	await receive("cart.updated", cartData());
	process.env.SENDING_ENABLED = "false";
	await tick();
	await receive("cart.updated", {
		...cartData(),
		updatedAt: hoursAgo(1).toISOString(),
		status: "closed",
		items: [],
	});
	assert.equal(
		(await CommerceRecord.findOne({ kind: "cart" })).status,
		"closed",
	);
	process.env.SENDING_ENABLED = "true";
	await AutomationRun.updateMany({}, { $set: { nextAt: new Date(0) } });
	await tick();
	assert.equal(sends, 0);
	assert.equal((await AutomationRun.findOne()).status, "stopped");
});

test("real MongoDB: transient ingestion failure retries without duplicating effects", async () => {
	await contact();
	await flow("order.paid");
	await receive("order.updated", orderData());
	await CommerceStore.updateOne(
		{ _id: store._id },
		{ $set: { enabled: false } },
	);
	await tick();
	assert.equal((await AutomationEvent.findOne()).status, "pending");
	assert.equal((await AutomationEvent.findOne()).attempts, 1);
	await CommerceStore.updateOne(
		{ _id: store._id },
		{ $set: { enabled: true } },
	);
	await AutomationEvent.updateMany({}, { $set: { nextAt: new Date(0) } });
	await tick();
	await tick();
	assert.equal((await AutomationEvent.findOne()).status, "processed");
	assert.equal(sends, 1);
});

test("real MongoDB: excessive bounce rates automatically pause the flow", async () => {
	const customer = await contact();
	const automation = await flow("subscribed");
	await Message.insertMany(
		Array.from({ length: 100 }, (_, index) => ({
			kind: "automation",
			automationId: automation._id,
			automationRunId: new mongoose.Types.ObjectId(),
			automationNodeId: "email",
			newsletterId: newsletter._id,
			contactId: customer._id,
			email: customer.email,
			status: index < 3 ? "bounced" : "sent",
			sentAt: new Date(),
			...(index < 3 && { bouncedAt: new Date() }),
		})),
	);
	assert.equal(await pauseUnhealthyAutomation(automation._id), true);
	assert.equal((await Automation.findById(automation._id)).status, "paused");
});

test("real MongoDB: an unprocessed purchase stops a cart created after the purchase event arrived", async () => {
	// No contact or cart exists when the order arrives, so receipt-time record updates match nothing.
	await receive("order.updated", orderData());
	const customer = await contact();
	const automation = await flow("cart.abandoned");
	const cart = await CommerceRecord.create({
		...normalizeCommerceEvent(
			{ id: "cart", type: "cart.updated", data: cartData() },
			store,
		).data,
		storeId: store._id,
		newsletterId: newsletter._id,
		kind: "cart",
	});
	const run = await AutomationRun.create({
		automationId: automation._id,
		newsletterId: newsletter._id,
		contactId: customer._id,
		eventKey: "test-backlog",
		trigger: "cart.abandoned",
		definition: automation.definition,
		nodeId: "email",
		context: {
			storeId: String(store._id),
			cartId: String(cart._id),
			cartVersion: cart.version,
		},
	});
	await stepRun(run.toObject(), sendBatch);
	assert.equal(sends, 0);
	assert.equal((await AutomationRun.findById(run._id)).status, "stopped");
	assert.equal(
		(await AutomationEvent.findOne({ type: "order.updated" })).status,
		"pending",
	);
});

test("real MongoDB: concurrent duplicate receipts are safe and conflicting event IDs are rejected", async () => {
	const data = cartData();
	await Promise.all(
		Array.from({ length: 10 }, () =>
			receive("cart.updated", data, "concurrent-event"),
		),
	);
	assert.equal(await AutomationEvent.countDocuments(), 1);
	await assert.rejects(
		() => receive("cart.updated", { ...data, total: 200 }, "concurrent-event"),
		/different payload/,
	);
});

test("real MongoDB: visual design survives snapshots and queues its compiled email", async () => {
	await contact();
	const design = JSON.parse(
		await readFile(
			new URL("../public/email-templates/cart-sv.json", import.meta.url),
			"utf8",
		),
	);
	design.blocks.find((block) => block.type === "heading").title =
		"Din redigerade varukorg";
	const definition = normalizeDefinition({
		start: "email",
		nodes: [
			{
				id: "email",
				type: "email",
				subject: "Din varukorg",
				design,
				html: "forged",
				next: "end",
			},
			{ id: "end", type: "end" },
		],
	});
	await flow("cart.abandoned", definition);
	await receive("cart.updated", cartData());
	await tick();
	const run = await AutomationRun.findOne().lean();
	assert.deepEqual(run.definition.nodes[0].design, definition.nodes[0].design);
	const message = await Message.findOne().lean();
	assert.equal(
		message.content.html,
		renderEmailDesign(definition.nodes[0].design),
	);
	assert.match(message.content.html, /Din redigerade varukorg/);
	assert.doesNotMatch(message.content.html, /forged/);
	assert.equal(message.content.checkoutUrl, cartData().checkoutUrl);
	assert.equal(sends, 1);
});

// The delivery stub writes sentAt only; no provider or actual mailbox is used.
async function recoverableOrder() {
	process.env.SESSION_SECRET =
		"integration-recovery-secret-at-least-32-characters";
	await contact();
	const automation = await flow("cart.abandoned");
	await receive("cart.updated", cartData());
	await tick();
	const message = await Message.findOne({
		automationId: automation._id,
	}).lean();
	await Message.updateOne(
		{ _id: message._id },
		{ $set: { sentAt: hoursAgo(1) } },
	);
	const run = await AutomationRun.findById(message.automationRunId).lean();
	const { createRecoveryToken } = await import("../lib/recovery-tokens.js");
	return {
		automation,
		message,
		run,
		data: {
			...orderData(),
			recoveryTouch: {
				token: createRecoveryToken(message._id),
				cartExternalId: run.context.cartExternalId,
				cartVersion: run.context.cartVersion.toISOString(),
				touchedAt: hoursAgo(0.75).toISOString(),
			},
		},
	};
}
const recoveryReport = async (id) =>
	(await import("../lib/recovery-attribution.js")).getRecoveryReport(id);

test("real MongoDB: recovery attributes one paid order to its email and retries do not duplicate revenue", async () => {
	const { automation, message, data } = await recoverableOrder();
	await receive("order.updated", data, "recovery-order");
	assert.equal((await tick()).failed, 0);
	await receive("order.updated", data, "recovery-order");
	await tick();
	const order = await CommerceRecord.findOne({ kind: "order" }).lean();
	assert.equal(String(order.recovery.messageId), String(message._id));
	const report = await recoveryReport(automation._id);
	assert.equal(report.orders, 1);
	assert.equal(report.sent, 1);
	assert.deepEqual(report.revenue, { SEK: 100 });
	assert.equal(report.nodes[0].id, "email");
	assert.equal(report.nodes[0].orders, 1);
	assert.equal(report.recent[0].externalId, data.externalId);
});
test("real MongoDB: refunds update attributed revenue and stale paid events cannot undo them", async () => {
	const { automation, data } = await recoverableOrder();
	await receive("order.updated", data);
	await tick();
	await receive("order.updated", {
		...data,
		total: 60,
		updatedAt: new Date(Date.now() + 1000).toISOString(),
	});
	await tick();
	assert.deepEqual((await recoveryReport(automation._id)).revenue, { SEK: 60 });
	await receive("order.updated", {
		...data,
		status: "refunded",
		total: 0,
		paidAt: undefined,
		updatedAt: new Date(Date.now() + 2000).toISOString(),
	});
	await tick();
	await receive("order.updated", data);
	await tick();
	const report = await recoveryReport(automation._id);
	assert.equal(report.orders, 0);
	assert.deepEqual(report.revenue, {});
	assert.equal(report.recent[0].status, "refunded");
	assert.equal(report.recent[0].total, 0);
	assert.ok((await CommerceRecord.findOne({ kind: "order" })).recovery);
});
test("real MongoDB: competing orders and concurrent attribution can consume a cart version only once", async () => {
	const { automation, data } = await recoverableOrder();
	await Promise.all([
		receive("order.updated", data),
		receive("order.updated", { ...data, externalId: "wc:101" }),
	]);
	assert.equal((await tick()).failed, 0);
	const { attributeRecoveredOrder } =
		await import("../lib/recovery-attribution.js");
	const orders = await CommerceRecord.find({ kind: "order" }).lean();
	await Promise.all(
		orders.flatMap((order) => [
			attributeRecoveredOrder(order),
			attributeRecoveredOrder(order),
		]),
	);
	assert.equal((await recoveryReport(automation._id)).orders, 1);
	assert.equal(
		await CommerceRecord.countDocuments({
			"recovery.cartKey": { $exists: true },
		}),
		1,
	);
});
test("real MongoDB: same-email purchases, historical orders and forged cart metadata receive no credit", async () => {
	const { automation, data } = await recoverableOrder();
	await receive("order.updated", {
		...data,
		externalId: "wc:plain",
		recoveryTouch: undefined,
	});
	await receive(
		"order.updated",
		{ ...data, externalId: "wc:history" },
		"history",
		true,
	);
	await receive("order.updated", {
		...data,
		externalId: "wc:wrong-cart",
		recoveryTouch: { ...data.recoveryTouch, cartExternalId: "wrong" },
	});
	await receive("order.updated", {
		...data,
		externalId: "wc:forged",
		recoveryTouch: {
			...data.recoveryTouch,
			token: `${"f".repeat(24)}.${"a".repeat(43)}`,
		},
	});
	assert.equal((await tick()).failed, 0);
	assert.equal((await recoveryReport(automation._id)).orders, 0);
});
test("real MongoDB: delayed payment credits an order placed inside the window and cancellation removes it", async () => {
	const { automation, data } = await recoverableOrder();
	await receive("order.updated", {
		...data,
		status: "placed",
		paidAt: undefined,
	});
	await tick();
	assert.equal((await recoveryReport(automation._id)).orders, 0);
	await receive("order.updated", {
		...data,
		paidAt: new Date().toISOString(),
		updatedAt: new Date(Date.now() + 1000).toISOString(),
	});
	await tick();
	assert.equal((await recoveryReport(automation._id)).orders, 1);
	await receive("order.updated", {
		...data,
		status: "cancelled",
		paidAt: undefined,
		updatedAt: new Date(Date.now() + 2000).toISOString(),
	});
	await tick();
	const report = await recoveryReport(automation._id);
	assert.equal(report.orders, 0);
	assert.equal(report.recent[0].status, "cancelled");
});
test("real MongoDB: reports keep currencies and steps separate and history is bounded", async () => {
	const { automation, message } = await recoverableOrder();
	const message2 = await Message.create({
		kind: "automation",
		newsletterId: newsletter._id,
		automationId: automation._id,
		automationRunId: new mongoose.Types.ObjectId(),
		automationNodeId: "second",
		email: "a@example.com",
		sentAt: new Date(),
		content: { subject: "Second reminder" },
	});
	const rows = Array.from({ length: 35 }, (_, index) => ({
		storeId: store._id,
		newsletterId: newsletter._id,
		kind: "order",
		externalId: `wc:report-${index}`,
		email: "alex@example.com",
		version: new Date(),
		placedAt: new Date(Date.now() - index * 1000),
		paidAt: new Date(),
		status: "paid",
		currency: index % 2 ? "EUR" : "SEK",
		total: index % 2 ? 12.35 : 100,
		recovery: {
			automationId: automation._id,
			messageId: index % 2 ? message2._id : message._id,
			nodeId: index % 2 ? "second" : "email",
			nodeLabel: index % 2 ? "Second reminder" : "First reminder",
			cartKey: `synthetic-${index}`,
		},
	}));
	await CommerceRecord.insertMany(rows);
	const report = await recoveryReport(automation._id);
	assert.equal(report.orders, 35);
	assert.equal(report.sent, 2);
	assert.deepEqual(report.revenue, { SEK: 1800, EUR: 209.95 });
	assert.equal(report.nodes.length, 2);
	assert.equal(report.recent.length, 30);
	assert.equal(report.recent[0].externalId, "wc:report-0");
});

test("real MongoDB: payment after seven days can credit an order placed promptly after the link visit", async () => {
	const { automation, message, run, data } = await recoverableOrder();
	const cartVersion = hoursAgo(300);
	await AutomationRun.updateOne(
		{ _id: run._id },
		{ $set: { "context.cartVersion": cartVersion } },
	);
	await Message.updateOne(
		{ _id: message._id },
		{ $set: { sentAt: hoursAgo(280) } },
	);
	await receive("order.updated", {
		...data,
		placedAt: hoursAgo(250).toISOString(),
		paidAt: new Date().toISOString(),
		updatedAt: new Date(Date.now() + 1000).toISOString(),
		recoveryTouch: {
			...data.recoveryTouch,
			cartVersion: cartVersion.toISOString(),
			touchedAt: hoursAgo(260).toISOString(),
		},
	});
	assert.equal((await tick()).failed, 0);
	assert.equal((await recoveryReport(automation._id)).orders, 1);
});

test("real MongoDB: a historical order cannot gain recovery credit from later live updates", async () => {
	const { automation, data } = await recoverableOrder();
	await receive("order.updated", data, "history-first", true);
	await tick();
	await receive("order.updated", {
		...data,
		updatedAt: new Date(Date.now() + 1000).toISOString(),
	});
	await tick();
	assert.equal((await recoveryReport(automation._id)).orders, 0);
	assert.equal(
		(await CommerceRecord.findOne({ kind: "order" })).recoveryExcluded,
		true,
	);
});
