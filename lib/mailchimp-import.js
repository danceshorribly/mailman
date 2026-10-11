import { normalizeProfile } from "./customer-profile.js";
import { normalizeEmail } from "./validation.js";

export function mailchimpMemberRow(member) {
	const email = normalizeEmail(member?.email_address);
	if (!email) return null;
	const statuses = {
		subscribed: "active",
		unsubscribed: "unsubscribed",
		cleaned: "bounced",
		pending: "dormant",
		transactional: "dormant",
		archived: "dormant",
	};
	const fields = member.merge_fields || {};
	const time = Date.parse(member.timestamp_opt || member.timestamp_signup);
	return {
		email,
		status: Object.hasOwn(statuses, member.status)
			? statuses[member.status]
			: "dormant",
		subscribedAt: Number.isFinite(time) ? new Date(time) : undefined,
		...normalizeProfile({
			firstName: fields.FNAME,
			lastName: fields.LNAME,
			fullName: fields.FULLNAME,
			language: fields.LANGUAGE || member.language,
			country: fields.COUNTRY || member.location?.country_code,
			tags: member.tags?.map((tag) => tag.name),
		}),
		openRate: member.stats?.avg_open_rate,
		clickRate: member.stats?.avg_click_rate,
	};
}
