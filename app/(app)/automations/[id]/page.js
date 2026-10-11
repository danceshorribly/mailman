import { isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import Link from "next/link";
import AutomationEditor from "@/components/AutomationEditor";
import { connectDb } from "@/lib/db";
import { serialize } from "@/lib/serialize";
import { automationsEnabled } from "@/lib/automation-engine";
import { isSendingEnabled } from "@/lib/config";
import Automation from "@/models/Automation";
import AutomationRun from "@/models/AutomationRun";
import Newsletter from "@/models/Newsletter";
import Contact from "@/models/Contact";
export const metadata = { title: "Automation" };
export default async function AutomationPage({ params }) {
	const { id } = await params;
	if (!isValidObjectId(id)) notFound();
	await connectDb();
	const flow = await Automation.findById(id).lean();
	if (!flow) notFound();
	const [newsletter, runs, totals] = await Promise.all([
		Newsletter.findById(flow.newsletterId).lean(),
		AutomationRun.find({ automationId: id })
			.sort({ createdAt: -1 })
			.limit(30)
			.lean(),
		AutomationRun.aggregate([
			{ $match: { automationId: flow._id } },
			{ $group: { _id: "$status", count: { $sum: 1 } } },
		]),
	]);
	if (!newsletter) notFound();
	const contacts = await Contact.find({
		_id: { $in: runs.map((run) => run.contactId) },
	})
		.select("email")
		.lean();
	return (
		<>
			<AutomationEditor
				key={`${flow._id}:${flow.status}`}
				flow={serialize(flow)}
				newsletter={serialize(newsletter)}
				enabled={automationsEnabled()}
				sending={isSendingEnabled()}
			/>
			<section className="mt-10 space-y-4">
				<h2 className="text-xl font-semibold">Journey activity</h2>
				<p className="text-sm text-muted-foreground">
					{totals.map((row) => `${row.count} ${row._id}`).join(" · ") ||
						"No contacts have entered this flow yet."}
				</p>
				{runs.map((run) => (
					<details
						key={String(run._id)}
						className="rounded-xl bg-card p-4 shadow-border"
					>
						<summary className="cursor-pointer text-sm">
							<Link
								href={`/contacts/${run.contactId}`}
								className="break-all underline"
							>
								{contacts.find((c) => String(c._id) === String(run.contactId))
									?.email || "Deleted contact"}
							</Link>{" "}
							· {run.status} ·{" "}
							{run.nodeId === "end"
								? "Finished"
								: run.definition.nodes.find((node) => node.id === run.nodeId)
										?.label}
						</summary>
						<p className="mt-3 text-sm">
							{run.error || `Next check: ${new Date(run.nextAt).toISOString()}`}
						</p>
						<ul className="mt-3 space-y-2 text-xs text-muted-foreground">
							{run.history.map((step, index) => (
								<li key={index}>
									{new Date(step.at).toISOString()} ·{" "}
									{
										run.definition.nodes.find((n) => n.id === step.nodeId)
											?.label
									}{" "}
									· {step.outcome}
								</li>
							))}
						</ul>
					</details>
				))}
			</section>
		</>
	);
}
