import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	AlertCircle,
	ArrowLeft,
	Bot,
	CalendarDays,
	Check,
	CheckCheck,
	FileText,
	Filter,
	Handshake,
	Link2,
	Loader2,
	MessageCircle,
	MoreHorizontal,
	Paperclip,
	Pin,
	Plus,
	Search,
	Send,
	Smile,
	Sparkles,
	User,
	X,
	Zap,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
	TemplateSelector,
	type WhatsAppTemplateOption,
} from '@/components/TemplateSelector'
import { CrmAvatar } from '@/components/crm/shared'
import { randomId } from '@/lib/id'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import {
	Dialog,
	DialogContent,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
} from '@/components/ui/select'
import {
	agents,
	broadcasts,
	chatbots,
	type ContactDetailSignalTone,
	type ConversationContactDetailResponse,
	contacts,
	conversations,
	inboxes,
	labels,
	media,
	whatsappTemplates,
} from '@/lib/api'
import { getAppIdFromCookie } from '@/lib/organization'
import { connectSocket } from '@/lib/socket'
import { formatChatTime } from '@/lib/timezone'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/chat')({
	validateSearch: (search): ChatSearch => ({
		conversation_id:
			typeof search.conversation_id === 'string'
				? search.conversation_id
				: undefined,
		provider:
			typeof search.provider === 'string'
				? normalizeWhatsappProviderFilter(search.provider)
				: 'all',
	}),
	component: ChatPage,
})

type ChatSearch = {
	conversation_id?: string
	provider?: WhatsAppProviderFilter
}

type ChatStatus = 'ai' | 'human' | 'handover' | 'done'
type ChatFilter = 'all' | 'ai' | 'handover' | 'human' | 'unread'
type WhatsAppProviderFilter = 'all' | 'official' | 'baileys'
type UiWhatsAppProvider = 'official' | 'baileys' | null
type MessageSource = 'api' | 'local'
type MessageFrom = 'customer' | 'ai'
type MessageKind = 'text' | 'image'
type SocketMessageCreatedPayload = {
	message?: Record<string, unknown>
	conversation?: Record<string, unknown>
}

type UiAiAnalytics = {
	confidence: number | null
	intent: string | null
	workflowId: string | null
	workflowName: string | null
	ragLabel: string | null
	ragIntent: string | null
	updatedAt: string | null
	source: MessageSource
}

type ResolvedAiBanner = {
	analytics: UiAiAnalytics
}

type UiConversation = {
	id: string
	backendId: string | null
	inboxId: string | null
	provider: UiWhatsAppProvider
	name: string
	phone: string
	preview: string
	time: string
	unread: number
	status: ChatStatus
	handler: string
	intent: string
	online: boolean
	pinned?: boolean
	aiAnalytics?: UiAiAnalytics | null
	source: MessageSource
}

type UiMessage = {
	id: string
	from: MessageFrom
	kind: MessageKind
	text: string
	createdAt: string
	intent?: string | null
	time: string
	status?: 'read' | 'delivered'
	model?: string
	tokens?: number
	latency?: number
	confidence?: number
	source: MessageSource
}

type ChatSelectOption = {
	id: string
	label: string
}

type ChatInboxOption = ChatSelectOption & {
	provider: UiWhatsAppProvider
}

type ChatPipelineStageOption = ChatSelectOption & {
	color: string | null
}

type AdvancedChatFilters = {
	dateFrom: string
	dateTo: string
	inboxId: string
	labelId: string
	resolvedById: string
	agentId: string
	aiAgentId: string
	status: 'all' | 'open' | 'pending' | 'resolved'
	pipelineStageId: string
}

type NewChatFormState = {
	inboxId: string
	name: string
	phoneNumber: string
	templateId: string
}

type AiSuggestionItem = {
	label: string
	text: string
	intentKey: string
}

const INTENT_SUGGESTION_LIBRARY: Record<string, AiSuggestionItem> = {
	greeting: {
		intentKey: 'greeting',
		label: 'Balas sapaan',
		text: 'Halo Kak, makasih sudah chat kami. Boleh dibantu untuk produk atau kebutuhan apa ya?',
	},
	product: {
		intentKey: 'product',
		label: 'Jelaskan produk',
		text: 'Siap Kak, saya bantu jelaskan detail produknya ya. Kakak mau fokus ke ukuran, bahan, atau varian warna?',
	},
	stock: {
		intentKey: 'stock',
		label: 'Konfirmasi stok',
		text: 'Untuk stok saat ini masih tersedia Kak. Kalau mau, saya cekkan jumlah terbaru sesuai varian yang Kakak pilih.',
	},
	price: {
		intentKey: 'price',
		label: 'Bahas harga/promo',
		text: 'Untuk harga terbaru saya infokan ya Kak, sekalian saya cek promo yang lagi aktif biar dapat penawaran terbaik.',
	},
	shipping: {
		intentKey: 'shipping',
		label: 'Jelaskan pengiriman',
		text: 'Siap Kak, untuk pengiriman kami bisa bantu estimasi ongkir dan waktu kirim sesuai lokasi Kakak.',
	},
	payment: {
		intentKey: 'payment',
		label: 'Arahkan pembayaran',
		text: 'Kalau sudah cocok, saya bisa bantu kirim link pembayaran sekarang ya Kak.',
	},
	invoice: {
		intentKey: 'invoice',
		label: 'Kirim invoice',
		text: 'Siap Kak, saya proses invoice-nya sekarang dan kirimkan link pembayarannya.',
	},
	complaint: {
		intentKey: 'complaint',
		label: 'Tangani komplain',
		text: 'Mohon maaf atas kendalanya Kak, saya bantu tindak lanjuti sekarang supaya cepat selesai.',
	},
	warranty: {
		intentKey: 'warranty',
		label: 'Jelaskan garansi',
		text: 'Untuk garansi produk, saya jelaskan ketentuan dan cakupannya dulu ya Kak supaya jelas.',
	},
	upsell: {
		intentKey: 'upsell',
		label: 'Tawarkan bundling',
		text: 'Kebetulan lagi ada promo Kak, kalau ambil 2 pcs dapat potongan 15% dan free ongkir. Mau saya jelaskan detailnya?',
	},
	urgency: {
		intentKey: 'urgency',
		label: 'Tanyakan urgency',
		text: 'Kalau boleh tau, rencananya butuh dikirim kapan ya Kak? Biar kami prioritaskan.',
	},
	handover: {
		intentKey: 'handover',
		label: 'Escalate ke CS',
		text: 'Sebentar ya Kak, saya hubungkan ke tim sales kami biar bisa bantu lebih detail.',
	},
	general: {
		intentKey: 'general',
		label: 'Gali kebutuhan',
		text: 'Boleh saya tahu kebutuhan utama Kakak dulu supaya saya rekomendasikan opsi yang paling cocok?',
	},
}

const CHAT_MESSAGE_PAGE_SIZE = 10
const CONVERSATION_PAGE_SIZE = 10
const FILTER_SELECT_EMPTY_VALUE = '__all__'
const FILTER_DATE_FORMATTER = new Intl.DateTimeFormat('id-ID', {
	day: '2-digit',
	month: '2-digit',
	year: 'numeric',
})
const FILTER_TRIGGER_CLASSNAME =
	'h-11 w-full rounded-xl border-slate-300 bg-white px-3.5 text-sm text-slate-900 shadow-none transition focus-visible:border-slate-400 focus-visible:ring-0 disabled:cursor-not-allowed disabled:bg-slate-100 disabled:text-slate-400 [&_svg]:text-slate-500'
const FILTER_SELECT_ITEM_CLASSNAME =
	'min-h-9 rounded-lg px-3 py-2 text-sm text-slate-900'
const NEW_CHAT_FIELD_CLASSNAME =
	'h-11 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 text-sm font-medium text-gray-900 outline-none transition placeholder:text-gray-400 focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-500/10 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400'
const DEFAULT_ADVANCED_CHAT_FILTERS: AdvancedChatFilters = {
	dateFrom: '',
	dateTo: '',
	inboxId: '',
	labelId: '',
	resolvedById: '',
	agentId: '',
	aiAgentId: '',
	status: 'all',
	pipelineStageId: '',
}
const DEFAULT_NEW_CHAT_FORM: NewChatFormState = {
	inboxId: '',
	name: '',
	phoneNumber: '',
	templateId: '',
}
const CHAT_STATUS_FILTER_OPTIONS: ChatSelectOption[] = [
	{ id: 'all', label: 'All Statuses' },
	{ id: 'open', label: 'Open' },
	{ id: 'pending', label: 'Pending' },
	{ id: 'resolved', label: 'Resolved' },
]

function inferIntentKeyFromText(text: string): string {
	const normalized = text.toLowerCase()
	if (!normalized.trim()) return 'general'

	if (
		normalized.includes('halo') ||
		normalized.includes('hai') ||
		normalized.includes('pagi') ||
		normalized.includes('siang') ||
		normalized.includes('malam')
	) {
		return 'greeting'
	}
	if (
		normalized.includes('stok') ||
		normalized.includes('ready') ||
		normalized.includes('tersedia')
	) {
		return 'stock'
	}
	if (
		normalized.includes('harga') ||
		normalized.includes('diskon') ||
		normalized.includes('promo') ||
		normalized.includes('murah') ||
		normalized.includes('nego')
	) {
		return 'price'
	}
	if (
		normalized.includes('ongkir') ||
		normalized.includes('kirim') ||
		normalized.includes('pengiriman') ||
		normalized.includes('estimasi')
	) {
		return 'shipping'
	}
	if (
		normalized.includes('bayar') ||
		normalized.includes('transfer') ||
		normalized.includes('pembayaran') ||
		normalized.includes('dp')
	) {
		return 'payment'
	}
	if (normalized.includes('invoice') || normalized.includes('tagihan')) {
		return 'invoice'
	}
	if (
		normalized.includes('garansi') ||
		normalized.includes('warranty') ||
		normalized.includes('klaim')
	) {
		return 'warranty'
	}
	if (
		normalized.includes('komplain') ||
		normalized.includes('rusak') ||
		normalized.includes('retur') ||
		normalized.includes('refund')
	) {
		return 'complaint'
	}
	if (
		normalized.includes('produk') ||
		normalized.includes('varian') ||
		normalized.includes('ukuran') ||
		normalized.includes('warna')
	) {
		return 'product'
	}
	return 'general'
}

function resolveSuggestionByIntent(intentKey: string): AiSuggestionItem {
	return (
		INTENT_SUGGESTION_LIBRARY[intentKey] ||
		INTENT_SUGGESTION_LIBRARY[inferIntentKeyFromText(intentKey)] ||
		INTENT_SUGGESTION_LIBRARY.general
	)
}

function buildAiSuggestions(
	messages: UiMessage[],
	bannerIntent?: string | null,
): AiSuggestionItem[] {
	const intentKeys: string[] = []
	const recentCustomerMessages = messages
		.filter((message) => message.from === 'customer')
		.slice(-5)
		.reverse()

	for (const message of recentCustomerMessages) {
		const inferredIntent = inferIntentKeyFromText(
			`${message.intent || ''} ${message.text || ''}`,
		)
		if (!intentKeys.includes(inferredIntent)) {
			intentKeys.push(inferredIntent)
		}
	}

	const bannerIntentKey = inferIntentKeyFromText(bannerIntent || '')
	if (bannerIntentKey !== 'general' && !intentKeys.includes(bannerIntentKey)) {
		intentKeys.unshift(bannerIntentKey)
	}

	const suggestions = intentKeys.map((intentKey) =>
		resolveSuggestionByIntent(intentKey),
	)

	return suggestions.slice(0, 5)
}

const AI_PLAYGROUND_IDENTIFIER_PREFIX = 'ai-playground-'

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function toArray<T = unknown>(value: unknown): T[] {
	return Array.isArray(value) ? (value as T[]) : []
}

function toText(value: unknown): string {
	if (typeof value === 'string') return value
	if (typeof value === 'number') return String(value)
	return ''
}

function parseFilterDateValue(value: string): Date | undefined {
	const normalized = value.trim()
	if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) return undefined

	const [year, month, day] = normalized.split('-').map(Number)
	const parsedDate = new Date(year, month - 1, day)

	if (
		Number.isNaN(parsedDate.getTime()) ||
		parsedDate.getFullYear() !== year ||
		parsedDate.getMonth() !== month - 1 ||
		parsedDate.getDate() !== day
	) {
		return undefined
	}

	return parsedDate
}

function toFilterDateValue(value: Date | undefined): string {
	if (!(value instanceof Date) || Number.isNaN(value.getTime())) return ''

	const year = value.getFullYear()
	const month = String(value.getMonth() + 1).padStart(2, '0')
	const day = String(value.getDate()).padStart(2, '0')

	return `${year}-${month}-${day}`
}

function formatFilterDateLabel(value: string, placeholder: string): string {
	const parsedDate = parseFilterDateValue(value)
	return parsedDate ? FILTER_DATE_FORMATTER.format(parsedDate) : placeholder
}

type ChatFilterDateFieldProps = {
	label?: string
	value: string
	placeholder: string
	onChange: (value: string) => void
}

function ChatFilterDateField({
	label,
	value,
	placeholder,
	onChange,
}: ChatFilterDateFieldProps) {
	const [open, setOpen] = useState(false)
	const selectedDate = parseFilterDateValue(value)

	return (
		<div className="min-w-0">
			{label ? (
				<p className="mb-3 text-sm font-semibold text-slate-700">{label}</p>
			) : null}
			<Popover open={open} onOpenChange={setOpen}>
				<PopoverTrigger
					render={
						<Button
							type="button"
							variant="outline"
							className={cn(
								FILTER_TRIGGER_CLASSNAME,
								'justify-between font-normal',
								!value && 'text-slate-400',
							)}
						/>
					}
				>
					<span className="truncate text-sm">
						{formatFilterDateLabel(value, placeholder)}
					</span>
					<CalendarDays className="size-4 shrink-0" />
				</PopoverTrigger>
				<PopoverContent
					align="start"
					sideOffset={8}
					className="w-auto rounded-2xl border border-slate-200 bg-white p-0 shadow-xl"
				>
					<div className="border-b border-slate-200 px-4 py-3">
						<p className="text-sm font-semibold text-slate-900">
							{label || placeholder}
						</p>
						<p className="text-xs text-slate-500">{placeholder}</p>
					</div>
					<Calendar
						mode="single"
						selected={selectedDate}
						onSelect={(nextDate) => {
							onChange(toFilterDateValue(nextDate))
							if (nextDate) setOpen(false)
						}}
						className="bg-white"
					/>
					<div className="flex items-center justify-end border-t border-slate-200 px-3 py-3">
						<Button
							type="button"
							variant="ghost"
							size="sm"
							onClick={() => {
								onChange('')
								setOpen(false)
							}}
							disabled={!value}
							className="text-slate-600 hover:text-slate-900"
						>
							Clear
						</Button>
					</div>
				</PopoverContent>
			</Popover>
		</div>
	)
}

