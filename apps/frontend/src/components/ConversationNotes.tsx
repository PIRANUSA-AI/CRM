import { useState, useEffect } from 'react'
import { StickyNote, Plus, Trash2, Loader2, X } from 'lucide-react'
import { conversations as conversationsApi } from '@/lib/api'
import ReactQuill from 'react-quill'
import 'react-quill/dist/quill.snow.css'

interface Note {
	id: string
	content: string
	created_at: string
	user_id: string
	userName?: string
}

interface ConversationNotesProps {
	conversationId: string
	compact?: boolean
}

export function ConversationNotes({
	conversationId,
	compact = false,
}: ConversationNotesProps) {
	const [notes, setNotes] = useState<Note[]>([])
	const [newNote, setNewNote] = useState('')
	const [loading, setLoading] = useState(false)
	const [submitting, setSubmitting] = useState(false)
	const [isModalOpen, setIsModalOpen] = useState(false)

	useEffect(() => {
		loadNotes()
	}, [conversationId])

	const loadNotes = async () => {
		setLoading(true)
		try {
			const data: any = await conversationsApi.getNotes(conversationId)
			if (data.success) {
				setNotes(data.payload || [])
			}
		} catch (e) {
			console.error('Failed to load notes:', e)
		} finally {
			setLoading(false)
		}
	}

	const handleAddNote = async () => {
		if (!newNote.trim() || newNote === '<p><br></p>') return

		setSubmitting(true)
		try {
			const data: any = await conversationsApi.addNote(conversationId, newNote)
			if (data.success) {
				setNotes([data.payload, ...notes])
				setNewNote('')
				setIsModalOpen(false)
			}
		} catch (e) {
			alert('Failed to add note')
		} finally {
			setSubmitting(false)
		}
	}

	const handleDeleteNote = async (noteId: string) => {
		if (!confirm('Are you sure you want to delete this note?')) return

		try {
			const data: any = await conversationsApi.deleteNote(noteId)
			if (data.success) {
				setNotes(notes.filter((n) => n.id !== noteId))
			}
		} catch (e) {
			alert('Failed to delete note')
		}
	}

	return (
		<div className={`${compact ? 'p-4' : 'p-6'} border-t border-gray-100`}>
			<div
				className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}
			>
				<div className="flex items-center gap-2">
					<StickyNote className="w-4 h-4 text-amber-500" />
					<h5 className="text-sm font-semibold text-gray-900">
						Internal Notes
					</h5>
				</div>
				<button
					onClick={() => setIsModalOpen(true)}
					className="text-xs flex items-center gap-1 bg-amber-50 text-amber-600 px-2 py-1.5 rounded-lg hover:bg-amber-100 transition-colors font-medium"
				>
					<Plus className="w-3 h-3" />
					Add Note
				</button>
			</div>

				<div
					className={`${compact ? 'space-y-2 max-h-48' : 'space-y-3 max-h-60'} overflow-y-auto pr-1`}
				>
				{loading ? (
					<div className="flex justify-center py-4">
						<Loader2 className="w-5 h-5 animate-spin text-gray-300" />
					</div>
				) : notes.length === 0 ? (
					<p className="text-xs text-center text-gray-400 py-4 font-medium italic">
						No internal notes yet.
					</p>
				) : (
						notes.map((note) => (
							<div
								key={note.id}
								className={`group bg-amber-50/30 ${compact ? 'p-2.5' : 'p-3'} rounded-xl border border-transparent hover:border-amber-100 transition-all`}
							>
							<div className="flex justify-between items-start mb-1.5">
								<span className="text-[10px] font-bold text-amber-600 uppercase tracking-wider">
									{note.userName || 'Agent'}
								</span>
								<div className="flex items-center gap-2">
									<span className="text-[10px] text-gray-400 font-medium">
										{new Date(note.created_at).toLocaleDateString('id-ID', {
											day: 'numeric',
											month: 'short',
											hour: '2-digit',
											minute: '2-digit',
										})}
									</span>
									<button
										onClick={() => handleDeleteNote(note.id)}
										className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-50 rounded transition-all"
									>
										<Trash2 className="w-3 h-3 text-red-400 hover:text-red-500" />
									</button>
								</div>
							</div>
							<div
								className="text-xs text-gray-700 leading-relaxed prose prose-sm max-w-none prose-p:my-0 prose-ul:my-0 prose-ol:my-0 prose-ul:list-none prose-ol:list-none prose-ul:pl-0 prose-ol:pl-0"
								dangerouslySetInnerHTML={{ __html: note.content }}
							/>
						</div>
					))
				)}
			</div>

			{/* Modal */}
			{isModalOpen && (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm animate-in fade-in duration-200"
					style={{ zIndex: 9999 }}
				>
					<div className="bg-white rounded-xl shadow-xl w-full max-w-lg overflow-hidden animate-in zoom-in-95 duration-200">
						<div className="flex items-center justify-between p-4 border-b border-gray-100">
							<h3 className="font-semibold text-gray-900">Add Internal Note</h3>
							<button
								onClick={() => setIsModalOpen(false)}
								className="p-1 hover:bg-gray-100 rounded-full text-gray-500 transition-colors"
							>
								<X className="w-5 h-5" />
							</button>
						</div>
						<div className="p-4">
							<div className="mb-4">
								<ReactQuill
									theme="snow"
									value={newNote}
									onChange={setNewNote}
									className="h-32 mb-10"
									placeholder="Type your note here..."
									modules={{
										toolbar: [
											['bold', 'italic', 'underline', 'strike'],
											[{ list: 'ordered' }, { list: 'bullet' }],
											['clean'],
										],
									}}
								/>
							</div>
							<div className="flex justify-end gap-2 mt-8 pt-4 border-t border-gray-50">
								<button
									onClick={() => setIsModalOpen(false)}
									className="px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 rounded-lg transition-colors"
								>
									Cancel
								</button>
								<button
									onClick={handleAddNote}
									disabled={
										submitting || !newNote.trim() || newNote === '<p><br></p>'
									}
									className="px-4 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 active:bg-amber-700 transition-colors disabled:opacity-50 flex items-center gap-2"
								>
									{submitting && <Loader2 className="w-3 h-3 animate-spin" />}
									Save Note
								</button>
							</div>
						</div>
					</div>
					{/* Backdrop click to close */}
					<div
						className="absolute inset-0 -z-10"
						onClick={() => setIsModalOpen(false)}
					/>
				</div>
			)}
		</div>
	)
}
