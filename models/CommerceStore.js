import mongoose from "mongoose";
const schema = new mongoose.Schema(
	{
		name: { type: String, required: true, maxlength: 100 },
		newsletterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Newsletter",
			required: true,
		},
		apiKeyId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "ApiKey",
			required: true,
		},
		origin: { type: String, required: true },
		enabled: { type: Boolean, default: true },
		lastEventAt: Date,
	},
	{ timestamps: true },
);
export default mongoose.models.CommerceStore ||
	mongoose.model("CommerceStore", schema);
