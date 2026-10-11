import mongoose from "mongoose";
import Message from "../models/Message.js";
import AutomationRun from "../models/AutomationRun.js";
import CommerceRecord from "../models/CommerceRecord.js";
import { readRecoveryToken, RECOVERY_WINDOW_MS } from "./recovery-tokens.js";

// Identity and time checks use shop-reported order metadata, never email-only matching.
export function recoveryMatches({ order, message, run, touch }) {
	if (
		!message?.sentAt ||
		message.kind !== "automation" ||
		!run ||
		run.trigger !== "cart.abandoned"
	)
		return false;
	const context = run.context || {};
	if (
		String(order.storeId) !== context.storeId ||
		String(order.newsletterId) !== String(run.newsletterId) ||
		order.email !== message.email ||
		String(message.automationRunId) !== String(run._id) ||
		String(message.automationId) !== String(run.automationId) ||
		String(message.newsletterId) !== String(run.newsletterId) ||
		String(message.contactId) !== String(run.contactId)
	)
		return false;
	if (
		!context.cartId ||
		!run.definition?.nodes.some(
			(node) => node.id === message.automationNodeId && node.type === "email",
		)
	)
		return false;
	if (
		!context.cartExternalId ||
		!context.cartItems?.length ||
		touch.cartExternalId !== context.cartExternalId ||
		+new Date(touch.cartVersion) !== +new Date(context.cartVersion) ||
		order.currency !== context.currency
	)
		return false;
	const sent = +new Date(message.sentAt),
		clicked = +new Date(touch.touchedAt),
		placed = +new Date(order.placedAt);
	if (
		![sent, clicked, placed].every(Number.isFinite) ||
		clicked < sent ||
		placed < clicked ||
		placed - clicked > RECOVERY_WINDOW_MS ||
		clicked - sent > RECOVERY_WINDOW_MS
	)
		return false;
	return order.items.some((item) =>
		context.cartItems.some(
			(original) =>
				item.productId === original.productId &&
				(item.variationId || "") === (original.variationId || ""),
		),
	);
}

export async function attributeRecoveredOrder(order) {
	if (
		order.recovery ||
		order.historical ||
		order.recoveryExcluded ||
		order.kind !== "order" ||
		order.status !== "paid" ||
		!order.paidAt ||
		!order.recoveryTouch
	)
		return;
	const touch = order.recoveryTouch;
	const messageId = readRecoveryToken(touch.token);
	if (!messageId) return;
	const message = await Message.findById(messageId).lean();
	const run = message?.automationRunId
		? await AutomationRun.findById(message.automationRunId).lean()
		: null;
	if (!recoveryMatches({ order, message, run, touch })) return;
	const cartKey = `${run.context.cartId}:${new Date(run.context.cartVersion).toISOString()}`;
	try {
		await CommerceRecord.updateOne(
			{
				_id: order._id,
				version: order.version,
				status: "paid",
				recovery: { $exists: false },
			},
			{
				$set: {
					recovery: {
						messageId: message._id,
						automationId: run.automationId,
						runId: run._id,
						nodeId: message.automationNodeId,
						nodeLabel:
							run.definition.nodes.find(
								(node) => node.id === message.automationNodeId,
							)?.label || "Email",
						cartKey,
						touchedAt: touch.touchedAt,
						attributedAt: new Date(),
						model: "cart-link-7d",
					},
				},
			},
		);
	} catch (error) {
		// One restored cart version can recover only one order, even across flows and concurrent retries.
		if (error.code !== 11000) throw error;
	}
}

export async function getRecoveryReport(automationId) {
	const id = new mongoose.Types.ObjectId(String(automationId));
	const filter = { kind: "order", "recovery.automationId": id };
	const [counts, sent, recent] = await Promise.all([
		CommerceRecord.aggregate([
			{ $match: { ...filter, status: "paid" } },
			{
				$group: {
					_id: { node: "$recovery.nodeId", currency: "$currency" },
					label: { $last: "$recovery.nodeLabel" },
					orders: { $sum: 1 },
					total: { $sum: "$total" },
				},
			},
		]),
		Message.aggregate([
			{
				$match: {
					kind: "automation",
					automationId: id,
					sentAt: { $type: "date" },
				},
			},
			{
				$group: {
					_id: "$automationNodeId",
					sent: { $sum: 1 },
					label: {
						$last: { $ifNull: ["$automationNodeLabel", "$content.subject"] },
					},
				},
			},
		]),
		CommerceRecord.find(filter)
			.select("externalId email status currency total placedAt recovery")
			.sort({ placedAt: -1 })
			.limit(30)
			.lean(),
	]);
	const nodes = new Map(
		sent.map((row) => [
			row._id,
			{
				id: row._id,
				label: row.label || "Email",
				sent: row.sent,
				orders: 0,
				revenue: {},
			},
		]),
	);
	const revenue = {};
	let orders = 0;
	for (const row of counts) {
		const key = row._id.node;
		if (!nodes.has(key))
			nodes.set(key, {
				id: key,
				label: row.label || "Email",
				sent: 0,
				orders: 0,
				revenue: {},
			});
		const node = nodes.get(key);
		node.label = row.label || node.label;
		orders += row.orders;
		node.orders += row.orders;
		addMoney(revenue, row._id.currency, row.total);
		addMoney(node.revenue, row._id.currency, row.total);
	}
	return {
		sent: sent.reduce((total, row) => total + row.sent, 0),
		orders,
		revenue,
		nodes: [...nodes.values()].sort(
			(a, b) =>
				a.label.localeCompare(b.label) ||
				String(a.id).localeCompare(String(b.id)),
		),
		recent: recent.map((order) => ({
			id: String(order._id),
			externalId: order.externalId,
			email: order.email,
			status: order.status,
			currency: order.currency,
			total: order.status === "paid" ? order.total : 0,
			placedAt: new Date(order.placedAt).toISOString(),
			nodeLabel: order.recovery.nodeLabel,
		})),
	};
}
function addMoney(totals, currency, value) {
	let digits = 2;
	try {
		digits = new Intl.NumberFormat("en", {
			style: "currency",
			currency,
		}).resolvedOptions().maximumFractionDigits;
	} catch {
		/* Unknown ISO-like currencies use two decimals. */
	}
	const scale = 10 ** digits;
	totals[currency] =
		Math.round(((totals[currency] || 0) + value) * scale) / scale;
}
