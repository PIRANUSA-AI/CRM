import type { LucideIcon } from 'lucide-react'
import { createFileRoute } from '@tanstack/react-router'
import {
	AudioLines,
	BookText,
	Check,
	ChevronLeft,
	ChevronRight,
	Database,
	FileText,
	Globe,
	Image,
	Link2,
	Pencil,
	Plus,
	RefreshCw,
	Save,
	Search,
	Shield,
	Sheet,
	Sparkles,
	Trash2,
	Upload,
	X,
} from 'lucide-react'
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type DragEvent,
	type KeyboardEvent,
} from 'react'
import {
	CrmEmptyState,
	CrmSectionHeader,
	unwrapPayload,
} from '@/components/crm/shared'
import TiptapEditor from '@/components/TiptapEditor'
import { ai, knowledge } from '@/lib/api'

export const Route = createFileRoute('/_app/knowledge')({
	component: KnowledgeBasePage,
})

type KnowledgeItemType =
	| 'md'
	| 'pdf'
	| 'site'
	| 'img'
	| 'sheet'
	| 'audio'
	| 'file'
type KnowledgeItemStatus = 'ready' | 'syncing'
type KnowledgeWorkspaceTab = 'text' | 'website' | 'file'

type KnowledgeItem = {
	id: string
	name: string
	type: KnowledgeItemType
	size: string
	chunks: number
	embeddingModel: string
	status: KnowledgeItemStatus
	updatedAt: string
	tags: string[]
	hits: number
	isPrivate?: boolean
	content: string
	sourceUrl?: string
	fileName?: string
	sourceType?: string
}

type KnowledgeTextDocument = {
	id: string
	title: string
	content: string
	type: string
	isNew?: boolean
	isLoaded?: boolean
}

type RetrievalChunk = {
	score: number
	source: string
	snippet: string
	locator: string
}

type QueryMeta = {
	latencyMs: number
	groundedSources: number
	tokens: number
	cost: string
}

type ProviderModelCatalogItem = {
	id: string
	name: string
	vendor: string
	context_window: string
	max_output: string
}

type ProviderConfigRecord = {
	provider?: string
	model_name?: string
	models?: ProviderModelCatalogItem[]
}

type ProviderConfigurationsPayload = {
	active_provider?: string | null
	active_embedding_provider?: string | null
	providers?: Record<string, ProviderConfigRecord | null>
}

type RetrievalModelOption = {
	id: string
	label: string
}

const KNOWLEDGE_EMBEDDING_MODELS = [
	{
		value: 'text-embedding-3-small',
		label: 'text-embedding-3-small (Default)',
	},
	{
		value: 'text-embedding-ada-002',
		label: 'text-embedding-ada-002',
	},
] as const

const DEFAULT_KNOWLEDGE_EMBEDDING_MODEL = KNOWLEDGE_EMBEDDING_MODELS[0].value
const KNOWLEDGE_EMBEDDING_MODEL_STORAGE_KEY =
	'crm.knowledge.embedding_model'
const KNOWLEDGE_RETRIEVAL_MODEL_STORAGE_KEY = 'crm.knowledge.rag_model'

const DEFAULT_ANSWER =
	'Jalankan query untuk melihat jawaban berbasis knowledge source yang dipilih.'

const DEFAULT_QUERY_META: QueryMeta = {
	latencyMs: 0,
	groundedSources: 0,
	tokens: 0,
	cost: '$0.0000',
}

const TYPE_META: Record<
	KnowledgeItemType,
	{
		label: string
		icon: LucideIcon
		iconClass: string
	}
> = {
	md: {
		label: 'Markdown',
		icon: BookText,
		iconClass:
			'border border-blue-500/20 bg-blue-500/10 text-blue-600 dark:text-blue-300',
	},
	pdf: {
		label: 'PDF',
		icon: FileText,
		iconClass:
			'border border-rose-500/20 bg-rose-500/10 text-rose-600 dark:text-rose-300',
	},
	site: {
		label: 'Website',
		icon: Globe,
		iconClass:
			'border border-violet-500/20 bg-violet-500/10 text-violet-600 dark:text-violet-300',
	},
	img: {
		label: 'Image',
		icon: Image,
		iconClass:
			'border border-amber-500/20 bg-amber-500/10 text-amber-600 dark:text-amber-300',
	},
	sheet: {
		label: 'Sheet',
		icon: Sheet,
		iconClass:
			'border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
	},
	audio: {
		label: 'Audio',
		icon: AudioLines,
		iconClass:
			'border border-purple-500/20 bg-purple-500/10 text-purple-600 dark:text-purple-300',
	},
	file: {
		label: 'File',
		icon: FileText,
		iconClass:
			'border border-slate-500/20 bg-slate-500/10 text-slate-600 dark:text-slate-300',
	},
}

function safeString(input: unknown, fallback: string): string {
	const value = typeof input === 'string' ? input.trim() : ''
	return value.length > 0 ? value : fallback
}

function safeNumber(input: unknown, fallback: number): number {
	const value =
		typeof input === 'number'
			? input
			: typeof input === 'string'
				? Number(input)
				: Number.NaN
	if (!Number.isFinite(value)) return fallback
	return value
}

function unwrapObject<T = Record<string, unknown>>(input: unknown): T | null {
	if (!input || typeof input !== 'object') return null

	const root = input as Record<string, unknown>
	const candidates = [root.data, root.payload, root]
	for (const candidate of candidates) {
		if (candidate && typeof candidate === 'object' && !Array.isArray(candidate)) {
			return candidate as T
		}
	}
	return null
}

function parseDate(input: unknown): string {
	const value = safeString(input, '')
	if (!value) return ''
	const parsed = Date.parse(value)
	if (Number.isNaN(parsed)) return ''
	return new Date(parsed).toISOString()
}

function formatFileSizeFromContent(content: string): string {
	const kb = Math.max(1, Math.round(content.length / 1024))
	return `${kb} KB`
}

function formatBytes(value: number): string {
	if (!Number.isFinite(value) || value <= 0) return '0 B'
	const units = ['B', 'KB', 'MB', 'GB']
	let size = value
	let unitIndex = 0
	while (size >= 1024 && unitIndex < units.length - 1) {
		size /= 1024
		unitIndex += 1
	}
	const fixed =
		size >= 100 ? size.toFixed(0) : size >= 10 ? size.toFixed(1) : size.toFixed(2)
	return `${fixed} ${units[unitIndex]}`
}

function normalizeType(type: unknown): KnowledgeItemType {
	const value = safeString(type, 'md').toLowerCase()
	if (value === 'text' || value === 'markdown' || value === 'md') return 'md'
	if (value === 'pdf') return 'pdf'
	if (value === 'website' || value === 'url' || value === 'site') return 'site'
	if (value === 'img' || value === 'image' || value === 'photo') return 'img'
	if (
		value === 'sheet' ||
		value === 'csv' ||
		value === 'xls' ||
		value === 'xlsx'
	)
		return 'sheet'
	if (value === 'audio' || value === 'voice' || value === 'transcript')
		return 'audio'
	if (value === 'doc' || value === 'docx' || value === 'file') return 'file'
	return 'md'
}

function isTextKnowledgeItem(item: KnowledgeItem): boolean {
	return item.type === 'md' && item.sourceType !== 'file' && !item.fileName
}

