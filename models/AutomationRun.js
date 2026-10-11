import mongoose from "mongoose";
const schema = new mongoose.Schema(
	{
		automationId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Automation",
			required: true,
		},
		newsletterId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Newsletter",
			required: true,
		},
		contactId: {
			type: mongoose.Schema.Types.ObjectId,
			ref: "Contact",
			required: true,
		},
		eventKey: { type: String, required: true },
		trigger: String,
		definition: { type: mongoose.Schema.Types.Mixed, required: true },
		revision: Number,
		context: mongoose.Schema.Types.Mixed,
		nodeId: { type: String, required: true },
		status: {
			type: String,
			enum: ["running", "completed", "stopped", "failed"],
			default: "running",
		},
		nextAt: { type: Date, default: Date.now },
		steps: { type: Number, default: 0 },
		history: [{ _id: false, nodeId: String, outcome: String, at: Date }],
		error: String,
	},
	{ timestamps: true },
);
schema.index({ automationId: 1, contactId: 1, eventKey: 1 }, { unique: true });
schema.index({ status: 1, nextAt: 1 });
schema.index({ automationId: 1, createdAt: -1 });
export default mongoose.models.AutomationRun ||
	mongoose.model("AutomationRun", schema);
