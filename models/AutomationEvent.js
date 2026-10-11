import mongoose from "mongoose";
const schema = new mongoose.Schema(
	{
		key: { type: String, unique: true, required: true },
		storeId: { type: mongoose.Schema.Types.ObjectId, ref: "CommerceStore" },
		newsletterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Newsletter",
			required: true,
		},
		type: { type: String, required: true },
		payload: { type: mongoose.Schema.Types.Mixed, required: true },
		payloadHash: String,
		status: {
			type: String,
			enum: ["pending", "processed", "failed"],
			default: "pending",
		},
		attempts: { type: Number, default: 0 },
		nextAt: { type: Date, default: Date.now },
		error: String,
	},
	{ timestamps: true },
);
schema.index({ status: 1, nextAt: 1, createdAt: 1 });
schema.index(
	{ storeId: 1, type: 1, "payload.email": 1, "payload.placedAt": 1 },
	{ partialFilterExpression: { type: "order.updated" } },
);
schema.index(
	{ storeId: 1, type: 1, "payload.externalId": 1, "payload.version": 1 },
	{ partialFilterExpression: { type: "cart.updated" } },
);
// Commerce event payloads are retained for 90 days; records and runs retain their deduplication keys.
schema.index(
	{ updatedAt: 1 },
	{
		expireAfterSeconds: 90 * 86400,
		partialFilterExpression: { status: "processed" },
	},
);
export default mongoose.models.AutomationEvent ||
	mongoose.model("AutomationEvent", schema);