function splitWebsiteInput(value: string): {
	urls: string[]
	invalid: string[]
} {
	const candidates = value
		.split(/[\s,]+/)
		.map((item) => item.trim())
		.filter(Boolean)
	const urls: string[] = []
	const invalid: string[] = []
	const seen = new Set<string>()

	for (const candidate of candidates) {
		try {
			const url = new URL(candidate)
			if (url.protocol !== 'http:' && url.protocol !== 'https:') {
				invalid.push(candidate)
				continue
			}
			url.hash = ''
			const normalized = url.toString()
			if (seen.has(normalized)) continue
			seen.add(normalized)
			urls.push(normalized)
		} catch {
			invalid.push(candidate)
		}
	}

	return { urls, invalid }
}

function getWebsiteTitle(urlValue: string): string {
	try {
		const url = new URL(urlValue)
		const hostname = url.hostname.replace(/^www\./, '')
		const pathname = url.pathname === '/' ? '' : url.pathname
		return [hostname, pathname].filter(Boolean).join(' ')
	} catch {
		return urlValue
	}
}

function normalizeStatus(status: unknown): KnowledgeItemStatus {
	const value = safeString(status, 'ready').toLowerCase()
	if (value === 'pending' || value === 'processing' || value === 'syncing') {
		return 'syncing'
	}
	return 'ready'
}

function estimateChunks(content: string): number {
	if (!content.trim()) return 1
	return Math.max(1, Math.ceil(content.length / 220))
}

function defaultEmbeddingModel(_type: KnowledgeItemType): string {
	return DEFAULT_KNOWLEDGE_EMBEDDING_MODEL
}

function toRelativeTimeLabel(dateString: string): string {
	const date = new Date(dateString)
	if (Number.isNaN(date.getTime())) return '-'
	const diff = date.getTime() - Date.now()
	const absMs = Math.abs(diff)
	const minute = 1000 * 60
	const hour = minute * 60
	const day = hour * 24

	if (absMs < hour) {
		const minutes = Math.max(1, Math.round(absMs / minute))
		return `${minutes} menit lalu`
	}
	if (absMs < day) {
		const hours = Math.max(1, Math.round(absMs / hour))
		return `${hours} jam lalu`
	}
	const days = Math.max(1, Math.round(absMs / day))
	if (days < 30) return `${days} hari lalu`
	if (days < 365) return `${Math.round(days / 30)} bulan lalu`
	return `${Math.round(days / 365)} tahun lalu`
}

function parseSizeToMb(value: string): number {
	const normalized = value.trim().toLowerCase()
	const match = normalized.match(/([\d.]+)\s*(kb|mb|gb)/)
	if (!match) return 0
	const amount = Number(match[1])
	if (!Number.isFinite(amount)) return 0
	if (match[2] === 'kb') return amount / 1024
	if (match[2] === 'gb') return amount * 1024
	return amount
}

function toProviderPayload(input: unknown): ProviderConfigurationsPayload {
	if (!input || typeof input !== 'object') return {}
	const root = input as Record<string, unknown>
	const directData =
		root.data && typeof root.data === 'object'
			? (root.data as Record<string, unknown>)
			: null
	const directPayload =
		root.payload && typeof root.payload === 'object'
			? (root.payload as Record<string, unknown>)
			: null
	const payload = directData || directPayload || root
	const providers =
		payload.providers && typeof payload.providers === 'object'
			? (payload.providers as Record<string, ProviderConfigRecord | null>)
			: undefined
	const activeProvider =
		typeof payload.active_provider === 'string'
			? payload.active_provider.trim()
			: null
	const activeEmbeddingProvider =
		typeof payload.active_embedding_provider === 'string'
			? payload.active_embedding_provider.trim()
			: null
	return {
		active_provider: activeProvider || null,
		active_embedding_provider: activeEmbeddingProvider || null,
		providers,
	}
}

function buildRetrievalModelOptions(
	config: ProviderConfigRecord | null | undefined,
): RetrievalModelOption[] {
	const models = Array.isArray(config?.models) ? config.models : []
	const normalized = models
		.map((model) => {
			const id = safeString(model.id, '')
			if (!id) return null
			const name = safeString(model.name, id)
			const vendor = safeString(model.vendor, '')
			const label = vendor ? `${name} · ${vendor}` : name
			return {
				id,
				label,
			}
		})
		.filter((item): item is RetrievalModelOption => Boolean(item))

	const fallbackModel = safeString(config?.model_name, '')
	if (fallbackModel && !normalized.some((model) => model.id === fallbackModel)) {
		normalized.unshift({
			id: fallbackModel,
			label: `${fallbackModel} (Default)`,
		})
	}
	return normalized
}

function highlightSnippet(snippet: string) {
	const parts = snippet.split(/(\*\*[^*]+\*\*)/g).filter(Boolean)
	return parts.map((part, index) => {
		const isHighlight = part.startsWith('**') && part.endsWith('**')
		if (!isHighlight) return <span key={`${part}-${index}`}>{part}</span>
		return (
			<strong key={`${part}-${index}`} className="font-semibold text-primary">
				{part.slice(2, -2)}
			</strong>
		)
	})
}

function mapKnowledgeItem(input: any): KnowledgeItem | null {
	const id = safeString(input?.id, '')
	if (!id) return null
	const name = safeString(input?.name || input?.title || input?.question, id)
	const content = safeString(
		input?.content || input?.answer || input?.description,
		'',
	)
	const type = normalizeType(input?.type)
	const size = safeString(input?.size, formatFileSizeFromContent(content))
	const chunks = Math.max(
		0,
		Math.round(
			safeNumber(
				input?.chunks || input?.chunk_count || input?.chunks_count,
				content ? estimateChunks(content) : 0,
			),
		),
	)
	const embeddingModel = safeString(
		input?.emb || input?.embedding_model,
		defaultEmbeddingModel(type),
	)
	const rawTags = Array.isArray(input?.tags)
		? input.tags
				.map((tag: unknown) => safeString(tag, ''))
				.filter(Boolean)
				.slice(0, 3)
		: []
	return {
		id,
		name,
		type,
		size,
		chunks,
		embeddingModel,
		status: normalizeStatus(input?.status),
		updatedAt: parseDate(
			input?.updated_at || input?.created_at || input?.createdAt,
		),
		tags: rawTags,
		hits: Math.max(
			0,
			Math.round(
				safeNumber(
					input?.hits || input?.retrieval_hits || input?.query_count,
					0,
				),
			),
		),
		isPrivate: Boolean(input?.private || input?.is_private),
		content,
		sourceUrl: safeString(input?.source_url || input?.sourceUrl, ''),
		fileName: safeString(input?.file_name || input?.fileName, ''),
		sourceType: safeString(input?.source_type || input?.sourceType, ''),
	}
}

function mapRetrievalChunk(input: any, index: number): RetrievalChunk {
	const rawScore = safeNumber(
		input?.score || input?.similarity || input?.relevance,
		0,
	)
	const normalized =
		rawScore > 1 ? (rawScore <= 10 ? rawScore / 10 : rawScore / 100) : rawScore
	return {
		score: Math.max(0, Math.min(1, normalized)),
		source: safeString(
			input?.source || input?.title || input?.document,
			`Result ${index + 1}`,
		),
		snippet: safeString(
			input?.snippet || input?.content || input?.text,
			'',
		),
		locator: safeString(input?.page || input?.section || input?.locator, '-'),
	}
}

function toCostLabel(value: unknown): string | null {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return `$${value.toFixed(4)}`
	}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) return null
		return trimmed.startsWith('$') ? trimmed : `$${trimmed}`
	}
	return null
}

