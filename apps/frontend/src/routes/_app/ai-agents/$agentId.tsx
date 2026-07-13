import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect, useRef, useMemo } from 'react'
import {
	ArrowLeft,
	Settings,
	Book,
	Clock,
	BarChart3,
	GitBranch,
	Save,
	RefreshCw,
	Send,
	ChevronDown,
	Bot,
	Info,
	Plus,
	Search,
	Trash2,
	FileText,
	Globe,
	MessageSquare,
	Tag,
	Eye,
	X,
	Zap,
} from 'lucide-react'
import { toast } from 'sonner'
import { INDONESIA_TIMEZONES, TIMEZONES } from '@/lib/timezones'
import { randomId } from '@/lib/id'
import { Check, Copy } from 'lucide-react'

export const Route = createFileRoute('/_app/ai-agents/$agentId')({
	component: AIAgentDetailPage,
})

type Tab =
	| 'general'
	| 'knowledge'
	| 'integrations'
	| 'followups'
	| 'evaluation'
	| 'orchestration'
	| 'advanced'

const AGENT_TABS: Tab[] = [
	'general',
	'followups',
]

type AIToolCardItem = {
	id: string
	name: string
	description: string
	is_active: boolean
}

type ApiToolCatalogItem = {
	id: string
	name: string
	description: string
}

function sortAiToolCards(cards: AIToolCardItem[]): AIToolCardItem[] {
	return [...cards].sort((left, right) => {
		if (left.is_active !== right.is_active) {
			return left.is_active ? -1 : 1
		}
		return left.name.localeCompare(right.name)
	})
}

function normalizeToolLookupKey(value: string): string {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}

function normalizeAiToolCards(rawValue: unknown): AIToolCardItem[] {
	if (!Array.isArray(rawValue) || rawValue.length === 0) return []

	return rawValue
		.map((item) => {
			if (!item || typeof item !== 'object') return null
			const asRecord = item as Record<string, unknown>
			const name = String(asRecord.name || asRecord.id || '').trim()
			if (!name) return null
			return {
				id: String(asRecord.id || name).trim(),
				name,
				description: String(asRecord.description || '').trim(),
				is_active: Boolean(asRecord.is_active),
			}
		})
		.filter(Boolean) as AIToolCardItem[]
}

function normalizeApiToolCatalog(rawValue: unknown): ApiToolCatalogItem[] {
	if (!Array.isArray(rawValue) || rawValue.length === 0) return []

	return rawValue
		.map((item) => {
			if (!item || typeof item !== 'object') return null
			const asRecord = item as Record<string, unknown>
			const id = String(asRecord.id || '').trim()
			const name = String(asRecord.name || '').trim()
			if (!id || !name) return null
			return {
				id,
				name,
				description: String(asRecord.description || '').trim(),
			}
		})
		.filter(Boolean) as ApiToolCatalogItem[]
}

function mergeAiToolCardsFromCatalog(args: {
	catalog: ApiToolCatalogItem[]
	configured: AIToolCardItem[]
}): AIToolCardItem[] {
	const byId = new Map<string, AIToolCardItem>()
	const byName = new Map<string, AIToolCardItem>()

	for (const tool of args.configured) {
		byId.set(tool.id, tool)
		byName.set(normalizeToolLookupKey(tool.name), tool)
	}

	const consumedConfiguredIds = new Set<string>()
	const mergedFromCatalog = args.catalog.map((catalogTool) => {
		const matchById = byId.get(catalogTool.id)
		const matchByName = byName.get(normalizeToolLookupKey(catalogTool.name))
		const configuredTool = matchById || matchByName
		if (configuredTool) {
			consumedConfiguredIds.add(configuredTool.id)
		}

		return {
			id: catalogTool.id,
			name: catalogTool.name,
			description: catalogTool.description,
			is_active: configuredTool ? Boolean(configuredTool.is_active) : false,
		}
	})

	const configuredOnly = args.configured.filter(
		(tool) => !consumedConfiguredIds.has(tool.id),
	)

	return sortAiToolCards([...mergedFromCatalog, ...configuredOnly])
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split('.')
		if (parts.length < 2) return null
		const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
		const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
		const json = atob(padded)
		const parsed = JSON.parse(json)
		return parsed && typeof parsed === 'object' ? parsed : null
	} catch {
		return null
	}
}

function resolveBusinessIdFromClient(args: {
	appId?: string
	token: string | null
}): string {
	if (typeof window !== 'undefined') {
		const storageCandidates = [
			localStorage.getItem('scalechat_business_id'),
			localStorage.getItem('scalechat_org_id'),
			localStorage.getItem('scalechat_app_id'),
			localStorage.getItem('scalechat_org_slug'),
			args.appId || '',
		]
		const fromStorage = storageCandidates
			.map((value) => String(value || '').trim())
			.find(Boolean)
		if (fromStorage) return fromStorage
	}

	if (!args.token) return ''
	const payload = decodeJwtPayload(args.token)
	if (!payload) return ''

	const appMetadata =
		payload.app_metadata &&
		typeof payload.app_metadata === 'object' &&
		!Array.isArray(payload.app_metadata)
			? (payload.app_metadata as Record<string, unknown>)
			: null
	if (!appMetadata) return ''

	return String(
		appMetadata.biz_id ||
			appMetadata.business_id ||
			appMetadata.org_id ||
			appMetadata.app_id ||
			'',
	).trim()
}

function isAgentTab(value: string): value is Tab {
	return AGENT_TABS.includes(value as Tab)
}

interface AIAgent {
	id: string
	name: string
	description: string
	model: string
	prompt: string
	agent_transfer: string
	welcome_msg: string
	plugin_type: string
	plugin_data: any
	history_limit: number
	context_limit: number
	message_await: number
	message_limit: number
	temperature: number
	timezone: string
	label_condition: string
	is_hidden: boolean
	is_deleted: boolean
	is_silent_handoff_agent: boolean
	watcher_enabled?: boolean
	session_only_memory?: boolean
	app_data: any
	ai_followups: any[]
	created_at: string
	updated_at: string
}

interface ModelPricingItem {
	id: string
	model_name: string
	cost_per_request: number
	description?: string | null
	is_active?: boolean | null
}

interface PipelineStageOption {
	id: string
	name: string
	color?: string | null
	pipelineName?: string
}

type ModelCategory = 'BASIC' | 'NEWEST (BETA)' | 'OTHERS'

interface ModelOption {
	value: string
	label: string
	category: ModelCategory
	description?: string
	costPerRequest: number
	isNew?: boolean
}

const MODEL_REFERENCE_ORDER = [
	'standard',
	'advanced',
	'standard_plus_a',
	'standard_plus_b',
	'standard_plus_c',
	'standard_plus',
	'advanced_plus',
	'advanced_thinking',
	'standard_vision',
	'advanced_vision',
	'advanced_v4',
	'standard_v4',
] as const

const MODEL_REFERENCE_META: Record<
	string,
	{
		label: string
		category: ModelCategory
		description?: string
		isNew?: boolean
	}
> = {
	standard: { label: 'Standard', category: 'BASIC' },
	advanced: { label: 'Advanced', category: 'BASIC' },
	standard_plus_a: {
		label: 'Standard+ A',
		category: 'NEWEST (BETA)',
		description: 'Newest experimental model - faster and cheaper',
		isNew: true,
	},
	standard_plus_b: {
		label: 'Standard+ B',
		category: 'NEWEST (BETA)',
		description: 'Newest experimental model - faster and cheaper',
		isNew: true,
	},
	standard_plus_c: {
		label: 'Standard+ C',
		category: 'NEWEST (BETA)',
		description: 'Newest experimental model - faster and cheaper',
		isNew: true,
	},
	standard_plus: { label: 'Standard+', category: 'OTHERS' },
	advanced_plus: { label: 'Advanced+', category: 'OTHERS' },
	advanced_thinking: { label: 'Advanced Thinking', category: 'OTHERS' },
	standard_vision: { label: 'Standard Vision', category: 'OTHERS' },
	advanced_vision: { label: 'Advanced Vision', category: 'OTHERS' },
	advanced_v4: { label: 'Advanced V4', category: 'OTHERS' },
	standard_v4: { label: 'Standard V4', category: 'OTHERS' },
}

const MODEL_CATEGORY_ORDER: ModelCategory[] = [
	'BASIC',
	'NEWEST (BETA)',
	'OTHERS',
]

const FALLBACK_MODEL_COSTS: Record<string, number> = {
	standard: 11,
	advanced: 173,
	standard_plus_a: 7,
	standard_plus_b: 7,
	standard_plus_c: 7,
	standard_plus: 28,
	advanced_plus: 139,
	advanced_thinking: 77,
	standard_vision: 21,
	advanced_vision: 21,
	advanced_v4: 87,
	standard_v4: 18,
	basic: 7,
}

function normalizeModelKey(modelName: string): string {
	return String(modelName || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
}

function titleCaseFromModelKey(modelName: string): string {
	const normalized = normalizeModelKey(modelName)
	return normalized
		.split('_')
		.filter(Boolean)
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ')
}

function formatCreditLabel(credits: number, withSuffix = false): string {
	const numeric = Number(credits)
	if (!Number.isFinite(numeric))
		return withSuffix ? '~0 credits per response' : '~0 credits'
	const rounded =
		Math.abs(numeric % 1) < 0.001
			? String(Math.round(numeric))
			: numeric.toFixed(2).replace(/\.?0+$/, '')
	return withSuffix ? `~${rounded} credits per response` : `~${rounded} credits`
}

function parseAiFollowups(value: unknown): any[] {
	if (Array.isArray(value)) return value
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value)
			return Array.isArray(parsed) ? parsed : []
		} catch {
			return []
		}
	}
	return []
}

function createEmptyFollowupRule() {
	return {
		id: randomId(),
		prompt: '',
		time_interval: 60,
		is_in_bot_reply: true,
		options: { handoff: false, send_exact: false },
	}
}

function normalizeAiFollowupsForSave(rules: unknown): any[] {
	const parsedRules = parseAiFollowups(rules)

	return parsedRules.map((rule: any, index: number) => {
		const rawInterval =
			typeof rule?.time_interval === 'number'
				? rule.time_interval
				: parseInt(String(rule?.time_interval ?? ''), 10)
		const safeInterval =
			Number.isFinite(rawInterval) && rawInterval > 0 ? rawInterval : 60

		const fallbackId = `rule-${Date.now()}-${index}`

		return {
			id: rule?.id || fallbackId,
			prompt: typeof rule?.prompt === 'string' ? rule.prompt : '',
			time_interval: safeInterval,
			is_in_bot_reply: Boolean(rule?.is_in_bot_reply),
			options: {
				handoff: Boolean(rule?.options?.handoff),
				send_exact: Boolean(rule?.options?.send_exact),
			},
		}
	})
}

type PreviewMessage =
	| {
			id: string
			role: 'user'
			kind: 'text'
			content: string
	  }
	| {
			id: string
			role: 'assistant'
			kind: 'text'
			content: string
			creditsUsed?: number
	  }
	| {
			id: string
			role: 'assistant'
			kind: 'image'
			url: string
			alt?: string
	  }
	| {
			id: string
			role: 'system'
			kind: 'status'
			content: string
	  }

function createPreviewMessageId(prefix = 'preview'): string {
	return `${prefix}-${randomId()}`
}

function normalizeHttpUrl(value: unknown): string | null {
	const raw = String(value || '').trim()
	if (!raw) return null
	try {
		const parsed = new URL(raw)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString()
	} catch {
		return null
	}
}

function isLikelyImageUrl(value: string): boolean {
	return /\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value)
}

function splitPreviewTextBlocks(value: string): string[] {
	const normalized = String(value || '')
		.replace(/\r\n/g, '\n')
		.trim()
	if (!normalized) return []

	return normalized
		.split(/\n{2,}/)
		.map((item) => item.trim())
		.filter(Boolean)
}

function previewMessageToHistory(
	message: PreviewMessage,
): { role: 'user' | 'assistant'; content: string } | null {
	if (message.role === 'system') return null

	if (message.role === 'assistant' && message.kind === 'image') {
		return {
			role: 'assistant',
			content: `[Image] ${message.url}`,
		}
	}

	return {
		role: message.role,
		content: message.content,
	}
}

