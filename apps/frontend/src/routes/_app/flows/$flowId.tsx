import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	BadgeCheck,
	BookOpenText,
	BrainCircuit,
	Check,
	Clock3,
	Eye,
	FileText,
	Filter,
	Globe,
	Handshake,
	Link2,
	Megaphone,
	MessageCircle,
	Play,
	Plus,
	RefreshCw,
	Send,
	Settings2,
	ShieldAlert,
	Smile,
	Sparkles,
	Tag,
	Workflow,
	X,
	type LucideIcon,
} from 'lucide-react'
import {
	useEffect,
	useMemo,
	useRef,
	useState,
	type CSSProperties,
	type MouseEvent as ReactMouseEvent,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from 'react'
import { toast } from 'sonner'
import {
	CrmSectionHeader,
	unwrapPayload,
} from '@/components/crm/shared'
import { ai, automationFlows, inboxes, knowledge } from '@/lib/api'
import { randomId } from '@/lib/id'

export const Route = createFileRoute('/_app/flows/$flowId')({
	component: WorkflowPage,
	validateSearch: (search: Record<string, unknown>) => ({
		execution_id:
			typeof search.execution_id === 'string' ? search.execution_id : undefined,
	}),
})

type WorkflowSummary = {
	id: string
	name: string
	status: 'active' | 'draft'
	lastRun: string
}

type FlowApiItem = {
	id?: string | number
	name?: string
	title?: string
	description?: string | null
	nodes?: unknown
	edges?: unknown
	active?: boolean | null
	is_active?: boolean
	updated_at?: string | null
}

type FlowExecutionApiItem = {
	id?: string | number
	conversation_id?: string | null
	node_id?: string | null
	event?: string | null
	status?: string | null
	preview?: string | null
	content_type?: string | null
	sender_type?: string | null
	execution_id?: string | null
	path?: unknown
	node_type?: string | null
	input?: unknown
	output?: unknown
	variables_delta?: unknown
	branch?: unknown
	error?: string | null
	created_at?: string | Date | null
}

type FlowVersionApiItem = {
	id?: string | number
	flow_id?: string
	label?: string
	status?: 'current' | 'archived' | string
	summary?: string
	saved_at?: string | Date | null
	nodes_count?: number
	edges_count?: number
	is_active?: boolean
}

type KnowledgeSourceApiItem = {
	id?: string | number
	name?: string
	title?: string
	status?: string
	type?: string
	format?: string
	source_type?: string
	sourceType?: string
	source_url?: string
	sourceUrl?: string
	file_name?: string
	fileName?: string
}

type InboxApiItem = {
	id?: string | number
	name?: string
	channel_type?: string | null
}

type InboxOption = {
	id: string
	name: string
	channelType: string
}

type FlowExecutionRow = {
	id: string
	conversationId: string
	nodeId: string
	event: string
	status: string
	preview: string
	contentType: string
	senderType: string
	executionId: string
	nodeType: string
	path: string[]
	input: Record<string, unknown>
	output: Record<string, unknown>
	variablesDelta: Record<string, unknown>
	branch: Record<string, unknown>
	error: string
	createdAt: string
}

type WhatsAppHistoryRole = 'user' | 'assistant'

type WhatsAppHistoryMessage = {
	role: WhatsAppHistoryRole
	content: string
}

type WhatsAppTestRunInput = {
	path: string[]
	context: {
		message_: string
		recent_history_message: WhatsAppHistoryMessage[]
	}
}

type FlowSavedVersionRow = {
	id: string
	label: string
	status: 'current' | 'archived'
	summary: string
	savedAt: string
	nodesCount: number
	edgesCount: number
	isActive: boolean
}

type NodeTone = 'green' | 'amber' | 'violet' | 'blue' | 'rose'
type NodeKind = 'trigger' | 'ai' | 'logic' | 'rag' | 'action'
type NodeGlyph =
	| 'wa'
	| 'clock'
	| 'globe'
	| 'sparkle'
	| 'brain'
	| 'emoji'
	| 'book'
	| 'doc'
	| 'workflow'
	| 'filter'
	| 'refresh'
	| 'shield'
	| 'handover'
	| 'send'
	| 'link'
	| 'tag'
	| 'broadcast'

type WorkflowNode = {
	id: string
	type: NodeKind
	label: string
	sub: string
	x: number
	y: number
	icon: NodeGlyph
	tone: NodeTone
	stats?: {
		left: string
		right: string
	}
}

type NodeDragState = {
	anchorNodeId: string
	nodeIds: string[]
	pointerId: number
	startClientX: number
	startClientY: number
	originByNodeId: Record<string, { x: number; y: number }>
	moved: boolean
}

type MarqueeSelectionState = {
	pointerId: number
	startX: number
	startY: number
	currentX: number
	currentY: number
}

type SelectionRect = {
	left: number
	top: number
	width: number
	height: number
}

type NodeSettingKind =
	| 'wa_message_in'
	| 'schedule_trigger'
	| 'webhook_trigger'
	| 'llm_call'
	| 'intent_classifier'
	| 'sentiment'
	| 'rag_retrieve'
	| 'summarize_chat'
	| 'switch_router'
	| 'if_else'
	| 'wait'
	| 'send_wa_reply'
	| 'handover_cs'
	| 'update_contact'
	| 'trigger_campaign'
	| 'http_request'
	| 'ab_test_splitter'
	| 'generic'

type NodeConfig = {
	inboxId?: string
	ragSourceId?: string
	scheduleCron?: string
	scheduleTimezone?: string
	webhookMethod?: 'GET' | 'POST'
	webhookUrl?: string
	llmModel?: string
	intentModel?: string
	sentimentModel?: string
	ragModel?: string
	summarizeModel?: string
	llmTemperature?: number
	llmPrompt?: string
	llmOutputVar?: string
	intentLabels?: string
	intentOutputVar?: string
	intentConfidenceThreshold?: number
	sentimentMode?: 'label' | 'score'
	sentimentThreshold?: number
	sentimentOutputVar?: string
	ragTopK?: number
	ragQueryVariable?: string
	summarizeWindow?: number
	summarizeOutputVar?: string
	switchVariable?: string
	switchCases?: string
	switchDefaultRoute?: string
	ifCondition?: string
	waitValue?: number
	waitUnit?: 'seconds' | 'minutes' | 'hours'
	waReplyTemplate?: string
	handoverQueueId?: string
	handoverMessage?: string
	handoverEnableLowConfidence?: boolean
	handoverConfidenceThreshold?: number
	handoverEnableKeyword?: boolean
	handoverKeywords?: string
	handoverEnableNegativeSentiment?: boolean
	handoverEnableEscalationRequest?: boolean
	updateField?: string
	updateValueTemplate?: string
	campaignId?: string
	campaignMode?: 'once' | 'recurring'
	httpRequestUrl?: string
	httpRequestMethod?: 'GET' | 'POST' | 'PUT' | 'DELETE'
	httpRequestHeaders?: string
	httpRequestBody?: string
	httpRequestOutputVar?: string
	abTestVariantA?: string
	abTestVariantB?: string
}

type PaletteItem = {
	type: NodeKind
	icon: NodeGlyph
	tone: NodeTone
	label: string
	sub: string
	stats?: {
		left: string
		right: string
	}
}

type PaletteGroup = {
	title: string
	items: PaletteItem[]
}

type RagSourceOption = {
	id: string
	name: string
	status: string
	kind: 'Text' | 'Website' | 'File'
}

type SwitchRouteTarget = string

type AiProviderModelOption = {
	id: string
	name: string
	vendor: string
	contextWindow: string
	maxOutput: string
}

const EMPTY_EXECUTION_ROWS: FlowExecutionRow[] = []
const EMPTY_SAVED_VERSION_ROWS: FlowSavedVersionRow[] = []

const PALETTE_GROUPS: PaletteGroup[] = [
	{
		title: 'Triggers',
		items: [
			{
				type: 'trigger',
				icon: 'wa',
				tone: 'green',
				label: 'WA Message In',
				sub: 'Meta Cloud API · semua nomor',
			},
			{
				type: 'trigger',
				icon: 'clock',
				tone: 'violet',
				label: 'Schedule',
				sub: 'Cron schedule otomatis',
			},
			{
				type: 'trigger',
				icon: 'globe',
				tone: 'blue',
				label: 'Webhook',
				sub: 'Incoming event API eksternal',
			},
		],
	},
	{
		title: 'AI',
		items: [
			{
				type: 'ai',
				icon: 'sparkle',
				tone: 'amber',
				label: 'LLM Call',
				sub: 'Prompt custom ke model',
			},
			{
				type: 'ai',
				icon: 'brain',
				tone: 'amber',
				label: 'Intent Classifier',
				sub: 'Klasifikasi intent customer',
			},
			{
				type: 'ai',
				icon: 'emoji',
				tone: 'amber',
				label: 'Sentiment',
				sub: 'Deteksi sentimen chat',
			},
			{
				type: 'rag',
				icon: 'book',
				tone: 'blue',
				label: 'RAG Retrieve',
				sub: 'Ambil konteks knowledge base',
			},
			{
				type: 'ai',
				icon: 'doc',
				tone: 'blue',
				label: 'Summarize Chat',
				sub: 'Ringkas percakapan',
			},
		],
	},
	{
		title: 'Logic',
		items: [
			{
				type: 'logic',
				icon: 'workflow',
				tone: 'violet',
				label: 'Switch / Router',
				sub: 'Routing ke banyak cabang',
			},
			{
				type: 'logic',
				icon: 'filter',
				tone: 'violet',
				label: 'If / Else',
				sub: 'Kondisi true / false',
			},
			{
				type: 'logic',
				icon: 'clock',
				tone: 'violet',
				label: 'Wait',
				sub: 'Tunda proses sebelum lanjut',
			},
			{
				type: 'logic',
				icon: 'refresh',
				tone: 'violet',
				label: 'A/B Test',
				sub: 'Split rute secara acak 50/50',
			},
		],
	},
	{
		title: 'Actions',
		items: [
			{
				type: 'action',
				icon: 'send',
				tone: 'green',
				label: 'Send WA Reply',
				sub: 'Kirim balasan ke WhatsApp customer',
			},
			{
				type: 'action',
				icon: 'handover',
				tone: 'rose',
				label: 'Handover CS',
				sub: 'Alihkan percakapan ke agent',
			},


			{
				type: 'action',
				icon: 'broadcast',
				tone: 'blue',
				label: 'HTTP Request',
				sub: 'Tarik / kirim API eksternal',
			},
			{
				type: 'action',
				icon: 'tag',
				tone: 'blue',
				label: 'Update Contact',
				sub: 'Perbarui atribut pelanggan',
			},
			{
				type: 'action',
				icon: 'broadcast',
				tone: 'violet',
				label: 'Trigger Campaign',
				sub: 'Jalankan campaign outbound',
			},
		],
	},

]

const RAG_ALL_SOURCES_LABEL = 'All Text, Website & File sources'
const RAG_FILE_FORMATS = new Set([
	'audio',
	'csv',
	'doc',
	'docx',
	'file',
	'img',
	'image',
	'json',
	'pdf',
	'photo',
	'sheet',
	'txt',
	'voice',
	'xls',
	'xlsx',
])

const WORKFLOW_TABS = [
	{ id: 'editor', label: 'Editor' },
	{ id: 'executions', label: 'Executions' },
	{ id: 'versions', label: 'Versi' },
] as const

type WorkflowTab = (typeof WORKFLOW_TABS)[number]['id']

function extractAiSettingsPayload(response: unknown): Record<string, unknown> {
	const wrapped = response as { data?: unknown }
	return toRecord(wrapped?.data || response)
}

function extractAiProviderModels(value: unknown): AiProviderModelOption[] {
	if (!Array.isArray(value)) return []

	return value
		.map((item) => toRecord(item))
		.map((record) => {
			const id = toTrimmedString(record.id)
			if (!id) return null
			return {
				id,
				name: toTrimmedString(record.name) || id,
				vendor: toTrimmedString(record.vendor) || '-',
				contextWindow: toTrimmedString(record.context_window) || '-',
				maxOutput: toTrimmedString(record.max_output) || '-',
			}
		})
		.filter((item): item is AiProviderModelOption => Boolean(item))
}

function withSelectedModelOption(
	options: AiProviderModelOption[],
	selectedModel: string | undefined,
): AiProviderModelOption[] {
	const modelId = toTrimmedString(selectedModel)
	if (!modelId) return options
	if (options.some((option) => option.id === modelId)) return options
	return [
		{
			id: modelId,
			name: modelId,
			vendor: 'custom',
			contextWindow: '-',
			maxOutput: '-',
		},
		...options,
	]
}

function formatModelOptionLabel(model: AiProviderModelOption): string {
	const vendor = model.vendor ? `${model.vendor} · ` : ''
	const context =
		model.contextWindow && model.contextWindow !== '-'
			? ` · ctx ${model.contextWindow}`
			: ''
	return `${vendor}${model.name} (${model.id})${context}`
}

const DEFAULT_SWITCH_ROUTE_TARGET: SwitchRouteTarget = 'workflow'

function normalizeIntentToken(value: string) {
	return value.trim().toLowerCase().replace(/\s+/g, '_')
}

function parseIntentLabelList(input: string) {
	const seen = new Set<string>()
	return input
		.split(',')
		.map((label) => label.trim())
		.filter(Boolean)
		.filter((label) => {
			const key = normalizeIntentToken(label)
			if (!key || seen.has(key)) return false
			seen.add(key)
			return true
		})
}

function normalizeSwitchRouteTarget(value: string): SwitchRouteTarget {
	const normalized = value.trim().toLowerCase()
	return normalized || DEFAULT_SWITCH_ROUTE_TARGET
}

function parseSwitchCases(input: string) {
	const map = new Map<string, SwitchRouteTarget>()
	let defaultRoute: SwitchRouteTarget = DEFAULT_SWITCH_ROUTE_TARGET
	const lines = input
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)

	for (const line of lines) {
		const [leftRaw, rightRaw] = line.split('->').map((part) => part.trim())
		if (!leftRaw || !rightRaw) continue
		const key = normalizeIntentToken(leftRaw)
		const route = normalizeSwitchRouteTarget(rightRaw)
		if (key === 'default') {
			defaultRoute = route
			continue
		}
		map.set(key, route)
	}

	return { map, defaultRoute }
}

function stringifySwitchCases(
	intents: string[],
	routeMap: Map<string, SwitchRouteTarget>,
	defaultRoute: SwitchRouteTarget,
) {
	const lines = intents.map((intent) => {
		const key = normalizeIntentToken(intent)
		const route = routeMap.get(key) || normalizeSwitchRouteTarget(defaultRoute)
		return `${key} -> ${route}`
	})
	lines.push(`default -> ${defaultRoute}`)
	return lines.join('\n')
}

function summarizeSwitchRouting(
	map: Map<string, SwitchRouteTarget>,
	defaultRoute: SwitchRouteTarget,
) {
	const total = map.size
	return `${total} route · default -> ${normalizeSwitchRouteTarget(defaultRoute)}`
}

const GLYPH_ICON: Record<NodeGlyph, LucideIcon> = {
	wa: MessageCircle,
	clock: Clock3,
	globe: Globe,
	sparkle: Sparkles,
	brain: BrainCircuit,
	emoji: Smile,
	book: BookOpenText,
	doc: FileText,
	workflow: Workflow,
	filter: Filter,
	refresh: RefreshCw,
	shield: ShieldAlert,
	handover: Handshake,
	send: Send,
	link: Link2,
	tag: Tag,
	broadcast: Megaphone,
}

const NODE_WIDTH = 220
const NODE_HEIGHT = 84
const CANVAS_WIDTH = 1600
const CANVAS_HEIGHT = 700
const CANVAS_PADDING = 20
const CANVAS_TOP_RESERVED = 120
const NODE_GAP_X = 280
const NODE_GAP_Y = 34
const DRAG_CLICK_THRESHOLD_PX = 4

function clampNodeX(value: number) {
	return Math.max(
		CANVAS_PADDING,
		Math.min(CANVAS_WIDTH - NODE_WIDTH - CANVAS_PADDING, Math.round(value)),
	)
}

function clampNodeY(value: number) {
	return Math.max(
		CANVAS_PADDING,
		Math.min(CANVAS_HEIGHT - NODE_HEIGHT - CANVAS_PADDING, Math.round(value)),
	)
}

function toneColor(tone: NodeTone) {
	switch (tone) {
		case 'green':
			return 'var(--ocm-success)'
		case 'amber':
			return 'var(--ocm-warning)'
		case 'violet':
			return '#8b5cf6'
		case 'blue':
			return '#3b82f6'
		case 'rose':
			return 'var(--ocm-danger)'
		default:
			return 'var(--ocm-success)'
	}
}

function toneChipStyle(tone: NodeTone): CSSProperties {
	const color = toneColor(tone)
	return {
		color,
		background: `color-mix(in oklab, ${color} 16%, transparent)`,
		borderColor: `color-mix(in oklab, ${color} 34%, transparent)`,
	}
}

function nodeRect(node: WorkflowNode) {
	return { x: node.x, y: node.y, w: NODE_WIDTH, h: NODE_HEIGHT }
}

function normalizeSelectionRect(
	startX: number,
	startY: number,
	endX: number,
	endY: number,
): SelectionRect {
	const left = Math.min(startX, endX)
	const top = Math.min(startY, endY)
	const width = Math.abs(endX - startX)
	const height = Math.abs(endY - startY)
	return { left, top, width, height }
}

function rectIntersectsNode(rect: SelectionRect, node: WorkflowNode) {
	const nodeLeft = node.x
	const nodeTop = node.y
	const nodeRight = node.x + NODE_WIDTH
	const nodeBottom = node.y + NODE_HEIGHT
	const rectRight = rect.left + rect.width
	const rectBottom = rect.top + rect.height
	return (
		rect.left < nodeRight &&
		rectRight > nodeLeft &&
		rect.top < nodeBottom &&
		rectBottom > nodeTop
	)
}

function edgePath(from: WorkflowNode, to: WorkflowNode) {
	const left = nodeRect(from)
	const right = nodeRect(to)
	const x1 = left.x + left.w
	const y1 = left.y + left.h / 2
	const x2 = right.x
	const y2 = right.y + right.h / 2
	const mid = (x1 + x2) / 2
	return `M${x1} ${y1} C${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`
}

function defaultLayerForNode(node: WorkflowNode) {
	switch (node.type) {
		case 'trigger':
			return 0
		case 'ai':
		case 'rag':
			return 1
		case 'logic':
			return 2
		default:
			return 3
	}
}

function autoArrangeWorkflowNodes(
	nodes: WorkflowNode[],
	edges: Array<[string, string]>,
) {
	if (nodes.length <= 1) return nodes

	const nodeIds = new Set(nodes.map((node) => node.id))
	const indegree = new Map<string, number>()
	const adjacency = new Map<string, string[]>()
	for (const node of nodes) {
		indegree.set(node.id, 0)
		adjacency.set(node.id, [])
	}

	for (const [fromId, toId] of edges) {
		if (!nodeIds.has(fromId) || !nodeIds.has(toId)) continue
		adjacency.get(fromId)?.push(toId)
		indegree.set(toId, (indegree.get(toId) || 0) + 1)
	}

	const laneByNodeId = new Map<string, number>()
	const queue = nodes
		.filter((node) => (indegree.get(node.id) || 0) === 0)
		.sort(
			(a, b) =>
				defaultLayerForNode(a) - defaultLayerForNode(b) ||
				a.y - b.y ||
				a.x - b.x,
		)
		.map((node) => node.id)

	for (const nodeId of queue) {
		laneByNodeId.set(nodeId, 0)
	}

	for (let index = 0; index < queue.length; index += 1) {
		const nodeId = queue[index]
		const lane = laneByNodeId.get(nodeId) || 0
		for (const nextId of adjacency.get(nodeId) || []) {
			const nextLane = lane + 1
			if ((laneByNodeId.get(nextId) ?? -1) < nextLane) {
				laneByNodeId.set(nextId, nextLane)
			}
			indegree.set(nextId, (indegree.get(nextId) || 0) - 1)
			if ((indegree.get(nextId) || 0) === 0) {
				queue.push(nextId)
			}
		}
	}

	for (const node of nodes) {
		if (!laneByNodeId.has(node.id)) {
			laneByNodeId.set(node.id, defaultLayerForNode(node))
		}
	}

	const nodesByLane = new Map<number, WorkflowNode[]>()
	for (const node of nodes) {
		const lane = laneByNodeId.get(node.id) || 0
		if (!nodesByLane.has(lane)) nodesByLane.set(lane, [])
		nodesByLane.get(lane)?.push(node)
	}

	const nodeTypeRank: Record<NodeKind, number> = {
		trigger: 0,
		ai: 1,
		rag: 2,
		logic: 3,
		action: 4,
	}
	const arrangedByNodeId = new Map<string, WorkflowNode>()
	const sortedLanes = Array.from(nodesByLane.keys()).sort((a, b) => a - b)

	for (const lane of sortedLanes) {
		const laneNodes = nodesByLane.get(lane) || []
		laneNodes.sort(
			(a, b) =>
				nodeTypeRank[a.type] - nodeTypeRank[b.type] || a.y - b.y || a.x - b.x,
		)
		const maxStep = NODE_HEIGHT + NODE_GAP_Y
		const availableSpan =
			CANVAS_HEIGHT - CANVAS_TOP_RESERVED - CANVAS_PADDING - NODE_HEIGHT
		const laneStep =
			laneNodes.length <= 1
				? 0
				: Math.max(
						24,
						Math.min(
							maxStep,
							availableSpan / Math.max(1, laneNodes.length - 1),
						),
					)
		const laneHeight =
			NODE_HEIGHT + laneStep * Math.max(0, laneNodes.length - 1)
		const centeredStartY =
			CANVAS_TOP_RESERVED +
			Math.max(0, (availableSpan + NODE_HEIGHT - laneHeight) / 2)
		const startY = Math.max(CANVAS_TOP_RESERVED, centeredStartY)

		laneNodes.forEach((node, index) => {
			arrangedByNodeId.set(node.id, {
				...node,
				x: clampNodeX(CANVAS_PADDING + lane * NODE_GAP_X),
				y: clampNodeY(startY + index * laneStep),
			})
		})
	}

	return nodes.map((node) => arrangedByNodeId.get(node.id) || node)
}

