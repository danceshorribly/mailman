"use client";
import { useActionState } from "react";
import { createStore } from "@/app/(app)/commerce/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FieldSelect } from "@/components/RuleBuilder";
export default function StoreForm({ newsletters, keys }) {
	const [state, action, pending] = useActionState(createStore, null);
	return (
		<form
			action={action}
			className="grid gap-4 rounded-xl bg-card p-5 shadow-border sm:grid-cols-2"
		>
			<label className="space-y-2 text-sm">
				Shop name
				<Input name="name" required maxLength={100} />
			</label>
			<label className="space-y-2 text-sm">
				Shop address
				<Input
					type="url"
					name="origin"
					required
					placeholder="https://www.kamadosumo.com"
				/>
			</label>
			<label className="space-y-2 text-sm">
				Newsletter
				<FieldSelect className="block w-full" name="newsletterId">
					{newsletters.map((n) => (
						<option key={n._id} value={n._id}>
							{n.name}
						</option>
					))}
				</FieldSelect>
			</label>
			<label className="space-y-2 text-sm">
				API key
				<FieldSelect className="block w-full" name="apiKeyId">
					{keys.map((key) => (
						<option key={key._id} value={key._id}>
							{key.name} ({key.prefix})
						</option>
					))}
				</FieldSelect>
			</label>
			<div className="sm:col-span-2">
				<Button disabled={pending || !newsletters.length || !keys.length}>
					Register shop
				</Button>
				<p aria-live="polite" className="mt-2 text-sm">
					{state?.error ||
						(state?.ok &&
							"Shop registered. Copy its endpoint below into the WooCommerce adapter.")}
				</p>
			</div>
		</form>
	);
}
