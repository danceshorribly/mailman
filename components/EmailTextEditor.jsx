"use client";
import { useEffect, useState } from "react";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Bold, Italic, List, ListOrdered, Link2, Unlink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { safeEmailUrl } from "@/lib/email-design";

export default function EmailTextEditor({ content, onChange }) {
	const [linkOpen, setLinkOpen] = useState(false);
	const [url, setUrl] = useState("");
	const [error, setError] = useState("");
	const editor = useEditor({
		immediatelyRender: false,
		content,
		extensions: [
			StarterKit.configure({
				heading: false,
				blockquote: false,
				code: false,
				codeBlock: false,
				horizontalRule: false,
				strike: false,
				link: { openOnClick: false, defaultProtocol: "https" },
			}),
		],
		editorProps: {
			attributes: {
				class: "email-block-text outline-none",
				"aria-label": "Block text",
			},
		},
		onUpdate: ({ editor: current }) => onChange(current.getHTML()),
	});
	useEffect(() => {
		if (editor && editor.getHTML() !== content)
			editor.commands.setContent(content, { emitUpdate: false });
	}, [editor, content]);
	if (!editor) return <div className="min-h-12" />;
	const tools = [
		["Bold", Bold, () => editor.chain().focus().toggleBold().run()],
		["Italic", Italic, () => editor.chain().focus().toggleItalic().run()],
		[
			"Bullet list",
			List,
			() => editor.chain().focus().toggleBulletList().run(),
		],
		[
			"Numbered list",
			ListOrdered,
			() => editor.chain().focus().toggleOrderedList().run(),
		],
		[
			"Edit text link",
			Link2,
			() => {
				setUrl(editor.getAttributes("link").href || "");
				setLinkOpen(!linkOpen);
				setError("");
			},
		],
		[
			"Remove text link",
			Unlink,
			() => editor.chain().focus().unsetLink().run(),
		],
	];
	return (
		<div>
			<div
				className="mb-3 flex flex-wrap gap-1 rounded-lg bg-muted p-1"
				role="toolbar"
				aria-label="Text formatting"
			>
				{tools.map(([label, Icon, action]) => (
					<Button
						key={label}
						type="button"
						size="icon-sm"
						variant="ghost"
						aria-label={label}
						title={label}
						onMouseDown={(event) => event.preventDefault()}
						onClick={action}
					>
						<Icon />
					</Button>
				))}
			</div>
			{linkOpen && (
				<div className="mb-3 space-y-2 rounded-lg bg-muted p-2">
					<Input
						aria-label="Text link URL"
						placeholder="https://"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
					/>
					<Button
						type="button"
						size="sm"
						onClick={() => {
							const safe = safeEmailUrl(url);
							if (!safe) return setError("Enter a full HTTPS or email link");
							editor
								.chain()
								.focus()
								.extendMarkRange("link")
								.setLink({ href: safe })
								.run();
							setLinkOpen(false);
						}}
					>
						Apply link
					</Button>
					{error && (
						<p role="alert" className="text-xs text-destructive">
							{error}
						</p>
					)}
				</div>
			)}
			<EditorContent editor={editor} />
		</div>
	);
}
