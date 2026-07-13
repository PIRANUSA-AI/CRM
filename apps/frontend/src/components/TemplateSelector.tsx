import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Loader2, Search, X } from 'lucide-react'
import { whatsappTemplates } from '@/lib/api'
import { randomId } from '@/lib/id'

export type WhatsAppTemplateOption = {
	id: string
	name: string
	status: string
	category: string
	language: string
	components: Array<Record<string, any>>
}

interface TemplateSelectorProps {
	inboxId?: string | null
	onSend: (template: WhatsAppTemplateOption) => Promise<void>
	onClose: () => void
}

function mapTemplate(input: any): WhatsAppTemplateOption {
	return {
		id: String(input?.id || randomId()),
		name: String(input?.name || 'template'),
		status: String(input?.status || 'UNKNOWN').toUpperCase(),
		category: String(input?.category || 'UTILITY').toUpperCase(),
		language: String(input?.language || input?.locale || 'en_US'),
		components: Array.isArray(input?.components) ? input.components : [],
	}
}

function findComponent(
	components: Array<Record<string, any>>,
	type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS',
) {
	return (
		components.find(
			(component) => String(component?.type || '').toUpperCase() === type,
		) || null
	)
}

function extractBodyText(template: WhatsAppTemplateOption | null) {
	if (!template) return ''
	const body = findComponent(template.components, 'BODY')
	return typeof body?.text === 'string' && body.text.trim().length > 0
		? body.text.trim()
		: `Template: ${template.name}`
}

function extractHeaderText(template: WhatsAppTemplateOption | null) {
	if (!template) return ''
	const header = findComponent(template.components, 'HEADER')
	return typeof header?.text === 'string' ? header.text.trim() : ''
}

function extractFooterText(template: WhatsAppTemplateOption | null) {
	if (!template) return ''
	const footer = findComponent(template.components, 'FOOTER')
	return typeof footer?.text === 'string' ? footer.text.trim() : ''
}

function extractButtons(template: WhatsAppTemplateOption | null) {
	if (!template) return []
	const buttons = findComponent(template.components, 'BUTTONS')
	return Array.isArray(buttons?.buttons)
		? buttons.buttons
				.map((button: any) => String(button?.text || '').trim())
				.filter(Boolean)
		: []
}

function hasTemplateVariables(template: WhatsAppTemplateOption | null) {
	if (!template) return false
	try {
		return /\{\{\s*\d+\s*\}\}/.test(JSON.stringify(template.components || []))
	} catch {
		return false
	}
}

