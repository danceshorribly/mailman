import { isValidObjectId } from "mongoose";
import { notFound } from "next/navigation";
import HeaderPage from "@/components/HeaderPage";
import { connectDb } from "@/lib/db";
import Contact from "@/models/Contact";
import CommerceRecord from "@/models/CommerceRecord";
import Message from "@/models/Message";
export const metadata = { title: "Customer profile" };
export default async function ContactPage({ params }) {
	const { id } = await params;
	if (!isValidObjectId(id)) notFound();
	await connectDb();
	const contact = await Contact.findById(id).lean();
	if (!contact) notFound();
	const [orders, messages] = await Promise.all([
		CommerceRecord.find({
			newsletterId: contact.newsletterId,
			email: contact.email,
			kind: "order",
		})
			.sort({ placedAt: -1 })
			.limit(30)
			.lean(),
		Message.find({ contactId: id }).sort({ createdAt: -1 }).limit(30).lean(),
	]);
	return (
		<>
			<HeaderPage
				title={
					contact.fullName ||
					[contact.firstName, contact.lastName].filter(Boolean).join(" ") ||
					contact.email
				}
				backHref="/contacts"
			/>
			<div className="grid gap-6 md:grid-cols-2">
				<section className="rounded-xl bg-card p-5 shadow-border">
					<h2 className="mb-4 font-semibold">Customer</h2>
					<dl className="grid grid-cols-[auto_1fr] gap-x-5 gap-y-3 text-sm">
						{Object.entries({
							Email: contact.email,
							Status: contact.status,
							Language: contact.language || "Unknown",
							Country: contact.country || "Unknown",
							Tags: contact.tags?.join(", ") || "None",
							"Paid orders": contact.commerce?.orderCount || 0,
							"Total spend":
								Object.entries(contact.commerce?.spendByCurrency || {})
									.map(([currency, total]) => `${total} ${currency}`)
									.join(", ") || "None",
						}).map(([label, value]) => (
							<div key={label} className="contents">
								<dt className="text-muted-foreground">{label}</dt>
								<dd className="break-all">{value}</dd>
							</div>
						))}
					</dl>
				</section>
				<section className="rounded-xl bg-card p-5 shadow-border">
					<h2 className="mb-4 font-semibold">Order history</h2>
					{orders.map((order) => (
						<div key={String(order._id)} className="mb-4 text-sm">
							<p>
								{order.externalId} · {order.status} · {order.total}{" "}
								{order.currency}
							</p>
							<p className="mt-1 text-muted-foreground">
								{order.items
									.map((item) => `${item.quantity} × ${item.name}`)
									.join(", ")}
							</p>
						</div>
					))}
					{!orders.length && (
						<p className="text-sm text-muted-foreground">No orders received.</p>
					)}
				</section>
			</div>
			<section className="mt-8">
				<h2 className="mb-4 text-xl font-semibold">Recent emails</h2>
				{messages.map((message) => (
					<p
						key={String(message._id)}
						className="mb-2 rounded-lg bg-card p-3 text-sm shadow-border"
					>
						{new Date(message.createdAt).toISOString()} · {message.kind} ·{" "}
						{message.status}
						{message.error && ` · ${message.error}`}
					</p>
				))}
			</section>
		</>
	);
}
