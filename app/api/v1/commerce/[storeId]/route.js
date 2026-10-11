import { isValidObjectId } from "mongoose";
import { authenticateRequest } from "@/lib/api-keys";
import { acceptCommerceEvent } from "@/lib/automation-engine";
import { normalizeCommerceEvent } from "@/lib/commerce-rules";
import { isRateLimited } from "@/lib/rate-limit";
import CommerceStore from "@/models/CommerceStore";

export async function POST(request, { params }) {
	const key = await authenticateRequest(request);
	if (!key) return Response.json({ error: "Invalid API key" }, { status: 401 });
	const { storeId } = await params;
	if (!isValidObjectId(storeId))
		return Response.json({ error: "Shop not found" }, { status: 404 });
	const store = await CommerceStore.findOne({
		_id: storeId,
		apiKeyId: key._id,
		enabled: true,
	}).lean();
	if (!store)
		return Response.json(
			{ error: "Shop not found or key has no access" },
			{ status: 403 },
		);
	if (
		await isRateLimited({
			name: "commerce",
			key: storeId,
			limit: 3600,
			window: "1 h",
		})
	)
		return Response.json({ error: "Rate limited" }, { status: 429 });
	const reader = request.body?.getReader();
	const chunks = [];
	let bytes = 0;
	if (reader) {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			bytes += value.byteLength;
			if (bytes > 100000) {
				await reader.cancel();
				return Response.json({ error: "Event too large" }, { status: 413 });
			}
			chunks.push(value);
		}
	}
	const raw = Buffer.concat(chunks).toString("utf8");
	let event;
	try {
		event = normalizeCommerceEvent(JSON.parse(raw), store);
	} catch (error) {
		return Response.json({ error: error.message }, { status: 400 });
	}
	try {
		return Response.json(await acceptCommerceEvent(event, store), {
			status: 202,
		});
	} catch (error) {
		if (error.code === "EVENT_ID_CONFLICT")
			return Response.json({ error: error.message }, { status: 409 });
		throw error;
	}
}
