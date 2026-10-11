import CardStat from "@/components/CardStat";
import {
	Table,
	TableHeader,
	TableBody,
	TableRow,
	TableHead,
	TableCell,
} from "@/components/ui/table";

function money(value, currency) {
	return new Intl.NumberFormat("en", { style: "currency", currency }).format(
		value,
	);
}
function amounts(revenue) {
	const entries = Object.entries(revenue).sort(([a], [b]) =>
		a.localeCompare(b),
	);
	return entries.length
		? entries.map(([currency, value]) => (
				<span key={currency} className="block whitespace-nowrap">
					{money(value, currency)}
				</span>
			))
		: "0";
}
function rate(orders, sent) {
	return sent ? `${((orders / sent) * 100).toFixed(1)}%` : "0.0%";
}
export default function RecoveryReport({ report }) {
	return (
		<section className="mt-10 space-y-4" aria-labelledby="recovery-heading">
			<div>
				<h2 id="recovery-heading" className="text-xl font-semibold">
					Recovered purchases
				</h2>
				<p className="mt-2 max-w-3xl text-sm text-muted-foreground">
					All time. A paid order is attributed when a customer returns through a
					recovery email and places an order within seven days. Each restored
					cart version counts once.
				</p>
			</div>
			<div className="grid gap-4 sm:grid-cols-3">
				<CardStat
					label="Recovered paid orders"
					value={report.orders}
					tone="good"
				/>
				<CardStat
					label="Recovered order value"
					value={amounts(report.revenue)}
					detail="After refunds, including tax and shipping"
				/>
				<CardStat
					label="Orders per sent email"
					value={rate(report.orders, report.sent)}
					detail={`${report.sent} recovery emails sent`}
				/>
			</div>
			<div className="rounded-xl bg-card p-4 shadow-border">
				<h3 className="mb-3 font-medium">Results by email step</h3>
				{report.nodes.length ? (
					<Table>
						<TableHeader>
							<TableRow>
								<TableHead>Email step</TableHead>
								<TableHead className="text-right">Sent</TableHead>
								<TableHead className="text-right">Paid orders</TableHead>
								<TableHead className="text-right">Orders / sent</TableHead>
								<TableHead className="text-right">Order value</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{report.nodes.map((node) => (
								<TableRow key={node.id}>
									<TableCell className="min-w-40 max-w-80 whitespace-normal break-words">
										{node.label}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{node.sent}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{node.orders}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{rate(node.orders, node.sent)}
									</TableCell>
									<TableCell className="text-right tabular-nums">
										{amounts(node.revenue)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				) : (
					<p className="text-sm text-muted-foreground">
						Results appear after recovery emails have been sent. Historical
						purchases are excluded.
					</p>
				)}
			</div>
			{report.recent.length > 0 && (
				<details className="rounded-xl bg-card p-4 shadow-border">
					<summary className="cursor-pointer font-medium">
						Latest attributed orders
					</summary>
					<Table className="mt-3">
						<TableHeader>
							<TableRow>
								<TableHead>Order / customer</TableHead>
								<TableHead>Placed (UTC)</TableHead>
								<TableHead>Email step</TableHead>
								<TableHead>Status</TableHead>
								<TableHead className="text-right">Order value</TableHead>
							</TableRow>
						</TableHeader>
						<TableBody>
							{report.recent.map((order) => (
								<TableRow key={order.id}>
									<TableCell>
										<span className="block">{order.externalId}</span>
										<span className="text-xs text-muted-foreground">
											{order.email}
										</span>
									</TableCell>
									<TableCell className="whitespace-nowrap">
										{order.placedAt.slice(0, 10)}
									</TableCell>
									<TableCell className="min-w-36 whitespace-normal">
										{order.nodeLabel}
									</TableCell>
									<TableCell>{order.status}</TableCell>
									<TableCell className="text-right whitespace-nowrap tabular-nums">
										{money(order.total, order.currency)}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					<p className="mt-3 text-xs text-muted-foreground">
						Showing up to 30 orders. Cancelled and fully refunded orders remain
						in this history with zero value.
					</p>
				</details>
			)}
			<p className="max-w-3xl text-xs text-muted-foreground">
				Currencies are reported separately. Partial refunds reduce order value;
				cancelled and fully refunded orders are removed from the paid totals.
				Attribution requires consent and the updated WooCommerce adapter. The
				recovery link must be opened within seven days of sending. This measures
				attributed purchases, not proven additional sales.
			</p>
		</section>
	);
}