function cloneNode(node: WorkflowNode): WorkflowNode {
	return {
		...node,
		stats: node.stats ? { ...node.stats } : undefined,
	}
}

function formatRagNodeSub(sourceName: string, currentSub?: string) {
	const topK = currentSub?.match(/top_k\s*=\s*(\d+)/i)?.[1] || '5'
	return `${sourceName} · top_k=${topK}`
}

function getRagSourceKind(
	row: KnowledgeSourceApiItem,
): RagSourceOption['kind'] {
	const sourceType = String(row.source_type || row.sourceType || '')
		.trim()
		.toLowerCase()
	const format = String(row.format || row.type || '')
		.trim()
		.toLowerCase()
	if (
		sourceType === 'file' ||
		Boolean(row.file_name || row.fileName) ||
		RAG_FILE_FORMATS.has(format)
	) {
		return 'File'
	}
	if (
		sourceType === 'url' ||
		sourceType === 'website' ||
		format === 'website' ||
		format === 'url' ||
		format === 'site' ||
		Boolean(row.source_url || row.sourceUrl)
	) {
		return 'Website'
	}
	return 'Text'
}

function formatRagSourceOptionLabel(source: RagSourceOption) {
	const status =
		source.status.toLowerCase() === 'ready' ? '' : ` (${source.status})`
	return `${source.name} · ${source.kind}${status}`
}

function nextNodePosition(item: PaletteItem, existingNodes: WorkflowNode[]) {
	const typeCount = existingNodes.filter(
		(node) => node.type === item.type,
	).length
	if (item.type === 'trigger') {
		return {
			x: 40,
			y: 90 + typeCount * 120,
		}
	}

	const maxX = existingNodes.reduce(
		(current, node) => Math.max(current, node.x),
		40,
	)
	const baseX = Math.min(maxX + 260, CANVAS_WIDTH - NODE_WIDTH - 30)

	let baseY = 160
	if (item.type === 'ai') baseY = 40
	if (item.type === 'rag') baseY = 40
	if (item.type === 'logic') baseY = 180
	if (item.type === 'action') baseY = 300

	const laneOffset = (typeCount % 3) * 120
	const y = Math.min(baseY + laneOffset, CANVAS_HEIGHT - NODE_HEIGHT - 30)
	return { x: baseX, y }
}

function formatLastRun(input: string | null | undefined) {
	if (!input) return '-'
	const timestamp = new Date(input)
	if (Number.isNaN(timestamp.getTime())) return '-'

	const diff = Date.now() - timestamp.getTime()
	const minute = 60_000
	const hour = 60 * minute
	const day = 24 * hour

	if (diff < minute) return 'baru saja'
	if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`
	if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h ago`
	return `${Math.max(1, Math.floor(diff / day))}d ago`
}

function formatDateTime(input: string | null | undefined) {
	if (!input) return '-'
	const timestamp = new Date(input)
	if (Number.isNaN(timestamp.getTime())) return '-'
	return new Intl.DateTimeFormat('id-ID', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(timestamp)
}

function truncateText(input: string, max = 88) {
	if (input.length <= max) return input
	return `${input.slice(0, max - 1)}…`
}

function formatConfidenceThreshold(value: number) {
	const safe = Number.isFinite(value) ? Math.min(0.99, Math.max(0, value)) : 0.7
	return safe.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

function buildHandoverCriteriaSummary(config: Partial<NodeConfig>) {
	const parts: string[] = []
	if (config.handoverEnableLowConfidence) {
		parts.push(
			`confidence < ${formatConfidenceThreshold(config.handoverConfidenceThreshold || 0.7)}`,
		)
	}
	if (config.handoverEnableKeyword) parts.push('keyword match')
	if (config.handoverEnableNegativeSentiment) parts.push('sentiment negatif')
	if (config.handoverEnableEscalationRequest) parts.push('minta agent')
	if (parts.length === 0) return 'manual trigger'
	return parts.join(' · ')
}

function getNodeSettingKind(
	node: Pick<WorkflowNode, 'type' | 'icon' | 'label'>,
): NodeSettingKind {
	const normalizedLabel = String(node.label || '')
		.trim()
		.toLowerCase()
	if (node.type === 'action') {
		if (normalizedLabel === 'http request') return 'http_request'
		if (normalizedLabel === 'trigger campaign') return 'trigger_campaign'
	}

	const key = `${node.type}:${node.icon}`
	switch (key) {
		case 'trigger:wa':
			return 'wa_message_in'
		case 'trigger:clock':
			return 'schedule_trigger'
		case 'trigger:globe':
			return 'webhook_trigger'
		case 'ai:sparkle':
			return 'llm_call'
		case 'ai:brain':
			return 'intent_classifier'
		case 'ai:emoji':
			return 'sentiment'
		case 'rag:book':
			return 'rag_retrieve'
		case 'ai:doc':
			return 'summarize_chat'
		case 'logic:workflow':
			return 'switch_router'
		case 'logic:filter':
			return 'if_else'
		case 'logic:clock':
			return 'wait'
		case 'action:send':
			return 'send_wa_reply'
		case 'action:handover':
			return 'handover_cs'

		case 'logic:refresh':
			return 'ab_test_splitter'






		case 'action:tag':
			return 'update_contact'
		default:
			return 'generic'
	}
}

function getDefaultNodeConfig(kind: NodeSettingKind): NodeConfig {
	switch (kind) {
		case 'wa_message_in':
			return { inboxId: '' }
		case 'schedule_trigger':
			return { scheduleCron: '0 9 * * *', scheduleTimezone: 'Asia/Jakarta' }
		case 'webhook_trigger':
			return { webhookMethod: 'POST', webhookUrl: '' }
		case 'llm_call':
			return {
				llmModel: '',
				llmTemperature: 35,
				llmPrompt: 'Buat respons yang ringkas, jelas, dan ramah.',
				llmOutputVar: 'reply.text',
			}
		case 'intent_classifier':
			return {
				intentModel: '',
				intentLabels:
					'harga, keluhan, retur, pengiriman, pembayaran, produk, campaign, lainnya',
				intentOutputVar: 'intent.label',
				intentConfidenceThreshold: 70,
			}
		case 'sentiment':
			return {
				sentimentModel: '',
				sentimentMode: 'label',
				sentimentThreshold: 70,
				sentimentOutputVar: 'sentiment.label',
			}
		case 'rag_retrieve':
			return {
				ragModel: '',
				ragTopK: 5,
				ragQueryVariable: 'message.text',
			}
		case 'summarize_chat':
			return {
				summarizeModel: '',
				summarizeWindow: 20,
				summarizeOutputVar: 'summary.text',
			}
		case 'switch_router':
			return {
				switchVariable: 'decision.recommended_action',
				switchCases: 'default -> workflow',
				switchDefaultRoute: DEFAULT_SWITCH_ROUTE_TARGET,
			}
		case 'if_else':
			return {
				ifCondition: "intent.label == 'tanya_stok'",
			}
		case 'wait':
			return { waitValue: 5, waitUnit: 'minutes' }
		case 'send_wa_reply':
			return {
				waReplyTemplate: 'Halo {{contact.name}}, ini update dari kami ya.',
			}
		case 'handover_cs':
			return {
				handoverQueueId: 'cs-queue-default',
				handoverMessage: 'Aku bantu teruskan ke tim CS ya, Kak.',
				handoverEnableLowConfidence: true,
				handoverConfidenceThreshold: 0.7,
				handoverEnableKeyword: true,
				handoverKeywords: 'agent, admin, cs, manusia',
				handoverEnableNegativeSentiment: false,
				handoverEnableEscalationRequest: true,
			}
		case 'update_contact':
			return {
				updateField: 'status_lead',
				updateValueTemplate: 'warm',
			}
		case 'trigger_campaign':
			return {
				campaignId: '',
				campaignMode: 'once',
			}
		case 'http_request':
			return {
				httpRequestMethod: 'GET',
				httpRequestUrl: '',
				httpRequestOutputVar: 'api.response',
			}
		case 'ab_test_splitter':
			return {
				abTestVariantA: 'Variant A',
				abTestVariantB: 'Variant B',
			}
		default:
			return {}
	}
}

const NODE_KIND_VALUES: NodeKind[] = ['trigger', 'ai', 'logic', 'rag', 'action']
const NODE_TONE_VALUES: NodeTone[] = [
	'green',
	'amber',
	'violet',
	'blue',
	'rose',
]
const NODE_GLYPH_VALUES: NodeGlyph[] = [
	'wa',
	'clock',
	'globe',
	'sparkle',
	'brain',
	'emoji',
	'book',
	'doc',
	'workflow',
	'filter',
	'refresh',
	'shield',
	'handover',
	'send',
	'link',
	'tag',
	'broadcast',
]

function toRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>
	}
	return {}
}

function toTrimmedString(value: unknown) {
	if (typeof value !== 'string') return ''
	return value.trim()
}

function toFiniteNumber(value: unknown, fallback: number) {
	const next = Number(value)
	if (!Number.isFinite(next)) return fallback
	return next
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => {
			if (typeof item === 'string') return item.trim()
			return typeof item === 'number'
				? String(item)
				: typeof item === 'boolean'
					? String(item)
					: ''
		})
		.filter(Boolean)
}

function normalizeWhatsAppHistoryRole(
	value: unknown,
): WhatsAppHistoryRole | null {
	const normalized = toTrimmedString(value).toLowerCase()
	if (!normalized) return null
	if (normalized === 'user' || normalized === 'contact') return 'user'
	if (
		normalized === 'assistant' ||
		normalized === 'bot' ||
		normalized === 'agent' ||
		normalized === 'system'
	) {
		return 'assistant'
	}
	return null
}

function normalizeWhatsAppHistory(value: unknown): WhatsAppHistoryMessage[] {
	if (!Array.isArray(value)) return []
	return value
		.map((rawRow) => {
			const row = toRecord(rawRow)
			const role = normalizeWhatsAppHistoryRole(row.role)
			const content = toTrimmedString(row.content)
			if (!role || !content) return null
			return {
				role,
				content,
			}
		})
		.filter((item): item is WhatsAppHistoryMessage => Boolean(item))
}

function extractLatestUserMessageFromHistory(
	history: WhatsAppHistoryMessage[],
): string {
	for (let index = history.length - 1; index >= 0; index -= 1) {
		const item = history[index]
		if (item?.role === 'user' && item.content) {
			return item.content
		}
	}
	return history[history.length - 1]?.content || ''
}

function buildWhatsAppTestRunInput(params: {
	workflowNodes: WorkflowNode[]
	executionStep: FlowExecutionRow | null
}): WhatsAppTestRunInput {
	const stepInput = toRecord(params.executionStep?.input)
	const stepContext = toRecord(stepInput.context)
	const contextHistory = normalizeWhatsAppHistory(
		stepContext.recent_history_message,
	)
	const rootHistory = normalizeWhatsAppHistory(stepInput.recent_history_message)
	const legacyHistory = normalizeWhatsAppHistory(stepInput.recent_history)
	const recentHistoryMessage =
		contextHistory.length > 0
			? contextHistory
			: rootHistory.length > 0
				? rootHistory
				: legacyHistory
	const message =
		toTrimmedString(stepContext.message_) ||
		toTrimmedString(stepContext.incoming_text) ||
		toTrimmedString(stepInput.message_) ||
		extractLatestUserMessageFromHistory(recentHistoryMessage) ||
		recentHistoryMessage[recentHistoryMessage.length - 1]?.content ||
		''
	const normalizedHistory: WhatsAppHistoryMessage[] = message
		? [{ role: 'user' as const, content: message }]
		: []
	const inputPath = toStringArray(stepInput.path)
	const stepPath = params.executionStep?.path || []
	const fallbackTriggerNodeId =
		params.workflowNodes.find(
			(node) => getNodeSettingKind(node) === 'wa_message_in',
		)?.id ||
		params.workflowNodes.find((node) => node.type === 'trigger')?.id ||
		''
	const fallbackPath = fallbackTriggerNodeId ? [fallbackTriggerNodeId] : []
	const path =
		inputPath.length > 0
			? inputPath
			: stepPath.length > 0
				? stepPath
				: fallbackPath

	return {
		path,
		context: {
			message_: message,
			recent_history_message: normalizedHistory,
		},
	}
}

function safeJsonStringify(
	value: unknown,
	options?: { fallback?: string; space?: number; limit?: number },
): string {
	try {
		const json = JSON.stringify(
			value ?? options?.fallback,
			null,
			options?.space || 2,
		)
		if (
			typeof options?.limit === 'number' &&
			options.limit > 0 &&
			json.length > options.limit
		) {
			return `${json.slice(0, options.limit)}…`
		}
		return json
	} catch {
		if (typeof value === 'string') return value
		return options?.fallback || ''
	}
}

type ExecutionPopupTab = 'input' | 'settings' | 'output'

type ExecutionPopupState = {
	nodeId: string
	executionStep: FlowExecutionRow
	popupX: number
	popupY: number
}