type ChatFilterSelectFieldProps = {
	label: string
	value: string
	onChange: (value: string) => void
	placeholder: string
	options: ChatSelectOption[]
	disabled?: boolean
}

function ChatFilterSelectField({
	label,
	value,
	onChange,
	placeholder,
	options,
	disabled = false,
}: ChatFilterSelectFieldProps) {
	const selectedLabel = value
		? options.find((option) => option.id === value)?.label || value
		: placeholder

	return (
		<div className="min-w-0">
			<p className="mb-3 text-sm font-semibold text-slate-700">{label}</p>
			<Select
				value={value || FILTER_SELECT_EMPTY_VALUE}
				onValueChange={(nextValue) =>
					onChange(nextValue === FILTER_SELECT_EMPTY_VALUE ? '' : nextValue)
				}
				disabled={disabled}
			>
				<SelectTrigger className={FILTER_TRIGGER_CLASSNAME}>
					<span
						className={cn(
							'flex flex-1 items-center truncate text-left text-sm',
							!value && 'text-slate-400',
						)}
					>
						{selectedLabel}
					</span>
				</SelectTrigger>
				<SelectContent className="rounded-2xl border border-slate-200 bg-white p-1 shadow-xl">
					<SelectItem
						value={FILTER_SELECT_EMPTY_VALUE}
						className={cn(FILTER_SELECT_ITEM_CLASSNAME, 'text-slate-600')}
					>
						{placeholder}
					</SelectItem>
					{options.map((option) => (
						<SelectItem
							key={option.id}
							value={option.id}
							className={FILTER_SELECT_ITEM_CLASSNAME}
						>
							{option.label}
						</SelectItem>
					))}
				</SelectContent>
			</Select>
		</div>
	)
}

function toFiniteNumber(value: unknown): number | null {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

function normalizeWhatsappProviderFilter(
	value: unknown,
): WhatsAppProviderFilter {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (normalized === 'official') return 'official'
	if (normalized === 'baileys') return 'baileys'
	return 'all'
}

function normalizeUiWhatsappProvider(value: unknown): UiWhatsAppProvider {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (normalized === 'baileys') return 'baileys'
	if (normalized === 'official' || normalized === 'whatsapp_cloud') {
		return 'official'
	}
	return null
}

function matchesWhatsappProviderSelection(
	provider: UiWhatsAppProvider,
	selectedProvider: WhatsAppProviderFilter,
) {
	if (selectedProvider === 'all') return true
	return provider === selectedProvider
}

function normalizeConfidence(value: unknown): number | null {
	const parsed = toFiniteNumber(value)
	if (parsed === null) return null
	const ratio = parsed > 1 && parsed <= 100 ? parsed / 100 : parsed
	const clamped = Math.max(0, Math.min(1, ratio))
	return Number(clamped.toFixed(4))
}

function toNullableText(value: unknown): string | null {
	const normalized = toText(value).trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeMessageText(value: unknown): string {
	if (typeof value === 'string') return value
	if (isRecord(value)) {
		const primary = toText(
			value.text || value.body || value.message || value.caption,
		)
		if (primary) return primary
	}
	return ''
}

function extractTemplateBodyText(components: unknown): string {
	const bodyComponent = toArray<Record<string, unknown>>(components).find(
		(component) => String(component?.type || '').toUpperCase() === 'BODY',
	)
	return toNullableText(bodyComponent?.text) || ''
}

function extractCollectionRows(payload: unknown): Record<string, unknown>[] {
	if (Array.isArray(payload)) {
		return payload.filter((item): item is Record<string, unknown> => isRecord(item))
	}

	if (!isRecord(payload)) return []

	const candidates = [
		payload.data,
		payload.payload,
		payload.results,
		payload.items,
		payload.labels,
		payload.inboxes,
		payload.agents,
		payload.chatbots,
		payload.stages,
	]

	for (const candidate of candidates) {
		const rows = extractCollectionRows(candidate)
		if (rows.length > 0) return rows
	}

	return []
}

function findTemplateComponent(
	components: unknown,
	type: 'HEADER' | 'BODY' | 'FOOTER' | 'BUTTONS',
) {
	return (
		toArray<Record<string, unknown>>(components).find(
			(component) => String(component?.type || '').toUpperCase() === type,
		) || null
	)
}

function extractTemplateHeaderText(components: unknown): string {
	return toNullableText(findTemplateComponent(components, 'HEADER')?.text) || ''
}

function extractTemplateFooterText(components: unknown): string {
	return toNullableText(findTemplateComponent(components, 'FOOTER')?.text) || ''
}

function extractTemplateButtonLabels(components: unknown): string[] {
	const buttons = findTemplateComponent(components, 'BUTTONS')
	const buttonList = toArray<Record<string, unknown>>(buttons?.buttons)
	return buttonList
		.map((button) => toNullableText(button.text))
		.filter((label): label is string => Boolean(label))
}

function extractTemplateVariableKeys(components: unknown): string[] {
	const matches = JSON.stringify(components || []).match(/\{\{\s*(\d+)\s*\}\}/g)
	if (!matches) return []
	return Array.from(
		new Set(
			matches
				.map((match) => match.match(/\d+/)?.[0] || '')
				.filter((value) => value.length > 0),
		),
	).sort((left, right) => Number(left) - Number(right))
}

function renderTemplateText(
	text: string,
	variables: Record<string, string>,
	fallbackValue = 'Customer',
): string {
	if (!text.trim()) return ''
	return text.replace(/\{\{\s*([^}]+)\s*\}\}/g, (_match, rawKey) => {
		const normalizedKey = String(rawKey || '').trim()
		return variables[normalizedKey] || fallbackValue
	})
}

function normalizePhoneForChat(value: string): string {
	const digits = value.replace(/[^\d]/g, '')
	if (!digits) return ''
	if (digits.startsWith('62')) return digits
	if (digits.startsWith('0')) return `62${digits.slice(1)}`
	if (digits.startsWith('8')) return `62${digits}`
	return digits
}

function formatPhoneForInput(value: string): string {
	const normalized = normalizePhoneForChat(value)
	return normalized ? `+${normalized}` : ''
}

function resolveTemplatePreviewText(
	contentAttributes: Record<string, unknown>,
	fallbackContent: unknown,
): string {
	return (
		toNullableText(contentAttributes.template_preview_text) ||
		toNullableText(contentAttributes.preview_text) ||
		extractTemplateBodyText(contentAttributes.components) ||
		normalizeMessageText(fallbackContent)
	)
}

function resolveRenderableMessageText(raw: Record<string, unknown>): string {
	const contentType = toText(raw.content_type).trim().toLowerCase()
	const contentAttributes = isRecord(raw.content_attributes)
		? raw.content_attributes
		: {}

	if (contentType === 'template') {
		return resolveTemplatePreviewText(contentAttributes, raw.content)
	}

	return normalizeMessageText(raw.content)
}

function shouldHideMessageFromChat(raw: Record<string, unknown>): boolean {
	const senderType = toText(raw.sender_type).toLowerCase()
	const contentAttributes = isRecord(raw.content_attributes)
		? raw.content_attributes
		: {}
	const source = toText(contentAttributes.source).toLowerCase()
	const event = toText(contentAttributes.event).toLowerCase()
	const type = toText(contentAttributes.type).toLowerCase()
	const isTrace =
		contentAttributes.trace === true ||
		type === 'flow_trace' ||
		event === 'node_entered'
	const isWorkflowSystemMessage =
		senderType === 'system' && source === 'flow_runtime'
	return isTrace || isWorkflowSystemMessage
}

function isAiPlaygroundConversation(raw: Record<string, unknown>): boolean {
	const contact = isRecord(raw.contacts) ? raw.contacts : {}
	const additionalAttributes = isRecord(raw.additional_attributes)
		? raw.additional_attributes
		: {}
	const customAttributes = isRecord(raw.custom_attributes)
		? raw.custom_attributes
		: {}
	const contactMetadata = isRecord(contact.metadata) ? contact.metadata : {}
	const contactMeta = isRecord(contact.meta) ? contact.meta : {}

	const conversationIdentifier = toText(raw.identifier).trim().toLowerCase()
	const contactIdentifier = toText(contact.identifier).trim().toLowerCase()
	const hasPlaygroundIdentifier =
		conversationIdentifier.startsWith(AI_PLAYGROUND_IDENTIFIER_PREFIX) ||
		contactIdentifier.startsWith(AI_PLAYGROUND_IDENTIFIER_PREFIX)

	if (hasPlaygroundIdentifier) return true

	const sourceCandidates = [
		toText(additionalAttributes.source),
		toText(customAttributes.source),
		toText(contactMetadata.source),
		toText(contactMeta.source),
	]
	return sourceCandidates.some((value) => {
		const normalized = value.trim().toLowerCase()
		return (
			normalized === 'ai_playground' || normalized === 'ai_playground_workflow'
		)
	})
}

function formatConversationClock(value: unknown): string {
	if (!value) return '--:--'
	try {
		return formatChatTime(value as string | Date | number)
	} catch {
		return '--:--'
	}
}

function toConfidenceLabel(value: number | null) {
	if (value === null || !Number.isFinite(value)) return '-'
	return value.toFixed(2)
}

function formatCurrencyIdr(value: number | null | undefined): string {
	const amount = Number.isFinite(Number(value)) ? Number(value) : 0
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		maximumFractionDigits: 0,
	}).format(amount)
}

function formatCurrencyIdrCompact(value: number | null | undefined): string {
	const amount = Number.isFinite(Number(value)) ? Number(value) : 0
	if (Math.abs(amount) >= 1_000_000) {
		const compact = Number((amount / 1_000_000).toFixed(1))
		return `Rp ${compact}jt`
	}
	return formatCurrencyIdr(amount)
}

function resolveSignalTone(value: unknown): ContactDetailSignalTone {
	if (value === 'success') return 'success'
	if (value === 'warning') return 'warning'
	if (value === 'info') return 'info'
	return 'neutral'
}

function parseAiAnalytics(
	value: unknown,
	source: MessageSource,
): UiAiAnalytics | null {
	if (!isRecord(value)) return null

	const workflowId =
		toNullableText(value.workflow_id) ||
		toNullableText(value.workflowId) ||
		toNullableText(value.flow_id)
	const workflowName =
		toNullableText(value.workflow_name) || toNullableText(value.workflowName)
	const ragIntent =
		toNullableText(value.rag_intent) || toNullableText(value.ragIntent)
	const ragLabel =
		toNullableText(value.rag_label) || toNullableText(value.ragLabel)
	const intent = toNullableText(value.intent) || ragIntent
	const confidence = normalizeConfidence(value.confidence)
	const updatedAt =
		toNullableText(value.updated_at) || toNullableText(value.updatedAt)

	const hasAnyData =
		confidence !== null ||
		Boolean(intent || workflowId || workflowName || ragLabel || ragIntent)
	if (!hasAnyData) return null

	return {
		confidence,
		intent,
		workflowId,
		workflowName,
		ragLabel,
		ragIntent,
		updatedAt,
		source,
	}
}

function resolveAiBanner(
	conversation: UiConversation,
	messages: UiMessage[],
): ResolvedAiBanner | null {
	if (conversation.status !== 'ai') return null

	const apiAnalytics = conversation.aiAnalytics

	let latestAiConfidence: number | null = null
	for (let index = messages.length - 1; index >= 0; index -= 1) {
		const item = messages[index]
		if (item.from !== 'ai') continue
		if (
			typeof item.confidence === 'number' &&
			Number.isFinite(item.confidence)
		) {
			latestAiConfidence = Number(item.confidence.toFixed(4))
			break
		}
	}

	const confidence = apiAnalytics?.confidence ?? latestAiConfidence ?? null

	const workflowName =
		apiAnalytics?.workflowName || apiAnalytics?.workflowId || null

	const ragLabel = apiAnalytics?.ragLabel || apiAnalytics?.ragIntent || null
	const intent = apiAnalytics?.intent || conversation.intent || null

	if (confidence === null && !intent && !workflowName && !ragLabel) return null

	const analytics: UiAiAnalytics = {
		confidence,
		intent: intent || null,
		workflowId: apiAnalytics?.workflowId || null,
		workflowName: workflowName || null,
		ragLabel: ragLabel || null,
		ragIntent: apiAnalytics?.ragIntent || null,
		updatedAt: apiAnalytics?.updatedAt || null,
		source: 'api',
	}

	return {
		analytics,
	}
}

function resolveStatus(raw: Record<string, unknown>): ChatStatus {
	const baseStatus = toText(raw.status).toLowerCase()
	if (baseStatus === 'resolved' || baseStatus === 'closed') return 'done'
	if (baseStatus === 'pending') return 'handover'
	if (toText(raw.assignee_id)) return 'human'
	return 'ai'
}

function statusLabel(status: ChatStatus, handler: string) {
	if (status === 'ai') return 'AI'
	if (status === 'handover') return 'Handover'
	if (status === 'human') return handler || 'CS'
	return 'Closed'
}

function statusChipClass(status: ChatStatus) {
	if (status === 'ai') {
		return 'border-[color:color-mix(in_oklab,var(--ocm-warning)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--ocm-warning)_20%,transparent)] text-[color:var(--ocm-warning)]'
	}
	if (status === 'handover') {
		return 'border-[color:color-mix(in_oklab,var(--ocm-danger)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--ocm-danger)_18%,transparent)] text-[color:var(--ocm-danger)]'
	}
	if (status === 'human') {
		return 'border-sky-400/40 bg-sky-500/15 text-sky-400'
	}
	return 'border-emerald-400/35 bg-emerald-500/15 text-emerald-400'
}

