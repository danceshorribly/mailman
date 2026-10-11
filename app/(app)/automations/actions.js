"use server";
import { isValidObjectId } from "mongoose";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/auth";
import { connectDb } from "@/lib/db";
import {
	AUTOMATION_TRIGGERS,
	normalizeDefinition,
	starterDefinition,
} from "@/lib/automation-rules";
import { getSendProblem } from "@/lib/sending-rules";
import Automation from "@/models/Automation";
import Newsletter from "@/models/Newsletter";

export async function createAutomation(formData) {
	await requireSession();
	await connectDb();
	const newsletterId = formData.get("newsletterId");
	const trigger = formData.get("trigger");
	if (
		!isValidObjectId(newsletterId) ||
		!AUTOMATION_TRIGGERS.includes(trigger) ||
		!(await Newsletter.exists({ _id: newsletterId }))
	)
		throw new Error("Choose a newsletter and trigger");
	const flow = await Automation.create({
		newsletterId,
		name:
			trigger === "cart.abandoned"
				? "Abandoned cart"
				: trigger === "order.paid"
					? "After purchase"
					: "Welcome journey",
		trigger,
		definition: starterDefinition(trigger),
	});
	revalidatePath("/automations");
	redirect(`/automations/${flow._id}`);
}

export async function saveAutomation(id, input) {
	await requireSession();
	await connectDb();
	try {
		if (!isValidObjectId(id)) throw new Error("Flow not found");
		if (
			typeof input.name !== "string" ||
			!input.name.trim() ||
			input.name.length > 100
		)
			throw new Error("Add a name (up to 100 characters)");
		const definition = normalizeDefinition(input.definition);
		const result = await Automation.updateOne(
			{
				_id: id,
				revision: input.revision,
				status: { $in: ["draft", "paused"] },
			},
			{ $set: { name: input.name.trim(), definition }, $inc: { revision: 1 } },
		);
		if (!result.matchedCount)
			throw new Error(
				"Flow changed or is active. Pause and reload before editing.",
			);
		revalidatePath(`/automations/${id}`);
		revalidatePath("/automations");
		return { ok: true, revision: input.revision + 1 };
	} catch (error) {
		return { error: error.message };
	}
}

export async function setAutomationStatus(id, status, revision) {
	await requireSession();
	await connectDb();
	try {
		if (!isValidObjectId(id) || !["active", "paused"].includes(status))
			throw new Error("Invalid request");
		const flow = await Automation.findById(id).lean();
		if (!flow || flow.revision !== revision)
			throw new Error("Flow changed. Reload before continuing.");
		if (status === "active") {
			const definition = normalizeDefinition(flow.definition);
			const newsletter = await Newsletter.findById(flow.newsletterId).lean();
			if (!newsletter?.postalAddress?.trim())
				throw new Error("Add the sender's postal address to the newsletter");
			for (const node of definition.nodes.filter(
				(node) => node.type === "email",
			)) {
				const problem = getSendProblem({
					campaign: { ...node, format: node.format || "markdown" },
					newsletter,
				});
				if (problem) throw new Error(`${node.label}: ${problem}`);
				if (
					flow.trigger !== "cart.abandoned" &&
					(node.markdown || node.html || "").includes("{{checkoutUrl}}")
				)
					throw new Error("Recovery links are only available in cart flows");
			}
		}
		const result = await Automation.updateOne(
			{ _id: id, revision, status: flow.status },
			{
				$set: {
					status,
					...(!flow.activatedAt &&
						status === "active" && { activatedAt: new Date() }),
				},
			},
		);
		if (!result.matchedCount)
			throw new Error("Flow changed. Reload before continuing.");
		revalidatePath(`/automations/${id}`);
		revalidatePath("/automations");
		return { ok: true };
	} catch (error) {
		return { error: error.message };
	}
}
