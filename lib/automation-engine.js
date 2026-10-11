import { createHash, randomUUID } from "node:crypto";
import Automation from "../models/Automation.js";
import AutomationRun from "../models/AutomationRun.js";
import AutomationEvent from "../models/AutomationEvent.js";
import CommerceRecord from "../models/CommerceRecord.js";
import CommerceStore from "../models/CommerceStore.js";
import Contact from "../models/Contact.js";
import Message from "../models/Message.js";
import Suppression from "../models/Suppression.js";
import WorkerLease from "../models/WorkerLease.js";
import { commerceSummary } from "./commerce-rules.js";
import { matchesRules } from "./segments.js";
import { normalizeDefinition, runStopReason } from "./automation-rules.js";
import { getCampaignPauseReason } from "./sending-rules.js";

export const automationsEnabled = () =>
	process.env.AUTOMATIONS_ENABLED === "true";

async function ensureIndexes() {
	// init() is cached by Mongoose. Await the unique indexes before the first live event or tick.
	await Promise.all([AutomationEvent, AutomationRun, CommerceRecord, Message, Contact].map((model) => model.init()));
}

// The journal is written in the request, never in after(). A worker retries incomplete events.
export async function recordSignup(contact) {
	if (contact.status !== "active") return;
	await ensureIndexes();
	const key = `signup:${contact._id}:${new Date(contact.subscribedAt).toISOString()}`;
	await AutomationEvent.updateOne(
		{ key },
		{
			$setOnInsert: {
				newsletterId: contact.newsletterId,
				type: "subscribed",
				payload: { contactId: String(contact._id) },
			},
		},
		{ upsert: true },
	);
}

export async function acceptCommerceEvent(event, store) {
	await ensureIndexes();
	const key = `store:${store._id}:${event.id}`;
	const payloadHash = createHash("sha256")
		.update(JSON.stringify({ type: event.type, data: event.data }))
		.digest("hex");
	let inserted = false;
	try {
		const result = await AutomationEvent.updateOne(
			{ key },
			{
				$setOnInsert: {
					storeId: store._id,
					newsletterId: store.newsletterId,
					type: event.type,
					payload: event.data,
					payloadHash,
				},
			},
			{ upsert: true },
		);
		inserted = Boolean(result.upsertedCount);
	} catch (error) {
		if (error.code !== 11000) throw error;
	}
	const saved = await AutomationEvent.findOne({ key })
		.select("payloadHash")
		.lean();
	if (saved?.payloadHash !== payloadHash) {
		const error = new Error(
			"Event ID was already used for a different payload",
		);
		error.code = "EVENT_ID_CONFLICT";
		throw error;
	}
	// Stop reminders on receipt, even while the import journal is catching up.
	if (event.type === "order.updated") {
		await CommerceRecord.updateMany(
			{
				storeId: store._id,
				kind: "cart",
				email: event.data.email,
				status: "open",
				version: { $lte: event.data.placedAt },
			},
			{ $set: { status: "closed" } },
		);
		await Contact.updateOne(
			{ newsletterId: store.newsletterId, email: event.data.email },
			{ $max: { "commerce.lastPlacedOrderAt": event.data.placedAt } },
		);
	} else {
		// Retire an older captured version immediately. Applying the journal installs the new snapshot.
		await CommerceRecord.updateOne(
			{
				storeId: store._id,
				kind: "cart",
				externalId: event.data.externalId,
				version: { $lt: event.data.version },
			},
			{ $set: { status: "closed" } },
		);
	}
	await CommerceStore.updateOne(
		{ _id: store._id },
		{ $set: { lastEventAt: new Date() } },
	);
	return { accepted: true, duplicate: !inserted };
}

async function enroll({
	newsletterId,
	contact,
	trigger,
	eventKey,
	context = {},
	occurredAt,
}) {
	if (
		contact?.status !== "active" ||
		(await Suppression.exists({ email: contact.email }))
	)
		return;
	const flows = await Automation.find({
		newsletterId,
		trigger,
		status: "active",
		activatedAt: { $lte: occurredAt },
	}).lean();
	for (const flow of flows) {
		const definition = normalizeDefinition(flow.definition);
		await AutomationRun.updateOne(
			{ automationId: flow._id, contactId: contact._id, eventKey },
			{
				$setOnInsert: {
					newsletterId,
					trigger,
					definition,
					revision: flow.revision,
					context,
					nodeId: definition.start,
					nextAt: new Date(),
				},
			},
			{ upsert: true },
		);
	}
}

