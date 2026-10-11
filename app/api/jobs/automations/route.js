import { connectDb } from "@/lib/db";
import { tickAutomations } from "@/lib/automation-engine";
import { withQStashSignature } from "@/lib/qstash-route";
import { sendMessageBatch } from "@/lib/sending";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const POST = withQStashSignature(async () => {
	await connectDb();
	return Response.json(await tickAutomations({ sendBatch: sendMessageBatch }));
});
