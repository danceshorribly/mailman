import mongoose from "mongoose";
const schema = new mongoose.Schema(
	{
		newsletterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Newsletter",
			required: true,
		},
		name: { type: String, required: true, trim: true, maxlength: 100 },
		rules: { type: mongoose.Schema.Types.Mixed, required: true },
	},
	{ timestamps: true },
);
schema.index({ newsletterId: 1, name: 1 }, { unique: true });
export default mongoose.models.Segment || mongoose.model("Segment", schema);