function KnowledgeBasePage() {
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const textTabsRef = useRef<HTMLDivElement | null>(null)
	const dropDragDepthRef = useRef(0)
	const [loading, setLoading] = useState(true)
	const [items, setItems] = useState<KnowledgeItem[]>([])
	const [selectedId, setSelectedId] = useState('')
	const [search] = useState('')
	const [query, setQuery] = useState('')
	const [queryLoading, setQueryLoading] = useState(false)
	const [hasQueried, setHasQueried] = useState(false)
	const [uploadingSource, setUploadingSource] = useState(false)
	const [addingUrlSource, setAddingUrlSource] = useState(false)
	const [deletingSourceId, setDeletingSourceId] = useState('')
	const [isDropActive, setIsDropActive] = useState(false)
	const [workspaceTab, setWorkspaceTab] =
		useState<KnowledgeWorkspaceTab>('text')
	const [textDocuments, setTextDocuments] = useState<KnowledgeTextDocument[]>(
		[],
	)
	const [activeTextDoc, setActiveTextDoc] = useState('')
	const [editingTextDoc, setEditingTextDoc] =
		useState<KnowledgeTextDocument | null>(null)
	const [loadingTextDocId, setLoadingTextDocId] = useState('')
	const [renamingTextDoc, setRenamingTextDoc] = useState('')
	const [hasUnsavedTextChanges, setHasUnsavedTextChanges] = useState(false)
	const [websiteInput, setWebsiteInput] = useState('')
	const [filesToAdd, setFilesToAdd] = useState<File[]>([])
	const [embeddingModel, setEmbeddingModel] = useState<string>(
		DEFAULT_KNOWLEDGE_EMBEDDING_MODEL,
	)
	const [answer, setAnswer] = useState(DEFAULT_ANSWER)
	const [queryMeta, setQueryMeta] = useState<QueryMeta>(DEFAULT_QUERY_META)
	const [retrievalChunks, setRetrievalChunks] = useState<RetrievalChunk[]>([])
	const [retrievalProvider, setRetrievalProvider] = useState('')
	const [embeddingProvider, setEmbeddingProvider] = useState('')
	const [retrievalModelId, setRetrievalModelId] = useState('')
	const [retrievalModelOptions, setRetrievalModelOptions] = useState<
		RetrievalModelOption[]
	>([])

	useEffect(() => {
		if (typeof window === 'undefined') return
		try {
			const savedModel = window.localStorage.getItem(
				KNOWLEDGE_EMBEDDING_MODEL_STORAGE_KEY,
			)
			if (!savedModel) return
			const isKnownModel = KNOWLEDGE_EMBEDDING_MODELS.some(
				(model) => model.value === savedModel,
			)
			if (isKnownModel) {
				setEmbeddingModel(savedModel)
			}
		} catch {
			// Ignore localStorage errors.
		}
	}, [])

	useEffect(() => {
		if (typeof window === 'undefined') return
		try {
			window.localStorage.setItem(
				KNOWLEDGE_EMBEDDING_MODEL_STORAGE_KEY,
				embeddingModel,
			)
		} catch {
			// Ignore localStorage errors.
		}
	}, [embeddingModel])

	useEffect(() => {
		if (typeof window === 'undefined') return
		try {
			if (!retrievalModelId) {
				window.localStorage.removeItem(KNOWLEDGE_RETRIEVAL_MODEL_STORAGE_KEY)
				return
			}
			window.localStorage.setItem(
				KNOWLEDGE_RETRIEVAL_MODEL_STORAGE_KEY,
				retrievalModelId,
			)
		} catch {
			// Ignore localStorage errors.
		}
	}, [retrievalModelId])

	const syncTextDocuments = (nextItems: KnowledgeItem[]) => {
		setTextDocuments((previousDocs) => {
			const previousById = new Map(
				previousDocs.map((doc) => [doc.id, doc] as const),
			)
			const localDrafts = previousDocs.filter((doc) => doc.isNew)
			const serverDocs = nextItems
				.filter(isTextKnowledgeItem)
				.map((item) => {
					const existing = previousById.get(item.id)
					return {
						id: item.id,
						title: item.name,
						content: existing?.content || item.content || '',
						type: 'text',
						isNew: false,
						isLoaded: existing?.isLoaded || Boolean(item.content),
					}
				})

			return [...localDrafts, ...serverDocs]
		})
	}

	const loadSources = async () => {
		const response = await knowledge.list({ limit: 200 })
		const mapped = unwrapPayload<any>(response)
			.map(mapKnowledgeItem)
			.filter((item): item is KnowledgeItem => item !== null)
		setItems(mapped)
		syncTextDocuments(mapped)
	}

	const loadRetrievalModels = async () => {
		const response = await ai.getProviders()
		const payload = toProviderPayload(response)
		const providers = payload.providers || {}
		setEmbeddingProvider(safeString(payload.active_embedding_provider, ''))

		const activeCandidate = safeString(payload.active_provider, '')
		const fallbackProviderKey = Object.keys(providers).find(
			(key) => providers[key],
		)
		const resolvedProvider =
			activeCandidate && providers[activeCandidate]
				? activeCandidate
				: safeString(fallbackProviderKey, '')
		const activeConfig = resolvedProvider ? providers[resolvedProvider] : null
		const options = buildRetrievalModelOptions(activeConfig)

		setRetrievalProvider(resolvedProvider)
		setRetrievalModelOptions(options)

		const preferredModel = safeString(activeConfig?.model_name, '')
		const firstModel = safeString(options[0]?.id, '')
		let savedModel = ''
		if (typeof window !== 'undefined') {
			savedModel = safeString(
				window.localStorage.getItem(KNOWLEDGE_RETRIEVAL_MODEL_STORAGE_KEY),
				'',
			)
		}
		const candidate = savedModel || preferredModel || firstModel
		const isValid = options.some((option) => option.id === candidate)
		setRetrievalModelId(isValid ? candidate : '')
	}

	async function hydrateTextDocument(doc: KnowledgeTextDocument) {
		if (doc.isNew || doc.isLoaded) {
			setEditingTextDoc(doc)
			return
		}

		setLoadingTextDocId(doc.id)
		try {
			const response = await knowledge.getSource(doc.id)
			const detail = unwrapObject<any>(response)
			const hydrated: KnowledgeTextDocument = {
				id: doc.id,
				title: safeString(detail?.title || detail?.name, doc.title),
				content: safeString(detail?.content, ''),
				type: safeString(detail?.type, doc.type || 'text'),
				isNew: false,
				isLoaded: true,
			}
			setTextDocuments((previousDocs) =>
				previousDocs.map((item) => (item.id === doc.id ? hydrated : item)),
			)
			setEditingTextDoc(hydrated)
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Gagal memuat detail source.'
			window.alert(message)
		} finally {
			setLoadingTextDocId('')
		}
	}

	const selectTextDocument = async (doc: KnowledgeTextDocument) => {
		if (activeTextDoc === doc.id && editingTextDoc?.isLoaded) return
		if (
			hasUnsavedTextChanges &&
			!window.confirm('Buang perubahan dokumen yang belum disimpan?')
		) {
			return
		}
		setActiveTextDoc(doc.id)
		setRenamingTextDoc('')
		setHasUnsavedTextChanges(false)
		await hydrateTextDocument(doc)
	}

	useEffect(() => {
		let active = true
		const load = async () => {
			try {
				if (!active) return
				const [sourcesResult, modelsResult] = await Promise.allSettled([
					loadSources(),
					loadRetrievalModels(),
				])

					if (sourcesResult.status === 'rejected' && active) {
						setItems([])
					}
					if (modelsResult.status === 'rejected' && active) {
						setRetrievalModelId('')
						setRetrievalModelOptions([])
						setRetrievalProvider('')
						setEmbeddingProvider('')
					}
			} catch {
				if (active) setItems([])
			} finally {
				if (active) setLoading(false)
			}
		}
		load()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		if (items.some((item) => item.id === selectedId)) return
		if (items[0]) setSelectedId(items[0].id)
		else setSelectedId('')
	}, [items, selectedId])

	useEffect(() => {
		if (activeTextDoc && textDocuments.some((doc) => doc.id === activeTextDoc)) {
			return
		}
		const firstDoc = textDocuments[0]
		if (!firstDoc) {
			setActiveTextDoc('')
			setEditingTextDoc(null)
			return
		}
		setActiveTextDoc(firstDoc.id)
		setEditingTextDoc(firstDoc)
	}, [activeTextDoc, textDocuments])

	useEffect(() => {
		if (workspaceTab !== 'text') return
		if (!editingTextDoc || editingTextDoc.isLoaded || editingTextDoc.isNew) return
		void hydrateTextDocument(editingTextDoc)
	}, [workspaceTab, editingTextDoc?.id])

	const filteredItems = useMemo(() => {
		const keyword = search.trim().toLowerCase()
		if (!keyword) return items
		return items.filter((item) =>
			`${item.name} ${item.content} ${item.tags.join(' ')} ${item.embeddingModel}`
				.toLowerCase()
				.includes(keyword),
		)
	}, [items, search])

	const selectedItem = useMemo(() => {
		return items.find((item) => item.id === selectedId) || items[0] || null
	}, [items, selectedId])

	const websiteItems = useMemo(
		() => items.filter((item) => item.type === 'site' || item.sourceType === 'url'),
		[items],
	)
	const fileItems = useMemo(
		() =>
			items.filter(
				(item) =>
					item.sourceType === 'file' ||
					Boolean(item.fileName) ||
					(item.type !== 'site' && !isTextKnowledgeItem(item)),
			),
		[items],
	)

	useEffect(() => {
		setHasQueried(false)
		setRetrievalChunks([])
		setAnswer(
			selectedItem
				? `Source "${selectedItem.name}" siap diuji. Tulis pertanyaan lalu klik Query.`
				: DEFAULT_ANSWER,
		)
		setQueryMeta(DEFAULT_QUERY_META)
	}, [selectedItem?.id])

	const totalChunks = useMemo(
		() => items.reduce((total, item) => total + item.chunks, 0),
		[items],
	)
	const totalHits = useMemo(
		() => items.reduce((total, item) => total + item.hits, 0),
		[items],
	)
	const indexSizeMb = useMemo(
		() => items.reduce((total, item) => total + parseSizeToMb(item.size), 0),
		[items],
	)
	const readyCount = useMemo(
		() => items.filter((item) => item.status === 'ready').length,
		[items],
	)
	const ragHitRate = useMemo(() => {
		if (items.length === 0) return 0
		return (readyCount / items.length) * 100
	}, [items.length, readyCount])

	const runQuery = async () => {
		const trimmed = query.trim()
		if (!trimmed) return
		setHasQueried(true)
		setQueryLoading(true)
		try {
			const response: any = await knowledge.retrievalTest({
				query: trimmed,
				selectedSourceIds: selectedItem?.id ? [selectedItem.id] : undefined,
				topK: 5,
				modelId: retrievalModelId || undefined,
				provider: retrievalProvider || undefined,
			})
			const payload = response?.payload || response?.data || response
			const resolvedAnswer = safeString(
				payload?.answer || payload?.response || payload?.text,
				'Belum ada jawaban dari API. Coba ulangi query atau cek source yang aktif.',
			)
			setAnswer(resolvedAnswer)

			const maybeChunks =
				payload?.topChunks ||
				payload?.chunks ||
				payload?.results ||
				payload?.contexts ||
				payload?.documents
			if (Array.isArray(maybeChunks) && maybeChunks.length > 0) {
				setRetrievalChunks(
					maybeChunks
						.slice(0, 5)
						.map(mapRetrievalChunk)
						.filter((chunk) => chunk.snippet.trim().length > 0),
				)
			} else {
				setRetrievalChunks([])
			}

			const tokenCount = safeNumber(
				payload?.tokens || payload?.usage?.total_tokens || payload?.token_usage,
				0,
			)
			const groundedSources = safeNumber(
				payload?.groundedSources ||
				payload?.grounded_sources ||
					payload?.sources_used ||
					payload?.citations?.length ||
					payload?.sources?.length,
				0,
			)
			const latencyMs = safeNumber(
				payload?.latency_ms || payload?.latencyMs || payload?.retrieval_ms,
				0,
			)
			const cost = toCostLabel(payload?.cost || payload?.estimated_cost)
			setQueryMeta({
				tokens: Math.max(0, Math.round(tokenCount)),
				groundedSources: Math.max(0, Math.round(groundedSources)),
				latencyMs: Math.max(0, Math.round(latencyMs)),
				cost: cost || DEFAULT_QUERY_META.cost,
			})
		} catch {
			setAnswer(
				'Retrieval gagal dijalankan. Coba ulangi query atau periksa source yang dipilih.',
			)
			setRetrievalChunks([])
			setQueryMeta(DEFAULT_QUERY_META)
		} finally {
			setQueryLoading(false)
		}
	}

	const refreshSources = async () => {
		try {
			await loadSources()
		} catch {
			// Keep current data on refresh errors.
		}
	}

	const handleFileButtonClick = () => {
		fileInputRef.current?.click()
	}

	const handleCreateTextDocument = () => {
		const id = `new-${Date.now()}`
		const newDoc: KnowledgeTextDocument = {
			id,
			title: 'Untitled',
			content: '',
			type: 'text',
			isNew: true,
			isLoaded: true,
		}
		setWorkspaceTab('text')
		setTextDocuments((previousDocs) => [newDoc, ...previousDocs])
		setActiveTextDoc(id)
		setEditingTextDoc(newDoc)
		setRenamingTextDoc(id)
		setHasUnsavedTextChanges(true)
	}

	const updateEditingTextDocument = (
		patch: Partial<Pick<KnowledgeTextDocument, 'title' | 'content'>>,
	) => {
		setEditingTextDoc((previousDoc) => {
			if (!previousDoc) return previousDoc
			const nextDoc = { ...previousDoc, ...patch }
			setTextDocuments((previousDocs) =>
				previousDocs.map((doc) => (doc.id === nextDoc.id ? nextDoc : doc)),
			)
			return nextDoc
		})
		setHasUnsavedTextChanges(true)
	}

	const handleSaveTextDocument = async () => {
		if (!editingTextDoc) return
		const title = safeString(editingTextDoc.title, 'Untitled')
		const content = editingTextDoc.content || ''

		setUploadingSource(true)
		try {
			if (editingTextDoc.isNew) {
				const response = await knowledge.createSource({
					title,
					content,
					type: 'text',
					format: 'text',
					embedding_model: embeddingModel,
					source_type: 'manual',
					metadata: {
						imported_from: 'knowledge-text-editor',
					},
				})
				const created = unwrapObject<{ id?: string; title?: string }>(response)
				const createdId = safeString(created?.id, '')
				if (!createdId) throw new Error('Source baru tidak memiliki ID.')
				const savedDoc: KnowledgeTextDocument = {
					...editingTextDoc,
					id: createdId,
					title,
					content,
					isNew: false,
					isLoaded: true,
				}
				setTextDocuments((previousDocs) =>
					previousDocs.map((doc) =>
						doc.id === editingTextDoc.id ? savedDoc : doc,
					),
				)
				setActiveTextDoc(createdId)
				setEditingTextDoc(savedDoc)
				setSelectedId(createdId)
			} else {
				await knowledge.updateSource(editingTextDoc.id, {
					title,
					content,
					type: 'text',
					format: 'text',
					embedding_model: embeddingModel,
					source_type: 'manual',
				})
				const savedDoc = {
					...editingTextDoc,
					title,
					content,
					isLoaded: true,
				}
				setTextDocuments((previousDocs) =>
					previousDocs.map((doc) =>
						doc.id === editingTextDoc.id ? savedDoc : doc,
					),
				)
				setEditingTextDoc(savedDoc)
				setSelectedId(editingTextDoc.id)
			}
			setRenamingTextDoc('')
			setHasUnsavedTextChanges(false)
			await refreshSources()
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Gagal menyimpan dokumen.'
			window.alert(message)
		} finally {
			setUploadingSource(false)
		}
	}

	const handleDeleteTextDocument = async (doc: KnowledgeTextDocument) => {
		const confirmed = window.confirm(
			`Hapus dokumen "${doc.title || 'Untitled'}" dari knowledge base?`,
		)
		if (!confirmed) return

		if (doc.isNew) {
			setTextDocuments((previousDocs) =>
				previousDocs.filter((item) => item.id !== doc.id),
			)
			if (activeTextDoc === doc.id) {
				setActiveTextDoc('')
				setEditingTextDoc(null)
			}
			setHasUnsavedTextChanges(false)
			return
		}

		setDeletingSourceId(doc.id)
		try {
			await knowledge.deleteSource(doc.id)
			setTextDocuments((previousDocs) =>
				previousDocs.filter((item) => item.id !== doc.id),
			)
			setItems((previousItems) =>
				previousItems.filter((item) => item.id !== doc.id),
			)
			if (selectedId === doc.id) setSelectedId('')
			if (activeTextDoc === doc.id) {
				setActiveTextDoc('')
				setEditingTextDoc(null)
			}
			setHasUnsavedTextChanges(false)
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Gagal menghapus dokumen.'
			window.alert(message)
		} finally {
			setDeletingSourceId('')
		}
	}

	const enqueueFiles = (files: File[]) => {
		if (files.length === 0) return
		setFilesToAdd((previousFiles) => {
			const seen = new Set(
				previousFiles.map(
					(file) => `${file.name}-${file.size}-${file.lastModified}`,
				),
			)
			const nextFiles = [...previousFiles]
			for (const file of files) {
				const key = `${file.name}-${file.size}-${file.lastModified}`
				if (seen.has(key)) continue
				seen.add(key)
				nextFiles.push(file)
			}
			return nextFiles
		})
	}

	const uploadSourceFile = async (file: File) => {
		await knowledge.uploadSourceFile({
			file,
			embeddingModel,
			title: file.name,
		})
	}

	const uploadQueuedFiles = async () => {
		if (filesToAdd.length === 0 || uploadingSource) return
		setUploadingSource(true)
		try {
			for (const file of filesToAdd) {
				await uploadSourceFile(file)
			}
			setFilesToAdd([])
			await refreshSources()
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Upload file knowledge gagal.'
			window.alert(message)
		} finally {
			setUploadingSource(false)
		}
	}

	const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
		const files = Array.from(event.target.files || [])
		event.target.value = ''
		enqueueFiles(files)
	}

	const handleDropZoneDragEnter = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		event.stopPropagation()
		dropDragDepthRef.current += 1
		if (!isDropActive) setIsDropActive(true)
	}

	const handleDropZoneDragOver = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		event.stopPropagation()
		if (event.dataTransfer) {
			event.dataTransfer.dropEffect = 'copy'
		}
		if (!isDropActive) setIsDropActive(true)
	}

	const handleDropZoneDragLeave = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		event.stopPropagation()
		dropDragDepthRef.current = Math.max(0, dropDragDepthRef.current - 1)
		if (dropDragDepthRef.current === 0) {
			setIsDropActive(false)
		}
	}

	const handleDropZoneDrop = (event: DragEvent<HTMLDivElement>) => {
		event.preventDefault()
		event.stopPropagation()
		dropDragDepthRef.current = 0
		setIsDropActive(false)
		const files = Array.from(event.dataTransfer?.files || [])
		enqueueFiles(files)
	}

	const handleAddWebsiteSources = async () => {
		const parsed = splitWebsiteInput(websiteInput)
		if (parsed.invalid.length > 0) {
			window.alert(`URL tidak valid: ${parsed.invalid.slice(0, 5).join(', ')}`)
		}
		if (parsed.urls.length === 0) return

		const existingUrls = new Set(
			websiteItems
				.map((item) => item.sourceUrl || item.content || item.name)
				.filter(Boolean),
		)
		const urlsToAdd = parsed.urls.filter((url) => !existingUrls.has(url))
		if (urlsToAdd.length === 0) {
			window.alert('Semua URL sudah ada di knowledge base.')
			return
		}

		setAddingUrlSource(true)
		try {
			for (const url of urlsToAdd) {
				await knowledge.createSource({
					title: getWebsiteTitle(url),
					content: url,
					type: 'website',
					format: 'website',
					embedding_model: embeddingModel,
					source_type: 'url',
					source_url: url,
					metadata: {
						ingestion_hint: 'website',
						imported_from: 'knowledge-website-tab',
					},
				})
			}
			setWebsiteInput('')
			await refreshSources()
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Gagal menambahkan source URL.'
			window.alert(message)
		} finally {
			setAddingUrlSource(false)
		}
	}

	const handleDeleteSource = async (item: KnowledgeItem) => {
		const confirmed = window.confirm(
			`Hapus source "${item.name}" dari knowledge base?`,
		)
		if (!confirmed) return

		setDeletingSourceId(item.id)
		try {
			await knowledge.deleteSource(item.id)
			const nextItems = items.filter((currentItem) => currentItem.id !== item.id)
			setItems(nextItems)
			setTextDocuments((previousDocs) =>
				previousDocs.filter((doc) => doc.id !== item.id),
			)
			if (selectedId === item.id) {
				setSelectedId(nextItems[0]?.id || '')
			}
			if (activeTextDoc === item.id) {
				setActiveTextDoc('')
				setEditingTextDoc(null)
				setHasUnsavedTextChanges(false)
			}
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Gagal menghapus source knowledge.'
			window.alert(message)
		} finally {
			setDeletingSourceId('')
		}
	}

	const indexSizeLabel =
		indexSizeMb > 0
			? `${Math.round(indexSizeMb).toLocaleString('id-ID')} MB`
			: '0 MB'
	const healthLabel =
		readyCount === items.length && items.length > 0 ? 'healthy' : 'syncing'
	const healthTone =
		readyCount === items.length && items.length > 0
			? 'text-emerald-500'
			: 'text-amber-500'

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Knowledge Base"
				subtitle={`${items.length} sources · ${totalChunks.toLocaleString(
					'id-ID',
				)} chunks · vector index ${healthLabel}`}
			/>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_390px]">
				<section className="min-h-0 space-y-3">
					<div className="ocm-grid-4">
						<StatTile
							label="Total queries (24h)"
							value={totalHits.toLocaleString('id-ID')}
							delta="+8.4%"
						/>
						<StatTile
							label="Avg retrieval time"
							value={`${queryMeta.latencyMs}ms`}
							delta="-12ms"
						/>
						<StatTile
							label="RAG hit rate"
							value={`${ragHitRate.toFixed(1)}%`}
							delta={`ready ${readyCount}/${items.length || 0}`}
						/>
						<StatTile
							label="Index size"
							value={indexSizeLabel}
							delta="pgvector"
						/>
					</div>

						<section className="overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
							<div className="flex flex-col gap-3 border-b border-border p-2 lg:flex-row lg:items-center lg:justify-between">
								<div className="flex flex-wrap items-center gap-1">
									{[
										{ id: 'text', label: 'Text', icon: FileText },
										{ id: 'website', label: 'Website', icon: Globe },
										{ id: 'file', label: 'File', icon: Upload },
									].map((tab) => {
										const TabIcon = tab.icon
										const isActive = workspaceTab === tab.id
										return (
											<button
												key={tab.id}
												type="button"
												className={`inline-flex h-10 items-center gap-2 rounded-lg px-4 text-sm font-semibold transition ${
													isActive
														? 'bg-primary/10 text-primary'
														: 'text-muted-foreground hover:bg-muted/60 hover:text-foreground'
												}`}
												onClick={() => setWorkspaceTab(tab.id as KnowledgeWorkspaceTab)}
											>
												<TabIcon size={16} />
												{tab.label}
											</button>
										)
									})}
								</div>
								<div className="grid gap-2 px-1 pb-1 sm:grid-cols-[140px_minmax(0,280px)] sm:items-center lg:pb-0">
									<span className="text-xs font-semibold text-muted-foreground">
										Embedding model
									</span>
									<select
										className="ocm-input h-10 w-full px-3 text-sm"
										value={embeddingModel}
										onChange={(event) => setEmbeddingModel(event.target.value)}
									>
										{KNOWLEDGE_EMBEDDING_MODELS.map((model) => (
											<option key={model.value} value={model.value}>
												{model.label}
											</option>
										))}
									</select>
								</div>
							</div>

							{workspaceTab === 'text' ? (
								<div className="flex min-h-[560px] flex-col bg-background">
									<div className="flex min-h-12 items-center border-b border-border bg-card">
										<button
											type="button"
											onClick={handleCreateTextDocument}
											className="grid h-12 w-12 shrink-0 place-items-center border-r border-border text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
											title="Tambah dokumen text"
											aria-label="Tambah dokumen text"
										>
											<Plus size={20} />
										</button>

										<div
											ref={textTabsRef}
											className="flex min-w-0 flex-1 overflow-x-auto"
										>
											{textDocuments.length === 0 ? (
												<div className="flex h-12 items-center px-4 text-sm italic text-muted-foreground">
													No documents. Click + to add.
												</div>
											) : null}
											{textDocuments.map((doc) => {
												const isActive = activeTextDoc === doc.id
												return (
													<div
														key={doc.id}
														className={`relative flex h-12 min-w-[170px] max-w-[260px] cursor-pointer items-center px-3 pr-16 transition ${
															isActive
																? 'bg-primary text-primary-foreground'
																: 'border-r border-border bg-muted/25 text-foreground hover:bg-muted/60'
														}`}
														onClick={() => void selectTextDocument(doc)}
													>
														{renamingTextDoc === doc.id ? (
															<div
																className="flex w-full items-center gap-1"
																onClick={(event) => event.stopPropagation()}
															>
																<input
																	autoFocus
																	className={`w-full border-b bg-transparent text-sm font-medium outline-none ${
																		isActive
																			? 'border-primary-foreground/50'
																			: 'border-border'
																	}`}
																	value={editingTextDoc?.title || doc.title}
																	onChange={(event) =>
																		updateEditingTextDocument({
																			title: event.target.value,
																		})
																	}
																	onBlur={() => setRenamingTextDoc('')}
																	onKeyDown={(event: KeyboardEvent<HTMLInputElement>) => {
																		if (event.key === 'Enter') setRenamingTextDoc('')
																	}}
																/>
																<button
																	type="button"
																	onMouseDown={(event) => event.preventDefault()}
																	onClick={() => setRenamingTextDoc('')}
																	className="rounded p-1 hover:bg-background/20"
																	aria-label="Selesai rename"
																>
																	<Check size={14} />
																</button>
															</div>
														) : (
															<span className="truncate text-sm font-semibold">
																{doc.title || 'Untitled'}
															</span>
														)}
														{renamingTextDoc !== doc.id ? (
															<div className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-0.5">
																<button
																	type="button"
																	onClick={(event) => {
																		event.stopPropagation()
																		setActiveTextDoc(doc.id)
																		setEditingTextDoc(doc)
																		setRenamingTextDoc(doc.id)
																	}}
																	className="rounded p-1 opacity-70 transition hover:bg-background/20 hover:opacity-100"
																	aria-label={`Rename ${doc.title}`}
																>
																	<Pencil size={12} />
																</button>
																<button
																	type="button"
																	onClick={(event) => {
																		event.stopPropagation()
																		void handleDeleteTextDocument(doc)
																	}}
																	className="rounded p-1 opacity-70 transition hover:bg-background/20 hover:opacity-100"
																	aria-label={`Hapus ${doc.title}`}
																>
																	<X size={12} />
																</button>
															</div>
														) : null}
													</div>
												)
											})}
										</div>

										<div className="flex h-12 shrink-0 items-center gap-1 border-l border-border px-3">
											<button
												type="button"
												onClick={() =>
													textTabsRef.current?.scrollBy({
														left: -220,
														behavior: 'smooth',
													})
												}
												className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-muted/60"
												aria-label="Scroll dokumen ke kiri"
											>
												<ChevronLeft size={18} />
											</button>
											<button
												type="button"
												onClick={() =>
													textTabsRef.current?.scrollBy({
														left: 220,
														behavior: 'smooth',
													})
												}
												className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-muted/60"
												aria-label="Scroll dokumen ke kanan"
											>
												<ChevronRight size={18} />
											</button>
											<button
												type="button"
												onClick={() => void handleSaveTextDocument()}
												disabled={
													!editingTextDoc ||
													!hasUnsavedTextChanges ||
													uploadingSource
												}
												className={`ml-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-3 text-sm font-semibold transition ${
													hasUnsavedTextChanges && editingTextDoc
														? 'bg-primary text-primary-foreground hover:bg-primary/90'
														: 'bg-muted text-muted-foreground'
												}`}
											>
												{uploadingSource ? (
													<RefreshCw size={14} className="animate-spin" />
												) : (
													<Save size={14} />
												)}
												Save
											</button>
										</div>
									</div>

									<div className="min-h-0 flex-1 bg-background">
										{editingTextDoc ? (
											loadingTextDocId === editingTextDoc.id ? (
												<div className="flex min-h-[500px] items-center justify-center text-sm text-muted-foreground">
													Memuat dokumen...
												</div>
											) : (
												<TiptapEditor
													content={editingTextDoc.content || ''}
													onChange={(newContent) =>
														updateEditingTextDocument({ content: newContent })
													}
												/>
											)
										) : (
											<div className="flex min-h-[500px] flex-col items-center justify-center text-center text-muted-foreground">
												<FileText size={64} className="mb-4 opacity-20" />
												<p className="text-lg font-semibold">Select a document to edit</p>
												<p className="text-sm">Or click the + button to create a new one</p>
											</div>
										)}
									</div>
								</div>
							) : null}

							{workspaceTab === 'website' ? (
								<div className="min-h-[560px] p-5">
									<div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
										<div>
											<label className="mb-2 block text-sm font-semibold text-foreground">
												Website URLs
											</label>
											<textarea
												className="ocm-textarea min-h-[180px]"
												value={websiteInput}
												onChange={(event) => setWebsiteInput(event.target.value)}
												placeholder="https://example.com/page&#10;https://example.com/docs"
											/>
											<div className="mt-3 flex items-center justify-between gap-3">
												<p className="text-xs text-muted-foreground">
													Paste satu atau banyak URL. Duplikat akan dilewati otomatis.
												</p>
												<button
													type="button"
													className="ocm-btn ocm-btn-primary h-10 px-4 text-sm font-semibold"
													onClick={() => void handleAddWebsiteSources()}
													disabled={addingUrlSource || !websiteInput.trim()}
												>
													<Link2 size={15} />
													{addingUrlSource ? 'Adding...' : 'Add URLs'}
												</button>
											</div>
										</div>

										<div className="rounded-xl border border-border bg-muted/20 p-4">
											<div className="mb-3 flex items-center justify-between">
												<h3 className="text-sm font-semibold">Trained Links</h3>
												<span className="ocm-tag">{websiteItems.length} link</span>
											</div>
											{websiteItems.length === 0 ? (
												<div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
													Belum ada website source.
												</div>
											) : (
												<div className="max-h-[400px] space-y-2 overflow-y-auto">
													{websiteItems.map((item) => (
														<div
															key={item.id}
															className="flex items-center gap-2 rounded-lg bg-background p-2"
														>
															<Globe size={15} className="shrink-0 text-primary" />
															<div className="min-w-0 flex-1">
																<p className="truncate text-sm font-medium">{item.name}</p>
																<p className="truncate text-xs text-muted-foreground">
																	{item.sourceUrl || item.content || '-'}
																</p>
															</div>
															<button
																type="button"
																className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
																onClick={() => void handleDeleteSource(item)}
																aria-label={`Hapus ${item.name}`}
															>
																<Trash2 size={14} />
															</button>
														</div>
													))}
												</div>
											)}
										</div>
									</div>
								</div>
							) : null}

							{workspaceTab === 'file' ? (
								<div className="min-h-[560px] p-5">
									<input
										ref={fileInputRef}
										type="file"
										multiple
										className="hidden"
										accept=".pdf,.md,.markdown,.doc,.docx,.txt,.csv,.json,image/*,audio/*"
										onChange={handleFileChange}
									/>
									<div
										className={`rounded-xl border-2 border-dashed p-10 text-center transition ${
											isDropActive
												? 'border-primary/60 bg-primary/10'
												: 'border-border bg-muted/20 hover:border-primary/40'
										}`}
										onDragEnter={handleDropZoneDragEnter}
										onDragOver={handleDropZoneDragOver}
										onDragLeave={handleDropZoneDragLeave}
										onDrop={handleDropZoneDrop}
										onClick={handleFileButtonClick}
									>
										<Upload size={34} className="mx-auto mb-3 text-muted-foreground" />
										<p className="font-semibold text-foreground">
											Drag & drop files here or click to select files
										</p>
										<p className="mt-2 text-sm text-muted-foreground">
											PDF, Markdown, DOCX, TXT, CSV, JSON, image, dan audio didukung.
										</p>
									</div>

									<div className="mt-5 grid gap-4 lg:grid-cols-2">
										<div>
											<div className="mb-3 flex items-center justify-between">
												<h3 className="text-sm font-semibold">Already Included Files</h3>
												<span className="ocm-tag">{fileItems.length} file</span>
											</div>
											{fileItems.length === 0 ? (
												<div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
													Belum ada file source.
												</div>
											) : (
												<div className="max-h-[280px] space-y-2 overflow-y-auto">
													{fileItems.map((item) => (
														<div
															key={item.id}
															className="flex items-center gap-2 rounded-lg bg-muted/30 p-2"
														>
															<FileText size={15} className="shrink-0 text-primary" />
															<span className="min-w-0 flex-1 truncate text-sm">
																{item.fileName || item.name}
															</span>
															<button
																type="button"
																className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
																onClick={() => void handleDeleteSource(item)}
																aria-label={`Hapus ${item.name}`}
															>
																<Trash2 size={14} />
															</button>
														</div>
													))}
												</div>
											)}
										</div>

										<div>
											<div className="mb-3 flex items-center justify-between">
												<h3 className="text-sm font-semibold">To Be Added</h3>
												<button
													type="button"
													className="ocm-btn ocm-btn-primary h-9 px-3 text-xs"
													onClick={() => void uploadQueuedFiles()}
													disabled={uploadingSource || filesToAdd.length === 0}
												>
													{uploadingSource ? (
														<RefreshCw size={13} className="animate-spin" />
													) : (
														<Upload size={13} />
													)}
													Upload {filesToAdd.length || ''}
												</button>
											</div>
											{filesToAdd.length === 0 ? (
												<div className="rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
													Belum ada file di queue.
												</div>
											) : (
												<div className="max-h-[280px] space-y-2 overflow-y-auto">
													{filesToAdd.map((file, index) => (
														<div
															key={`${file.name}-${file.size}-${file.lastModified}`}
															className="flex items-center gap-2 rounded-lg bg-primary/10 p-2"
														>
															<FileText size={15} className="shrink-0 text-primary" />
															<div className="min-w-0 flex-1">
																<p className="truncate text-sm font-medium">{file.name}</p>
																<p className="text-xs text-muted-foreground">
																	{formatBytes(file.size)}
																</p>
															</div>
															<button
																type="button"
																className="grid h-8 w-8 place-items-center rounded text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
																onClick={() =>
																	setFilesToAdd((previousFiles) =>
																		previousFiles.filter((_, itemIndex) => itemIndex !== index),
																	)
																}
																aria-label={`Remove ${file.name}`}
															>
																<X size={14} />
															</button>
														</div>
													))}
												</div>
											)}
										</div>
									</div>
								</div>
							) : null}
						</section>

					<section className="ocm-card min-h-0 overflow-hidden">
						<div className="ocm-card-header">
							<div>
								<h2 className="ocm-card-title">Source Library</h2>
								<p className="mt-1 text-xs text-muted-foreground">
									Struktur data + layout mengikuti referensi knowledge manager
								</p>
							</div>
							<div className="flex items-center gap-2">
								<span className="ocm-tag">{filteredItems.length} source</span>
								<span className={`text-xs font-semibold ${healthTone}`}>
									● {healthLabel}
								</span>
							</div>
						</div>

						{loading && filteredItems.length === 0 ? (
							<div className="p-4 text-sm text-muted-foreground">
								Memuat source knowledge...
							</div>
						) : filteredItems.length === 0 ? (
							<div className="p-3">
								<CrmEmptyState
									title="Source tidak ditemukan"
									description="Coba kata kunci lain atau tambahkan source baru."
								/>
							</div>
						) : (
							<div className="overflow-x-auto">
								<table className="ocm-table min-w-[840px]">
									<thead>
										<tr>
											<th className="w-[40%]">Source</th>
											<th>Chunks</th>
											<th>Size</th>
											<th>Embedding</th>
											<th>Hits</th>
											<th>Status</th>
											<th className="w-12 text-right">Aksi</th>
										</tr>
									</thead>
									<tbody>
										{filteredItems.map((item) => {
											const typeMeta = TYPE_META[item.type]
											const TypeIcon = typeMeta.icon
											const isSelected = selectedId === item.id
											return (
												<tr
													key={item.id}
													className={`cursor-pointer transition ${isSelected ? 'bg-primary/8' : 'hover:bg-muted/35'}`}
													onClick={() => setSelectedId(item.id)}
												>
													<td>
														<div className="flex min-w-0 items-start gap-2">
															<div
																className={`grid h-7 w-7 shrink-0 place-items-center rounded-md ${typeMeta.iconClass}`}
															>
																<TypeIcon size={13} />
															</div>
															<div className="min-w-0">
																<p className="flex items-center gap-1.5 truncate text-sm font-semibold">
																	<span className="truncate">{item.name}</span>
																	{item.isPrivate ? (
																		<Shield
																			size={11}
																			className="shrink-0 text-muted-foreground"
																		/>
																	) : null}
																</p>
																<div className="mt-1 flex items-center gap-1.5 text-[10px] text-muted-foreground">
																	{item.tags.map((tag) => (
																		<span
																			key={`${item.id}-${tag}`}
																			className="ocm-tag"
																		>
																			{tag}
																		</span>
																	))}
																	<span className="ml-auto font-mono">
																		{toRelativeTimeLabel(item.updatedAt)}
																	</span>
																</div>
															</div>
														</div>
													</td>
													<td className="font-mono text-xs">
														{item.chunks.toLocaleString('id-ID')}
													</td>
													<td className="font-mono text-xs text-muted-foreground">
														{item.size}
													</td>
													<td className="font-mono text-[11px] text-muted-foreground">
														{item.embeddingModel}
													</td>
													<td className="font-mono text-xs">
														{item.hits.toLocaleString('id-ID')}
													</td>
													<td>
														{item.status === 'ready' ? (
															<span className="ocm-tag ocm-tag-success">
																<span className="h-1.5 w-1.5 rounded-full bg-current" />
																ready
															</span>
														) : (
															<span className="ocm-tag ocm-tag-warning">
																<span className="h-1.5 w-1.5 rounded-full bg-current" />
																syncing
															</span>
														)}
													</td>
													<td className="text-right">
														<button
															type="button"
															className="ocm-btn h-8 w-8 px-0 text-muted-foreground hover:text-destructive"
															title="Hapus source"
															aria-label={`Hapus ${item.name}`}
															disabled={deletingSourceId === item.id}
															onClick={(event) => {
																event.stopPropagation()
																void handleDeleteSource(item)
															}}
														>
															<Trash2 size={14} />
														</button>
													</td>
												</tr>
											)
										})}
									</tbody>
								</table>
							</div>
						)}
					</section>
				</section>

				<section className="ocm-card flex min-h-0 flex-col overflow-hidden">
					<div className="ocm-card-header">
						<div>
							<h2 className="ocm-card-title">Test Retrieval</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								{selectedItem
									? `${selectedItem.name} · ${selectedItem.chunks.toLocaleString('id-ID')} chunks · ${selectedItem.embeddingModel}`
									: 'Source belum dipilih'}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{retrievalModelId
									? `Model: ${retrievalModelId}${retrievalProvider ? ` · provider ${retrievalProvider}` : ''}`
									: 'Model: default provider'}
							</p>
							<p className="mt-1 text-xs text-muted-foreground">
								{embeddingProvider
									? `Embedding provider: ${embeddingProvider}`
									: 'Embedding provider: follow active provider'}
							</p>
						</div>
						<span className="ocm-tag">
							<Database size={12} />
							playground
						</span>
					</div>

					<div className="border-b border-border p-4">
						<div className="rounded-lg border border-border bg-muted/25 p-3">
							<textarea
								className="ocm-textarea min-h-[74px] border-0 bg-transparent p-0 shadow-none"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								placeholder="Tulis pertanyaan untuk test retrieval..."
							/>
							<div className="mt-2 grid gap-1.5 sm:grid-cols-[78px_minmax(0,1fr)] sm:items-center">
								<span className="text-[11px] font-semibold text-muted-foreground">
									Model
								</span>
								<select
									className="ocm-input h-9 w-full px-3 text-sm"
									value={retrievalModelId}
									onChange={(event) => setRetrievalModelId(event.target.value)}
									disabled={retrievalModelOptions.length === 0 || queryLoading}
								>
									{retrievalModelOptions.length === 0 ? (
										<option value="">Default model aktif</option>
									) : (
										retrievalModelOptions.map((model) => (
											<option key={model.id} value={model.id}>
												{model.label}
											</option>
										))
									)}
								</select>
							</div>
							<div className="mt-2 flex items-center gap-1.5">
								<span className="ocm-tag">top_k 5</span>
								<span className="ocm-tag">hybrid · bm25+vec</span>
								{retrievalModelId ? (
									<span className="ocm-tag max-w-[180px] truncate">
										{retrievalModelId}
									</span>
								) : null}
								<div className="flex-1" />
								<button
									type="button"
									className="ocm-btn ocm-btn-primary h-8 px-3 text-xs"
									onClick={runQuery}
									disabled={queryLoading}
								>
									<Search size={12} />
									{queryLoading ? 'Querying...' : 'Query'}
								</button>
							</div>
						</div>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto p-3">
						<p className="mb-2 font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
							{hasQueried
								? `Top 5 Chunks · ${queryMeta.latencyMs}ms`
								: 'Query results'}
						</p>

						<div className="space-y-2">
							{retrievalChunks.slice(0, 5).map((chunk, index) => {
								const hue = Math.round(chunk.score * 120)
								return (
									<div
										key={`${chunk.source}-${index}`}
										className="rounded-lg border border-border bg-muted/25 p-2.5"
									>
										<div className="mb-1.5 flex items-center gap-1.5">
											<span
												className="rounded px-1.5 py-0.5 font-mono text-[10px]"
												style={{
													background: `hsl(${hue} 45% 18%)`,
													color: `hsl(${hue} 80% 70%)`,
												}}
											>
												{chunk.score.toFixed(3)}
											</span>
											<p className="min-w-0 flex-1 truncate text-[11px] font-semibold text-foreground">
												{chunk.source}
											</p>
											<span className="font-mono text-[10px] text-muted-foreground">
												{chunk.locator}
											</span>
										</div>
										<p className="text-xs leading-relaxed text-muted-foreground">
											{highlightSnippet(chunk.snippet)}
										</p>
									</div>
								)
							})}
							{retrievalChunks.length === 0 ? (
								<div className="rounded-lg border border-dashed border-border p-3 text-xs text-muted-foreground">
									Belum ada chunk untuk ditampilkan. Pilih source knowledge lalu
									jalankan query.
								</div>
							) : null}
						</div>

						<div className="mt-3 rounded-lg border border-primary/30 bg-primary/10 p-3">
							<p className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.1em] text-primary">
								<Sparkles size={11} />
								AI Synthesized Answer
							</p>
							<p className="text-sm leading-relaxed">{answer}</p>
							<p className="mt-2 font-mono text-[10px] text-muted-foreground">
								Grounded in {queryMeta.groundedSources} sources ·{' '}
								{queryMeta.tokens} tokens · {queryMeta.cost}
							</p>
						</div>
					</div>
				</section>
			</div>
		</main>
	)
}

function StatTile({
	label,
	value,
	delta,
}: {
	label: string
	value: string
	delta: string
}) {
	return (
		<div className="ocm-card p-3">
			<p className="text-[11px] text-muted-foreground">{label}</p>
			<div className="mt-1 flex items-baseline gap-1.5">
				<p className="font-mono text-lg font-semibold text-foreground">
					{value}
				</p>
				<p className="font-mono text-[10px] text-emerald-500">{delta}</p>
			</div>
		</div>
	)
}
