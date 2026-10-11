"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveSegment, previewSegment } from "@/app/(app)/segments/actions";
import RuleBuilder, { FieldSelect, newRule } from "@/components/RuleBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export default function SegmentEditor({ newsletters, segments }) {
	const router = useRouter();
	const initial = () => ({
		name: "",
		newsletterId: newsletters[0]?._id || "",
		rules: { mode: "all", rules: [newRule()] },
	});
	const [draft, setDraft] = useState(initial);
	const [result, setResult] = useState(null);
	const [pending, start] = useTransition();
	function update(patch) {
		setDraft({ ...draft, ...patch });
		setResult(null);
	}
	return (
		<div className="grid items-start gap-6 lg:grid-cols-[1fr_2fr]">
			<div className="space-y-2">
				<Button
					variant="outline"
					onClick={() => {
						setDraft(initial());
						setResult(null);
					}}
				>
					New segment
				</Button>
				{segments.map((segment) => (
					<button
						className="block w-full rounded-xl bg-card p-4 text-left shadow-border hover:bg-muted"
						key={segment._id}
						onClick={() => {
							setDraft({ ...segment, id: segment._id });
							setResult(null);
						}}
					>
						<span className="block font-medium">{segment.name}</span>
						<span className="text-sm text-muted-foreground">
							{newsletters.find((n) => n._id === segment.newsletterId)?.name}
						</span>
					</button>
				))}
			</div>
			<form
				className="space-y-4 rounded-xl bg-card p-5 shadow-border"
				onSubmit={(e) => {
					e.preventDefault();
					start(async () => {
						const next = await saveSegment(draft);
						setResult(next);
						if (next.ok) router.refresh();
					});
				}}
			>
				<label className="block space-y-2 text-sm">
					Segment name
					<Input
						required
						maxLength={100}
						value={draft.name}
						onChange={(e) => update({ name: e.target.value })}
					/>
				</label>
				<label className="block space-y-2 text-sm">
					Newsletter
					<FieldSelect
						className="block w-full"
						disabled={!!draft.id}
						value={draft.newsletterId}
						onChange={(e) => update({ newsletterId: e.target.value })}
					>
						{newsletters.map((n) => (
							<option key={n._id} value={n._id}>
								{n.name}
							</option>
						))}
					</FieldSelect>
				</label>
				<RuleBuilder
					value={draft.rules}
					onChange={(rules) => update({ rules })}
				/>
				<p className="text-sm text-muted-foreground">
					Membership updates from current customer data. Only active,
					unsuppressed contacts can receive a campaign.
				</p>
				<div className="flex gap-2">
					<Button disabled={pending || !newsletters.length}>
						Save segment
					</Button>
					<Button
						type="button"
						variant="outline"
						disabled={pending}
						onClick={() =>
							start(async () => setResult(await previewSegment(draft)))
						}
					>
						Preview audience
					</Button>
				</div>
				<div aria-live="polite" className="text-sm">
					{result?.error && <p className="text-destructive">{result.error}</p>}
					{result?.ok && <p>Saved.</p>}
					{result?.count != null && (
						<>
							<p>{result.count} eligible contacts</p>
							<ul className="mt-2 space-y-1">
								{result.emails.map((email) => (
									<li key={email} className="break-all">
										{email}
									</li>
								))}
							</ul>
						</>
					)}
				</div>
			</form>
		</div>
	);
}