async function applyEvent(event) {
	if (event.type === "subscribed") {
		const contact = await Contact.findOne({
			_id: event.payload.contactId,
			newsletterId: event.newsletterId,
		}).lean();
		await enroll({
			newsletterId: event.newsletterId,
			contact,
			trigger: "subscribed",
			eventKey: event.key,
			occurredAt: new Date(
				contact?.confirmedAt || contact?.subscribedAt || event.createdAt,
			),
		});
		return;
	}
	const store = await CommerceStore.findById(event.storeId).lean();
	if (!store?.enabled) throw new Error("Shop integration is disabled");
	const { profile, ...data } = event.payload;
	const kind = event.type === "order.updated" ? "order" : "cart";
	const identity = {
		storeId: event.storeId,
		kind,
		externalId: data.externalId,
	};
	const existing = await CommerceRecord.findOne(identity).lean();
	// Stale events cannot restore an older cart or undo a refund.
	if (!existing || new Date(existing.version) < new Date(data.version)) {
		await CommerceRecord.updateOne(
			identity,
			{
				$set: { ...data, newsletterId: event.newsletterId },
				...(!data.paidAt && { $unset: { paidAt: 1 } }),
			},
			{ upsert: true },
		);
	}
	// New commerce-only contacts are dormant. Neither orders nor cookie consent subscribe them.
	await Contact.updateOne(
		{ newsletterId: event.newsletterId, email: data.email },
		{
			$setOnInsert: { status: "dormant", source: "woocommerce" },
		},
		{ upsert: true },
	);
	if (!existing || new Date(existing.version) <= new Date(data.version)) {
		const update = { ...profile };
		delete update.tags; // Commerce payloads cannot erase editorial tags.
		if (Object.keys(update).length)
			await Contact.updateOne(
				{ newsletterId: event.newsletterId, email: data.email },
				{ $set: update },
			);
	}
	const orders = await CommerceRecord.find({
		newsletterId: event.newsletterId,
		kind: "order",
		email: data.email,
	}).lean();
	const summary = commerceSummary(orders);
	// Recompute totals, but preserve the receipt-time purchase guard against an event backlog.
	const placedAt = summary.lastPlacedOrderAt;
	delete summary.lastPlacedOrderAt;
	const contact = await Contact.findOneAndUpdate(
		{ newsletterId: event.newsletterId, email: data.email },
		{
			$set: Object.fromEntries(
				Object.entries(summary).map(([key, value]) => [
					`commerce.${key}`,
					value,
				]),
			),
			...(placedAt && { $max: { "commerce.lastPlacedOrderAt": placedAt } }),
		},
		{ returnDocument: "after" },
	).lean();
	const record = await CommerceRecord.findOne(identity).lean();
	if (kind === "order") {
		await CommerceRecord.updateMany(
			{
				storeId: store._id,
				kind: "cart",
				email: data.email,
				status: "open",
				version: { $lte: data.placedAt },
			},
			{ $set: { status: "closed" } },
		);
		if (
			!data.historical &&
			record.status === "paid" &&
			new Date(record.version).getTime() === new Date(data.version).getTime()
		) {
			await enroll({
				newsletterId: event.newsletterId,
				contact,
				trigger: "order.paid",
				eventKey: `paid:${store._id}:${data.externalId}`,
				context: { orderId: String(record._id), storeId: String(store._id) },
				occurredAt: new Date(data.paidAt),
			});
		}
	}
}

async function enrollCarts(now) {
	const carts = await CommerceRecord.find({
		kind: "cart",
		status: "open",
		historical: { $ne: true },
		abandonedAt: { $lte: now },
		expiresAt: { $gt: now },
		$expr: { $ne: ["$version", { $ifNull: ["$enrolledVersion", null] }] },
	})
		.sort({ abandonedAt: 1 })
		.limit(50)
		.lean();
	for (const cart of carts) {
		const store = await CommerceStore.findOne({
			_id: cart.storeId,
			enabled: true,
		}).lean();
		if (!store) continue;
		const contact = await Contact.findOne({
			newsletterId: cart.newsletterId,
			email: cart.email,
		}).lean();
		if (
			contact?.commerce?.lastPlacedOrderAt &&
			new Date(contact.commerce.lastPlacedOrderAt) >= new Date(cart.version)
		) {
			await CommerceRecord.updateOne(
				{ _id: cart._id, version: cart.version },
				{ $set: { status: "closed" } },
			);
			continue;
		}
		await enroll({
			newsletterId: cart.newsletterId,
			contact,
			trigger: "cart.abandoned",
			eventKey: `cart:${cart._id}:${new Date(cart.version).toISOString()}`,
			context: {
				cartId: String(cart._id),
				cartVersion: cart.version,
				storeId: String(cart.storeId),
			},
			occurredAt: new Date(cart.version),
		});
		await CommerceRecord.updateOne(
			{ _id: cart._id, version: cart.version },
			{ $set: { enrolledVersion: cart.version } },
		);
	}
}

