"use client";

import { useEffect, useId, useState } from "react";
import { LayoutTemplate, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { FieldSelect } from "@/components/RuleBuilder";
import { listEmailTemplates, loadEmailTemplate } from "@/lib/email-templates";
import { renderEmail, UNSUBSCRIBE_PLACEHOLDER } from "@/lib/render-email";
import { personalize } from "@/lib/personalization";

export default function DialogEmailTemplate({
	trigger,
	campaign = false,
	newsletter,
	disabled,
	onApply,
}) {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState("");
	const [loaded, setLoaded] = useState(null);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(false);
	const selectId = useId();
	const templates = listEmailTemplates({ trigger, campaign });
	// Hide cart-specific templates outside cart journeys, including after changing a trigger.
	const template = templates.find((item) => item.id === selected);
	useEffect(() => {
		if (!open || !template) return;
		const controller = new AbortController();
		loadEmailTemplate(template.id, {
			trigger,
			campaign,
			signal: controller.signal,
		}).then(
			(next) => {
				setLoaded(next);
				setLoading(false);
			},
			(caught) => {
				if (!controller.signal.aborted) {
					setError(caught.message);
					setLoading(false);
				}
			},
		);
		return () => controller.abort();
	}, [open, template, trigger, campaign]);
	const ready = loaded?.id === template?.id && loaded && !loading;
	const preview = ready
		? personalize(
				renderEmail({ ...loaded, newsletter }).html,
				{ firstName: "Alex", fullName: "Alex Sumo" },
				`${newsletter?.previewShopOrigin || "https://kamadosumo.com"}/cart/`,
				true,
			).replaceAll(UNSUBSCRIBE_PLACEHOLDER, "#")
		: "";
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" disabled={disabled}>
					<LayoutTemplate />
					Choose template
				</Button>
			</DialogTrigger>
			<DialogContent className="flex max-h-[90dvh] flex-col overflow-y-auto sm:max-w-4xl">
				<DialogHeader>
					<DialogTitle>Kamado Sumo email templates</DialogTitle>
					<DialogDescription>
						Preview a design, then use it as a starting point. This replaces the
						subject, preview text and email content.
					</DialogDescription>
				</DialogHeader>
				<div className="grid min-h-0 gap-4 md:grid-cols-[240px_minmax(0,1fr)]">
					<div className="space-y-4">
						<label className="block space-y-2 text-sm" htmlFor={selectId}>
							Template
						</label>
						<FieldSelect
							id={selectId}
							className="block w-full"
							value={template?.id || ""}
							onChange={(e) => {
								setSelected(e.target.value);
								setLoaded(null);
								setError("");
								setLoading(Boolean(e.target.value));
							}}
						>
							<option value="">Choose a template</option>
							{["sv", "en", "sv-en"].map((language) => (
								<optgroup
									key={language}
									label={
										{
											sv: "Svenska",
											en: "English",
											"sv-en": "Svenska / English",
										}[language]
									}
								>
									{templates
										.filter((item) => item.language === language)
										.map((item) => (
											<option key={item.id} value={item.id}>
												{item.name}
											</option>
										))}
								</optgroup>
							))}
						</FieldSelect>
						{template && (
							<>
								<p className="text-sm">{template.description}</p>
								<p className="rounded-lg bg-muted p-3 text-sm">
									{template.usageNote}
								</p>
								<p className="text-xs text-muted-foreground">
									Language is chosen here. It is not translated automatically.
								</p>
							</>
						)}
						<div aria-live="polite">
							{loading && (
								<p className="flex gap-2 text-sm">
									<Loader2 className="size-4 animate-spin" />
									Loading preview...
								</p>
							)}
							{error && <p className="text-sm text-destructive">{error}</p>}
						</div>
						<Button
							type="button"
							className="w-full"
							disabled={!ready || disabled}
							onClick={() => {
								onApply(loaded);
								setOpen(false);
							}}
						>
							Use template
						</Button>
					</div>
					<div className="min-w-0">
						{ready ? (
							<>
								<p className="mb-2 text-sm font-medium">{loaded.subject}</p>
								<p className="mb-3 text-xs text-muted-foreground">
									{loaded.previewText}
								</p>
								<iframe
									title="Template preview"
									sandbox=""
									srcDoc={preview}
									className="h-[55dvh] min-h-80 w-full rounded-lg border bg-white"
								/>
							</>
						) : (
							<p className="rounded-lg bg-muted p-6 text-sm text-muted-foreground">
								Choose a template to preview it.
							</p>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
}