function mapApiConversation(
	raw: Record<string, unknown>,
): UiConversation | null {
	const id = toText(raw.id)
	if (!id) return null

	const channelType = toText(raw.channel_type).toLowerCase()
	if (channelType && channelType !== 'whatsapp') return null
	if (isAiPlaygroundConversation(raw)) return null

	const contact = isRecord(raw.contacts) ? raw.contacts : {}
	const contactMeta = isRecord(contact.metadata) ? contact.metadata : {}
	const provider = normalizeUiWhatsappProvider(
		raw.whatsapp_provider ?? raw.provider,
	)
	const lastMessage =
		toArray<Record<string, unknown>>(raw.messages).find(
			(item) => !shouldHideMessageFromChat(item),
		) || {}
	const status = resolveStatus(raw)
	const aiAnalytics = parseAiAnalytics(raw.ai_analytics, 'api')

	const name =
		toText(contact.name) ||
		toText(contact.full_name) ||
		toText(contact.identifier) ||
		'Pelanggan'
	const phone =
		toText(contact.phone_number) ||
		toText(contact.whatsapp_id) ||
		toText(contact.identifier) ||
		'-'
	const preview =
		resolveRenderableMessageText(lastMessage) ||
		(Object.keys(lastMessage).length > 0 ? toText(raw.last_message) : '') ||
		'Belum ada pesan.'
	const handler =
		status === 'human' ? 'CS Team' : status === 'handover' ? 'Pending CS' : 'AI'
	const intent =
		toText(contactMeta.intent) ||
		toText(raw.intent) ||
		toText(aiAnalytics?.intent) ||
		'Percakapan'
	const unread = Number(raw.unread_count || 0)
	const timestamp =
		raw.last_message_at ||
		lastMessage.created_at ||
		raw.updated_at ||
		raw.created_at

	return {
		id,
		backendId: id,
		inboxId: toNullableText(raw.inbox_id),
		provider,
		name,
		phone,
		preview,
		time: formatConversationClock(timestamp),
		unread: Number.isFinite(unread) ? unread : 0,
		status,
		handler,
		intent,
		online: false,
		aiAnalytics,
		source: 'api',
	}
}

function normalizeMessageTimestamp(value: unknown): string | null {
	if (
		!(
			value instanceof Date ||
			typeof value === 'string' ||
			typeof value === 'number'
		)
	) {
		return null
	}

	const timestamp = new Date(value)
	if (Number.isNaN(timestamp.getTime())) return null
	return timestamp.toISOString()
}

function toMessageSortValue(value: string) {
	const timestamp = new Date(value).getTime()
	return Number.isFinite(timestamp) ? timestamp : 0
}

function extractOldestMessageCursor(rows: Record<string, unknown>[]) {
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		const cursor = normalizeMessageTimestamp(rows[index]?.created_at)
		if (cursor) return cursor
	}

	return null
}

function mergeMessagesChronologically(messages: UiMessage[]) {
	const deduped = new Map<string, UiMessage>()
	for (const message of messages) {
		deduped.set(message.id, message)
	}

	return Array.from(deduped.values()).sort((left, right) => {
		const timeDiff =
			toMessageSortValue(left.createdAt) - toMessageSortValue(right.createdAt)
		if (timeDiff !== 0) return timeDiff
		return left.id.localeCompare(right.id)
	})
}

function mapApiMessage(raw: Record<string, unknown>): UiMessage | null {
	if (shouldHideMessageFromChat(raw)) return null

	const id = toText(raw.id)
	if (!id) return null

	const messageType = toText(raw.message_type).toLowerCase()
	const from: MessageFrom = messageType === 'incoming' ? 'customer' : 'ai'
	const contentType = toText(raw.content_type).toLowerCase()
	const contentAttributes = isRecord(raw.content_attributes)
		? raw.content_attributes
		: {}
	const text =
		(contentType === 'template'
			? resolveTemplatePreviewText(contentAttributes, raw.content)
			: normalizeMessageText(raw.content)) || '-'
	const kind: MessageKind =
		contentType === 'image' ||
		contentType === 'video' ||
		contentType === 'document'
			? 'image'
			: 'text'
	const aiAnalyticsRecord = isRecord(contentAttributes.ai_analytics)
		? contentAttributes.ai_analytics
		: null
	const aiAnalytics = parseAiAnalytics(contentAttributes.ai_analytics, 'api')
	const confidence =
		aiAnalytics?.confidence ??
		normalizeConfidence(
			contentAttributes.ai_confidence ?? contentAttributes.last_ai_confidence,
		)
	const intent =
		toNullableText(contentAttributes.intent) ||
		toNullableText(contentAttributes.rag_intent) ||
		toNullableText(
			isRecord(aiAnalyticsRecord) ? aiAnalyticsRecord.intent : null,
		) ||
		null
	const createdAt = normalizeMessageTimestamp(raw.created_at) || new Date().toISOString()

	return {
		id,
		from,
		kind,
		text,
		createdAt,
		intent,
		time: formatConversationClock(raw.created_at || Date.now()),
		status: toText(raw.status) === 'read' ? 'read' : 'delivered',
		...(confidence !== null ? { confidence } : {}),
		source: 'api',
	}
}

function mapSocketMessage(raw: Record<string, unknown>): UiMessage | null {
	if (shouldHideMessageFromChat(raw)) return null

	const id = toText(raw.id)
	if (!id) return null

	const senderType = toText(raw.sender_type).toLowerCase()
	const messageType = toText(raw.message_type).toLowerCase()
	const from: MessageFrom =
		senderType === 'contact' || messageType === 'incoming' ? 'customer' : 'ai'
	const contentType = toText(raw.content_type).toLowerCase()
	const contentAttributes = isRecord(raw.content_attributes)
		? raw.content_attributes
		: {}
	const text =
		(contentType === 'template'
			? resolveTemplatePreviewText(contentAttributes, raw.content)
			: normalizeMessageText(raw.content)) || '-'
	const kind: MessageKind =
		contentType === 'image' ||
		contentType === 'video' ||
		contentType === 'document'
			? 'image'
			: 'text'

	const aiAnalyticsRecord = isRecord(contentAttributes.ai_analytics)
		? contentAttributes.ai_analytics
		: null
	const intent =
		toNullableText(contentAttributes.intent) ||
		toNullableText(contentAttributes.rag_intent) ||
		toNullableText(
			isRecord(aiAnalyticsRecord) ? aiAnalyticsRecord.intent : null,
		) ||
		null
	const createdAt = normalizeMessageTimestamp(raw.created_at) || new Date().toISOString()

	return {
		id,
		from,
		kind,
		text,
		createdAt,
		intent,
		time: formatConversationClock(raw.created_at || Date.now()),
		status: 'delivered',
		source: 'api',
	}
}

function unwrapConversationRows(payload: unknown): Record<string, unknown>[] {
	if (Array.isArray(payload)) return payload as Record<string, unknown>[]
	if (!isRecord(payload)) return []

	const directData = toArray<Record<string, unknown>>(payload.data)
	if (directData.length > 0) return directData

	const directPayload = toArray<Record<string, unknown>>(payload.payload)
	if (directPayload.length > 0) return directPayload

	const nested = isRecord(payload.results) ? payload.results : null
	if (nested) {
		const nestedData = toArray<Record<string, unknown>>(nested.data)
		if (nestedData.length > 0) return nestedData
		const nestedPayload = toArray<Record<string, unknown>>(nested.payload)
		if (nestedPayload.length > 0) return nestedPayload
	}

	return []
}

function extractConversationPaginationMeta(payload: unknown): {
	total: number
	page: number
	limit: number
} | null {
	if (!isRecord(payload)) return null

	const total = Number(payload.total)
	const page = Number(payload.page)
	const limit = Number(payload.limit)

	if (
		!Number.isFinite(total) ||
		!Number.isFinite(page) ||
		!Number.isFinite(limit) ||
		page < 1 ||
		limit < 1
	) {
		return null
	}

	return {
		total,
		page,
		limit,
	}
}

function unwrapMessageRows(payload: unknown): Record<string, unknown>[] {
	if (Array.isArray(payload)) return payload as Record<string, unknown>[]
	if (!isRecord(payload)) return []

	const directData = toArray<Record<string, unknown>>(payload.data)
	if (directData.length > 0) return directData

	const directPayload = toArray<Record<string, unknown>>(payload.payload)
	if (directPayload.length > 0) return directPayload

	const nested = isRecord(payload.results) ? payload.results : null
	if (nested) {
		const nestedData = toArray<Record<string, unknown>>(
			nested.messages || nested.data,
		)
		if (nestedData.length > 0) return nestedData
	}

	return []
}

function uniqueNotes(notes: string[]) {
	return Array.from(new Set(notes))
}

function mergeConversationPages(
	current: UiConversation[],
	incoming: UiConversation[],
) {
	const next = [...current]
	const indexById = new Map(
		current.map((conversation, index) => [conversation.id, index] as const),
	)

	for (const conversation of incoming) {
		const existingIndex = indexById.get(conversation.id)
		if (existingIndex === undefined) {
			indexById.set(conversation.id, next.length)
			next.push(conversation)
			continue
		}

		next[existingIndex] = conversation
	}

	return next
}

