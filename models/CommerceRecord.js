import mongoose from "mongoose";
const schema = new mongoose.Schema(
	{
		storeId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "CommerceStore",
			required: true,
		},
		newsletterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Newsletter",
			required: true,
		},
		kind: { type: String, enum: ["order", "cart"], required: true },
		externalId: { type: String, required: true },
		email: { type: String, required: true },
		version: { type: Date, required: true },
		paidAt: Date,
		placedAt: Date,
		status: String,
		currency: String,
		total: Number,
		items: [
			{
				_id: false,
				productId: String,
				name: String,
				quantity: Number,
				variationId: String,
			},
		],
		checkoutUrl: String,
		expiresAt: Date,
		abandonedAt: Date,
		enrolledVersion: Date,
		historical: Boolean,
	},
	{ timestamps: true },
);
schema.index({ storeId: 1, kind: 1, externalId: 1 }, { unique: true });
schema.index({ newsletterId: 1, email: 1, kind: 1, paidAt: 1 });
schema.index({ kind: 1, status: 1, abandonedAt: 1 });
export default mongoose.models.CommerceRecord ||
	mongoose.model("CommerceRecord", schema);
