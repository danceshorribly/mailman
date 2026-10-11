"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
	GitBranch,
	Mail,
	Clock3,
	Tag,
	CircleCheck,
	Plus,
	Trash2,
} from "lucide-react";
import {
	saveAutomation,
	setAutomationStatus,
} from "@/app/(app)/automations/actions";
import HeaderPage from "@/components/HeaderPage";
import RuleBuilder, { FieldSelect, newRule } from "@/components/RuleBuilder";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { renderEmail, UNSUBSCRIBE_PLACEHOLDER } from "@/lib/render-email";
import { personalize } from "@/lib/personalization";

const icons = {
	email: Mail,
	wait: Clock3,
	condition: GitBranch,
	tag: Tag,
	end: CircleCheck,
};
const names = {
	email: "Send email",
	wait: "Wait",
	condition: "If / else",
	tag: "Add tag",
	end: "Finish",
};

export default function AutomationEditor({
	flow,
	newsletter,
	enabled,
	sending,
}) {
	const router = useRouter();
	const [draft, setDraft] = useState(flow);
	const [selected, setSelected] = useState(flow.definition.start);
	const [result, setResult] = useState(null);
	const [dirty, setDirty] = useState(false);
	const [pending, start] = useTransition();
	const editable = flow.status !== "active";
	const node = draft.definition.nodes.find((item) => item.id === selected);
	function update(patch) {
		setDraft((old) => ({ ...old, ...patch }));
		setDirty(true);
		setResult(null);
	}
	function updateNode(patch) {
		update({
			definition: {
				...draft.definition,
				nodes: draft.definition.nodes.map((old) =>
					old.id === selected ? { ...old, ...patch } : old,
				),
			},
		});
	}
	function add(type) {
		const id = crypto.randomUUID();
		const next = draft.definition.start;
		const newNode = {
			id,
			type,
			label: names[type],
			next,
			...(type === "email" && {
				subject: "",
				markdown: "Hej {{firstName}},\n\n",
				previewText: "",
			}),
			...(type === "wait" && { minutes: 60 }),
			...(type === "condition" && {
				rules: { mode: "all", rules: [newRule()] },
				yes: next,
				no: next,
			}),
			...(type === "tag" && { tag: "" }),
		};
		update({
			definition: { start: id, nodes: [newNode, ...draft.definition.nodes] },
		});
		setSelected(id);
	}
	function remove() {
		const target = node.next || node.yes;
		if (!target) return;
		const nodes = draft.definition.nodes
			.filter((item) => item.id !== node.id)
			.map((item) => ({
				...item,
				...(item.next === node.id && { next: target }),
				...(item.yes === node.id && { yes: target }),
				...(item.no === node.id && { no: target }),
			}));
		update({
			definition: {
				start:
					draft.definition.start === node.id ? target : draft.definition.start,
				nodes,
			},
		});
		setSelected(target);
	}
	const selectTarget = (key, label) => (
		<label className="block space-y-2 text-sm">
			{label}
			<FieldSelect
				className="block w-full"
				disabled={!editable}
				value={node[key] || ""}
				onChange={(e) => updateNode({ [key]: e.target.value })}
			>
				{draft.definition.nodes
					.filter((item) => item.id !== node.id)
					.map((item) => (
						<option key={item.id} value={item.id}>
							{item.label}
						</option>
					))}
			</FieldSelect>
		</label>
	);
	let preview = "";
	if (node?.type === "email")
		preview = personalize(
			renderEmail({ ...node, format: node.format || "markdown", newsletter })
				.html,
			{ firstName: "Alex", fullName: "Alex Sumo" },
			`${newsletter.previewShopOrigin || "https://www.kamadosumo.com"}/cart/`,
			true,
		).replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#");
	return (
		<>
			<HeaderPage
				title={draft.name}
				backHref="/automations"
				meta={
					<span className="text-sm text-muted-foreground">{flow.status}</span>
				}
			>
				{editable && (
					<Button
						disabled={pending || !dirty}
						onClick={() =>
							start(async () => {
								const next = await saveAutomation(flow._id, {
									...draft,
									revision: draft.revision,
								});
								setResult(next);
								if (next.ok) {
									setDraft((old) => ({ ...old, revision: next.revision }));
									setDirty(false);
									router.refresh();
								}
							})
						}
					>
						{pending ? "Saving..." : "Save changes"}
					</Button>
				)}
				<Button
					variant="outline"
					disabled={pending || dirty}
					onClick={() =>
						start(async () => {
							const next = await setAutomationStatus(
								flow._id,
								flow.status === "active" ? "paused" : "active",
								draft.revision,
							);
							setResult(next);
							router.refresh();
						})
					}
				>
					{flow.status === "active" ? "Pause flow" : "Activate flow"}
				</Button>
			</HeaderPage>
			<div aria-live="polite" className="mb-4 text-sm">
				{flow.pauseReason && (
					<p className="text-destructive">Paused: {flow.pauseReason}</p>
				)}
				{result?.error && <p className="text-destructive">{result.error}</p>}
				{result?.ok && <p>Saved.</p>}
				{dirty && (
					<p>Unsaved changes. Save before activating or leaving this page.</p>
				)}
			</div>
			{(!enabled || !sending) && (
				<p className="mb-6 rounded-xl bg-muted p-4 text-sm">
					{!enabled ? "Automation worker is off." : "Automation worker is on."}{" "}
					{!sending && "Email sending is off. No flow emails will be sent."}
				</p>
			)}
			<div className="grid items-start gap-6 lg:grid-cols-[minmax(220px,1fr)_2fr]">
				<div className="space-y-4">
					<div className="rounded-xl bg-primary p-4 text-primary-foreground">
						<p className="text-xs">Starts when</p>
						<p className="font-medium">
							{flow.trigger === "cart.abandoned"
								? "A known cart is inactive for 1 hour"
								: flow.trigger === "order.paid"
									? "An order is paid"
									: "A contact subscribes"}
						</p>
					</div>
					{editable && (
						<label className="block space-y-2 text-sm">
							Flow name
							<Input
								value={draft.name}
								maxLength={100}
								onChange={(e) => update({ name: e.target.value })}
							/>
						</label>
					)}
					<label className="block space-y-2 text-sm">
						First step
						<FieldSelect
							className="block w-full"
							disabled={!editable}
							value={draft.definition.start}
							onChange={(e) =>
								update({
									definition: { ...draft.definition, start: e.target.value },
								})
							}
						>
							{draft.definition.nodes.map((item) => (
								<option key={item.id} value={item.id}>
									{item.label}
								</option>
							))}
						</FieldSelect>
					</label>
					<div className="space-y-2">
						{draft.definition.nodes.map((item) => {
							const Icon = icons[item.type];
							return (
								<button
									aria-pressed={selected === item.id}
									key={item.id}
									className={`block w-full rounded-xl p-4 text-left shadow-border ${selected === item.id ? "bg-muted ring-2 ring-ring" : "bg-card hover:bg-muted/50"}`}
									onClick={() => setSelected(item.id)}
								>
									<span className="flex gap-2 font-medium">
										<Icon className="size-4 shrink-0" />
										{item.label}
									</span>
									<span className="mt-2 block text-xs text-muted-foreground">
										{item.type === "condition"
											? `Yes: ${draft.definition.nodes.find((n) => n.id === item.yes)?.label || "Choose step"}. No: ${draft.definition.nodes.find((n) => n.id === item.no)?.label || "Choose step"}`
											: item.type === "end"
												? "Journey completed"
												: `Next: ${draft.definition.nodes.find((n) => n.id === item.next)?.label || "Choose step"}`}
									</span>
								</button>
							);
						})}
					</div>
					{editable && (
						<div className="flex flex-wrap gap-2">
							{["email", "wait", "condition", "tag"].map((type) => (
								<Button
									key={type}
									variant="outline"
									size="sm"
									disabled={draft.definition.nodes.length >= 50}
									onClick={() => add(type)}
								>
									<Plus />
									{names[type]}
								</Button>
							))}
						</div>
					)}
					<p className="text-xs text-muted-foreground">
						New steps are added at the start. Use Next, Yes and No to connect
						them. Every branch must end. Paused runs keep their original steps;
						edits apply to new entrants.
					</p>
				</div>
				{node && (
					<div className="min-w-0 space-y-5 rounded-xl bg-card p-5 shadow-border">
						<div className="flex items-center justify-between">
							<h2 className="text-lg font-semibold">{names[node.type]}</h2>
							{editable && node.type !== "end" && (
								<Button
									variant="ghost"
									size="icon"
									aria-label="Remove step"
									onClick={remove}
								>
									<Trash2 />
								</Button>
							)}
						</div>
						<fieldset disabled={!editable} className="space-y-4">
							<label className="block space-y-2 text-sm">
								Step name
								<Input
									value={node.label}
									onChange={(e) => updateNode({ label: e.target.value })}
								/>
							</label>
							{node.type === "wait" && (
								<label className="block space-y-2 text-sm">
									Wait in minutes
									<Input
										type="number"
										min={1}
										max={43200}
										value={node.minutes}
										onChange={(e) =>
											updateNode({ minutes: Number(e.target.value) })
										}
									/>
								</label>
							)}
							{node.type === "tag" && (
								<label className="block space-y-2 text-sm">
									Tag
									<Input
										maxLength={80}
										value={node.tag}
										onChange={(e) => updateNode({ tag: e.target.value })}
									/>
								</label>
							)}
							{node.type === "condition" && (
								<>
									<RuleBuilder
										value={node.rules}
										onChange={(rules) => updateNode({ rules })}
									/>
									{selectTarget("yes", "Yes, conditions match")}
									{selectTarget("no", "No, conditions do not match")}
								</>
							)}
							{node.type === "email" && (
								<>
									<label className="block space-y-2 text-sm">
										Subject
										<Input
											maxLength={200}
											value={node.subject}
											onChange={(e) => updateNode({ subject: e.target.value })}
										/>
									</label>
									<label className="block space-y-2 text-sm">
										Preview text
										<Input
											value={node.previewText}
											onChange={(e) =>
												updateNode({ previewText: e.target.value })
											}
										/>
									</label>
									<label className="block space-y-2 text-sm">
										Email format
										<FieldSelect
											className="block w-full"
											value={node.format || "markdown"}
											onChange={(e) =>
												updateNode({
													format: e.target.value,
													...(e.target.value === "html" &&
														!node.html && { html: "" }),
												})
											}
										>
											<option value="markdown">Markdown</option>
											<option value="html">HTML template</option>
										</FieldSelect>
									</label>
									<label className="block space-y-2 text-sm">
										Email content (
										{node.format === "html" ? "HTML" : "Markdown"})
										<Textarea
											rows={12}
											value={
												(node.format === "html" ? node.html : node.markdown) ||
												""
											}
											onChange={(e) =>
												updateNode({
													[node.format === "html" ? "html" : "markdown"]:
														e.target.value,
												})
											}
										/>
									</label>
									<p className="text-xs text-muted-foreground">
										Personalization:{" "}
										{"{{firstName}}, {{lastName}}, {{fullName}}"}.{" "}
										{flow.trigger === "cart.abandoned" &&
											"Recovery link: [Return to cart]({{checkoutUrl}})"}
									</p>
								</>
							)}
							{!["condition", "end"].includes(node.type) &&
								selectTarget("next", "Next step")}
						</fieldset>
						{node.type === "email" && (
							<div>
								<h3 className="mb-2 text-sm font-medium">Email preview</h3>
								<iframe
									title="Email preview"
									sandbox=""
									srcDoc={preview}
									className="h-[500px] w-full rounded-lg border bg-white"
								/>
							</div>
						)}
					</div>
				)}
			</div>
		</>
	);
}
