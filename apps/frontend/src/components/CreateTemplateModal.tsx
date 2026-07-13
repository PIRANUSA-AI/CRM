import { useState } from 'react'
import { X, Plus, Trash2, Send } from 'lucide-react'

type TemplateCategory = 'MARKETING' | 'UTILITY' | 'AUTHENTICATION'
type TemplateLanguage = 'en_US' | 'id_ID'
type HeaderType = 'NONE' | 'TEXT'

interface ButtonComponent {
	type: 'QUICK_REPLY' | 'URL'
	text: string
	url?: string
}

interface CreateTemplateModalProps {
	onClose: () => void
	onSuccess: (data: any) => void
}

export function CreateTemplateModal({
	onClose,
	onSuccess,
}: CreateTemplateModalProps) {
	const [name, setName] = useState('')
	const [category, setCategory] = useState<TemplateCategory>('MARKETING')
	const [language, setLanguage] = useState<TemplateLanguage>('en_US')
	const [headerType, setHeaderType] = useState<HeaderType>('NONE')
	const [headerText, setHeaderText] = useState('')
	const [bodyText, setBodyText] = useState('')
	const [footerText, setFooterText] = useState('')
	const [buttons, setButtons] = useState<ButtonComponent[]>([])

	const [submitting, setSubmitting] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const handleAddButton = () => {
		if (buttons.length >= 3) return
		setButtons([...buttons, { type: 'QUICK_REPLY', text: '' }])
	}

	const handleUpdateButton = (
		index: number,
		field: keyof ButtonComponent,
		value: string,
	) => {
		const newButtons = [...buttons]
		newButtons[index] = { ...newButtons[index], [field]: value }
		setButtons(newButtons)
	}

	const handleRemoveButton = (index: number) => {
		setButtons(buttons.filter((_, i) => i !== index))
	}

	const handleSubmit = async () => {
		setError(null)
		if (!name.trim()) {
			setError('Template name is required')
			return
		}
		if (!bodyText.trim()) {
			setError('Body text is required')
			return
		}

		setSubmitting(true)

		try {
			// Construct components array
			const components: any[] = []

			// Header
			if (headerType === 'TEXT' && headerText) {
				components.push({
					type: 'HEADER',
					format: 'TEXT',
					text: headerText,
				})
			}

			// Body
			components.push({
				type: 'BODY',
				text: bodyText,
			})

			// Footer
			if (footerText) {
				components.push({
					type: 'FOOTER',
					text: footerText,
				})
			}

			// Buttons
			if (buttons.length > 0) {
				components.push({
					type: 'BUTTONS',
					buttons: buttons.map((btn) => {
						if (btn.type === 'QUICK_REPLY') {
							return { type: 'QUICK_REPLY', text: btn.text }
						} else {
							// For MVP mostly supporting Quick Reply or basic URL
							return { type: 'URL', text: btn.text, url: btn.url }
						}
					}),
				})
			}

			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'

			const response = await fetch(`${API_URL}/api/whatsapp/templates`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					name,
					category,
					language,
					components,
				}),
			})

			const data = await response.json()

			if (!response.ok) {
				throw new Error(data.error || 'Failed to create template')
			}

			onSuccess(data)
			onClose()
		} catch (err: any) {
			console.error('Submit error:', err)
			setError(err.message || 'Something went wrong')
		} finally {
			setSubmitting(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 overflow-y-auto">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-2xl my-8 flex flex-col max-h-[90vh]">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
					<div>
						<h2 className="text-xl font-bold text-gray-900">
							Create Message Template
						</h2>
						<p className="text-gray-500 text-sm">
							Design your WhatsApp message template
						</p>
					</div>
					<button
						onClick={onClose}
						className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
					>
						<X size={24} />
					</button>
				</div>

				{/* Form Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3 space-y-6">
					{error && (
						<div className="p-3 bg-red-50 text-red-700 rounded-lg text-sm border border-red-200">
							{error}
						</div>
					)}

					{/* Basic Info */}
					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2">
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Template Name
							</label>
							<input
								type="text"
								value={name}
								onChange={(e) =>
									setName(e.target.value.toLowerCase().replace(/\s+/g, '_'))
								}
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-gray-50 font-mono text-sm"
								placeholder="e.g. welcome_message"
							/>
							<p className="mt-1 text-xs text-gray-500">
								Lowercase, underscores only.
							</p>
						</div>

						<div>
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Category
							</label>
							<select
								value={category}
								onChange={(e) =>
									setCategory(e.target.value as TemplateCategory)
								}
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
							>
								<option value="MARKETING">Marketing</option>
								<option value="UTILITY">Utility</option>
								<option value="AUTHENTICATION">Authentication</option>
							</select>
						</div>

						<div>
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Language
							</label>
							<select
								value={language}
								onChange={(e) =>
									setLanguage(e.target.value as TemplateLanguage)
								}
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 bg-white"
							>
								<option value="en_US">English (US)</option>
								<option value="id_ID">Indonesian</option>
							</select>
						</div>
					</div>

					<div className="h-px bg-gray-200" />

					{/* Components */}
					<div className="space-y-4">
						<h3 className="font-semibold text-gray-900">Message Content</h3>

						{/* Header */}
						<div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
							<div className="flex items-center justify-between mb-2">
								<label className="text-sm font-medium text-gray-700">
									Header (Optional)
								</label>
								<select
									value={headerType}
									onChange={(e) => setHeaderType(e.target.value as HeaderType)}
									className="text-sm border-gray-300 rounded-md focus:ring-emerald-500 focus:border-emerald-500"
								>
									<option value="NONE">None</option>
									<option value="TEXT">Text</option>
								</select>
							</div>
							{headerType === 'TEXT' && (
								<input
									type="text"
									value={headerText}
									onChange={(e) => setHeaderText(e.target.value)}
									className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
									placeholder="Enter header text..."
									maxLength={60}
								/>
							)}
						</div>

						{/* Body - REQUIRED */}
						<div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
							<label className="block text-sm font-medium text-gray-700 mb-2">
								Body Text *
							</label>
							<textarea
								value={bodyText}
								onChange={(e) => setBodyText(e.target.value)}
								rows={4}
								className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
								placeholder="Enter your message text here... Use {{1}}, {{2}} for variables."
								maxLength={1024}
							/>
							<p className="mt-1 text-xs text-gray-500 text-right">
								{bodyText.length}/1024
							</p>
						</div>

						{/* Footer */}
						<div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
							<label className="block text-sm font-medium text-gray-700 mb-2">
								Footer (Optional)
							</label>
							<input
								type="text"
								value={footerText}
								onChange={(e) => setFooterText(e.target.value)}
								className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
								placeholder="Enter footer text..."
								maxLength={60}
							/>
						</div>

						{/* Buttons */}
						<div className="bg-gray-50 p-4 rounded-lg border border-gray-200">
							<div className="flex items-center justify-between mb-3">
								<label className="text-sm font-medium text-gray-700">
									Buttons (Optional)
								</label>
								<button
									onClick={handleAddButton}
									disabled={buttons.length >= 3}
									className="text-xs flex items-center gap-1 text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
								>
									<Plus size={14} /> Add Button
								</button>
							</div>

							<div className="space-y-3">
								{buttons.map((btn, idx) => (
									<div key={idx} className="flex gap-2">
										<select
											value={btn.type}
											onChange={(e) =>
												handleUpdateButton(idx, 'type', e.target.value as any)
											}
											className="w-32 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
										>
											<option value="QUICK_REPLY">Quick Reply</option>
											<option value="URL">URL</option>
										</select>
										<input
											type="text"
											value={btn.text}
											onChange={(e) =>
												handleUpdateButton(idx, 'text', e.target.value)
											}
											className="flex-1 px-2 py-1.5 text-sm border border-gray-300 rounded-md"
											placeholder="Button text"
											maxLength={25}
										/>
										<button
											onClick={() => handleRemoveButton(idx)}
											className="p-1.5 text-gray-400 hover:text-red-500"
										>
											<Trash2 size={16} />
										</button>
									</div>
								))}
								{buttons.length === 0 && (
									<p className="text-xs text-gray-400 italic">
										No buttons added.
									</p>
								)}
							</div>
						</div>
					</div>
				</div>

				{/* Footer Actions */}
				<div className="px-6 py-4 border-t border-gray-200 flex justify-end gap-3 bg-gray-50 rounded-b-xl">
					<button
						onClick={onClose}
						className="px-4 py-2 text-gray-700 hover:bg-gray-200 rounded-lg text-sm font-medium transition"
					>
						Cancel
					</button>
					<button
						onClick={handleSubmit}
						disabled={submitting}
						className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition disabled:opacity-70 disabled:cursor-not-allowed"
					>
						<Send size={16} />
						{submitting ? 'Submitting...' : 'Submit Template'}
					</button>
				</div>
			</div>
		</div>
	)
}
