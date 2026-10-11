// Disposable, synthetic data only. Both sending switches are forcibly off.
import { spawn } from "node:child_process";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Newsletter from "../models/Newsletter.js";
import Contact from "../models/Contact.js";
import Segment from "../models/Segment.js";
import Automation from "../models/Automation.js";
import CommerceStore from "../models/CommerceStore.js";
import CommerceRecord from "../models/CommerceRecord.js";
import ApiKey from "../models/ApiKey.js";
import { generateApiKey } from "../lib/api-key-tokens.js";

const mongo = await MongoMemoryServer.create();
await mongoose.connect(mongo.getUri());
const newsletter = await Newsletter.create({
	name: "Kamado Sumo (demo)",
	slug: "kamado-demo",
	fromEmail: "news@example.com",
	fromName: "Kamado Sumo",
	postalAddress: "Demonstration address, Sweden",
});
const key = await ApiKey.create({
	name: "Demo WooCommerce",
	prefix: "demo",
	hash: generateApiKey().hash,
});
const store = await CommerceStore.create({
	name: "Kamado demo shop",
	newsletterId: newsletter._id,
	apiKeyId: key._id,
	origin: "https://www.kamadosumo.com",
});
await Contact.insertMany([
	{
		newsletterId: newsletter._id,
		email: "alex@example.com",
		firstName: "Alex",
		lastName: "Sumo",
		language: "sv",
		country: "SE",
		tags: ["hibachi", "engaged"],
		commerce: {
			orderCount: 2,
			spendByCurrency: { SEK: 4990 },
			productIds: ["314"],
		},
	},
	{
		newsletterId: newsletter._id,
		email: "sam@example.com",
		firstName: "Sam",
		language: "en",
		country: "DE",
		commerce: { orderCount: 1, spendByCurrency: { EUR: 229 } },
	},
	{
		newsletterId: newsletter._id,
		email: "opted-out@example.com",
		status: "unsubscribed",
		language: "sv",
		country: "SE",
	},
]);
await Segment.create({
	newsletterId: newsletter._id,
	name: "Swedish customers",
	rules: {
		mode: "all",
		rules: [
			{ field: "language", op: "eq", value: "sv" },
			{ field: "commerce.orderCount", op: "gte", value: 1 },
		],
	},
});
await Automation.create({
	newsletterId: newsletter._id,
	name: "Recover abandoned carts",
	trigger: "cart.abandoned",
	definition: {
		start: "language",
		nodes: [
			{
				id: "language",
				type: "condition",
				label: "Swedish customer?",
				rules: {
					mode: "all",
					rules: [{ field: "language", op: "eq", value: "sv" }],
				},
				yes: "swedish",
				no: "english",
			},
			{
				id: "swedish",
				type: "email",
				label: "Reminder in Swedish",
				subject: "Du har något kvar i varukorgen",
				previewText: "Fortsätt där du slutade",
				markdown:
					"Hej {{firstName}},\n\nDin varukorg finns kvar när du är redo.\n\n[Återgå till varukorgen]({{checkoutUrl}})\n\nHälsningar,\nKamado Sumo",
				next: "wait",
			},
			{
				id: "english",
				type: "email",
				label: "Reminder in English",
				subject: "Your cart is waiting",
				previewText: "Continue your grill journey",
				markdown: "Hi {{firstName}},\n\n[Return to your cart]({{checkoutUrl}})",
				next: "wait",
			},
			{
				id: "wait",
				type: "wait",
				label: "Wait one day",
				minutes: 1440,
				next: "tag",
			},
			{
				id: "tag",
				type: "tag",
				label: "Mark completed journey",
				tag: "cart-reminder-complete",
				next: "end",
			},
			{ id: "end", type: "end", label: "Finish" },
		],
	},
});
await CommerceRecord.create({
	storeId: store._id,
	newsletterId: newsletter._id,
	kind: "cart",
	externalId: "demo-cart",
	email: "alex@example.com",
	version: new Date(),
	status: "open",
	currency: "SEK",
	total: 2495,
	items: [{ productId: "314", name: "Hibachi", quantity: 1 }],
});
const env = {
	...process.env,
	MONGODB_URI: mongo.getUri(),
	ADMIN_EMAIL: "demo@example.com",
	ADMIN_PASSWORD: "local-demo-password-only",
	SESSION_SECRET: "local-demo-secret-with-at-least-32-characters",
	SENDING_ENABLED: "false",
	AUTOMATIONS_ENABLED: "false",
	ALERT_FROM: "",
	APP_URL: "http://localhost:3417",
	QSTASH_TOKEN: "",
	SES_ACCESS_KEY_ID: "",
	SES_SECRET_ACCESS_KEY: "",
};
const app = spawn(
	process.execPath,
	[
		"node_modules/next/dist/bin/next",
		"dev",
		"--hostname",
		"127.0.0.1",
		"--port",
		"3417",
	],
	{ env, stdio: "inherit" },
);
console.log(
	"Disposable preview: http://localhost:3417. Login demo@example.com / local-demo-password-only. Sending is off.",
);
async function stop() {
	app.kill("SIGTERM");
	await mongoose.disconnect();
	await mongo.stop();
}
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
app.on("exit", async () => {
	await mongoose.disconnect();
	await mongo.stop();
	process.exit(0);
});