function ChatPage() {
	const navigate = useNavigate()
	const search = Route.useSearch()
	const requestedConversationId = toText(search.conversation_id).trim()
	const selectedProvider = normalizeWhatsappProviderFilter(search.provider)
	const [conversationRows, setConversationRows] = useState<UiConversation[]>([])
	const activeId = requestedConversationId
	const [messages, setMessages] = useState<UiMessage[]>([])
	const [filter, setFilter] = useState<ChatFilter>('all')
	const [searchQuery, setSearchQuery] = useState('')
	const [panelOpen, setPanelOpen] = useState(true)
	const [aiMode, setAiMode] = useState(true)
	const [draft, setDraft] = useState('')
	const [loadingConversations, setLoadingConversations] = useState(false)
	const [loadingMessages, setLoadingMessages] = useState(false)
	const [loadingOlderMessages, setLoadingOlderMessages] = useState(false)
	const [loadingContactDetail, setLoadingContactDetail] = useState(false)
	const [uploadingAttachment, setUploadingAttachment] = useState(false)
	const [resolvingConversation, setResolvingConversation] = useState(false)
	const [isTemplateModalOpen, setIsTemplateModalOpen] = useState(false)
	const [isFilterDialogOpen, setIsFilterDialogOpen] = useState(false)
	const [isNewChatDialogOpen, setIsNewChatDialogOpen] = useState(false)
	const [hasOlderMessages, setHasOlderMessages] = useState(false)
	const [oldestMessageCursor, setOldestMessageCursor] = useState<string | null>(
		null,
	)
	const [draftFilters, setDraftFilters] = useState<AdvancedChatFilters>(
		DEFAULT_ADVANCED_CHAT_FILTERS,
	)
	const [appliedFilters, setAppliedFilters] = useState<AdvancedChatFilters>(
		DEFAULT_ADVANCED_CHAT_FILTERS,
	)
	const [filterOptionsLoading, setFilterOptionsLoading] = useState(false)
	const [inboxOptions, setInboxOptions] = useState<ChatInboxOption[]>([])
	const [labelOptions, setLabelOptions] = useState<ChatSelectOption[]>([])
	const [agentOptions, setAgentOptions] = useState<ChatSelectOption[]>([])
	const [aiAgentOptions, setAiAgentOptions] = useState<ChatSelectOption[]>([])
	const [pipelineStageOptions, setPipelineStageOptions] = useState<
		ChatPipelineStageOption[]
	>([])
	const [newChatForm, setNewChatForm] =
		useState<NewChatFormState>(DEFAULT_NEW_CHAT_FORM)
	const [newChatTemplates, setNewChatTemplates] = useState<
		WhatsAppTemplateOption[]
	>([])
	const [loadingNewChatTemplates, setLoadingNewChatTemplates] = useState(false)
	const [submittingNewChat, setSubmittingNewChat] = useState(false)
	const [newChatTemplateError, setNewChatTemplateError] = useState<string | null>(
		null,
	)
	const [conversationPage, setConversationPage] = useState(1)
	const [conversationTotal, setConversationTotal] = useState(0)
	const [hasMoreConversations, setHasMoreConversations] = useState(false)
	const [loadingMoreConversations, setLoadingMoreConversations] = useState(false)
	const [contactDetail, setContactDetail] =
		useState<ConversationContactDetailResponse | null>(null)
	const [runtimeBackendNotes, setRuntimeBackendNotes] = useState<string[]>([])
	const messagesContainerRef = useRef<HTMLDivElement | null>(null)
	const messagesEndRef = useRef<HTMLDivElement | null>(null)
	const attachmentInputRef = useRef<HTMLInputElement | null>(null)
	const activeConversationBackendIdRef = useRef<string | null>(null)
	const previousActiveConversationRef = useRef<string | null>(null)
	const pendingPrependScrollRef = useRef<{
		scrollHeight: number
		scrollTop: number
	} | null>(null)
	const pendingScrollToBottomRef = useRef<'auto' | 'smooth' | null>(null)

	const pushBackendNote = useCallback((note: string) => {
		setRuntimeBackendNotes((current) => uniqueNotes([...current, note]))
	}, [])

	const loadConversations = useCallback(
		async ({
			page = 1,
			append = false,
		}: {
			page?: number
			append?: boolean
		} = {}) => {
			if (append) {
				setLoadingMoreConversations(true)
			} else {
				setLoadingConversations(true)
			}

			const targetPage = Math.max(1, Math.floor(page))

			try {
				const response = await conversations.list({
					page: targetPage,
					limit: CONVERSATION_PAGE_SIZE,
					channelType: 'whatsapp',
					provider: selectedProvider,
					status:
						appliedFilters.status === 'all'
							? undefined
							: appliedFilters.status,
					inbox_id: appliedFilters.inboxId || undefined,
					assignee_id: appliedFilters.agentId || undefined,
					dateFrom: appliedFilters.dateFrom || undefined,
					dateTo: appliedFilters.dateTo || undefined,
					labelIds: appliedFilters.labelId || undefined,
					resolvedBy: appliedFilters.resolvedById || undefined,
					aiAgentId: appliedFilters.aiAgentId || undefined,
					pipelineStageId: appliedFilters.pipelineStageId || undefined,
				})

				const rows = unwrapConversationRows(response)
				const paginationMeta = extractConversationPaginationMeta(response)
				const mapped = rows
					.map((item) => mapApiConversation(item))
					.filter((item): item is UiConversation => item !== null)

				const resolvedPage = paginationMeta?.page || targetPage
				const resolvedLimit =
					paginationMeta?.limit || CONVERSATION_PAGE_SIZE
				const resolvedTotal = paginationMeta?.total ?? mapped.length

				setConversationRows((current) =>
					append ? mergeConversationPages(current, mapped) : mapped,
				)
				setConversationPage(resolvedPage)
				setConversationTotal(resolvedTotal)
				setHasMoreConversations(resolvedPage * resolvedLimit < resolvedTotal)
			} catch (error) {
				if (!append) {
					setConversationRows([])
					setConversationPage(1)
					setConversationTotal(0)
					setHasMoreConversations(false)
				}

				const reason =
					error instanceof Error && error.message
						? error.message
						: 'unknown error'
				pushBackendNote(`Tidak bisa load list conversation dari API (${reason}).`)
			} finally {
				if (append) {
					setLoadingMoreConversations(false)
				} else {
					setLoadingConversations(false)
				}
			}
		},
		[appliedFilters, pushBackendNote, selectedProvider],
	)

	const loadModalOptions = useCallback(async () => {
		setFilterOptionsLoading(true)
		try {
			const [
				inboxesResponse,
				labelsResponse,
				agentsResponse,
				chatbotsResponse,
				contactSettingsResponse,
			] = await Promise.all([
				inboxes.list(),
				labels.list(),
				agents.list(),
				chatbots.list(),
				contacts.settings.get(),
			])

			const nextInboxes = extractCollectionRows(inboxesResponse)
				.filter((row) => {
					const channelType = toText(row.channel_type).toLowerCase()
					return !channelType || channelType === 'whatsapp'
				})
				.map((row) => {
					const id = toText(row.id)
					if (!id) return null
					return {
						id,
						label: toText(row.name) || `Inbox ${id.slice(0, 8)}`,
						provider: normalizeUiWhatsappProvider(
							row.whatsapp_provider ??
								row.provider ??
								(isRecord(row.channel_config)
									? row.channel_config.provider
									: null),
						),
					} satisfies ChatInboxOption
				})
				.filter((item): item is ChatInboxOption => Boolean(item))

			const nextLabels = extractCollectionRows(labelsResponse)
				.map((row) => {
					const id = toText(row.id)
					if (!id) return null
					return {
						id,
						label:
							toText(row.name) ||
							toText(row.label) ||
							toText(row.title) ||
							`Label ${id.slice(0, 8)}`,
					} satisfies ChatSelectOption
				})
				.filter((item): item is ChatSelectOption => Boolean(item))

			const agentRows = extractCollectionRows(
				isRecord(agentsResponse) ? agentsResponse.data : agentsResponse,
			)
			const nextAgents = agentRows
				.map((row) => {
					const id = toText(row.id)
					if (!id) return null
					return {
						id,
						label:
							toText(row.name) ||
							toText(row.email) ||
							`Agent ${id.slice(0, 8)}`,
					} satisfies ChatSelectOption
				})
				.filter((item): item is ChatSelectOption => Boolean(item))

			const chatbotRows = extractCollectionRows(
				isRecord(chatbotsResponse) ? chatbotsResponse.data : chatbotsResponse,
			)
			const nextAiAgents = chatbotRows
				.map((row) => {
					const id = toText(row.id)
					if (!id) return null
					return {
						id,
						label: toText(row.name) || `AI Agent ${id.slice(0, 8)}`,
					} satisfies ChatSelectOption
				})
				.filter((item): item is ChatSelectOption => Boolean(item))

			const stagePayload = isRecord(contactSettingsResponse)
				? contactSettingsResponse.payload || contactSettingsResponse.data
				: null
			const stageRows = isRecord(stagePayload)
				? toArray<Record<string, unknown>>(
						isRecord(stagePayload.stages)
							? stagePayload.stages.stages
							: stagePayload.stages,
					)
				: []
			const nextStages = stageRows
				.map((row) => {
					const id = toText(row.id)
					if (!id) return null
					return {
						id,
						label: toText(row.name) || `Stage ${id.slice(0, 8)}`,
						color: toNullableText(row.color),
					} satisfies ChatPipelineStageOption
				})
				.filter((item): item is ChatPipelineStageOption => Boolean(item))

			setInboxOptions(nextInboxes)
			setLabelOptions(nextLabels)
			setAgentOptions(nextAgents)
			setAiAgentOptions(nextAiAgents)
			setPipelineStageOptions(nextStages)
			setNewChatForm((current) =>
				current.inboxId || nextInboxes.length === 0
					? current
					: { ...current, inboxId: nextInboxes[0].id },
			)
		} catch (error) {
			const reason =
				error instanceof Error && error.message
					? error.message
					: 'unknown error'
			pushBackendNote(`Tidak bisa load opsi chat (${reason}).`)
		} finally {
			setFilterOptionsLoading(false)
		}
	}, [pushBackendNote])

	useEffect(() => {
		void loadConversations()
	}, [loadConversations])

	useEffect(() => {
		void loadModalOptions()
	}, [loadModalOptions])

	const activeConversation = useMemo(() => {
		if (!activeId) return null
		return conversationRows.find((item) => item.id === activeId) || null
	}, [activeId, conversationRows])
	const activeConversationId = activeConversation?.id || null
	const activeConversationBackendId = activeConversation?.backendId || null
	const activeConversationInboxId =
		contactDetail?.conversation.inbox_id ||
		activeConversation?.inboxId ||
		null
	const activeConversationName = activeConversation?.name || 'Pelanggan'
	const selectedNewChatInbox = useMemo(
		() => inboxOptions.find((item) => item.id === newChatForm.inboxId) || null,
		[inboxOptions, newChatForm.inboxId],
	)
	const selectedNewChatTemplate = useMemo(
		() =>
			newChatTemplates.find((item) => item.id === newChatForm.templateId) || null,
		[newChatForm.templateId, newChatTemplates],
	)
	const normalizedNewChatPhone = useMemo(
		() => normalizePhoneForChat(newChatForm.phoneNumber),
		[newChatForm.phoneNumber],
	)
	const newChatTemplateVariables = useMemo(
		() => ({
			'1': newChatForm.name.trim() || 'Customer',
			'2': normalizedNewChatPhone || '6280000000000',
			customer_name: newChatForm.name.trim() || 'Customer',
		}),
		[newChatForm.name, normalizedNewChatPhone],
	)
	const newChatTemplateVariableKeys = useMemo(
		() =>
			selectedNewChatTemplate
				? extractTemplateVariableKeys(selectedNewChatTemplate.components)
				: [],
		[selectedNewChatTemplate],
	)
	const hasUnsupportedNewChatTemplateVariables = useMemo(
		() => newChatTemplateVariableKeys.some((key) => key !== '1' && key !== '2'),
		[newChatTemplateVariableKeys],
	)
	const newChatPreviewHeader = useMemo(
		() =>
			selectedNewChatTemplate
				? renderTemplateText(
						extractTemplateHeaderText(selectedNewChatTemplate.components),
						newChatTemplateVariables,
					)
				: '',
		[selectedNewChatTemplate, newChatTemplateVariables],
	)
	const newChatPreviewBody = useMemo(() => {
		if (!selectedNewChatTemplate) return ''
		return renderTemplateText(
			extractTemplateBodyText(selectedNewChatTemplate.components) ||
				selectedNewChatTemplate.name,
			newChatTemplateVariables,
		)
	}, [selectedNewChatTemplate, newChatTemplateVariables])
	const newChatPreviewFooter = useMemo(
		() =>
			selectedNewChatTemplate
				? renderTemplateText(
						extractTemplateFooterText(selectedNewChatTemplate.components),
						newChatTemplateVariables,
					)
				: '',
		[selectedNewChatTemplate, newChatTemplateVariables],
	)
	const newChatPreviewButtons = useMemo(
		() =>
			selectedNewChatTemplate
				? extractTemplateButtonLabels(selectedNewChatTemplate.components)
				: [],
		[selectedNewChatTemplate],
	)
	const canSubmitNewChat = Boolean(
		newChatForm.inboxId &&
			newChatForm.name.trim() &&
			normalizedNewChatPhone &&
			selectedNewChatTemplate &&
			!loadingNewChatTemplates &&
			!submittingNewChat &&
			!hasUnsupportedNewChatTemplateVariables,
	)

	useEffect(() => {
		activeConversationBackendIdRef.current = activeConversationBackendId
	}, [activeConversationBackendId])

	useEffect(() => {
		if (!isNewChatDialogOpen || !newChatForm.inboxId) {
			setNewChatTemplates([])
			setNewChatTemplateError(null)
			setNewChatForm((current) =>
				current.templateId ? { ...current, templateId: '' } : current,
			)
			return
		}

		let mounted = true

		const loadTemplates = async () => {
			setLoadingNewChatTemplates(true)
			setNewChatTemplateError(null)
			try {
				const response = await whatsappTemplates.list('APPROVED', undefined, {
					inboxId: newChatForm.inboxId,
				})

				if (!mounted) return

				const rows = extractCollectionRows(response.data)
				const mapped = rows.map((row) => ({
					id: String(row.id || randomId()),
					name: String(row.name || 'template'),
					status: String(row.status || 'UNKNOWN').toUpperCase(),
					category: String(row.category || 'UTILITY').toUpperCase(),
					language: String(row.language || row.locale || 'en_US'),
					components: Array.isArray(row.components) ? row.components : [],
				}))

				setNewChatTemplates(mapped)
				setNewChatForm((current) => ({
					...current,
					templateId: mapped.some((item) => item.id === current.templateId)
						? current.templateId
						: mapped[0]?.id || '',
				}))
			} catch (error) {
				if (!mounted) return
				setNewChatTemplates([])
				setNewChatForm((current) =>
					current.templateId ? { ...current, templateId: '' } : current,
				)
				setNewChatTemplateError(
					error instanceof Error
						? error.message
						: 'Gagal memuat template WhatsApp',
				)
			} finally {
				if (mounted) setLoadingNewChatTemplates(false)
			}
		}

		void loadTemplates()
		return () => {
			mounted = false
		}
	}, [isNewChatDialogOpen, newChatForm.inboxId])

	const loadLatestMessages = useCallback(
		async (
			conversationBackendId: string,
			options?: {
				replace?: boolean
				scrollToBottom?: 'auto' | 'smooth'
			},
		) => {
			const replace = options?.replace !== false
			const scrollToBottom = options?.scrollToBottom || null

			setLoadingMessages(true)
			try {
				const response = await conversations.getMessages(conversationBackendId, {
					limit: CHAT_MESSAGE_PAGE_SIZE,
				})
				if (activeConversationBackendIdRef.current !== conversationBackendId) {
					return
				}

				const rows = unwrapMessageRows(response)
				const mapped = rows
					.map((item) => mapApiMessage(item))
					.filter((item): item is UiMessage => item !== null)
					.reverse()
				const nextOldestCursor = extractOldestMessageCursor(rows)

				setMessages((current) =>
					replace
						? mapped
						: mergeMessagesChronologically([...current, ...mapped]),
				)
				setOldestMessageCursor((current) =>
					replace ? nextOldestCursor : current || nextOldestCursor,
				)
				setHasOlderMessages((current) =>
					replace
						? Boolean(nextOldestCursor) &&
							rows.length === CHAT_MESSAGE_PAGE_SIZE
						: current ||
							(Boolean(nextOldestCursor) &&
								rows.length === CHAT_MESSAGE_PAGE_SIZE),
				)

				if (scrollToBottom) {
					pendingScrollToBottomRef.current = scrollToBottom
				}
			} catch (error) {
				if (activeConversationBackendIdRef.current !== conversationBackendId) {
					return
				}

				if (replace) {
					setMessages([])
					setOldestMessageCursor(null)
					setHasOlderMessages(false)
				}

				const reason =
					error instanceof Error && error.message
						? error.message
						: 'unknown error'
				pushBackendNote(`Tidak bisa load message dari API (${reason}).`)
			} finally {
				if (activeConversationBackendIdRef.current === conversationBackendId) {
					setLoadingMessages(false)
				}
			}
		},
		[pushBackendNote],
	)

	const loadOlderMessages = useCallback(
		async (conversationBackendId: string) => {
			if (
				loadingMessages ||
				loadingOlderMessages ||
				!hasOlderMessages ||
				!oldestMessageCursor
			) {
				return
			}

			const container = messagesContainerRef.current
			if (container) {
				pendingPrependScrollRef.current = {
					scrollHeight: container.scrollHeight,
					scrollTop: container.scrollTop,
				}
			}

			setLoadingOlderMessages(true)
			try {
				const response = await conversations.getMessages(conversationBackendId, {
					limit: CHAT_MESSAGE_PAGE_SIZE,
					before: oldestMessageCursor,
				})
				if (activeConversationBackendIdRef.current !== conversationBackendId) {
					return
				}

				const rows = unwrapMessageRows(response)
				const mapped = rows
					.map((item) => mapApiMessage(item))
					.filter((item): item is UiMessage => item !== null)
					.reverse()
				const nextOldestCursor = extractOldestMessageCursor(rows)

				if (nextOldestCursor) {
					setOldestMessageCursor(nextOldestCursor)
				}

				if (mapped.length > 0) {
					setMessages((current) =>
						mergeMessagesChronologically([...mapped, ...current]),
					)
				}

				setHasOlderMessages(
					Boolean(nextOldestCursor) && rows.length === CHAT_MESSAGE_PAGE_SIZE,
				)
			} catch (error) {
				pendingPrependScrollRef.current = null
				const reason =
					error instanceof Error && error.message
						? error.message
						: 'unknown error'
				pushBackendNote(`Tidak bisa load message lama dari API (${reason}).`)
			} finally {
				if (activeConversationBackendIdRef.current === conversationBackendId) {
					setLoadingOlderMessages(false)
				}
			}
		},
		[
			hasOlderMessages,
			loadingMessages,
			loadingOlderMessages,
			oldestMessageCursor,
			pushBackendNote,
		],
	)

	const handleMessagesScroll = useCallback(() => {
		const container = messagesContainerRef.current
		if (!container || !activeConversationBackendId) return
		if (container.scrollTop > 72) return
		void loadOlderMessages(activeConversationBackendId)
	}, [activeConversationBackendId, loadOlderMessages])

	const handleSelectConversation = useCallback(
		(conversationId: string) => {
			const normalizedConversationId = toText(conversationId).trim()
			if (!normalizedConversationId) return

			if (normalizedConversationId !== activeConversationId) {
				setMessages([])
				setLoadingOlderMessages(false)
				setHasOlderMessages(false)
				setOldestMessageCursor(null)
				setContactDetail(null)
				setRuntimeBackendNotes([])
				pendingPrependScrollRef.current = null
				pendingScrollToBottomRef.current = null
			}

			void navigate({
				to: '/chat',
				search: (prev) => ({
					...prev,
					provider: selectedProvider,
					conversation_id: normalizedConversationId,
				}),
				replace: true,
			})
		},
		[activeConversationId, navigate, selectedProvider],
	)
	const handleBackToConversationList = useCallback(() => {
		setMessages([])
		setLoadingMessages(false)
		setLoadingOlderMessages(false)
		setHasOlderMessages(false)
		setOldestMessageCursor(null)
		setContactDetail(null)
		setRuntimeBackendNotes([])
		pendingPrependScrollRef.current = null
		pendingScrollToBottomRef.current = null

		void navigate({
			to: '/chat',
			search: (prev) => ({
				...prev,
				provider: selectedProvider,
				conversation_id: undefined,
			}),
			replace: true,
		})
	}, [navigate, selectedProvider])
	const handleOpenFilterDialog = useCallback(() => {
		setDraftFilters(appliedFilters)
		setIsFilterDialogOpen(true)
	}, [appliedFilters])
	const handleApplyAdvancedFilters = useCallback(() => {
		setAppliedFilters(draftFilters)
		setIsFilterDialogOpen(false)
		void navigate({
			to: '/chat',
			search: (prev) => ({
				...prev,
				provider: selectedProvider,
				conversation_id: undefined,
			}),
			replace: true,
		})
	}, [draftFilters, navigate, selectedProvider])
	const handleResetAdvancedFilters = useCallback(() => {
		setDraftFilters(DEFAULT_ADVANCED_CHAT_FILTERS)
		setAppliedFilters(DEFAULT_ADVANCED_CHAT_FILTERS)
		setIsFilterDialogOpen(false)
		void navigate({
			to: '/chat',
			search: (prev) => ({
				...prev,
				provider: selectedProvider,
				conversation_id: undefined,
			}),
			replace: true,
		})
	}, [navigate, selectedProvider])
	const handleOpenNewChatDialog = useCallback(() => {
		const preferredInbox =
			inboxOptions.find((item) =>
				matchesWhatsappProviderSelection(item.provider, selectedProvider),
			) || inboxOptions[0]
		setNewChatTemplateError(null)
		setNewChatForm({
			...DEFAULT_NEW_CHAT_FORM,
			inboxId: preferredInbox?.id || '',
		})
		setNewChatTemplates([])
		setIsNewChatDialogOpen(true)
	}, [inboxOptions, selectedProvider])
	const handleCloseNewChatDialog = useCallback(() => {
		setIsNewChatDialogOpen(false)
		setSubmittingNewChat(false)
		setNewChatTemplateError(null)
	}, [])
	const handleStartNewChat = useCallback(async () => {
		if (!canSubmitNewChat || !selectedNewChatTemplate) return

		setSubmittingNewChat(true)
		setNewChatTemplateError(null)
		try {
			await contacts.create({
				name: newChatForm.name.trim(),
				phone_number: normalizedNewChatPhone,
			})

			const created = await broadcasts.create({
				title: `Quick chat - ${newChatForm.name.trim() || normalizedNewChatPhone}`,
				message_type: 'template',
				message_content: selectedNewChatTemplate.name,
				template_name: selectedNewChatTemplate.name,
				template_language: selectedNewChatTemplate.language || 'en_US',
				template_params: {
					inbox_id: newChatForm.inboxId,
					template_name: selectedNewChatTemplate.name,
					language: selectedNewChatTemplate.language || 'en_US',
					components: selectedNewChatTemplate.components,
					variable_defaults: {
						1: newChatTemplateVariables['1'],
						2: newChatTemplateVariables['2'],
					},
				},
				target_audience: {
					type: 'numbers',
					inbox_id: newChatForm.inboxId,
					recipients: [
						{
							phoneNumber: normalizedNewChatPhone,
							name: newChatForm.name.trim(),
							variables: {
								1: newChatTemplateVariables['1'],
								2: newChatTemplateVariables['2'],
							},
						},
					],
				},
			})

			const createdBroadcastId = created?.payload?.id
			if (createdBroadcastId) {
				await broadcasts.send(createdBroadcastId)
			}

			toast.success(
				'Pesan template masuk antrean. Conversation baru akan muncul setelah webhook WhatsApp masuk.',
			)
			setIsNewChatDialogOpen(false)
			const preferredInbox =
				inboxOptions.find((item) =>
					matchesWhatsappProviderSelection(item.provider, selectedProvider),
				) || inboxOptions[0]
			setNewChatForm({
				...DEFAULT_NEW_CHAT_FORM,
				inboxId: preferredInbox?.id || '',
			})
			setNewChatTemplates([])
			void loadConversations()
		} catch (error) {
			const reason =
				error instanceof Error && error.message
					? error.message
					: 'Gagal memulai chat baru'
			setNewChatTemplateError(reason)
			toast.error(reason)
		} finally {
			setSubmittingNewChat(false)
		}
	}, [
		canSubmitNewChat,
		inboxOptions,
		loadConversations,
		newChatForm.inboxId,
		newChatForm.name,
		newChatTemplateVariables,
		normalizedNewChatPhone,
		selectedProvider,
		selectedNewChatTemplate,
	])
	const backendNotes = useMemo(
		() =>
			uniqueNotes([
				...runtimeBackendNotes,
				...(Array.isArray(contactDetail?.backend_notes)
					? contactDetail.backend_notes
					: []),
			]),
		[runtimeBackendNotes, contactDetail?.backend_notes],
	)
	const detailCustomer = contactDetail?.customer || null
	const detailBadges = contactDetail?.badges || null
	const displayName = detailCustomer?.name || activeConversationName
	const displayPhone =
		detailCustomer?.phone_number || activeConversation?.phone || '-'
	const activeAiBanner = useMemo(() => {
		if (!activeConversation) return null
		return resolveAiBanner(activeConversation, messages)
	}, [activeConversation, messages])
	const aiSuggestions = useMemo(
		() =>
			buildAiSuggestions(messages, activeAiBanner?.analytics.intent || null),
		[messages, activeAiBanner?.analytics.intent],
	)

	useEffect(() => {
		setRuntimeBackendNotes([])
	}, [activeConversationId])

	useEffect(() => {
		if (!activeConversationId) {
			setContactDetail(null)
			setLoadingContactDetail(false)
			return
		}

		if (!activeConversationBackendId) {
			setContactDetail(null)
			setLoadingContactDetail(false)
			return
		}

		let mounted = true
		const loadContactDetail = async () => {
			setLoadingContactDetail(true)
			setContactDetail(null)
			try {
				const detail = await conversations.getContactDetail(
					activeConversationBackendId,
				)
				if (!mounted) return
				setContactDetail(detail)
			} catch (error) {
				if (!mounted) return
				setContactDetail(null)
				const reason =
					error instanceof Error && error.message
						? error.message
						: 'unknown error'
				pushBackendNote(
					`Tidak bisa load contact detail dari API (${reason}), panel kanan sementara kosong.`,
				)
			} finally {
				if (mounted) setLoadingContactDetail(false)
			}
		}

		loadContactDetail()

		return () => {
			mounted = false
		}
	}, [activeConversationBackendId, activeConversationId, pushBackendNote])

	useEffect(() => {
		if (!activeConversationId) {
			setMessages([])
			setLoadingMessages(false)
			setLoadingOlderMessages(false)
			setHasOlderMessages(false)
			setOldestMessageCursor(null)
			pendingPrependScrollRef.current = null
			pendingScrollToBottomRef.current = null
			return
		}

		if (!activeConversationBackendId) {
			setMessages([])
			setLoadingMessages(false)
			setLoadingOlderMessages(false)
			setHasOlderMessages(false)
			setOldestMessageCursor(null)
			pendingPrependScrollRef.current = null
			pendingScrollToBottomRef.current = null
			return
		}

		void loadLatestMessages(activeConversationBackendId, {
			replace: true,
			scrollToBottom: 'auto',
		})
		return () => {
			pendingPrependScrollRef.current = null
		}
	}, [activeConversationBackendId, activeConversationId, loadLatestMessages])

	useEffect(() => {
		if (messages.length === 0) return

		const container = messagesContainerRef.current
		const pendingPrependScroll = pendingPrependScrollRef.current
		if (container && pendingPrependScroll) {
			pendingPrependScrollRef.current = null
			requestAnimationFrame(() => {
				container.scrollTop =
					container.scrollHeight -
					pendingPrependScroll.scrollHeight +
					pendingPrependScroll.scrollTop
			})
			return
		}

		const behavior = pendingScrollToBottomRef.current
		if (!behavior) return

		pendingScrollToBottomRef.current = null
		requestAnimationFrame(() => {
			messagesEndRef.current?.scrollIntoView({
				behavior,
				block: 'end',
			})
		})
	}, [messages.length])

	useEffect(() => {
		if (loadingConversations) return
		if (loadingMoreConversations) return
		if (!activeId) return
		if (activeConversation) return
		if (hasMoreConversations) {
			void loadConversations({
				page: conversationPage + 1,
				append: true,
			})
			return
		}

		void navigate({
			to: '/chat',
			search: (prev) => ({
				...prev,
				provider: selectedProvider,
				conversation_id: undefined,
			}),
			replace: true,
		})
	}, [
		activeConversation,
		activeId,
		conversationPage,
		hasMoreConversations,
		loadConversations,
		loadingConversations,
		loadingMoreConversations,
		navigate,
		selectedProvider,
	])

	useEffect(() => {
		const socket = connectSocket()
		const appId =
			getAppIdFromCookie() ||
			(typeof localStorage !== 'undefined'
				? localStorage.getItem('scalechat_app_id')
				: null)

		const joinAppRoom = () => {
			if (!appId) return
			socket.emit('join', { appId })
		}

		const handleMessageCreated = (payload: SocketMessageCreatedPayload) => {
			const messageRecord = isRecord(payload?.message) ? payload.message : null
			const conversationRecord = isRecord(payload?.conversation)
				? payload.conversation
				: null
			if (!messageRecord || !conversationRecord) return

			const channelType = toText(conversationRecord.channel_type).toLowerCase()
			if (channelType && channelType !== 'whatsapp') return
			if (isAiPlaygroundConversation(conversationRecord)) return
			const whatsappProvider = normalizeUiWhatsappProvider(
				conversationRecord.whatsapp_provider ?? conversationRecord.provider,
			)
			if (!matchesWhatsappProviderSelection(whatsappProvider, selectedProvider)) {
				return
			}

			const conversationId = toText(conversationRecord.id)
			if (!conversationId) return

			const socketMessage = mapSocketMessage(messageRecord)
			if (!socketMessage) return
			const messagePreview =
				socketMessage.text ||
				resolveRenderableMessageText(messageRecord) ||
				'Pesan baru'
			const messageTime = formatConversationClock(
				messageRecord.created_at || Date.now(),
			)
			const status = resolveStatus(conversationRecord)
			const contactRecord = isRecord(conversationRecord.contacts)
				? conversationRecord.contacts
				: {}
			const contactMetadata = isRecord(contactRecord.metadata)
				? contactRecord.metadata
				: {}
			const name =
				toText(contactRecord.name) ||
				toText(contactRecord.full_name) ||
				toText(contactRecord.identifier) ||
				'Pelanggan'
			const phone =
				toText(contactRecord.phone_number) ||
				toText(contactRecord.whatsapp_id) ||
				toText(contactRecord.identifier) ||
				'-'
			const intent =
				toText(contactMetadata.intent) ||
				toText(conversationRecord.intent) ||
				'Percakapan'
			const isIncoming = socketMessage.from === 'customer'

			setConversationRows((current) => {
				const index = current.findIndex((item) => item.id === conversationId)

				if (index === -1) {
					const seededUnread = isIncoming && conversationId !== activeId ? 1 : 0
					return [
						{
							id: conversationId,
							backendId: conversationId,
							inboxId: toNullableText(conversationRecord.inbox_id),
							provider: whatsappProvider,
							name,
							phone,
							preview: messagePreview,
							time: messageTime,
							unread: seededUnread,
							status,
							handler:
								status === 'human'
									? 'CS Team'
									: status === 'handover'
										? 'Pending CS'
										: 'AI',
							intent,
							online: false,
							aiAnalytics: parseAiAnalytics(
								conversationRecord.ai_analytics,
								'api',
							),
							source: 'api',
						},
						...current,
					]
				}

				const target = current[index]
				const nextUnread =
					isIncoming && conversationId !== activeId
						? target.unread + 1
						: target.unread
				const updated: UiConversation = {
					...target,
					backendId: conversationId,
					inboxId:
						toNullableText(conversationRecord.inbox_id) || target.inboxId,
					provider: whatsappProvider || target.provider,
					name,
					phone,
					preview: messagePreview,
					time: messageTime,
					status,
					intent: intent || target.intent,
					unread: conversationId === activeId ? target.unread : nextUnread,
					aiAnalytics:
						parseAiAnalytics(conversationRecord.ai_analytics, 'api') ||
						target.aiAnalytics ||
						null,
					source: 'api',
				}

				const nextRows = [...current]
				nextRows.splice(index, 1)
				nextRows.unshift(updated)
				return nextRows
			})

			if (conversationId === activeId) {
				pendingScrollToBottomRef.current = 'smooth'
				setMessages((current) => {
					if (current.some((item) => item.id === socketMessage.id))
						return current
					return mergeMessagesChronologically([...current, socketMessage])
				})
			}
		}

		joinAppRoom()
		socket.on('connect', joinAppRoom)
		socket.on('message:created', handleMessageCreated)

		return () => {
			socket.off('connect', joinAppRoom)
			socket.off('message:created', handleMessageCreated)
		}
	}, [activeId, selectedProvider])

	const counts = useMemo(() => {
		let ai = 0
		let handover = 0
		let human = 0
		let unread = 0

		for (const row of conversationRows) {
			if (row.status === 'ai') ai += 1
			if (row.status === 'handover') handover += 1
			if (row.status === 'human') human += 1
			if (row.unread > 0) unread += 1
		}

		return {
			all: Math.max(conversationTotal, conversationRows.length),
			ai,
			handover,
			human,
			unread,
		}
	}, [conversationRows, conversationTotal])

	const filteredConversations = useMemo(() => {
		return conversationRows.filter((row) => {
			const matchesFilter =
				filter === 'all'
					? true
					: filter === 'unread'
						? row.unread > 0
						: row.status === filter

			if (!matchesFilter) return false

			if (!searchQuery.trim()) return true
			const haystack =
				`${row.name} ${row.phone} ${row.intent} ${row.preview}`.toLowerCase()
			return haystack.includes(searchQuery.trim().toLowerCase())
		})
	}, [conversationRows, filter, searchQuery])

	const handleLoadMoreConversations = useCallback(() => {
		if (
			loadingConversations ||
			loadingMoreConversations ||
			!hasMoreConversations
		) {
			return
		}

		void loadConversations({
			page: conversationPage + 1,
			append: true,
		})
	}, [
		conversationPage,
		hasMoreConversations,
		loadConversations,
		loadingConversations,
		loadingMoreConversations,
	])

	const handleSend = async (event: React.FormEvent) => {
		event.preventDefault()
		if (!draft.trim() || !activeConversation) return
		if (!activeConversation.backendId) {
			pushBackendNote(
				'Conversation belum tersedia dari API, pesan tidak dikirim.',
			)
			return
		}

		const now = new Date()
		const newMessage: UiMessage = {
			id: `local-${now.getTime()}`,
			from: 'ai',
			kind: 'text',
			text: draft.trim(),
			createdAt: now.toISOString(),
			time: formatChatTime(now),
			status: 'delivered',
			source: 'local',
		}

		pendingScrollToBottomRef.current = 'smooth'
		setMessages((current) => [...current, newMessage])
		setDraft('')

		try {
			await conversations.sendMessage(activeConversation.backendId, {
				content: newMessage.text,
				message_type: 'outgoing',
			})
		} catch (error) {
			const reason =
				error instanceof Error && error.message
					? error.message
					: 'unknown error'
			pushBackendNote(
				`Gagal kirim message ke API (${reason}), message saat ini masih local-only.`,
			)
		}
	}

	const handleAttachmentButtonClick = () => {
		attachmentInputRef.current?.click()
	}

	const handleTemplateButtonClick = () => {
		if (!activeConversationBackendId) {
			pushBackendNote(
				'Conversation belum tersedia dari API, template tidak bisa dikirim.',
			)
			return
		}

		setIsTemplateModalOpen(true)
	}

	const handleAttachmentFileChange = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0]
		event.target.value = ''
		if (!file || !activeConversation) return

		const fileName = file.name || 'Lampiran'
		const mimeType = (file.type || '').toLowerCase()
		const isImage = mimeType.startsWith('image/')
		const isPdf =
			mimeType === 'application/pdf' || fileName.toLowerCase().endsWith('.pdf')

		if (!isImage && !isPdf) {
			pushBackendNote('Lampiran hanya mendukung PDF atau gambar.')
			return
		}

		if (!activeConversation.backendId) {
			pushBackendNote(
				'Conversation belum tersedia dari API, lampiran tidak dikirim.',
			)
			return
		}

		setUploadingAttachment(true)
		try {
			const upload = await media.upload(file, 'whatsapp')
			if (!upload.success || !upload.payload) {
				throw new Error(upload.error || 'Upload media gagal')
			}

			const mediaPayload = upload.payload
			const mediaType = mediaPayload.type === 'document' ? 'document' : 'image'

			await conversations.sendMessage(activeConversation.backendId, {
				content: mediaPayload.fileName || fileName,
				message_type: 'outgoing',
				type: mediaType,
				content_type: mediaType,
				media: {
					type: mediaType,
					url: mediaPayload.url,
					mimeType: mediaPayload.mimeType,
					fileName: mediaPayload.fileName || fileName,
				},
				content_attributes: {
					file_name: mediaPayload.fileName || fileName,
					mime_type: mediaPayload.mimeType,
					file_size: mediaPayload.fileSize,
					upload_key: mediaPayload.key,
				},
			})

			await loadLatestMessages(activeConversation.backendId, {
				replace: messages.length === 0,
				scrollToBottom: 'smooth',
			})
		} catch (error) {
			const reason =
				error instanceof Error && error.message
					? error.message
					: 'unknown error'
			pushBackendNote(`Gagal kirim lampiran (${reason}).`)
		} finally {
			setUploadingAttachment(false)
		}
	}

	const handleSendTemplate = async (template: WhatsAppTemplateOption) => {
		if (!activeConversationBackendId) {
			throw new Error('Conversation belum tersedia dari API.')
		}

		const templatePreviewText =
			extractTemplateBodyText(template.components) || template.name

		try {
			await conversations.sendMessage(activeConversationBackendId, {
				content: {
					name: template.name,
					language: template.language || 'en_US',
				},
				message_type: 'outgoing',
				type: 'template',
				content_type: 'template',
				content_attributes: {
					template_name: template.name,
					template_language: template.language || 'en_US',
					template_preview_text: templatePreviewText,
				},
			})

			await loadLatestMessages(activeConversationBackendId, {
				replace: messages.length === 0,
				scrollToBottom: 'smooth',
			})
		} catch (error) {
			const reason =
				error instanceof Error && error.message
					? error.message
					: 'unknown error'
			pushBackendNote(`Gagal kirim template (${reason}).`)
			throw error
		}
	}

	const handleResolveConversation = async () => {
		if (!activeConversation) return
		if (activeConversation.status === 'done') return

		const activeConversationIdValue = activeConversation.id
		const activeBackendConversationId = activeConversation.backendId
		if (!activeBackendConversationId) {
			pushBackendNote(
				'Conversation belum tersedia dari API, status tidak diubah.',
			)
			return
		}

		setResolvingConversation(true)
		try {
			await conversations.updateStatus(activeBackendConversationId, 'resolved')

			setConversationRows((current) =>
				current.map((row) =>
					row.id === activeConversationIdValue
						? {
								...row,
								status: 'done',
								handler: 'Resolved',
								unread: 0,
								time: formatConversationClock(Date.now()),
							}
						: row,
				),
			)
		} catch (error) {
			const reason =
				error instanceof Error && error.message
					? error.message
					: 'unknown error'
			pushBackendNote(`Gagal resolve conversation (${reason}).`)
		} finally {
			setResolvingConversation(false)
		}
	}

	return (
		<main className="flex min-h-0 flex-1 p-3 lg:p-4">
			<div className="flex min-h-0 w-full overflow-hidden rounded-xl border border-[var(--ocm-line)] bg-[var(--ocm-surface)] shadow-[0_10px_30px_-22px_rgb(0_0_0_/_45%)]">
				<aside
					className={cn(
						'min-h-0 flex-col bg-[var(--ocm-surface)] md:flex md:w-[320px] md:min-w-[300px] md:border-r md:border-[var(--ocm-line)]',
						activeConversation ? 'hidden' : 'flex w-full',
					)}
				>
					<div className="border-b border-[var(--ocm-line)] p-3">
						<div className="mb-2.5 flex items-center gap-2">
							<p className="text-xs font-semibold uppercase tracking-[0.12em] text-[var(--ocm-text-muted)]">
								Inbox
							</p>
							<span className="rounded-md border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ocm-text-muted)]">
								{counts.all}
							</span>
							<div className="flex-1" />
							<button
								type="button"
								onClick={handleOpenFilterDialog}
								className="ocm-btn !h-8 !px-2.5"
							>
								<Filter size={13} />
							</button>
							<button
								type="button"
								onClick={handleOpenNewChatDialog}
								className="ocm-btn !h-8 !px-2.5"
							>
								<Plus size={13} />
							</button>
						</div>
						<div className="flex items-center gap-2 rounded-md border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-2 py-1.5">
							<Search size={13} className="text-[var(--ocm-text-muted)]" />
							<input
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								placeholder="Cari pelanggan..."
								className="w-full bg-transparent text-xs text-[var(--ocm-text)] outline-none placeholder:text-[var(--ocm-text-muted)]"
							/>
							<span className="ocm-kbd">⌘K</span>
						</div>
						<div className="mt-2 flex items-center gap-1 overflow-x-auto pb-0.5">
							{[
								{ id: 'all', label: 'Semua WA' },
								{ id: 'official', label: 'Official WABA' },
								{ id: 'baileys', label: 'Baileys' },
							].map((item) => (
								<button
									type="button"
									key={item.id}
									onClick={() => {
										void navigate({
											to: '/chat',
											search: (prev) => ({
												...prev,
												provider: item.id as WhatsAppProviderFilter,
												conversation_id: undefined,
											}),
											replace: true,
										})
									}}
									className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
										selectedProvider === item.id
											? 'border-emerald-300 bg-emerald-50 text-emerald-700'
											: 'border-transparent bg-transparent text-[var(--ocm-text-muted)]'
									}`}
								>
									{item.label}
								</button>
							))}
						</div>
						<div className="mt-2 flex items-center gap-1 overflow-x-auto pb-0.5">
							{[
								{ id: 'all', label: 'Semua', value: counts.all },
								{ id: 'ai', label: 'AI', value: counts.ai },
								{ id: 'handover', label: 'Handover', value: counts.handover },
								{ id: 'human', label: 'CS', value: counts.human },
								{ id: 'unread', label: 'Unread', value: counts.unread },
							].map((item) => (
								<button
									type="button"
									key={item.id}
									onClick={() => setFilter(item.id as ChatFilter)}
									className={`rounded-full border px-2.5 py-1 text-[10px] font-semibold ${
										filter === item.id
											? 'border-[var(--ocm-line-strong)] bg-[var(--ocm-surface-soft)] text-[var(--ocm-text)]'
											: 'border-transparent bg-transparent text-[var(--ocm-text-muted)]'
									}`}
								>
									{item.label} <span className="opacity-70">{item.value}</span>
								</button>
							))}
						</div>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto">
						{loadingConversations ? (
							<p className="px-4 py-3 text-xs text-[var(--ocm-text-muted)]">
								Memuat percakapan...
							</p>
						) : (
							<>
								{filteredConversations.length === 0 ? (
									<p className="px-4 py-3 text-xs text-[var(--ocm-text-muted)]">
										Tidak ada percakapan.
									</p>
								) : (
									filteredConversations.map((row) => (
								<button
									type="button"
									key={row.id}
									onClick={() => handleSelectConversation(row.id)}
									className={`relative flex w-full items-start gap-3 border-b border-[var(--ocm-line)] px-3 py-3 text-left transition-colors ${
										activeConversation?.id === row.id
											? 'bg-[var(--ocm-surface-soft)]'
											: 'bg-transparent hover:bg-[var(--ocm-surface-soft)]/70'
									}`}
								>
									{activeConversation?.id === row.id ? (
										<span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-[var(--ocm-accent)]" />
									) : null}
									<CrmAvatar
										name={row.name}
										size={36}
										online={row.online}
									/>
									<div className="min-w-0 flex-1">
										<div className="mb-0.5 flex items-center gap-1.5">
											<p className="truncate text-[13px] font-semibold text-[var(--ocm-text)]">
												{row.name}
											</p>
											{row.pinned ? (
												<Pin
													size={10}
													className="text-[var(--ocm-text-muted)]"
												/>
											) : null}
											<span className="ml-auto text-[10px] text-[var(--ocm-text-muted)]">
												{row.time}
											</span>
										</div>
										<p className="mb-1 truncate text-xs text-[var(--ocm-text-muted)]">
											{row.preview}
										</p>
											<div className="flex items-center gap-1.5">
												<span
													className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold border ${statusChipClass(row.status)}`}
												>
												{row.status === 'ai' ? <Sparkles size={9} /> : null}
												{row.status === 'handover' ? (
													<Handshake size={9} />
												) : null}
												{row.status === 'human' ? <User size={9} /> : null}
												{row.status === 'done' ? <Check size={9} /> : null}
												{statusLabel(row.status, row.handler)}
												</span>
												{row.provider ? (
													<span
														className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-semibold ${
															row.provider === 'baileys'
																? 'border-amber-200 bg-amber-50 text-amber-700'
																: 'border-emerald-200 bg-emerald-50 text-emerald-700'
														}`}
													>
														{row.provider === 'baileys'
															? 'Baileys'
															: 'Official'}
													</span>
												) : null}
												<span className="truncate text-[10px] text-[var(--ocm-text-muted)]">
													{row.intent}
												</span>
											<div className="ml-auto inline-flex items-center gap-1">
												<MessageCircle size={12} className="text-emerald-500" />
												{row.unread > 0 ? (
													<span className="rounded-full bg-[var(--ocm-accent)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ocm-accent-fg)]">
														{row.unread}
													</span>
												) : null}
											</div>
										</div>
									</div>
								</button>
									))
								)}

								{conversationRows.length > 0 ? (
									<div className="border-t border-[var(--ocm-line)] px-3 py-3">
										<div className="mb-2 text-[10px] text-[var(--ocm-text-muted)]">
											Menampilkan {conversationRows.length} dari {counts.all}{' '}
											percakapan
										</div>
										{loadingMoreConversations ? (
											<p className="text-xs text-[var(--ocm-text-muted)]">
												Memuat 10 percakapan lagi...
											</p>
										) : hasMoreConversations ? (
											<button
												type="button"
												onClick={handleLoadMoreConversations}
												className="w-full rounded-lg border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-3 py-2 text-xs font-semibold text-[var(--ocm-text)] transition hover:bg-[var(--ocm-surface)]"
											>
												Muat 10 percakapan lagi
											</button>
										) : (
											<p className="text-xs text-[var(--ocm-text-muted)]">
												Semua percakapan sudah dimuat.
											</p>
										)}
									</div>
								) : null}
							</>
						)}
					</div>
				</aside>

				<section
					className={cn(
						'min-w-0 flex-1 flex-col bg-[var(--ocm-bg)]',
						activeConversation ? 'flex' : 'hidden md:flex',
					)}
				>
					{activeConversation ? (
						<>
							<header className="flex flex-wrap items-center gap-3 border-b border-[var(--ocm-line)] px-4 py-3 lg:flex-nowrap lg:px-5">
								<button
									type="button"
									onClick={handleBackToConversationList}
									aria-label="Kembali ke daftar chat"
									title="Kembali ke daftar chat"
									className="ocm-btn !h-9 !w-9 !px-0 md:!hidden"
								>
									<ArrowLeft size={15} />
								</button>
								<CrmAvatar
									name={displayName || 'Pelanggan'}
									size={36}
									online={activeConversation?.online}
								/>
								<div className="min-w-0 flex-1">
									<div className="mb-0.5 flex items-center gap-2">
										<p className="truncate text-sm font-semibold text-[var(--ocm-text)]">
											{displayName || 'Pelanggan'}
										</p>
										{detailBadges?.vip ? (
											<span className="ocm-tag !text-[10px]">VIP</span>
										) : null}
										<span className="ocm-tag !text-[10px]">
											Repeat ×
											{detailBadges
												? Math.max(0, detailBadges.repeat_orders || 0)
												: '-'}
										</span>
										<span className="ocm-tag ocm-tag-success !text-[10px]">
											Lifetime{' '}
											{detailBadges
												? formatCurrencyIdrCompact(detailBadges.lifetime_value)
												: '-'}
										</span>
									</div>
									<p className="truncate text-[11px] text-[var(--ocm-text-muted)]">
										{displayPhone || '-'} · WhatsApp · Jakarta WIB
									</p>
								</div>
								<div className="flex items-center gap-1.5">
									<button
										type="button"
										onClick={() => setAiMode((current) => !current)}
										className={`inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-[11px] font-semibold ${
											aiMode
												? 'border-[color:color-mix(in_oklab,var(--ocm-warning)_30%,transparent)] bg-[color:color-mix(in_oklab,var(--ocm-warning)_18%,transparent)] text-[var(--ocm-warning)]'
												: 'border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] text-[var(--ocm-text-muted)]'
										}`}
									>
										<Sparkles size={12} />
										<span className="hidden sm:inline">AI Mode</span>
									</button>
									<button type="button" className="ocm-btn !h-8 !px-3">
										<Handshake size={13} />
										<span className="hidden sm:inline">Takeover</span>
									</button>
									<button
										type="button"
										title="Mark as Resolved"
										onClick={() => void handleResolveConversation()}
										disabled={
											resolvingConversation ||
											activeConversation?.status === 'done'
										}
										className={`ocm-btn !h-8 !px-2.5 ${
											resolvingConversation ||
											activeConversation?.status === 'done'
												? 'cursor-not-allowed opacity-60'
												: ''
										}`}
									>
										{resolvingConversation ? (
											<Loader2
												size={13}
												className="animate-spin text-emerald-400"
											/>
										) : (
											<Check size={13} className="text-emerald-400" />
										)}
									</button>
									<button
										type="button"
										onClick={() => setPanelOpen((current) => !current)}
										className="ocm-btn !hidden !h-8 !px-2.5 xl:!inline-flex"
									>
										<User size={13} />
									</button>
									<button type="button" className="ocm-btn !h-8 !px-2.5">
										<MoreHorizontal size={13} />
									</button>
								</div>
							</header>

							{activeConversation?.status === 'ai' && activeAiBanner ? (
								<div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-b border-[var(--ocm-line)] bg-[var(--ocm-surface)]/85 px-4 py-2 text-[11px] text-[var(--ocm-text-muted)]">
									<Bot size={13} className="text-[var(--ocm-accent)]" />
									<span className="truncate">
										AI handling · confidence{' '}
										<b className="text-emerald-500">
											{toConfidenceLabel(activeAiBanner.analytics.confidence)}
										</b>{' '}
										· intent{' '}
										<b className="text-[var(--ocm-text)]">
											{activeAiBanner.analytics.intent || '-'}
										</b>
									</span>
									<div className="hidden flex-1 md:block" />
									<span className="truncate">
										Workflow: {activeAiBanner.analytics.workflowName || '-'}
									</span>
									<span>·</span>
									<span className="truncate">
										RAG: {activeAiBanner.analytics.ragLabel || '-'}
									</span>
								</div>
							) : null}

							<div
								ref={messagesContainerRef}
								onScroll={handleMessagesScroll}
								className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-8"
							>
								<div className="mb-4 text-center">
									{loadingOlderMessages ? (
										<span className="inline-flex items-center gap-2 rounded-full border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-3 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ocm-text-muted)]">
											<Loader2 size={11} className="animate-spin" />
											Memuat 10 pesan sebelumnya...
										</span>
									) : hasOlderMessages && activeConversationBackendId ? (
										<button
											type="button"
											onClick={() =>
												void loadOlderMessages(activeConversationBackendId)
											}
											className="inline-flex items-center gap-2 rounded-full border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-[var(--ocm-text-muted)] transition hover:text-[var(--ocm-text)]"
										>
											Scroll ke atas atau muat 10 pesan sebelumnya
										</button>
									) : messages.length > 0 ? (
										<span className="inline-flex items-center gap-2 rounded-full border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-3 py-1 text-[10px] uppercase tracking-[0.08em] text-[var(--ocm-text-muted)]">
											Awal percakapan yang dimuat
										</span>
									) : null}
								</div>

								<div className="mb-4 text-center">
									<span className="ocm-tag">Hari ini</span>
								</div>

								{loadingMessages && messages.length === 0 ? (
									<p className="text-center text-xs text-[var(--ocm-text-muted)]">
										Memuat pesan...
									</p>
								) : messages.length === 0 ? (
									<p className="text-center text-xs text-[var(--ocm-text-muted)]">
										Belum ada pesan di conversation ini.
									</p>
								) : (
									messages.map((message) => {
										const isCustomer = message.from === 'customer'
										return (
											<div
												key={message.id}
												className={`mb-2 flex ${isCustomer ? 'justify-start' : 'justify-end'}`}
											>
												<div
													className={`flex max-w-[74%] flex-col ${
														isCustomer ? 'items-start' : 'items-end'
													}`}
												>
													{message.kind === 'image' ? (
														<div className="grid h-40 w-60 place-items-center rounded-lg border border-dashed border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] text-[10px] uppercase tracking-[0.08em] text-[var(--ocm-text-muted)]">
															{message.text}
														</div>
													) : (
														<div
															className={`rounded-xl px-3 py-2 text-[13px] leading-relaxed ${
																isCustomer
																	? 'rounded-tl-sm border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] text-[var(--ocm-text)]'
																	: 'rounded-tr-sm border border-[color:color-mix(in_oklab,var(--ocm-warning)_35%,transparent)] bg-[color:color-mix(in_oklab,var(--ocm-warning)_16%,transparent)] text-[var(--ocm-text)]'
															}`}
														>
															{message.text}
														</div>
													)}

													<div className="mt-1 flex items-center gap-1 text-[10px] text-[var(--ocm-text-muted)]">
														{!isCustomer && message.model ? (
															<>
																<Sparkles
																	size={9}
																	className="text-[var(--ocm-accent)]"
																/>
																<span>{message.model}</span>
																<span>·</span>
																<span>{message.tokens || 0}tok</span>
																<span>·</span>
																<span>{message.latency || 0}ms</span>
																<span>·</span>
																<span>conf {message.confidence ?? '-'}</span>
																<span>·</span>
															</>
														) : null}
														<span>{message.time}</span>
														{!isCustomer ? (
															message.status === 'read' ? (
																<CheckCheck
																	size={11}
																	className="text-sky-400"
																/>
															) : (
																<Check size={11} />
															)
														) : null}
													</div>
												</div>
											</div>
										)
									})
								)}
								<div ref={messagesEndRef} />
							</div>

							<div className="border-t border-[var(--ocm-line)] px-4 pb-0 pt-2 lg:px-5">
								<div className="mb-2 flex items-center gap-1.5 overflow-x-auto">
									<span className="inline-flex items-center gap-1 whitespace-nowrap text-[10px] uppercase tracking-[0.12em] text-[var(--ocm-text-muted)]">
										<Sparkles size={10} className="text-[var(--ocm-accent)]" />
										AI Suggest
									</span>
									{aiSuggestions.map((item) => (
										<button
											type="button"
											key={`${item.intentKey}-${item.label}`}
											onClick={() => setDraft(item.text)}
											className="whitespace-nowrap rounded-md border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-2.5 py-1 text-[11px] text-[var(--ocm-text-muted)] hover:text-[var(--ocm-text)]"
										>
											{item.label}
										</button>
									))}
								</div>
							</div>

							<form
								onSubmit={handleSend}
								className="border-t border-[var(--ocm-line)] px-4 py-3 lg:px-5"
							>
								<div className="rounded-lg border border-[var(--ocm-line)] bg-[var(--ocm-surface)] px-3 py-2">
									<input
										ref={attachmentInputRef}
										type="file"
										className="hidden"
										accept="image/*,application/pdf,.pdf"
										onChange={handleAttachmentFileChange}
									/>
									<textarea
										value={draft}
										onChange={(event) => setDraft(event.target.value)}
										placeholder={
											aiMode
												? 'AI sedang handle, ketik untuk takeover...'
												: 'Balas sebagai CS, ketik / untuk snippet...'
										}
										rows={2}
										className="w-full resize-none bg-transparent text-sm text-[var(--ocm-text)] outline-none placeholder:text-[var(--ocm-text-muted)]"
									/>
									<div className="mt-2 flex flex-wrap items-center gap-1.5">
										<button
											type="button"
											className="ocm-btn !h-8 !px-2.5"
											onClick={handleAttachmentButtonClick}
											disabled={uploadingAttachment}
											title="Kirim PDF / gambar"
										>
											<Paperclip size={13} />
										</button>
										<button type="button" className="ocm-btn !h-8 !px-2.5">
											<Smile size={13} />
										</button>
										<button
											type="button"
											className="ocm-btn !h-8 !px-2.5"
											onClick={handleTemplateButtonClick}
										>
											<Zap size={13} />
											Template
										</button>
										
										<div className="flex-1" />
										<span className="text-[10px] text-[var(--ocm-text-muted)]">
											{draft.length}/4096
										</span>
										<button
											type="submit"
											className="ocm-btn ocm-btn-primary !h-8 !px-3.5"
										>
											<Send size={13} />
											Kirim
										</button>
									</div>
								</div>
							</form>
						</>
					) : (
						<div className="grid min-h-0 flex-1 place-items-center px-6 text-center">
							<div className="max-w-sm">
								<div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-full border border-[var(--ocm-line)] bg-[var(--ocm-surface)] text-[var(--ocm-text-muted)]">
									<MessageCircle size={20} />
								</div>
								<p className="text-sm font-semibold text-[var(--ocm-text)]">
									Pilih percakapan
								</p>
								<p className="mt-1 text-xs leading-relaxed text-[var(--ocm-text-muted)]">
									Inbox siap, belum ada chatroom yang dibuka.
								</p>
							</div>
						</div>
					)}
				</section>

				{isTemplateModalOpen ? (
					<TemplateSelector
						inboxId={activeConversationInboxId}
						onClose={() => setIsTemplateModalOpen(false)}
						onSend={handleSendTemplate}
					/>
				) : null}

				{panelOpen && activeConversation ? (
					<aside className="hidden min-h-0 w-[336px] min-w-[320px] flex-col border-l border-[var(--ocm-line)] bg-[var(--ocm-surface)] xl:flex">
						<div className="border-b border-[var(--ocm-line)] px-5 py-4 text-center">
							<CrmAvatar
								name={displayName || 'Pelanggan'}
								size={64}
								online={activeConversation?.online}
								className="mx-auto"
							/>
							<p className="mt-2 text-sm font-semibold">{displayName || '-'}</p>
							<p className="text-xs text-[var(--ocm-text-muted)]">
								{displayPhone || '-'}
							</p>
							<div className="mt-2 flex items-center justify-center gap-1.5">
								{detailBadges?.vip ? (
									<span className="ocm-tag">VIP</span>
								) : null}
								<span className="ocm-tag">
									Repeat ×
									{detailBadges
										? Math.max(0, detailBadges.repeat_orders || 0)
										: '-'}
								</span>
								<span className="ocm-tag ocm-tag-success">
									Lifetime{' '}
									{detailBadges
										? formatCurrencyIdrCompact(detailBadges.lifetime_value)
										: '-'}
								</span>
							</div>
						</div>

						<div className="min-h-0 flex-1 overflow-y-auto">
							<section className="border-b border-[var(--ocm-line)] p-4">
								<PanelLabel icon={<Sparkles size={11} />}>
									AI Summary
								</PanelLabel>
								{loadingContactDetail ? (
									<div className="rounded-md border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-2.5 py-2 text-xs text-[var(--ocm-text-muted)]">
										Memuat AI summary...
									</div>
								) : (
									<div className="rounded-md border border-[color:color-mix(in_oklab,var(--ocm-warning)_32%,transparent)] bg-[color:color-mix(in_oklab,var(--ocm-warning)_14%,transparent)] px-2.5 py-2 text-xs leading-relaxed text-[var(--ocm-text)]">
										{contactDetail?.ai_summary?.text || 'Belum ada AI summary.'}
									</div>
								)}
							</section>

							<section className="border-b border-[var(--ocm-line)] p-4">
								<PanelLabel icon={<Zap size={11} />}>Live Signals</PanelLabel>
								<SignalRow
									label="Sentiment"
									value={contactDetail?.live_signals?.sentiment?.value || '-'}
									tone={resolveSignalTone(
										contactDetail?.live_signals?.sentiment?.tone,
									)}
								/>
								<SignalRow
									label="Intent"
									value={contactDetail?.live_signals?.intent?.value || '-'}
									tone={resolveSignalTone(
										contactDetail?.live_signals?.intent?.tone,
									)}
								/>
								<SignalRow
									label="Buying Stage"
									value={
										contactDetail?.live_signals?.buying_stage?.value || '-'
									}
									tone={resolveSignalTone(
										contactDetail?.live_signals?.buying_stage?.tone,
									)}
								/>
								<SignalRow
									label="Churn Risk"
									value={contactDetail?.live_signals?.churn_risk?.value || '-'}
									tone={resolveSignalTone(
										contactDetail?.live_signals?.churn_risk?.tone,
									)}
									isLast
								/>
							</section>

							{backendNotes.length > 0 ? (
								<section className="p-4">
									<PanelLabel icon={<AlertCircle size={11} />}>
										Backend Gap Notes
									</PanelLabel>
									<div className="space-y-2">
										{backendNotes.map((note) => (
											<div
												key={note}
												className="rounded-md border border-[var(--ocm-line)] bg-[var(--ocm-surface-soft)] px-2.5 py-2 text-[11px] leading-relaxed text-[var(--ocm-text-muted)]"
											>
												{note}
											</div>
										))}
									</div>
								</section>
							) : null}
						</div>
					</aside>
				) : null}
			</div>

			<Dialog open={isFilterDialogOpen} onOpenChange={setIsFilterDialogOpen}>
				<DialogContent
					showCloseButton={false}
					className="max-h-[calc(100vh-1rem)] w-[min(980px,calc(100vw-1rem))] max-w-none gap-0 overflow-hidden rounded-3xl border border-slate-200 bg-white p-0 text-slate-900 sm:w-[min(980px,calc(100vw-2rem))]"
				>
					<div className="flex items-center justify-between px-5 pb-5 pt-5 sm:px-7">
						<DialogTitle className="text-2xl font-semibold tracking-tight text-slate-900 sm:text-[32px]">
							Filter
						</DialogTitle>
						<button
							type="button"
							onClick={() => setIsFilterDialogOpen(false)}
							className="inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition hover:bg-slate-100 hover:text-slate-700"
						>
							<X size={22} />
						</button>
					</div>

					<div className="overflow-y-auto px-5 pb-7 sm:px-7">
						<div className="grid gap-x-8 gap-y-6 md:grid-cols-2">
							<div className="space-y-2.5">
								<p className="text-sm font-semibold text-slate-700">
									Date Range
								</p>
								<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
									<ChatFilterDateField
										value={draftFilters.dateFrom}
										placeholder="Start date"
										onChange={(nextValue) =>
											setDraftFilters((current) => ({
												...current,
												dateFrom: nextValue,
											}))
										}
									/>
									<ChatFilterDateField
										value={draftFilters.dateTo}
										placeholder="End date"
										onChange={(nextValue) =>
											setDraftFilters((current) => ({
												...current,
												dateTo: nextValue,
											}))
										}
									/>
								</div>
							</div>

							<ChatFilterSelectField
								label="Inbox"
								value={draftFilters.inboxId}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										inboxId: nextValue,
									}))
								}
								placeholder="All Inboxes"
								options={inboxOptions}
								disabled={filterOptionsLoading}
							/>

							<ChatFilterSelectField
								label="Label"
								value={draftFilters.labelId}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										labelId: nextValue,
									}))
								}
								placeholder="All Labels"
								options={labelOptions}
								disabled={filterOptionsLoading}
							/>

							<ChatFilterSelectField
								label="Resolved By"
								value={draftFilters.resolvedById}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										resolvedById: nextValue,
									}))
								}
								placeholder="Choose Agent"
								options={agentOptions}
								disabled={filterOptionsLoading}
							/>

							<ChatFilterSelectField
								label="Agent"
								value={draftFilters.agentId}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										agentId: nextValue,
									}))
								}
								placeholder="Choose Agent"
								options={agentOptions}
								disabled={filterOptionsLoading}
							/>

							<ChatFilterSelectField
								label="AI Agent"
								value={draftFilters.aiAgentId}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										aiAgentId: nextValue,
									}))
								}
								placeholder="Choose AI Agent"
								options={aiAgentOptions}
								disabled={filterOptionsLoading}
							/>

							<ChatFilterSelectField
								label="Status"
								value={draftFilters.status}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										status: nextValue as AdvancedChatFilters['status'],
									}))
								}
								placeholder="All Statuses"
								options={CHAT_STATUS_FILTER_OPTIONS}
							/>

							<ChatFilterSelectField
								label="Pipeline Status"
								value={draftFilters.pipelineStageId}
								onChange={(nextValue) =>
									setDraftFilters((current) => ({
										...current,
										pipelineStageId: nextValue,
									}))
								}
								placeholder="All Statuses"
								options={pipelineStageOptions}
								disabled={filterOptionsLoading}
							/>
						</div>
					</div>

					<div className="grid grid-cols-2 gap-3 border-t border-slate-200 px-5 py-5 sm:flex sm:justify-end sm:px-7">
						<button
							type="button"
							onClick={handleResetAdvancedFilters}
							className="ocm-btn !h-10 !rounded-xl !border-slate-300 !bg-white !px-5 !text-sm !font-semibold !text-slate-700 sm:min-w-[120px]"
						>
							Reset
						</button>
						<button
							type="button"
							onClick={handleApplyAdvancedFilters}
							className="ocm-btn ocm-btn-primary !h-10 !rounded-xl !px-5 !text-sm !font-semibold sm:min-w-[120px]"
						>
							Apply
						</button>
					</div>
				</DialogContent>
			</Dialog>

			<Dialog open={isNewChatDialogOpen} onOpenChange={setIsNewChatDialogOpen}>
				<DialogContent
					showCloseButton={false}
					className="flex max-h-[calc(100vh-1rem)] w-[min(920px,calc(100vw-1rem))] max-w-none flex-col gap-0 overflow-hidden rounded-2xl border border-gray-200 bg-white p-0 text-gray-900 shadow-2xl sm:w-[min(920px,calc(100vw-2rem))]"
				>
					<DialogHeader className="border-b border-gray-100 px-5 py-4 sm:px-6">
						<div className="flex items-start justify-between gap-4">
							<div className="min-w-0">
								<DialogTitle className="text-xl font-bold tracking-tight text-gray-900">
									New Chat
								</DialogTitle>
								<p className="mt-1 text-sm text-gray-500">
									Buat percakapan WhatsApp baru dengan template yang sudah
									disetujui.
								</p>
							</div>
							<button
								type="button"
								onClick={handleCloseNewChatDialog}
								className="rounded-xl p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
							>
								<X size={20} />
							</button>
						</div>
					</DialogHeader>

					<div className="flex-1 overflow-y-auto p-5 sm:p-6">
						<div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(300px,0.85fr)]">
							<div className="space-y-5">
								<div className="space-y-2">
									<label
										htmlFor="new-chat-inbox"
										className="text-xs font-black uppercase tracking-widest text-gray-400"
									>
										Select Inbox
									</label>
									<select
										id="new-chat-inbox"
										value={newChatForm.inboxId}
										onChange={(event) =>
											setNewChatForm((current) => ({
												...current,
												inboxId: event.target.value,
											}))
										}
										disabled={filterOptionsLoading || submittingNewChat}
										className={NEW_CHAT_FIELD_CLASSNAME}
									>
										<option value="">Choose Inbox</option>
										{inboxOptions.map((item) => (
											<option key={item.id} value={item.id}>
												{item.label}
											</option>
										))}
									</select>
									{selectedNewChatInbox?.provider ? (
										<div className="inline-flex rounded-full border border-blue-100 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-600">
											{selectedNewChatInbox.provider === 'official'
												? 'Official WABA'
												: 'Baileys'}
										</div>
									) : null}
								</div>

								<div className="space-y-2">
									<label
										htmlFor="new-chat-name"
										className="text-xs font-black uppercase tracking-widest text-gray-400"
									>
										Name
									</label>
									<input
										id="new-chat-name"
										type="text"
										value={newChatForm.name}
										onChange={(event) =>
											setNewChatForm((current) => ({
												...current,
												name: event.target.value,
											}))
										}
										placeholder="Input Name"
										disabled={submittingNewChat}
										className={NEW_CHAT_FIELD_CLASSNAME}
									/>
								</div>

								<div className="space-y-2">
									<label
										htmlFor="new-chat-phone"
										className="text-xs font-black uppercase tracking-widest text-gray-400"
									>
										Phone Number
									</label>
									<input
										id="new-chat-phone"
										type="tel"
										value={newChatForm.phoneNumber}
										onChange={(event) =>
											setNewChatForm((current) => ({
												...current,
												phoneNumber: formatPhoneForInput(event.target.value),
											}))
										}
										placeholder="+62 85710369281"
										disabled={submittingNewChat}
										className={NEW_CHAT_FIELD_CLASSNAME}
									/>
								</div>

								<div className="space-y-2">
									<label
										htmlFor="new-chat-template"
										className="text-xs font-black uppercase tracking-widest text-gray-400"
									>
										Select Template
									</label>
									<select
										id="new-chat-template"
										value={newChatForm.templateId}
										onChange={(event) =>
											setNewChatForm((current) => ({
												...current,
												templateId: event.target.value,
											}))
										}
										disabled={
											loadingNewChatTemplates ||
											submittingNewChat ||
											!newChatForm.inboxId
										}
										className={NEW_CHAT_FIELD_CLASSNAME}
									>
										<option value="">
											{loadingNewChatTemplates
												? 'Loading templates...'
												: 'Choose Template'}
										</option>
										{newChatTemplates.map((item) => (
											<option key={item.id} value={item.id}>
												{item.name} ({item.language})
											</option>
										))}
									</select>
									{newChatTemplateError ? (
										<p className="rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-medium text-red-600">
											{newChatTemplateError}
										</p>
									) : null}
									{hasUnsupportedNewChatTemplateVariables ? (
										<p className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-700">
											Template ini butuh variabel tambahan dan belum bisa
											dikirim dari modal chat ini.
										</p>
									) : null}
								</div>
							</div>

							<section className="rounded-2xl border border-gray-100 bg-gray-50 p-4">
								<div className="flex items-center justify-between gap-3">
									<div>
										<h3 className="text-sm font-bold text-gray-900">Preview</h3>
										<p className="mt-1 text-xs text-gray-500">
											Tampilan pesan yang akan dikirim.
										</p>
									</div>
									<MessageCircle className="h-5 w-5 text-blue-500" />
								</div>
								<div className="mt-4 rounded-2xl border border-gray-200 bg-[#e5ddd5] p-3 shadow-inner">
									<div className="mb-3 flex items-center gap-2 rounded-xl bg-[#075e54] px-3 py-2 text-white">
										<div className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-bold">
											W
										</div>
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold">
												WhatsApp Business
											</p>
											<p className="text-[11px] text-white/70">Template</p>
										</div>
									</div>
									{selectedNewChatTemplate ? (
										<div className="max-w-[90%] rounded-lg bg-white px-3 py-2 text-sm leading-6 text-gray-800 shadow-sm">
											{newChatPreviewHeader ? (
												<p className="mb-2 break-words font-semibold text-gray-900">
													{newChatPreviewHeader}
												</p>
											) : null}
											<p className="whitespace-pre-wrap break-words text-gray-700">
												{newChatPreviewBody}
											</p>
											{newChatPreviewFooter ? (
												<p className="mt-3 border-t border-gray-100 pt-3 text-xs leading-5 text-gray-400">
													{newChatPreviewFooter}
												</p>
											) : null}
											{newChatPreviewButtons.length > 0 ? (
												<div className="mt-3 space-y-2">
													{newChatPreviewButtons.map((item) => (
														<div
															key={item}
															className="rounded-lg border border-blue-100 bg-blue-50 px-3 py-2 text-center text-sm font-semibold text-blue-600"
														>
															{item}
														</div>
													))}
												</div>
											) : null}
										</div>
									) : (
										<div className="rounded-xl border border-dashed border-white/80 bg-white/70 p-5 text-center text-sm text-gray-500">
											Pilih template untuk melihat preview chat.
										</div>
									)}
								</div>
							</section>
						</div>
					</div>

					<DialogFooter className="mx-0 mb-0 gap-3 rounded-none rounded-b-2xl border-gray-100 bg-gray-50 px-5 py-4 sm:px-6">
						<Button
							type="button"
							variant="outline"
							onClick={handleCloseNewChatDialog}
							className="h-11 rounded-xl border-gray-200 px-6 font-bold text-gray-600 hover:bg-white sm:min-w-[120px]"
						>
							Cancel
						</Button>
						<Button
							type="button"
							onClick={() => void handleStartNewChat()}
							disabled={!canSubmitNewChat}
							className="h-11 rounded-xl bg-blue-600 px-6 font-bold text-white shadow-lg shadow-blue-200 hover:bg-blue-700 disabled:shadow-none sm:min-w-[120px]"
						>
							{submittingNewChat ? 'Starting...' : 'Start Chat'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</main>
	)
}

function PanelLabel({
	icon,
	children,
}: {
	icon: React.ReactNode
	children: React.ReactNode
}) {
	return (
		<div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--ocm-text-muted)]">
			{icon}
			<span>{children}</span>
		</div>
	)
}

function SignalRow({
	label,
	value,
	tone,
	isLast = false,
}: {
	label: string
	value: string
	tone: 'success' | 'warning' | 'info' | 'neutral'
	isLast?: boolean
}) {
	const toneClass =
		tone === 'success'
			? 'text-emerald-500'
			: tone === 'warning'
				? 'text-[var(--ocm-warning)]'
				: tone === 'info'
					? 'text-sky-400'
					: 'text-[var(--ocm-text)]'

	return (
		<div
			className={`flex items-center justify-between py-1.5 text-xs ${
				isLast ? '' : 'border-b border-dashed border-[var(--ocm-line)]'
			}`}
		>
			<span className="text-[var(--ocm-text-muted)]">{label}</span>
			<span className={toneClass}>{value}</span>
		</div>
	)
}
