"use client";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { SEGMENT_FIELDS, SEGMENT_OPERATORS } from "@/lib/segments";

export const newRule = () => ({ field: "language", op: "eq", value: "sv" });
export function FieldSelect({ children, className = "", ...props }) {
	return (
		<select
			className={`h-9 min-w-0 rounded-lg border border-input bg-background px-2 text-sm focus-visible:outline-2 focus-visible:outline-ring ${className}`}
			{...props}
		>
			{children}
		</select>
	);
}
const labels = {
	eq: "is",
	ne: "is not",
	contains: "contains",
	notContains: "does not contain",
	gt: "greater than",
	gte: "at least",
	lt: "less than",
	lte: "at most",
	before: "before",
	after: "after",
	withinDays: "within the last (days)",
	olderThanDays: "more than (days ago)",
	exists: "is known",
	missing: "is unknown",
};

export default function RuleBuilder({ value, onChange, depth = 0 }) {
	const group = value.mode ? value : { mode: "all", rules: [value] };
	function change(index, rule) {
		onChange({
			...group,
			rules: group.rules.map((old, i) => (i === index ? rule : old)),
		});
	}
	return (
		<div className="space-y-3 rounded-xl bg-muted/40 p-3">
			<FieldSelect
				aria-label="Combine conditions"
				value={group.mode}
				onChange={(e) => onChange({ ...group, mode: e.target.value })}
			>
				<option value="all">Match all conditions (AND)</option>
				<option value="any">Match any condition (OR)</option>
			</FieldSelect>
			{group.rules.map((rule, index) => (
				<div key={index} className="flex items-start gap-2">
					<div className="min-w-0 flex-1">
						{rule.mode ? (
							<RuleBuilder
								value={rule}
								onChange={(next) => change(index, next)}
								depth={depth + 1}
							/>
						) : (
							<div className="grid gap-2 sm:grid-cols-3">
								<FieldSelect
									aria-label="Customer field"
									value={rule.field}
									onChange={(e) =>
										change(index, {
											field: e.target.value,
											op: SEGMENT_OPERATORS[
												SEGMENT_FIELDS[e.target.value].type
											][0],
											value: "",
										})
									}
								>
									{Object.entries(SEGMENT_FIELDS).map(([field, config]) => (
										<option key={field} value={field}>
											{config.label}
										</option>
									))}
								</FieldSelect>
								<FieldSelect
									aria-label="Comparison"
									value={rule.op}
									onChange={(e) =>
										change(index, { ...rule, op: e.target.value })
									}
								>
									{SEGMENT_OPERATORS[SEGMENT_FIELDS[rule.field].type].map(
										(op) => (
											<option key={op} value={op}>
												{labels[op]}
											</option>
										),
									)}
								</FieldSelect>
								{!["exists", "missing"].includes(rule.op) && (
									<Input
										aria-label="Condition value"
										type={
											["before", "after"].includes(rule.op)
												? "date"
												: SEGMENT_FIELDS[rule.field].type === "number" ||
													  ["withinDays", "olderThanDays"].includes(rule.op)
													? "number"
													: "text"
										}
										value={rule.value ?? ""}
										onChange={(e) =>
											change(index, { ...rule, value: e.target.value })
										}
									/>
								)}
							</div>
						)}
					</div>
					<Button
						type="button"
						variant="ghost"
						size="icon"
						aria-label="Remove condition"
						disabled={group.rules.length === 1}
						onClick={() =>
							onChange({
								...group,
								rules: group.rules.filter((_, i) => i !== index),
							})
						}
					>
						<Trash2 />
					</Button>
				</div>
			))}
			<div className="flex flex-wrap gap-2">
				<Button
					type="button"
					variant="outline"
					size="sm"
					onClick={() =>
						onChange({ ...group, rules: [...group.rules, newRule()] })
					}
				>
					<Plus />
					Condition
				</Button>
				{depth < 3 && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={() =>
							onChange({
								...group,
								rules: [...group.rules, { mode: "any", rules: [newRule()] }],
							})
						}
					>
						OR / AND group
					</Button>
				)}
			</div>
		</div>
	);
}
