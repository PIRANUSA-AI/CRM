import { createFileRoute } from '@tanstack/react-router'
import {
	AlertCircle,
	Check,
	CheckCircle2,
	ExternalLink,
	Eye,
	FileText,
	History,
	Keyboard,
	LayoutGrid,
	Loader2,
	Play,
	Plus,
	SendHorizontal,
	Shield,
	Upload,
	UserRound,
	Users,
	Variable,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import { toast } from 'sonner'
import { unwrapPayload } from '@/components/crm/shared'
import { broadcasts, customers, inboxes, whatsappTemplates } from '@/lib/api'
import { randomId } from '@/lib/id'

export const Route = createFileRoute('/_app/broadcast')({
	component: BroadcastPage,
})

type BroadcastRow = {
	id: string
	title: string
	templateName: string
	status: string
	recipients: number
	success: number
	failed: number
	updatedAt: string
}

type TemplateOption = {
	id: string
	name: string
	status: string
	category: string
	language: string
	components: Array<Record<string, any>>
}

type CustomerOption = {
	id: string
	name: string
	phone_number?: string | null
}

type InboxOption = {
	id: string
	name: string
	channelType: string
	isActive: boolean
}

type RecipientMode = 'customers' | 'csv' | 'manual' | 'target'

type RecipientRow = {
	phoneNumber: string
	variables: Record<string, string>
}

type TemplateVariableField = {
	key: string
	componentType: string
}

type AudienceFilters = {
	cities: string[]
	minPaidOrders: number
	lastActiveWithinDays: number
	excludeOptedOut: boolean
}

const DEFAULT_AUDIENCE_FILTERS: AudienceFilters = {
	cities: [],
	minPaidOrders: 1,
	lastActiveWithinDays: 30,
	excludeOptedOut: true,
}

const FALLBACK_ROWS: BroadcastRow[] = [
	{
		id: 'b-1',
		title: 'Promo Ramadan 2026',
		templateName: 'promo_ramadan_2026',
		status: 'COMPLETED',
		recipients: 12420,
		success: 10350,
		failed: 120,
		updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 72).toISOString(),
	},
	{
		id: 'b-2',
		title: 'Launch Kursi Rotan',
		templateName: 'launch_kursi_rotan',
		status: 'COMPLETED',
		recipients: 6200,
		success: 4830,
		failed: 90,
		updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7).toISOString(),
	},
]

const PHONE_HEADER_ALIASES = new Set([
	'phonenumber',
	'phone_number',
	'phone',
	'number',
	'to',
	'whatsapp',
	'whatsappnumber',
])

function mapBroadcast(input: any): BroadcastRow {
	return {
		id: String(input?.id || randomId()),
		title: String(input?.title || 'Campaign'),
		templateName: String(
			input?.templateName ||
				input?.template_name ||
				input?.message_content ||
				'-',
		),
		status: String(input?.status || 'DRAFT').toUpperCase(),
		recipients: Number(input?.totalRecipients || input?.total_recipients || 0),
		success: Number(input?.successCount || input?.success_count || 0),
		failed: Number(input?.failedCount || input?.failed_count || 0),
		updatedAt: String(
			input?.updatedAt ||
				input?.updated_at ||
				input?.createdAt ||
				input?.created_at ||
				new Date().toISOString(),
		),
	}
}

function mapTemplate(input: any): TemplateOption {
	return {
		id: String(input?.id || randomId()),
		name: String(input?.name || 'template'),
		status: String(input?.status || 'UNKNOWN').toUpperCase(),
		category: String(input?.category || 'UTILITY').toUpperCase(),
		language: String(input?.language || input?.locale || 'id').toLowerCase(),
		components: Array.isArray(input?.components) ? input.components : [],
	}
}

function mapInbox(input: any): InboxOption {
	return {
		id: String(input?.id || randomId()),
		name: String(input?.name || 'Inbox'),
		channelType: String(
			input?.channel_type || input?.channelType || '',
		).toLowerCase(),
		isActive: input?.is_active !== false && input?.isActive !== false,
	}
}

function statusToneClass(status: string) {
	if (status === 'COMPLETED') return 'ocm-tag-success'
	if (status === 'FAILED' || status === 'CANCELLED') return 'ocm-tag-danger'
	if (status === 'PROCESSING' || status === 'SCHEDULED')
		return 'ocm-tag-warning'
	return ''
}

function formatRelativeTime(iso: string) {
	const date = new Date(iso)
	if (Number.isNaN(date.getTime())) return '-'
	const diffMinutes = Math.max(
		1,
		Math.floor((Date.now() - date.getTime()) / (1000 * 60)),
	)
	if (diffMinutes < 60) return `${diffMinutes}m lalu`
	if (diffMinutes < 24 * 60) return `${Math.floor(diffMinutes / 60)} jam lalu`
	if (diffMinutes < 7 * 24 * 60) {
		return `${Math.floor(diffMinutes / (24 * 60))} hari lalu`
	}
	if (diffMinutes < 30 * 24 * 60) {
		return `${Math.floor(diffMinutes / (7 * 24 * 60))} minggu lalu`
	}
	return date.toLocaleDateString('id-ID', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
	})
}

function formatMoneyCompact(amount: number) {
	if (!Number.isFinite(amount) || amount <= 0) return 'Rp 0'
	if (amount >= 1_000_000_000)
		return `Rp ${(amount / 1_000_000_000).toFixed(1)}M`
	if (amount >= 1_000_000) return `Rp ${Math.round(amount / 1_000_000)}jt`
	return `Rp ${Math.round(amount / 1000)}rb`
}

function formatDuration(totalMinutes: number) {
	const safeMinutes = Math.max(1, Math.round(totalMinutes))
	const hours = Math.floor(safeMinutes / 60)
	const minutes = safeMinutes % 60
	if (hours <= 0) return `~${safeMinutes}m`
	if (minutes === 0) return `~${hours}j`
	return `~${hours}j ${minutes}m`
}

function normalizePhoneNumber(value: string) {
	const digits = value.replace(/[^\d]/g, '')
	return digits.length >= 8 ? digits : ''
}

function normalizeHeaderKey(value: string) {
	return value
		.replace(/^\uFEFF/, '')
		.toLowerCase()
		.replace(/[\s_-]/g, '')
}

function normalizeVariableKey(value: string) {
	const trimmed = value.trim()
	const match = trimmed.match(/^\{\{\s*(\d+)\s*\}\}$/)
	return match ? match[1] : trimmed
}

function parseCsvLine(line: string): string[] {
	const values: string[] = []
	let current = ''
	let inQuotes = false

	for (let index = 0; index < line.length; index += 1) {
		const char = line[index]
		if (char === '"') {
			if (inQuotes && line[index + 1] === '"') {
				current += '"'
				index += 1
			} else {
				inQuotes = !inQuotes
			}
			continue
		}

		if (char === ',' && !inQuotes) {
			values.push(current.trim())
			current = ''
			continue
		}

		current += char
	}

	values.push(current.trim())
	return values
}

