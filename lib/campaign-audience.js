import Segment from "../models/Segment.js";
import Suppression from "../models/Suppression.js";
import { buildAudienceQuery } from "./audience.js";
import { rulesToQuery } from "./segments.js";

export async function campaignAudienceQuery(campaign, audienceLimit) {
	const suppressedEmails = await Suppression.distinct("email");
	const query = buildAudienceQuery({
		newsletterId: campaign.newsletterId,
		audienceLimit,
		suppressedEmails,
	});
	if (campaign.segmentId) {
		const segment = await Segment.findOne({
			_id: campaign.segmentId,
			newsletterId: campaign.newsletterId,
		}).lean();
		if (!segment) throw new Error("Selected segment no longer exists");
		query.filter = { $and: [query.filter, rulesToQuery(segment.rules)] };
	}
	return query;
}
