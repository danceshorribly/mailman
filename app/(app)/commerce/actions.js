"use server";
import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { normalizeStoreOrigin } from "@/lib/commerce-rules";
import { getAppUrl } from "@/lib/config";
import { getQStash } from "@/lib/sending";
import CommerceStore from "@/models/CommerceStore";
import Newsletter from "@/models/Newsletter";
import ApiKey from "@/models/ApiKey";
import AutomationEvent from "@/models/AutomationEvent";

export async function createStore(_previous, formData) {
	await requireSession();
	await connectDb();
	try {
		const newsletterId = formData.get("newsletterId");
		const apiKeyId = formData.get("apiKeyId");
		if (
			!isValidObjectId(newsletterId) ||
			!isValidObjectId(apiKeyId) ||
			!(await Newsletter.exists({ _id: newsletterId })) ||
			!(await ApiKey.exists({ _id: apiKeyId, revokedAt: null }))
		)
			throw new Error("Choose a newsletter and an active API key");
		const origin = normalizeStoreOrigin(String(formData.get("origin")));
		await CommerceStore.create({
			newsletterId,
			apiKeyId,
			origin,
			name: String(formData.get("name") || "WooCommerce").slice(0, 100),
		});
		revalidatePath("/commerce");
		return { ok: true };
	} catch (error) {
		return { error: error.message };
	}
}

export async function toggleStore(id, enabled) {
	await requireSession();
	await connectDb();
	if (!isValidObjectId(id) || typeof enabled !== "boolean")
		throw new Error("Invalid request");
	await CommerceStore.updateOne({ _id: id }, { $set: { enabled } });
	revalidatePath("/commerce");
}

export async function retryEvent(id) {
	await requireSession();
	await connectDb();
	if (!isValidObjectId(id)) throw new Error("Invalid event");
	await AutomationEvent.updateOne(
		{ _id: id, status: "failed" },
		{
			$set: { status: "pending", attempts: 0, nextAt: new Date() },
			$unset: { error: 1 },
		},
	);
	revalidatePath("/commerce");
}

export async function configureAutomationSchedule() {
	await requireSession();
	const url = new URL(getAppUrl());
	if (url.protocol !== "https:")
		throw new Error("Set APP_URL to the public HTTPS address first");
	await getQStash().schedules.create({
		destination: `${url.origin}/api/jobs/automations`,
		cron: "* * * * *",
		scheduleId: `mailman-automations-${url.hostname.replaceAll(".", "-")}`,
	});
	revalidatePath("/commerce");
}
