import mongoose from "mongoose";
const schema = new mongoose.Schema(
	{
		newsletterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Newsletter",
			required: true,
		},
		name: { type: String, required: true, maxlength: 100 },
		status: {
			type: String,
			enum: ["draft", "active", "paused"],
			default: "draft",
		},
		trigger: {
			type: String,
			enum: ["subscribed", "order.paid", "cart.abandoned"],
			required: true,
		},
		definition: { type: mongoose.Schema.Types.Mixed, required: true },
		revision: { type: Number, default: 1 },
		activatedAt: Date,
		pauseReason: String,
	},
	{ timestamps: true },
);
schema.index({ newsletterId: 1, status: 1, trigger: 1 });
export default mongoose.models.Automation ||
	mongoose.model("Automation", schema);
