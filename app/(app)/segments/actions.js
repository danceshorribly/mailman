"use server";
import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import { normalizeRules, rulesToQuery } from "@/lib/segments";
import Segment from "@/models/Segment";
import Newsletter from "@/models/Newsletter";
import Contact from "@/models/Contact";
import Suppression from "@/models/Suppression";

export async function saveSegment(input) {
	await requireSession();
	await connectDb();
	try {
		if (
			!isValidObjectId(input.newsletterId) ||
			!(await Newsletter.exists({ _id: input.newsletterId }))
		)
			throw new Error("Choose a newsletter");
		if (
			typeof input.name !== "string" ||
			!input.name.trim() ||
			input.name.length > 100
		)
			throw new Error("Add a name (up to 100 characters)");
		const rules = normalizeRules(input.rules);
		if (input.id) {
			if (!isValidObjectId(input.id)) throw new Error("Invalid segment");
			const result = await Segment.updateOne(
				{ _id: input.id, newsletterId: input.newsletterId },
				{ $set: { name: input.name.trim(), rules } },
			);
			if (!result.matchedCount) throw new Error("Segment not found");
		} else
			await Segment.create({
				newsletterId: input.newsletterId,
				name: input.name.trim(),
				rules,
			});
		revalidatePath("/segments");
		revalidatePath("/campaigns");
		return { ok: true };
	} catch (error) {
		return {
			error: error.code === 11000 ? "This name is already used" : error.message,
		};
	}
}

export async function previewSegment(input) {
	await requireSession();
	await connectDb();
	try {
		if (!isValidObjectId(input.newsletterId))
			throw new Error("Choose a newsletter");
		const suppressed = await Suppression.distinct("email");
		const filter = {
			$and: [
				{
					newsletterId: input.newsletterId,
					status: "active",
					email: { $nin: suppressed },
				},
				rulesToQuery(input.rules),
			],
		};
		const [count, samples] = await Promise.all([
			Contact.countDocuments(filter),
			Contact.find(filter)
				.select("email firstName language country")
				.limit(10)
				.lean(),
		]);
		return { count, emails: samples.map((contact) => contact.email) };
	} catch (error) {
		return { error: error.message };
	}
}
