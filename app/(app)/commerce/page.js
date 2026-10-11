import Link from "next/link";
import HeaderPage from "@/components/HeaderPage";
import StoreForm from "@/components/StoreForm";
import { Button } from "@/components/ui/button";
import { connectDb } from "@/lib/db";
import { serialize } from "@/lib/serialize";
import { getAppUrl } from "@/lib/config";
import {
	configureAutomationSchedule,
	toggleStore,
	retryEvent,
} from "./actions";
import CommerceStore from "@/models/CommerceStore";
import CommerceRecord from "@/models/CommerceRecord";
import AutomationEvent from "@/models/AutomationEvent";
import Newsletter from "@/models/Newsletter";
import ApiKey from "@/models/ApiKey";
export const metadata = { title: "Commerce" };
export default async function CommercePage() {
	await connectDb();
	const [stores, newsletters, keys, failed, pending, carts] = await Promise.all(
		[
			CommerceStore.find().lean(),
			Newsletter.find().select("name").lean(),
			ApiKey.find({ revokedAt: null }).select("name prefix").lean(),
			AutomationEvent.find({ status: "failed" })
				.sort({ updatedAt: -1 })
				.limit(20)
				.lean(),
			AutomationEvent.countDocuments({ status: "pending" }),
			CommerceRecord.find({ kind: "cart", status: "open" })
				.sort({ version: -1 })
				.limit(20)
				.lean(),
		],
	);
	return (
		<>
			<HeaderPage title="Commerce & integrations" />
			<p className="mb-6 text-sm text-muted-foreground">
				{pending} events waiting. New customers from commerce remain dormant
				until they subscribe. Historical imports never start journeys.
			</p>
			<StoreForm newsletters={serialize(newsletters)} keys={serialize(keys)} />
			<div className="my-6 space-y-4">
				{stores.map((store) => (
					<div
						key={String(store._id)}
						className="rounded-xl bg-card p-5 shadow-border"
					>
						<h2 className="font-semibold">
							{store.name} · {store.enabled ? "Enabled" : "Disabled"}
						</h2>
						<p className="mt-2 break-all text-sm">
							{getAppUrl()}/api/v1/commerce/{String(store._id)}
						</p>
						<p className="mt-2 text-sm text-muted-foreground">
							{store.origin} · Last receipt:{" "}
							{store.lastEventAt
								? new Date(store.lastEventAt).toISOString()
								: "None"}
						</p>
						<form
							action={toggleStore.bind(null, String(store._id), !store.enabled)}
							className="mt-3"
						>
							<Button variant="outline">
								{store.enabled ? "Disable integration" : "Enable integration"}
							</Button>
						</form>
					</div>
				))}
			</div>
			<div className="rounded-xl bg-muted p-5">
				<h2 className="font-semibold">Background worker</h2>
				<p className="my-3 text-sm">
					Configure the public app address and QStash signing keys, then
					register the minute schedule. The automation and sending switches are
					separate.{" "}
					<Link href="/api-keys" className="underline">
						Manage API keys
					</Link>
					.
				</p>
				<form action={configureAutomationSchedule}>
					<Button variant="outline" disabled={!process.env.QSTASH_TOKEN}>
						Register / update worker schedule
					</Button>
				</form>
			</div>
			<h2 className="mt-8 mb-4 text-xl font-semibold">Open carts</h2>
			<div className="space-y-2">
				{carts.map((cart) => (
					<p
						key={String(cart._id)}
						className="break-all rounded-lg bg-card p-3 text-sm shadow-border"
					>
						{cart.email} · {cart.total} {cart.currency} · Updated{" "}
						{new Date(cart.version).toISOString()}
					</p>
				))}
				{!carts.length && (
					<p className="text-sm text-muted-foreground">
						No carts received yet.
					</p>
				)}
			</div>
			<h2 className="mt-8 mb-4 text-xl font-semibold">Failed events</h2>
			<div className="space-y-3">
				{failed.map((event) => (
					<div
						key={String(event._id)}
						className="rounded-xl bg-card p-4 shadow-border"
					>
						<p className="text-sm">
							{event.type} · {event.error}
						</p>
						<form
							action={retryEvent.bind(null, String(event._id))}
							className="mt-2"
						>
							<Button size="sm" variant="outline">
								Retry event
							</Button>
						</form>
					</div>
				))}
				{!failed.length && (
					<p className="text-sm text-muted-foreground">No failed events.</p>
				)}
			</div>
		</>
	);
}
