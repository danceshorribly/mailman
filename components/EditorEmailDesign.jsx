"use client";
/* Email previews use the original public image URLs, as the exported email does. */
/* eslint-disable @next/next/no-img-element */

import { useEffect, useRef, useState } from "react";
import {
	ArrowDown,
	ArrowUp,
	Copy,
	GripVertical,
	Heading,
	ImageIcon,
	LayoutTemplate,
	Monitor,
	MousePointer2,
	Package,
	Redo2,
	Smartphone,
	Trash2,
	Type,
	Undo2,
	Upload,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogClose,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import EmailTextEditor from "@/components/EmailTextEditor";
import {
	EMAIL_BLOCK_TYPES,
	EMAIL_BRAND,
	MAX_EMAIL_BLOCKS,
	moveEmailBlock,
	newEmailBlock,
	renderEmailBlock,
	renderEmailDesign,
	safeEmailUrl,
} from "@/lib/email-design";
import { prepareImage, uploadImage, IMAGE_TYPES } from "@/lib/upload-image";

const names = {
	heading: "Heading",
	text: "Text",
	image: "Image",
	button: "Button",
	product: "Product",
};
const icons = {
	heading: Heading,
	text: Type,
	image: ImageIcon,
	button: MousePointer2,
	product: Package,
};

export default function EditorEmailDesign({
	design,
	onChange,
	newsletter,
	disabled = false,
}) {
	const [open, setOpen] = useState(false);
	const [selected, setSelected] = useState(design.blocks[0]?.id);
	const [mobile, setMobile] = useState(false);
	const [drop, setDrop] = useState(null);
	const [error, setError] = useState("");
	const [uploading, setUploading] = useState(false);
	const [history, setHistory] = useState({ past: [], future: [], key: "" });
	const drag = useRef(null);
	const canvas = useRef(null);
	const settings = useRef(null);
	const uploadInput = useRef(null);
	const currentDesign = useRef(design);
	useEffect(() => {
		currentDesign.current = design;
	}, [design]);
	const block = design.blocks.find((item) => item.id === selected);
	const index = design.blocks.findIndex((item) => item.id === selected);
	function change(next, key = "") {
		const past =
			!key || key !== history.key
				? [...history.past, design].slice(-30)
				: history.past;
		setHistory({ past, future: [], key });
		onChange({ design: next, html: renderEmailDesign(next) });
	}
	function patch(patchValue, id = selected) {
		const latest = currentDesign.current;
		change(
			{
				...latest,
				blocks: latest.blocks.map((item) =>
					item.id === id ? { ...item, ...patchValue } : item,
				),
			},
			`${id}:${Object.keys(patchValue).join(",")}`,
		);
	}
	function undo(redo = false) {
		const source = redo ? history.future : history.past;
		if (!source.length) return;
		const next = source.at(-1);
		setHistory({
			past: redo ? [...history.past, design] : source.slice(0, -1),
			future: redo ? source.slice(0, -1) : [...history.future, design],
			key: "",
		});
		setSelected(
			next.blocks.find((item) => item.id === selected)?.id ||
				next.blocks[0]?.id,
		);
		onChange({ design: next, html: renderEmailDesign(next) });
	}
	function add(type) {
		if (design.blocks.length >= MAX_EMAIL_BLOCKS) return;
		const next = newEmailBlock(type, design.language);
		const blocks = [...design.blocks];
		blocks.splice(index < 0 ? blocks.length : index + 1, 0, next);
		change({ ...design, blocks });
		setSelected(next.id);
	}
	function move(direction) {
		const target = design.blocks[index + direction];
		if (target)
			change({
				...design,
				blocks: moveEmailBlock(
					design.blocks,
					selected,
					target.id,
					direction > 0,
				),
			});
	}
	function remove() {
		if (!block || design.blocks.length === 1) return;
		const blocks = design.blocks.filter((item) => item.id !== selected);
		change({ ...design, blocks });
		setSelected(blocks[Math.min(index, blocks.length - 1)].id);
	}
	function duplicate() {
		if (!block || design.blocks.length >= MAX_EMAIL_BLOCKS) return;
		const next = {
			...block,
			id: crypto.randomUUID(),
			...(block.type === "heading" && { level: 2, kicker: "" }),
		};
		const blocks = [...design.blocks];
		blocks.splice(index + 1, 0, next);
		change({ ...design, blocks });
		setSelected(next.id);
	}
	function pointerMove(event) {
		if (!drag.current) return;
		if (Math.abs(event.clientY - drag.current.y) < 6 && !drag.current.moved)
			return;
		drag.current.moved = true;
		const targets = [...canvas.current.querySelectorAll("[data-block-id]")]
			.map((element) => ({
				id: element.dataset.blockId,
				rect: element.getBoundingClientRect(),
			}))
			.filter((item) => item.id !== drag.current.id);
		const target = targets.reduce(
			(nearest, item) =>
				Math.abs(event.clientY - (item.rect.top + item.rect.height / 2)) <
				Math.abs(event.clientY - (nearest.rect.top + nearest.rect.height / 2))
					? item
					: nearest,
			targets[0],
		);
		if (target)
			setDrop({
				id: target.id,
				after: event.clientY > target.rect.top + target.rect.height / 2,
			});
		const scrollArea = canvas.current.closest("[data-designer-scroll]");
		if (scrollArea) {
			const rect = scrollArea.getBoundingClientRect();
			if (event.clientY < rect.top + 70) scrollArea.scrollTop -= 18;
			if (event.clientY > rect.bottom - 70) scrollArea.scrollTop += 18;
		}
	}
	async function upload(file) {
		if (!file || !block) return;
		const id = block.id;
		setUploading(true);
		setError("");
		try {
			const prepared = await prepareImage(file);
			const src = await uploadImage(prepared.file);
			patch({ src }, id);
		} catch (caught) {
			setError(caught.message);
		} finally {
			setUploading(false);
			if (uploadInput.current) uploadInput.current.value = "";
		}
	}
	function field(label, key, multiline = false) {
		const Component = multiline ? Textarea : Input;
		return (
			<label className="block space-y-1.5 text-sm">
				{label}
				<Component
					value={block[key] || ""}
					onChange={(event) => patch({ [key]: event.target.value })}
					{...(multiline && { rows: 3 })}
				/>
			</label>
		);
	}
	const past = history.past.length;
	const future = history.future.length;
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!uploading) setOpen(next);
			}}
		>
			<DialogTrigger asChild>
				<Button type="button" variant="outline" disabled={disabled}>
					<LayoutTemplate />
					Edit email visually
				</Button>
			</DialogTrigger>
			<DialogContent
				className="flex max-h-[94dvh] flex-col overflow-hidden p-0 sm:max-w-6xl"
				onPointerUp={() => {
					drag.current = null;
					setDrop(null);
				}}
			>
				<DialogHeader className="px-4 pt-4 pr-12">
					<DialogTitle>Edit your email</DialogTitle>
					<DialogDescription>
						Click text to edit it. Drag a block by its handle, or use the move
						buttons. Logo, colours and footer follow the shared Kamado design.
					</DialogDescription>
				</DialogHeader>
				<div className="flex flex-wrap items-center gap-1 px-4 pb-2">
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						title="Undo"
						aria-label="Undo edit"
						disabled={!past}
						onClick={() => undo()}
					>
						<Undo2 />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						title="Redo"
						aria-label="Redo edit"
						disabled={!future}
						onClick={() => undo(true)}
					>
						<Redo2 />
					</Button>
					<div
						className="ml-2 flex gap-1"
						role="group"
						aria-label="Email preview size"
					>
						<Button
							type="button"
							variant={mobile ? "ghost" : "secondary"}
							size="sm"
							aria-pressed={!mobile}
							onClick={() => setMobile(false)}
						>
							<Monitor />
							Desktop
						</Button>
						<Button
							type="button"
							variant={mobile ? "secondary" : "ghost"}
							size="sm"
							aria-pressed={mobile}
							onClick={() => setMobile(true)}
						>
							<Smartphone />
							Mobile
						</Button>
					</div>
					<Button
						type="button"
						variant="outline"
						size="sm"
						className="lg:hidden"
						onClick={() => settings.current?.scrollIntoView({ block: "start" })}
					>
						Block settings
					</Button>
					<DialogClose asChild>
						<Button type="button" className="ml-auto" disabled={uploading}>
							Done
						</Button>
					</DialogClose>
				</div>
				<div
					data-designer-scroll
					className="min-h-0 overflow-y-auto bg-muted/50 px-3 pb-4 md:px-5"
				>
					<div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
						<div
							ref={canvas}
							data-email-canvas
							data-email-mobile={mobile}
							className="email-designer mx-auto w-full overflow-hidden rounded-lg bg-white text-[#191918] shadow-sm"
							style={{ maxWidth: mobile ? 390 : 640 }}
						>
							<div
								className="flex justify-center bg-[#191918]"
								style={{ padding: EMAIL_BRAND.header_padding }}
							>
								<img
									src={EMAIL_BRAND.header_logo}
									alt="Kamado Sumo"
									width={240}
									height={159}
									className="h-auto max-w-full"
								/>
							</div>
							{design.blocks.map((item, position) => (
								<div
									key={item.id}
									data-block-id={item.id}
									role="group"
									aria-label={`${names[item.type]} block`}
									tabIndex={0}
									onFocus={() => setSelected(item.id)}
									className={`group relative ${selected === item.id ? "ring-2 ring-inset ring-[#ce0000]" : "hover:ring-1 hover:ring-inset hover:ring-[#ce0000]/50"}`}
									onClick={(event) => {
										if (event.target.closest("a")) event.preventDefault();
										setSelected(item.id);
									}}
								>
									<div
										className={`flex items-center gap-1 bg-[#f6f5f1] px-2 py-1 text-xs text-[#191918] ${selected === item.id ? "" : "hidden group-hover:flex group-focus-within:flex"}`}
									>
										<Button
											type="button"
											size="icon-sm"
											variant="ghost"
											aria-label={`Drag ${names[item.type]} block`}
											title="Drag to reorder"
											style={{ touchAction: "none", cursor: "grab" }}
											onPointerDown={(event) => {
												event.preventDefault();
												event.stopPropagation();
												setSelected(item.id);
												drag.current = {
													id: item.id,
													y: event.clientY,
													moved: false,
												};
												event.currentTarget.setPointerCapture(event.pointerId);
											}}
											onPointerMove={pointerMove}
											onPointerUp={(event) => {
												event.stopPropagation();
												if (drag.current?.moved && drop)
													change({
														...design,
														blocks: moveEmailBlock(
															design.blocks,
															drag.current.id,
															drop.id,
															drop.after,
														),
													});
												drag.current = null;
												setDrop(null);
											}}
											onPointerCancel={() => {
												drag.current = null;
												setDrop(null);
											}}
										>
											<GripVertical />
										</Button>
										<span>{names[item.type]}</span>
										<span className="ml-auto text-[11px]">
											{position === 0 && "Start"}
										</span>
									</div>
									{selected === item.id && item.type === "heading" ? (
										<div
											className="email-heading"
											style={{
												padding:
													item.level === 1 ? "38px 40px 0" : "24px 40px 0",
											}}
										>
											{item.level === 1 && (
												<input
													aria-label="Heading eyebrow"
													maxLength={100}
													value={item.kicker || ""}
													onChange={(event) =>
														patch({ kicker: event.target.value })
													}
													placeholder="Optional eyebrow"
													className="mb-2 block w-full bg-transparent text-[11px] font-bold tracking-[1.2px] text-[#8d0c0c] uppercase outline-none"
												/>
											)}
											<TitleInput
												key={item.id}
												level={item.level}
												value={item.title}
												onChange={(title) => patch({ title })}
											/>
										</div>
									) : selected === item.id && item.type === "text" ? (
										<div className="email-copy px-10 pt-3 pb-3">
											<EmailTextEditor
												key={item.id}
												content={item.html}
												onChange={(html) => patch({ html })}
											/>
										</div>
									) : (
										<table
											role="presentation"
											className="w-full"
											style={{ borderCollapse: "collapse" }}
										>
											<tbody
												dangerouslySetInnerHTML={{
													__html: renderEmailBlock(item),
												}}
											/>
										</table>
									)}
									{drop?.id === item.id && (
										<div
											className={`pointer-events-none absolute right-0 left-0 h-1 bg-[#ce0000] ${drop.after ? "bottom-0" : "top-0"}`}
										/>
									)}
								</div>
							))}
							<div className="bg-[#040000]">
								<img
									src={EMAIL_BRAND.footer_image}
									alt={EMAIL_BRAND.footer_alt}
									width={640}
									className="block h-auto w-full"
								/>
								<div className="px-8 pt-7 pb-8 text-center font-sans text-xs leading-7 text-white">
									<p>
										{design.language === "en"
											? "You receive this email because you subscribe to Kamado Sumo newsletters."
											: "Du får detta mejl eftersom du prenumererar på Kamado Sumos nyhetsbrev."}
									</p>
									<p className="my-3">
										Kamado Sumo
										<br />
										{newsletter?.postalAddress ||
											"Add the newsletter postal address"}
									</p>
									<p>
										{design.language === "en"
											? "Contact Kamado Sumo · Unsubscribe"
											: "Kontakta Kamado Sumo · Avsluta prenumerationen"}
									</p>
								</div>
							</div>
						</div>
						<aside
							ref={settings}
							className="space-y-4 rounded-xl bg-card p-4 text-card-foreground lg:sticky lg:top-0"
						>
							<Button
								type="button"
								variant="outline"
								size="sm"
								className="lg:hidden"
								onClick={() =>
									(
										canvas.current?.querySelector(
											`[data-block-id="${selected}"]`,
										) || canvas.current
									)?.scrollIntoView({ block: "start" })
								}
							>
								Back to selected block
							</Button>
							<h3 className="text-sm font-semibold">Add content</h3>
							<div className="grid grid-cols-2 gap-2">
								{EMAIL_BLOCK_TYPES.map((type) => {
									const Icon = icons[type];
									return (
										<Button
											key={type}
											type="button"
											variant="outline"
											size="sm"
											disabled={design.blocks.length >= MAX_EMAIL_BLOCKS}
											onClick={() => add(type)}
										>
											<Icon />
											{names[type]}
										</Button>
									);
								})}
							</div>
							{block && (
								<>
									<h3 className="text-sm font-semibold">
										{names[block.type]} settings
									</h3>
									<div className="flex flex-wrap gap-1">
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label="Move block up"
											title="Move up"
											disabled={index <= 0}
											onClick={() => move(-1)}
										>
											<ArrowUp />
										</Button>
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label="Move block down"
											title="Move down"
											disabled={index >= design.blocks.length - 1}
											onClick={() => move(1)}
										>
											<ArrowDown />
										</Button>
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label="Duplicate block"
											title="Duplicate"
											disabled={design.blocks.length >= MAX_EMAIL_BLOCKS}
											onClick={duplicate}
										>
											<Copy />
										</Button>
										<Button
											type="button"
											variant="outline"
											size="icon-sm"
											aria-label="Remove block"
											title="Remove"
											disabled={design.blocks.length <= 1}
											onClick={remove}
										>
											<Trash2 />
										</Button>
									</div>
									{["heading", "product"].includes(block.type) &&
										field("Heading text", "title", true)}
									{block.type === "heading" &&
										block.level === 1 &&
										field("Eyebrow", "kicker")}
									{["button", "product"].includes(block.type) &&
										field("Button text", "label")}
									{["button", "image", "product"].includes(block.type) &&
										field("Destination link", "url")}
									{["image", "product"].includes(block.type) && (
										<>
											{field("Image address", "src")}
											{field("Image description", "alt")}
											<input
												ref={uploadInput}
												type="file"
												accept={IMAGE_TYPES.join(",")}
												className="hidden"
												aria-label="Upload email image"
												onChange={(event) => upload(event.target.files?.[0])}
											/>
											<Button
												type="button"
												variant="outline"
												className="w-full"
												disabled={uploading}
												onClick={() => uploadInput.current?.click()}
											>
												<Upload />
												{uploading ? "Uploading..." : "Upload image"}
											</Button>
										</>
									)}
									{block.type === "product" && (
										<>
											<p className="text-xs text-muted-foreground">
												Product details are entered manually. They are not
												fetched from the cart.
											</p>
											<EmailTextEditor
												key={block.id}
												content={block.html}
												onChange={(html) => patch({ html })}
											/>
										</>
									)}
									{block.type === "text" && (
										<p className="text-xs text-muted-foreground">
											Edit this text directly in the email. Select words to
											format them or add a link.
										</p>
									)}
									{block.url && !safeEmailUrl(block.url) && (
										<p className="text-xs text-destructive">
											Enter a full HTTPS or email link.
										</p>
									)}
									{block.src && !safeEmailUrl(block.src, true) && (
										<p className="text-xs text-destructive">
											Enter a public HTTPS image address.
										</p>
									)}
								</>
							)}
							{error && (
								<p role="alert" className="text-sm text-destructive">
									{error}
								</p>
							)}
						</aside>
					</div>
				</div>
				<style>{`.email-designer .email-block-text{font:16px/1.65 Montserrat,Arial,sans-serif;color:#191918}.email-designer .email-block-text p{margin:0 0 22px}.email-designer .email-block-text ul{list-style:disc;padding-left:24px;margin-bottom:22px}.email-designer .email-block-text ol{list-style:decimal;padding-left:24px;margin-bottom:22px}.email-designer .email-block-text a{color:#a40000;text-decoration:underline}.email-designer .email-title{font-family:"Arial Black",Arial,Helvetica,sans-serif;font-weight:900;line-height:1.12;letter-spacing:-1px;margin:0 0 14px}.email-designer[data-email-mobile=true] h1,.email-designer[data-email-mobile=true] .email-title-h1{font-size:36px!important}.email-designer[data-email-mobile=true] .email-heading,.email-designer[data-email-mobile=true] .email-copy,.email-designer[data-email-mobile=true] td.pad{padding-left:22px!important;padding-right:22px!important}@media(max-width:600px){.email-designer h1,.email-designer .email-title-h1{font-size:36px!important}.email-designer .email-heading,.email-designer .email-copy,.email-designer td.pad{padding-left:22px!important;padding-right:22px!important}}`}</style>
			</DialogContent>
		</Dialog>
	);
}

function TitleInput({ value, onChange, level }) {
	const input = useRef(null);
	return (
		<textarea
			ref={(element) => {
				input.current = element;
				if (element) {
					element.style.height = "auto";
					element.style.height = `${element.scrollHeight}px`;
				}
			}}
			aria-label="Edit heading in email"
			maxLength={400}
			rows={Math.max(1, value.split("\n").length)}
			value={value}
			onChange={(event) => onChange(event.target.value)}
			className={`email-title email-title-h${level} block w-full resize-none overflow-hidden bg-transparent outline-none`}
			style={{ fontSize: level === 1 ? 44 : 28 }}
		/>
	);
}