function buildPreviewMessagesFromSimulationResponse(payload: any): PreviewMessage[] {
	const responseMessagesRaw = Array.isArray(payload?.messages)
		? payload.messages
		: []
	const messagesFromServerFormat: PreviewMessage[] = []

	const appendAssistantContent = (value: string, creditsUsedRaw?: unknown) => {
		const content = String(value || '').trim()
		if (!content) return

		const chunks = content
			.split(/\s*###\s*/g)
			.map((part) => part.trim())
			.filter(Boolean)
		const normalizedChunks = chunks.length > 0 ? chunks : [content]

		const appendedIndexes: number[] = []
		for (const chunk of normalizedChunks) {
			const maybeUrl = normalizeHttpUrl(chunk)
			if (maybeUrl && isLikelyImageUrl(maybeUrl)) {
				messagesFromServerFormat.push({
					id: createPreviewMessageId('assistant-image'),
					role: 'assistant',
					kind: 'image',
					url: maybeUrl,
					alt: 'Image',
				})
				continue
			}

			messagesFromServerFormat.push({
				id: createPreviewMessageId('assistant-text'),
				role: 'assistant',
				kind: 'text',
				content: chunk,
			})
			appendedIndexes.push(messagesFromServerFormat.length - 1)
		}

		const creditsUsed = Number(creditsUsedRaw)
		if (!Number.isFinite(creditsUsed) || appendedIndexes.length === 0) return

		const latestTextIndex = [...appendedIndexes]
			.reverse()
			.find((index) => {
				const entry = messagesFromServerFormat[index]
				return entry.role === 'assistant' && entry.kind === 'text'
			})
		if (typeof latestTextIndex !== 'number') return

		const targetMessage = messagesFromServerFormat[
			latestTextIndex
		] as Extract<PreviewMessage, { role: 'assistant'; kind: 'text' }>
		messagesFromServerFormat[latestTextIndex] = {
			...targetMessage,
			creditsUsed,
		}
	}

	for (const item of responseMessagesRaw) {
		if (!item || typeof item !== 'object') continue

		const role = String((item as any).role || '').trim().toLowerCase()
		const content = String((item as any).content || '').trim()
		if (!content) continue

		if (role === 'system') {
			const maybeStructured =
				content.startsWith('[') || content.startsWith('{') ? content : ''
			if (maybeStructured) {
				try {
					const parsed = JSON.parse(maybeStructured) as unknown
					const entries = Array.isArray(parsed) ? parsed : [parsed]
					let converted = false

					for (const entry of entries) {
						if (!entry || typeof entry !== 'object') continue
						const structuredRole = String(
							(entry as any).role || '',
						).toLowerCase()
						const structuredContent = String(
							(entry as any).content || (entry as any).message || '',
						).trim()

						if (
							(structuredRole === 'assistant' || structuredRole === 'ai') &&
							structuredContent
						) {
							appendAssistantContent(
								structuredContent,
								(entry as any).credits_used,
							)
							converted = true
						}
					}

					if (converted) continue
				} catch {
					// keep as regular system status
				}
			}

			messagesFromServerFormat.push({
				id: createPreviewMessageId('status'),
				role: 'system',
				kind: 'status',
				content,
			})
			continue
		}

		if (role === 'assistant') {
			appendAssistantContent(content, (item as any).credits_used)
		}
	}

	const timelineRaw = Array.isArray(payload?.preview?.timeline)
		? payload.preview.timeline
		: []
	const timelineMessages: PreviewMessage[] = []

	for (const item of timelineRaw) {
		if (!item || typeof item !== 'object') continue

		const type = String((item as any).type || '').trim().toLowerCase()
		if (type === 'status') {
			const text = String((item as any).text || '').trim()
			if (!text) continue
			timelineMessages.push({
				id: createPreviewMessageId('status'),
				role: 'system',
				kind: 'status',
				content: text,
			})
			continue
		}

		if (type === 'image') {
			const imageUrl = normalizeHttpUrl((item as any).url)
			if (!imageUrl) continue
			timelineMessages.push({
				id: createPreviewMessageId('assistant-image'),
				role: 'assistant',
				kind: 'image',
				url: imageUrl,
				alt: String((item as any).alt || 'Image'),
			})
			continue
		}

		if (type === 'text') {
			const text = String((item as any).content || '').trim()
			if (!text) continue
			timelineMessages.push({
				id: createPreviewMessageId('assistant-text'),
				role: 'assistant',
				kind: 'text',
				content: text,
			})
		}
	}

	const withFallback = (() => {
		if (messagesFromServerFormat.length > 0) return messagesFromServerFormat
		if (timelineMessages.length > 0) return timelineMessages

		const fallback: PreviewMessage[] = []

		if (Number(payload?.meta?.tools_called || 0) > 0) {
			fallback.push({
				id: createPreviewMessageId('status'),
				role: 'system',
				kind: 'status',
				content: 'Successfully executed tool calls',
			})
		}

		const labelName = String(payload?.meta?.label_applied || '').trim()
		if (labelName) {
			fallback.push({
				id: createPreviewMessageId('status'),
				role: 'system',
				kind: 'status',
				content: `Successfully labeled conversation with: ${labelName}`,
			})
		}

		const textBlocks = splitPreviewTextBlocks(String(payload?.data || ''))
		for (const block of textBlocks) {
			fallback.push({
				id: createPreviewMessageId('assistant-text'),
				role: 'assistant',
				kind: 'text',
				content: block,
			})
		}

		if (fallback.length === 0 && String(payload?.data || '').trim()) {
			fallback.push({
				id: createPreviewMessageId('assistant-text'),
				role: 'assistant',
				kind: 'text',
				content: String(payload.data).trim(),
			})
		}

		return fallback
	})()

	const creditsUsed = Number(
		payload?.preview?.credits_used ?? payload?.meta?.credits_used,
	)
	if (!Number.isFinite(creditsUsed)) return withFallback

	const nextMessages = [...withFallback]
	const hasExistingCredits = nextMessages.some(
		(item) =>
			item.role === 'assistant' &&
			item.kind === 'text' &&
			typeof item.creditsUsed === 'number',
	)
	if (hasExistingCredits) return nextMessages

	for (let index = nextMessages.length - 1; index >= 0; index -= 1) {
		const message = nextMessages[index]
		if (message.role === 'assistant' && message.kind === 'text') {
			nextMessages[index] = {
				...message,
				creditsUsed,
			}
			break
		}
	}

	return nextMessages
}

function getTimezoneOffsetLabel(value: string): string {
	try {
		const formatter = new Intl.DateTimeFormat('en-US', {
			timeZone: value,
			timeZoneName: 'shortOffset',
		})
		const parts = formatter.formatToParts(new Date())
		const offsetPart = parts.find((part) => part.type === 'timeZoneName')?.value
		if (!offsetPart) return ''
		return offsetPart.replace('GMT', 'UTC')
	} catch {
		return ''
	}
}

function AIAgentDetailPage() {
	const routeParams = Route.useParams() as {
		appId?: string
		agentId: string
	}
	const { agentId } = routeParams
	const appId =
		routeParams.appId ||
		(typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_app_id') ||
				localStorage.getItem('scalechat_org_slug') ||
				''
			: '')
	const [activeTab, setActiveTab] = useState<Tab>('general')

	useEffect(() => {
		if (typeof window === 'undefined') return

		const url = new URL(window.location.href)
		const requestedTab = (
			url.searchParams.get('tab') || window.location.hash.replace(/^#/, '')
		)
			.trim()
			.toLowerCase()

		if (requestedTab && isAgentTab(requestedTab)) {
			setActiveTab(requestedTab)
		} else {
			setActiveTab('general')
		}
	}, [agentId])

	const [agent, setAgent] = useState<AIAgent | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [savingFollowups, setSavingFollowups] = useState(false)
	const [showAIActions, setShowAIActions] = useState(false)
	const [showAdditionalSettings, setShowAdditionalSettings] = useState(false)
	const [chatMessage, setChatMessage] = useState('')
	const [previewMessages, setPreviewMessages] = useState<PreviewMessage[]>([])
	const [previewLoading, setPreviewLoading] = useState(false)
	const [copiedPreviewMessageId, setCopiedPreviewMessageId] = useState<
		string | null
	>(null)

	// Form states
	const [formData, setFormData] = useState({
		name: '',
		description: '',
		prompt: '',
		welcome_msg: '',
		agent_transfer: '',
		temperature: 0.2,
		history_limit: 50,
		context_limit: 50,
		message_await: 30,
		message_limit: 1000,
		max_file_read_window: 3,
		is_silent_handoff_agent: false,
		watcher_enabled: false,
		session_only_memory: false,
		stop_after_handoff: true,
		timezone: 'Asia/Jakarta',
		label_condition: '',
		selected_labels: [] as string[],
		model: 'standard_plus_b',
		app_data: {} as any,
		ai_followups: [] as any[],
	})

	// Available labels from the app (fetched from API)
	const [availableLabels, setAvailableLabels] = useState<
		{ id: string; name: string; color?: string }[]
	>([])
	const [showLabelPicker, setShowLabelPicker] = useState(false)
	const [labelSearch, setLabelSearch] = useState('')
	const [availablePipelineStages, setAvailablePipelineStages] = useState<
		PipelineStageOption[]
	>([])
	const [showPipelineStagePicker, setShowPipelineStagePicker] = useState(false)
	const [pipelineStageSearch, setPipelineStageSearch] = useState('')
	const [modelPricing, setModelPricing] = useState<ModelPricingItem[]>([])
	const [loadingModelPricing, setLoadingModelPricing] = useState(false)
	const [showModelPicker, setShowModelPicker] = useState(false)
	const [modelSearch, setModelSearch] = useState('')

	// Agent-specific Q&A/Product knowledge. Text/Website/File are global at /knowledge.
	const [knowledgeTab, setKnowledgeTab] = useState<'qna' | 'product'>('qna')

	// Q&A state
	const [qnaItems, setQnaItems] = useState<any[]>([])
	const [showAddQnAModal, setShowAddQnAModal] = useState(false)
	const [newQnA, setNewQnA] = useState({ question: '', answer: '' })

	// Product state
	const [productItems, setProductItems] = useState<any[]>([])

	const [inboxes, setInboxes] = useState<any[]>([])
	const [loadingInboxes, setLoadingInboxes] = useState(false)
	const [aiToolCards, setAiToolCards] = useState<AIToolCardItem[]>([])
	const [loadingAiTools, setLoadingAiTools] = useState(false)
	const [updatingAiToolId, setUpdatingAiToolId] = useState<string | null>(null)

	// Evaluation states
	const [evaluations, setEvaluations] = useState<any[]>([])
	const [loadingEvaluations, setLoadingEvaluations] = useState(false)
	const [evaluationPage, setEvaluationPage] = useState(1)
	const [evaluationPagination, setEvaluationPagination] = useState<any>(null)
	const [selectedEval, setSelectedEval] = useState<any>(null)
	const [showEvalModal, setShowEvalModal] = useState(false)
	const scrollRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		if (scrollRef.current) {
			scrollRef.current.scrollTop = scrollRef.current.scrollHeight
		}
	}, [previewMessages, previewLoading])
	const [savingEvaluation, setSavingEvaluation] = useState(false)

	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
	const token = localStorage.getItem('scalechat_token')
	const businessId = resolveBusinessIdFromClient({ appId, token })

	useEffect(() => {
		if (agentId) {
			fetchAgent()
			if (activeTab === 'general') {
				fetchLabels()
				fetchPipelineStages()
				fetchModelPricing()
			}
			if (activeTab === 'knowledge') fetchKnowledgeData()
			if (activeTab === 'integrations') fetchInboxes()
			if (activeTab === 'evaluation') fetchEvaluations()
		}
	}, [agentId, activeTab, evaluationPage])

	const selectedPipelineStageIds = useMemo(() => {
		const maybeIds = formData.app_data?.ai_actions?.pipeline_stage_ids
		if (!Array.isArray(maybeIds)) return [] as string[]
		return maybeIds.map((id: any) => String(id))
	}, [formData.app_data])

	const selectedLabelChips = useMemo(() => {
		return formData.selected_labels
			.map((selectedId) => {
				const matched = availableLabels.find((label) => label.id === selectedId)
				if (!matched) return null
				return {
					id: matched.id,
					name: matched.name,
					color: matched.color || '#4B5563',
				}
			})
			.filter(Boolean) as { id: string; name: string; color: string }[]
	}, [availableLabels, formData.selected_labels])

	const labelPickerOptions = useMemo(() => {
		const keyword = labelSearch.trim().toLowerCase()
		return availableLabels.filter((label) => {
			if (formData.selected_labels.includes(label.id)) return false
			if (!keyword) return true
			return String(label.name || '')
				.toLowerCase()
				.includes(keyword)
		})
	}, [availableLabels, formData.selected_labels, labelSearch])

	const selectedPipelineStageChips = useMemo(() => {
		return selectedPipelineStageIds
			.map((stageId) => {
				const matched = availablePipelineStages.find(
					(stage) => stage.id === stageId,
				)
				if (!matched) return null
				return matched
			})
			.filter(Boolean) as PipelineStageOption[]
	}, [availablePipelineStages, selectedPipelineStageIds])

	const pipelineStagePickerOptions = useMemo(() => {
		const keyword = pipelineStageSearch.trim().toLowerCase()
		return availablePipelineStages.filter((stage) => {
			if (selectedPipelineStageIds.includes(stage.id)) return false
			const searchable =
				`${stage.name} ${stage.pipelineName || ''}`.toLowerCase()
			return keyword ? searchable.includes(keyword) : true
		})
	}, [availablePipelineStages, selectedPipelineStageIds, pipelineStageSearch])

	const activeModelPricing = useMemo(
		() => modelPricing.filter((item) => item.is_active !== false),
		[modelPricing],
	)

	const modelOptions = useMemo(() => {
		const pricingSource =
			activeModelPricing.length > 0
				? activeModelPricing
				: Object.entries(FALLBACK_MODEL_COSTS).map(([modelName, cost]) => ({
						id: modelName,
						model_name: modelName,
						cost_per_request: cost,
						description: MODEL_REFERENCE_META[modelName]?.description ?? null,
						is_active: true,
					}))

		const knownModelSet = new Set<string>(MODEL_REFERENCE_ORDER)
		const currentModelKey = normalizeModelKey(formData.model)
		const mapped = pricingSource
			.map((model) => {
				const normalizedModel = normalizeModelKey(model.model_name)
				const reference = MODEL_REFERENCE_META[normalizedModel]
				return {
					value: model.model_name,
					label: reference?.label || titleCaseFromModelKey(model.model_name),
					category: reference?.category || 'OTHERS',
					description: reference?.description || model.description || undefined,
					costPerRequest: Number(model.cost_per_request),
					isNew: reference?.isNew,
				} as ModelOption
			})
			.filter((option) => {
				const optionKey = normalizeModelKey(option.value)
				return knownModelSet.has(optionKey) || optionKey === currentModelKey
			})

		const unique = Array.from(
			new Map(
				mapped.map((item) => [normalizeModelKey(item.value), item]),
			).values(),
		)

		return unique.sort((left, right) => {
			const leftKey = normalizeModelKey(left.value)
			const rightKey = normalizeModelKey(right.value)
			const leftOrder = MODEL_REFERENCE_ORDER.findIndex(
				(key) => key === leftKey,
			)
			const rightOrder = MODEL_REFERENCE_ORDER.findIndex(
				(key) => key === rightKey,
			)
			if (leftOrder !== -1 && rightOrder !== -1) return leftOrder - rightOrder
			if (leftOrder !== -1) return -1
			if (rightOrder !== -1) return 1
			return left.label.localeCompare(right.label)
		})
	}, [activeModelPricing, formData.model])

	const filteredModelOptions = useMemo(() => {
		const keyword = modelSearch.trim().toLowerCase()
		if (!keyword) return modelOptions
		return modelOptions.filter((option) => {
			const searchable =
				`${option.label} ${option.value} ${option.description || ''}`.toLowerCase()
			return searchable.includes(keyword)
		})
	}, [modelOptions, modelSearch])

	const groupedFilteredModelOptions = useMemo(() => {
		return MODEL_CATEGORY_ORDER.map((category) => ({
			category,
			items: filteredModelOptions.filter(
				(option) => option.category === category,
			),
		})).filter((group) => group.items.length > 0)
	}, [filteredModelOptions])

	const timezoneOptions = useMemo(() => {
		const priorityIndonesia = INDONESIA_TIMEZONES.map((item) => item.value)
		const knownByValue = new Map(
			TIMEZONES.map((timezone) => [
				timezone.value,
				{
					value: timezone.value,
					label: timezone.label,
					offset: timezone.offset,
					region: timezone.region,
					isKnown: true,
				},
			]),
		)

		let dynamicList: string[] = []
		try {
			const supportedValuesOf = (Intl as any).supportedValuesOf
			if (typeof supportedValuesOf === 'function') {
				dynamicList = supportedValuesOf('timeZone') as string[]
			}
		} catch {
			dynamicList = []
		}

		for (const value of dynamicList) {
			if (!knownByValue.has(value)) {
				knownByValue.set(value, {
					value,
					label: value.replace(/_/g, ' '),
					offset: getTimezoneOffsetLabel(value),
					region: value.split('/')[0] || 'Other',
					isKnown: false,
				})
			}
		}

		if (formData.timezone && !knownByValue.has(formData.timezone)) {
			knownByValue.set(formData.timezone, {
				value: formData.timezone,
				label: formData.timezone.replace(/_/g, ' '),
				offset: getTimezoneOffsetLabel(formData.timezone),
				region: formData.timezone.split('/')[0] || 'Other',
				isKnown: false,
			})
		}

		return Array.from(knownByValue.values())
			.sort((left, right) => {
				const leftPriority = priorityIndonesia.indexOf(left.value)
				const rightPriority = priorityIndonesia.indexOf(right.value)

				if (leftPriority !== -1 || rightPriority !== -1) {
					if (leftPriority === -1) return 1
					if (rightPriority === -1) return -1
					return leftPriority - rightPriority
				}

				if (left.region !== right.region) {
					return left.region.localeCompare(right.region)
				}
				return left.label.localeCompare(right.label)
			})
			.map((timezone) => ({
				value: timezone.value,
				label: timezone.offset
					? `(${timezone.offset}) ${timezone.label}`
					: timezone.label,
			}))
	}, [formData.timezone])

	const selectedModelOption = useMemo(() => {
		return (
			modelOptions.find((option) => option.value === formData.model) ||
			modelOptions.find(
				(option) =>
					normalizeModelKey(option.value) === normalizeModelKey(formData.model),
			) || {
				value: formData.model,
				label: titleCaseFromModelKey(formData.model),
				category: 'OTHERS' as ModelCategory,
				costPerRequest:
					FALLBACK_MODEL_COSTS[normalizeModelKey(formData.model)] ||
					FALLBACK_MODEL_COSTS.basic,
			}
		)
	}, [formData.model, modelOptions])

	const updateSelectedPipelineStageIds = (nextStageIds: string[]) => {
		setFormData((prev) => ({
			...prev,
			app_data: {
				...(prev.app_data || {}),
				ai_actions: {
					...(prev.app_data?.ai_actions || {}),
					pipeline_stage_ids: nextStageIds,
				},
			},
		}))
	}

	const fetchEvaluations = async () => {
		setLoadingEvaluations(true)
		try {
			const res = await fetch(
				`${API_URL}/api/chatbots/${agentId}/evaluations?page=${evaluationPage}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			)
			const data = await res.json()
			if (data.data) {
				setEvaluations(data.data)
				setEvaluationPagination(data.pagination)
			}
		} catch (error) {
			console.error('Failed to fetch evaluations:', error)
		} finally {
			setLoadingEvaluations(false)
		}
	}

	const handleDeleteEvaluation = async (evalId: string) => {
		if (!confirm('Are you sure you want to delete this evaluation report?'))
			return
		try {
			const res = await fetch(
				`${API_URL}/api/chatbots/${agentId}/evaluations/${evalId}`,
				{
					method: 'DELETE',
					headers: { Authorization: `Bearer ${token}` },
				},
			)
			if (res.ok) {
				toast.success('Evaluation deleted')
				fetchEvaluations()
			} else {
				toast.error('Failed to delete evaluation')
			}
		} catch (error) {
			toast.error('Delete failed')
		}
	}

	const handleSaveAsEvaluation = async () => {
		if (previewMessages.length === 0) {
			toast.error('No messages to save')
			return
		}
		setSavingEvaluation(true)
		try {
			const res = await fetch(
				`${API_URL}/api/chatbots/${agentId}/evaluations`,
				{
					method: 'POST',
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({
						type: 'test_run',
						messages: previewMessages
							.filter((m) => m.role !== 'system')
							.map((m) => ({
								role: m.role === 'assistant' ? 'ai' : 'user',
								message:
									m.kind === 'image'
										? `[Image] ${m.url}`
										: m.content,
								msg_created_at: new Date().toISOString(),
							})),
					}),
				},
			)
			if (res.ok) {
				toast.success('Simulation saved as test evaluation')
				setPreviewMessages([])
			} else {
				toast.error('Failed to save evaluation')
			}
		} catch (error) {
			toast.error('Save failed')
		} finally {
			setSavingEvaluation(false)
		}
	}

	const fetchInboxes = async () => {
		setLoadingInboxes(true)
		try {
			const res = await fetch(`${API_URL}/api/inboxes`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.payload) {
				setInboxes(data.payload)
			}
		} catch (error) {
			console.error('Failed to fetch inboxes:', error)
		} finally {
			setLoadingInboxes(false)
		}
	}

	const fetchLabels = async () => {
		try {
			const res = await fetch(`${API_URL}/api/labels`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			const normalizeLabels = (items: any[]) =>
				items
					.map((item: any) => {
						const id = String(item?.id ?? '').trim()
						const resolvedName = String(
							item?.name ?? item?.title ?? item?.label ?? item?.text ?? '',
						).trim()
						return {
							id,
							name: resolvedName || (id ? `Label ${id.slice(0, 8)}` : ''),
							color:
								typeof item?.color === 'string' && item.color.trim()
									? item.color
									: '#6B7280',
						}
					})
					.filter((label) => label.id)

			if (data.data?.labels) {
				// API returns { data: { labels: [...], metadata: {...} } }
				setAvailableLabels(normalizeLabels(data.data.labels))
			} else if (data.payload) {
				// Fallback for alternative response format
				setAvailableLabels(normalizeLabels(data.payload))
			} else if (Array.isArray(data.data)) {
				// Fallback if data is directly an array
				setAvailableLabels(normalizeLabels(data.data))
			}
		} catch (error) {
			console.error('Failed to fetch labels:', error)
		}
	}

	const fetchPipelineStages = async () => {
		try {
			const res = await fetch(`${API_URL}/api/crm/pipelines`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			const pipelines = Array.isArray(data?.data) ? data.data : []
			const flattenedStages: PipelineStageOption[] = pipelines.flatMap(
				(pipeline: any) =>
					(pipeline?.pipeline_stages || []).map((stage: any) => ({
						id: String(stage.id),
						name: String(stage.name || 'Untitled Stage'),
						color: stage.color || '#8B5CF6',
						pipelineName: pipeline.name || 'Pipeline',
					})),
			)
			const deduped = Array.from(
				new Map(flattenedStages.map((stage) => [stage.id, stage])).values(),
			)
			setAvailablePipelineStages(deduped)
		} catch (error) {
			console.error('Failed to fetch pipeline stages:', error)
		}
	}

	const fetchModelPricing = async () => {
		setLoadingModelPricing(true)
		try {
			const res = await fetch(`${API_URL}/api/chatbots/model-pricing`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (Array.isArray(data?.data)) {
				setModelPricing(
					data.data.map((item: any) => ({
						id: String(item.id),
						model_name: String(item.model_name),
						cost_per_request: Number(item.cost_per_request),
						description:
							typeof item.description === 'string' ? item.description : null,
						is_active: item.is_active ?? true,
					})),
				)
			}
		} catch (error) {
			console.error('Failed to fetch model pricing:', error)
		} finally {
			setLoadingModelPricing(false)
		}
	}

	const fetchAiToolCatalog = async () => {
		const headers: Record<string, string> = {}
		if (token) headers.Authorization = `Bearer ${token}`
		if (businessId) headers['x-business-id'] = businessId

		const url = new URL(`${API_URL}/api/ai_tools`)
		if (businessId) url.searchParams.set('business_id', businessId)

		const res = await fetch(url.toString(), { headers })
		if (!res.ok) {
			throw new Error('Failed to fetch AI tool catalog')
		}

		const data = await res.json()
		return normalizeApiToolCatalog(data?.data)
	}

	const fetchAgent = async () => {
		setLoading(true)
		setLoadingAiTools(true)
		try {
			const [agentRes, aiToolsCatalog] = await Promise.all([
				fetch(`${API_URL}/api/chatbots/${agentId}`, {
					headers: { Authorization: `Bearer ${token}` },
				}),
				fetchAiToolCatalog().catch(() => [] as ApiToolCatalogItem[]),
			])

			const data = await agentRes.json()
			if (data.data) {
				setAgent(data.data)

				const configuredCards = normalizeAiToolCards(data.data.plugin_data?.ai_tools)
					const mergedCards =
						aiToolsCatalog.length > 0
							? mergeAiToolCardsFromCatalog({
									catalog: aiToolsCatalog,
									configured: configuredCards,
								})
							: configuredCards
					setAiToolCards(sortAiToolCards(mergedCards))

				setFormData({
					name: data.data.name || '',
					description: data.data.description || '',
					prompt: data.data.prompt || '',
					welcome_msg: data.data.welcome_msg || '',
					agent_transfer: data.data.agent_transfer || '',
					temperature: Number.isFinite(Number(data.data.temperature))
						? Number(data.data.temperature)
						: 0.2,
					history_limit: data.data.history_limit || 50,
					context_limit: data.data.context_limit || 50,
					message_await: data.data.message_await || 30,
					message_limit: data.data.message_limit || 1000,
					max_file_read_window: data.data.max_file_read_window || 3,
					is_silent_handoff_agent: data.data.is_silent_handoff_agent || false,
					watcher_enabled:
						data.data.watcher_enabled ??
						data.data.plugin_data?.watcher_enabled ??
						false,
					session_only_memory:
						data.data.session_only_memory ??
						data.data.plugin_data?.session_only_memory ??
						false,
					stop_after_handoff:
						data.data.stop_after_handoff ??
						data.data.plugin_data?.stop_after_handoff ??
						true,
					timezone: data.data.timezone || 'Asia/Jakarta',
					label_condition: data.data.label_condition || '',
					selected_labels: data.data.selected_labels || [],
					model: data.data.model || 'standard_plus_b',
					app_data: data.data.app_data || {},
					ai_followups: parseAiFollowups(data.data.ai_followups),
				})
			}
		} catch (error) {
			console.error('Failed to fetch agent:', error)
			toast.error('Failed to load agent')
		} finally {
			setLoading(false)
			setLoadingAiTools(false)
		}
	}

	const fetchKnowledgeData = async () => {
		try {
			const docsRes = await fetch(
				`${API_URL}/api/chatbots/${agentId}/documents`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			)
			const docsData = await docsRes.json()

			if (docsData.data || docsData.payload) {
				const documents = docsData.data || docsData.payload || []
				const qnas: any[] = []
				const products: any[] = []

				const parseEvaluationContent = (content: string) => {
					const questionMatch = content.match(
						/question:\s*'([^']*(?:\\.[^']*)*)'/,
					)
					const answerMatch = content.match(/answer:\s*"([^"]*(?:\\.[^"]*)*)"/)
					return {
						question: questionMatch
							? questionMatch[1].replace(/\\n/g, '\n')
							: content.substring(0, 100) + '...',
						answer: answerMatch ? answerMatch[1].replace(/\\n/g, '\n') : '',
					}
				}

				documents.forEach((doc: any) => {
					switch (doc.type) {
						case 'evaluation': {
							const parsed = parseEvaluationContent(doc.content || '')
							qnas.push({
								id: doc.id,
								question: doc.question || parsed.question,
								answer: doc.answer || parsed.answer,
								type: doc.type,
								created_at: doc.created_at,
							})
							break
						}
						case 'qna':
							qnas.push({
								id: doc.id,
								question: doc.question || doc.title || '',
								answer: doc.answer || doc.content || '',
								type: doc.type,
								created_at: doc.created_at,
							})
							break
						case 'product':
							products.push({
								id: doc.id,
								name: doc.title || '',
								description: doc.content || '',
								type: doc.type,
								created_at: doc.created_at,
							})
							break
					}
				})

				setQnaItems(qnas)
				setProductItems(products)
			}
		} catch (error) {
			console.error('Failed to fetch knowledge data:', error)
		}
	}

	const handleToggleInbox = async (
		inboxId: string,
		currentChatbotId: string | null,
	) => {
		const isLinked = currentChatbotId === agentId
		const newChatbotId = isLinked ? null : agentId

		try {
			const res = await fetch(`${API_URL}/api/inboxes/${inboxId}`, {
				method: 'PATCH',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					chatbot_id: newChatbotId,
				}),
			})

			if (res.ok) {
				toast.success(isLinked ? 'Inbox unlinked' : 'Inbox linked to agent')
				fetchInboxes()
			} else {
				toast.error('Failed to update inbox')
			}
		} catch (error) {
			toast.error('Update failed')
		}
	}

	const persistAiToolCards = async (nextCards: AIToolCardItem[]) => {
		try {
			const res = await fetch(`${API_URL}/api/chatbots/${agentId}`, {
				method: 'PATCH',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					plugin_data: {
						...(agent?.plugin_data || {}),
						ai_tools: nextCards,
					},
				}),
			})

			if (!res.ok) {
				toast.error('Failed to update AI Tool')
				return false
			}

			setAgent((prev) =>
				prev
					? {
							...prev,
							plugin_data: {
								...(prev.plugin_data || {}),
								ai_tools: nextCards,
							},
						}
					: prev,
			)
			return true
		} catch (error) {
			console.error('Failed to persist AI Tools:', error)
			toast.error('Failed to update AI Tool')
			return false
		}
	}

	const handleToggleAiTool = async (toolId: string) => {
		const previousCards = aiToolCards
		const nextCards = previousCards.map((tool) =>
			tool.id === toolId ? { ...tool, is_active: !tool.is_active } : tool,
		)
		const sortedNextCards = sortAiToolCards(nextCards)

		setAiToolCards(sortedNextCards)
		setUpdatingAiToolId(toolId)
		const isSaved = await persistAiToolCards(sortedNextCards)
		setUpdatingAiToolId(null)

		if (!isSaved) {
			setAiToolCards(previousCards)
			return
		}

		const updatedTool = sortedNextCards.find((tool) => tool.id === toolId)
		if (updatedTool) {
			toast.success(
				`${updatedTool.name} ${updatedTool.is_active ? 'activated' : 'deactivated'}`,
			)
		}
	}

	const handleDeleteSource = async (id: string) => {
		if (!confirm('Are you sure you want to delete this knowledge source?'))
			return

		try {
			const res = await fetch(
				`${API_URL}/api/chatbots/${agentId}/documents/${id}`,
				{
					method: 'DELETE',
					headers: { Authorization: `Bearer ${token}` },
				},
			)

			if (res.ok) {
				toast.success('Knowledge source deleted')
				setQnaItems((prev) => prev.filter((d) => d.id !== id))
				setProductItems((prev) => prev.filter((d) => d.id !== id))
			} else {
				toast.error('Failed to delete source')
			}
		} catch (error) {
			toast.error('Delete failed')
		}
	}

	const handleSave = async () => {
		const trimmedName = formData.name.trim()
		if (!trimmedName) {
			toast.error('Agent name cannot be empty')
			return
		}

		setSaving(true)
		try {
			const chatbotSettingsPayload = {
				name: trimmedName,
				description: formData.description,
				prompt: formData.prompt,
				welcome_msg: formData.welcome_msg,
				agent_transfer: formData.agent_transfer,
				model: formData.model,
				temperature: Number.isFinite(Number(formData.temperature))
					? Number(formData.temperature)
					: 0.2,
				history_limit: formData.history_limit,
				context_limit: formData.context_limit,
				message_await: formData.message_await,
				message_limit: formData.message_limit,
				max_file_read_window: formData.max_file_read_window,
				is_silent_handoff_agent: formData.is_silent_handoff_agent,
				watcher_enabled: formData.watcher_enabled,
				session_only_memory: formData.session_only_memory,
				stop_after_handoff: formData.stop_after_handoff,
				timezone: formData.timezone,
				label_condition: formData.label_condition,
				selected_labels: formData.selected_labels,
				app_data: formData.app_data,
				ai_followups: formData.ai_followups,
				plugin_data: {
					...(agent?.plugin_data || {}),
					stop_after_handoff: formData.stop_after_handoff,
					watcher_enabled: formData.watcher_enabled,
					session_only_memory: formData.session_only_memory,
				},
			}

			// 1. Save Chatbot Settings
			const res = await fetch(`${API_URL}/api/chatbots/${agentId}`, {
				method: 'PATCH',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(chatbotSettingsPayload),
			})

			if (res.ok) {
				toast.success('AI Settings saved successfully')
				setFormData((prev) => ({ ...prev, name: trimmedName }))
				fetchAgent()
			} else {
				toast.error('Failed to save settings')
			}
		} catch (error) {
			toast.error('Save failed')
		} finally {
			setSaving(false)
		}
	}

	const handleAddFollowupRule = () => {
		setFormData((prev) => ({
			...prev,
			ai_followups: [
				...parseAiFollowups(prev.ai_followups),
				createEmptyFollowupRule(),
			],
		}))
	}

	const handleSaveFollowups = async () => {
		setSavingFollowups(true)
		try {
			const normalizedFollowups = normalizeAiFollowupsForSave(
				formData.ai_followups,
			)

			const res = await fetch(`${API_URL}/api/chatbots/${agentId}`, {
				method: 'PATCH',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					ai_followups: normalizedFollowups,
				}),
			})

			const responseData = await res.json().catch(() => null)

			if (!res.ok) {
				const errorMessage =
					responseData?.error ||
					responseData?.message ||
					'Failed to save follow-up rules'
				toast.error(errorMessage)
				return
			}

			const persistedFollowups = normalizeAiFollowupsForSave(
				responseData?.data?.ai_followups ?? normalizedFollowups,
			)

			setFormData((prev) => ({
				...prev,
				ai_followups: persistedFollowups,
			}))

			setAgent((prev) =>
				prev
					? {
							...prev,
							ai_followups: persistedFollowups,
						}
					: prev,
			)

			toast.success('Follow-up rules saved')
		} catch (error) {
			toast.error('Save follow-up failed')
		} finally {
			setSavingFollowups(false)
		}
	}

	const handleCopyPreviewMessage = async (message: PreviewMessage) => {
		if (message.role !== 'assistant' || message.kind !== 'text') return

		try {
			await navigator.clipboard.writeText(message.content)
			setCopiedPreviewMessageId(message.id)
			setTimeout(() => {
				setCopiedPreviewMessageId((current) =>
					current === message.id ? null : current,
				)
			}, 1200)
		} catch {
			toast.error('Failed to copy message')
		}
	}

	const handleSendPreviewMessage = async () => {
		if (!chatMessage.trim() || previewLoading) return

		const userMsg = chatMessage.trim()
		const historyForSimulation = previewMessages
			.map((message) => previewMessageToHistory(message))
			.filter(
				(
					entry,
				): entry is {
					role: 'user' | 'assistant'
					content: string
				} => Boolean(entry),
			)
			.slice(-10)

		setPreviewMessages((prev) => [
			...prev,
			{
				id: createPreviewMessageId('user'),
				role: 'user',
				kind: 'text',
				content: userMsg,
			},
		])
		setChatMessage('')
		setPreviewLoading(true)

		try {
			const res = await fetch(`${API_URL}/api/chatbots/${agentId}/simulate`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					message: userMsg,
					history: historyForSimulation,
					execute_tools: true,
				}),
			})

			if (res.ok) {
				const data = await res.json()
				const simulationMessages =
					buildPreviewMessagesFromSimulationResponse(data)
				if (simulationMessages.length === 0) {
					toast.error('Simulation returned no response')
					return
				}

				setPreviewMessages((prev) => [...prev, ...simulationMessages])
			} else {
				toast.error('Simulation failed')
			}
		} catch (error) {
			toast.error('Failed to send message')
		} finally {
			setPreviewLoading(false)
		}
	}

	const tabs = [
		{ id: 'general', label: 'General', icon: Settings },
		{ id: 'followups', label: 'Followup', icon: Clock },
	]

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center bg-white">
				<Bot className="animate-bounce text-emerald-500" size={48} />
			</div>
		)
	}

	return (
		<div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
			{/* Header */}
			<div className="bg-white border-b border-gray-200 px-6 py-4">
				<div className="flex items-center justify-between">
					<div className="flex items-center gap-4">
						<a
							href="/ai-agents"
							className="flex items-center gap-2 text-gray-600 hover:text-gray-900 transition"
						>
							<ArrowLeft size={20} />
							<span className="text-sm font-medium">Back</span>
						</a>
					</div>
					<h1 className="text-xl font-bold text-gray-900 absolute left-1/2 transform -translate-x-1/2">
						{formData.name.trim() || agent?.name || 'AI Agent'}
					</h1>
					<div className="flex items-center gap-2">
						<button className="p-2 text-gray-400 hover:text-gray-600 transition">
							<RefreshCw size={18} onClick={fetchAgent} />
						</button>
					</div>
				</div>
			</div>

			{/* Tabs */}
			<div className="bg-white border-b border-gray-200 px-6">
				<div className="flex items-center justify-center gap-1 overflow-x-auto">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							onClick={() => setActiveTab(tab.id as Tab)}
							className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition whitespace-nowrap ${
								activeTab === tab.id
									? 'border-blue-500 text-blue-600'
									: 'border-transparent text-gray-500 hover:text-gray-700'
							}`}
						>
							<tab.icon size={16} />
							{tab.label}
						</button>
					))}
				</div>
			</div>

			{/* Content */}
			<div className="flex-1 overflow-y-auto">
				<div className="max-w-7xl mx-auto p-6">
					<div className="flex gap-6">
						{/* Main Form */}
						<div className="flex-1 space-y-6">
							{activeTab === 'general' && (
								<>
									{/* Agent Info Header */}
									<div className="text-center">
										<label
											htmlFor="agent-name"
											className="sr-only"
										>
											Agent name
										</label>
										<input
											id="agent-name"
											type="text"
											value={formData.name}
											onChange={(e) =>
												setFormData({ ...formData, name: e.target.value })
											}
											className="mx-auto block w-full max-w-md rounded-lg border border-transparent bg-transparent px-3 py-2 text-center text-2xl font-bold text-gray-900 outline-none transition hover:border-gray-200 hover:bg-white focus:border-blue-500 focus:bg-white focus:ring-2 focus:ring-blue-100"
											placeholder="AI Agent"
										/>
										<p className="text-gray-500 text-sm mt-1">Description</p>
										{agent?.updated_at && (
											<p className="text-xs text-gray-400 mt-2">
												Last Trained:{' '}
												{new Date(agent.updated_at).toLocaleDateString(
													'en-GB',
													{
														day: '2-digit',
														month: '2-digit',
														year: '2-digit',
														hour: '2-digit',
														minute: '2-digit',
													},
												)}
											</p>
										)}
									</div>

									{/* AI Agent Behavior */}
									<div className="bg-white rounded-xl border border-gray-200 p-6">
										<h3 className="text-blue-600 font-semibold text-center mb-2">
											AI Agent Behavior
										</h3>
										<p className="text-gray-500 text-sm text-center mb-4">
											Ini adalah Prompt AI yang akan mengatur gaya bicara dan
											identitas AI nya.
										</p>
										<div className="relative">
											<textarea
												value={formData.prompt}
												onChange={(e) =>
													setFormData({ ...formData, prompt: e.target.value })
												}
												rows={12}
												className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
												placeholder="Enter the AI agent behavior prompt here..."
											/>
											<div className="absolute bottom-3 right-3 text-xs text-gray-400">
												{formData.prompt.length}/15000
											</div>
										</div>
									</div>

										{/* Agent Transfer Conditions */}
										<div className="bg-white rounded-xl border border-gray-200 p-6">
											<h3 className="text-blue-600 font-semibold text-center mb-2">
												Agent Transfer Conditions
											</h3>
										<p className="text-gray-500 text-sm text-center mb-4">
											Tentukan kondisi yang akan memicu AI untuk mentransfer
											chat ke agen manusia. Status chat akan menjadi{' '}
											<span className="text-amber-500 font-medium">
												Pending
											</span>{' '}
											dan akan muncul di tab Chat{' '}
											<span className="text-blue-500 font-medium">
												Assigned
											</span>
											.
										</p>
										<div className="relative">
											<textarea
												value={formData.agent_transfer}
												onChange={(e) =>
													setFormData({
														...formData,
														agent_transfer: e.target.value,
													})
												}
												rows={8}
												className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm font-mono leading-relaxed focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none resize-none"
												placeholder="While transfer to agent dont mention human, just silent transfer NO MESSAGES..."
											/>
											<div className="absolute bottom-3 right-3 text-xs text-gray-400">
												{(formData.agent_transfer || '').length}/750
												</div>
											</div>
										</div>

											{/* Handoff Configuration */}
											<div className="bg-white rounded-xl border border-gray-200 p-6">
												<div className="space-y-4">
													<div className="flex items-start justify-between gap-4">
														<div>
															<p className="text-base font-semibold text-gray-700">
																Stop AI after Handoff
															</p>
															<p className="text-sm text-gray-600 mt-1">
																Stop the AI from sending messages after the chat
																status changes to{' '}
																<span className="text-red-500 font-medium">
																Pending
															</span>
															.
														</p>
													</div>
													<button
														type="button"
														aria-label="Toggle stop AI after handoff"
														onClick={() =>
															setFormData({
																...formData,
																	stop_after_handoff:
																		!formData.stop_after_handoff,
																})
															}
															className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
																formData.stop_after_handoff
																	? 'bg-blue-600'
																	: 'bg-gray-300'
														}`}
														>
															<span
																className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
																	formData.stop_after_handoff
																		? 'translate-x-5'
																		: 'translate-x-0.5'
																}`}
															/>
														</button>
												</div>

												<div className="h-px bg-gray-100" />

													<div className="flex items-start justify-between gap-4">
														<div>
															<p className="text-base font-semibold text-gray-700">
																Silent Agent Handoff
															</p>
															<p className="text-sm text-gray-600 mt-1">
																AI silently transfers the conversation to an agent
																with no further AI replies.
															</p>
													</div>
													<button
														type="button"
														aria-label="Toggle silent agent handoff"
														onClick={() =>
															setFormData({
																...formData,
																	is_silent_handoff_agent:
																		!formData.is_silent_handoff_agent,
																})
															}
															className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
																formData.is_silent_handoff_agent
																	? 'bg-blue-600'
																	: 'bg-gray-300'
														}`}
														>
															<span
																className={`inline-block h-5 w-5 transform rounded-full bg-white transition-transform ${
																	formData.is_silent_handoff_agent
																		? 'translate-x-5'
																		: 'translate-x-0.5'
																}`}
															/>
														</button>
												</div>
											</div>
											</div>

											{/* AI Actions */}
											{false && (
												<div className="space-y-4">
										<button
											type="button"
											onClick={() => setShowAIActions((prev) => !prev)}
											className="w-full bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center justify-between"
										>
											<div className="flex items-center gap-3">
												<div className="w-11 h-11 rounded-xl bg-blue-500 text-white flex items-center justify-center shrink-0">
													<Zap size={20} />
												</div>
												<div>
													<h4 className="text-gray-900 font-semibold">
														AI Actions
													</h4>
													<p className="text-sm text-gray-500">
														Configure labels and pipeline statuses that AI can
														use automatically.
													</p>
												</div>
											</div>
											<ChevronDown
												size={18}
												className={`text-gray-400 transition-transform ${
													showAIActions ? 'rotate-180' : ''
												}`}
											/>
										</button>

										{showAIActions && (
											<div className="bg-white rounded-xl border border-gray-200 p-6 space-y-8">
												<div className="space-y-4">
													<div className="flex items-center gap-2">
														<div className="w-8 h-8 rounded-lg bg-emerald-100 text-emerald-600 flex items-center justify-center">
															<Tag size={16} />
														</div>
														<h4 className="text-xl font-semibold text-gray-800">
															Change Conversation Label
														</h4>
														<Info size={14} className="text-gray-400" />
													</div>
													<p className="text-gray-500">
														Select labels that AI is allowed to use for tagging
														conversations automatically.
													</p>

													{selectedLabelChips.length > 0 && (
														<div className="flex flex-wrap gap-2">
															{selectedLabelChips.map((label) => (
																<div
																	key={label.id}
																	className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
																>
																	<span
																		className="w-2 h-2 rounded-full"
																		style={{ backgroundColor: label.color }}
																	/>
																	<span>{label.name}</span>
																	<button
																		type="button"
																		onClick={() =>
																			setFormData((prev) => ({
																				...prev,
																				selected_labels:
																					prev.selected_labels.filter(
																						(id) => id !== label.id,
																					),
																			}))
																		}
																		className="text-gray-500 hover:text-gray-700 transition"
																	>
																		<X size={14} />
																	</button>
																</div>
															))}
														</div>
													)}

													<div className="relative">
														<button
															type="button"
															onClick={() =>
																setShowLabelPicker((prev) => !prev)
															}
															className="w-full h-12 rounded-xl border border-gray-300 bg-white px-4 text-left text-gray-500 flex items-center justify-between hover:border-gray-400 transition"
														>
															<span className="flex items-center gap-2">
																<Plus size={16} />
																Add label...
															</span>
															<ChevronDown
																size={16}
																className={`transition-transform ${showLabelPicker ? 'rotate-180' : ''}`}
															/>
														</button>

														{showLabelPicker && (
															<div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
																<div className="p-2 border-b border-gray-100">
																	<div className="relative">
																		<Search
																			size={16}
																			className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
																		/>
																		<input
																			type="text"
																			value={labelSearch}
																			onChange={(e) =>
																				setLabelSearch(e.target.value)
																			}
																			placeholder="Search labels..."
																			className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
																		/>
																	</div>
																</div>
																<div className="max-h-56 overflow-y-auto p-2 space-y-1">
																	{labelPickerOptions.length > 0 ? (
																		labelPickerOptions.map((label) => (
																			<button
																				type="button"
																				key={label.id}
																				onClick={() => {
																					setFormData((prev) => ({
																						...prev,
																						selected_labels: [
																							...prev.selected_labels,
																							label.id,
																						],
																					}))
																					setLabelSearch('')
																					setShowLabelPicker(false)
																				}}
																				className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-left hover:bg-gray-100 text-sm text-gray-700"
																			>
																				<span
																					className="w-2 h-2 rounded-full"
																					style={{
																						backgroundColor:
																							label.color || '#6B7280',
																					}}
																				/>
																				{label.name}
																			</button>
																		))
																	) : (
																		<p className="px-3 py-2 text-sm text-gray-400">
																			No labels available.
																		</p>
																	)}
																</div>
															</div>
														)}
													</div>

													<div>
														<label className="block text-sm font-bold text-gray-700 mb-1">
															Label Conditions
														</label>
														<p className="text-sm text-gray-500 mb-2">
															Instructions for when AI should apply specific
															labels. Example: "Apply label Purchased when
															customer confirms a purchase"
														</p>
														<div className="relative">
															<textarea
																value={formData.label_condition}
																onChange={(e) =>
																	setFormData({
																		...formData,
																		label_condition: e.target.value.substring(
																			0,
																			3000,
																		),
																	})
																}
																rows={5}
																maxLength={3000}
																className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-lg text-sm leading-relaxed focus:ring-2 focus:ring-blue-500 outline-none resize-none"
																placeholder='- Label "Potential Booking": jika customer menunjukkan niat booking atau konsultasi...'
															/>
															<div className="text-right text-xs text-gray-400 mt-1">
																{formData.label_condition.length}/3000
															</div>
														</div>
													</div>
												</div>

												<div className="border-t border-gray-100 pt-8 space-y-4">
													<div className="flex items-center gap-2">
														<div className="w-8 h-8 rounded-lg bg-violet-100 text-violet-600 flex items-center justify-center">
															<GitBranch size={16} />
														</div>
														<h4 className="text-xl font-semibold text-gray-800">
															Change Conversation Pipeline Status
														</h4>
														<Info size={14} className="text-gray-400" />
													</div>
													<p className="text-gray-500">
														Select pipeline statuses that AI is allowed to move
														conversations to. AI can only move forward in the
														pipeline.
													</p>

													{selectedPipelineStageChips.length > 0 && (
														<div className="flex flex-wrap gap-2">
															{selectedPipelineStageChips.map((stage) => (
																<div
																	key={stage.id}
																	className="inline-flex items-center gap-2 rounded-full bg-gray-100 px-3 py-1.5 text-sm text-gray-700"
																>
																	<span
																		className="w-2 h-2 rounded-full"
																		style={{
																			backgroundColor: stage.color || '#8B5CF6',
																		}}
																	/>
																	<span>{stage.name}</span>
																	<button
																		type="button"
																		onClick={() =>
																			updateSelectedPipelineStageIds(
																				selectedPipelineStageIds.filter(
																					(id) => id !== stage.id,
																				),
																			)
																		}
																		className="text-gray-500 hover:text-gray-700 transition"
																	>
																		<X size={14} />
																	</button>
																</div>
															))}
														</div>
													)}

													<div className="relative">
														<button
															type="button"
															onClick={() =>
																setShowPipelineStagePicker((prev) => !prev)
															}
															className="w-full h-12 rounded-xl border border-gray-300 bg-white px-4 text-left text-gray-500 flex items-center justify-between hover:border-gray-400 transition"
														>
															<span className="flex items-center gap-2">
																<Plus size={16} />
																Add pipeline status...
															</span>
															<ChevronDown
																size={16}
																className={`transition-transform ${showPipelineStagePicker ? 'rotate-180' : ''}`}
															/>
														</button>

														{showPipelineStagePicker && (
															<div className="absolute z-20 mt-2 w-full rounded-xl border border-gray-200 bg-white shadow-xl overflow-hidden">
																<div className="p-2 border-b border-gray-100">
																	<div className="relative">
																		<Search
																			size={16}
																			className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
																		/>
																		<input
																			type="text"
																			value={pipelineStageSearch}
																			onChange={(e) =>
																				setPipelineStageSearch(e.target.value)
																			}
																			placeholder="Search pipeline status..."
																			className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 outline-none text-sm"
																		/>
																	</div>
																</div>
																<div className="max-h-56 overflow-y-auto p-2 space-y-1">
																	{pipelineStagePickerOptions.length > 0 ? (
																		pipelineStagePickerOptions.map((stage) => (
																			<button
																				type="button"
																				key={stage.id}
																				onClick={() => {
																					updateSelectedPipelineStageIds([
																						...selectedPipelineStageIds,
																						stage.id,
																					])
																					setPipelineStageSearch('')
																					setShowPipelineStagePicker(false)
																				}}
																				className="w-full px-3 py-2 rounded-lg text-left hover:bg-gray-100 text-sm text-gray-700"
																			>
																				<div className="flex items-center gap-2">
																					<span
																						className="w-2 h-2 rounded-full"
																						style={{
																							backgroundColor:
																								stage.color || '#8B5CF6',
																						}}
																					/>
																					<span>{stage.name}</span>
																				</div>
																				{stage.pipelineName && (
																					<p className="text-xs text-gray-400 mt-0.5">
																						{stage.pipelineName}
																					</p>
																				)}
																			</button>
																		))
																	) : (
																		<p className="px-3 py-2 text-sm text-gray-400">
																			No pipeline statuses available.
																		</p>
																	)}
																</div>
															</div>
														)}
													</div>
												</div>
											</div>
											)}
												</div>
											)}

											{/* AI Model */}
											{false && (
												<div className="bg-white rounded-xl border border-gray-200 p-6 space-y-4">
										<div className="flex items-center gap-3">
											<div className="w-11 h-11 rounded-xl bg-cyan-500 text-white flex items-center justify-center">
												<Bot size={20} />
											</div>
											<div>
												<h4 className="text-2xl font-semibold text-gray-900">
													AI Model
												</h4>
												<p className="text-gray-500">Select your AI model</p>
											</div>
										</div>

										<button
											type="button"
											onClick={() => setShowModelPicker((prev) => !prev)}
											className="w-full rounded-xl border border-gray-300 bg-gray-50 px-5 py-4 flex items-center justify-between text-left"
										>
											<div>
												<p className="text-xl font-semibold text-gray-800">
													{selectedModelOption.label}
												</p>
												<p className="text-gray-500 mt-1">
													{formatCreditLabel(
														selectedModelOption.costPerRequest,
														true,
													)}
												</p>
											</div>
											<ChevronDown
												size={18}
												className={`text-gray-400 transition-transform ${showModelPicker ? 'rotate-180' : ''}`}
											/>
										</button>

										{showModelPicker && (
											<div className="rounded-xl border border-gray-200 overflow-hidden">
												<div className="p-2 border-b border-gray-100 bg-white">
													<div className="relative">
														<Search
															size={18}
															className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
														/>
														<input
															type="text"
															value={modelSearch}
															onChange={(e) => setModelSearch(e.target.value)}
															placeholder="Search models..."
															className="w-full h-12 rounded-lg border border-cyan-400 pl-10 pr-3 text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
														/>
													</div>
												</div>

												{loadingModelPricing ? (
													<div className="py-8 text-center text-gray-400 flex items-center justify-center gap-2">
														<RefreshCw size={16} className="animate-spin" />
														Loading model pricing...
													</div>
												) : (
													<div className="max-h-[420px] overflow-y-auto">
														{groupedFilteredModelOptions.length > 0 ? (
															groupedFilteredModelOptions.map((group) => (
																<div key={group.category}>
																	<div
																		className={`px-4 py-2 text-sm font-semibold uppercase ${
																			group.category === 'NEWEST (BETA)'
																				? 'bg-violet-100 text-violet-600'
																				: 'bg-gray-100 text-gray-500'
																		}`}
																	>
																		{group.category}
																	</div>
																	{group.items.map((option) => {
																		const isSelected =
																			normalizeModelKey(formData.model) ===
																			normalizeModelKey(option.value)
																		return (
																			<button
																				type="button"
																				key={option.value}
																				onClick={() => {
																					setFormData({
																						...formData,
																						model: option.value,
																					})
																					setShowModelPicker(false)
																				}}
																				className={`w-full px-4 py-4 border-t border-gray-100 text-left transition ${
																					isSelected
																						? 'bg-violet-50'
																						: 'bg-white hover:bg-gray-50'
																				}`}
																			>
																				<div className="flex items-center justify-between">
																					<div className="flex items-center gap-2">
																						<span className="text-xl font-semibold text-gray-800">
																							{option.label}
																						</span>
																						{option.isNew && (
																							<span className="px-2 py-0.5 rounded-md bg-violet-100 text-violet-600 text-xs font-semibold">
																								NEW
																							</span>
																						)}
																					</div>
																					{isSelected && (
																						<Check
																							size={18}
																							className="text-violet-500"
																						/>
																					)}
																				</div>
																				<p
																					className={`text-sm mt-1 ${
																						option.category === 'NEWEST (BETA)'
																							? 'text-violet-500'
																							: 'text-gray-500'
																					}`}
																				>
																					{formatCreditLabel(
																						option.costPerRequest,
																					)}
																					{option.description
																						? ` • ${option.description}`
																						: ''}
																				</p>
																			</button>
																		)
																	})}
																</div>
															))
														) : (
															<div className="p-4 text-sm text-gray-400">
																No models found.
															</div>
														)}
													</div>
												)}
											</div>
										)}

										<p className="text-sm italic text-gray-500">
											Note: AI credit usage depends on prompt complexity and
											tools used. The displayed amount is an estimate and may
											vary.
											</p>
												</div>
											)}

											{/* Additional Settings */}
											{false && (
												<div className="bg-white rounded-xl border border-gray-200 p-6">
										<button
											type="button"
											onClick={() => setShowAdditionalSettings((prev) => !prev)}
											className="w-full flex items-center justify-center gap-1 mb-1"
										>
											<h4 className="text-cyan-500 text-sm font-semibold">
												Additional Settings
											</h4>
											<ChevronDown
												size={14}
												className={`text-cyan-500 transition-transform ${
													showAdditionalSettings ? 'rotate-180' : ''
												}`}
											/>
										</button>

										{showAdditionalSettings && (
											<div className="max-w-[760px] mx-auto space-y-4 mt-5">
												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														AI History Limit
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														The number of messages the AI will remember.
													</p>
													<input
														type="number"
														min={10}
														max={50}
														value={formData.history_limit}
														onChange={(e) =>
															setFormData({
																...formData,
																history_limit:
																	parseInt(e.target.value, 10) || 0,
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													/>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														AI Read File Limit
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														The number of recent messages whose file attachments
														the AI will read.
													</p>
													<input
														type="number"
														min={0}
														max={20}
														value={formData.max_file_read_window}
														onChange={(e) =>
															setFormData({
																...formData,
																max_file_read_window:
																	parseInt(e.target.value, 10) || 0,
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													/>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														AI Context Limit
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														AI depth level for reading knowledge sources.
														Increase this if you have more knowledge entries.
													</p>
													<input
														type="number"
														min={5}
														max={100}
														value={formData.context_limit}
														onChange={(e) =>
															setFormData({
																...formData,
																context_limit:
																	parseInt(e.target.value, 10) || 0,
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													/>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														AI Temperature
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														The creativity level of the AI when responding to
														user messages.
													</p>
													<select
														value={
															formData.temperature <= 0.2
																? 'consistent'
																: formData.temperature <= 0.5
																	? 'balanced'
																	: 'creative'
														}
														onChange={(e) => {
															const val =
																e.target.value === 'consistent'
																	? 0.2
																	: e.target.value === 'balanced'
																		? 0.5
																		: 0.8
															setFormData({ ...formData, temperature: val })
														}}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													>
														<option value="consistent">Consistent</option>
														<option value="balanced">Balanced</option>
														<option value="creative">Creative</option>
													</select>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														Message Await
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														Delay time before the AI responds to a user message.
													</p>
													<input
														type="number"
														min={0}
														max={30}
														value={formData.message_await}
														onChange={(e) =>
															setFormData({
																...formData,
																message_await:
																	parseInt(e.target.value, 10) || 0,
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													/>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														AI Message Limit
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														Limit on the number of AI messages per conversation
														session. Resets when the chat is resolved.
													</p>
													<input
														type="number"
														min={0}
														max={100000}
														value={formData.message_limit}
														onChange={(e) =>
															setFormData({
																...formData,
																message_limit:
																	parseInt(e.target.value, 10) || 0,
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													/>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														Watcher
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														Monitors AI responses to ensure important functions
														are executed.
													</p>
													<select
														value={formData.watcher_enabled ? 'on' : 'off'}
														onChange={(e) =>
															setFormData({
																...formData,
																watcher_enabled: e.target.value === 'on',
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													>
														<option value="off">Off</option>
														<option value="on">On</option>
													</select>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														Timezone
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														Select the timezone for the AI.
													</p>
													<select
														value={formData.timezone}
														onChange={(e) =>
															setFormData({
																...formData,
																timezone: e.target.value,
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													>
														{timezoneOptions.map((timezone) => (
															<option
																key={timezone.value}
																value={timezone.value}
															>
																{timezone.label}
															</option>
														))}
													</select>
												</div>

												<div className="text-center">
													<label className="inline-flex items-center justify-center gap-1 text-cyan-500 text-sm font-semibold mb-1">
														Session-Only Memory
														<Info size={13} className="text-gray-400" />
													</label>
													<p className="text-xs text-gray-500 mb-2">
														When enabled, AI will start conversation without
														remembering previous session(s)
													</p>
													<select
														value={formData.session_only_memory ? 'on' : 'off'}
														onChange={(e) =>
															setFormData({
																...formData,
																session_only_memory: e.target.value === 'on',
															})
														}
														className="w-full h-10 px-3 border border-gray-300 rounded-md text-sm focus:ring-2 focus:ring-cyan-500 outline-none"
													>
														<option value="off">Off</option>
														<option value="on">On</option>
													</select>
												</div>

												</div>
											)}
											</div>
										)}

									{/* Save Button */}
									<div className="flex justify-center pt-4">
										<button
											onClick={handleSave}
											disabled={saving}
											className="px-8 py-2.5 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition shadow-sm disabled:opacity-50 flex items-center gap-2"
										>
											{saving ? (
												<>
													<RefreshCw className="animate-spin" size={18} />
													Saving...
												</>
											) : (
												<>
													<Save size={18} />
													Save AI Settings
												</>
											)}
										</button>
									</div>
								</>
							)}

							{activeTab === 'knowledge' && (
								<div className="flex gap-6">
									{/* Main Content Area */}
									<div className="flex-1 space-y-4">
											{/* Sub-tabs Navigation */}
											<div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
												<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
													<div>
														<h3 className="font-semibold text-blue-950">
															Text, Website, dan File knowledge dikelola di Knowledge Base
														</h3>
														<p className="mt-1 text-sm text-blue-700">
															Gunakan halaman global Knowledge Base untuk membuat,
															mengupload, dan menguji source RAG.
														</p>
													</div>
													<a
														href="/knowledge"
														className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white transition hover:bg-blue-700"
													>
														<Book size={16} />
														Open Knowledge Base
													</a>
													</div>
												</div>

											<div className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
												<div className="flex items-center gap-1 p-2 border-b border-gray-100">
													{[
														{ id: 'qna', label: 'Q&A', icon: MessageSquare },
														{ id: 'product', label: 'Product', icon: Tag },
													].map((t) => (
														<button
															key={t.id}
															onClick={() =>
																setKnowledgeTab(t.id as 'qna' | 'product')
															}
															className={`flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-lg transition ${
																knowledgeTab === t.id
																	? 'bg-blue-50 text-blue-600'
																: 'text-gray-500 hover:bg-gray-50'
														}`}
													>
														<t.icon size={16} />
														{t.label}
													</button>
												))}
											</div>
										</div>

											{/* Q&A Tab Content */}
										{knowledgeTab === 'qna' && (
											<div className="p-6 min-h-[500px]">
												<div className="flex items-center justify-between mb-6">
													<div>
														<h3 className="text-lg font-semibold text-gray-900">
															Q&A / Evaluations
														</h3>
														<p className="text-sm text-gray-500">
															{qnaItems.length} items
														</p>
													</div>
													<button
														onClick={() => setShowAddQnAModal(true)}
														className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm font-medium"
													>
														Add New Q&A
													</button>
												</div>

												{qnaItems.length === 0 ? (
													<div className="py-20 text-center">
														<div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
															<MessageSquare
																className="text-gray-300"
																size={32}
															/>
														</div>
														<p className="text-gray-500 font-medium">
															No Q&A pairs added yet
														</p>
														<p className="text-sm text-gray-400 mt-1">
															Add question and answer pairs for quick AI
															responses
														</p>
													</div>
												) : (
													<div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
													{qnaItems.map((item) => (
															<div
																key={item.id}
																className="p-4 bg-gray-50 rounded-xl border border-gray-100 hover:border-blue-200 transition group"
															>
																<div className="flex justify-between items-start mb-2">
																	<div className="flex-1 min-w-0">
																		<div className="flex items-center gap-2 mb-1">
																			<span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-600 rounded font-medium">
																				{item.type === 'evaluation'
																					? 'Evaluation'
																					: 'Q&A'}
																			</span>
																			{item.created_at && (
																				<span className="text-xs text-gray-400">
																					{new Date(
																						item.created_at,
																					).toLocaleDateString()}
																				</span>
																			)}
																		</div>
																		<h4 className="font-semibold text-gray-900 text-sm leading-relaxed">
																			<span className="text-blue-600">Q:</span>{' '}
																			{item.question.substring(0, 200)}
																			{item.question.length > 200 ? '...' : ''}
																		</h4>
																	</div>
																	<button
																		onClick={() => handleDeleteSource(item.id)}
																		className="p-1.5 text-gray-400 hover:text-red-500 transition opacity-0 group-hover:opacity-100 flex-shrink-0 ml-2"
																	>
																		<Trash2 size={14} />
																	</button>
																</div>
																<div className="mt-2 bg-white rounded-lg p-3 border border-gray-100">
																	<p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">
																		<span className="text-green-600 font-medium">
																			A:
																		</span>{' '}
																		{item.answer.substring(0, 300)}
																		{item.answer.length > 300 ? '...' : ''}
																	</p>
																</div>
															</div>
														))}
													</div>
												)}
											</div>
										)}

										{/* Product Tab Content */}
										{knowledgeTab === 'product' && (
											<div className="p-6 min-h-[500px]">
												<div className="flex items-center justify-between mb-6">
													<h3 className="text-lg font-semibold text-gray-900">
														Product
													</h3>
													<button className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition text-sm font-medium">
														Add Product
													</button>
												</div>

												{productItems.length === 0 ? (
													<div className="py-20 text-center">
														<div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
															<Tag className="text-gray-300" size={32} />
														</div>
														<p className="text-gray-500 font-medium">
															No products added yet
														</p>
														<p className="text-sm text-gray-400 mt-1">
															Add product information for the AI to reference
														</p>
													</div>
												) : (
													<div className="grid grid-cols-2 gap-4">
														{productItems.map((product) => (
															<div
																key={product.id}
																className="p-4 bg-gray-50 rounded-xl border border-gray-100"
															>
																<h4 className="font-semibold text-gray-900">
																	{product.name}
																</h4>
																<p className="text-sm text-gray-500 mt-1">
																	{product.description}
																</p>
															</div>
														))}
													</div>
												)}
											</div>
										)}
									</div>
								</div>
							)}

								{activeTab === 'integrations' && (
									<div className="space-y-6">
										<div className="bg-white rounded-xl border border-gray-200 p-5">
											<div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
												<div>
													<h3 className="text-2xl font-bold text-gray-900">
														AI Tools
													</h3>
													<p className="text-sm text-gray-500 mt-1">
														Enable AI tools to enhance your chatbot&apos;s
														capabilities with additional functionalities.
													</p>
												</div>
												<a
													href="/developers/api-tools"
													className="inline-flex h-9 items-center gap-2 rounded-lg border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50"
												>
													<Settings size={16} />
													Open AI Tools Settings
												</a>
											</div>

								<div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-3">
												{loadingAiTools && (
													<div className="xl:col-span-3 rounded-xl border border-gray-200 bg-white p-6 text-center">
														<p className="text-sm text-gray-500">
															Loading AI tools from DB...
														</p>
													</div>
												)}

												{!loadingAiTools && aiToolCards.length === 0 && (
													<div className="xl:col-span-3 rounded-xl border border-dashed border-gray-300 bg-gray-50 p-6 text-center">
														<p className="text-sm font-medium text-gray-700">
															No AI tools found in DB.
														</p>
														<p className="text-xs text-gray-500 mt-1">
															Configure tools first, then they will appear here.
														</p>
													</div>
												)}

												{aiToolCards.map((tool) => (
													<div
														key={tool.id}
														className={`rounded-xl border p-4 ${
															tool.is_active
																? 'border-emerald-300 bg-emerald-50/40'
																: 'border-gray-200 bg-gray-50/40'
														}`}
													>
														<p
															className={`text-xs font-semibold ${
																tool.is_active
																	? 'text-emerald-700'
																	: 'text-gray-500'
															}`}
														>
															{tool.is_active ? 'Active' : 'Inactive'}
														</p>
														<h4 className="mt-1 text-2xl font-semibold text-gray-900 leading-tight">
															{tool.name}
														</h4>
														<p className="mt-2 text-sm text-gray-600 min-h-[64px]">
															{tool.description ||
																'No description available for this tool.'}
														</p>

														<div className="mt-4 flex items-center gap-2">
															<a
																href="/developers/api-tools"
																className="inline-flex h-9 items-center rounded-md border border-gray-200 px-3 text-sm font-medium text-gray-700 hover:bg-white"
															>
																Settings
															</a>
															<button
																onClick={() => handleToggleAiTool(tool.id)}
																disabled={updatingAiToolId === tool.id}
																className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-medium transition ${
																	tool.is_active
																		? 'bg-emerald-500 text-white hover:bg-emerald-600'
																		: 'border border-gray-200 bg-white text-gray-700 hover:bg-gray-100'
																} ${updatingAiToolId === tool.id ? 'cursor-not-allowed opacity-60' : ''}`}
															>
																{updatingAiToolId === tool.id
																	? 'Saving...'
																	: tool.is_active
																		? 'Active'
																		: 'Activate'}
															</button>
														</div>
													</div>
												))}

												<a
													href="/developers/api-tools/new"
													className="rounded-xl border border-dashed border-gray-300 bg-slate-50/70 p-4 min-h-[220px] flex flex-col items-center justify-center text-gray-700 hover:bg-slate-100/70 transition"
												>
													<Plus size={32} className="mb-3" />
													<span className="text-xl font-semibold">
														Create AI Tool
													</span>
												</a>
											</div>
										</div>

										<div className="bg-blue-50 border border-blue-100 rounded-xl p-4 flex gap-4">
											<div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center shrink-0">
												<Info className="text-blue-600" size={20} />
										</div>
										<div>
											<h4 className="text-sm font-bold text-blue-900">
												Agent Integrations
											</h4>
											<p className="text-sm text-blue-700 mt-0.5">
												Select the chat inboxes that this AI agent should
												handle. Once linked, the agent will monitor incoming
												messages and interact based on your configuration.
											</p>
										</div>
									</div>

									<div className="grid grid-cols-1 gap-3">
										{loadingInboxes ? (
											<div className="py-20 text-center">
												<RefreshCw
													className="animate-spin mx-auto text-gray-300 mb-2"
													size={32}
												/>
												<p className="text-gray-400">Loading inboxes...</p>
											</div>
										) : inboxes.length === 0 ? (
											<div className="py-20 text-center bg-white rounded-xl border border-dashed border-gray-200">
												<MessageSquare
													className="mx-auto text-gray-200 mb-2"
													size={48}
												/>
												<p className="text-gray-500 font-medium">
													No inboxes found
												</p>
												<p className="text-sm text-gray-400">
													Create an inbox first to link it to an agent.
												</p>
											</div>
										) : (
											inboxes.map((inbox) => (
												<div
													key={inbox.id}
													className="bg-white rounded-xl border border-gray-200 p-4 flex items-center justify-between hover:border-blue-300 transition group"
												>
													<div className="flex items-center gap-4">
														<div
															className={`w-12 h-12 rounded-xl flex items-center justify-center ${
																inbox.channel_type === 'whatsapp'
																	? 'bg-green-50 text-green-600'
																	: inbox.channel_type === 'instagram'
																		? 'bg-pink-50 text-pink-600'
																		: 'bg-blue-50 text-blue-600'
															}`}
														>
															{inbox.channel_type === 'whatsapp' && (
																<MessageSquare size={24} />
															)}
															{inbox.channel_type === 'instagram' && (
																<MessageSquare size={24} />
															)}
															{inbox.channel_type === 'web' && (
																<Globe size={24} />
															)}
														</div>
														<div>
															<h4 className="font-bold text-gray-900">
																{inbox.name}
															</h4>
															<div className="flex items-center gap-2 mt-0.5">
																<span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">
																	{inbox.channel_type}
																</span>
																{inbox.chatbot_id &&
																	inbox.chatbot_id !== agentId && (
																		<span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-amber-50 text-amber-600 flex items-center gap-1">
																			<Bot size={10} />
																			Linked to other agent
																		</span>
																	)}
																{inbox.chatbot_id === agentId && (
																	<span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-green-50 text-green-600 flex items-center gap-1">
																		<Bot size={10} />
																		Active
																	</span>
																)}
															</div>
														</div>
													</div>
													<div className="flex items-center gap-4">
														<button
															onClick={() =>
																handleToggleInbox(inbox.id, inbox.chatbot_id)
															}
															className={`px-4 py-2 rounded-lg font-medium text-sm transition ${
																inbox.chatbot_id === agentId
																	? 'bg-red-50 text-red-600 hover:bg-red-100'
																	: 'bg-blue-50 text-blue-600 hover:bg-blue-100'
															}`}
														>
															{inbox.chatbot_id === agentId
																? 'Unlink Agent'
																: 'Link Agent'}
														</button>
													</div>
												</div>
											))
										)}
									</div>
								</div>
							)}

							{activeTab === 'evaluation' && (
								<div className="space-y-6">
									<div className="flex items-center justify-between mb-2">
										<div>
											<h3 className="text-2xl font-bold text-gray-900">
												Evaluation History
											</h3>
											<p className="text-sm text-gray-500 mt-1">
												Review how your AI Agent responded to real customer
												interactions.
											</p>
										</div>
										<button
											onClick={fetchEvaluations}
											className="p-3 bg-white border border-gray-200 rounded-2xl text-gray-600 hover:text-gray-900 transition flex items-center gap-2 text-sm font-bold shadow-sm"
										>
											<RefreshCw
												size={18}
												className={loadingEvaluations ? 'animate-spin' : ''}
											/>
											Refresh Report
										</button>
									</div>

									{loadingEvaluations ? (
										<div className="py-32 flex flex-col items-center justify-center">
											<Bot
												className="animate-bounce text-blue-500 mb-4"
												size={64}
											/>
											<p className="text-gray-500 font-medium">
												Gathering evaluation data...
											</p>
										</div>
									) : evaluations.length === 0 ? (
										<div className="bg-white rounded-3xl border border-gray-100 p-20 text-center shadow-sm">
											<div className="w-24 h-24 bg-blue-50 rounded-full flex items-center justify-center mx-auto mb-6">
												<BarChart3 className="text-blue-200" size={48} />
											</div>
											<h4 className="text-xl font-bold text-gray-900">
												No Evaluations Found
											</h4>
											<p className="text-gray-500 mt-2 max-w-sm mx-auto">
												Evaluation reports will be generated automatically as
												your AI interacts with customers across connected
												channels.
											</p>
										</div>
									) : (
										<div className="space-y-6">
											{evaluations.map((eval_) => (
												<div
													key={eval_.id}
													className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm hover:shadow-xl transition-all duration-300 border-l-4 border-l-blue-500"
												>
													<div className="px-8 py-5 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
														<div className="flex items-center gap-4">
															<div className="p-2.5 bg-blue-100 rounded-2xl text-blue-600">
																<BarChart3 size={24} />
															</div>
															<div>
																<div className="flex items-center gap-2">
																	<span className="text-[10px] font-black uppercase tracking-[0.1em] text-blue-600 bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
																		{eval_.type}
																	</span>
																	<span className="flex items-center gap-1 text-xs text-gray-400 font-medium ml-2">
																		<Clock size={12} />
																		{new Date(eval_.created_at).toLocaleString(
																			'en-GB',
																			{
																				day: '2-digit',
																				month: 'short',
																				hour: '2-digit',
																				minute: '2-digit',
																			},
																		)}
																	</span>
																</div>
																<h4 className="font-bold text-gray-900 mt-1">
																	Transaction ID: {eval_.id.substring(0, 8)}
																</h4>
															</div>
														</div>
														<div className="flex items-center gap-2">
															<button
																onClick={() => {
																	setSelectedEval(eval_)
																	setShowEvalModal(true)
																}}
																className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-bold rounded-xl hover:bg-gray-50 transition shadow-sm flex items-center gap-2"
															>
																<Eye size={14} />
																View Context
															</button>
															<button
																onClick={() => handleDeleteEvaluation(eval_.id)}
																className="p-2 bg-white border border-gray-200 text-red-400 hover:text-red-600 rounded-xl hover:bg-red-50 transition shadow-sm"
															>
																<Trash2 size={16} />
															</button>
														</div>
													</div>
													<div className="p-8 space-y-6 bg-gradient-to-b from-transparent to-gray-50/30">
														{eval_.ai_evaluation_messages?.map(
															(msg: any, i: number) => (
																<div
																	key={msg.id || i}
																	className={`flex flex-col ${msg.role === 'ai' ? 'items-start' : 'items-end'}`}
																>
																	<div className="flex items-center gap-2 mb-2 px-1">
																		{msg.role === 'ai' ? (
																			<>
																				<Bot
																					size={14}
																					className="text-blue-500"
																				/>
																				<span className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">
																					Lyra AI
																				</span>
																			</>
																		) : (
																			<>
																				<span className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">
																					{msg.conversation?.contact
																						?.display_name || 'Customer'}
																				</span>
																				<div className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
																			</>
																		)}
																	</div>
																	<div
																		className={`max-w-[85%] rounded-[1.5rem] px-6 py-4 text-sm shadow-sm ${
																			msg.role === 'ai'
																				? 'bg-blue-600 text-white rounded-tl-none font-medium'
																				: 'bg-white text-gray-800 rounded-tr-none border border-gray-100'
																		}`}
																	>
																		<div className="whitespace-pre-wrap leading-relaxed">
																			{msg.message}
																		</div>
																		{msg.conversation?.contact &&
																			msg.role === 'user' && (
																				<div className="mt-3 pt-2 border-t border-gray-100 flex items-center justify-between gap-4">
																					<span className="text-[10px] font-bold opacity-60">
																						via{' '}
																						{msg.conversation.phone_number ||
																							'Omnichannel'}
																					</span>
																					<span className="text-[10px] opacity-40 font-mono">
																						{new Date(
																							msg.msg_created_at ||
																								msg.created_at,
																						).toLocaleTimeString()}
																					</span>
																				</div>
																			)}
																	</div>
																</div>
															),
														)}
													</div>
												</div>
											))}

											{/* Pagination */}
											{evaluationPagination &&
												evaluationPagination.total_pages > 1 && (
													<div className="flex items-center justify-center gap-2 pt-6">
														<button
															disabled={evaluationPage === 1}
															onClick={() =>
																setEvaluationPage((prev) => prev - 1)
															}
															className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-600 disabled:opacity-50 hover:bg-gray-50"
														>
															Previous
														</button>
														<span className="text-sm font-bold text-gray-500 px-4">
															Page {evaluationPage} of{' '}
															{evaluationPagination.total_pages}
														</span>
														<button
															disabled={
																evaluationPage ===
																evaluationPagination.total_pages
															}
															onClick={() =>
																setEvaluationPage((prev) => prev + 1)
															}
															className="px-4 py-2 rounded-xl bg-white border border-gray-200 text-sm font-bold text-gray-600 disabled:opacity-50 hover:bg-gray-50"
														>
															Next
														</button>
													</div>
												)}
										</div>
									)}
								</div>
							)}

							{activeTab === 'followups' && (
								<div className="space-y-6">
									<div>
										<h3 className="text-2xl font-bold text-gray-900">
											AI Follow-up Rules
										</h3>
										<p className="text-sm text-gray-500 mt-1">
											Automated messages sent to re-engage customers after
											periods of inactivity.
										</p>
									</div>

									{formData.ai_followups.length === 0 ? (
										<div className="bg-white rounded-3xl border border-gray-100 p-20 text-center shadow-sm">
											<div className="w-20 h-20 bg-gray-50 rounded-2xl flex items-center justify-center mx-auto mb-6">
												<Clock className="text-gray-300" size={40} />
											</div>
											<h4 className="text-lg font-bold text-gray-900">
												No Follow-up Rules
											</h4>
											<p className="text-gray-500 mt-2 max-w-sm mx-auto">
												Add rules to automatically nudge customers who haven't
												replied within a specific timeframe.
											</p>
										</div>
									) : (
										<div className="space-y-4">
											{formData.ai_followups.map((rule: any, index: number) => (
												<div
													key={rule.id || index}
													className="bg-white rounded-3xl border border-gray-100 p-6 shadow-sm hover:shadow-md transition-shadow"
												>
													<div className="flex items-start justify-between gap-6">
														<div className="flex-1 space-y-4">
															<div>
																<label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">
																	Follow-up Message / Logic
																</label>
																<textarea
																	value={rule.prompt}
																	onChange={(e) => {
																		const newFollowups = [
																			...formData.ai_followups,
																		]
																		newFollowups[index].prompt = e.target.value
																		setFormData({
																			...formData,
																			ai_followups: newFollowups,
																		})
																	}}
																	rows={4}
																	className="w-full px-4 py-3 bg-gray-50 border border-gray-100 rounded-2xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
																	placeholder="e.g. Halo Kak! Apakah masih ada yang buat Kakak bingung..."
																/>
															</div>
															<div className="grid grid-cols-2 gap-4">
																<div>
																	<label className="block text-xs font-black uppercase tracking-wider text-gray-400 mb-2">
																		Wait Time (minutes)
																	</label>
																	<input
																		type="number"
																		value={rule.time_interval}
																		onChange={(e) => {
																			const newFollowups = [
																				...formData.ai_followups,
																			]
																			newFollowups[index].time_interval =
																				parseInt(e.target.value)
																			setFormData({
																				...formData,
																				ai_followups: newFollowups,
																			})
																		}}
																		className="w-full px-4 py-2 bg-gray-50 border border-gray-100 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
																	/>
																</div>
																<div className="flex items-center gap-3 pt-6">
																	<button
																		onClick={() => {
																			const newFollowups = [
																				...formData.ai_followups,
																			]
																			newFollowups[index].is_in_bot_reply =
																				!newFollowups[index].is_in_bot_reply
																			setFormData({
																				...formData,
																				ai_followups: newFollowups,
																			})
																		}}
																		className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${rule.is_in_bot_reply ? 'bg-emerald-500' : 'bg-gray-200'}`}
																	>
																		<span
																			className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${rule.is_in_bot_reply ? 'translate-x-6' : 'translate-x-1'}`}
																		/>
																	</button>
																	<span className="text-xs font-bold text-gray-600">
																		Active
																	</span>
																</div>
															</div>
															<div className="flex gap-4 pt-2">
																<label className="flex items-center gap-2 cursor-pointer">
																	<input
																		type="checkbox"
																		checked={rule.options?.handoff}
																		onChange={(e) => {
																			const newFollowups = [
																				...formData.ai_followups,
																			]
																			newFollowups[index].options = {
																				...newFollowups[index].options,
																				handoff: e.target.checked,
																			}
																			setFormData({
																				...formData,
																				ai_followups: newFollowups,
																			})
																		}}
																		className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
																	/>
																	<span className="text-xs text-gray-500 font-medium">
																		Auto-handoff after send
																	</span>
																</label>
																<label className="flex items-center gap-2 cursor-pointer">
																	<input
																		type="checkbox"
																		checked={rule.options?.send_exact}
																		onChange={(e) => {
																			const newFollowups = [
																				...formData.ai_followups,
																			]
																			newFollowups[index].options = {
																				...newFollowups[index].options,
																				send_exact: e.target.checked,
																			}
																			setFormData({
																				...formData,
																				ai_followups: newFollowups,
																			})
																		}}
																		className="rounded border-gray-300 text-blue-500 focus:ring-blue-500"
																	/>
																	<span className="text-xs text-gray-500 font-medium">
																		Send exact prompt (no AI modification)
																	</span>
																</label>
															</div>
														</div>
														<button
															onClick={() => {
																const newFollowups =
																	formData.ai_followups.filter(
																		(_: any, i: number) => i !== index,
																	)
																setFormData({
																	...formData,
																	ai_followups: newFollowups,
																})
															}}
															className="p-2 text-gray-300 hover:text-red-500 transition"
														>
															<Trash2 size={20} />
														</button>
													</div>
												</div>
											))}
										</div>
									)}

									<div className="flex items-center justify-between gap-3 pt-6">
										<button
											onClick={handleAddFollowupRule}
											disabled={savingFollowups}
											className="px-5 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition shadow-lg disabled:opacity-50 flex items-center gap-2"
										>
											<Plus size={20} />
											Add Rule
										</button>

										<button
											onClick={handleSaveFollowups}
											disabled={savingFollowups}
											className="px-8 py-3 bg-green-600 text-white font-bold rounded-2xl hover:bg-green-700 transition shadow-lg disabled:opacity-50 flex items-center gap-2"
										>
											{savingFollowups ? (
												<>
													<RefreshCw className="animate-spin" size={20} />
													Saving Follow Up...
												</>
											) : (
												<>
													<Save size={20} />
													Save Follow Up
												</>
											)}
										</button>
									</div>
								</div>
							)}

							{activeTab === 'advanced' && (
								<div className="space-y-6">
									<div className="bg-blue-50 border border-blue-100 rounded-2xl p-6 flex gap-4">
										<div className="w-12 h-12 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
											<Globe className="text-blue-600" size={24} />
										</div>
										<div>
											<h4 className="text-lg font-bold text-blue-900">
												Branch Locations (Geofencing)
											</h4>
											<p className="text-sm text-blue-700 mt-1">
												Configure clinic branch coordinates if your agent needs
												to suggest the nearest location to customers.
											</p>
										</div>
									</div>

									<div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
										<div className="px-8 py-4 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
											<h4 className="font-bold text-gray-900">
												Origins / Branches
											</h4>
											<button
												onClick={() => {
													const currentOrigins =
														formData.app_data?.nearest_location?.origins || []
													setFormData({
														...formData,
														app_data: {
															...formData.app_data,
															nearest_location: {
																...formData.app_data?.nearest_location,
																origins: [
																	...currentOrigins,
																	{ address: '', latitude: 0, longitude: 0 },
																],
															},
														},
													})
												}}
												className="text-sm font-bold text-blue-600 hover:text-blue-700 transition flex items-center gap-1"
											>
												<Plus size={16} />
												Add Location
											</button>
										</div>
										<div className="p-8">
											<div className="space-y-4">
												{(formData.app_data?.nearest_location?.origins || [])
													.length === 0 ? (
													<div className="text-center py-10 py-10 opacity-40">
														No locations configured.
													</div>
												) : (
													(
														formData.app_data?.nearest_location?.origins || []
													).map((loc: any, idx: number) => (
														<div
															key={idx}
															className="grid grid-cols-12 gap-3 items-end bg-gray-50/50 p-4 rounded-2xl border border-gray-100"
														>
															<div className="col-span-6">
																<label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">
																	Branch Name / Address
																</label>
																<input
																	type="text"
																	value={loc.address}
																	onChange={(e) => {
																		const newOrigins = [
																			...formData.app_data.nearest_location
																				.origins,
																		]
																		newOrigins[idx].address = e.target.value
																		setFormData({
																			...formData,
																			app_data: {
																				...formData.app_data,
																				nearest_location: {
																					...formData.app_data.nearest_location,
																					origins: newOrigins,
																				},
																			},
																		})
																	}}
																	className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
																	placeholder="SOZO Skin Clinic Jakarta..."
																/>
															</div>
															<div className="col-span-2">
																<label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">
																	Lat
																</label>
																<input
																	type="number"
																	step="any"
																	value={loc.latitude}
																	onChange={(e) => {
																		const newOrigins = [
																			...formData.app_data.nearest_location
																				.origins,
																		]
																		newOrigins[idx].latitude = parseFloat(
																			e.target.value,
																		)
																		setFormData({
																			...formData,
																			app_data: {
																				...formData.app_data,
																				nearest_location: {
																					...formData.app_data.nearest_location,
																					origins: newOrigins,
																				},
																			},
																		})
																	}}
																	className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
																/>
															</div>
															<div className="col-span-2">
																<label className="block text-[10px] font-black uppercase text-gray-400 mb-1 ml-1">
																	Long
																</label>
																<input
																	type="number"
																	step="any"
																	value={loc.longitude}
																	onChange={(e) => {
																		const newOrigins = [
																			...formData.app_data.nearest_location
																				.origins,
																		]
																		newOrigins[idx].longitude = parseFloat(
																			e.target.value,
																		)
																		setFormData({
																			...formData,
																			app_data: {
																				...formData.app_data,
																				nearest_location: {
																					...formData.app_data.nearest_location,
																					origins: newOrigins,
																				},
																			},
																		})
																	}}
																	className="w-full px-4 py-2 bg-white border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none"
																/>
															</div>
															<div className="col-span-1 flex justify-center pb-2">
																<button
																	onClick={() => {
																		const newOrigins =
																			formData.app_data.nearest_location.origins.filter(
																				(_: any, i: number) => i !== idx,
																			)
																		setFormData({
																			...formData,
																			app_data: {
																				...formData.app_data,
																				nearest_location: {
																					...formData.app_data.nearest_location,
																					origins: newOrigins,
																				},
																			},
																		})
																	}}
																	className="p-2 text-gray-400 hover:text-red-500 transition"
																>
																	<Trash2 size={18} />
																</button>
															</div>
														</div>
													))
												)}
											</div>
										</div>
									</div>

									<div className="flex justify-center">
										<button
											onClick={handleSave}
											disabled={saving}
											className="px-8 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition shadow-lg disabled:opacity-50 flex items-center gap-2"
										>
											{saving ? (
												<RefreshCw className="animate-spin" size={20} />
											) : (
												<Save size={20} />
											)}
											Save Advanced Settings
										</button>
									</div>
								</div>
							)}

							{activeTab === 'orchestration' && (
								<div className="space-y-6">
									{/* Agent Capabilities */}
									<div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
										<div className="px-8 py-4 border-b border-gray-50 bg-gray-50/50 flex items-center justify-between">
											<h4 className="font-bold text-gray-900">
												Agent Capabilities
											</h4>
											<p className="text-sm text-gray-500">
												Define what this agent specializes in
											</p>
										</div>
										<div className="p-8 space-y-4">
											<div>
												<label className="block text-sm font-medium text-gray-700 mb-3">
													Specializations
												</label>
												<div className="grid grid-cols-3 gap-3">
													{[
														'sales',
														'support',
														'billing',
														'technical',
														'general',
													].map((cap) => (
														<label
															key={cap}
															className="flex items-center gap-2 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 transition"
														>
															<input
																type="checkbox"
																checked={(
																	formData.app_data?.capabilities || []
																).includes(cap)}
																onChange={(e) => {
																	const capabilities =
																		formData.app_data?.capabilities || []
																	if (e.target.checked) {
																		setFormData({
																			...formData,
																			app_data: {
																				...formData.app_data,
																				capabilities: [...capabilities, cap],
																			},
																		})
																	} else {
																		setFormData({
																			...formData,
																			app_data: {
																				...formData.app_data,
																				capabilities: capabilities.filter(
																					(c: string) => c !== cap,
																				),
																			},
																		})
																	}
																}}
																className="rounded"
															/>
															<span className="text-sm capitalize text-gray-700">
																{cap}
															</span>
														</label>
													))}
												</div>
											</div>

											<div className="grid grid-cols-2 gap-4">
												<div>
													<label className="block text-sm font-medium text-gray-700 mb-2">
														Max Concurrent Conversations
													</label>
													<input
														type="number"
														min="1"
														max="100"
														value={formData.app_data?.max_concurrent || 10}
														onChange={(e) =>
															setFormData({
																...formData,
																app_data: {
																	...formData.app_data,
																	max_concurrent:
																		parseInt(e.target.value) || 10,
																},
															})
														}
														className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
													/>
													<p className="text-xs text-gray-500 mt-1">
														Maximum conversations this agent can handle
													</p>
												</div>
												<div>
													<label className="block text-sm font-medium text-gray-700 mb-2">
														Priority (1-10)
													</label>
													<input
														type="number"
														min="1"
														max="10"
														value={formData.app_data?.priority || 5}
														onChange={(e) =>
															setFormData({
																...formData,
																app_data: {
																	...formData.app_data,
																	priority: parseInt(e.target.value) || 5,
																},
															})
														}
														className="w-full px-4 py-2 border border-gray-200 rounded-xl focus:ring-2 focus:ring-blue-500 outline-none"
													/>
													<p className="text-xs text-gray-500 mt-1">
														Higher = more priority in routing
													</p>
												</div>
											</div>
										</div>
									</div>

									{/* Language Support */}
									<div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
										<div className="px-8 py-4 border-b border-gray-50 bg-gray-50/50">
											<h4 className="font-bold text-gray-900">
												Language Support
											</h4>
											<p className="text-sm text-gray-500 mt-1">
												Languages this agent can communicate in
											</p>
										</div>
										<div className="p-8">
											<div className="grid grid-cols-4 gap-3">
												{[
													{ code: 'en', name: 'English' },
													{ code: 'id', name: 'Indonesian' },
													{ code: 'zh', name: 'Chinese' },
													{ code: 'es', name: 'Spanish' },
													{ code: 'fr', name: 'French' },
													{ code: 'ar', name: 'Arabic' },
													{ code: 'ja', name: 'Japanese' },
													{ code: 'ko', name: 'Korean' },
												].map((lang) => (
													<label
														key={lang.code}
														className="flex items-center gap-2 p-3 border rounded-xl cursor-pointer hover:bg-gray-50 transition"
													>
														<input
															type="checkbox"
															checked={(
																formData.app_data?.languages || []
															).includes(lang.code)}
															onChange={(e) => {
																const languages = formData.app_data
																	?.languages || ['en']
																if (e.target.checked) {
																	setFormData({
																		...formData,
																		app_data: {
																			...formData.app_data,
																			languages: [...languages, lang.code],
																		},
																	})
																} else {
																	setFormData({
																		...formData,
																		app_data: {
																			...formData.app_data,
																			languages: languages.filter(
																				(l: string) => l !== lang.code,
																			),
																		},
																	})
																}
															}}
															className="rounded"
														/>
														<span className="text-sm">{lang.name}</span>
													</label>
												))}
											</div>
										</div>
									</div>

									{/* Handoff Rules */}
									<div className="bg-white rounded-3xl border border-gray-100 overflow-hidden shadow-sm">
										<div className="px-8 py-4 border-b border-gray-50 bg-gray-50/50">
											<h4 className="font-bold text-gray-900">Handoff Rules</h4>
											<p className="text-sm text-gray-500 mt-1">
												Configure when this agent should hand off to another
												agent
											</p>
										</div>
										<div className="p-8 space-y-4">
											<div>
												<label className="block text-sm font-medium text-gray-700 mb-2">
													Handoff Triggers
												</label>
												<textarea
													value={formData.agent_transfer || ''}
													onChange={(e) =>
														setFormData({
															...formData,
															agent_transfer: e.target.value,
														})
													}
													rows={4}
													className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
													placeholder="Specify conditions for handoff (e.g., 'If customer is angry', 'If technical issue detected')"
												/>
												<p className="text-xs text-gray-500 mt-1">
													Describe when conversations should be reassigned to
													another agent
												</p>
											</div>
										</div>
									</div>

									<div className="flex justify-center">
										<button
											onClick={handleSave}
											disabled={saving}
											className="px-8 py-3 bg-blue-600 text-white font-bold rounded-2xl hover:bg-blue-700 transition shadow-lg disabled:opacity-50 flex items-center gap-2"
										>
											{saving ? (
												<RefreshCw className="animate-spin" size={20} />
											) : (
												<Save size={20} />
											)}
											Save Orchestration Settings
										</button>
									</div>
								</div>
							)}
							</div>

							{/* Chat Preview Panel - Only visible on General tab */}
							{false && activeTab === 'general' && (
							<div className="w-80 shrink-0">
								<div className="bg-white rounded-xl border border-gray-200 h-[600px] flex flex-col sticky top-6">
									{/* Chat Header */}
									<div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
										<div className="flex items-center gap-3">
											<div className="w-8 h-8 bg-blue-100 rounded-full flex items-center justify-center">
												<Bot className="text-blue-600" size={16} />
											</div>
											<span className="text-sm font-medium text-gray-900 truncate max-w-[180px]">
												{formData.name || 'AI Agent'}
											</span>
										</div>
										<div className="flex items-center gap-1">
											<button
												onClick={handleSaveAsEvaluation}
												disabled={
													savingEvaluation || previewMessages.length === 0
												}
												className="p-1.5 text-gray-400 hover:text-blue-600 transition disabled:opacity-30"
												title="Save as Evaluation"
											>
												{savingEvaluation ? (
													<RefreshCw className="animate-spin" size={16} />
												) : (
													<FileText size={16} />
												)}
											</button>
											<button
												onClick={() => {
													setPreviewMessages([])
													setCopiedPreviewMessageId(null)
												}}
												className="p-1.5 text-gray-400 hover:text-gray-600 transition"
												title="Reset Chat"
											>
												<RefreshCw size={16} />
											</button>
										</div>
									</div>

									{/* Chat Messages Area */}
									<div
										className="flex-1 p-4 overflow-y-auto bg-gray-100/70"
										ref={scrollRef}
									>
										{previewMessages.length === 0 ? (
											<div className="h-full flex items-center justify-center text-center">
												<div>
													<Bot
														className="mx-auto text-gray-200 mb-2"
														size={40}
													/>
													<p className="text-xs text-gray-400">
														Chat preview will appear here
													</p>
												</div>
											</div>
										) : (
											<div className="space-y-3">
												{previewMessages.map((msg) => {
													if (msg.role === 'system') {
														return (
															<div
																key={msg.id}
																className="flex justify-center"
															>
																<div className="max-w-[86%] rounded-full bg-gray-200 px-3 py-1.5 text-center text-xs text-gray-600">
																	{msg.content}
																</div>
															</div>
														)
													}

													if (msg.role === 'user') {
														return (
															<div
																key={msg.id}
																className="flex justify-end"
															>
																<div className="max-w-[85%] rounded-2xl rounded-tr-none bg-blue-500 px-3 py-2 text-sm text-white">
																	{msg.content}
																</div>
															</div>
														)
													}

													if (msg.kind === 'image') {
														return (
															<div
																key={msg.id}
																className="flex justify-start"
															>
																<div className="max-w-[86%] rounded-2xl rounded-tl-none bg-white p-2 shadow-sm">
																	<img
																		src={msg.url}
																		alt={msg.alt || 'Image'}
																		className="max-h-[220px] w-full rounded-xl object-cover"
																		onError={(event) => {
																			const target =
																				event.target as HTMLImageElement
																			target.style.display = 'none'
																		}}
																	/>
																</div>
															</div>
														)
													}

													return (
														<div
															key={msg.id}
															className="flex items-start justify-start gap-2"
														>
															<div className="max-w-[85%] rounded-2xl rounded-tl-none bg-white px-3 py-2 text-sm text-gray-800 shadow-sm">
																<p className="whitespace-pre-wrap">
																	{msg.content}
																</p>
																{typeof msg.creditsUsed === 'number' && (
																	<p className="mt-1 text-[11px] text-gray-400">
																		AI credits used: {msg.creditsUsed}
																	</p>
																)}
															</div>
															<button
																type="button"
																onClick={() =>
																	handleCopyPreviewMessage(msg)
																}
																className="mt-1 rounded-full p-1.5 text-gray-400 transition hover:bg-gray-200 hover:text-gray-600"
																title="Copy message"
															>
																{copiedPreviewMessageId === msg.id ? (
																	<Check size={14} />
																) : (
																	<Copy size={14} />
																)}
															</button>
														</div>
													)
												})}
												{previewLoading && (
													<div className="flex justify-start">
														<div className="rounded-2xl rounded-tl-none bg-white px-3 py-2 text-sm text-gray-400 shadow-sm animate-pulse">
															Thinking...
														</div>
													</div>
												)}
											</div>
										)}
									</div>

									{/* Chat Input */}
									<div className="p-4 border-t border-gray-100">
										<form
											onSubmit={(e) => {
												e.preventDefault()
												handleSendPreviewMessage()
											}}
											className="flex items-center gap-2"
										>
											<input
												type="text"
												value={chatMessage}
												onChange={(e) => setChatMessage(e.target.value)}
												placeholder="Type your message..."
												className="flex-1 px-3 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
											/>
											<button
												type="submit"
												disabled={previewLoading || !chatMessage.trim()}
												className="p-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition disabled:opacity-50"
											>
												<Send size={18} />
											</button>
										</form>
									</div>
								</div>
							</div>
						)}
					</div>
				</div>

				{/* Evaluation Detail Modal */}
				{showEvalModal && selectedEval && (
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
						<div className="bg-white rounded-3xl shadow-2xl w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col animate-in fade-in zoom-in duration-200">
							<div className="px-8 py-5 border-b border-gray-100 flex items-center justify-between bg-white">
								<div className="flex items-center gap-4">
									<div className="p-3 bg-blue-50 rounded-2xl text-blue-600">
										<BarChart3 size={24} />
									</div>
									<div>
										<h3 className="text-xl font-bold text-gray-900">
											Evaluation Report Context
										</h3>
										<p className="text-xs text-gray-400 mt-1 uppercase font-black tracking-widest">
											ID: {selectedEval.id}
										</p>
									</div>
								</div>
								<button
									onClick={() => setShowEvalModal(false)}
									className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-xl transition"
								>
									<X size={24} />
								</button>
							</div>

							<div className="flex-1 overflow-y-auto p-8 grid grid-cols-12 gap-8">
								<div className="col-span-12 lg:col-span-7 space-y-6">
									<h4 className="text-sm font-black uppercase text-gray-400 tracking-wider">
										Conversation Transcript
									</h4>
									<div className="space-y-4">
										{(selectedEval.ai_evaluation_messages || []).map(
											(msg: any, i: number) => (
												<div
													key={i}
													className={`flex flex-col ${msg.role === 'ai' ? 'items-start' : 'items-end'}`}
												>
													<div
														className={`max-w-[90%] rounded-3xl px-6 py-4 text-sm ${
															msg.role === 'ai'
																? 'bg-blue-600 text-white rounded-tl-none font-medium'
																: 'bg-gray-100 text-gray-800 rounded-tr-none border border-gray-200'
														}`}
													>
														<p className="whitespace-pre-wrap leading-relaxed">
															{msg.message}
														</p>
														<div className="mt-2 text-[10px] opacity-40 font-bold uppercase tracking-wider">
															{msg.role === 'ai'
																? 'Lyra AI Agent'
																: selectedEval.conversation?.contact
																		?.display_name || 'Customer'}
															&bull;{' '}
															{new Date(
																msg.msg_created_at || msg.created_at,
															).toLocaleTimeString()}
														</div>
													</div>
												</div>
											),
										)}
									</div>
								</div>

								<div className="col-span-12 lg:col-span-5 space-y-8 bg-gray-50/50 p-6 rounded-3xl border border-gray-100 h-fit">
									<div>
										<h4 className="text-xs font-black uppercase text-gray-400 tracking-widest mb-4">
											Internal Logic & Reasoning
										</h4>
										<div className="bg-white p-5 rounded-2xl border border-gray-200 shadow-sm">
											{selectedEval.content ? (
												<p className="text-sm text-gray-600 leading-relaxed italic">
													{selectedEval.content}
												</p>
											) : (
												<p className="text-xs text-gray-400 italic">
													No reasoning data captured for this evaluation.
												</p>
											)}
										</div>
									</div>

									<div>
										<h4 className="text-xs font-black uppercase text-gray-400 tracking-widest mb-4">
											Interaction Details
										</h4>
										<div className="space-y-3">
											<div className="flex items-center justify-between text-sm py-2 border-b border-gray-100">
												<span className="text-gray-400">Interaction Type</span>
												<span className="font-bold text-gray-700 capitalize">
													{selectedEval.type}
												</span>
											</div>
											<div className="flex items-center justify-between text-sm py-2 border-b border-gray-100">
												<span className="text-gray-400">Captured At</span>
												<span className="font-bold text-gray-700">
													{new Date(selectedEval.created_at).toLocaleString()}
												</span>
											</div>
											{selectedEval.metadata &&
												Object.keys(selectedEval.metadata).length > 0 && (
													<div className="space-y-2 mt-4">
														<span className="text-xs font-black uppercase text-gray-400">
															Additional Metadata
														</span>
														<div className="bg-gray-900 rounded-xl p-4 overflow-x-auto">
															<pre className="text-[10px] text-emerald-400 font-mono">
																{JSON.stringify(selectedEval.metadata, null, 2)}
															</pre>
														</div>
													</div>
												)}
										</div>
									</div>

									<button
										onClick={() => handleDeleteEvaluation(selectedEval.id)}
										className="w-full py-4 bg-red-50 text-red-600 text-sm font-bold rounded-2xl hover:bg-red-100 transition flex items-center justify-center gap-2 border border-red-100"
									>
										<Trash2 size={18} />
										Delete This Report
									</button>
								</div>
							</div>
						</div>
					</div>
				)}

				{/* Add Q&A Modal */}
				{showAddQnAModal && (
					<div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
						<div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden animate-in fade-in zoom-in duration-200">
							<div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
								<h3 className="text-lg font-bold text-gray-900">
									Add Q&A Pair
								</h3>
								<button
									onClick={() => setShowAddQnAModal(false)}
									className="text-gray-400 hover:text-gray-600 transition"
								>
									<X size={20} />
								</button>
							</div>
							<div className="p-6 space-y-4">
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										Question
									</label>
									<input
										type="text"
										placeholder="e.g., What are your business hours?"
										className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
										value={newQnA.question}
										onChange={(e) =>
											setNewQnA({ ...newQnA, question: e.target.value })
										}
									/>
								</div>
								<div>
									<label className="block text-sm font-medium text-gray-700 mb-1">
										Answer
									</label>
									<textarea
										rows={6}
										placeholder="Enter the answer..."
										className="w-full px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none resize-none"
										value={newQnA.answer}
										onChange={(e) =>
											setNewQnA({ ...newQnA, answer: e.target.value })
										}
									/>
								</div>
							</div>
							<div className="px-6 py-4 bg-gray-50 flex items-center justify-end gap-3">
								<button
									onClick={() => {
										setShowAddQnAModal(false)
										setNewQnA({ question: '', answer: '' })
									}}
									className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 transition"
								>
									Cancel
								</button>
								<button
									onClick={async () => {
										if (!newQnA.question || !newQnA.answer) {
											toast.error('Please fill in both question and answer')
											return
										}
										try {
											const newItem = {
												id: Date.now().toString(),
												question: newQnA.question,
												answer: newQnA.answer,
												type: 'qna',
											}
											setQnaItems((prev) => [...prev, newItem])
											setShowAddQnAModal(false)
											setNewQnA({ question: '', answer: '' })
											toast.success('Q&A pair added')
										} catch (error) {
											toast.error('Failed to add Q&A')
										}
									}}
									className="px-6 py-2 bg-blue-500 text-white font-medium rounded-lg hover:bg-blue-600 transition shadow-sm text-sm"
								>
									Add Q&A
								</button>
							</div>
						</div>
					</div>
				)}
			</div>
		</div>
	)
}
