import mongoose from "mongoose";
const schema = new mongoose.Schema({
	_id: String,
	token: String,
	expiresAt: Date,
});
export default mongoose.models.WorkerLease ||
	mongoose.model("WorkerLease", schema);
