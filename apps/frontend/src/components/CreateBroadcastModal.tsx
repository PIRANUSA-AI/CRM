import { useState, useEffect } from 'react'
import {
	X,
	Send,
	Users,
	Calendar,
	MessageSquare,
	LayoutTemplate,
	Loader2,
} from 'lucide-react'
import { broadcasts as broadcastsApi, whatsappTemplates } from '@/lib/api'
import { toast } from 'sonner'

interface CreateBroadcastModalProps {
	onClose: () => void
	onSuccess: () => void
}

export function CreateBroadcastModal({
	onClose,
	onSuccess,
}: CreateBroadcastModalProps) {
	const [title, setTitle] = useState('')
	const [messageType, setMessageType] = useState<'text' | 'template'>('text')
	const [messageContent, setMessageContent] = useState('')
	const [scheduledAt, setScheduledAt] = useState('')

	const [templates, setTemplates] = useState<any[]>([])
	const [selectedTemplate, setSelectedTemplate] = useState<string>('')
	const [loadingTemplates, setLoadingTemplates] = useState(false)
	const [submitting, setSubmitting] = useState(false)

	useEffect(() => {
		if (messageType === 'template') {
			fetchTemplates()
		}
	}, [messageType])

	const fetchTemplates = async () => {
		setLoadingTemplates(true)
		try {
			const res = await whatsappTemplates.list('APPROVED')
			if (res.success) {
				setTemplates(res.data || [])
			}
		} catch (e) {
			console.error('Failed to fetch templates', e)
		} finally {
			setLoadingTemplates(false)
		}
	}

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()

		if (!title.trim()) {
			toast.error('Title is required')
			return
		}

		if (messageType === 'text' && !messageContent.trim()) {
			toast.error('Message content is required')
			return
		}

		if (messageType === 'template' && !selectedTemplate) {
			toast.error('Please select a template')
			return
		}

		setSubmitting(true)

		try {
			const res = await broadcastsApi.create({
				title,
				message_type: messageType,
				message_content: messageType === 'text' ? messageContent : '',
				template_name:
					messageType === 'template' ? selectedTemplate : undefined,
				scheduled_at: scheduledAt || undefined,
				target_audience: { type: 'all' }, // Default for MVP
			})

			if (res.success) {
				toast.success('Broadcast created successfully')
				onSuccess()
				onClose()
			}
		} catch (err: any) {
			toast.error(err.message || 'Failed to create broadcast')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4 overflow-y-auto">
			<div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg my-8 flex flex-col max-h-[90vh] animate-in fade-in zoom-in duration-200">
				{/* Header */}
				<div className="px-8 py-6 border-b border-gray-100 flex items-center justify-between sticky top-0 bg-white rounded-t-2xl z-10">
					<div>
						<h2 className="text-xl font-bold text-gray-900">New Broadcast</h2>
						<p className="text-sm text-gray-500">
							Reach your customers at scale
						</p>
					</div>
					<button
						onClick={onClose}
						className="p-2 text-gray-400 hover:text-gray-600 rounded-xl hover:bg-gray-100 transition"
					>
						<X size={20} />
					</button>
				</div>

				{/* Form */}
				<form
					onSubmit={handleSubmit}
					className="flex-1 overflow-y-auto p-8 space-y-6"
				>
					{/* Title */}
					<div className="space-y-2">
						<label className="text-xs font-black uppercase tracking-widest text-gray-400">
							Broadcast Title
						</label>
						<input
							type="text"
							value={title}
							onChange={(e) => setTitle(e.target.value)}
							placeholder="e.g., Monthly Newsletter - Jan 2026"
							className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
							required
						/>
					</div>

					{/* Message Type */}
					<div className="space-y-3">
						<label className="text-xs font-black uppercase tracking-widest text-gray-400">
							Message Type
						</label>
						<div className="grid grid-cols-2 gap-3">
							<button
								type="button"
								onClick={() => setMessageType('text')}
								className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all font-bold text-sm ${
									messageType === 'text'
										? 'border-emerald-500 bg-emerald-50 text-emerald-700'
										: 'border-gray-100 hover:border-gray-200 text-gray-400'
								}`}
							>
								<MessageSquare size={18} />
								Custom Text
							</button>
							<button
								type="button"
								onClick={() => setMessageType('template')}
								className={`flex items-center justify-center gap-2 p-3 rounded-xl border-2 transition-all font-bold text-sm ${
									messageType === 'template'
										? 'border-emerald-500 bg-emerald-50 text-emerald-700'
										: 'border-gray-100 hover:border-gray-200 text-gray-400'
								}`}
							>
								<LayoutTemplate size={18} />
								Template
							</button>
						</div>
					</div>

					{/* Dynamic Content */}
					{messageType === 'text' ? (
						<div className="space-y-2">
							<label className="text-xs font-black uppercase tracking-widest text-gray-400">
								Message Content
							</label>
							<textarea
								value={messageContent}
								onChange={(e) => setMessageContent(e.target.value)}
								placeholder="Type your message here..."
								rows={4}
								className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium resize-none shadow-inner"
								required
							/>
							<p className="text-[10px] text-gray-400 font-medium">
								Use custom text for non-template notifications.
							</p>
						</div>
					) : (
						<div className="space-y-2">
							<label className="text-xs font-black uppercase tracking-widest text-gray-400">
								Select Template
							</label>
							{loadingTemplates ? (
								<div className="flex items-center gap-2 text-sm text-gray-500 p-3 italic">
									<Loader2 size={16} className="animate-spin" />
									Loading templates...
								</div>
							) : (
								<select
									value={selectedTemplate}
									onChange={(e) => setSelectedTemplate(e.target.value)}
									className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium appearance-none cursor-pointer"
									required
								>
									<option value="">Choose a WhatsApp template...</option>
									{templates.map((t) => (
										<option key={t.id} value={t.name}>
											{t.name} ({t.language})
										</option>
									))}
								</select>
							)}
						</div>
					)}

					{/* Schedule */}
					<div className="space-y-2">
						<label className="text-xs font-black uppercase tracking-widest text-gray-400">
							Schedule (Optional)
						</label>
						<div className="relative">
							<Calendar
								className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								size={16}
							/>
							<input
								type="datetime-local"
								value={scheduledAt}
								onChange={(e) => setScheduledAt(e.target.value)}
								className="w-full pl-10 pr-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 focus:border-emerald-500 transition-all font-medium"
							/>
						</div>
						<p className="text-[10px] text-gray-400 font-medium">
							Leave empty to send immediately after creation.
						</p>
					</div>

					{/* Audience */}
					<div className="p-4 bg-emerald-50 rounded-xl border border-emerald-100 flex items-center gap-4">
						<div className="p-2 bg-emerald-500 text-white rounded-lg">
							<Users size={18} />
						</div>
						<div className="flex-1">
							<p className="text-xs font-bold text-emerald-900">
								Target Audience: All Contacts
							</p>
							<p className="text-[10px] text-emerald-600 font-medium leading-tight">
								For MVP, this will be sent to all contacts in your database for
								this app.
							</p>
						</div>
					</div>

					{/* Footer Actions */}
					<div className="flex items-center gap-3 pt-4 sticky bottom-0 bg-white">
						<button
							type="button"
							onClick={onClose}
							className="flex-1 px-6 py-3 border border-gray-200 text-gray-600 rounded-xl hover:bg-gray-50 transition-colors font-bold text-sm"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={submitting}
							className="flex-3 px-8 py-3 bg-emerald-500 text-white rounded-xl hover:bg-emerald-600 transition-all font-bold text-sm shadow-lg shadow-emerald-200/50 flex items-center justify-center gap-2 disabled:opacity-50"
						>
							{submitting ? (
								<>
									<Loader2 size={18} className="animate-spin" />
									Creating...
								</>
							) : (
								<>
									<Send size={18} />
									Create Broadcast
								</>
							)}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