function NodeExecutionPopup({
	state,
	node,
	nodeConfig,
	nodeSettingKind,
	flowId,
	onClose,
	onRerunComplete,
}: {
	state: ExecutionPopupState
	node: WorkflowNode | null
	nodeConfig: NodeConfig | null
	nodeSettingKind: NodeSettingKind
	flowId: string
	onClose: () => void
	onRerunComplete?: (result: Record<string, unknown>) => void
}) {
	const [activeTab, setActiveTab] = useState<ExecutionPopupTab>('input')
	const step = state.executionStep
	const [isEditingInput, setIsEditingInput] = useState(false)
	const [editedInputText, setEditedInputText] = useState(() =>
		safeJsonStringify(step.input, { space: 2, limit: 16000, fallback: '{}' }),
	)
	const [inputJsonError, setInputJsonError] = useState('')
	const [isRerunning, setIsRerunning] = useState(false)
	const [rerunResult, setRerunResult] = useState<Record<
		string,
		unknown
	> | null>(null)
	const [rerunError, setRerunError] = useState('')

	const statusColor =
		step.status === 'error' || step.error
			? '#ef4444'
			: step.status === 'success' || step.status === 'completed'
				? '#22c55e'
				: step.status === 'running'
					? '#f59e0b'
					: '#6b7280'

	const statusLabel =
		step.status === 'error' || step.error
			? 'Error'
			: step.status === 'success' || step.status === 'completed'
				? 'Success'
				: step.status === 'running'
					? 'Running'
					: step.status || 'Unknown'

	const tabs: { id: ExecutionPopupTab; label: string }[] = [
		{ id: 'input', label: 'Input' },
		{ id: 'settings', label: 'Settings' },
		{ id: 'output', label: rerunResult ? '✦ Output' : 'Output' },
	]

	const formatConfigForDisplay = (): Record<string, unknown> => {
		if (!nodeConfig) return {}
		const display: Record<string, unknown> = {}
		for (const [key, value] of Object.entries(nodeConfig)) {
			if (value !== undefined && value !== null && value !== '') {
				display[key] = value
			}
		}
		return display
	}

	const handleToggleEdit = () => {
		if (!isEditingInput) {
			setEditedInputText(
				safeJsonStringify(step.input, {
					space: 2,
					limit: 16000,
					fallback: '{}',
				}),
			)
			setInputJsonError('')
		}
		setIsEditingInput(!isEditingInput)
	}

	const handleRerun = async () => {
		// Validate JSON
		let parsedInput: Record<string, unknown>
		try {
			parsedInput = JSON.parse(editedInputText)
			if (
				typeof parsedInput !== 'object' ||
				parsedInput === null ||
				Array.isArray(parsedInput)
			) {
				setInputJsonError('Input harus berupa JSON object {}')
				return
			}
		} catch {
			setInputJsonError('JSON tidak valid. Periksa format input.')
			return
		}

		setInputJsonError('')
		setIsRerunning(true)
		setRerunError('')
		setRerunResult(null)

		try {
			const response = await automationFlows.debugNode(
				flowId,
				step.nodeId,
				parsedInput,
			)
			if (response.success && response.payload) {
				const payload = response.payload as Record<string, unknown>
				setRerunResult(payload)
				setActiveTab('output')
				onRerunComplete?.(payload)
				toast.success('Node berhasil di-re-run dengan input baru.')
			} else {
				setRerunError('Re-run gagal. Coba lagi.')
			}
		} catch (err) {
			setRerunError(
				err instanceof Error ? err.message : 'Re-run gagal. Coba lagi.',
			)
		} finally {
			setIsRerunning(false)
		}
	}

	return (
		<div
			className="absolute z-[100]"
			style={{
				left: state.popupX,
				top: state.popupY,
			}}
			onClick={(e) => e.stopPropagation()}
			onPointerDown={(e) => e.stopPropagation()}
		>
			<div
				className="w-[440px] rounded-2xl border border-border bg-card shadow-2xl overflow-hidden"
				style={{
					animation: 'fadeInPopup 0.2s ease-out',
				}}
			>
				{/* Header */}
				<div
					className="flex items-center gap-2.5 px-4 py-3 text-white"
					style={{
						background: `linear-gradient(135deg, ${statusColor}e6, ${statusColor}cc)`,
					}}
				>
					<div className="flex items-center gap-2 flex-1 min-w-0">
						{node ? (
							<span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg border border-white/30 bg-white/15">
								<NodeGlyphIcon name={node.icon} size={14} />
							</span>
						) : null}
						<div className="min-w-0">
							<p className="text-sm font-bold truncate">
								{node?.label || step.nodeId}
							</p>
							<p className="text-[10px] text-white/75">
								{step.nodeType} · {formatDateTime(step.createdAt)}
							</p>
						</div>
					</div>
					<span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wide backdrop-blur">
						<span
							className="h-2 w-2 rounded-full"
							style={{ background: 'white' }}
						/>
						{statusLabel}
					</span>
					<button
						type="button"
						className="ml-1 grid h-6 w-6 place-items-center rounded-md text-white/70 hover:bg-white/20 hover:text-white transition"
						onClick={onClose}
					>
						<X size={14} />
					</button>
				</div>

				{/* Error banner */}
				{step.error ? (
					<div className="border-b border-red-200 bg-red-50 px-4 py-2 text-xs text-red-700">
						<p className="font-bold">Error</p>
						<p className="mt-0.5 break-words line-clamp-3">{step.error}</p>
					</div>
				) : null}

				{/* Tabs */}
				<div className="flex border-b border-border">
					{tabs.map((tab) => (
						<button
							key={tab.id}
							type="button"
							onClick={() => setActiveTab(tab.id)}
							className={`flex-1 px-4 py-2.5 text-xs font-semibold transition-all relative ${
								activeTab === tab.id
									? 'text-foreground'
									: 'text-muted-foreground hover:text-foreground/80'
							}`}
						>
							{tab.label}
							{activeTab === tab.id ? (
								<span
									className="absolute bottom-0 left-2 right-2 h-[2px] rounded-full"
									style={{ background: statusColor }}
								/>
							) : null}
						</button>
					))}
				</div>

				{/* Tab Content */}
				<div className="max-h-[380px] overflow-auto p-4">
					{activeTab === 'input' ? (
						<div className="space-y-3">
							{step.path.length > 0 ? (
								<div>
									<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
										Execution Path
									</p>
									<div className="flex flex-wrap gap-1">
										{step.path.map((nodeId, idx) => (
											<span
												key={idx}
												className="inline-flex items-center gap-1 rounded-md border border-border bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
											>
												<span className="text-[9px] text-muted-foreground/60">
													#{idx + 1}
												</span>
												{nodeId}
											</span>
										))}
									</div>
								</div>
							) : null}
							<div>
								<div className="flex items-center justify-between mb-1.5">
									<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
										Input Data
									</p>
									<button
										type="button"
										onClick={handleToggleEdit}
										className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold transition ${
											isEditingInput
												? 'border-amber-300 bg-amber-50 text-amber-700 hover:bg-amber-100'
												: 'border-border bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground'
										}`}
									>
										{isEditingInput ? '✎ Editing' : '✎ Edit'}
									</button>
								</div>
								{isEditingInput ? (
									<>
										<textarea
											className="w-full min-h-[160px] max-h-[240px] resize-y rounded-lg border border-amber-300 bg-amber-50/30 p-3 text-[11px] font-mono text-foreground leading-relaxed focus:outline-none focus:ring-2 focus:ring-amber-400/50"
											value={editedInputText}
											onChange={(e) => {
												setEditedInputText(e.target.value)
												setInputJsonError('')
											}}
											spellCheck={false}
										/>
										{inputJsonError ? (
											<p className="mt-1 text-[10px] font-medium text-red-500">
												⚠ {inputJsonError}
											</p>
										) : null}
										{rerunError ? (
											<p className="mt-1 text-[10px] font-medium text-red-500">
												⚠ {rerunError}
											</p>
										) : null}
										<button
											type="button"
											disabled={isRerunning}
											onClick={handleRerun}
											className="mt-2 flex w-full items-center justify-center gap-2 rounded-lg border border-emerald-400 bg-emerald-500 px-4 py-2 text-xs font-bold text-white shadow-sm transition hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
										>
											{isRerunning ? (
												<>
													<RefreshCw size={13} className="animate-spin" />
													Re-running...
												</>
											) : (
												<>
													<Play size={13} />
													Re-run Node with Adjusted Input
												</>
											)}
										</button>
									</>
								) : (
									<pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
										{safeJsonStringify(step.input, {
											space: 2,
											limit: 8000,
											fallback: '{}',
										})}
									</pre>
								)}
							</div>
						</div>
					) : activeTab === 'settings' ? (
						<div className="space-y-3">
							<div>
								<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
									Node Type
								</p>
								<span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/50 px-2 py-1 text-xs font-medium text-foreground">
									{nodeSettingKind.replace(/_/g, ' ')}
								</span>
							</div>
							{nodeConfig ? (
								<div>
									<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
										Configuration
									</p>
									<pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
										{safeJsonStringify(formatConfigForDisplay(), {
											space: 2,
											limit: 8000,
											fallback: '{}',
										})}
									</pre>
								</div>
							) : (
								<div className="rounded-lg border border-dashed border-border p-4 text-center">
									<p className="text-xs text-muted-foreground">
										Node belum dikonfigurasi.
									</p>
								</div>
							)}
							{Object.keys(step.variablesDelta).length > 0 ? (
								<div>
									<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
										Variables Delta
									</p>
									<pre className="max-h-36 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
										{safeJsonStringify(step.variablesDelta, {
											space: 2,
											limit: 6000,
											fallback: '{}',
										})}
									</pre>
								</div>
							) : null}
						</div>
					) : (
						<div className="space-y-3">
							{/* Re-run result banner */}
							{rerunResult ? (
								<div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
									<div className="flex items-center gap-2 mb-2">
										<span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-bold text-emerald-700 uppercase">
											<Play size={10} />
											Re-run Result
										</span>
										<span className="text-[10px] text-muted-foreground">
											{(rerunResult as Record<string, unknown>).ran_at
												? formatDateTime(
														String(
															(rerunResult as Record<string, unknown>).ran_at,
														),
													)
												: 'just now'}
										</span>
									</div>
									<pre className="max-h-44 overflow-auto rounded-lg border border-emerald-200 bg-white/80 p-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
										{safeJsonStringify(rerunResult, {
											space: 2,
											limit: 8000,
											fallback: '{}',
										})}
									</pre>
								</div>
							) : null}
							<div>
								<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
									{rerunResult ? 'Original Output' : 'Output Data'}
								</p>
								<pre className="max-h-52 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
									{safeJsonStringify(step.output, {
										space: 2,
										limit: 8000,
										fallback: '{}',
									})}
								</pre>
							</div>
							{Object.keys(step.branch).length > 0 ? (
								<div>
									<p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1.5">
										Branch
									</p>
									<pre className="max-h-36 overflow-auto rounded-lg border border-border bg-muted/30 p-3 text-[11px] font-mono text-foreground/80 leading-relaxed">
										{safeJsonStringify(step.branch, {
											space: 2,
											limit: 4000,
											fallback: '{}',
										})}
									</pre>
								</div>
							) : null}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center gap-3 border-t border-border bg-muted/20 px-4 py-2 text-[10px] text-muted-foreground">
					<span>Node: {step.nodeId}</span>
					<span>·</span>
					<span>Execution: {step.executionId.slice(0, 12)}...</span>
					{rerunResult ? (
						<>
							<span>·</span>
							<span className="text-emerald-600 font-semibold">Re-run ✓</span>
						</>
					) : null}
				</div>
			</div>
		</div>
	)
}

function ExecutionViewerBanner({
	executionId,
	executionRows,
	onClose,
}: {
	executionId: string
	executionRows: FlowExecutionRow[]
	onClose: () => void
}) {
	const stepsForExecution = executionRows.filter(
		(row) => row.executionId === executionId,
	)
	const hasError = stepsForExecution.some(
		(row) => row.status === 'error' || row.error,
	)
	const firstStep = stepsForExecution[stepsForExecution.length - 1]

	return (
		<div
			className="absolute left-1/2 top-14 z-[60] -translate-x-1/2 rounded-xl border px-4 py-2.5 shadow-lg backdrop-blur-md"
			style={{
				background: hasError
					? 'color-mix(in oklab, var(--card) 85%, #fecaca 15%)'
					: 'color-mix(in oklab, var(--card) 85%, #bbf7d0 15%)',
				borderColor: hasError
					? 'color-mix(in oklab, var(--border) 60%, #fca5a5 40%)'
					: 'color-mix(in oklab, var(--border) 60%, #86efac 40%)',
			}}
		>
			<div className="flex items-center gap-3">
				<div className="flex items-center gap-2">
					<span
						className="h-2.5 w-2.5 rounded-full animate-pulse"
						style={{
							background: hasError ? '#ef4444' : '#22c55e',
						}}
					/>
					<span className="text-xs font-bold text-foreground">
						Execution Viewer
					</span>
				</div>
				<span className="text-[10px] text-muted-foreground">
					{executionId.slice(0, 16)}...
				</span>
				<span className="rounded-full border border-border bg-muted/60 px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
					{stepsForExecution.length} steps
				</span>
				{firstStep ? (
					<span className="text-[10px] text-muted-foreground">
						{formatDateTime(firstStep.createdAt)}
					</span>
				) : null}
				<span
					className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
						hasError
							? 'bg-red-100 text-red-600'
							: 'bg-emerald-100 text-emerald-600'
					}`}
				>
					{hasError ? 'Error' : 'Success'}
				</span>
				<button
					type="button"
					className="ml-2 grid h-6 w-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition"
					onClick={onClose}
					title="Keluar dari execution viewer"
				>
					<X size={14} />
				</button>
			</div>
		</div>
	)
}

function mapUniqueExecutionRows(
	rows: FlowExecutionRow[],
): Map<string, FlowExecutionRow[]> {
	const groups = new Map<string, FlowExecutionRow[]>()
	for (const row of rows) {
		const key = row.executionId || row.id
		const next = groups.get(key) || []
		next.push(row)
		groups.set(key, next)
	}
	for (const item of groups.values()) {
		item.sort(
			(left, right) =>
				new Date(right.createdAt).getTime() -
				new Date(left.createdAt).getTime(),
		)
	}
	return groups
}

function isNodeKind(value: string): value is NodeKind {
	return NODE_KIND_VALUES.includes(value as NodeKind)
}

function isNodeTone(value: string): value is NodeTone {
	return NODE_TONE_VALUES.includes(value as NodeTone)
}

function isNodeGlyph(value: string): value is NodeGlyph {
	return NODE_GLYPH_VALUES.includes(value as NodeGlyph)
}

function defaultIconForKind(kind: NodeKind): NodeGlyph {
	if (kind === 'trigger') return 'wa'
	if (kind === 'ai') return 'sparkle'
	if (kind === 'logic') return 'workflow'
	if (kind === 'rag') return 'book'
	return 'send'
}

function defaultToneForKind(kind: NodeKind): NodeTone {
	if (kind === 'trigger') return 'green'
	if (kind === 'ai') return 'amber'
	if (kind === 'logic') return 'violet'
	if (kind === 'rag') return 'blue'
	return 'green'
}

function inferNodeKindFromLabel(label: string, fallback: NodeKind): NodeKind {
	const normalized = label.toLowerCase()
	if (normalized.includes('trigger')) return 'trigger'
	if (normalized.includes('schedule')) return 'trigger'
	if (normalized.includes('webhook')) return 'trigger'
	if (normalized.includes('intent')) return 'ai'
	if (normalized.includes('sentiment')) return 'ai'
	if (normalized.includes('llm')) return 'ai'
	if (normalized.includes('summarize')) return 'ai'
	if (normalized.includes('rag')) return 'rag'
	if (normalized.includes('retrieve')) return 'rag'
	if (normalized.includes('switch')) return 'logic'
	if (normalized.includes('router')) return 'logic'
	if (normalized.includes('if')) return 'logic'
	if (normalized.includes('wait')) return 'logic'
	if (normalized.includes('reply')) return 'action'
	if (normalized.includes('handover')) return 'action'
	if (normalized.includes('invoice')) return 'action'
	if (normalized.includes('campaign')) return 'action'
	return fallback
}

function parseFlowNodes(rawNodes: unknown): WorkflowNode[] {
	if (!Array.isArray(rawNodes)) return []

	return rawNodes
		.map((rawNode, index) => {
			const row = toRecord(rawNode)
			const label =
				toTrimmedString(row.label) ||
				toTrimmedString(row.name) ||
				`Node ${index + 1}`
			const rawType = toTrimmedString(row.type).toLowerCase()
			const rawIcon = toTrimmedString(row.icon).toLowerCase()
			const rawTone = toTrimmedString(row.tone).toLowerCase()
			const fallbackKind = isNodeKind(rawType) ? rawType : 'action'
			const type = inferNodeKindFromLabel(label, fallbackKind)
			const icon = isNodeGlyph(rawIcon) ? rawIcon : defaultIconForKind(type)
			const tone = isNodeTone(rawTone) ? rawTone : defaultToneForKind(type)
			const id = toTrimmedString(row.id) || `n-${index + 1}`
			const sub = toTrimmedString(row.sub) || '-'
			const x = clampNodeX(toFiniteNumber(row.x, 40 + index * 80))
			const y = clampNodeY(toFiniteNumber(row.y, 80 + index * 70))

			const statsRow = toRecord(row.stats)
			const statsLeft = toTrimmedString(statsRow.left)
			const statsRight = toTrimmedString(statsRow.right)

			const node: WorkflowNode = {
				id,
				type,
				label,
				sub,
				x,
				y,
				icon,
				tone,
			}
			if (statsLeft || statsRight) {
				node.stats = {
					left: statsLeft || '-',
					right: statsRight || '-',
				}
			}
			return node
		})
		.filter((node) => node.id.length > 0)
}

function parseFlowEdges(
	rawEdges: unknown,
	nodes: WorkflowNode[],
): Array<[string, string]> {
	if (!Array.isArray(rawEdges)) return []
	const nodeIdSet = new Set(nodes.map((node) => node.id))

	return rawEdges
		.map((rawEdge) => {
			if (Array.isArray(rawEdge) && rawEdge.length >= 2) {
				const from = String(rawEdge[0] || '').trim()
				const to = String(rawEdge[1] || '').trim()
				return from && to ? [from, to] : null
			}
			const row = toRecord(rawEdge)
			const from = String(
				row.from ||
					row.source ||
					row.from_id ||
					row.source_id ||
					row.start ||
					'',
			).trim()
			const to = String(
				row.to || row.target || row.to_id || row.target_id || row.end || '',
			).trim()
			return from && to ? [from, to] : null
		})
		.filter((edge): edge is [string, string] => Boolean(edge))
		.filter(([from, to]) => nodeIdSet.has(from) && nodeIdSet.has(to))
}

function extractNodeConfigMap(rawNodes: unknown): Record<string, NodeConfig> {
	if (!Array.isArray(rawNodes)) return {}

	const next: Record<string, NodeConfig> = {}
	for (const rawNode of rawNodes) {
		const row = toRecord(rawNode)
		const nodeId = toTrimmedString(row.id)
		if (!nodeId) continue
		const config = row.config
		if (config && typeof config === 'object' && !Array.isArray(config)) {
			next[nodeId] = config as NodeConfig
		}
	}
	return next
}

function extractRagSourceMap(rawNodes: unknown): Record<string, string> {
	if (!Array.isArray(rawNodes)) return {}

	const next: Record<string, string> = {}
	for (const rawNode of rawNodes) {
		const row = toRecord(rawNode)
		const nodeId = toTrimmedString(row.id)
		if (!nodeId) continue

		const direct = toTrimmedString(row.ragSourceId)
		if (direct) {
			next[nodeId] = direct
			continue
		}

		const config = toRecord(row.config)
		const fromConfig = toTrimmedString(config.ragSourceId)
		if (fromConfig) {
			next[nodeId] = fromConfig
		}
	}
	return next
}

function mapExecutionRows(rows: FlowExecutionApiItem[]): FlowExecutionRow[] {
	return rows.map((row, index) => ({
		id: String(row?.id || `exec-${index + 1}`),
		conversationId: String(row?.conversation_id || '-'),
		nodeId: String(row?.node_id || '-'),
		event: String(row?.event || 'flow_event'),
		status: String(row?.status || 'sent'),
		preview: truncateText(String(row?.preview || '-')),
		contentType: String(row?.content_type || 'text'),
		senderType: String(row?.sender_type || 'bot'),
		executionId: String(row?.execution_id || `trace-${index + 1}`),
		nodeType: String(row?.node_type || row?.event || '-'),
		path: toStringArray(row?.path),
		input: toRecord(row?.input),
		output: toRecord(row?.output),
		variablesDelta: toRecord(row?.variables_delta),
		branch: toRecord(row?.branch),
		error: String(row?.error || ''),
		createdAt: row?.created_at ? String(row.created_at) : '',
	}))
}

function mapVersionRows(rows: FlowVersionApiItem[]): FlowSavedVersionRow[] {
	return rows.map((row, index) => ({
		id: String(row?.id || `version-${index + 1}`),
		label: String(row?.label || `v${index + 1}`),
		status: row?.status === 'archived' ? 'archived' : 'current',
		summary: String(row?.summary || 'Saved workflow snapshot'),
		savedAt: row?.saved_at ? String(row.saved_at) : '',
		nodesCount:
			typeof row?.nodes_count === 'number' && Number.isFinite(row.nodes_count)
				? row.nodes_count
				: 0,
		edgesCount:
			typeof row?.edges_count === 'number' && Number.isFinite(row.edges_count)
				? row.edges_count
				: 0,
		isActive: Boolean(row?.is_active),
	}))
}

function toFlowSummary(row: FlowApiItem, index: number): WorkflowSummary {
	const rawActive = row?.is_active ?? row?.active
	return {
		id: String(row?.id || `workflow-${index + 1}`),
		name: String(row?.name || row?.title || 'Workflow'),
		status: rawActive ? 'active' : 'draft',
		lastRun: formatLastRun(row?.updated_at),
	}
}

function NodeGlyphIcon({
	name,
	size = 12,
}: {
	name: NodeGlyph
	size?: number
}) {
	const Icon = GLYPH_ICON[name]
	return <Icon size={size} />
}

function WorkflowPage() {
	const { flowId } = Route.useParams() as { flowId: string }
	const navigate = useNavigate()
	const searchParams = Route.useSearch()
	const [flowList, setFlowList] = useState<WorkflowSummary[]>([])
	const [selectedFlowId, setSelectedFlowId] = useState<string>(flowId)
	const [workflowNodes, setWorkflowNodes] = useState<WorkflowNode[]>([])
	const [workflowEdges, setWorkflowEdges] = useState<Array<[string, string]>>(
		[],
	)
	const [selectedNodeId, setSelectedNodeId] = useState<string>('')
	const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
	const [nextNodeIndex, setNextNodeIndex] = useState<number>(1)
	const [openSettings, setOpenSettings] = useState<boolean>(false)
	const [draggingNodeId, setDraggingNodeId] = useState<string>('')
	const [marqueeRect, setMarqueeRect] = useState<SelectionRect | null>(null)
	const [activeTab, setActiveTab] = useState<WorkflowTab>('editor')
	const [nodeConfigByNodeId, setNodeConfigByNodeId] = useState<
		Record<string, NodeConfig>
	>({})
	const [ragSources, setRagSources] = useState<RagSourceOption[]>([])
	const [ragSourceByNodeId, setRagSourceByNodeId] = useState<
		Record<string, string>
	>({})
	const [loadingRagSources, setLoadingRagSources] = useState<boolean>(false)
	const [inboxOptions, setInboxOptions] = useState<InboxOption[]>([])
	const [loadingInboxes, setLoadingInboxes] = useState<boolean>(false)
	const [executionRows, setExecutionRows] = useState<FlowExecutionRow[]>(
		EMPTY_EXECUTION_ROWS,
	)
	const [executionConversationFilter, setExecutionConversationFilter] =
		useState<string>('')
	const [selectedExecutionId, setSelectedExecutionId] = useState<string>('')
	const [selectedExecutionStepId, setSelectedExecutionStepId] =
		useState<string>('')
	const [savedVersionRows, setSavedVersionRows] = useState<
		FlowSavedVersionRow[]
	>(EMPTY_SAVED_VERSION_ROWS)
	const [loadingExecutions, setLoadingExecutions] = useState<boolean>(false)
	const [loadingSavedVersions, setLoadingSavedVersions] =
		useState<boolean>(false)
	const [loadingFlowDetail, setLoadingFlowDetail] = useState<boolean>(false)
	const [runningAction, setRunningAction] = useState<
		'preview' | 'test' | 'deploy' | 'default' | null
	>(null)
	const [defaultFlowId, setDefaultFlowId] = useState<string | null>(null)
	const [loadingDefaultFlow, setLoadingDefaultFlow] = useState<boolean>(false)
	const [activeAiProvider, setActiveAiProvider] =
		useState<string>('growthcircle')
	const [aiModelOptions, setAiModelOptions] = useState<AiProviderModelOption[]>(
		[],
	)
	const [loadingAiModels, setLoadingAiModels] = useState<boolean>(false)
	const [workflowName, setWorkflowName] = useState<string>('')
	const canvasRef = useRef<HTMLDivElement | null>(null)
	const nodeDragStateRef = useRef<NodeDragState | null>(null)
	const marqueeSelectionRef = useRef<MarqueeSelectionState | null>(null)
	const suppressNodeClickRef = useRef<string | null>(null)
	const workflowNodesRef = useRef<WorkflowNode[]>([])
	const [draftEdge, setDraftEdge] = useState<{
		sourceId: string
		endX: number
		endY: number
	} | null>(null)
	const edgeDrawStateRef = useRef<{
		pointerId: number
		sourceId: string
	} | null>(null)
	const [viewport, setViewport] = useState({ scale: 1 })
	const viewportRef = useRef({ scale: 1 })
	useEffect(() => {
		viewportRef.current = viewport
	}, [viewport])

	// === Execution Viewer Mode ===
	const [isExecutionViewerMode, setIsExecutionViewerMode] =
		useState<boolean>(false)
	const [executionViewerExecutionId, setExecutionViewerExecutionId] =
		useState<string>('')
	const [executionPopupState, setExecutionPopupState] =
		useState<ExecutionPopupState | null>(null)

	useEffect(() => {
		const container = canvasRef.current?.parentElement
		if (!container) return
		const handleWheel = (e: WheelEvent) => {
			if (e.ctrlKey || e.metaKey) {
				e.preventDefault()
				setViewport((prev) => {
					const scaleChange = e.deltaY > 0 ? 0.9 : 1.1
					const newScale = Math.min(Math.max(prev.scale * scaleChange, 0.2), 3)
					return { scale: newScale }
				})
			}
		}
		container.addEventListener('wheel', handleWheel, { passive: false })
		return () => container.removeEventListener('wheel', handleWheel)
	}, [])
	const triggerCount = useMemo(
		() => workflowNodes.filter((node) => node.type === 'trigger').length,
		[workflowNodes],
	)
	const isNewFlow = flowId === 'new'

	// Auto-load execution from URL param
	useEffect(() => {
		const urlExecutionId = searchParams?.execution_id
		if (!urlExecutionId || isNewFlow) return
		let active = true

		const loadFromUrl = async () => {
			setLoadingExecutions(true)
			try {
				const response = await automationFlows.getExecutions(flowId, {
					executionId: urlExecutionId,
				})
				if (!active) return

				const mapped = mapExecutionRows(
					unwrapPayload<FlowExecutionApiItem>(response),
				)
				setExecutionRows(mapped)
				setSelectedExecutionId(urlExecutionId)
				if (mapped.length > 0) {
					setSelectedExecutionStepId(mapped[0]?.id || '')
				}

				// Enter execution viewer mode
				setIsExecutionViewerMode(true)
				setExecutionViewerExecutionId(urlExecutionId)
				setActiveTab('editor')
			} catch {
				if (active) {
					toast.error('Gagal memuat execution data dari URL.')
				}
			} finally {
				if (active) setLoadingExecutions(false)
			}
		}

		void loadFromUrl()
		return () => {
			active = false
		}
	}, [searchParams?.execution_id, flowId, isNewFlow])

	const getCanvasPoint = (clientX: number, clientY: number) => {
		const canvasElement = canvasRef.current
		if (!canvasElement) return null
		const rect = canvasElement.getBoundingClientRect()
		return {
			x: Math.max(
				0,
				Math.min(
					CANVAS_WIDTH,
					(clientX - rect.left) / viewportRef.current.scale,
				),
			),
			y: Math.max(
				0,
				Math.min(
					CANVAS_HEIGHT,
					(clientY - rect.top) / viewportRef.current.scale,
				),
			),
		}
	}

	useEffect(() => {
		workflowNodesRef.current = workflowNodes
	}, [workflowNodes])

	useEffect(() => {
		const handlePointerMove = (event: PointerEvent) => {
			const edgeDrawState = edgeDrawStateRef.current
			if (edgeDrawState && event.pointerId === edgeDrawState.pointerId) {
				const container = canvasRef.current
				if (!container) return
				const bounds = container.getBoundingClientRect()
				setDraftEdge({
					sourceId: edgeDrawState.sourceId,
					endX: (event.clientX - bounds.left) / viewportRef.current.scale,
					endY: (event.clientY - bounds.top) / viewportRef.current.scale,
				})
				return
			}

			const dragState = nodeDragStateRef.current
			if (!dragState || event.pointerId !== dragState.pointerId) return

			const deltaX =
				(event.clientX - dragState.startClientX) / viewportRef.current.scale
			const deltaY =
				(event.clientY - dragState.startClientY) / viewportRef.current.scale
			if (
				!dragState.moved &&
				Math.hypot(deltaX, deltaY) >= DRAG_CLICK_THRESHOLD_PX
			) {
				dragState.moved = true
			}

			let minAllowedDeltaX = -Infinity
			let maxAllowedDeltaX = Infinity
			let minAllowedDeltaY = -Infinity
			let maxAllowedDeltaY = Infinity
			for (const origin of Object.values(dragState.originByNodeId)) {
				minAllowedDeltaX = Math.max(minAllowedDeltaX, CANVAS_PADDING - origin.x)
				maxAllowedDeltaX = Math.min(
					maxAllowedDeltaX,
					CANVAS_WIDTH - NODE_WIDTH - CANVAS_PADDING - origin.x,
				)
				minAllowedDeltaY = Math.max(minAllowedDeltaY, CANVAS_PADDING - origin.y)
				maxAllowedDeltaY = Math.min(
					maxAllowedDeltaY,
					CANVAS_HEIGHT - NODE_HEIGHT - CANVAS_PADDING - origin.y,
				)
			}
			const boundedDeltaX = Math.min(
				maxAllowedDeltaX,
				Math.max(minAllowedDeltaX, deltaX),
			)
			const boundedDeltaY = Math.min(
				maxAllowedDeltaY,
				Math.max(minAllowedDeltaY, deltaY),
			)
			setWorkflowNodes((previous) => {
				let changed = false
				const next = previous.map((node) => {
					const origin = dragState.originByNodeId[node.id]
					if (!origin) return node
					const rawX = origin.x + boundedDeltaX
					const rawY = origin.y + boundedDeltaY
					const nextX = Math.round(rawX / 24) * 24
					const nextY = Math.round(rawY / 24) * 24
					if (node.x === nextX && node.y === nextY) return node
					changed = true
					return { ...node, x: nextX, y: nextY }
				})
				return changed ? next : previous
			})

			return
		}

		const handleMarqueeMove = (event: PointerEvent) => {
			const marqueeState = marqueeSelectionRef.current
			if (!marqueeState || event.pointerId !== marqueeState.pointerId) return
			const point = getCanvasPoint(event.clientX, event.clientY)
			if (!point) return
			marqueeState.currentX = point.x
			marqueeState.currentY = point.y
			setMarqueeRect(
				normalizeSelectionRect(
					marqueeState.startX,
					marqueeState.startY,
					marqueeState.currentX,
					marqueeState.currentY,
				),
			)
		}

		const handlePointerDone = (event: PointerEvent) => {
			const edgeDrawState = edgeDrawStateRef.current
			if (edgeDrawState && event.pointerId === edgeDrawState.pointerId) {
				const sourceId = edgeDrawState.sourceId
				edgeDrawStateRef.current = null
				setDraftEdge(null)

				const container = canvasRef.current
				if (container) {
					const rect = container.getBoundingClientRect()
					const localX = event.clientX - rect.left
					const localY = event.clientY - rect.top

					const targetNode = workflowNodesRef.current.find((node) => {
						return (
							localX >= node.x &&
							localX <= node.x + NODE_WIDTH &&
							localY >= node.y &&
							localY <= node.y + NODE_HEIGHT
						)
					})
					if (targetNode && targetNode.id !== sourceId) {
						setWorkflowEdges((prev) => {
							const exists = prev.some(
								([s, t]) => s === sourceId && t === targetNode.id,
							)
							if (exists) return prev
							return [...prev, [sourceId, targetNode.id]]
						})
					}
				}
				return
			}

			const dragState = nodeDragStateRef.current
			if (!dragState || event.pointerId !== dragState.pointerId) return
			nodeDragStateRef.current = null
			setDraggingNodeId('')
			if (dragState.moved) {
				suppressNodeClickRef.current = dragState.anchorNodeId
			}

			return
		}

		const handleMarqueeDone = (event: PointerEvent) => {
			const marqueeState = marqueeSelectionRef.current
			if (!marqueeState || event.pointerId !== marqueeState.pointerId) return
			const point = getCanvasPoint(event.clientX, event.clientY)
			if (point) {
				marqueeState.currentX = point.x
				marqueeState.currentY = point.y
			}
			const rect = normalizeSelectionRect(
				marqueeState.startX,
				marqueeState.startY,
				marqueeState.currentX,
				marqueeState.currentY,
			)
			marqueeSelectionRef.current = null
			setMarqueeRect(null)
			if (rect.width < 8 && rect.height < 8) return
			const picked = workflowNodesRef.current
				.filter((node) => rectIntersectsNode(rect, node))
				.map((node) => node.id)
			setSelectedNodeIds(picked)
			if (picked.length === 1) {
				setSelectedNodeId(picked[0] || '')
				setOpenSettings(true)
			} else {
				setSelectedNodeId('')
				setOpenSettings(false)
			}
		}

		window.addEventListener('pointermove', handlePointerMove)
		window.addEventListener('pointermove', handleMarqueeMove)
		window.addEventListener('pointerup', handlePointerDone)
		window.addEventListener('pointerup', handleMarqueeDone)
		window.addEventListener('pointercancel', handlePointerDone)
		window.addEventListener('pointercancel', handleMarqueeDone)
		return () => {
			window.removeEventListener('pointermove', handlePointerMove)
			window.removeEventListener('pointermove', handleMarqueeMove)
			window.removeEventListener('pointerup', handlePointerDone)
			window.removeEventListener('pointerup', handleMarqueeDone)
			window.removeEventListener('pointercancel', handlePointerDone)
			window.removeEventListener('pointercancel', handleMarqueeDone)
		}
	}, [])

	const selectedNodeIdsRef = useRef<string[]>([])
	useEffect(() => {
		selectedNodeIdsRef.current = selectedNodeIds
	}, [selectedNodeIds])

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			if (
				e.target instanceof HTMLInputElement ||
				e.target instanceof HTMLTextAreaElement ||
				e.target instanceof HTMLSelectElement
			)
				return
			if (e.key === 'Backspace' || e.key === 'Delete') {
				const ids = selectedNodeIdsRef.current
				if (ids.length > 0) {
					setWorkflowNodes((prev) => prev.filter((n) => !ids.includes(n.id)))
					setWorkflowEdges((prev) =>
						prev.filter(([s, t]) => !ids.includes(s) && !ids.includes(t)),
					)
					setSelectedNodeIds([])
					setSelectedNodeId('')
				}
			}
			if ((e.key === 'c' || e.key === 'C') && (e.metaKey || e.ctrlKey)) {
				const ids = selectedNodeIdsRef.current
				if (ids.length > 0) {
					const copied = workflowNodesRef.current.filter((n) =>
						ids.includes(n.id),
					)
					navigator.clipboard.writeText(
						JSON.stringify({ type: 'crm-nodes', nodes: copied }),
					)
				}
			}
			if ((e.key === 'v' || e.key === 'V') && (e.metaKey || e.ctrlKey)) {
				navigator.clipboard.readText().then((text) => {
					try {
						const data = JSON.parse(text)
						if (data.type === 'crm-nodes') {
							const newNodes = data.nodes.map((n: any) => ({
								...n,
								id: randomId(),
								x: n.x + 48,
								y: n.y + 48,
							}))
							setWorkflowNodes((prev) => [...prev, ...newNodes])
							setSelectedNodeIds(newNodes.map((n: any) => n.id))
						}
					} catch (err) {}
				})
			}
		}
		window.addEventListener('keydown', handleKeyDown)
		return () => window.removeEventListener('keydown', handleKeyDown)
	}, [])

	useEffect(() => {
		let active = true

		const load = async () => {
			try {
				const response = await automationFlows.list()
				if (!active) return

				const mapped: WorkflowSummary[] = unwrapPayload<FlowApiItem>(
					response,
				).map((row, index) => toFlowSummary(row, index))

				setFlowList(mapped)
			} catch {
				setFlowList([])
			}
		}

		load()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		let active = true

		const loadDefaultFlow = async () => {
			setLoadingDefaultFlow(true)
			try {
				const response = await automationFlows.getDefault()
				if (!active) return
				const payload = toRecord(response?.payload)
				setDefaultFlowId(toTrimmedString(payload.default_flow_id) || null)
			} catch {
				if (active) setDefaultFlowId(null)
			} finally {
				if (active) setLoadingDefaultFlow(false)
			}
		}

		void loadDefaultFlow()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		let active = true

		const loadAiModels = async () => {
			setLoadingAiModels(true)
			try {
				const response = await ai.getSettings()
				if (!active) return

				const payload = extractAiSettingsPayload(response)
				const providerConfigurations = toRecord(payload.provider_configurations)
				const selectedProvider =
					toTrimmedString(payload.active_provider) ||
					toTrimmedString(payload.model_provider) ||
					'growthcircle'

				const selectedProviderConfig = toRecord(
					providerConfigurations[selectedProvider],
				)
				const providerModels = extractAiProviderModels(
					selectedProviderConfig.models,
				)
				const fallbackModelName =
					toTrimmedString(selectedProviderConfig.model_name) ||
					toTrimmedString(payload.model_name)

				const nextModels =
					providerModels.length > 0
						? providerModels
						: fallbackModelName
							? [
									{
										id: fallbackModelName,
										name: fallbackModelName,
										vendor: selectedProvider,
										contextWindow: '-',
										maxOutput: '-',
									},
								]
							: []

				setActiveAiProvider(selectedProvider)
				setAiModelOptions(nextModels)
			} catch {
				if (!active) return
				setActiveAiProvider('')
				setAiModelOptions([])
			} finally {
				if (active) setLoadingAiModels(false)
			}
		}

		void loadAiModels()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		let active = true
		setSelectedFlowId(flowId)
		nodeDragStateRef.current = null
		marqueeSelectionRef.current = null
		setDraggingNodeId('')
		setMarqueeRect(null)
		if (!runningAction) {
			setActiveTab('editor')
		}
		setExecutionRows(EMPTY_EXECUTION_ROWS)
		setSavedVersionRows(EMPTY_SAVED_VERSION_ROWS)
		setLoadingExecutions(false)
		setLoadingSavedVersions(false)

		if (isNewFlow) {
			setWorkflowNodes([])
			setWorkflowEdges([])
			setNodeConfigByNodeId({})
			setRagSourceByNodeId({})
			setWorkflowName('')
			setSelectedNodeId('')
			setSelectedNodeIds([])
			setNextNodeIndex(1)
			setOpenSettings(false)
			setLoadingFlowDetail(false)
			setSelectedExecutionId('')
			setSelectedExecutionStepId('')
			return () => {
				active = false
			}
		}

		const hydrateFromFlow = (row: FlowApiItem | null) => {
			const parsedNodes = parseFlowNodes(row?.nodes)
			const parsedEdges = parseFlowEdges(row?.edges, parsedNodes)
			const fallbackNodes = autoArrangeWorkflowNodes(parsedNodes, parsedEdges)
			const fallbackEdges = parsedEdges
			const preferredSelected =
				fallbackNodes.find((node) => node.type === 'trigger')?.id ||
				fallbackNodes[0]?.id ||
				''

			setWorkflowNodes(fallbackNodes)
			setWorkflowEdges(fallbackEdges)
			setNodeConfigByNodeId(extractNodeConfigMap(row?.nodes))
			setRagSourceByNodeId(extractRagSourceMap(row?.nodes))
			setWorkflowName(toTrimmedString(row?.name || row?.title))
			setSelectedNodeId(preferredSelected)
			setSelectedNodeIds(preferredSelected ? [preferredSelected] : [])
			setNextNodeIndex(fallbackNodes.length + 1)
			setOpenSettings(false)
		}

		const loadFlow = async () => {
			setLoadingFlowDetail(true)
			try {
				const response = await automationFlows.get(flowId)
				if (!active) return
				const payload = (response?.payload || null) as FlowApiItem | null
				hydrateFromFlow(payload)
				if (payload?.id) {
					const summary = toFlowSummary(payload, 0)
					setFlowList((previous) => {
						const withoutCurrent = previous.filter(
							(flow) => flow.id !== summary.id,
						)
						return [summary, ...withoutCurrent]
					})
				}
			} catch {
				if (!active) return
				hydrateFromFlow(null)
			} finally {
				if (active) setLoadingFlowDetail(false)
			}
		}

		void loadFlow()
		return () => {
			active = false
		}
	}, [flowId, isNewFlow])

	useEffect(() => {
		let active = true

		const loadRagSources = async () => {
			setLoadingRagSources(true)
			try {
				const response = await knowledge.list({ limit: 200 })
				if (!active) return

				const rawItems = unwrapPayload<KnowledgeSourceApiItem>(response)
				const mapped = rawItems
					.map((row) => {
						const id = String(row?.id || '').trim()
						if (!id) return null
						const name = String(row?.name || row?.title || id).trim()
						return {
							id,
							name,
							status: String(row?.status || 'ready'),
							kind: getRagSourceKind(row),
						}
					})
					.filter((item): item is RagSourceOption => item !== null)

				const deduped = Array.from(
					new Map(mapped.map((item) => [item.id, item])).values(),
				)
				setRagSources(deduped)
			} catch {
				if (active) setRagSources([])
			} finally {
				if (active) setLoadingRagSources(false)
			}
		}

		void loadRagSources()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		let active = true

		const loadInboxes = async () => {
			setLoadingInboxes(true)
			try {
				const response = await inboxes.list()
				if (!active) return

				const mapped = unwrapPayload<InboxApiItem>(response)
					.map((row, index) => ({
						id: String(row?.id || `inbox-${index + 1}`),
						name: String(row?.name || `Inbox ${index + 1}`),
						channelType: String(row?.channel_type || 'unknown').toLowerCase(),
					}))
					.filter((item) => item.id.length > 0)

				setInboxOptions(mapped)
			} catch {
				if (active) setInboxOptions([])
			} finally {
				if (active) setLoadingInboxes(false)
			}
		}

		void loadInboxes()
		return () => {
			active = false
		}
	}, [])

	useEffect(() => {
		if (activeTab !== 'executions') return
		if (isNewFlow) {
			setExecutionRows(EMPTY_EXECUTION_ROWS)
			setSelectedExecutionId('')
			setSelectedExecutionStepId('')
			setLoadingExecutions(false)
			return
		}

		let active = true
		const loadExecutions = async () => {
			setLoadingExecutions(true)
			try {
				const response = await automationFlows.getExecutions(flowId, {
					conversationId: executionConversationFilter.trim(),
				})
				if (!active) return

				const mapped = mapExecutionRows(
					unwrapPayload<FlowExecutionApiItem>(response),
				)

				setExecutionRows(mapped)
				const nextExecutionId =
					selectedExecutionId &&
					mapped.some((row) => row.executionId === selectedExecutionId)
						? selectedExecutionId
						: mapped[0]?.executionId || ''
				setSelectedExecutionId(nextExecutionId)
				const nextSteps = mapped.filter(
					(row) => row.executionId === nextExecutionId,
				)
				setSelectedExecutionStepId(nextSteps[0]?.id || '')
			} catch {
				if (active) setExecutionRows(EMPTY_EXECUTION_ROWS)
				if (active) setSelectedExecutionId('')
				if (active) setSelectedExecutionStepId('')
			} finally {
				if (active) setLoadingExecutions(false)
			}
		}

		void loadExecutions()
		return () => {
			active = false
		}
	}, [activeTab, flowId, isNewFlow, executionConversationFilter])

	useEffect(() => {
		if (activeTab !== 'versions') return
		if (isNewFlow) {
			setSavedVersionRows(EMPTY_SAVED_VERSION_ROWS)
			setLoadingSavedVersions(false)
			return
		}

		let active = true
		const loadVersions = async () => {
			setLoadingSavedVersions(true)
			try {
				const response = await automationFlows.getVersions(flowId)
				if (!active) return

				const mapped = mapVersionRows(
					unwrapPayload<FlowVersionApiItem>(response),
				)

				setSavedVersionRows(mapped)
			} catch {
				if (active) setSavedVersionRows(EMPTY_SAVED_VERSION_ROWS)
			} finally {
				if (active) setLoadingSavedVersions(false)
			}
		}

		void loadVersions()
		return () => {
			active = false
		}
	}, [activeTab, flowId, isNewFlow])

	useEffect(() => {
		if (activeTab !== 'executions') return
		if (!selectedExecutionId) return
		const hasExecution = executionRows.some(
			(row) => row.executionId === selectedExecutionId,
		)
		if (!hasExecution) {
			setSelectedExecutionId('')
			setSelectedExecutionStepId('')
		}
	}, [activeTab, selectedExecutionId, executionRows])

	const selectedFlow = useMemo(() => {
		const found = flowList.find((flow) => flow.id === selectedFlowId)
		if (found) return found
		return {
			id: selectedFlowId,
			name: selectedFlowId === 'new' ? 'Workflow Baru' : selectedFlowId,
			status: 'draft',
			lastRun: '-',
		}
	}, [flowList, selectedFlowId])
	const workflowNameTrimmed = workflowName.trim()
	const workflowDisplayName =
		workflowNameTrimmed ||
		(isNewFlow ? 'Workflow Baru' : selectedFlow.name || 'Workflow')
	const deployNeedsWorkflowName = workflowNameTrimmed.length === 0
	const isDefaultFlow = !isNewFlow && defaultFlowId === selectedFlowId

	const selectedNodeData = useMemo(
		() => workflowNodes.find((node) => node.id === selectedNodeId) || null,
		[workflowNodes, selectedNodeId],
	)
	const executionGroups = useMemo(
		() => mapUniqueExecutionRows(executionRows),
		[executionRows],
	)
	const orderedExecutionIds = useMemo(
		() =>
			Array.from(executionGroups.keys()).sort((left, right) => {
				const leftRows = executionGroups.get(left) || []
				const rightRows = executionGroups.get(right) || []
				const leftTime = leftRows[0]?.createdAt || ''
				const rightTime = rightRows[0]?.createdAt || ''
				return new Date(rightTime).getTime() - new Date(leftTime).getTime()
			}),
		[executionGroups],
	)
	const executionDetailRows = useMemo(() => {
		const rows = executionGroups.get(selectedExecutionId) || []
		return rows
			.filter(
				(row) =>
					!executionConversationFilter ||
					row.conversationId === executionConversationFilter,
			)
			.sort(
				(left, right) =>
					new Date(right.createdAt).getTime() -
					new Date(left.createdAt).getTime(),
			)
	}, [executionConversationFilter, executionGroups, selectedExecutionId])
	const executionNodePathByRun = useMemo(() => {
		const selectedRow = executionRows.find(
			(row) => row.id === selectedExecutionStepId,
		)
		const pathRows = executionRows.filter((row) =>
			selectedExecutionId
				? row.executionId === selectedExecutionId
				: selectedExecutionStepId
					? row.id === selectedExecutionStepId
					: false,
		)
		const ordered = [...pathRows].sort(
			(a, b) =>
				new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
		)
		const next = new Map<string, number>()
		const fallback = new Set<string>()
		let order = 0
		for (const row of ordered) {
			const fromPath = row.path || []
			for (const nodeId of fromPath) {
				if (!next.has(nodeId)) {
					next.set(nodeId, order)
					fallback.add(nodeId)
					order += 1
				}
			}
		}
		return {
			pathMap: next,
			executionNodeSet: fallback,
			selectedRow: selectedRow || null,
		}
	}, [selectedExecutionId, selectedExecutionStepId, executionRows])
	const selectedExecutionStep = useMemo(() => {
		if (!selectedExecutionStepId) {
			const selectedRunRows = executionDetailRows[0]
				? executionDetailRows
				: executionRows.filter((row) => row.executionId === selectedExecutionId)
			return selectedRunRows[0] || null
		}
		return (
			executionRows.find((row) => row.id === selectedExecutionStepId) || null
		)
	}, [
		executionDetailRows,
		executionRows,
		selectedExecutionId,
		selectedExecutionStepId,
	])
	const executionRowsForDisplay = useMemo(
		() => (selectedExecutionId ? executionDetailRows : executionRows),
		[executionDetailRows, executionRows, selectedExecutionId],
	)
	const selectedRagSourceId =
		selectedNodeData?.type === 'rag'
			? ragSourceByNodeId[selectedNodeData.id] || ''
			: ''
	const selectedRagSource = useMemo(
		() =>
			ragSources.find((source) => source.id === selectedRagSourceId) || null,
		[ragSources, selectedRagSourceId],
	)
	const selectedNodeSettingKind = useMemo<NodeSettingKind>(() => {
		if (!selectedNodeData) return 'generic'
		return getNodeSettingKind(selectedNodeData)
	}, [selectedNodeData])
	const selectedNodeConfig = useMemo<NodeConfig | null>(() => {
		if (!selectedNodeData) return null
		return {
			...getDefaultNodeConfig(selectedNodeSettingKind),
			...(nodeConfigByNodeId[selectedNodeData.id] || {}),
		}
	}, [selectedNodeData, selectedNodeSettingKind, nodeConfigByNodeId])
	const availableAiModelOptions = useMemo(
		() =>
			aiModelOptions,
		[aiModelOptions],
	)
	const llmNodeModelOptions = useMemo(
		() =>
			withSelectedModelOption(
				availableAiModelOptions,
				selectedNodeConfig?.llmModel,
			),
		[availableAiModelOptions, selectedNodeConfig?.llmModel],
	)
	const intentNodeModelOptions = useMemo(
		() =>
			withSelectedModelOption(
				availableAiModelOptions,
				selectedNodeConfig?.intentModel,
			),
		[availableAiModelOptions, selectedNodeConfig?.intentModel],
	)
	const sentimentNodeModelOptions = useMemo(
		() =>
			withSelectedModelOption(
				availableAiModelOptions,
				selectedNodeConfig?.sentimentModel,
			),
		[availableAiModelOptions, selectedNodeConfig?.sentimentModel],
	)
	const ragNodeModelOptions = useMemo(
		() =>
			withSelectedModelOption(
				availableAiModelOptions,
				selectedNodeConfig?.ragModel,
			),
		[availableAiModelOptions, selectedNodeConfig?.ragModel],
	)
	const summarizeNodeModelOptions = useMemo(
		() =>
			withSelectedModelOption(
				availableAiModelOptions,
				selectedNodeConfig?.summarizeModel,
			),
		[availableAiModelOptions, selectedNodeConfig?.summarizeModel],
	)
	const waInboxOptions = useMemo(
		() =>
			inboxOptions.filter((inbox) => inbox.channelType === 'whatsapp').length >
			0
				? inboxOptions.filter((inbox) => inbox.channelType === 'whatsapp')
				: inboxOptions,
		[inboxOptions],
	)
	const selectedInbox = useMemo(() => {
		if (!selectedNodeConfig?.inboxId) return null
		return (
			waInboxOptions.find((inbox) => inbox.id === selectedNodeConfig.inboxId) ||
			null
		)
	}, [selectedNodeConfig, waInboxOptions])
	const upstreamIntentClassifierNode = useMemo(() => {
		if (!selectedNodeData || selectedNodeSettingKind !== 'switch_router')
			return null
		const upstreamNodeIds = workflowEdges
			.filter(([, toId]) => toId === selectedNodeData.id)
			.map(([fromId]) => fromId)

		const upstreamNode = upstreamNodeIds
			.map((nodeId) => workflowNodes.find((node) => node.id === nodeId))
			.find((node): node is WorkflowNode => {
				if (!node) return false
				return getNodeSettingKind(node) === 'intent_classifier'
			})

		return upstreamNode || null
	}, [selectedNodeData, selectedNodeSettingKind, workflowEdges, workflowNodes])
	const upstreamIntentLabels = useMemo(() => {
		if (!upstreamIntentClassifierNode) return []
		const config =
			nodeConfigByNodeId[upstreamIntentClassifierNode.id] ||
			getDefaultNodeConfig('intent_classifier')
		return parseIntentLabelList(config.intentLabels || '')
	}, [upstreamIntentClassifierNode, nodeConfigByNodeId])
	const switchRoutingState = useMemo(
		() => parseSwitchCases(selectedNodeConfig?.switchCases || ''),
		[selectedNodeConfig?.switchCases],
	)
	const switchIntentLabels = useMemo(() => {
		const fromUpstream = upstreamIntentLabels
		if (fromUpstream.length > 0) return fromUpstream
		if (switchRoutingState.map.size > 0)
			return Array.from(switchRoutingState.map.keys())
		return parseIntentLabelList(
			getDefaultNodeConfig('intent_classifier').intentLabels || '',
		)
	}, [upstreamIntentLabels, switchRoutingState.map])

	useEffect(() => {
		if (!selectedNodeData || selectedNodeData.type !== 'rag') return

		const existingSourceId = ragSourceByNodeId[selectedNodeData.id]
		const existingSource = existingSourceId
			? ragSources.find((source) => source.id === existingSourceId) || null
			: null
		if (existingSourceId && (ragSources.length === 0 || existingSource)) {
			if (
				existingSource &&
				!selectedNodeData.sub
					.toLowerCase()
					.includes(existingSource.name.toLowerCase())
			) {
				setWorkflowNodes((previous) =>
					previous.map((node) =>
						node.id === selectedNodeData.id
							? {
									...node,
									sub: formatRagNodeSub(existingSource.name, node.sub),
								}
							: node,
					),
				)
			}
			return
		}

		if (existingSourceId && ragSources.length > 0) {
			setRagSourceByNodeId((previous) => {
				if (!(selectedNodeData.id in previous)) return previous
				const next = { ...previous }
				delete next[selectedNodeData.id]
				return next
			})
			setNodeConfigByNodeId((previous) => {
				const current = previous[selectedNodeData.id]
				if (!current || !('ragSourceId' in current)) return previous
				const nextConfig = { ...current }
				delete nextConfig.ragSourceId
				return {
					...previous,
					[selectedNodeData.id]: nextConfig,
				}
			})
		}

		if (selectedNodeData.sub.includes(RAG_ALL_SOURCES_LABEL)) return

		setWorkflowNodes((previous) =>
			previous.map((node) =>
				node.id === selectedNodeData.id
					? { ...node, sub: formatRagNodeSub(RAG_ALL_SOURCES_LABEL, node.sub) }
					: node,
			),
		)
	}, [selectedNodeData, ragSources, ragSourceByNodeId])

	useEffect(() => {
		if (!selectedNodeData || selectedNodeSettingKind !== 'switch_router') return
		const existingCases = (selectedNodeConfig?.switchCases || '').trim()
		if (existingCases.length > 0) return
		if (switchIntentLabels.length === 0) return

		const nextMap = new Map<string, SwitchRouteTarget>()
		for (const intent of switchIntentLabels) {
			nextMap.set(
				normalizeIntentToken(intent),
				normalizeSwitchRouteTarget(
					selectedNodeConfig?.switchDefaultRoute ||
						switchRoutingState.defaultRoute,
				),
			)
		}
		const defaultRoute = normalizeSwitchRouteTarget(
			selectedNodeConfig?.switchDefaultRoute || DEFAULT_SWITCH_ROUTE_TARGET,
		)
		const nextCases = stringifySwitchCases(
			switchIntentLabels,
			nextMap,
			defaultRoute,
		)
		updateSelectedNodeConfig({
			switchVariable:
				selectedNodeConfig?.switchVariable || 'decision.recommended_action',
			switchCases: nextCases,
			switchDefaultRoute: defaultRoute,
		})
		updateSelectedNodeSub(summarizeSwitchRouting(nextMap, defaultRoute))
	}, [
		selectedNodeData,
		selectedNodeSettingKind,
		selectedNodeConfig?.switchCases,
		selectedNodeConfig?.switchDefaultRoute,
		selectedNodeConfig?.switchVariable,
		switchIntentLabels,
	])

	const selectedNodeTone = selectedNodeData
		? toneColor(selectedNodeData.tone)
		: 'var(--ocm-accent)'
	const showSettingsPanel = activeTab === 'editor' && openSettings
	const hasTrigger = triggerCount > 0
	const actionBusy = Boolean(runningAction)
	const deployDisabled =
		actionBusy || loadingFlowDetail || deployNeedsWorkflowName
	const setDefaultDisabled =
		actionBusy ||
		loadingFlowDetail ||
		loadingDefaultFlow ||
		deployNeedsWorkflowName ||
		isDefaultFlow
	const nonTriggerLocked = (item: PaletteItem) =>
		item.type !== 'trigger' && !hasTrigger

	const updateSelectedNodeSub = (nextSub: string) => {
		if (!selectedNodeData) return
		setWorkflowNodes((previous) =>
			previous.map((node) =>
				node.id === selectedNodeData.id
					? {
							...node,
							sub: nextSub,
						}
					: node,
			),
		)
	}

	const updateSelectedNodeConfig = (patch: Partial<NodeConfig>) => {
		if (!selectedNodeData) return
		setNodeConfigByNodeId((previous) => ({
			...previous,
			[selectedNodeData.id]: {
				...getDefaultNodeConfig(selectedNodeSettingKind),
				...(previous[selectedNodeData.id] || {}),
				...patch,
			},
		}))
	}

	const updateHandoverNodeConfig = (patch: Partial<NodeConfig>) => {
		const nextConfig = {
			...(selectedNodeConfig || {}),
			...patch,
		}
		updateSelectedNodeConfig(patch)
		updateSelectedNodeSub(
			`auto-handover ke ${nextConfig.handoverQueueId || 'CS queue'} · ${buildHandoverCriteriaSummary(nextConfig)}`,
		)
	}

	const syncDownstreamSwitchRoutesFromIntent = (
		classifierNodeId: string,
		labelsRaw: string,
	) => {
		const intentLabels = parseIntentLabelList(labelsRaw)
		if (intentLabels.length === 0) return

		const switchNodeIds = workflowEdges
			.filter(([fromId]) => fromId === classifierNodeId)
			.map(([, toId]) => toId)
			.filter((nodeId) => {
				const node = workflowNodes.find((item) => item.id === nodeId)
				return (
					Boolean(node) &&
					getNodeSettingKind(node as WorkflowNode) === 'switch_router'
				)
			})

		if (switchNodeIds.length === 0) return
		const summaryBySwitchId: Record<string, string> = {}

		setNodeConfigByNodeId((previous) => {
			const next = { ...previous }
			for (const switchId of switchNodeIds) {
				const merged = {
					...getDefaultNodeConfig('switch_router'),
					...(next[switchId] || {}),
				}
				const parsed = parseSwitchCases(merged.switchCases || '')
				const nextMap = new Map<string, SwitchRouteTarget>()
				for (const intent of intentLabels) {
					const key = normalizeIntentToken(intent)
					nextMap.set(
						key,
						parsed.map.get(key) ||
							normalizeSwitchRouteTarget(
								merged.switchDefaultRoute || parsed.defaultRoute,
							),
					)
				}
				const defaultRoute = normalizeSwitchRouteTarget(
					merged.switchDefaultRoute || parsed.defaultRoute,
				)
				const switchCases = stringifySwitchCases(
					intentLabels,
					nextMap,
					defaultRoute,
				)
				next[switchId] = {
					...merged,
					switchVariable:
						merged.switchVariable || 'decision.recommended_action',
					switchCases,
					switchDefaultRoute: defaultRoute,
				}
				summaryBySwitchId[switchId] = summarizeSwitchRouting(
					nextMap,
					defaultRoute,
				)
			}
			return next
		})

		setWorkflowNodes((previous) =>
			previous.map((node) =>
				summaryBySwitchId[node.id]
					? {
							...node,
							sub: summaryBySwitchId[node.id],
						}
					: node,
			),
		)
	}

	const syncDownstreamSwitchVariableFromIntent = (
		classifierNodeId: string,
		outputVariable: string,
	) => {
		const nextVar = outputVariable.trim() || 'intent.label'
		const switchNodeIds = workflowEdges
			.filter(([fromId]) => fromId === classifierNodeId)
			.map(([, toId]) => toId)
			.filter((nodeId) => {
				const node = workflowNodes.find((item) => item.id === nodeId)
				return (
					Boolean(node) &&
					getNodeSettingKind(node as WorkflowNode) === 'switch_router'
				)
			})
		if (switchNodeIds.length === 0) return

		setNodeConfigByNodeId((previous) => {
			const next = { ...previous }
			for (const switchId of switchNodeIds) {
				next[switchId] = {
					...getDefaultNodeConfig('switch_router'),
					...(next[switchId] || {}),
					switchVariable: nextVar,
				}
			}
			return next
		})
	}

	const handleApplyLeadIntentPreset = () => {
		if (!selectedNodeData || selectedNodeSettingKind !== 'intent_classifier')
			return
		const presetLabels =
			'harga, keluhan, retur, pengiriman, pembayaran, produk, campaign, lainnya'
		updateSelectedNodeConfig({
			intentLabels: presetLabels,
			intentOutputVar: 'intent.label',
		})
		const total = parseIntentLabelList(presetLabels).length
		updateSelectedNodeSub(`${total} intent · output intent.label`)
		syncDownstreamSwitchRoutesFromIntent(selectedNodeData.id, presetLabels)
		syncDownstreamSwitchVariableFromIntent(
			selectedNodeData.id,
			'decision.recommended_action',
		)
		toast.success('Preset intent lead inbound diterapkan.')
	}

	const handleAddNode = (item: PaletteItem) => {
		if (activeTab !== 'editor') {
			window.alert('Buka tab Editor untuk menambahkan node.')
			return
		}

		if (nonTriggerLocked(item)) {
			window.alert(
				'Tambahkan minimal 1 trigger dulu sebelum menambahkan node lain.',
			)
			return
		}

		const nextId = `n-dyn-${Date.now()}-${nextNodeIndex}`
		const position = nextNodePosition(item, workflowNodes)
		const nextNode: WorkflowNode = {
			id: nextId,
			type: item.type,
			label: item.label,
			sub: item.sub,
			x: position.x,
			y: position.y,
			icon: item.icon,
			tone: item.tone,
			stats: item.stats,
		}
		const nextKind = getNodeSettingKind(nextNode)
		const defaultConfig = getDefaultNodeConfig(nextKind)

		if (nextKind === 'handover_cs') {
			nextNode.sub = `auto-handover ke ${defaultConfig.handoverQueueId || 'CS queue'} · ${buildHandoverCriteriaSummary(defaultConfig)}`
		}
		if (item.type === 'rag') {
			nextNode.sub = formatRagNodeSub(RAG_ALL_SOURCES_LABEL, nextNode.sub)
		}

		const selected =
			workflowNodes.find((node) => node.id === selectedNodeId) || null

		setWorkflowNodes((previous) => [...previous, nextNode])
		setNodeConfigByNodeId((previous) => ({
			...previous,
			[nextId]: defaultConfig,
		}))
		if (item.type !== 'trigger' && selected) {
			setWorkflowEdges((previous) => [...previous, [selected.id, nextId]])
		}
		setSelectedNodeId(nextId)
		setSelectedNodeIds([nextId])
		setOpenSettings(true)
		setNextNodeIndex((previous) => previous + 1)
	}

	const handleDeleteSelectedNode = () => {
		if (!selectedNodeData) return

		const confirmed = window.confirm(`Hapus node "${selectedNodeData.label}"?`)
		if (!confirmed) return

		const removeId = selectedNodeData.id
		const remainingNodes = workflowNodes.filter((node) => node.id !== removeId)
		const remainingEdges = workflowEdges.filter(
			([fromId, toId]) => fromId !== removeId && toId !== removeId,
		)
		setRagSourceByNodeId((previous) => {
			if (!(removeId in previous)) return previous
			const next = { ...previous }
			delete next[removeId]
			return next
		})
		setNodeConfigByNodeId((previous) => {
			if (!(removeId in previous)) return previous
			const next = { ...previous }
			delete next[removeId]
			return next
		})

		setWorkflowNodes(remainingNodes)
		setWorkflowEdges(remainingEdges)
		const nextSelected =
			remainingNodes.find((node) => node.type === 'trigger')?.id ||
			remainingNodes[0]?.id ||
			''
		setSelectedNodeId(nextSelected)
		setSelectedNodeIds(nextSelected ? [nextSelected] : [])
		setOpenSettings(Boolean(nextSelected))
	}

	const handleDuplicateSelectedNode = () => {
		if (!selectedNodeData) return

		const nextId = `n-dyn-${Date.now()}-${nextNodeIndex}`
		const duplicateNode: WorkflowNode = {
			...cloneNode(selectedNodeData),
			id: nextId,
			x: Math.min(selectedNodeData.x + 260, CANVAS_WIDTH - NODE_WIDTH - 30),
			y: Math.min(selectedNodeData.y + 24, CANVAS_HEIGHT - NODE_HEIGHT - 30),
		}

		setWorkflowNodes((previous) => [...previous, duplicateNode])
		setWorkflowEdges((previous) => [...previous, [selectedNodeData.id, nextId]])
		setRagSourceByNodeId((previous) => {
			const sourceId = previous[selectedNodeData.id]
			if (!sourceId) return previous
			return { ...previous, [nextId]: sourceId }
		})
		setNodeConfigByNodeId((previous) => {
			const sourceConfig = previous[selectedNodeData.id]
			if (!sourceConfig) return previous
			return {
				...previous,
				[nextId]: { ...sourceConfig },
			}
		})
		setSelectedNodeId(nextId)
		setSelectedNodeIds([nextId])
		setOpenSettings(true)
		setNextNodeIndex((previous) => previous + 1)
	}

	const handleRenameSelectedNode = (nextLabel: string) => {
		if (!selectedNodeData) return
		setWorkflowNodes((previous) =>
			previous.map((node) =>
				node.id === selectedNodeData.id ? { ...node, label: nextLabel } : node,
			),
		)
	}

	const handleEdgeDragPointerDown = (
		event: ReactPointerEvent<HTMLSpanElement>,
		sourceId: string,
	) => {
		if (event.button !== 0 || activeTab !== 'editor') return
		event.preventDefault()
		event.stopPropagation()
		edgeDrawStateRef.current = {
			pointerId: event.pointerId,
			sourceId,
		}
		const container = canvasRef.current
		if (container) {
			const bounds = container.getBoundingClientRect()
			setDraftEdge({
				sourceId,
				endX: event.clientX - bounds.left,
				endY: event.clientY - bounds.top,
			})
		}
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	const handleNodePointerDown = (
		event: ReactPointerEvent<HTMLButtonElement>,
		node: WorkflowNode,
	) => {
		if (event.button !== 0 || activeTab !== 'editor') return
		event.preventDefault()
		event.stopPropagation()
		const targetNodeIds =
			selectedNodeIds.includes(node.id) && selectedNodeIds.length > 1
				? selectedNodeIds
				: [node.id]
		const originByNodeId = workflowNodes.reduce<
			Record<string, { x: number; y: number }>
		>((accumulator, item) => {
			if (targetNodeIds.includes(item.id)) {
				accumulator[item.id] = { x: item.x, y: item.y }
			}
			return accumulator
		}, {})
		setSelectedNodeId(node.id)
		setSelectedNodeIds(targetNodeIds)
		setDraggingNodeId(node.id)
		nodeDragStateRef.current = {
			anchorNodeId: node.id,
			nodeIds: targetNodeIds,
			pointerId: event.pointerId,
			startClientX: event.clientX,
			startClientY: event.clientY,
			originByNodeId,
			moved: false,
		}
		event.currentTarget.setPointerCapture(event.pointerId)
	}

	const handleNodeClick = (nodeId: string) => {
		if (suppressNodeClickRef.current === nodeId) {
			suppressNodeClickRef.current = null
			return
		}

		// In execution viewer mode, show execution popup instead of settings panel
		if (isExecutionViewerMode) {
			const node = workflowNodes.find((n) => n.id === nodeId)
			if (node) {
				handleNodeClickInExecutionViewer(nodeId, node)
			}
			return
		}

		setSelectedNodeId(nodeId)
		setSelectedNodeIds([nodeId])
		setOpenSettings(true)
	}

	const handleCanvasPointerDown = (
		event: ReactPointerEvent<HTMLDivElement>,
	) => {
		if (activeTab !== 'editor') return
		if (event.button === 2) {
			event.preventDefault()
			event.stopPropagation()
			const point = getCanvasPoint(event.clientX, event.clientY)
			if (!point) return
			nodeDragStateRef.current = null
			setDraggingNodeId('')
			setOpenSettings(false)
			marqueeSelectionRef.current = {
				pointerId: event.pointerId,
				startX: point.x,
				startY: point.y,
				currentX: point.x,
				currentY: point.y,
			}
			setMarqueeRect({
				left: point.x,
				top: point.y,
				width: 0,
				height: 0,
			})
			event.currentTarget.setPointerCapture(event.pointerId)
			return
		}
		if (event.button !== 0) return
		if (event.target === event.currentTarget) {
			setSelectedNodeId('')
			setSelectedNodeIds([])
			setOpenSettings(false)
		}
	}

	const handleCanvasContextMenu = (event: ReactMouseEvent<HTMLDivElement>) => {
		if (activeTab !== 'editor') return
		event.preventDefault()
	}

	const handleSelectRagSource = (sourceId: string) => {
		if (!selectedNodeData || selectedNodeData.type !== 'rag') return
		if (!sourceId) {
			setRagSourceByNodeId((previous) => {
				if (!(selectedNodeData.id in previous)) return previous
				const next = { ...previous }
				delete next[selectedNodeData.id]
				return next
			})
			updateSelectedNodeConfig({ ragSourceId: undefined })
			updateSelectedNodeSub(
				formatRagNodeSub(RAG_ALL_SOURCES_LABEL, selectedNodeData.sub),
			)
			return
		}

		const source = ragSources.find((item) => item.id === sourceId)
		if (!source) return

		setRagSourceByNodeId((previous) => ({
			...previous,
			[selectedNodeData.id]: sourceId,
		}))
		updateSelectedNodeConfig({ ragSourceId: sourceId })
		setWorkflowNodes((previous) =>
			previous.map((node) =>
				node.id === selectedNodeData.id
					? { ...node, sub: formatRagNodeSub(source.name, node.sub) }
					: node,
			),
		)
	}

	const handleExecutionStepClick = (step: FlowExecutionRow) => {
		setSelectedExecutionId(step.executionId)
		setSelectedExecutionStepId(step.id)
	}

	const handleOpenExecutionStepInEditor = (step: FlowExecutionRow) => {
		if (step.nodeId === '-') return
		setActiveTab('editor')
		setSelectedExecutionId(step.executionId)
		setSelectedExecutionStepId(step.id)
		setSelectedNodeId(step.nodeId)
		setSelectedNodeIds([step.nodeId])
		setOpenSettings(false)

		// Enter execution viewer mode
		setIsExecutionViewerMode(true)
		setExecutionViewerExecutionId(step.executionId)
		setExecutionPopupState(null)

		// Update URL with execution_id
		navigate({
			to: '/flows/$flowId',
			params: { flowId },
			search: { execution_id: step.executionId },
			replace: true,
		})
	}

	const handleNodeClickInExecutionViewer = (
		nodeId: string,
		node: WorkflowNode,
	) => {
		if (!isExecutionViewerMode) return false
		if (!executionViewerExecutionId) return false

		// Find the execution step for this node in this execution run
		const stepsForNode = executionRows.filter(
			(row) =>
				row.executionId === executionViewerExecutionId && row.nodeId === nodeId,
		)
		if (stepsForNode.length === 0) return false

		const step = stepsForNode[0]

		// Position popup relative to node: to the right of the node
		const popupX = node.x + 240
		const popupY = Math.max(10, node.y - 40)

		setExecutionPopupState({
			nodeId,
			executionStep: step,
			popupX,
			popupY,
		})
		setSelectedExecutionStepId(step.id)
		setSelectedNodeId(nodeId)
		setSelectedNodeIds([nodeId])

		return true
	}

	const handleExitExecutionViewer = () => {
		setIsExecutionViewerMode(false)
		setExecutionViewerExecutionId('')
		setExecutionPopupState(null)

		// Clear execution_id from URL
		navigate({
			to: '/flows/$flowId',
			params: { flowId },
			search: { execution_id: undefined },
			replace: true,
		})
	}

	const refreshExecutionsForFlow = async (
		targetFlowId: string,
		options?: { conversationId?: string; executionId?: string },
	) => {
		if (!targetFlowId || targetFlowId === 'new') return null
		try {
			const response = await automationFlows.getExecutions(targetFlowId, {
				conversationId: options?.conversationId?.trim(),
				executionId: options?.executionId?.trim(),
			})
			const mapped = mapExecutionRows(
				unwrapPayload<FlowExecutionApiItem>(response),
			)
			setExecutionRows(mapped)
			setSelectedExecutionId((previous) => {
				if (options?.executionId) return options.executionId
				if (mapped.length > 0) return mapped[0]?.executionId || ''
				return previous
			})
			setSelectedExecutionStepId((previous) => {
				if (options?.executionId) {
					const matching = mapped.find(
						(row) => row.executionId === options.executionId,
					)
					return matching?.id || ''
				}
				if (!previous) return mapped.length > 0 ? mapped[0]?.id || '' : ''
				return previous
			})
			return mapped
		} catch {
			return null
		}
	}

	const refreshVersionsForFlow = async (targetFlowId: string) => {
		if (!targetFlowId || targetFlowId === 'new') return null
		try {
			const response = await automationFlows.getVersions(targetFlowId)
			const mapped = mapVersionRows(unwrapPayload<FlowVersionApiItem>(response))
			setSavedVersionRows(mapped)
			return mapped
		} catch {
			return null
		}
	}

	const validateFlowForPersist = (requireTrigger: boolean) => {
		if (!requireTrigger) return null
		if (triggerCount === 0) {
			return 'Saat simpan/deploy, workflow wajib memiliki minimal 1 trigger.'
		}

		const incomingNodeIdSet = new Set(workflowEdges.map(([, toId]) => toId))
		const invalidTrigger = workflowNodes.find(
			(node) => node.type === 'trigger' && incomingNodeIdSet.has(node.id),
		)
		if (invalidTrigger) {
			return `Trigger "${invalidTrigger.label}" harus berada di awal flow (tanpa incoming edge).`
		}

		return null
	}

	const resolvePrimaryWaTriggerInboxId = (
		payloadNodes: Array<Record<string, unknown>>,
	): string => {
		let hasWaTrigger = false
		for (const rawNode of payloadNodes) {
			const node = toRecord(rawNode)
			if (
				String(node.type || '')
					.trim()
					.toLowerCase() !== 'trigger'
			)
				continue
			hasWaTrigger = true
			const config = toRecord(node.config)
			const inboxId = String(config.inboxId || '').trim()
			if (inboxId.length > 0) return inboxId
		}
		if (hasWaTrigger && waInboxOptions.length === 1) {
			return waInboxOptions[0]?.id || ''
		}
		return ''
	}

	const setDefaultFlowForAccount = async (targetFlowId: string) => {
		if (!targetFlowId) return
		await automationFlows.setDefault(targetFlowId)
	}

	const persistFlow = async (params: {
		requireTrigger: boolean
		forceActive?: boolean
		skipDefaultBinding?: boolean
	}) => {
		const validationError = validateFlowForPersist(params.requireTrigger)
		if (validationError) {
			toast.error(validationError)
			return null
		}

		const shouldBeActive =
			params.forceActive === true
				? true
				: !isNewFlow && selectedFlow.status === 'active'
		const payloadWorkflowName =
			workflowNameTrimmed ||
			(isNewFlow ? 'Workflow Baru' : selectedFlow.name || 'Workflow')
		const payloadNodes = workflowNodes.map((node) => {
			const settingKind = getNodeSettingKind(node)
			const mergedConfig: NodeConfig = {
				...getDefaultNodeConfig(settingKind),
				...(nodeConfigByNodeId[node.id] || {}),
			}
			const ragSourceId = ragSourceByNodeId[node.id] || ''
			if (settingKind === 'rag_retrieve') {
				if (ragSourceId) {
					mergedConfig.ragSourceId = ragSourceId
				} else {
					delete mergedConfig.ragSourceId
				}
			}

			return {
				...node,
				settingKind,
				config: mergedConfig,
				...(ragSourceId ? { ragSourceId } : {}),
			}
		})
		const primaryTriggerInboxId = resolvePrimaryWaTriggerInboxId(payloadNodes)

		try {
			let response
			if (isNewFlow) {
				response = await automationFlows.create({
					name: payloadWorkflowName,
					description: '',
					nodes: payloadNodes,
					edges: workflowEdges,
					active: shouldBeActive,
				})
			} else {
				response = await automationFlows.update(flowId, {
					name: payloadWorkflowName,
					nodes: payloadNodes,
					edges: workflowEdges,
					active: shouldBeActive,
				})
			}

			const saved = (response?.payload || {}) as FlowApiItem
			const savedId = String(saved?.id || (isNewFlow ? '' : flowId)).trim()
			if (!savedId) {
				throw new Error('ID flow tidak ditemukan saat menyimpan.')
			}

			const nowIso = new Date().toISOString()
			const summary = toFlowSummary(
				{
					...saved,
					id: savedId,
					active: shouldBeActive,
					is_active: shouldBeActive,
					updated_at: saved?.updated_at || nowIso,
					name: saved?.name || payloadWorkflowName,
				},
				0,
			)

			setFlowList((previous) => {
				const withoutCurrent = previous.filter((flow) => flow.id !== summary.id)
				const normalized =
					summary.status === 'active'
						? withoutCurrent.map((flow) => ({
								...flow,
								status: 'draft' as const,
							}))
						: withoutCurrent
				return [summary, ...normalized]
			})
			setSelectedFlowId(savedId)
			setWorkflowName(toTrimmedString(saved?.name || payloadWorkflowName))

			if (
				shouldBeActive &&
				primaryTriggerInboxId &&
				params.skipDefaultBinding !== true
			) {
				try {
					await setDefaultFlowForAccount(savedId)
					setDefaultFlowId(savedId)
				} catch {
					toast.error(
						'Workflow tersimpan, tapi gagal menghubungkan default flow akun.',
					)
				}
			}

			if (isNewFlow && savedId !== flowId) {
				navigate({
					to: '/flows/$flowId',
					params: { flowId: savedId },
					search: { execution_id: undefined },
				})
			}

			return savedId
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Gagal menyimpan workflow.'
			toast.error(message)
			return null
		}
	}

	const handlePreview = async () => {
		if (actionBusy) return
		setRunningAction('preview')
		try {
			const savedId = await persistFlow({
				requireTrigger: false,
			})
			if (!savedId) return
			setOpenSettings(false)
			setSelectedNodeId('')
			setSelectedNodeIds([])
			toast.success('Preview siap. Workflow tersimpan sebagai draft.')
		} finally {
			setRunningAction(null)
		}
	}

	const handleTestRun = async () => {
		if (actionBusy) return
		setRunningAction('test')
		try {
			const savedId = await persistFlow({
				requireTrigger: true,
			})
			if (!savedId) return

			const testRunInput = buildWhatsAppTestRunInput({
				workflowNodes,
				executionStep: selectedExecutionStep,
			})
			const testResponse = await automationFlows.testRun(savedId, testRunInput)
			const testPayload = toRecord(toRecord(testResponse).payload)
			const executed = Number(testPayload.executed || 0)
			const runExecutionId = String(
				testPayload.test_run_id || testPayload.executionId || '',
			).trim()
			await refreshExecutionsForFlow(savedId, {
				executionId: runExecutionId,
			})
			if (runExecutionId) {
				setSelectedExecutionId(runExecutionId)
			}
			setActiveTab('executions')
			toast.success(
				executed > 0
					? `Test run selesai: ${executed} node dieksekusi.`
					: 'Test run selesai. Cek tab Executions.',
			)
		} finally {
			setRunningAction(null)
		}
	}

	const handleSetDefaultFlow = async () => {
		if (actionBusy || isDefaultFlow) return
		if (deployNeedsWorkflowName) {
			toast.error('Nama workflow wajib diisi sebelum set default.')
			return
		}
		setRunningAction('default')
		try {
			const savedId = await persistFlow({
				requireTrigger: true,
				forceActive: true,
				skipDefaultBinding: true,
			})
			if (!savedId) return

			const response = await automationFlows.setDefault(savedId)
			const payload = toRecord(response?.payload)
			const nextDefaultFlowId =
				toTrimmedString(payload.default_flow_id) || savedId
			setDefaultFlowId(nextDefaultFlowId)
			setFlowList((previous) =>
				previous.map((flow) => ({
					...flow,
					status: flow.id === savedId ? 'active' : 'draft',
				})),
			)
			toast.success('Workflow ini sudah menjadi default flow akun.')
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Gagal set default flow.'
			toast.error(message)
		} finally {
			setRunningAction(null)
		}
	}

	const handleDeploy = async () => {
		if (actionBusy) return
		if (deployNeedsWorkflowName) {
			toast.error('Nama workflow wajib diisi sebelum deploy.')
			return
		}
		setRunningAction('deploy')
		try {
			const savedId = await persistFlow({
				requireTrigger: true,
				forceActive: true,
			})
			if (!savedId) return

			await refreshVersionsForFlow(savedId)
			setActiveTab('versions')
			toast.success('Workflow berhasil di-deploy.')
		} finally {
			setRunningAction(null)
		}
	}

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Workflow"
				subtitle={`${workflowDisplayName} / Workflow builder`}
			/>

			<div
				className={`min-h-0 flex-1 overflow-hidden rounded-xl border border-border bg-card ${
					showSettingsPanel
						? 'grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)_320px]'
						: 'grid grid-cols-1 lg:grid-cols-[220px_minmax(0,1fr)]'
				}`}
			>
				<aside className="max-h-[42vh] overflow-auto border-b border-border bg-muted/35 p-3 lg:max-h-none lg:border-b-0 lg:border-r">
					<div className="rounded-xl border border-border bg-card p-3">
						<p className="text-sm font-semibold">{workflowDisplayName}</p>
						<p className="mt-1 text-xs text-muted-foreground">
							Last run{' '}
							<span
								className={
									selectedFlow.status === 'active'
										? 'text-emerald-500'
										: 'text-amber-500'
								}
							>
								{selectedFlow.status === 'active' ? 'success' : 'draft'}
							</span>{' '}
							· {selectedFlow.lastRun}
						</p>
						{isDefaultFlow ? (
							<p className="mt-2 inline-flex items-center gap-1 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2 py-1 text-[11px] font-semibold text-emerald-500">
								<BadgeCheck size={12} />
								Default flow akun
							</p>
						) : null}
						<label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
							Nama Workflow
						</label>
						<input
							type="text"
							className="ocm-input mt-1"
							value={workflowName}
							onChange={(event) => setWorkflowName(event.target.value)}
							placeholder="Contoh: Follow-up Lead WA"
							disabled={actionBusy || loadingFlowDetail}
						/>
						{deployNeedsWorkflowName ? (
							<p className="mt-1 text-[11px] text-rose-500">
								Wajib isi nama workflow sebelum deploy.
							</p>
						) : null}
					</div>

					<div className="mt-4 space-y-4">
						{PALETTE_GROUPS.map((group) => (
							<div key={group.title}>
								<p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
									{group.title}
								</p>
								<div className="space-y-1">
									{group.items.map((item) => {
										const color = toneColor(item.tone)
										const locked =
											nonTriggerLocked(item) || actionBusy || loadingFlowDetail
										return (
											<button
												type="button"
												key={`${group.title}-${item.label}`}
												onClick={() => handleAddNode(item)}
												disabled={locked}
												className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground transition ${
													locked
														? 'cursor-not-allowed opacity-45'
														: 'hover:bg-muted'
												}`}
												title={
													locked
														? 'Node belum bisa ditambahkan saat ini'
														: undefined
												}
											>
												<span
													className="grid h-5 w-5 place-items-center rounded-md border"
													style={{
														color,
														background: `color-mix(in oklab, ${color} 16%, transparent)`,
														borderColor: `color-mix(in oklab, ${color} 34%, transparent)`,
													}}
												>
													<NodeGlyphIcon name={item.icon} size={11} />
												</span>
												<span className="truncate">{item.label}</span>
											</button>
										)
									})}
								</div>
							</div>
						))}
					</div>

					<button
						type="button"
						className="ocm-btn mt-3 w-full"
						disabled={actionBusy || loadingFlowDetail}
						onClick={() =>
							navigate({
								to: '/flows/$flowId',
								params: { flowId: 'new' },
								search: { execution_id: undefined },
							})
						}
					>
						<Plus size={14} />
						Buat Workflow
					</button>
				</aside>

				<section className="relative min-h-[560px] min-w-0 overflow-auto bg-background">
					<div className="absolute left-3 right-3 top-3 z-40 flex flex-wrap items-center gap-2">
						<div className="inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1">
							{WORKFLOW_TABS.map((tab) => (
								<button
									type="button"
									key={tab.id}
									onClick={() => setActiveTab(tab.id)}
									className={`rounded-md px-3 py-1 text-xs font-medium ${
										activeTab === tab.id
											? 'bg-muted text-foreground'
											: 'text-muted-foreground hover:bg-muted/80'
									}`}
								>
									{tab.label}
								</button>
							))}
						</div>

						<div className="flex-1" />

						{activeTab === 'editor' ? (
							<>
								<button
									type="button"
									className="ocm-btn"
									onClick={handleTestRun}
									disabled={actionBusy || loadingFlowDetail}
								>
									<Play size={14} />
									{runningAction === 'test' ? 'Running...' : 'Test run'}
								</button>
								<button
									type="button"
									className="ocm-btn"
									onClick={handlePreview}
									disabled={actionBusy || loadingFlowDetail}
								>
									<Eye size={14} />
									{runningAction === 'preview' ? 'Saving...' : 'Preview'}
								</button>
								<button
									type="button"
									className="ocm-btn"
									disabled={actionBusy || loadingFlowDetail}
									onClick={() => setOpenSettings((prev) => !prev)}
								>
									{openSettings ? <X size={14} /> : <Settings2 size={14} />}
									{openSettings ? 'Tutup panel' : 'Node settings'}
								</button>
								<button
									type="button"
									className={`ocm-btn ${
										isDefaultFlow
											? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500'
											: ''
									}`}
									onClick={handleSetDefaultFlow}
									disabled={setDefaultDisabled}
									title={
										deployNeedsWorkflowName
											? 'Isi nama workflow dulu'
											: isDefaultFlow
												? 'Workflow ini sudah default'
												: 'Jadikan workflow default akun'
									}
								>
									<BadgeCheck size={14} />
									{runningAction === 'default'
										? 'Setting...'
										: isDefaultFlow
											? 'Default flow'
											: 'Set default'}
								</button>
								<button
									type="button"
									className="ocm-btn ocm-btn-primary"
									onClick={handleDeploy}
									disabled={deployDisabled}
									title={
										deployNeedsWorkflowName
											? 'Isi nama workflow dulu'
											: undefined
									}
								>
									<Check size={14} />
									{runningAction === 'deploy' ? 'Deploying...' : 'Deploy'}
								</button>
							</>
						) : (
							<p className="text-xs text-muted-foreground">
								{activeTab === 'executions'
									? `${executionRows.length} execution log`
									: `${savedVersionRows.length} saved version`}
							</p>
						)}
					</div>

					{/* Execution Viewer Banner */}
					{isExecutionViewerMode && executionViewerExecutionId ? (
						<ExecutionViewerBanner
							executionId={executionViewerExecutionId}
							executionRows={executionRows}
							onClose={handleExitExecutionViewer}
						/>
					) : null}

					{activeTab === 'editor' ? (
						<div className="relative min-w-max min-h-max">
							<div
								className="relative h-[700px] min-h-full min-w-[1600px] origin-top-left"
								style={{
									transform: `scale(${viewport.scale})`,
									backgroundImage:
										'radial-gradient(color-mix(in oklab, var(--border) 68%, transparent) 1px, transparent 1px)',
									backgroundSize: '24px 24px',
								}}
							>
								<div
									ref={canvasRef}
									className="absolute inset-0"
									onPointerDown={handleCanvasPointerDown}
									onContextMenu={handleCanvasContextMenu}
								>
									<svg
										width={CANVAS_WIDTH}
										height={CANVAS_HEIGHT}
										className="absolute left-0 top-0 overflow-visible"
									>
										<defs>
											<marker
												id="workflow-arrow"
												viewBox="0 0 10 10"
												refX="8"
												refY="5"
												markerWidth="6"
												markerHeight="6"
												orient="auto"
											>
												<path
													d="M0 0L10 5L0 10"
													fill="none"
													stroke="color-mix(in oklab, var(--border) 92%, transparent)"
													strokeWidth="1.5"
												/>
											</marker>
										</defs>

										{draftEdge
											? (() => {
													const fromNode = workflowNodes.find(
														(n) => n.id === draftEdge.sourceId,
													)
													if (!fromNode) return null
													const draftTargetNode: WorkflowNode = {
														...fromNode,
														id: 'draft-edge-target',
														x: draftEdge.endX,
														y: draftEdge.endY - NODE_HEIGHT / 2,
													}
													return (
														<path
															d={edgePath(fromNode, draftTargetNode)}
															fill="none"
															stroke="var(--ocm-accent)"
															strokeWidth="2.3"
															strokeDasharray="4 4"
															markerEnd="url(#workflow-arrow)"
														/>
													)
												})()
											: null}

										{workflowEdges.map(([fromId, toId]) => {
											const from = workflowNodes.find(
												(node) => node.id === fromId,
											)
											const to = workflowNodes.find((node) => node.id === toId)
											if (!from || !to) return null
											const highlighted =
												fromId === selectedNodeId ||
												toId === selectedNodeId ||
												(selectedExecutionId &&
													executionNodePathByRun.executionNodeSet.has(fromId) &&
													executionNodePathByRun.executionNodeSet.has(toId))
											const highlightColor = toneColor(to.tone)

											return (
												<g
													key={`${fromId}-${toId}`}
													className="group pointer-events-auto"
												>
													<path
														d={edgePath(from, to)}
														fill="none"
														stroke={
															highlighted
																? `color-mix(in oklab, ${highlightColor} 68%, var(--ocm-accent) 32%)`
																: 'color-mix(in oklab, var(--border) 86%, transparent)'
														}
														strokeWidth={highlighted ? 2.3 : 1.7}
														markerEnd="url(#workflow-arrow)"
													/>
													<path
														d={edgePath(from, to)}
														fill="none"
														stroke="transparent"
														strokeWidth={16}
														className="cursor-pointer"
														onPointerDown={(e) => {
															if (e.button === 2) {
																e.stopPropagation()
																e.preventDefault()
																setWorkflowEdges((prev) =>
																	prev.filter(
																		([s, t]) => !(s === fromId && t === toId),
																	),
																)
															}
														}}
														onDoubleClick={(e) => {
															e.stopPropagation()
															setWorkflowEdges((prev) =>
																prev.filter(
																	([s, t]) => !(s === fromId && t === toId),
																),
															)
														}}
														onContextMenu={(e) => {
															e.preventDefault()
															e.stopPropagation()
														}}
													/>
												</g>
											)
										})}
									</svg>

									{workflowNodes.map((node) => {
										const selected = selectedNodeIds.includes(node.id)
										const color = toneColor(node.tone)
										const dragging = draggingNodeId === node.id
										const inExecutionPath =
											executionNodePathByRun.executionNodeSet.has(node.id)
										const executionOrder = executionNodePathByRun.pathMap.get(
											node.id,
										)
										const pathFocused =
											!!selectedExecutionId &&
											(inExecutionPath || node.id === selectedNodeData?.id)
										return (
											<button
												type="button"
												key={node.id}
												data-node-id={node.id}
												onPointerDown={(event) =>
													handleNodePointerDown(event, node)
												}
												onClick={() => handleNodeClick(node.id)}
												className={`absolute w-[220px] rounded-xl border bg-card px-3 py-2 text-left transition-[box-shadow,transform,border-color] ${
													dragging
														? 'cursor-grabbing'
														: 'cursor-grab hover:-translate-y-0.5'
												}`}
												style={{
													left: node.x,
													top: node.y,
													zIndex: dragging ? 18 : selected ? 16 : 12,
													touchAction: 'none',
													userSelect: 'none',
													borderColor: selected
														? `color-mix(in oklab, ${color} 45%, transparent)`
														: pathFocused
															? `color-mix(in oklab, ${color} 75%, transparent)`
															: 'var(--border)',
													boxShadow: selected
														? `0 0 0 2px color-mix(in oklab, ${color} 22%, transparent), 0 10px 20px -18px rgba(0, 0, 0, 0.7)`
														: pathFocused
															? `0 0 0 2px color-mix(in oklab, ${color} 14%, transparent), 0 10px 20px -18px rgba(0, 0, 0, 0.6)`
															: '0 10px 20px -20px rgba(0, 0, 0, 0.6)',
												}}
											>
												<div className="flex items-center gap-2">
													<span
														className="grid h-6 w-6 place-items-center rounded-md border"
														style={toneChipStyle(node.tone)}
													>
														<NodeGlyphIcon name={node.icon} size={12} />
													</span>
													<p className="line-clamp-1 text-sm font-semibold">
														{node.label}
													</p>
													{executionOrder !== undefined ? (
														<span className="ml-auto rounded border border-border/70 px-2 py-0.5 text-[10px] text-muted-foreground">
															#{executionOrder + 1}
														</span>
													) : null}
													<span
														className="ml-auto h-2.5 w-2.5 rounded-full cursor-crosshair border border-card"
														onPointerDown={(event) =>
															handleEdgeDragPointerDown(event, node.id)
														}
														style={{
															background:
																node.tone === 'rose'
																	? 'color-mix(in oklab, var(--ocm-danger) 88%, white 12%)'
																	: 'var(--ocm-success)',
														}}
														title="Tarik panah untuk menyambungkan node"
													/>
												</div>
												<p className="mt-2 line-clamp-1 text-xs text-muted-foreground">
													{node.sub}
												</p>
												{node.stats ? (
													<div className="mt-2 flex items-center justify-between border-t border-border/80 pt-1 text-[10px]">
														<span className="text-muted-foreground">
															{node.stats.left}
														</span>
														<span
															style={{
																color:
																	node.id === 'n5'
																		? 'var(--ocm-accent)'
																		: 'var(--ocm-success)',
															}}
														>
															{node.stats.right}
														</span>
													</div>
												) : null}
											</button>
										)
									})}

									{marqueeRect ? (
										<div
											className="pointer-events-none absolute rounded-md border border-sky-400/80 bg-sky-400/10"
											style={{
												left: marqueeRect.left,
												top: marqueeRect.top,
												width: marqueeRect.width,
												height: marqueeRect.height,
												zIndex: 14,
											}}
										/>
									) : null}

									{/* Execution Viewer: Node status badges */}
									{isExecutionViewerMode && executionViewerExecutionId
										? workflowNodes.map((node) => {
												const stepsForNode = executionRows.filter(
													(row) =>
														row.executionId === executionViewerExecutionId &&
														row.nodeId === node.id,
												)
												if (stepsForNode.length === 0) return null
												const step = stepsForNode[0]
												const isError = step.status === 'error' || !!step.error
												const isSuccess =
													step.status === 'success' ||
													step.status === 'completed'
												return (
													<div
														key={`exec-badge-${node.id}`}
														className="pointer-events-none absolute"
														style={{
															left: node.x + 186,
															top: node.y - 8,
															zIndex: 20,
														}}
													>
														<span
															className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider shadow-sm border ${isError ? 'bg-red-100 text-red-600 border-red-200' : isSuccess ? 'bg-emerald-100 text-emerald-600 border-emerald-200' : 'bg-gray-100 text-gray-500 border-gray-200'}`}
														>
															<span
																className={`h-1.5 w-1.5 rounded-full ${isError ? 'bg-red-500' : isSuccess ? 'bg-emerald-500' : 'bg-gray-400'}`}
															/>
															{isError
																? 'Error'
																: isSuccess
																	? 'OK'
																	: step.status}
														</span>
													</div>
												)
											})
										: null}

									{/* Execution Viewer: Node execution popup */}
									{isExecutionViewerMode && executionPopupState
										? (() => {
												const popupNode =
													workflowNodes.find(
														(n) => n.id === executionPopupState.nodeId,
													) || null
												const popupNodeConfig = popupNode
													? {
															...getDefaultNodeConfig(
																getNodeSettingKind(popupNode),
															),
															...(nodeConfigByNodeId[popupNode.id] || {}),
														}
													: null
												const popupNodeSettingKind: NodeSettingKind = popupNode
													? getNodeSettingKind(popupNode)
													: 'generic'
												return (
													<NodeExecutionPopup
														state={executionPopupState}
														node={popupNode}
														nodeConfig={popupNodeConfig}
														nodeSettingKind={popupNodeSettingKind}
														flowId={flowId}
														onClose={() => setExecutionPopupState(null)}
													/>
												)
											})()
										: null}

									{workflowNodes.length === 0 ? (
										<div className="absolute inset-0 grid place-items-center px-6">
											<div className="max-w-md rounded-2xl border border-dashed border-border bg-card/90 p-6 text-center">
												<p className="text-base font-semibold">Workflow Baru</p>
												<p className="mt-1 text-sm text-muted-foreground">
													Belum ada node. Mulai dari panel kiri untuk menyusun
													alur workflow.
												</p>
											</div>
										</div>
									) : null}
								</div>

								<div className="absolute bottom-3 left-3 flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 text-[11px] text-muted-foreground">
									<BadgeCheck size={12} className="text-emerald-500" />
									<span>{isNewFlow ? 'draft' : 'live'}</span>
									<span>v4.2.1</span>
									<span>{workflowNodes.length} nodes</span>
									<span>
										{isNewFlow
											? 'draft belum disimpan'
											: `last edit · ${flowList.find((f) => f.id === flowId)?.lastRun || 'baru saja'}`}
									</span>
								</div>

								<div className="absolute bottom-3 right-3 inline-flex items-center gap-1 rounded-lg border border-border bg-card p-1 text-[11px]">
									<button
										type="button"
										className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted"
										onClick={() =>
											setViewport((prev) => ({
												scale: Math.max(0.2, prev.scale - 0.1),
											}))
										}
									>
										-
									</button>
									<span className="rounded bg-muted px-2 py-0.5 text-foreground">
										{Math.round(viewport.scale * 100)}%
									</span>
									<button
										type="button"
										className="rounded px-2 py-0.5 text-muted-foreground hover:bg-muted"
										onClick={() =>
											setViewport((prev) => ({
												scale: Math.min(3, prev.scale + 0.1),
											}))
										}
									>
										+
									</button>
								</div>
							</div>
						</div>
					) : (
						<div className="min-h-full px-3 pb-3 pt-14">
							{activeTab === 'executions' ? (
								<div className="grid min-h-full gap-3 px-3 pb-3 pt-14 lg:grid-cols-[360px_minmax(0,1fr)]">
									<div className="rounded-xl border border-border bg-card">
										<div className="space-y-3 border-b border-border px-4 py-3">
											<div className="flex flex-wrap items-center gap-2">
												<p className="text-sm font-semibold">Execution Logs</p>
												<span className="ml-auto text-[11px] text-muted-foreground">
													{loadingExecutions
														? 'Memuat...'
														: `${executionRowsForDisplay.length} records`}
												</span>
											</div>
											<div className="grid gap-2 sm:grid-cols-[1fr_1.2fr]">
												<input
													type="text"
													className="ocm-input text-xs"
													value={executionConversationFilter}
													onChange={(event) =>
														setExecutionConversationFilter(event.target.value)
													}
													placeholder="Filter Conversation ID"
												/>
												<div className="grid gap-2 sm:grid-cols-[1fr_auto]">
													<select
														className="ocm-select text-xs"
														value={selectedExecutionId}
														onChange={(event) =>
															setSelectedExecutionId(event.target.value)
														}
													>
														{orderedExecutionIds.length === 0 ? (
															<option value="">Tidak ada execution</option>
														) : null}
														{orderedExecutionIds.map((executionId) => {
															const runRows =
																executionGroups.get(executionId) || []
															const lastConversationId =
																runRows[0]?.conversationId || '-'
															const lastTime = runRows[0]?.createdAt
															return (
																<option key={executionId} value={executionId}>
																	{executionId} · {lastConversationId} ·{' '}
																	{lastTime ? formatDateTime(lastTime) : '-'}
																</option>
															)
														})}
													</select>
													<button
														type="button"
														className="ocm-btn px-2 text-xs"
														onClick={() => {
															if (!isNewFlow && selectedExecutionId) {
																refreshExecutionsForFlow(flowId, {
																	conversationId:
																		executionConversationFilter.trim(),
																	executionId: selectedExecutionId,
																})
															}
														}}
													>
														Refresh
													</button>
												</div>
											</div>
										</div>
										<div className="max-h-[420px] overflow-auto p-3">
											{loadingExecutions ? (
												<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
													Memuat execution logs...
												</div>
											) : executionRowsForDisplay.length === 0 ? (
												<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
													Belum ada execution logs untuk workflow ini.
												</div>
											) : (
												<div className="space-y-2">
													{executionRowsForDisplay.map((row) => {
														const isSelected =
															selectedExecutionStepId === row.id ||
															(selectedExecutionStepId === '' &&
																executionRowsForDisplay[0]?.id === row.id)
														return (
															<button
																type="button"
																key={row.id}
																onClick={() => handleExecutionStepClick(row)}
																className={`w-full rounded-lg border border-border bg-background p-3 text-left transition ${
																	isSelected ? 'ring-2 ring-emerald-500/70' : ''
																}`}
															>
																<div className="flex items-center gap-2">
																	<p className="text-xs font-semibold capitalize">
																		{row.event.replace(/_/g, ' ')} ·{' '}
																		{row.nodeType}
																	</p>
																	<span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
																		{row.status}
																	</span>
																</div>
																<p className="mt-1 truncate text-xs text-muted-foreground">
																	{row.preview}
																</p>
																<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
																	<span>Node: {row.nodeId}</span>
																	<span>
																		Conversation: {row.conversationId}
																	</span>
																	<span>{formatDateTime(row.createdAt)}</span>
																</div>
																<div className="mt-2 flex items-center gap-2">
																	<button
																		type="button"
																		className="text-[11px] text-primary underline"
																		onClick={(event) => {
																			event.stopPropagation()
																			handleOpenExecutionStepInEditor(row)
																		}}
																	>
																		Lihat di Editor
																	</button>
																</div>
															</button>
														)
													})}
												</div>
											)}
										</div>
									</div>

									<div className="rounded-xl border border-border bg-card">
										<div className="flex items-center justify-between border-b border-border px-4 py-3">
											<p className="text-sm font-semibold">Detail Langkah</p>
											{selectedExecutionStep ? (
												<p className="text-xs text-muted-foreground">
													{selectedExecutionStep.event.replace(/_/g, ' ')}
												</p>
											) : null}
										</div>
										<div className="max-h-[620px] overflow-auto p-3">
											{!selectedExecutionStep ? (
												<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
													Pilih 1 row eksekusi untuk melihat input/output node.
												</div>
											) : (
												<div className="space-y-3">
													<div>
														<p className="text-xs font-semibold">Node</p>
														<p className="text-sm">
															{workflowNodes.find(
																(node) =>
																	node.id === selectedExecutionStep.nodeId,
															)?.label || selectedExecutionStep.nodeId}
														</p>
													</div>
													<div>
														<p className="text-xs font-semibold">
															Path (urutan)
														</p>
														<p className="text-xs text-muted-foreground">
															{selectedExecutionStep.path.length > 0
																? selectedExecutionStep.path.join(' → ')
																: '-'}
														</p>
													</div>
													{selectedExecutionStep.error ? (
														<div className="rounded-lg border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-700">
															<p className="font-semibold">Error</p>
															<pre className="mt-1 overflow-auto whitespace-pre-wrap">
																{selectedExecutionStep.error}
															</pre>
														</div>
													) : null}
													<div>
														<p className="text-xs font-semibold">Input</p>
														<pre className="mt-1 max-h-52 overflow-auto rounded border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
															{safeJsonStringify(selectedExecutionStep.input, {
																space: 2,
																limit: 6000,
																fallback: '{}',
															})}
														</pre>
													</div>
													<div>
														<p className="text-xs font-semibold">Output</p>
														<pre className="mt-1 max-h-52 overflow-auto rounded border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
															{safeJsonStringify(selectedExecutionStep.output, {
																space: 2,
																limit: 6000,
																fallback: '{}',
															})}
														</pre>
													</div>
													<div className="grid gap-2 sm:grid-cols-2">
														<div>
															<p className="text-xs font-semibold">
																Variables Delta
															</p>
															<pre className="mt-1 max-h-44 overflow-auto rounded border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
																{safeJsonStringify(
																	selectedExecutionStep.variablesDelta,
																	{ space: 2, limit: 6000, fallback: '{}' },
																)}
															</pre>
														</div>
														<div>
															<p className="text-xs font-semibold">Branch</p>
															<pre className="mt-1 max-h-44 overflow-auto rounded border border-border bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
																{safeJsonStringify(
																	selectedExecutionStep.branch,
																	{
																		space: 2,
																		limit: 3000,
																		fallback: '{}',
																	},
																)}
															</pre>
														</div>
													</div>
												</div>
											)}
										</div>
									</div>
								</div>
							) : (
								<div className="rounded-xl border border-border bg-card">
									<div className="flex items-center justify-between border-b border-border px-4 py-3">
										<p className="text-sm font-semibold">Saved Versions</p>
										<p className="text-xs text-muted-foreground">
											{loadingSavedVersions
												? 'Memuat...'
												: `${savedVersionRows.length} versions`}
										</p>
									</div>
									<div className="max-h-[620px] overflow-auto p-3">
										{loadingSavedVersions ? (
											<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
												Memuat saved versions...
											</div>
										) : savedVersionRows.length === 0 ? (
											<div className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
												Belum ada versi tersimpan untuk workflow ini.
											</div>
										) : (
											<div className="space-y-2">
												{savedVersionRows.map((version) => (
													<div
														key={version.id}
														className="rounded-lg border border-border bg-background p-3"
													>
														<div className="flex items-center gap-2">
															<p className="text-sm font-semibold">
																{version.label}
															</p>
															<span className="ml-auto rounded-full border border-border px-2 py-0.5 text-[10px] uppercase text-muted-foreground">
																{version.status}
															</span>
														</div>
														<p className="mt-1 text-xs text-muted-foreground">
															{version.summary}
														</p>
														<div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
															<span>{version.nodesCount} nodes</span>
															<span>{version.edgesCount} edges</span>
															<span>{formatDateTime(version.savedAt)}</span>
															{version.isActive ? (
																<span className="text-emerald-500">active</span>
															) : null}
														</div>
													</div>
												))}
											</div>
										)}
									</div>
								</div>
							)}
						</div>
					)}
				</section>

				{showSettingsPanel ? (
					<aside className="max-h-[45vh] overflow-auto border-t border-border bg-muted/35 lg:max-h-none lg:border-l lg:border-t-0">
						{selectedNodeData ? (
							<>
								<div className="border-b border-border p-4">
									<div className="mb-3 flex items-center gap-3">
										<span
											className="grid h-9 w-9 place-items-center rounded-lg border"
											style={{
												...toneChipStyle(selectedNodeData.tone),
												background: `color-mix(in oklab, ${selectedNodeTone} 20%, transparent)`,
											}}
										>
											<NodeGlyphIcon name={selectedNodeData.icon} size={14} />
										</span>
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold">
												{selectedNodeData.label}
											</p>
											<p className="text-xs text-muted-foreground">
												{selectedNodeData.id} · {selectedNodeData.type}
											</p>
										</div>
										<button
											type="button"
											onClick={handleDeleteSelectedNode}
											className="ocm-btn ml-auto h-8 px-2 text-xs text-red-500 hover:bg-red-500/10"
										>
											Hapus
										</button>
									</div>

									<div className="grid grid-cols-2 gap-2">
										<button
											type="button"
											className="ocm-btn w-full"
											onClick={handleTestRun}
											disabled={actionBusy || loadingFlowDetail}
										>
											<Play size={14} />
											{runningAction === 'test' ? 'Running...' : 'Test'}
										</button>
										<button
											type="button"
											className="ocm-btn w-full"
											onClick={handleDuplicateSelectedNode}
										>
											Duplicate
										</button>
									</div>

									<p className="mt-2 text-[11px] text-muted-foreground">
										Wajib ada minimal 1 trigger saat simpan/deploy.
									</p>
								</div>

								<PropertyGroup label="Node Name">
									<input
										type="text"
										className="ocm-input"
										value={selectedNodeData.label}
										onChange={(event) =>
											handleRenameSelectedNode(event.target.value)
										}
										placeholder="Nama node"
									/>
								</PropertyGroup>

								{selectedNodeSettingKind === 'wa_message_in' ? (
									<PropertyGroup label="Inbox ID">
										<select
											className="ocm-select"
											value={selectedNodeConfig?.inboxId || ''}
											onChange={(event) => {
												const nextInboxId = event.target.value
												updateSelectedNodeConfig({ inboxId: nextInboxId })
												const nextInbox = waInboxOptions.find(
													(item) => item.id === nextInboxId,
												)
												updateSelectedNodeSub(
													nextInbox
														? `${nextInbox.name} · ${nextInbox.channelType}`
														: 'Meta Cloud API · semua nomor',
												)
											}}
											disabled={loadingInboxes}
										>
											<option value="">Semua inbox WhatsApp</option>
											{waInboxOptions.map((inbox) => (
												<option key={inbox.id} value={inbox.id}>
													{inbox.name} ({inbox.channelType})
												</option>
											))}
										</select>
										<p className="mt-2 text-[11px] text-muted-foreground">
											{loadingInboxes
												? 'Memuat daftar inbox...'
												: selectedInbox
													? `Inbox aktif: ${selectedInbox.name}`
													: 'Trigger menerima pesan dari seluruh inbox WhatsApp.'}
										</p>
									</PropertyGroup>
								) : null}

								{selectedNodeSettingKind === 'schedule_trigger' ? (
									<>
										<PropertyGroup label="Cron Schedule">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.scheduleCron || ''}
												onChange={(event) => {
													const scheduleCron = event.target.value
													updateSelectedNodeConfig({ scheduleCron })
													updateSelectedNodeSub(
														`${scheduleCron || '0 9 * * *'} · ${
															selectedNodeConfig?.scheduleTimezone ||
															'Asia/Jakarta'
														}`,
													)
												}}
												placeholder="0 9 * * *"
											/>
										</PropertyGroup>
										<PropertyGroup label="Timezone">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.scheduleTimezone || ''}
												onChange={(event) => {
													const scheduleTimezone = event.target.value
													updateSelectedNodeConfig({ scheduleTimezone })
													updateSelectedNodeSub(
														`${selectedNodeConfig?.scheduleCron || '0 9 * * *'} · ${
															scheduleTimezone || 'Asia/Jakarta'
														}`,
													)
												}}
												placeholder="Asia/Jakarta"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'webhook_trigger' ? (
									<>
										<PropertyGroup label="Method">
											<select
												className="ocm-select"
												value={selectedNodeConfig?.webhookMethod || 'POST'}
												onChange={(event) => {
													const webhookMethod = event.target.value as
														| 'GET'
														| 'POST'
													updateSelectedNodeConfig({ webhookMethod })
													updateSelectedNodeSub(
														`${webhookMethod} · ${selectedNodeConfig?.webhookUrl || 'endpoint belum diisi'}`,
													)
												}}
											>
												<option value="POST">POST</option>
												<option value="GET">GET</option>
											</select>
										</PropertyGroup>
										<PropertyGroup label="Endpoint URL">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.webhookUrl || ''}
												onChange={(event) => {
													const webhookUrl = event.target.value
													updateSelectedNodeConfig({ webhookUrl })
													updateSelectedNodeSub(
														`${selectedNodeConfig?.webhookMethod || 'POST'} · ${
															webhookUrl || 'endpoint belum diisi'
														}`,
													)
												}}
												placeholder="https://example.com/webhook"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'llm_call' ? (
									<>
										<PropertyGroup label="Model">
											<select
												className="ocm-select"
												value={
													selectedNodeConfig?.llmModel ||
													llmNodeModelOptions[0]?.id ||
													''
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														llmModel: event.target.value,
													})
												}
											>
												{llmNodeModelOptions.map((model) => (
													<option key={model.id} value={model.id}>
														{formatModelOptionLabel(model)}
													</option>
												))}
											</select>
											<p className="mt-2 text-[11px] text-muted-foreground">
												Provider aktif: {activeAiProvider}
												{loadingAiModels ? ' · memuat model...' : ''}
											</p>
										</PropertyGroup>
										<PropertyGroup label="System Prompt">
											<textarea
												className="ocm-input min-h-24 resize-y"
												value={selectedNodeConfig?.llmPrompt || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														llmPrompt: event.target.value,
													})
												}
											/>
										</PropertyGroup>
										<PropertyGroup label="Temperature">
											<div className="flex items-center gap-3">
												<input
													type="range"
													min={0}
													max={100}
													value={selectedNodeConfig?.llmTemperature || 35}
													onChange={(event) =>
														updateSelectedNodeConfig({
															llmTemperature: Number(event.target.value),
														})
													}
													className="w-full"
												/>
												<span className="w-8 text-right text-xs text-muted-foreground">
													{(
														(selectedNodeConfig?.llmTemperature || 35) / 100
													).toFixed(2)}
												</span>
											</div>
										</PropertyGroup>
										<PropertyGroup label="Output Variable">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.llmOutputVar || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														llmOutputVar: event.target.value,
													})
												}
												placeholder="reply.text"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'intent_classifier' ? (
									<>
										<PropertyGroup label="Model">
											<select
												className="ocm-select"
												value={
													selectedNodeConfig?.intentModel ||
													intentNodeModelOptions[0]?.id ||
													''
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														intentModel: event.target.value,
													})
												}
											>
												{intentNodeModelOptions.map((model) => (
													<option key={model.id} value={model.id}>
														{formatModelOptionLabel(model)}
													</option>
												))}
											</select>
										</PropertyGroup>
										<PropertyGroup label="Intent List">
											<div className="mb-2 flex items-center justify-between gap-2">
												<p className="text-[11px] text-muted-foreground">
													Classifier membaca maksud chat user, misal harga,
													keluhan, retur, pengiriman.
												</p>
												<button
													type="button"
													className="ocm-btn h-7 px-2 text-[11px]"
													onClick={handleApplyLeadIntentPreset}
												>
													Preset Lead
												</button>
											</div>
											<textarea
												className="ocm-input min-h-24 resize-y"
												value={selectedNodeConfig?.intentLabels || ''}
												onChange={(event) => {
													const intentLabels = event.target.value
													updateSelectedNodeConfig({ intentLabels })
													const total =
														parseIntentLabelList(intentLabels).length
													updateSelectedNodeSub(
														`${total} intent · output ${selectedNodeConfig?.intentOutputVar || 'intent.label'}`,
													)
													syncDownstreamSwitchRoutesFromIntent(
														selectedNodeData.id,
														intentLabels,
													)
												}}
												placeholder="harga, keluhan, retur, pengiriman, pembayaran, produk, lainnya"
											/>
										</PropertyGroup>
										<PropertyGroup label="Confidence Threshold (%)">
											<div className="mb-2 flex items-center justify-between gap-2">
												<p className="text-[11px] text-muted-foreground">
													Set output ke "default/unknown" jika skor kepastian AI
													di bawah batas ini.
												</p>
											</div>
											<input
												type="number"
												className="ocm-input"
												min={0}
												max={100}
												value={
													selectedNodeConfig?.intentConfidenceThreshold || 70
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														intentConfidenceThreshold: Number(
															event.target.value,
														),
													})
												}
											/>
										</PropertyGroup>
										<PropertyGroup label="Output Variable">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.intentOutputVar || ''}
												onChange={(event) => {
													const intentOutputVar = event.target.value
													updateSelectedNodeConfig({ intentOutputVar })
													const total = parseIntentLabelList(
														selectedNodeConfig?.intentLabels || '',
													).length
													updateSelectedNodeSub(
														`${total} intent · output ${intentOutputVar || 'intent.label'}`,
													)
													syncDownstreamSwitchVariableFromIntent(
														selectedNodeData.id,
														intentOutputVar,
													)
												}}
												placeholder="intent.label"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'sentiment' ? (
									<>
										<PropertyGroup label="Model">
											<select
												className="ocm-select"
												value={
													selectedNodeConfig?.sentimentModel ||
													sentimentNodeModelOptions[0]?.id ||
													''
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														sentimentModel: event.target.value,
													})
												}
											>
												{sentimentNodeModelOptions.map((model) => (
													<option key={model.id} value={model.id}>
														{formatModelOptionLabel(model)}
													</option>
												))}
											</select>
										</PropertyGroup>
										<PropertyGroup label="Sentiment Mode">
											<select
												className="ocm-select"
												value={selectedNodeConfig?.sentimentMode || 'label'}
												onChange={(event) =>
													updateSelectedNodeConfig({
														sentimentMode: event.target.value as
															| 'label'
															| 'score',
													})
												}
											>
												<option value="label">
													Label (positive/neutral/negative)
												</option>
												<option value="score">Score (0-1)</option>
											</select>
										</PropertyGroup>
										<PropertyGroup label="Threshold">
											<div className="flex items-center gap-3">
												<input
													type="range"
													min={0}
													max={100}
													value={selectedNodeConfig?.sentimentThreshold || 70}
													onChange={(event) =>
														updateSelectedNodeConfig({
															sentimentThreshold: Number(event.target.value),
														})
													}
													className="w-full"
												/>
												<span className="w-8 text-right text-xs text-muted-foreground">
													{(
														(selectedNodeConfig?.sentimentThreshold || 70) / 100
													).toFixed(2)}
												</span>
											</div>
										</PropertyGroup>
										<PropertyGroup label="Output Variable">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.sentimentOutputVar || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														sentimentOutputVar: event.target.value,
													})
												}
												placeholder="sentiment.label"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'rag_retrieve' ? (
									<>
										<PropertyGroup label="Model">
											<select
												className="ocm-select"
												value={
													selectedNodeConfig?.ragModel ||
													ragNodeModelOptions[0]?.id ||
													''
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														ragModel: event.target.value,
													})
												}
											>
												{ragNodeModelOptions.map((model) => (
													<option key={model.id} value={model.id}>
														{formatModelOptionLabel(model)}
													</option>
												))}
											</select>
										</PropertyGroup>
										<PropertyGroup label="RAG Knowledge Source">
											<select
												className="ocm-select"
												value={selectedRagSourceId}
												onChange={(event) =>
													handleSelectRagSource(event.target.value)
												}
												disabled={loadingRagSources}
											>
												<option value="">{RAG_ALL_SOURCES_LABEL}</option>
												{ragSources.map((source) => (
													<option key={source.id} value={source.id}>
														{formatRagSourceOptionLabel(source)}
													</option>
												))}
											</select>
										</PropertyGroup>
										<PropertyGroup label="Top K">
											<input
												type="number"
												className="ocm-input"
												min={1}
												max={20}
												value={selectedNodeConfig?.ragTopK || 5}
												onChange={(event) => {
													const ragTopK = Number(event.target.value || 5)
													updateSelectedNodeConfig({ ragTopK })
													const sourceName =
														selectedRagSource?.name || RAG_ALL_SOURCES_LABEL
													updateSelectedNodeSub(
														`${sourceName} · top_k=${ragTopK}`,
													)
												}}
											/>
										</PropertyGroup>
										<PropertyGroup label="Query Variable">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.ragQueryVariable || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														ragQueryVariable: event.target.value,
													})
												}
												placeholder="message.text"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'summarize_chat' ? (
									<>
										<PropertyGroup label="Model">
											<select
												className="ocm-select"
												value={
													selectedNodeConfig?.summarizeModel ||
													summarizeNodeModelOptions[0]?.id ||
													''
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														summarizeModel: event.target.value,
													})
												}
											>
												{summarizeNodeModelOptions.map((model) => (
													<option key={model.id} value={model.id}>
														{formatModelOptionLabel(model)}
													</option>
												))}
											</select>
										</PropertyGroup>
										<PropertyGroup label="Message Window">
											<input
												type="number"
												className="ocm-input"
												min={5}
												max={200}
												value={selectedNodeConfig?.summarizeWindow || 20}
												onChange={(event) =>
													updateSelectedNodeConfig({
														summarizeWindow: Number(event.target.value || 20),
													})
												}
											/>
										</PropertyGroup>
										<PropertyGroup label="Output Variable">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.summarizeOutputVar || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														summarizeOutputVar: event.target.value,
													})
												}
												placeholder="summary.text"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'switch_router' ? (
									<>
										<PropertyGroup label="Switch Variable">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.switchVariable || ''}
												onChange={(event) => {
													updateSelectedNodeConfig({
														switchVariable: event.target.value,
													})
												}}
												placeholder="decision.recommended_action"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'if_else' ? (
									<PropertyGroup label="Condition Expression">
										<textarea
											className="ocm-input min-h-24 resize-y"
											value={selectedNodeConfig?.ifCondition || ''}
											onChange={(event) =>
												updateSelectedNodeConfig({
													ifCondition: event.target.value,
												})
											}
											placeholder="intent.label == 'tanya_stok'"
										/>
									</PropertyGroup>
								) : null}

								{selectedNodeSettingKind === 'wait' ? (
									<>
										<PropertyGroup label="Wait Duration">
											<input
												type="number"
												className="ocm-input"
												min={1}
												value={selectedNodeConfig?.waitValue || 5}
												onChange={(event) => {
													const waitValue = Number(event.target.value || 1)
													updateSelectedNodeConfig({ waitValue })
													updateSelectedNodeSub(
														`Tunda ${waitValue} ${selectedNodeConfig?.waitUnit || 'minutes'}`,
													)
												}}
											/>
										</PropertyGroup>
										<PropertyGroup label="Unit">
											<select
												className="ocm-select"
												value={selectedNodeConfig?.waitUnit || 'minutes'}
												onChange={(event) => {
													const waitUnit = event.target.value as
														| 'seconds'
														| 'minutes'
														| 'hours'
													updateSelectedNodeConfig({ waitUnit })
													updateSelectedNodeSub(
														`Tunda ${selectedNodeConfig?.waitValue || 5} ${waitUnit}`,
													)
												}}
											>
												<option value="seconds">seconds</option>
												<option value="minutes">minutes</option>
												<option value="hours">hours</option>
											</select>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'send_wa_reply' ? (
									<PropertyGroup label="Reply Template">
										<textarea
											className="ocm-input min-h-24 resize-y"
											value={selectedNodeConfig?.waReplyTemplate || ''}
											onChange={(event) =>
												updateSelectedNodeConfig({
													waReplyTemplate: event.target.value,
												})
											}
											placeholder="Halo {{contact.name}}, stok ready ya Kak."
										/>
									</PropertyGroup>
								) : null}

								{selectedNodeSettingKind === 'handover_cs' ? (
									<>
										<PropertyGroup label="Handover Criteria">
											<div className="space-y-3 text-xs">
												<label className="flex items-center gap-2 text-muted-foreground">
													<input
														type="checkbox"
														checked={Boolean(
															selectedNodeConfig?.handoverEnableLowConfidence,
														)}
														onChange={(event) =>
															updateHandoverNodeConfig({
																handoverEnableLowConfidence:
																	event.target.checked,
															})
														}
													/>
													<span>Low confidence</span>
												</label>
												{selectedNodeConfig?.handoverEnableLowConfidence ? (
													<div className="pl-6">
														<div className="flex items-center gap-3">
															<input
																type="range"
																min={0}
																max={99}
																step={1}
																value={Math.round(
																	(selectedNodeConfig?.handoverConfidenceThreshold ||
																		0.7) * 100,
																)}
																onChange={(event) =>
																	updateHandoverNodeConfig({
																		handoverConfidenceThreshold:
																			Number(event.target.value) / 100,
																	})
																}
																className="w-full"
															/>
															<span className="w-8 text-right text-xs text-muted-foreground">
																{formatConfidenceThreshold(
																	selectedNodeConfig?.handoverConfidenceThreshold ||
																		0.7,
																)}
															</span>
														</div>
													</div>
												) : null}

												<label className="flex items-center gap-2 text-muted-foreground">
													<input
														type="checkbox"
														checked={Boolean(
															selectedNodeConfig?.handoverEnableKeyword,
														)}
														onChange={(event) =>
															updateHandoverNodeConfig({
																handoverEnableKeyword: event.target.checked,
															})
														}
													/>
													<span>Keyword match</span>
												</label>
												{selectedNodeConfig?.handoverEnableKeyword ? (
													<div className="pl-6">
														<textarea
															className="ocm-input min-h-16 resize-y"
															value={selectedNodeConfig?.handoverKeywords || ''}
															onChange={(event) =>
																updateHandoverNodeConfig({
																	handoverKeywords: event.target.value,
																})
															}
															placeholder="agent, admin, cs, manusia"
														/>
													</div>
												) : null}

												<label className="flex items-center gap-2 text-muted-foreground">
													<input
														type="checkbox"
														checked={Boolean(
															selectedNodeConfig?.handoverEnableNegativeSentiment,
														)}
														onChange={(event) =>
															updateHandoverNodeConfig({
																handoverEnableNegativeSentiment:
																	event.target.checked,
															})
														}
													/>
													<span>Negative sentiment</span>
												</label>

												<label className="flex items-center gap-2 text-muted-foreground">
													<input
														type="checkbox"
														checked={Boolean(
															selectedNodeConfig?.handoverEnableEscalationRequest,
														)}
														onChange={(event) =>
															updateHandoverNodeConfig({
																handoverEnableEscalationRequest:
																	event.target.checked,
															})
														}
													/>
													<span>User asks for human agent</span>
												</label>
											</div>
										</PropertyGroup>

										<PropertyGroup label="Queue ID">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.handoverQueueId || ''}
												onChange={(event) =>
													updateHandoverNodeConfig({
														handoverQueueId: event.target.value,
													})
												}
												placeholder="cs-queue-default"
											/>
										</PropertyGroup>
										<PropertyGroup label="Handover Message">
											<textarea
												className="ocm-input min-h-20 resize-y"
												value={selectedNodeConfig?.handoverMessage || ''}
												onChange={(event) =>
													updateHandoverNodeConfig({
														handoverMessage: event.target.value,
													})
												}
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'update_contact' ? (
									<>
										<PropertyGroup label="Field Key">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.updateField || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														updateField: event.target.value,
													})
												}
												placeholder="status_lead"
											/>
										</PropertyGroup>
										<PropertyGroup label="Value Template">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.updateValueTemplate || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														updateValueTemplate: event.target.value,
													})
												}
												placeholder="{{intent.label}}"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'trigger_campaign' ? (
									<>
										<PropertyGroup label="Campaign ID">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.campaignId || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														campaignId: event.target.value,
													})
												}
												placeholder="cmp-2026-lebaran"
											/>
										</PropertyGroup>
										<PropertyGroup label="Mode">
											<select
												className="ocm-select"
												value={selectedNodeConfig?.campaignMode || 'once'}
												onChange={(event) =>
													updateSelectedNodeConfig({
														campaignMode: event.target.value as
															| 'once'
															| 'recurring',
													})
												}
											>
												<option value="once">once</option>
												<option value="recurring">recurring</option>
											</select>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'http_request' ? (
									<>
										<PropertyGroup label="Method">
											<select
												className="ocm-select"
												value={selectedNodeConfig?.httpRequestMethod || 'GET'}
												onChange={(event) => {
													const httpRequestMethod = event.target.value as
														| 'GET'
														| 'POST'
														| 'PUT'
														| 'DELETE'
													updateSelectedNodeConfig({ httpRequestMethod })
													updateSelectedNodeSub(
														`${httpRequestMethod} ${selectedNodeConfig?.httpRequestUrl || ''}`,
													)
												}}
											>
												<option value="GET">GET</option>
												<option value="POST">POST</option>
												<option value="PUT">PUT</option>
												<option value="DELETE">DELETE</option>
											</select>
										</PropertyGroup>
										<PropertyGroup label="URL">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.httpRequestUrl || ''}
												onChange={(event) => {
													const httpRequestUrl = event.target.value
													updateSelectedNodeConfig({ httpRequestUrl })
													updateSelectedNodeSub(
														`${selectedNodeConfig?.httpRequestMethod || 'GET'} ${httpRequestUrl}`,
													)
												}}
												placeholder="https://api.example.com/v1/data"
											/>
										</PropertyGroup>
										<PropertyGroup label="Headers (JSON)">
											<textarea
												className="ocm-input min-h-[60px] font-mono text-xs"
												value={selectedNodeConfig?.httpRequestHeaders || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														httpRequestHeaders: event.target.value,
													})
												}
												placeholder={'{\n  "Authorization": "Bearer ..."\n}'}
											/>
										</PropertyGroup>
										<PropertyGroup label="Body (JSON)">
											<textarea
												className="ocm-input min-h-[80px] font-mono text-xs"
												value={selectedNodeConfig?.httpRequestBody || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														httpRequestBody: event.target.value,
													})
												}
												placeholder={'{\n  "contact": "{{contact.phone}}"\n}'}
											/>
										</PropertyGroup>
										<PropertyGroup label="Output Variable Name">
											<input
												type="text"
												className="ocm-input"
												value={
													selectedNodeConfig?.httpRequestOutputVar ||
													'api.response'
												}
												onChange={(event) =>
													updateSelectedNodeConfig({
														httpRequestOutputVar: event.target.value,
													})
												}
												placeholder="api.response"
											/>
										</PropertyGroup>
									</>
								) : null}

								{selectedNodeSettingKind === 'ab_test_splitter' ? (
									<>
										<PropertyGroup label="Variant A Target">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.abTestVariantA || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														abTestVariantA: event.target.value,
													})
												}
												placeholder="Rute A"
											/>
										</PropertyGroup>
										<PropertyGroup label="Variant B Target">
											<input
												type="text"
												className="ocm-input"
												value={selectedNodeConfig?.abTestVariantB || ''}
												onChange={(event) =>
													updateSelectedNodeConfig({
														abTestVariantB: event.target.value,
													})
												}
												placeholder="Rute B"
											/>
										</PropertyGroup>
									</>
								) : null}
							</>
						) : (
							<div className="p-4">
								<div className="rounded-xl border border-dashed border-border bg-card p-4">
									<p className="text-sm font-semibold">Node Settings</p>
									<p className="mt-1 text-xs text-muted-foreground">
										Belum ada node dipilih. Tambahkan node baru atau pilih
										workflow yang sudah ada.
									</p>
								</div>
							</div>
						)}
					</aside>
				) : null}
			</div>
		</main>
	)
}

function PropertyGroup({
	label,
	children,
}: {
	label: string
	children: ReactNode
}) {
	return (
		<div className="border-b border-border p-4">
			<p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
				{label}
			</p>
			{children}
		</div>
	)
}
