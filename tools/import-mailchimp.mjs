// Read-only against Mailchimp. Defaults to a count-only dry run. No emails or journey events.
import mongoose from "mongoose";
import Newsletter from "../models/Newsletter.js";
import Contact from "../models/Contact.js";
import Suppression from "../models/Suppression.js";
import { importContactRows } from "../lib/contact-import.js";
import { mailchimpMemberRow } from "../lib/mailchimp-import.js";

const args = process.argv.slice(2);
const value = (name) =>
	args.find((arg) => arg.startsWith(`${name}=`))?.slice(name.length + 1);
const listId = value("--list");
const newsletterId = value("--newsletter");
const apply = args.includes("--apply");
const key = process.env.MAILCHIMP_API_KEY || "";
const dc = /-(us\d+)$/.exec(key)?.[1];
const offsetStart = Number(value("--offset") || 0);
if (
	!dc ||
	!/^[a-f0-9]{10}$/i.test(listId || "") ||
	!Number.isInteger(offsetStart) ||
	offsetStart < 0
)
	throw new Error(
		"Provide MAILCHIMP_API_KEY and --list=LIST_ID. Optional --offset=N resumes a page.",
	);
if (
	apply &&
	(!mongoose.isValidObjectId(newsletterId) || !process.env.MONGODB_URI)
)
	throw new Error("--apply requires MONGODB_URI and --newsletter=OBJECT_ID");
if (
	apply &&
	(process.env.SENDING_ENABLED === "true" ||
		process.env.AUTOMATIONS_ENABLED === "true")
)
	throw new Error("Disable both sending and automations before migration");
const cutoff = value("--before") || new Date().toISOString();
if (!Number.isFinite(Date.parse(cutoff)))
	throw new Error("Invalid --before cutoff");
if (apply) {
	await mongoose.connect(process.env.MONGODB_URI);
	await Promise.all([Contact.init(), Suppression.init()]);
	if (!(await Newsletter.exists({ _id: newsletterId })))
		throw new Error("Target newsletter not found");
}
const counts = { read: 0, created: 0, existing: 0, invalid: 0, statuses: {} };
try {
	for (let offset = offsetStart; ; offset += 1000) {
		const url = new URL(
			`https://${dc}.api.mailchimp.com/3.0/lists/${listId}/members`,
		);
		url.search = new URLSearchParams({
			count: "1000",
			offset: String(offset),
			sort_field: "timestamp_signup",
			sort_dir: "ASC",
			before_last_changed: cutoff,
			fields:
				"total_items,members.id,members.email_address,members.status,members.merge_fields,members.language,members.location.country_code,members.tags,members.stats.avg_open_rate,members.stats.avg_click_rate,members.timestamp_opt,members.timestamp_signup,members.last_changed",
		}).toString();
		if (value("--since"))
			url.searchParams.set("since_last_changed", value("--since"));
		let response;
		for (let attempt = 0; attempt < 5; attempt++) {
			response = await fetch(url, {
				headers: { Authorization: `Bearer ${key}` },
				redirect: "error",
				signal: AbortSignal.timeout(30000),
			});
			if (response.status !== 429 && response.status < 500) break;
			await new Promise((resolve) => setTimeout(resolve, 1000 * 2 ** attempt));
		}
		if (!response.ok)
			throw new Error(
				`Mailchimp returned HTTP ${response.status}. Resume at --offset=${offset} --before=${cutoff}`,
			);
		const body = await response.json();
		if (!Array.isArray(body.members) || !Number.isInteger(body.total_items))
			throw new Error("Unexpected Mailchimp response");
		const rows = body.members.map(mailchimpMemberRow).filter(Boolean);
		for (const row of rows)
			counts.statuses[row.status] = (counts.statuses[row.status] || 0) + 1;
		counts.read += body.members.length;
		if (apply) {
			const result = await importContactRows({
				newsletterId,
				rows,
				source: `mailchimp:${listId}`,
			});
			counts.created += result.created;
			counts.existing += result.existing;
			counts.invalid += result.invalid;
			const importedAt = new Date();
			await Contact.bulkWrite(
				body.members
					.filter((member) => mailchimpMemberRow(member))
					.map((member) => ({
						updateOne: {
							filter: { newsletterId, email: mailchimpMemberRow(member).email },
							update: {
								$set: {
									migration: {
										provider: "mailchimp",
										sourceListId: listId,
										sourceContactId: member.id,
										importedAt,
										lastChangedAt: member.last_changed,
										optInAt: member.timestamp_opt || undefined,
									},
								},
							},
						},
					})),
				{ ordered: false },
			);
		}
		// Only aggregate counts enter the terminal. No addresses, merge fields or keys.
		console.log(
			JSON.stringify({
				mode: apply ? "apply" : "dry-run",
				offset,
				cutoff,
				...counts,
			}),
		);
		if (
			offset + body.members.length >= body.total_items ||
			!body.members.length
		)
			break;
	}
} finally {
	if (apply) await mongoose.disconnect();
}