export async function automationEligibility(run) {
	const [contact, automation, cart] = await Promise.all([
		Contact.findById(run.contactId).lean(),
		Automation.findById(run.automationId).lean(),
		run.context?.cartId
			? CommerceRecord.findById(run.context.cartId).lean()
			: null,
	]);
	const suppressed =
		contact && (await Suppression.exists({ email: contact.email }));
	const store =
		run.context?.storeId &&
		(await CommerceStore.findById(run.context.storeId).lean());
	let stopReason =
		run.context?.storeId && !store?.enabled
			? "Shop integration disabled"
			: runStopReason({ contact, automation, cart, suppressed, run });
	if (!stopReason && cart) {
		// A purchase can arrive before the contact/cart record exists, or behind a large import.
		// The journal itself is authoritative for cancellation before its materialized views catch up.
		if (
			await AutomationEvent.exists({
				storeId: cart.storeId,
				type: "order.updated",
				"payload.email": contact.email,
				"payload.placedAt": { $gte: cart.version },
			})
		)
			stopReason = "Customer placed an order";
		else if (
			await AutomationEvent.exists({
				storeId: cart.storeId,
				type: "cart.updated",
				"payload.externalId": cart.externalId,
				"payload.version": { $gt: cart.version },
			})
		)
			stopReason = "Newer cart event received";
	}
	return { contact, automation, cart, stopReason };
}

export async function pauseUnhealthyAutomation(automationId) {
	const [stats] = await Message.aggregate([
		{
			$match: {
				automationId,
				sentAt: { $gte: new Date(Date.now() - 30 * 86400000) },
			},
		},
		{
			$group: {
				_id: null,
				sent: { $sum: 1 },
				bounced: {
					$sum: {
						$cond: [{ $ne: [{ $ifNull: ["$bouncedAt", null] }, null] }, 1, 0],
					},
				},
				complained: {
					$sum: {
						$cond: [
							{ $ne: [{ $ifNull: ["$complainedAt", null] }, null] },
							1,
							0,
						],
					},
				},
			},
		},
	]);
	const reason = getCampaignPauseReason(stats);
	if (reason)
		await Automation.updateOne(
			{ _id: automationId, status: "active" },
			{
				$set: {
					status: "paused",
					pauseReason: `${reason} is over the limit (last 30 days)`,
				},
			},
		);
	return Boolean(reason);
}

async function advanceRun(run, patch, outcome) {
	await AutomationRun.updateOne(
		{ _id: run._id, nodeId: run.nodeId, steps: run.steps, status: "running" },
		{
			$set: patch,
			$inc: { steps: 1 },
			$push: { history: { nodeId: run.nodeId, outcome, at: new Date() } },
		},
	);
}