function parseCsvText(input: string) {
	const lines = input
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)

	if (lines.length === 0) throw new Error('CSV file is empty')
	const headers = parseCsvLine(lines[0]).map((header) => header.trim())
	if (headers.length === 0) throw new Error('CSV header is required')

	const rows: Array<Record<string, string>> = []
	for (let lineIndex = 1; lineIndex < lines.length; lineIndex += 1) {
		const cells = parseCsvLine(lines[lineIndex])
		const row: Record<string, string> = {}
		for (let columnIndex = 0; columnIndex < headers.length; columnIndex += 1) {
			row[headers[columnIndex]] = cells[columnIndex]?.trim() || ''
		}
		rows.push(row)
	}

	return { headers, rows }
}

function findPhoneHeader(headers: string[]) {
	return (
		headers.find((header) =>
			PHONE_HEADER_ALIASES.has(normalizeHeaderKey(header)),
		) || null
	)
}

function dedupeRecipients(rows: RecipientRow[]) {
	const map = new Map<string, RecipientRow>()
	for (const row of rows) {
		const phoneNumber = normalizePhoneNumber(row.phoneNumber)
		if (!phoneNumber || map.has(phoneNumber)) continue
		map.set(phoneNumber, { phoneNumber, variables: row.variables })
	}
	return Array.from(map.values())
}

function parseCsvRecipients(input: string) {
	const csv = parseCsvText(input)
	const phoneHeader = findPhoneHeader(csv.headers)
	if (!phoneHeader) throw new Error('CSV must include phoneNumber column')

	let invalidPhoneRows = 0
	const recipients: RecipientRow[] = []
	for (const row of csv.rows) {
		const phoneNumber = normalizePhoneNumber(row[phoneHeader] || '')
		if (!phoneNumber) {
			invalidPhoneRows += 1
			continue
		}

		const variables: Record<string, string> = {}
		for (const header of csv.headers) {
			if (header === phoneHeader) continue
			const value = String(row[header] || '').trim()
			if (!value) continue
			variables[normalizeVariableKey(header)] = value
		}

		recipients.push({ phoneNumber, variables })
	}

	return {
		columns: csv.headers,
		invalidPhoneRows,
		recipients: dedupeRecipients(recipients),
	}
}

function parseManualRecipients(input: string, templateVariableKeys: string[]) {
	const rows: RecipientRow[] = []
	const rowErrors: string[] = []
	const lines = input
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)

	for (let index = 0; index < lines.length; index += 1) {
		const columns = parseCsvLine(lines[index])
		const phoneNumber = normalizePhoneNumber(columns[0] || '')
		if (!phoneNumber) {
			rowErrors.push(`Line ${index + 1} has no valid phone number`)
			continue
		}

		const variables: Record<string, string> = {}
		for (let columnIndex = 1; columnIndex < columns.length; columnIndex += 1) {
			const value = columns[columnIndex]?.trim() || ''
			if (!value) continue
			const key = templateVariableKeys[columnIndex - 1] || String(columnIndex)
			variables[key] = value
		}

		rows.push({ phoneNumber, variables })
	}

	return { recipients: dedupeRecipients(rows), rowErrors }
}

function extractTemplateVariables(template: TemplateOption | null) {
	if (!template) return []
	const fields = new Map<string, TemplateVariableField>()
	for (const component of template.components) {
		if (typeof component?.text !== 'string') continue
		const componentType = String(component?.type || 'body').toLowerCase()
		for (const match of component.text.matchAll(/\{\{\s*(\d+)\s*\}\}/g)) {
			const numeric = Number(match[1])
			if (!Number.isFinite(numeric) || numeric <= 0) continue
			const key = String(numeric)
			if (!fields.has(key)) {
				fields.set(key, { key, componentType })
			}
		}
	}
	return Array.from(fields.values()).sort(
		(a, b) => Number(a.key) - Number(b.key),
	)
}

function toVariableComponentLabel(componentType: string) {
	const normalized = componentType.trim().toLowerCase()
	if (!normalized) return 'body'
	if (normalized === 'buttons') return 'button'
	return normalized
}

function extractTemplatePreviewText(template: TemplateOption | null) {
	if (!template) return ''
	const bodyComponent = template.components.find(
		(component) => String(component?.type || '').toUpperCase() === 'BODY',
	)
	const bodyText =
		typeof bodyComponent?.text === 'string' ? bodyComponent.text.trim() : ''
	return bodyText || `Template: ${template.name}`
}

function applyTemplatePreviewDefaults(
	text: string,
	defaultVariables: Record<string, string>,
) {
	return text.replace(/\{\{\s*(\d+)\s*\}\}/g, (_match, key: string) => {
		return defaultVariables[key]?.trim() || `{{${key}}}`
	})
}

function sanitizeTemplateDefaults(defaultVariables: Record<string, string>) {
	const result: Record<string, string> = {}
	for (const [key, value] of Object.entries(defaultVariables)) {
		const nextValue = value.trim()
		if (nextValue) result[key] = nextValue
	}
	return result
}

function missingVariableKeys(
	recipientVariables: Record<string, string>,
	requiredKeys: string[],
	defaultVariables: Record<string, string>,
) {
	return requiredKeys.filter((key) => {
		const value = (
			recipientVariables[key] ||
			defaultVariables[key] ||
			''
		).trim()
		return value.length === 0
	})
}

function formatAudienceFilterChips(filters: AudienceFilters) {
	return [
		`Orders >= ${filters.minPaidOrders}`,
		`Last active < ${filters.lastActiveWithinDays} hari`,
		filters.excludeOptedOut ? 'Tidak opt-out' : 'Termasuk opt-out',
	]
}

type InfoTileProps = {
	label: string
	value: string
	description: string
}

function InfoTile({ label, value, description }: InfoTileProps) {
	return (
		<div className="rounded-md border border-border bg-muted/40 p-2.5">
			<p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
				{label}
			</p>
			<p className="mt-1 text-sm font-semibold">{value}</p>
			<p className="mt-0.5 text-[11px] text-muted-foreground">{description}</p>
		</div>
	)
}