export function TemplateSelector({
	inboxId,
	onSend,
	onClose,
}: TemplateSelectorProps) {
	const [templates, setTemplates] = useState<WhatsAppTemplateOption[]>([])
	const [loading, setLoading] = useState(true)
	const [search, setSearch] = useState('')
	const [selectedTemplateId, setSelectedTemplateId] = useState('')
	const [error, setError] = useState<string | null>(null)
	const [sending, setSending] = useState(false)

	useEffect(() => {
		let active = true

		const loadTemplates = async () => {
			if (!inboxId) {
				setTemplates([])
				setSelectedTemplateId('')
				setError('Inbox WhatsApp untuk conversation ini belum tersedia.')
				setLoading(false)
				return
			}

			setLoading(true)
			setError(null)
			try {
				const response = await whatsappTemplates.list('APPROVED', undefined, {
					inboxId,
				})
				if (!active) return

				const nextTemplates = Array.isArray(response?.data)
					? response.data.map(mapTemplate)
					: []
				setTemplates(nextTemplates)
				setSelectedTemplateId(nextTemplates[0]?.id || '')
			} catch (loadError) {
				if (!active) return
				setTemplates([])
				setSelectedTemplateId('')
				setError(
					loadError instanceof Error
						? loadError.message
						: 'Gagal memuat template WhatsApp',
				)
			} finally {
				if (active) setLoading(false)
			}
		}

		loadTemplates()
		return () => {
			active = false
		}
	}, [inboxId])

	const filteredTemplates = useMemo(() => {
		const keyword = search.trim().toLowerCase()
		if (!keyword) return templates
		return templates.filter((template) => {
			const haystack = [
				template.name,
				template.category,
				template.language,
				extractBodyText(template),
			]
				.join(' ')
				.toLowerCase()
			return haystack.includes(keyword)
		})
	}, [search, templates])

	const selectedTemplate = useMemo(
		() =>
			templates.find((template) => template.id === selectedTemplateId) || null,
		[selectedTemplateId, templates],
	)

	const selectedTemplateHasVariables = useMemo(
		() => hasTemplateVariables(selectedTemplate),
		[selectedTemplate],
	)

	const handleConfirm = async () => {
		if (!selectedTemplate || sending || selectedTemplateHasVariables) return

		setSending(true)
		setError(null)
		try {
			await onSend(selectedTemplate)
			onClose()
		} catch (sendError) {
			setError(
				sendError instanceof Error
					? sendError.message
					: 'Gagal mengirim template',
			)
		} finally {
			setSending(false)
		}
	}

	const headerText = extractHeaderText(selectedTemplate)
	const bodyText = extractBodyText(selectedTemplate)
	const footerText = extractFooterText(selectedTemplate)
	const buttons = extractButtons(selectedTemplate)

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="flex max-h-[80vh] w-full max-w-2xl flex-col rounded-xl bg-white shadow-xl">
				<div className="flex items-center justify-between border-b border-gray-200 p-4">
					<h2 className="text-lg font-semibold text-gray-900">
						Select Template
					</h2>
					<button
						type="button"
						onClick={onClose}
						className="rounded-lg p-1 hover:bg-gray-100"
						disabled={sending}
					>
						<X size={20} className="text-gray-500" />
					</button>
				</div>

				<div className="flex flex-1 overflow-hidden">
					<div className="flex w-1/2 flex-col border-r border-gray-200">
						<div className="border-b border-gray-200 p-3">
							<div className="relative">
								<Search
									size={16}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								/>
								<input
									type="text"
									placeholder="Search templates..."
									value={search}
									onChange={(event) => setSearch(event.target.value)}
									className="w-full rounded-lg border border-gray-200 py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20"
								/>
							</div>
						</div>

						<div className="flex-1 overflow-y-auto p-2">
							{loading ? (
								<div className="flex justify-center p-4">
									<Loader2
										size={24}
										className="animate-spin text-emerald-600"
									/>
								</div>
							) : error && templates.length === 0 ? (
								<div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
									{error}
								</div>
							) : filteredTemplates.length === 0 ? (
								<div className="p-4 text-center text-sm text-gray-500">
									No templates found
								</div>
							) : (
								<div className="space-y-1">
									{filteredTemplates.map((template) => (
										<button
											type="button"
											key={template.id}
											onClick={() => setSelectedTemplateId(template.id)}
											className={`w-full rounded-lg border p-3 text-left text-sm transition-colors ${
												selectedTemplate?.id === template.id
													? 'border-emerald-200 bg-emerald-50'
													: 'border-transparent hover:bg-gray-50'
											}`}
										>
											<div className="font-medium text-gray-900">
												{template.name}
											</div>
											<div className="mt-1 text-xs text-gray-500">
												{template.category.toLowerCase()}
											</div>
										</button>
									))}
								</div>
							)}
						</div>
					</div>

					<div className="flex w-1/2 flex-col bg-gray-50 p-4">
						<div className="mb-2 text-xs font-medium uppercase tracking-wider text-gray-500">
							Preview
						</div>

						{selectedTemplate ? (
							<div className="flex-1">
								<div className="mx-auto max-w-sm rounded-lg border border-gray-200 bg-white p-4 shadow-sm">
									{headerText ? (
										<div className="mb-2 font-bold text-gray-900">
											{headerText}
										</div>
									) : null}

									<p className="whitespace-pre-wrap text-sm text-gray-800">
										{bodyText}
									</p>

									{footerText ? (
										<div className="mt-2 border-t border-gray-100 pt-2 text-xs text-gray-400">
											{footerText}
										</div>
									) : null}

									{buttons.length > 0 ? (
										<div className="mt-2 space-y-1">
											{buttons.map((button, index) => (
												<div
													key={`${button}-${index}`}
													className="w-full rounded border border-gray-100 bg-gray-50 py-2 text-center text-sm font-medium text-emerald-600"
												>
													{button}
												</div>
											))}
										</div>
									) : null}
								</div>
							</div>
						) : (
							<div className="flex flex-1 items-center justify-center text-sm text-gray-400">
								Select a template to preview
							</div>
						)}
					</div>
				</div>

				<div className="flex items-center justify-between gap-3 border-t border-gray-200 p-4">
					<div className="min-h-5 flex-1">
						{selectedTemplateHasVariables ? (
							<div className="flex items-start gap-2 text-sm text-amber-700">
								<AlertCircle size={16} className="mt-0.5 shrink-0" />
								<span>
									Template ini punya variabel dinamis dan belum bisa diisi dari
									modal chat ini.
								</span>
							</div>
						) : error && templates.length > 0 ? (
							<div className="flex items-start gap-2 text-sm text-red-700">
								<AlertCircle size={16} className="mt-0.5 shrink-0" />
								<span>{error}</span>
							</div>
						) : null}
					</div>

					<div className="flex justify-end gap-2">
						<button
							type="button"
							onClick={onClose}
							className="rounded-lg px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-100"
							disabled={sending}
						>
							Cancel
						</button>
						<button
							type="button"
							onClick={handleConfirm}
							disabled={
								!selectedTemplate ||
								sending ||
								loading ||
								selectedTemplateHasVariables
							}
							className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
						>
							{sending ? <Loader2 size={16} className="animate-spin" /> : null}
							Send Template
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