export async function stepRun(run, sendBatch) {
	const { contact, automation, cart, stopReason } =
		await automationEligibility(run);
	// Pausing preserves a run at the current step, with its published definition.
	if (automation?.status === "paused") {
		await AutomationRun.updateOne(
			{ _id: run._id, status: "running" },
			{ $set: { nextAt: new Date(Date.now() + 60000) } },
		);
		return;
	}
	if (stopReason)
		return advanceRun(run, { status: "stopped", error: stopReason }, "stopped");
	if (run.steps > 50) throw new Error("Step limit exceeded");
	const definition = normalizeDefinition(run.definition);
	const node = definition.nodes.find((node) => node.id === run.nodeId);
	if (!node) throw new Error("Step not found");
	if (node.type === "end")
		return advanceRun(run, { status: "completed" }, "completed");
	if (node.type === "wait")
		return advanceRun(
			run,
			{
				nodeId: node.next,
				nextAt: new Date(Date.now() + node.minutes * 60000),
			},
			"waiting",
		);
	if (node.type === "condition") {
		const yes = matchesRules(node.rules, contact);
		return advanceRun(
			run,
			{ nodeId: yes ? node.yes : node.no, nextAt: new Date() },
			yes ? "yes" : "no",
		);
	}
	if (node.type === "tag")
		await Contact.updateOne(
			{ _id: contact._id },
			{ $addToSet: { tags: node.tag } },
		);
	if (node.type === "email") {
		if (!automationsEnabled() || process.env.SENDING_ENABLED !== "true") {
			await AutomationRun.updateOne(
				{ _id: run._id, nodeId: run.nodeId, status: "running" },
				{ $set: { nextAt: new Date(Date.now() + 60000) } },
			);
			return;
		}
		if (await pauseUnhealthyAutomation(run.automationId)) return;
		const message = await Message.findOneAndUpdate(
			{
				kind: "automation",
				automationRunId: run._id,
				automationNodeId: node.id,
			},
			{
				$setOnInsert: {
					newsletterId: run.newsletterId,
					automationId: run.automationId,
					contactId: contact._id,
					email: contact.email,
					content: {
						format: node.format || "markdown",
						subject: node.subject,
						previewText: node.previewText,
						markdown: node.markdown,
						html: node.html,
						checkoutUrl: cart?.checkoutUrl || "",
					},
				},
			},
			{ upsert: true, returnDocument: "after" },
		).lean();
		if (message.status === "queued") await sendBatch([String(message._id)]);
		const outcome = await Message.findById(message._id).lean();
		if (outcome.status === "queued") {
			await AutomationRun.updateOne(
				{ _id: run._id, nodeId: run.nodeId, status: "running" },
				{ $set: { nextAt: new Date(Date.now() + 60000) } },
			);
			return;
		}
		if (outcome.status === "failed")
			throw new Error("Email failed; inspect the message before retrying");
		if (outcome.status === "suppressed")
			return advanceRun(run, { status: "stopped" }, "suppressed");
		// A process can die after claiming SES and before saving its response. Do not auto-resend.
		if (outcome.status === "sent" && !outcome.sentAt)
			throw new Error(
				"Delivery uncertain; manual review required (no automatic resend)",
			);
	}
	await advanceRun(
		run,
		{ nodeId: node.next, nextAt: new Date() },
		node.type === "email" ? "sent" : "tagged",
	);
}

export async function tickAutomations({ sendBatch, budgetMs = 40000 } = {}) {
	if (!automationsEnabled()) return { disabled: true };
	await ensureIndexes();
	const started = Date.now();
	const token = randomUUID();
	try {
		await WorkerLease.updateOne(
			{ _id: "automations", expiresAt: { $lte: new Date() } },
			{ $set: { token, expiresAt: new Date(Date.now() + 600000) } },
			{ upsert: true },
		);
	} catch (error) {
		if (error.code === 11000) return { busy: true };
		throw error;
	}
	const counts = { events: 0, steps: 0, failed: 0 };
	async function renew() {
		const result = await WorkerLease.updateOne(
			{ _id: "automations", token },
			{ $set: { expiresAt: new Date(Date.now() + 600000) } },
		);
		if (!result.matchedCount) throw new Error("Worker lease expired");
	}
	try {
		const events = await AutomationEvent.find({
			status: "pending",
			nextAt: { $lte: new Date() },
		})
			.sort({ createdAt: 1 })
			.limit(100)
			.lean();
		for (const event of events) {
			if (Date.now() - started > budgetMs) break;
			await renew();
			try {
				await applyEvent(event);
				await AutomationEvent.updateOne(
					{ _id: event._id },
					{ $set: { status: "processed" }, $unset: { error: 1 } },
				);
				counts.events++;
			} catch (error) {
				await AutomationEvent.updateOne(
					{ _id: event._id },
					{
						$inc: { attempts: 1 },
						$set: {
							status: event.attempts >= 9 ? "failed" : "pending",
							error: String(error.message).slice(0, 300),
							nextAt: new Date(
								Date.now() + Math.min(3600000, 30000 * 2 ** event.attempts),
							),
						},
					},
				);
				counts.failed++;
			}
		}
		if (Date.now() - started < budgetMs) await enrollCarts(new Date());
		const activeIds = await Automation.distinct("_id", { status: "active" });
		for (let i = 0; i < 100 && Date.now() - started < budgetMs; i++) {
			await renew();
			const run = await AutomationRun.findOne({
				automationId: { $in: activeIds },
				status: "running",
				nextAt: { $lte: new Date() },
			})
				.sort({ nextAt: 1 })
				.lean();
			if (!run) break;
			try {
				await stepRun(run, sendBatch);
				counts.steps++;
			} catch (error) {
				await advanceRun(
					run,
					{ status: "failed", error: String(error.message).slice(0, 300) },
					"failed",
				);
				counts.failed++;
			}
		}
		return counts;
	} finally {
		await WorkerLease.updateOne(
			{ _id: "automations", token },
			{ $set: { expiresAt: new Date(0) } },
		);
	}
}