function BroadcastPage() {
	const [loading, setLoading] = useState(true)
	const [activeTab, setActiveTab] = useState<'create' | 'active' | 'history'>(
		'create',
	)
	const [rows, setRows] = useState<BroadcastRow[]>([])
	const [templates, setTemplates] = useState<TemplateOption[]>([])
	const [inboxOptions, setInboxOptions] = useState<InboxOption[]>([])
	const [inboxesLoading, setInboxesLoading] = useState(true)
	const [selectedInboxId, setSelectedInboxId] = useState('')
	const [loadingTemplates, setLoadingTemplates] = useState(false)
	const [templateLoadError, setTemplateLoadError] = useState<string | null>(
		null,
	)
	const [customerOptions, setCustomerOptions] = useState<CustomerOption[]>([])
	const [customersLoading, setCustomersLoading] = useState(true)
	const [selectedTemplate, setSelectedTemplate] = useState<string>('')
	const [recipientMode, setRecipientMode] = useState<RecipientMode>('customers')
	const [selectedCustomerIds, setSelectedCustomerIds] = useState<string[]>([])
	const [customerSearch, setCustomerSearch] = useState('')
	const [csvFileName, setCsvFileName] = useState('')
	const [csvColumns, setCsvColumns] = useState<string[]>([])
	const [csvRecipients, setCsvRecipients] = useState<RecipientRow[]>([])
	const [selectedCsvPhones, setSelectedCsvPhones] = useState<string[]>([])
	const [csvInvalidRows, setCsvInvalidRows] = useState(0)
	const [csvError, setCsvError] = useState<string | null>(null)
	const [manualInput, setManualInput] = useState('')
	const [audienceFilters, setAudienceFilters] = useState<AudienceFilters>(
		DEFAULT_AUDIENCE_FILTERS,
	)
	const [audiencePreviewTotal, setAudiencePreviewTotal] = useState(0)
	const [audiencePreviewLoading, setAudiencePreviewLoading] = useState(false)
	const [audiencePreviewError, setAudiencePreviewError] = useState<
		string | null
	>(null)
	const [isFilterEditorOpen, setIsFilterEditorOpen] = useState(false)
	const [delaySeconds, setDelaySeconds] = useState(5)
	const [scheduledAt, setScheduledAt] = useState('')
	const [defaultTemplateVariables, setDefaultTemplateVariables] = useState<
		Record<string, string>
	>({})
	const [submittingAction, setSubmittingAction] = useState<
		'draft' | 'send' | null
	>(null)
	const csvInputRef = useRef<HTMLInputElement | null>(null)

	const selectedTemplateData = useMemo(() => {
		return templates.find((item) => item.id === selectedTemplate) || null
	}, [selectedTemplate, templates])

	const whatsappInboxes = useMemo(
		() =>
			inboxOptions.filter(
				(item) => item.channelType === 'whatsapp' && item.isActive,
			),
		[inboxOptions],
	)

	const selectedInboxData = useMemo(() => {
		return whatsappInboxes.find((item) => item.id === selectedInboxId) || null
	}, [selectedInboxId, whatsappInboxes])

	const templateVariableFields = useMemo(
		() => extractTemplateVariables(selectedTemplateData),
		[selectedTemplateData],
	)

	const templateVariableKeys = useMemo(
		() => templateVariableFields.map((field) => field.key),
		[templateVariableFields],
	)

	const sanitizedDefaultVariables = useMemo(
		() => sanitizeTemplateDefaults(defaultTemplateVariables),
		[defaultTemplateVariables],
	)

	const missingDefaultKeys = useMemo(
		() =>
			templateVariableKeys.filter(
				(key) =>
					String(defaultTemplateVariables[key] || '').trim().length === 0,
			),
		[templateVariableKeys, defaultTemplateVariables],
	)

	const manualParsed = useMemo(
		() => parseManualRecipients(manualInput, templateVariableKeys),
		[manualInput, templateVariableKeys],
	)

	const filteredCustomers = useMemo(() => {
		const search = customerSearch.trim().toLowerCase()
		return customerOptions
			.filter((customer) => String(customer.phone_number || '').trim())
			.filter((customer) => {
				if (!search) return true
				return `${customer.name || ''} ${customer.phone_number || ''}`
					.toLowerCase()
					.includes(search)
			})
			.slice(0, 60)
	}, [customerOptions, customerSearch])

	const selectedCsvRecipients = useMemo(() => {
		const selected = new Set(selectedCsvPhones)
		return csvRecipients.filter((recipient) =>
			selected.has(recipient.phoneNumber),
		)
	}, [csvRecipients, selectedCsvPhones])

	const selectedRecipientCount = useMemo(() => {
		if (recipientMode === 'customers') return selectedCustomerIds.length
		if (recipientMode === 'csv') return selectedCsvRecipients.length
		if (recipientMode === 'manual') return manualParsed.recipients.length
		return audiencePreviewTotal
	}, [
		recipientMode,
		selectedCustomerIds.length,
		selectedCsvRecipients.length,
		manualParsed.recipients.length,
		audiencePreviewTotal,
	])

	useEffect(() => {
		let active = true

		const load = async () => {
			const [jobsRes, customersRes, inboxesRes] = await Promise.allSettled([
				broadcasts.listJobs({ page: 1, limit: 12 }),
				customers.list({ per_page: 100 }),
				inboxes.list(),
			])

			if (!active) return

			const errors: string[] = []

			if (jobsRes.status === 'fulfilled') {
				setRows(unwrapPayload<any>(jobsRes.value).map(mapBroadcast))
			} else {
				setRows(FALLBACK_ROWS)
				errors.push(jobsRes.reason?.message || 'Gagal memuat jobs broadcast')
			}

			if (customersRes.status === 'fulfilled') {
				const customerData = Array.isArray((customersRes.value as any)?.payload)
					? (customersRes.value as any).payload
					: Array.isArray((customersRes.value as any)?.data)
						? (customersRes.value as any).data
						: []
				setCustomerOptions(
					customerData.map((item: any) => ({
						id: String(item.id),
						name: String(item.name || 'Unknown'),
						phone_number: item.phone_number || item.phone || null,
					})),
				)
			} else {
				setCustomerOptions([])
				errors.push(customersRes.reason?.message || 'Gagal memuat customer')
			}

			if (inboxesRes.status === 'fulfilled') {
				setInboxOptions(unwrapPayload<any>(inboxesRes.value).map(mapInbox))
			} else {
				setInboxOptions([])
				errors.push(inboxesRes.reason?.message || 'Gagal memuat inbox')
			}

			if (errors.length > 0) {
				toast.error(errors[0] || 'Gagal memuat data broadcast')
			}

			setLoading(false)
			setCustomersLoading(false)
			setInboxesLoading(false)
		}

		load()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		let active = true

		setSelectedTemplate('')
		setTemplates([])
		setTemplateLoadError(null)

		if (!selectedInboxId) {
			setLoadingTemplates(false)
			return () => {
				active = false
			}
		}

		const loadTemplates = async () => {
			setLoadingTemplates(true)
			try {
				const response = await whatsappTemplates.list('APPROVED', undefined, {
					inboxId: selectedInboxId,
				})
				if (!active) return
				setTemplates(unwrapPayload<any>(response).map(mapTemplate))
			} catch (error: any) {
				if (!active) return
				setTemplates([])
				setTemplateLoadError(
					error?.message || 'Gagal memuat template untuk inbox ini',
				)
			} finally {
				if (active) setLoadingTemplates(false)
			}
		}

		loadTemplates()
		return () => {
			active = false
		}
	}, [selectedInboxId])

	useEffect(() => {
		setDefaultTemplateVariables((prev) => {
			const next: Record<string, string> = {}
			for (const key of templateVariableKeys) {
				next[key] = prev[key] || ''
			}
			return next
		})
	}, [templateVariableKeys])

	useEffect(() => {
		let active = true
		const timer = window.setTimeout(async () => {
			setAudiencePreviewLoading(true)
			setAudiencePreviewError(null)
			try {
				const response = await broadcasts.previewAudience(audienceFilters)
				if (!active) return
				setAudiencePreviewTotal(Number(response.payload?.total || 0))
			} catch (error: any) {
				if (!active) return
				setAudiencePreviewTotal(0)
				setAudiencePreviewError(
					error?.message || 'Gagal menghitung target audience',
				)
			} finally {
				if (active) setAudiencePreviewLoading(false)
			}
		}, 250)

		return () => {
			active = false
			window.clearTimeout(timer)
		}
	}, [audienceFilters])

	const audienceCount = selectedRecipientCount
	const estimatedCost = audienceCount * 50
	const estimatedMinutes = Math.max(1, audienceCount / 120)
	const estimatedFinish = useMemo(() => {
		const end = new Date(Date.now() + estimatedMinutes * 60 * 1000)
		return `${end.toLocaleTimeString('id-ID', {
			hour: '2-digit',
			minute: '2-digit',
			timeZone: 'Asia/Jakarta',
		})} WIB`
	}, [estimatedMinutes])

	const activeRows = rows.filter((row) =>
		['SENDING', 'PROCESSING', 'SCHEDULED', 'QUEUED'].includes(row.status),
	)
	const historyRows = rows.filter(
		(row) =>
			!['SENDING', 'PROCESSING', 'SCHEDULED', 'QUEUED'].includes(row.status),
	)
	const audienceFilterChips = formatAudienceFilterChips(audienceFilters)
	const templatePreviewText = applyTemplatePreviewDefaults(
		extractTemplatePreviewText(selectedTemplateData),
		defaultTemplateVariables,
	)
	const previewText = templatePreviewText
	const previewLines = previewText
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean)
	const campaignTitle =
		selectedTemplateData?.name.replace(/[_-]+/g, ' ').trim() ||
		'Broadcast Campaign'
	const isTemplateStepComplete = selectedTemplateData !== null
	const isAudienceStepComplete =
		recipientMode === 'customers'
			? selectedCustomerIds.length > 0
			: recipientMode === 'csv'
				? selectedCsvRecipients.length > 0
				: recipientMode === 'manual'
					? manualParsed.recipients.length > 0 &&
						manualParsed.rowErrors.length === 0
					: audiencePreviewTotal > 0 && !audiencePreviewError
	const canShowAudienceStep = isTemplateStepComplete
	const canShowVariablesStep = canShowAudienceStep && isAudienceStepComplete
	const canShowScheduleStep =
		canShowVariablesStep && missingDefaultKeys.length === 0

	const validateRequiredVariables = (recipients: RecipientRow[]) => {
		if (templateVariableKeys.length === 0) return true
		const firstMissing = recipients.findIndex((recipient) => {
			return (
				missingVariableKeys(
					recipient.variables,
					templateVariableKeys,
					sanitizedDefaultVariables,
				).length > 0
			)
		})
		if (firstMissing < 0) return true

		const missing = missingVariableKeys(
			recipients[firstMissing].variables,
			templateVariableKeys,
			sanitizedDefaultVariables,
		)
		toast.error(
			`Missing variables for recipient #${firstMissing + 1}: ${missing
				.map((key) => `{{${key}}}`)
				.join(', ')}`,
		)
		return false
	}

	const buildTargetAudience = () => {
		if (recipientMode === 'customers') {
			if (selectedCustomerIds.length === 0) {
				toast.error('Pilih minimal satu customer')
				return null
			}
			const customerRecipients = selectedCustomerIds.map(() => ({
				phoneNumber: '',
				variables: {},
			}))
			if (!validateRequiredVariables(customerRecipients)) return null
			return {
				type: 'contacts',
				contactIds: selectedCustomerIds,
				delaySeconds,
			}
		}

		if (recipientMode === 'csv') {
			if (csvRecipients.length === 0) {
				toast.error('Upload CSV berisi minimal satu recipient')
				return null
			}
			if (selectedCsvRecipients.length === 0) {
				toast.error('Pilih minimal satu recipient CSV')
				return null
			}
			if (!validateRequiredVariables(selectedCsvRecipients)) return null
			return {
				type: 'numbers',
				source: 'csv',
				recipients: selectedCsvRecipients,
				columns: csvColumns,
				delaySeconds,
			}
		}

		if (recipientMode === 'manual') {
			if (manualParsed.rowErrors.length > 0) {
				toast.error(manualParsed.rowErrors[0])
				return null
			}
			if (manualParsed.recipients.length === 0) {
				toast.error('Masukkan minimal satu nomor valid')
				return null
			}
			if (!validateRequiredVariables(manualParsed.recipients)) return null
			return {
				type: 'numbers',
				source: 'manual',
				recipients: manualParsed.recipients,
				delaySeconds,
			}
		}

		if (audiencePreviewTotal <= 0) {
			toast.error('Target audience tidak memiliki kontak eligible')
			return null
		}
		const targetRecipients = Array.from(
			{ length: audiencePreviewTotal },
			() => ({
				phoneNumber: '',
				variables: {},
			}),
		)
		if (!validateRequiredVariables(targetRecipients)) return null
		return {
			type: 'filters',
			source: 'target_audience',
			filters: audienceFilters,
			delaySeconds,
		}
	}

	const handleCreateBroadcast = async (action: 'draft' | 'send') => {
		if (!selectedInboxId) {
			toast.error('Pilih inbox WhatsApp dulu')
			return
		}

		if (!selectedTemplateData) {
			toast.error('Pilih template WhatsApp dulu')
			return
		}

		const targetAudience = buildTargetAudience()
		if (!targetAudience) return

		setSubmittingAction(action)
		try {
			const response = await broadcasts.create({
				title: campaignTitle,
				message_type: 'template',
				message_content: selectedTemplateData.name,
				template_name: selectedTemplateData.name,
				template_language: selectedTemplateData.language || 'en_US',
				template_params: {
					inbox_id: selectedInboxId,
					template_name: selectedTemplateData.name,
					language: selectedTemplateData.language || 'en_US',
					components:
						templateVariableKeys.length > 0
							? [{ type: 'body', parameters: [] }]
							: [],
					...(Object.keys(sanitizedDefaultVariables).length > 0
						? { variable_defaults: sanitizedDefaultVariables }
						: {}),
				},
				target_audience: {
					...targetAudience,
					inbox_id: selectedInboxId,
				},
				scheduled_at:
					action === 'send' && scheduledAt ? scheduledAt : undefined,
			})

			const created = response.payload
			if (action === 'send' && created?.id) {
				await broadcasts.send(created.id)
				toast.success(
					scheduledAt
						? 'Campaign dijadwalkan'
						: 'Campaign dibuat dan masuk antrean',
				)
			} else {
				toast.success('Draft campaign tersimpan')
			}

			const jobsRes = await broadcasts.listJobs({ page: 1, limit: 12 })
			setRows(unwrapPayload<any>(jobsRes).map(mapBroadcast))
		} catch (error: any) {
			toast.error(error?.message || 'Gagal membuat broadcast')
		} finally {
			setSubmittingAction(null)
		}
	}

	const handleCsvFileChange = async (event: ChangeEvent<HTMLInputElement>) => {
		const file = event.target.files?.[0]
		if (!file) return

		try {
			const parsed = parseCsvRecipients(await file.text())
			if (parsed.recipients.length === 0) {
				throw new Error('No valid recipients found in CSV')
			}
			setCsvFileName(file.name)
			setCsvColumns(parsed.columns)
			setCsvRecipients(parsed.recipients)
			setSelectedCsvPhones(parsed.recipients.map((item) => item.phoneNumber))
			setCsvInvalidRows(parsed.invalidPhoneRows)
			setCsvError(null)
			toast.success(`${parsed.recipients.length} recipients loaded from CSV`)
		} catch (error: any) {
			setCsvFileName('')
			setCsvColumns([])
			setCsvRecipients([])
			setSelectedCsvPhones([])
			setCsvInvalidRows(0)
			setCsvError(error?.message || 'Failed to parse CSV')
			toast.error(error?.message || 'Failed to parse CSV')
		}
	}

	const handleClearCsv = () => {
		if (csvInputRef.current) csvInputRef.current.value = ''
		setCsvFileName('')
		setCsvColumns([])
		setCsvRecipients([])
		setSelectedCsvPhones([])
		setCsvInvalidRows(0)
		setCsvError(null)
	}

	const toggleCsvRecipient = (phoneNumber: string) => {
		setSelectedCsvPhones((prev) =>
			prev.includes(phoneNumber)
				? prev.filter((item) => item !== phoneNumber)
				: [...prev, phoneNumber],
		)
	}

	const toggleCustomer = (customerId: string) => {
		setSelectedCustomerIds((prev) =>
			prev.includes(customerId)
				? prev.filter((item) => item !== customerId)
				: [...prev, customerId],
		)
	}

	return (
		<main className="flex min-h-0 flex-1 flex-col overflow-hidden bg-background text-foreground">
			<section className="shrink-0 border-b border-border bg-background px-4 py-4 lg:px-8">
				<div className="w-full max-w-[1600px]">
					<h1 className="text-2xl font-bold tracking-tight text-foreground lg:text-3xl">
						Broadcast
					</h1>
					<p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted-foreground lg:text-base">
						Send WhatsApp template messages to multiple recipients at once
					</p>
					<div className="mt-4 inline-grid w-full max-w-xl grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:w-auto sm:min-w-[520px]">
						{[
							{
								key: 'create' as const,
								label: 'Create Broadcast',
								icon: LayoutGrid,
							},
							{ key: 'active' as const, label: 'Active Jobs', icon: Play },
							{ key: 'history' as const, label: 'History', icon: History },
						].map((item) => {
							const Icon = item.icon
							return (
								<button
									key={item.key}
									type="button"
									onClick={() => setActiveTab(item.key)}
									className={`inline-flex min-h-9 items-center justify-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition sm:text-sm ${
										activeTab === item.key
											? 'bg-card text-foreground shadow-sm'
											: 'text-muted-foreground hover:text-foreground'
									}`}
								>
									<Icon size={16} />
									{item.label}
								</button>
							)
						})}
					</div>
				</div>
			</section>

			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 lg:px-8">
				{activeTab === 'create' ? (
					<div className="grid w-full max-w-[1600px] gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(380px,0.95fr)]">
						<div className="min-w-0 space-y-5">
							<section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
								<h2 className="text-base font-semibold">Pricing Information</h2>
								<p className="mt-3 max-w-5xl text-sm leading-6 text-muted-foreground">
									Sending WhatsApp template messages incurs charges from Meta.
									Costs vary by category and destination country.
								</p>
								<div className="mt-4 flex flex-wrap gap-5 text-sm font-semibold text-emerald-600">
									<a
										href="https://www.whatsapp.com/business/pricing"
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 hover:text-emerald-700"
									>
										View WhatsApp Pricing
										<ExternalLink size={13} />
									</a>
									<a
										href="https://business.facebook.com/settings/payment-methods/"
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 hover:text-emerald-700"
									>
										Add Payment Method in Meta Business
										<ExternalLink size={13} />
									</a>
								</div>
							</section>

							<section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
								<h2 className="text-sm font-semibold text-muted-foreground">
									Select Inbox
								</h2>
								<div className="relative mt-3">
									<SendHorizontal
										size={16}
										className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
									/>
									<select
										className="ocm-select h-12 bg-background !pl-11 !pr-10 text-sm font-semibold text-foreground"
										value={selectedInboxId}
										onChange={(event) => setSelectedInboxId(event.target.value)}
										disabled={inboxesLoading || whatsappInboxes.length === 0}
									>
										<option value="">
											{inboxesLoading
												? 'Loading inboxes...'
												: whatsappInboxes.length > 0
													? 'Choose a WhatsApp inbox...'
													: 'No active WhatsApp inbox available'}
										</option>
										{whatsappInboxes.map((inbox) => (
											<option key={inbox.id} value={inbox.id}>
												{inbox.name}
											</option>
										))}
									</select>
								</div>
								{selectedInboxData ? (
									<div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
										<div className="mt-0.5 inline-grid h-7 w-7 place-items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 text-emerald-500">
											<Check size={13} />
										</div>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold">
												{selectedInboxData.name}
											</p>
											<p className="text-xs text-muted-foreground">
												Templates will be filtered for this inbox only
											</p>
										</div>
									</div>
								) : (
									<p className="mt-3 text-sm text-muted-foreground">
										Pilih inbox dulu sebelum memilih template.
									</p>
								)}
							</section>

							{selectedInboxId ? (
								<section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
									<h2 className="text-sm font-semibold text-muted-foreground">
										Select Template
									</h2>
									{loadingTemplates ? (
										<div className="mt-3 rounded-lg border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
											Loading approved templates for this inbox...
										</div>
									) : templateLoadError ? (
										<div className="mt-3 flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
											<AlertCircle size={16} className="mt-0.5 shrink-0" />
											<p>{templateLoadError}</p>
										</div>
									) : templates.length > 0 ? (
										<>
											<div className="relative mt-3">
												<FileText
													size={16}
													className="pointer-events-none absolute left-4 top-1/2 z-10 -translate-y-1/2 text-muted-foreground"
												/>
												<select
													className="ocm-select h-12 bg-background !pl-11 !pr-10 text-sm font-semibold text-foreground"
													value={selectedTemplate}
													onChange={(event) =>
														setSelectedTemplate(event.target.value)
													}
												>
													<option value="">Choose a template...</option>
													{templates.map((template) => (
														<option key={template.id} value={template.id}>
															{template.name} - {template.category}
														</option>
													))}
												</select>
											</div>
											{selectedTemplateData ? (
												<div className="mt-3 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-3">
													<div className="mt-0.5 inline-grid h-7 w-7 place-items-center rounded-md border border-emerald-500/35 bg-emerald-500/10 text-emerald-500">
														<Check size={13} />
													</div>
													<div className="min-w-0 flex-1">
														<p className="truncate text-sm font-semibold">
															{selectedTemplateData.name}
														</p>
														<p className="text-xs text-muted-foreground">
															{selectedTemplateData.category || 'UTILITY'} -{' '}
															{selectedTemplateData.language || 'id'}
														</p>
													</div>
													<span
														className={`ocm-tag ${
															selectedTemplateData.status === 'APPROVED'
																? 'ocm-tag-success'
																: ''
														}`}
													>
														{selectedTemplateData.status || 'UNKNOWN'}
													</span>
												</div>
											) : null}
										</>
									) : (
										<div className="mt-3 rounded-lg border border-dashed border-border bg-muted/20 p-4 text-sm text-muted-foreground">
											No approved templates found for this inbox.
										</div>
									)}
								</section>
							) : (
								<div className="rounded-xl border border-dashed border-border bg-card/70 p-6 text-center text-sm text-muted-foreground shadow-sm">
									Pilih inbox terlebih dahulu untuk melihat template yang
									tersedia.
								</div>
							)}

							{!canShowAudienceStep ? (
								<div className="rounded-xl border border-dashed border-border bg-card/70 p-6 text-center text-sm text-muted-foreground shadow-sm">
									Pilih inbox lalu template sebelum memilih recipients dan
									mengirim broadcast.
								</div>
							) : null}

							{canShowAudienceStep ? (
								<section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
									<div className="mb-4 flex items-center gap-3">
										<span className="inline-grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
											2
										</span>
										<h2 className="text-xl font-semibold">Select Recipients</h2>
									</div>
									<div className="space-y-3">
										<div className="grid gap-1 rounded-lg border border-border bg-muted/40 p-1 sm:grid-cols-4">
											{[
												{
													mode: 'customers' as const,
													label: 'From Customers',
													icon: Users,
												},
												{
													mode: 'csv' as const,
													label: 'Upload CSV',
													icon: FileText,
												},
												{
													mode: 'manual' as const,
													label: 'Manual Input',
													icon: Keyboard,
												},
												{
													mode: 'target' as const,
													label: 'TargetAudience',
													icon: UserRound,
												},
											].map((item) => {
												const Icon = item.icon
												return (
													<button
														key={item.mode}
														type="button"
														onClick={() => setRecipientMode(item.mode)}
														className={`inline-flex min-h-10 items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition ${
															recipientMode === item.mode
																? 'bg-card text-foreground shadow-sm'
																: 'text-muted-foreground hover:text-foreground'
														}`}
													>
														<Icon size={14} />
														{item.label}
													</button>
												)
											})}
										</div>

										{recipientMode === 'target' ? (
											<div className="space-y-2">
												<div className="flex flex-wrap gap-1.5">
													{audienceFilterChips.map((item) => (
														<span
															key={item}
															className="inline-flex items-center rounded-full border border-primary/25 bg-primary/10 px-2.5 py-1 text-[11px] font-semibold text-primary"
														>
															{item}
														</span>
													))}
													<button
														type="button"
														className="ocm-pill border-dashed"
														onClick={() =>
															setIsFilterEditorOpen((prev) => !prev)
														}
													>
														<Plus size={11} />
														filter
													</button>
												</div>

												{isFilterEditorOpen ? (
													<div className="grid gap-2 rounded-lg border border-border bg-muted/40 p-3 sm:grid-cols-2">
														<label className="space-y-1 text-xs font-semibold text-muted-foreground">
															Min Orders
															<input
																type="number"
																min={0}
																className="ocm-input h-9 bg-card text-sm font-normal text-foreground"
																value={audienceFilters.minPaidOrders}
																onChange={(event) =>
																	setAudienceFilters((prev) => ({
																		...prev,
																		minPaidOrders: Math.max(
																			0,
																			Number(event.target.value) || 0,
																		),
																	}))
																}
															/>
														</label>
														<label className="space-y-1 text-xs font-semibold text-muted-foreground">
															Last active kurang dari
															<input
																type="number"
																min={1}
																className="ocm-input h-9 bg-card text-sm font-normal text-foreground"
																value={audienceFilters.lastActiveWithinDays}
																onChange={(event) =>
																	setAudienceFilters((prev) => ({
																		...prev,
																		lastActiveWithinDays: Math.max(
																			1,
																			Number(event.target.value) || 1,
																		),
																	}))
																}
															/>
														</label>
														<label className="flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs font-semibold">
															<input
																type="checkbox"
																checked={audienceFilters.excludeOptedOut}
																onChange={(event) =>
																	setAudienceFilters((prev) => ({
																		...prev,
																		excludeOptedOut: event.target.checked,
																	}))
																}
															/>
															Tidak opt-out
														</label>
													</div>
												) : null}
											</div>
										) : null}

										{recipientMode === 'customers' ? (
											<div className="space-y-2">
												<input
													className="ocm-input h-9"
													value={customerSearch}
													onChange={(event) =>
														setCustomerSearch(event.target.value)
													}
													placeholder="Cari customer atau nomor..."
												/>
												<div className="max-h-56 overflow-y-auto rounded-lg border border-border">
													{customersLoading ? (
														<div className="flex items-center justify-center gap-2 p-4 text-sm text-muted-foreground">
															<Loader2 size={14} className="animate-spin" />
															Memuat customers...
														</div>
													) : filteredCustomers.length === 0 ? (
														<p className="p-4 text-center text-sm text-muted-foreground">
															Tidak ada customer dengan nomor.
														</p>
													) : (
														filteredCustomers.map((customer) => (
															<label
																key={customer.id}
																className="flex cursor-pointer items-center justify-between gap-3 border-b border-border/60 px-3 py-2 text-sm last:border-b-0 hover:bg-muted/40"
															>
																<div className="flex items-center gap-2">
																	<input
																		type="checkbox"
																		checked={selectedCustomerIds.includes(
																			customer.id,
																		)}
																		onChange={() => toggleCustomer(customer.id)}
																	/>
																	<div>
																		<p className="font-semibold">
																			{customer.name || 'Unknown'}
																		</p>
																		<p className="text-xs text-muted-foreground">
																			{customer.phone_number}
																		</p>
																	</div>
																</div>
																{selectedCustomerIds.includes(customer.id) ? (
																	<CheckCircle2
																		size={14}
																		className="text-emerald-500"
																	/>
																) : null}
															</label>
														))
													)}
												</div>
											</div>
										) : null}

										{recipientMode === 'csv' ? (
											<div className="space-y-2">
												<input
													ref={csvInputRef}
													type="file"
													accept=".csv"
													className="hidden"
													onChange={handleCsvFileChange}
												/>
												<button
													type="button"
													className="flex w-full flex-col items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm hover:bg-muted/50"
													onClick={() => csvInputRef.current?.click()}
												>
													<Upload size={18} className="mb-1 text-primary" />
													{csvFileName || 'Upload CSV dengan kolom phoneNumber'}
												</button>
												{csvFileName ? (
													<div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
														<span>{csvRecipients.length} valid</span>
														<span>{selectedCsvRecipients.length} selected</span>
														{csvInvalidRows > 0 ? (
															<span>{csvInvalidRows} invalid phone rows</span>
														) : null}
														<button
															type="button"
															className="ocm-pill ml-auto"
															onClick={handleClearCsv}
														>
															<X size={11} />
															Clear
														</button>
													</div>
												) : null}
												{csvError ? (
													<p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
														{csvError}
													</p>
												) : null}
												{csvRecipients.length > 0 ? (
													<div className="max-h-44 overflow-y-auto rounded-lg border border-border">
														{csvRecipients.map((recipient) => (
															<label
																key={recipient.phoneNumber}
																className="flex cursor-pointer items-center gap-2 border-b border-border/60 px-3 py-2 text-xs last:border-b-0 hover:bg-muted/40"
															>
																<input
																	type="checkbox"
																	checked={selectedCsvPhones.includes(
																		recipient.phoneNumber,
																	)}
																	onChange={() =>
																		toggleCsvRecipient(recipient.phoneNumber)
																	}
																/>
																<span className="font-mono">
																	{recipient.phoneNumber}
																</span>
															</label>
														))}
													</div>
												) : null}
											</div>
										) : null}

										{recipientMode === 'manual' ? (
											<div className="space-y-2">
												<textarea
													className="ocm-textarea min-h-32 font-mono text-xs"
													value={manualInput}
													onChange={(event) =>
														setManualInput(event.target.value)
													}
													placeholder={
														templateVariableKeys.length > 0
															? '6281234567890,John,PROMO123\n6289876543210,Jane,SALE2024'
															: '6281234567890\n6289876543210'
													}
												/>
												<p className="text-xs text-muted-foreground">
													Satu baris per nomor. Format:
													phoneNumber,variable1,variable2
												</p>
												{manualParsed.rowErrors[0] ? (
													<p className="rounded-md border border-destructive/30 bg-destructive/10 p-2 text-xs text-destructive">
														{manualParsed.rowErrors[0]}
													</p>
												) : null}
											</div>
										) : null}

										<div className="flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
											<UserRound size={14} className="text-primary" />
											<p className="font-mono text-lg font-semibold">
												{audiencePreviewLoading &&
												recipientMode === 'target' ? (
													<Loader2 size={18} className="animate-spin" />
												) : (
													audienceCount.toLocaleString('id-ID')
												)}
											</p>
											<p className="text-muted-foreground">kontak cocok</p>
											<div className="ml-auto text-xs text-muted-foreground">
												Estimasi biaya:{' '}
												<span className="font-mono text-foreground">
													{formatMoneyCompact(estimatedCost)}
												</span>
											</div>
										</div>
										{audiencePreviewError && recipientMode === 'target' ? (
											<p className="text-xs text-destructive">
												{audiencePreviewError}
											</p>
										) : null}
									</div>
								</section>
							) : null}

							{canShowVariablesStep ? (
								<section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
									<div className="mb-4 flex items-center gap-3">
										<span className="inline-grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
											3
										</span>
										<div>
											<h2 className="text-xl font-semibold">
												Template Variables
											</h2>
											<p className="mt-1 text-sm text-muted-foreground">
												Fill in the variable values for your template
											</p>
										</div>
									</div>

									<div className="space-y-4">
										<div className="flex items-start gap-2 rounded-lg bg-blue-50 p-3 text-sm text-blue-700">
											<Variable size={16} className="mt-0.5 shrink-0" />
											<div>
												<p className="font-semibold">
													Tip: Use customer name from database
												</p>
												<p className="mt-1 text-xs">
													Type{' '}
													<code className="rounded bg-blue-100 px-1 font-mono">
														{'{{customer_name}}'}
													</code>{' '}
													in any field to auto-fill with customer's name
												</p>
											</div>
										</div>

										{templateVariableKeys.length > 0 ? (
											templateVariableFields.map((field) => {
												const value = defaultTemplateVariables[field.key] || ''
												const isMissing = value.trim().length === 0
												const componentLabel = toVariableComponentLabel(
													field.componentType,
												)
												return (
													<div key={field.key} className="space-y-2">
														<div className="flex items-center gap-2">
															<label
																className="text-sm font-semibold"
																htmlFor={`template-var-${field.key}`}
															>
																{`{{${field.key}}}`}
															</label>
															<span className="inline-flex items-center rounded-md border border-border px-2.5 py-0.5 text-xs font-semibold text-muted-foreground">
																{componentLabel}
															</span>
														</div>
														<input
															id={`template-var-${field.key}`}
															className={`ocm-input h-11 bg-background text-sm font-normal text-foreground ${
																isMissing
																	? 'border-amber-300 focus:border-amber-400'
																	: ''
															}`}
															value={value}
															onChange={(event) =>
																setDefaultTemplateVariables((prev) => ({
																	...prev,
																	[field.key]: event.target.value,
																}))
															}
															placeholder={`Value for ${componentLabel} {{${field.key}}} or {{customer_name}}`}
														/>
													</div>
												)
											})
										) : (
											<div className="rounded-lg border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
												Template ini tidak membutuhkan variable.
											</div>
										)}

										{missingDefaultKeys.length > 0 ? (
											<div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
												<AlertCircle size={16} className="mt-0.5 shrink-0" />
												<span>
													This field is required:{' '}
													{missingDefaultKeys
														.map((key) => `{{${key}}}`)
														.join(', ')}
												</span>
											</div>
										) : null}

										<div className="flex items-start gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-700">
											<AlertCircle size={16} className="mt-0.5 shrink-0" />
											<span>
												Defaults are used for customers/manual rows with missing
												values. For CSV, each row can override with columns like
												1, 2, 3...
											</span>
										</div>
									</div>
								</section>
							) : null}

							{canShowScheduleStep ? (
								<section className="rounded-xl border border-border bg-card p-4 shadow-sm sm:p-5">
									<div className="mb-4 flex items-center gap-3">
										<span className="inline-grid h-7 w-7 place-items-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
											4
										</span>
										<h2 className="text-xl font-semibold">
											Rate Limit & Jadwal
										</h2>
									</div>
									<div className="space-y-3">
										<div className="grid gap-2 sm:grid-cols-2">
											<label className="rounded-md border border-border bg-muted/40 p-2.5">
												<p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
													Kecepatan
												</p>
												<select
													className="mt-1 w-full bg-transparent text-sm font-semibold outline-none"
													value={delaySeconds}
													onChange={(event) =>
														setDelaySeconds(Number(event.target.value))
													}
												>
													<option value={0}>Tanpa delay</option>
													<option value={5}>5 detik</option>
													<option value={15}>15 detik</option>
													<option value={30}>30 detik</option>
													<option value={60}>60 detik</option>
												</select>
												<p className="mt-0.5 text-[11px] text-muted-foreground">
													delay antar pesan
												</p>
											</label>
											<InfoTile
												label="Spread"
												value={
													delaySeconds > 0
														? `Setiap ${delaySeconds} dtk`
														: 'Instant'
												}
												description="semakin lambat semakin aman"
											/>
											<label className="rounded-md border border-border bg-muted/40 p-2.5">
												<p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
													Jadwal
												</p>
												<input
													type="datetime-local"
													className="mt-1 w-full bg-transparent text-sm font-semibold outline-none"
													value={scheduledAt}
													onChange={(event) =>
														setScheduledAt(event.target.value)
													}
												/>
												<p className="mt-0.5 text-[11px] text-muted-foreground">
													kosongkan untuk kirim sekarang
												</p>
											</label>
											<InfoTile
												label="Estimasi selesai"
												value={formatDuration(estimatedMinutes)}
												description={`finish ${estimatedFinish}`}
											/>
										</div>
										<div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
											<Shield size={14} className="mt-0.5 text-amber-500" />
											<p>
												<span className="font-semibold text-amber-500">
													Anti-ban check:
												</span>{' '}
												Rasio outbound/received 7 hari terakhir 1.2x - masih
												aman. Hindari broadcast lebih dari 10k dalam 24 jam.
											</p>
										</div>
										<div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
											<button
												type="button"
												className="ocm-btn"
												onClick={() => handleCreateBroadcast('draft')}
												disabled={submittingAction !== null}
											>
												{submittingAction === 'draft' ? (
													<Loader2 size={13} className="animate-spin" />
												) : null}
												Simpan draft
											</button>
											<button
												type="button"
												className="ocm-btn"
												onClick={() =>
													toast.info('Test broadcast belum diaktifkan')
												}
											>
												<Play size={13} />
												Test ke 3 nomor
											</button>
											<div className="ml-auto" />
											<button
												type="button"
												className="ocm-btn ocm-btn-primary"
												onClick={() => handleCreateBroadcast('send')}
												disabled={submittingAction !== null}
											>
												{submittingAction === 'send' ? (
													<Loader2 size={14} className="animate-spin" />
												) : (
													<SendHorizontal size={14} />
												)}
												Schedule Campaign
											</button>
										</div>
									</div>
								</section>
							) : null}
						</div>

						<aside className="rounded-xl border border-border bg-card p-4 shadow-sm xl:sticky xl:top-5 xl:self-start sm:p-5">
							<div className="flex items-center gap-2">
								<Eye size={16} className="text-foreground" />
								<h2 className="text-base font-semibold">Message Preview</h2>
							</div>
							<p className="mt-4 text-sm text-muted-foreground">
								See how your message will look to recipients
							</p>
							<div className="mt-5 flex min-h-[260px] items-center justify-center rounded-xl border border-dashed border-border bg-muted/10 p-5">
								{selectedTemplateData ? (
									<div className="w-full max-w-sm overflow-hidden rounded-[24px] border border-border bg-[#e5ddd5] shadow-sm">
										<div className="flex items-center gap-2 bg-[#075e54] px-3 py-2 text-white">
											<div className="grid h-8 w-8 place-items-center rounded-full bg-white/20 text-xs font-bold">
												S
											</div>
											<div className="min-w-0 flex-1">
												<p className="truncate text-sm font-semibold">
											CRM
												</p>
												<p className="text-[11px] text-white/70">
													WhatsApp Business
												</p>
											</div>
										</div>
										<div className="p-4">
											<div className="max-w-[86%] rounded-lg bg-white px-3 py-2 text-sm leading-6 text-slate-900 shadow-sm">
												{previewLines.map((line) => (
													<p key={line}>{line}</p>
												))}
											</div>
											<div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-700">
												<span className="rounded-full bg-white/70 px-2 py-1">
													{selectedTemplateData.category || 'UTILITY'}
												</span>
												<span className="rounded-full bg-white/70 px-2 py-1">
													{audienceCount.toLocaleString('id-ID')} recipients
												</span>
											</div>
										</div>
									</div>
								) : (
									<div className="flex flex-col items-center text-center text-muted-foreground">
										<Eye size={34} className="mb-5 opacity-70" />
										<p className="text-sm">Select a template to see preview</p>
									</div>
								)}
							</div>
						</aside>
					</div>
				) : null}

				{activeTab === 'active' ? (
					<section className="max-w-6xl rounded-xl border border-border bg-card p-5 shadow-sm">
						<h2 className="text-lg font-semibold">Active Jobs</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Broadcast yang sedang dikirim atau dijadwalkan.
						</p>
						<div className="mt-4 space-y-2">
							{loading ? (
								<p className="text-sm text-muted-foreground">Memuat jobs...</p>
							) : activeRows.length === 0 ? (
								<p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
									Tidak ada active job.
								</p>
							) : (
								activeRows.map((row) => (
									<div
										key={row.id}
										className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate font-semibold">{row.title}</p>
											<p className="text-xs text-muted-foreground">
												{row.templateName} - {formatRelativeTime(row.updatedAt)}
											</p>
										</div>
										<span className={`ocm-tag ${statusToneClass(row.status)}`}>
											{row.status}
										</span>
										<span className="font-mono text-xs text-muted-foreground">
											{row.recipients.toLocaleString('id-ID')} recipients
										</span>
									</div>
								))
							)}
						</div>
					</section>
				) : null}

				{activeTab === 'history' ? (
					<section className="max-w-6xl rounded-xl border border-border bg-card p-5 shadow-sm">
						<h2 className="text-lg font-semibold">History</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Riwayat broadcast yang sudah selesai, gagal, atau dibatalkan.
						</p>
						<div className="mt-4 space-y-2">
							{loading ? (
								<p className="text-sm text-muted-foreground">
									Memuat history...
								</p>
							) : historyRows.length === 0 ? (
								<p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
									Belum ada history broadcast.
								</p>
							) : (
								historyRows.map((row) => (
									<div
										key={row.id}
										className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 text-sm"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate font-semibold">{row.title}</p>
											<p className="text-xs text-muted-foreground">
												{row.templateName} - {formatRelativeTime(row.updatedAt)}
											</p>
										</div>
										<span className={`ocm-tag ${statusToneClass(row.status)}`}>
											{row.status}
										</span>
										<span className="font-mono text-xs text-muted-foreground">
											{row.success.toLocaleString('id-ID')} success /{' '}
											{row.failed.toLocaleString('id-ID')} failed
										</span>
									</div>
								))
							)}
						</div>
					</section>
				) : null}
			</div>
		</main>
	)
}
