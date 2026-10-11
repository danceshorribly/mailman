import { normalizeEmail } from "./validation.js";
import { normalizeProfile } from "./customer-profile.js";

export function normalizeStoreOrigin(input) {
	const url = new URL(input);
	if (
		url.protocol !== "https:" ||
		url.username ||
		url.password ||
		url.hostname === "localhost"
	)
		throw new Error("Use the shop's public HTTPS origin");
	return url.origin;
}

export function normalizeCommerceEvent(input, store, now = new Date()) {
	if (!input || !["order.updated", "cart.updated"].includes(input.type))
		throw new Error("Unknown event type");
	if (typeof input.id !== "string" || !/^[A-Za-z0-9:_-]{1,150}$/.test(input.id))
		throw new Error("Provide a stable event id");
	const data = input.data;
	const email = normalizeEmail(data?.email);
	if (
		!email ||
		!data ||
		typeof data.externalId !== "string" ||
		!/^[A-Za-z0-9:_-]{1,100}$/.test(data.externalId)
	)
		throw new Error("Invalid email or externalId");
	const version = new Date(data.updatedAt);
	if (
		!Number.isFinite(version.getTime()) ||
		version > new Date(now.getTime() + 5 * 60000)
	)
		throw new Error("Invalid updatedAt");
	if (typeof data.currency !== "string" || !/^[A-Z]{3}$/.test(data.currency))
		throw new Error("Use an ISO currency code");
	if (
		typeof data.total !== "number" ||
		!Number.isFinite(data.total) ||
		data.total < 0 ||
		data.total > 1e9
	)
		throw new Error("Invalid total");
	if (!Array.isArray(data.items) || data.items.length > 100)
		throw new Error("Invalid items");
	const items = data.items.map((item) => {
		if (
			!item ||
			!/^[0-9]{1,20}$/.test(String(item.productId)) ||
			!Number.isInteger(item.quantity) ||
			item.quantity < 1 ||
			item.quantity > 1000
		)
			throw new Error("Invalid line item");
		return {
			productId: String(item.productId),
			variationId: /^[0-9]{1,20}$/.test(String(item.variationId))
				? String(item.variationId)
				: undefined,
			name: typeof item.name === "string" ? item.name.slice(0, 200) : "",
			quantity: item.quantity,
		};
	});
	const normalized = {
		externalId: data.externalId,
		email,
		version,
		currency: data.currency,
		total: data.total,
		items,
		historical: input.historical === true,
		profile: normalizeProfile(data.profile),
	};
	if (input.type === "order.updated") {
		if (!["placed", "paid", "cancelled", "refunded"].includes(data.status))
			throw new Error("Invalid order status");
		const placedAt = new Date(data.placedAt);
		if (!Number.isFinite(placedAt.getTime()) || placedAt > version)
			throw new Error("Invalid placedAt");
		normalized.placedAt = placedAt;
		normalized.status = data.status;
		if (data.status === "paid") {
			const paidAt = new Date(data.paidAt);
			if (!Number.isFinite(paidAt.getTime()) || paidAt > version)
				throw new Error("Invalid paidAt");
			normalized.paidAt = paidAt;
		}
	} else {
		if (!["open", "closed"].includes(data.status))
			throw new Error("Invalid cart status");
		normalized.status = items.length ? data.status : "closed";
		if (normalized.status === "open") {
			const url = new URL(data.checkoutUrl);
			if (
				url.origin !== store.origin ||
				url.username ||
				url.password ||
				url.protocol !== "https:"
			)
				throw new Error("Recovery link must belong to this shop");
			const expiresAt = new Date(data.expiresAt);
			if (
				!Number.isFinite(expiresAt.getTime()) ||
				expiresAt <= version ||
				expiresAt > new Date(now.getTime() + 30 * 86400000)
			)
				throw new Error("Invalid recovery link expiry");
			normalized.checkoutUrl = url.href;
			normalized.expiresAt = expiresAt;
			normalized.abandonedAt = new Date(version.getTime() + 60 * 60000);
		}
	}
	return { id: input.id, type: input.type, data: normalized };
}

export function commerceSummary(orders) {
	const paid = orders.filter(
		(order) => order.status === "paid" && order.paidAt,
	);
	const spendByCurrency = {};
	for (const order of paid)
		spendByCurrency[order.currency] =
			Math.round(((spendByCurrency[order.currency] || 0) + order.total) * 100) /
			100;
	return {
		orderCount: paid.length,
		spendByCurrency,
		productIds: [
			...new Set(
				paid.flatMap((order) => order.items.map((item) => item.productId)),
			),
		],
		lastOrderAt: paid.length
			? new Date(
					Math.max(...paid.map((order) => new Date(order.paidAt).getTime())),
				)
			: null,
		lastPlacedOrderAt: orders.length
			? new Date(
					Math.max(
						...orders.map((order) => new Date(order.placedAt).getTime()),
					),
				)
			: null,
	};
}
