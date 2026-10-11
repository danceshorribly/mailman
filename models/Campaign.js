import mongoose from "mongoose";

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "sending", "paused", "sent", "canceled"];

const counter = { type: Number, default: 0 };

const campaignSchema = new mongoose.Schema(
	{
		newsletterId: { type: mongoose.Schema.Types.ObjectId, ref: "Newsletter", required: true },
		subject: { type: String, trim: true, default: "" },
		previewText: { type: String, trim: true, default: "" },
		// rich: written in the editor, stored as an HTML fragment in html. html: a designed document sent
		// as is. markdown: older drafts and API campaigns.
		format: { type: String, enum: ["markdown", "html", "rich"], default: "rich" },
		markdown: { type: String, default: "" },
		html: { type: String, default: "" },
		status: { type: String, enum: CAMPAIGN_STATUSES, default: "draft" },
		// Warm-up: send to the most engaged contacts first, capped at audienceLimit.
		segmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Segment" },
		audienceLimit: { type: Number, min: 1 },
		source: { type: String, default: "dashboard" },
		scheduledAt: { type: Date },
		startedAt: { type: Date },
		sentAt: { type: Date },
		testSentAt: { type: Date },
		archiveSlug: { type: String, trim: true, lowercase: true },
		thumbnailUrl: { type: String, trim: true },
		// Unlisted issues keep their /p/slug page but stay off the archive index.
		archiveListed: { type: Boolean, default: true },
		// Pinned issues sit in the Featured row at the top of the archive.
		archivePinned: { type: Boolean, default: false },
		// Archive page views, once per browser and day.
		webViews: { type: Number, default: 0 },
		stats: {
			recipients: counter,
			sent: counter,
			delivered: counter,
			bounced: counter,
			complained: counter,
			opened: counter,
			clicked: counter,
			unsubscribed: counter,
			failed: counter,
		},
		// The list cleanup at this send: last-chance emails sent instead of the issue, and contacts made dormant.
		lastChance: {
			recipients: counter,
			sent: counter,
			delivered: counter,
			bounced: counter,
			complained: counter,
			failed: counter,
			dormant: counter,
		},
	},
	{ timestamps: true }
);

campaignSchema.index({ newsletterId: 1, createdAt: -1 });
campaignSchema.index({ status: 1 });
campaignSchema.index({ startedAt: -1 });
campaignSchema.index(
	{ archiveSlug: 1 },
	{ unique: true, partialFilterExpression: { archiveSlug: { $type: "string" } } }
);

export default mongoose.models.Campaign || mongoose.model("Campaign", campaignSchema);
