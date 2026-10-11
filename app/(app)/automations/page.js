import Link from "next/link";
import HeaderPage from "@/components/HeaderPage";
import { Button } from "@/components/ui/button";
import { connectDb } from "@/lib/db";
import { createAutomation } from "./actions";
import Automation from "@/models/Automation";
import Newsletter from "@/models/Newsletter";
export const metadata = { title: "Automations" };
export default async function AutomationsPage() {
	await connectDb();
	const [flows, newsletters] = await Promise.all([
		Automation.find().sort({ createdAt: -1 }).lean(),
		Newsletter.find().select("name").lean(),
	]);
	return (
		<>
			<HeaderPage title="Automations" />
			<p className="mb-6 text-sm text-muted-foreground">
				Build welcome, purchase and abandoned cart journeys with wait steps,
				customer conditions and tags.
			</p>
			<form
				action={createAutomation}
				className="mb-8 flex flex-wrap items-center gap-3 rounded-xl bg-card p-5 shadow-border"
			>
				<select
					required
					name="newsletterId"
					aria-label="Newsletter"
					className="h-9 max-w-full rounded-lg border bg-background px-3 text-sm"
				>
					{newsletters.map((n) => (
						<option key={String(n._id)} value={String(n._id)}>
							{n.name}
						</option>
					))}
				</select>
				<select
					name="trigger"
					aria-label="Journey trigger"
					className="h-9 max-w-full rounded-lg border bg-background px-3 text-sm"
				>
					<option value="cart.abandoned">Abandoned cart</option>
					<option value="order.paid">Paid purchase</option>
					<option value="subscribed">New subscriber</option>
				</select>
				<Button disabled={!newsletters.length}>Create draft flow</Button>
			</form>
			<div className="grid gap-4 sm:grid-cols-2">
				{flows.map((flow) => (
					<Link
						key={String(flow._id)}
						href={`/automations/${flow._id}`}
						className="rounded-xl bg-card p-5 shadow-border hover:bg-muted"
					>
						<h2 className="font-semibold">{flow.name}</h2>
						<p className="mt-2 text-sm text-muted-foreground">
							{flow.status} ·{" "}
							{flow.trigger === "cart.abandoned"
								? "Abandoned cart"
								: flow.trigger === "order.paid"
									? "Paid order"
									: "New subscriber"}{" "}
							· {flow.definition.nodes.length} steps
						</p>
					</Link>
				))}
			</div>
		</>
	);
}
