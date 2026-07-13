import { useEditor, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Underline from '@tiptap/extension-underline'
import Link from '@tiptap/extension-link'
import Image from '@tiptap/extension-image'
import Placeholder from '@tiptap/extension-placeholder'
import TextAlign from '@tiptap/extension-text-align'
import Highlight from '@tiptap/extension-highlight'
import {
	Bold,
	Italic,
	Underline as UnderlineIcon,
	AlignLeft,
	AlignCenter,
	AlignRight,
	List,
	ListOrdered,
	Link as LinkIcon,
	Image as ImageIcon,
	Quote,
	Undo,
	Redo,
	Code,
	Highlighter,
	Heading1,
	Heading2,
	Heading3,
	RefreshCw,
} from 'lucide-react'
import { useEffect, useState, useRef } from 'react'
import { toast } from 'sonner'
import { media } from '@/lib/api'

interface TiptapEditorProps {
	content: string
	onChange: (content: string) => void
	editable?: boolean
}

const TiptapEditor = ({
	content,
	onChange,
	editable = true,
}: TiptapEditorProps) => {
	const [uploading, setUploading] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const editor = useEditor({
		extensions: [
			StarterKit.configure({
				link: false,
				underline: false,
			}),
			Underline,
			Link.configure({
				openOnClick: false,
			}),
			Image.configure({
				allowBase64: true,
				HTMLAttributes: {
					class: 'rounded-lg max-w-full h-auto shadow-md my-4 inline-block',
				},
			}),
			Placeholder.configure({
				placeholder: 'Tulis sesuatu...',
			}),
			TextAlign.configure({
				types: ['heading', 'paragraph'],
			}),
			Highlight,
		],
		content: content,
		editorProps: {
			attributes: {
				class:
					'prose max-w-none px-8 py-6 outline-none min-h-[500px] h-full focus:outline-none cursor-text',
			},
		},
		onUpdate: ({ editor }) => {
			onChange(editor.getHTML())
		},
		editable: editable,
	})

	// Update editor content when props change (only if different to avoid cursor jump)
	useEffect(() => {
		if (editor && content !== editor.getHTML() && !editor.isFocused) {
			editor.commands.setContent(content)
		}
	}, [content, editor])

	if (!editor) {
		return null
	}

	const handleImageUpload = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0]
		if (!file) return

		setUploading(true)
		try {
			const upload = await media.upload(file, 'whatsapp')
			if (upload.success && upload.payload?.url) {
				editor.chain().focus().setImage({ src: upload.payload.url }).run()
				toast.success('Image uploaded')
			} else {
				toast.error(upload.error || 'Failed to upload image')
			}
		} catch (error) {
			console.error('Image upload error:', error)
			toast.error('An error occurred while uploading the image')
		} finally {
			setUploading(false)
			if (fileInputRef.current) fileInputRef.current.value = ''
		}
	}

	const MenuButton = ({
		onClick,
		isActive,
		children,
		disabled = false,
		loading = false,
	}: any) => (
		<button
			type="button"
			onClick={onClick}
			disabled={disabled || loading}
			className={`p-1.5 rounded transition ${
				isActive
					? 'bg-blue-100 text-blue-600'
					: 'text-gray-600 hover:bg-gray-100'
			} ${disabled || loading ? 'opacity-50 cursor-not-allowed' : ''} flex items-center justify-center`}
		>
			{loading ? (
				<RefreshCw className="animate-spin text-blue-500" size={16} />
			) : (
				children
			)}
		</button>
	)

	return (
		<div className="flex flex-col h-full border border-gray-200 rounded-lg overflow-hidden bg-white">
			{/* Hidden File Input */}
			<input
				type="file"
				ref={fileInputRef}
				className="hidden"
				onChange={handleImageUpload}
				accept="image/*"
			/>

			{/* Toolbar */}
			<div className="flex flex-wrap items-center gap-1 p-2 border-b border-gray-200 bg-gray-50/50 sticky top-0 z-20">
				<MenuButton
					onClick={() => editor.chain().focus().undo().run()}
					disabled={!editor.can().undo()}
				>
					<Undo size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().redo().run()}
					disabled={!editor.can().redo()}
				>
					<Redo size={16} />
				</MenuButton>

				<div className="w-px h-4 bg-gray-300 mx-1" />

				<MenuButton
					onClick={() => editor.chain().focus().toggleBold().run()}
					isActive={editor.isActive('bold')}
				>
					<Bold size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().toggleItalic().run()}
					isActive={editor.isActive('italic')}
				>
					<Italic size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().toggleUnderline().run()}
					isActive={editor.isActive('underline')}
				>
					<UnderlineIcon size={16} />
				</MenuButton>

				<div className="w-px h-4 bg-gray-300 mx-1" />

				<MenuButton
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 1 }).run()
					}
					isActive={editor.isActive('heading', { level: 1 })}
				>
					<Heading1 size={16} />
				</MenuButton>
				<MenuButton
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 2 }).run()
					}
					isActive={editor.isActive('heading', { level: 2 })}
				>
					<Heading2 size={16} />
				</MenuButton>
				<MenuButton
					onClick={() =>
						editor.chain().focus().toggleHeading({ level: 3 }).run()
					}
					isActive={editor.isActive('heading', { level: 3 })}
				>
					<Heading3 size={16} />
				</MenuButton>

				<div className="w-px h-4 bg-gray-300 mx-1" />

				<MenuButton
					onClick={() => editor.chain().focus().setTextAlign('left').run()}
					isActive={editor.isActive({ textAlign: 'left' })}
				>
					<AlignLeft size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().setTextAlign('center').run()}
					isActive={editor.isActive({ textAlign: 'center' })}
				>
					<AlignCenter size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().setTextAlign('right').run()}
					isActive={editor.isActive({ textAlign: 'right' })}
				>
					<AlignRight size={16} />
				</MenuButton>

				<div className="w-px h-4 bg-gray-300 mx-1" />

				<MenuButton
					onClick={() => editor.chain().focus().toggleBulletList().run()}
					isActive={editor.isActive('bulletList')}
				>
					<List size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().toggleOrderedList().run()}
					isActive={editor.isActive('orderedList')}
				>
					<ListOrdered size={16} />
				</MenuButton>

				<div className="w-px h-4 bg-gray-300 mx-1" />

				<MenuButton
					onClick={() => editor.chain().focus().toggleBlockquote().run()}
					isActive={editor.isActive('blockquote')}
				>
					<Quote size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().toggleCode().run()}
					isActive={editor.isActive('code')}
				>
					<Code size={16} />
				</MenuButton>
				<MenuButton
					onClick={() => editor.chain().focus().toggleHighlight().run()}
					isActive={editor.isActive('highlight')}
				>
					<Highlighter size={16} />
				</MenuButton>

				<div className="w-px h-4 bg-gray-300 mx-1" />

				<MenuButton
					onClick={() => {
						const url = window.prompt('URL')
						if (url) {
							editor.chain().focus().setLink({ href: url }).run()
						}
					}}
					isActive={editor.isActive('link')}
				>
					<LinkIcon size={16} />
				</MenuButton>

				<MenuButton
					onClick={() => fileInputRef.current?.click()}
					loading={uploading}
				>
					<ImageIcon size={16} />
				</MenuButton>
			</div>

			{/* Editor Content Area */}
			<div className="flex-grow overflow-y-auto bg-white min-h-[500px]">
				<EditorContent editor={editor} />
			</div>

			{/* Character Counter */}
			<div className="px-6 py-2 bg-gray-50/50 border-t border-gray-200 flex justify-end">
				<span className="text-xs text-gray-400 font-medium">
					{editor.storage.characterCount?.characters?.() ||
						editor.getText().length}{' '}
					Characters
				</span>
			</div>
		</div>
	)
}

export default TiptapEditor
