import prisma from '../../lib/prisma'
import redis from '../../lib/redis'
import { isUuid, resolveAppId } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'
import { FlowRuntimeService } from '../flow/runtime-service'

type ReservationResult = {
	reservationId: string
	organizationId: string
	cost: number
	modelName: string
}

type TransactionMetadata = Record<string, unknown>
type CreditTransactionRecord = { id: string; metadata: unknown }
export type AIProvider = 'growthcircle' | 'azure' | 'sumopod' | 'custom'
type RuntimeProviderPurpose = 'completion' | 'embedding'
type ProviderProtocol = 'openai' | 'anthropic'
type ProviderAuthHeader = 'authorization' | 'x-api-key'
type ProviderAuthScheme = 'bearer' | 'raw'

type ProviderChannelInput = {
	base_url: string
	path?: string
	auth_header?: ProviderAuthHeader
	auth_scheme?: ProviderAuthScheme
}

type ProviderModelCatalogItem = {
	id: string
	name: string
	vendor: string
	context_window: string
	max_output: string
}

type ProviderConfigInput = {
	base_url: string
	api_key?: string
	plan_type?: 'free' | 'paid' | 'team'
	model_name?: string
	api_version?: string
	deployment_name?: string
	temperature?: number
	max_tokens?: number
	default_protocol?: ProviderProtocol
	channels?: Partial<Record<ProviderProtocol, ProviderChannelInput>>
	models?: ProviderModelCatalogItem[]
}

type ProviderConfigRecord = ProviderConfigInput & {
	provider: AIProvider
}

type ProviderConfigurationsPayload = {
	active_provider: AIProvider | null
	active_embedding_provider: AIProvider | null
	providers: Record<AIProvider, ProviderConfigRecord | null>
}

type SummaryRuntimeConfig = {
	provider: AIProvider | null
	baseUrl: string | null
	apiKey: string | null
	modelName: string
	apiVersion: string
	deploymentName: string | null
	temperature: number
	maxTokens: number
	embeddingModel: string
	embeddingProvider: AIProvider | null
	embeddingBaseUrl: string | null
	embeddingApiKey: string | null
	embeddingApiVersion: string
	embeddingDeploymentName: string | null
}

type ConversationMessageForSummary = {
	id: string
	createdAt: Date
	role: 'customer' | 'agent'
	text: string
}

type SummaryGenerationResult = {
	suggestion: string
	confidence: number
	retrieval: {
		totalMessages: number
		indexedMessages: number
		selectedMessages: number
		semanticMatches: number
	}
}

type SummaryCompletionResult = {
	content: string | null
	providerHit: boolean
	endpoint: string | null
	statusCode: number | null
	error: string | null
	requestPayload: Record<string, unknown> | null
}

type PlaygroundWorkflowContext = {
	inboxId: string
	conversationId: string
	contactId: string
	channelType: 'whatsapp' | 'instagram' | 'tiktok'
	channelName: string | null
	channelBadgeUrl: string | null
}

type PlaygroundWorkflowSimulationResult = {
	assistantContent: string | null
	traceLine: string
	flowId: string | null
	matched: boolean
	skipChatbot: boolean
	reason: string
	latencyMs: number
}

type PlaygroundMetricTrend = 'up' | 'down' | 'neutral'
type PlaygroundMetricPositiveWhen = PlaygroundMetricTrend
type PlaygroundAgentType = 'ai_sales' | 'ai_support' | 'ai_general'

type PlaygroundSelectionInput = {
	modelId?: string
	strategyId?: string
	personaId?: string
}

type PlaygroundResetInput = PlaygroundSelectionInput & {
	sessionId?: string
}

type PlaygroundRunInput = PlaygroundSelectionInput & {
	sessionId: string
	message: string
	selectedSourceIds?: string[]
	ragTopK?: number
	enqueue?: boolean
}

type PlaygroundRunJobStatus = 'queued' | 'running' | 'completed' | 'failed'

type PlaygroundRunJobRecord = {
	id: string
	appId: string
	status: PlaygroundRunJobStatus
	payload: PlaygroundRunInput
	state: unknown | null
	error: string | null
	createdAt: string
	updatedAt: string
}

type PlaygroundRagResult = {
	ragHit?: boolean
	topChunks?: Array<{
		score?: number
		source?: string
		locator?: string
		snippet?: string
	}>
}

type ProviderModelTestInput = {
	modelId?: string
	message?: string
	protocol?: ProviderProtocol
	maxTokens?: number
	apiKey?: string
	config?: ProviderConfigInput
}

type PlaygroundRoutingRuleInput = {
	name?: string
	provider?: string
	modelId?: string
	minConfidence?: number
	maxConfidence?: number
}

type PlaygroundCreateStrategyInput = {
	label: string
	description?: string
	activate?: boolean
	rules?: PlaygroundRoutingRuleInput[]
}

type PlaygroundCreatePersonaInput = {
	label: string
	systemInstruction: string
	agentType: PlaygroundAgentType
	setAsDefaultForType?: boolean
	setAsGlobalDefault?: boolean
}

type PlaygroundUpdatePersonaInput = {
	label?: string
	systemInstruction?: string
	agentType?: PlaygroundAgentType
	setAsDefaultForType?: boolean
	setAsGlobalDefault?: boolean
}

type PlaygroundRoutingRule = {
	id: string
	name: string
	provider: string
	model_key: string | null
	model_name: string | null
	min_confidence: number | null
	max_confidence: number | null
	priority: number
}

type PlaygroundSeedModel = {
	model_key: string
	name: string
	vendor: string
	context_window: string
	price_in: number
	price_out: number
	speed: string
	tier: string
	connected: boolean
	latency_ms: number | null
	usage_percent: number
	sort_order: number
}

type PlaygroundSeedStrategy = {
	strategy_key: string
	label: string
	description: string
	routing_rules: PlaygroundRoutingRule[]
	is_active: boolean
	sort_order: number
}

type PlaygroundSeedPersona = {
	persona_key: string
	label: string
	system_instruction: string
	is_default: boolean
	sort_order: number
}

type PlaygroundSeedGuardrail = {
	guardrail_key: string
	label: string
	enabled: boolean
	sort_order: number
}

type PlaygroundSeedMetric = {
	metric_key: string
	label: string
	value: string
	delta: string
	trend: PlaygroundMetricTrend
	positive_when: PlaygroundMetricPositiveWhen
	sort_order: number
}

const SUPPORTED_AI_PROVIDERS: AIProvider[] = [
	'growthcircle',
	'custom',
	'azure',
	'sumopod',
]
const DEFAULT_AI_PROVIDER: AIProvider = 'growthcircle'
const ACTIVE_PROVIDER_KEY = 'ai.provider.active'
const ACTIVE_EMBEDDING_PROVIDER_KEY = 'ai.provider.embedding.active'
const PROVIDER_CONFIG_CACHE_KEY = 'ai:provider-configurations:v1'
const DEFAULT_CHAT_MODEL = 'gpt-5.4'
const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small'
const SUMMARY_MAX_MESSAGES = 160
const SUMMARY_MAX_EMBED_MESSAGES = 80
const SUMMARY_RECENT_WINDOW = 12
const SUMMARY_SEMANTIC_TOP_K = 24
const SUMMARY_MAX_MESSAGE_TEXT_LENGTH = 700
const AI_REQUEST_TIMEOUT_MS = Math.max(
	4_000,
	Number(process.env.AI_REQUEST_TIMEOUT_MS || 25_000),
)
const parsedProviderCacheTtlSeconds = Number.parseInt(
	process.env.AI_PROVIDER_CACHE_TTL_SECONDS || '60',
	10,
)
const PROVIDER_CONFIG_CACHE_TTL_SECONDS = Number.isFinite(
	parsedProviderCacheTtlSeconds,
)
	? Math.max(10, parsedProviderCacheTtlSeconds)
	: 60
const PLAYGROUND_WORKFLOW_CONTEXT_KEY_PREFIX = 'ai:playground:workflow-context:'
const PLAYGROUND_WORKFLOW_CONTEXT_TTL_SECONDS = 60 * 60 * 24 * 30
const PLAYGROUND_RUN_JOB_KEY_PREFIX = 'ai:playground:run-job:'
const PLAYGROUND_RUN_QUEUE_KEY_PREFIX = 'ai:playground:run-queue:'
const PLAYGROUND_RUN_JOB_TTL_SECONDS = 60 * 15
const PLAYGROUND_IDR_PER_USD = Math.max(
	1_000,
	Number(process.env.AI_PLAYGROUND_IDR_RATE || 16_280),
)
const providerConfigKey = (provider: AIProvider) =>
	`ai.provider.config.${provider}`
const GROWTHCIRCLE_OPENAI_BASE_URL = 'https://ai.growthcircle.id/v1'
const GROWTHCIRCLE_ANTHROPIC_BASE_URL = 'https://ai.growthcircle.id/anthropic'
const GROWTHCIRCLE_ANTHROPIC_PATH = '/v1/messages'
const GROWTHCIRCLE_DEFAULT_MODEL_ID = 'gpt-5.4'

const GROWTHCIRCLE_DEFAULT_MODEL_CATALOG: ProviderModelCatalogItem[] = [
	{
		id: 'gpt-5.5',
		name: 'gpt-5.5',
		vendor: 'OpenAI',
		context_window: '1.1M',
		max_output: '128K',
	},
	{
		id: 'gpt-5.4',
		name: 'gpt-5.4',
		vendor: 'OpenAI',
		context_window: '1.1M',
		max_output: '128K',
	},
	{
		id: 'gpt-5.4-mini',
		name: 'gpt-5.4 mini',
		vendor: 'OpenAI',
		context_window: '400K',
		max_output: '128K',
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5 (2025-10-01)',
		vendor: 'Anthropic',
		context_window: '200K',
		max_output: '64K',
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude 3.5 Haiku (Latest)',
		vendor: 'Anthropic',
		context_window: '200K',
		max_output: '8K',
	},
	{
		id: 'MiniMax-M2.7-highspeed',
		name: 'MiniMax M2.7 Highspeed',
		vendor: 'MiniMax',
		context_window: '205K',
		max_output: '64K',
	},
	{
		id: 'MiniMax-M2.7',
		name: 'MiniMax M2.7',
		vendor: 'MiniMax',
		context_window: '205K',
		max_output: '64K',
	},
]

const PLAYGROUND_DEFAULT_MODELS: PlaygroundSeedModel[] = [
	{
		model_key: 'gpt-5.4',
		name: 'gpt-5.4',
		vendor: 'OpenAI',
		context_window: '1.1M',
		price_in: 0,
		price_out: 0,
		speed: 'medium',
		tier: 'highend',
		connected: true,
		latency_ms: 980,
		usage_percent: 34,
		sort_order: 0,
	},
	{
		model_key: 'gpt-5.4-mini',
		name: 'gpt-5.4 mini',
		vendor: 'OpenAI',
		context_window: '400K',
		price_in: 0,
		price_out: 0,
		speed: 'fast',
		tier: 'fast',
		connected: true,
		latency_ms: 620,
		usage_percent: 58,
		sort_order: 1,
	},
	{
		model_key: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5 (2025-10-01)',
		vendor: 'Anthropic',
		context_window: '200K',
		price_in: 0,
		price_out: 0,
		speed: 'fastest',
		tier: 'fast',
		connected: true,
		latency_ms: 360,
		usage_percent: 44,
		sort_order: 2,
	},
	{
		model_key: 'claude-3-5-haiku-latest',
		name: 'Claude 3.5 Haiku (Latest)',
		vendor: 'Anthropic',
		context_window: '200K',
		price_in: 0,
		price_out: 0,
		speed: 'fastest',
		tier: 'fast',
		connected: true,
		latency_ms: 280,
		usage_percent: 72,
		sort_order: 3,
	},
	{
		model_key: 'MiniMax-M2.7-highspeed',
		name: 'MiniMax M2.7 Highspeed',
		vendor: 'MiniMax',
		context_window: '205K',
		price_in: 0,
		price_out: 0,
		speed: 'fastest',
		tier: 'fast',
		connected: true,
		latency_ms: 300,
		usage_percent: 81,
		sort_order: 4,
	},
	{
		model_key: 'MiniMax-M2.7',
		name: 'MiniMax M2.7',
		vendor: 'MiniMax',
		context_window: '205K',
		price_in: 0,
		price_out: 0,
		speed: 'medium',
		tier: 'highend',
		connected: true,
		latency_ms: 850,
		usage_percent: 29,
		sort_order: 5,
	},
]

const PLAYGROUND_DEFAULT_ROUTING_STRATEGIES: PlaygroundSeedStrategy[] = [
	{
		strategy_key: 'cost-optimized',
		label: 'Cost-optimized',
		description: 'Gunakan model ringan lebih dulu, fallback ke Anthropic',
		routing_rules: [
			{
				id: 'cost-primary',
				name: 'High confidence -> GPT-5.4 Mini',
				provider: 'openai',
				model_key: 'gpt-5.4-mini',
				model_name: 'gpt-5.4 mini',
				min_confidence: 0.7,
				max_confidence: 1,
				priority: 0,
			},
			{
				id: 'cost-fallback',
				name: 'Low confidence -> Claude 3.5 Haiku',
				provider: 'anthropic',
				model_key: 'claude-3-5-haiku-latest',
				model_name: 'Claude 3.5 Haiku (Latest)',
				min_confidence: 0,
				max_confidence: 0.69,
				priority: 1,
			},
		],
		is_active: true,
		sort_order: 0,
	},
	{
		strategy_key: 'speed-first',
		label: 'Speed-first',
		description: 'Prioritaskan response cepat untuk volume tinggi',
		routing_rules: [
			{
				id: 'speed-primary',
				name: 'High confidence -> MiniMax Highspeed',
				provider: 'minimax',
				model_key: 'MiniMax-M2.7-highspeed',
				model_name: 'MiniMax M2.7 Highspeed',
				min_confidence: 0.55,
				max_confidence: 1,
				priority: 0,
			},
			{
				id: 'speed-fallback',
				name: 'Low confidence -> Claude Haiku 4.5',
				provider: 'anthropic',
				model_key: 'claude-haiku-4-5-20251001',
				model_name: 'Claude Haiku 4.5 (2025-10-01)',
				min_confidence: 0,
				max_confidence: 0.54,
				priority: 1,
			},
		],
		is_active: false,
		sort_order: 1,
	},
	{
		strategy_key: 'quality-first',
		label: 'Quality-first',
		description: 'Prioritaskan kualitas jawaban terbaik',
		routing_rules: [
			{
				id: 'quality-primary',
				name: 'High confidence -> GPT-5.4',
				provider: 'openai',
				model_key: 'gpt-5.4',
				model_name: 'gpt-5.4',
				min_confidence: 0.65,
				max_confidence: 1,
				priority: 0,
			},
			{
				id: 'quality-fallback',
				name: 'Low confidence -> Claude Haiku 4.5',
				provider: 'anthropic',
				model_key: 'claude-haiku-4-5-20251001-free',
				model_name: 'Claude Haiku 4.5 (2025-10-01)',
				min_confidence: 0,
				max_confidence: 0.64,
				priority: 1,
			},
		],
		is_active: false,
		sort_order: 2,
	},
	{
		strategy_key: 'custom-rules',
		label: 'Custom rules',
		description: '5 rules aktif',
		routing_rules: [],
		is_active: false,
		sort_order: 3,
	},
]

const PLAYGROUND_AGENT_TYPE_ORDER: PlaygroundAgentType[] = [
	'ai_sales',
	'ai_support',
	'ai_general',
]

const PLAYGROUND_AGENT_TYPE_LABELS: Record<PlaygroundAgentType, string> = {
	ai_sales: 'AI Sales',
	ai_support: 'AI Support',
	ai_general: 'AI General',
}

const PLAYGROUND_DEFAULT_PERSONAS: PlaygroundSeedPersona[] = [
	{
		persona_key: 'sales-closer-rina',
		label: 'AI Sales · Rina (Closer)',
		system_instruction:
			'Kamu adalah AI Sales yang fokus closing. Gaya bahasa hangat, cepat, dan percaya diri. Prioritaskan: gali kebutuhan, jelaskan value produk, lalu arahkan ke aksi pembelian yang konkret.',
		is_default: false,
		sort_order: 0,
	},
	{
		persona_key: 'sales-advisor-bima',
		label: 'AI Sales · Bima (Advisor)',
		system_instruction:
			'Kamu adalah AI Sales consultant. Bantu pelanggan membandingkan opsi produk, jelaskan plus-minus secara jujur, dan rekomendasikan pilihan terbaik sesuai kebutuhan pelanggan.',
		is_default: false,
		sort_order: 1,
	},
	{
		persona_key: 'sales-negotiator-sari',
		label: 'AI Sales · Sari (Negotiator)',
		system_instruction:
			'Kamu adalah AI Sales negotiator. Tetap ramah tapi tegas, tawarkan paket/bundling/promosi yang relevan, dan dorong keputusan tanpa terdengar memaksa.',
		is_default: false,
		sort_order: 2,
	},
	{
		persona_key: 'support-troubleshooter-dina',
		label: 'AI Support · Dina (Troubleshooter)',
		system_instruction:
			'Kamu adalah AI Support yang sistematis. Fokus identifikasi akar masalah, berikan langkah pemecahan yang jelas langkah-per-langkah, dan cek ulang apakah masalah benar-benar selesai.',
		is_default: false,
		sort_order: 3,
	},
	{
		persona_key: 'support-care-hendra',
		label: 'AI Support · Hendra (Customer Care)',
		system_instruction:
			'Kamu adalah AI Support yang empatik. Akui kendala pelanggan, jaga nada tenang, jelaskan status/estimasi dengan transparan, dan follow-up sampai pelanggan merasa aman.',
		is_default: false,
		sort_order: 4,
	},
	{
		persona_key: 'support-tech-novia',
		label: 'AI Support · Novia (Technical)',
		system_instruction:
			'Kamu adalah AI Support teknis. Gunakan bahasa sederhana, hindari jargon berlebihan, dan berikan diagnosis + solusi praktis yang bisa langsung dicoba pelanggan.',
		is_default: false,
		sort_order: 5,
	},
	{
		persona_key: 'general-friendly-nana',
		label: 'AI General · Nana (Friendly)',
		system_instruction:
			'Kamu adalah AI General assistant yang ramah dan natural. Pahami konteks dulu, jawab jelas, dan bantu pelanggan melanjutkan ke langkah berikutnya dengan bahasa santai.',
		is_default: true,
		sort_order: 6,
	},
	{
		persona_key: 'general-professional-joko',
		label: 'AI General · Joko (Professional)',
		system_instruction:
			'Kamu adalah AI General assistant dengan gaya profesional. Jawaban ringkas, rapi, dan fokus pada akurasi informasi serta kejelasan tindakan.',
		is_default: false,
		sort_order: 7,
	},
	{
		persona_key: 'general-concise-ardi',
		label: 'AI General · Ardi (Concise)',
		system_instruction:
			'Kamu adalah AI General assistant yang to the point. Berikan jawaban padat, mudah dipahami, dan tetap membantu tanpa bertele-tele.',
		is_default: false,
		sort_order: 8,
	},
]

const PLAYGROUND_DEFAULT_GUARDRAILS: PlaygroundSeedGuardrail[] = [
	{
		guardrail_key: 'pii-redaction',
		label: 'PII redaction',
		enabled: true,
		sort_order: 0,
	},
	{
		guardrail_key: 'jailbreak-detection',
		label: 'Jailbreak detection',
		enabled: true,
		sort_order: 1,
	},
	{
		guardrail_key: 'off-topic-filter',
		label: 'Off-topic filter',
		enabled: true,
		sort_order: 2,
	},
	{
		guardrail_key: 'max-cost',
		label: 'Max biaya / percakapan Rp 5.000',
		enabled: true,
		sort_order: 3,
	},
	{
		guardrail_key: 'auto-handover',
		label: 'Auto-handover if conf < 0.70',
		enabled: true,
		sort_order: 4,
	},
]

const PLAYGROUND_DEFAULT_METRICS: PlaygroundSeedMetric[] = [
	{
		metric_key: 'requests',
		label: 'Requests',
		value: '28,142',
		delta: '+12%',
		trend: 'up',
		positive_when: 'up',
		sort_order: 0,
	},
	{
		metric_key: 'tokens',
		label: 'Avg tokens / req',
		value: '814',
		delta: '-5%',
		trend: 'down',
		positive_when: 'down',
		sort_order: 1,
	},
	{
		metric_key: 'latency-p50',
		label: 'Avg latency p50',
		value: '960ms',
		delta: '-120ms',
		trend: 'down',
		positive_when: 'down',
		sort_order: 2,
	},
	{
		metric_key: 'latency-p95',
		label: 'Avg latency p95',
		value: '2.1s',
		delta: '+80ms',
		trend: 'up',
		positive_when: 'down',
		sort_order: 3,
	},
	{
		metric_key: 'cost',
		label: 'Biaya hari ini',
		value: '$41.28',
		delta: 'Rp 672k',
		trend: 'neutral',
		positive_when: 'neutral',
		sort_order: 4,
	},
	{
		metric_key: 'cache-hit-rate',
		label: 'Cache hit rate',
		value: '64%',
		delta: '-$18 saved',
		trend: 'up',
		positive_when: 'up',
		sort_order: 5,
	},
]

function joinUrl(baseUrl: string, path: string): string {
	return `${baseUrl.replace(/\/+$/g, '')}/${path.replace(/^\/+/, '')}`
}

function toRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

function toTrimmedString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\s+/g, ' ').trim()
}

function truncateText(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value
	return `${value.slice(0, maxLength - 1)}…`
}

function cosineSimilarity(a: number[], b: number[]): number {
	const length = Math.min(a.length, b.length)
	if (length === 0) return 0

	let dot = 0
	let aNorm = 0
	let bNorm = 0
	for (let i = 0; i < length; i++) {
		const ai = Number(a[i] || 0)
		const bi = Number(b[i] || 0)
		dot += ai * bi
		aNorm += ai * ai
		bNorm += bi * bi
	}

	if (aNorm === 0 || bNorm === 0) return 0
	return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm))
}

function clamp(value: number, min: number, max: number): number {
	return Math.max(min, Math.min(max, value))
}

function extractEmbeddingVectors(payload: unknown): number[][] {
	if (!payload || typeof payload !== 'object' || Array.isArray(payload))
		return []
	const data = Array.isArray((payload as Record<string, unknown>).data)
		? ((payload as Record<string, unknown>).data as unknown[])
		: []
	if (data.length === 0) return []

	const vectors: number[][] = []
	for (const row of data) {
		const record = toRecord(row)
		if (!record) continue
		const embeddingRaw = Array.isArray(record.embedding) ? record.embedding : []
		const embedding = embeddingRaw
			.map((value) => Number(value))
			.filter((value) => Number.isFinite(value))
		if (embedding.length > 0) vectors.push(embedding)
	}

	return vectors
}

function extractCompletionContent(payload: unknown): string | null {
	if (typeof payload === 'string') {
		const normalized = payload.trim()
		return normalized.length > 0 ? normalized : null
	}

	const record = toRecord(payload)
	if (!record) return null

	const choices = Array.isArray(record.choices)
		? (record.choices as unknown[])
		: []
	if (choices.length > 0) {
		const firstChoice = toRecord(choices[0])
		const message = toRecord(firstChoice?.message)
		const direct = toTrimmedString(message?.content)
		if (direct) return direct

		if (Array.isArray(message?.content)) {
			const chunks = (message.content as unknown[])
				.map((item) => toTrimmedString(toRecord(item)?.text) || '')
				.filter(Boolean)
			if (chunks.length > 0) {
				return normalizeWhitespace(chunks.join('\n'))
			}
		}
	}

	// Anthropic-style response: { content: [{ type: "text", text: "..." }] }
	if (Array.isArray(record.content)) {
		const chunks = (record.content as unknown[])
			.map((item) => {
				const entry = toRecord(item)
				const textValue = toTrimmedString(entry?.text)
				return textValue || ''
			})
			.filter(Boolean)
		if (chunks.length > 0) {
			return normalizeWhitespace(chunks.join('\n'))
		}
	}

	const completion = toTrimmedString(record.completion)
	if (completion) return completion

	return toTrimmedString(record.output_text)
}

export abstract class AIService {
	private static readonly playgroundQueueDraining = new Set<string>()

	private static toMetadataObject(value: unknown): TransactionMetadata {
		if (!value || typeof value !== 'object' || Array.isArray(value)) {
			return {}
		}

		return value as TransactionMetadata
	}

	private static async getOrganizationIdFromApp(targetAppId: string) {
		const organization = await prisma.organization.findUnique({
			where: { appId: targetAppId },
			select: { id: true },
		})

		if (!organization?.id) {
			throw new Error('Organization not found')
		}

		return organization.id
	}

	private static toNumber(value?: unknown) {
		if (value === null || value === undefined) return 0
		const parsed = Number(value)
		return Number.isFinite(parsed) ? parsed : 0
	}

	private static getWarningThreshold(value?: unknown) {
		const parsed = Number(value ?? 5)
		return Number.isFinite(parsed) ? parsed : 5
	}

	private static async sendLowBalanceAlert(organizationId: string) {
		const organization = await prisma.organization.findUnique({
			where: { id: organizationId },
			select: { aiLowCreditAlertSent: true },
		})

		if (!organization) throw new Error('Organization not found')
		if (organization.aiLowCreditAlertSent) return

		await prisma.organization.update({
			where: { id: organizationId },
			data: { aiLowCreditAlertSent: true },
		})

		console.warn(
			'[AIService] Low credit alert triggered for organization',
			organizationId,
		)
	}

	private static async topUpOrgCredits(
		organizationId: string,
		amount: number,
		description: string,
		paymentId?: string,
		metadata?: unknown,
	): Promise<CreditTransactionRecord> {
		return prisma.$transaction(async (tx) => {
			const organization = await tx.organization.findUnique({
				where: { id: organizationId },
				select: {
					aiCredits: true,
					aiCreditWarningThreshold: true,
					aiLowCreditAlertSent: true,
				},
			})

			if (!organization) throw new Error('Organization not found')

			const currentBalance = AIService.toNumber(organization.aiCredits)
			const threshold = AIService.getWarningThreshold(
				organization.aiCreditWarningThreshold,
			)
			const updatedBalance = currentBalance + amount
			const shouldResetAlert =
				Boolean(organization.aiLowCreditAlertSent) &&
				updatedBalance >= threshold

			await tx.organization.update({
				where: { id: organizationId },
				data: {
					aiCredits: { increment: amount },
					...(shouldResetAlert ? { aiLowCreditAlertSent: false } : {}),
				},
			})

			return tx.credit_transactions.create({
				data: {
					organization_id: organizationId,
					amount,
					type: 'top_up',
					description,
					external_id: paymentId ?? null,
					metadata: metadata ?? undefined,
					payment_status: 'completed',
				},
				select: { id: true, metadata: true },
			})
		})
	}

	private static async deductOrgCredits(
		organizationId: string,
		amount: number,
		description: string,
		metadata?: unknown,
	): Promise<CreditTransactionRecord> {
		const { transaction, shouldTriggerAlert } = await prisma.$transaction(
			async (tx) => {
				const organization = await tx.organization.findUnique({
					where: { id: organizationId },
					select: {
						aiCredits: true,
						aiCreditWarningThreshold: true,
						aiLowCreditAlertSent: true,
					},
				})

				if (!organization) throw new Error('Organization not found')

				const currentBalance = AIService.toNumber(organization.aiCredits)
				const updatedBalance = currentBalance - amount

				if (updatedBalance < -100) {
					throw new Error('Insufficient AI credits (grace period: -100)')
				}

				const threshold = AIService.getWarningThreshold(
					organization.aiCreditWarningThreshold,
				)
				const alertAlreadySent = Boolean(organization.aiLowCreditAlertSent)
				const shouldTriggerAlert =
					!alertAlreadySent && updatedBalance <= threshold

				await tx.organization.update({
					where: { id: organizationId },
					data: { aiCredits: { decrement: amount } },
				})

				const transaction = await tx.credit_transactions.create({
					data: {
						organization_id: organizationId,
						amount: -amount,
						type: 'usage',
						description,
						payment_status: 'completed',
						metadata: metadata ?? undefined,
					},
					select: { id: true, metadata: true },
				})

				return { transaction, shouldTriggerAlert }
			},
		)

		if (shouldTriggerAlert) {
			await AIService.sendLowBalanceAlert(organizationId)
		}

		return transaction
	}

	private static toOptionalFiniteNumber(value: unknown): number | undefined {
		if (value === null || value === undefined) return undefined
		if (typeof value === 'number') {
			return Number.isFinite(value) ? value : undefined
		}
		if (typeof value === 'string') {
			const parsed = Number(value.trim())
			return Number.isFinite(parsed) ? parsed : undefined
		}
		return undefined
	}

	private static toOptionalBoolean(value: unknown): boolean | undefined {
		if (value === null || value === undefined) return undefined
		if (typeof value === 'boolean') return value
		if (typeof value === 'string') {
			const normalized = value.trim().toLowerCase()
			if (normalized === 'true' || normalized === '1') return true
			if (normalized === 'false' || normalized === '0') return false
		}
		return undefined
	}

	private static toOptionalStringArray(value: unknown): string[] | undefined {
		if (!Array.isArray(value)) return undefined
		return value
			.map((item) => String(item || '').trim())
			.filter((item) => item.length > 0)
	}

	private static toOptionalTrimmedString(value: unknown): string | undefined {
		if (typeof value !== 'string') return undefined
		const normalized = value.trim()
		return normalized.length > 0 ? normalized : undefined
	}

	private static parseTokenLimit(value: unknown): number | undefined {
		const direct = AIService.toOptionalFiniteNumber(value)
		if (direct !== undefined && direct > 0) {
			return Math.max(1, Math.trunc(direct))
		}

		const normalized = AIService.toOptionalTrimmedString(value)
		if (!normalized) return undefined
		const compact = normalized.toLowerCase().replace(/,/g, '')
		const match = compact.match(/^(\d+(?:\.\d+)?)\s*([km])?$/)
		if (!match) return undefined

		const amount = Number(match[1])
		if (!Number.isFinite(amount) || amount <= 0) return undefined
		const unit = match[2] || ''
		const multiplier = unit === 'm' ? 1_000_000 : unit === 'k' ? 1_000 : 1
		return Math.max(1, Math.trunc(amount * multiplier))
	}

	private static inferProtocolFromModelCatalog(args: {
		modelId?: string
		vendor?: string
		fallback: ProviderProtocol
	}): ProviderProtocol {
		const vendor = (AIService.toOptionalTrimmedString(args.vendor) || '')
			.toLowerCase()
			.trim()
		const modelId = (AIService.toOptionalTrimmedString(args.modelId) || '')
			.toLowerCase()
			.trim()

		if (vendor.includes('anthropic') || modelId.includes('claude')) {
			return 'anthropic'
		}
		if (
			vendor.includes('openai') ||
			modelId.startsWith('gpt') ||
			modelId.startsWith('o1') ||
			modelId.startsWith('o3') ||
			modelId.startsWith('o4')
		) {
			return 'openai'
		}

		return args.fallback
	}

	private static extractProviderErrorMessage(payload: unknown): string | null {
		if (typeof payload === 'string') {
			const normalized = normalizeWhitespace(payload)
			return normalized.length > 0 ? normalized : null
		}

		const record = toRecord(payload)
		if (!record) return null
		const direct = AIService.toOptionalTrimmedString(record.error)
		if (direct) return direct

		const nestedError = toRecord(record.error)
		const nestedMessage = AIService.toOptionalTrimmedString(
			nestedError?.message,
		)
		if (nestedMessage) return nestedMessage
		const nestedType = AIService.toOptionalTrimmedString(nestedError?.type)
		if (nestedType) return nestedType

		const detail = AIService.toOptionalTrimmedString(record.detail)
		if (detail) return detail
		const message = AIService.toOptionalTrimmedString(record.message)
		if (message) return message
		return null
	}

	private static slugifyPlaygroundKey(value: string): string {
		const normalized = value
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-')
			.replace(/^-+|-+$/g, '')
		return normalized || 'strategy'
	}

	private static normalizeRoutingProvider(value: string): string {
		return AIService.slugifyPlaygroundKey(value).slice(0, 60)
	}

	private static toPlaygroundAgentType(
		value: unknown,
	): PlaygroundAgentType | null {
		const normalized = AIService.toOptionalTrimmedString(value)
			?.toLowerCase()
			.replace(/[\s-]+/g, '_')
		if (normalized === 'ai_sales') return 'ai_sales'
		if (normalized === 'ai_support') return 'ai_support'
		if (normalized === 'ai_general') return 'ai_general'
		return null
	}

	private static toPlaygroundAgentTypeOrThrow(
		value: unknown,
	): PlaygroundAgentType {
		const parsed = AIService.toPlaygroundAgentType(value)
		if (!parsed) {
			throw new Error(
				'Invalid agent type. Use one of: ai_sales, ai_support, ai_general',
			)
		}
		return parsed
	}

	private static resolvePlaygroundAgentTypeFromPersonaKey(
		personaKey: string | null | undefined,
	): PlaygroundAgentType {
		const normalized = AIService.slugifyPlaygroundKey(String(personaKey || ''))
		if (
			normalized.startsWith('sales-') ||
			normalized.endsWith('-sales') ||
			normalized.includes('sales')
		) {
			return 'ai_sales'
		}
		if (
			normalized.startsWith('support-') ||
			normalized.includes('support') ||
			normalized.includes('cs')
		) {
			return 'ai_support'
		}
		return 'ai_general'
	}

	private static getPlaygroundAgentTypePrefix(
		agentType: PlaygroundAgentType,
	): 'sales' | 'support' | 'general' {
		if (agentType === 'ai_sales') return 'sales'
		if (agentType === 'ai_support') return 'support'
		return 'general'
	}

	private static buildPlaygroundPersonaBaseKey(
		agentType: PlaygroundAgentType,
		label: string,
	) {
		const prefix = AIService.getPlaygroundAgentTypePrefix(agentType)
		const rawLabelSlug = AIService.slugifyPlaygroundKey(label)
		const suffix = rawLabelSlug
			.replace(/^(ai-)?sales-?/g, '')
			.replace(/^(ai-)?support-?/g, '')
			.replace(/^(ai-)?general-?/g, '')
			.replace(/^persona-?/g, '')
		const normalizedSuffix = suffix || 'persona'
		return `${prefix}-${normalizedSuffix}`.slice(0, 72)
	}

	private static async ensureUniquePlaygroundPersonaKey(
		appId: string,
		agentType: PlaygroundAgentType,
		label: string,
		excludePersonaId?: string,
	): Promise<string> {
		const baseKey = AIService.buildPlaygroundPersonaBaseKey(agentType, label)
		const existing = await prisma.ai_playground_personas.findMany({
			where: {
				app_id: appId,
				persona_key: { startsWith: baseKey },
				...(excludePersonaId ? { id: { not: excludePersonaId } } : {}),
			},
			select: { persona_key: true },
		})
		const existingKeySet = new Set(existing.map((item) => item.persona_key))
		if (!existingKeySet.has(baseKey)) return baseKey

		for (let index = 2; index <= 999; index += 1) {
			const candidate = `${baseKey}-${index}`.slice(0, 80)
			if (!existingKeySet.has(candidate)) return candidate
		}
		throw new Error('Unable to generate unique persona key')
	}

	private static getPlaygroundDefaultPersonaKeyForAgentType(
		agentType: PlaygroundAgentType,
	): string | null {
		const matched = PLAYGROUND_DEFAULT_PERSONAS.find(
			(persona) =>
				AIService.resolvePlaygroundAgentTypeFromPersonaKey(
					persona.persona_key,
				) === agentType,
		)
		return matched?.persona_key || null
	}

	private static resolvePlaygroundDefaultPersonaIdByType(
		personas: Array<{
			id: string
			persona_key: string
			sort_order: number | null
		}>,
	) {
		const defaults = new Map<PlaygroundAgentType, string>()
		for (const persona of personas) {
			const agentType = AIService.resolvePlaygroundAgentTypeFromPersonaKey(
				persona.persona_key,
			)
			if (!defaults.has(agentType)) {
				defaults.set(agentType, persona.id)
			}
		}
		return defaults
	}

	private static normalizeConfidenceValue(
		value: unknown,
		fieldName: string,
	): number | null {
		const parsed = AIService.toOptionalFiniteNumber(value)
		if (parsed === undefined) return null
		if (parsed < 0 || parsed > 1) {
			throw new Error(`${fieldName} must be between 0 and 1`)
		}
		return Number(parsed.toFixed(2))
	}

	private static parsePlaygroundRoutingRules(
		value: unknown,
	): PlaygroundRoutingRule[] {
		if (!Array.isArray(value)) return []

		const rules: PlaygroundRoutingRule[] = []
		for (let index = 0; index < value.length; index += 1) {
			const record = toRecord(value[index])
			if (!record) continue

			const ruleId =
				toTrimmedString(record.id) ||
				AIService.slugifyPlaygroundKey(`rule-${index + 1}`)
			const ruleName = toTrimmedString(record.name) || `Rule ${index + 1}`
			const providerRaw = toTrimmedString(record.provider)
			const provider = providerRaw
				? AIService.normalizeRoutingProvider(providerRaw)
				: ''
			const modelKey =
				toTrimmedString(record.model_key) || toTrimmedString(record.modelId)
			const modelName =
				toTrimmedString(record.model_name) || toTrimmedString(record.modelName)
			const minConfidence = AIService.normalizeConfidenceValue(
				record.min_confidence ?? record.minConfidence,
				'minConfidence',
			)
			const maxConfidence = AIService.normalizeConfidenceValue(
				record.max_confidence ?? record.maxConfidence,
				'maxConfidence',
			)

			if (
				minConfidence !== null &&
				maxConfidence !== null &&
				minConfidence > maxConfidence
			) {
				throw new Error(
					`Rule ${index + 1} has invalid confidence range (${minConfidence} > ${maxConfidence})`,
				)
			}

			rules.push({
				id: ruleId,
				name: ruleName,
				provider,
				model_key: modelKey || null,
				model_name: modelName || null,
				min_confidence: minConfidence,
				max_confidence: maxConfidence,
				priority: index,
			})
		}

		return rules.sort((left, right) => left.priority - right.priority)
	}

	private static describeRoutingRule(rule: PlaygroundRoutingRule): string {
		const target =
			AIService.toOptionalTrimmedString(rule.model_name) ||
			AIService.toOptionalTrimmedString(rule.model_key) ||
			AIService.toOptionalTrimmedString(rule.provider) ||
			rule.name

		if (
			rule.min_confidence !== null &&
			rule.max_confidence !== null &&
			rule.min_confidence === 0 &&
			rule.max_confidence === 1
		) {
			return `${target} untuk semua confidence`
		}
		if (rule.max_confidence !== null && rule.min_confidence === null) {
			return `${target} kalau confidence <= ${rule.max_confidence.toFixed(2)}`
		}
		if (rule.min_confidence !== null && rule.max_confidence === null) {
			return `${target} kalau confidence >= ${rule.min_confidence.toFixed(2)}`
		}
		if (rule.min_confidence !== null && rule.max_confidence !== null) {
			return `${target} untuk confidence ${rule.min_confidence.toFixed(2)}-${rule.max_confidence.toFixed(2)}`
		}
		return `${target} untuk semua request`
	}

	private static buildRoutingDescriptionFromRules(
		rules: PlaygroundRoutingRule[],
	): string {
		if (rules.length === 0) return 'Custom routing rules'
		const snippets = rules
			.slice(0, 2)
			.map((rule) => AIService.describeRoutingRule(rule))
		if (rules.length > 2) {
			snippets.push(`+${rules.length - 2} rules lainnya`)
		}
		return snippets.join(' · ')
	}

	private static async ensureUniquePlaygroundStrategyKey(
		appId: string,
		label: string,
	): Promise<string> {
		const baseKey = AIService.slugifyPlaygroundKey(label).slice(0, 72)
		const existing = await prisma.ai_playground_routing_strategies.findMany({
			where: {
				app_id: appId,
				strategy_key: {
					startsWith: baseKey,
				},
			},
			select: { strategy_key: true },
		})

		const taken = new Set(
			existing
				.map((item) => AIService.toOptionalTrimmedString(item.strategy_key))
				.filter((key): key is string => Boolean(key)),
		)
		if (!taken.has(baseKey)) return baseKey

		for (let index = 2; index <= 9999; index += 1) {
			const suffix = `-${index}`
			const next = `${baseKey.slice(0, Math.max(1, 80 - suffix.length))}${suffix}`
			if (!taken.has(next)) return next
		}

		return `${baseKey.slice(0, 73)}-${Date.now().toString().slice(-6)}`
	}

	private static async normalizePlaygroundRoutingRulesForCreate(
		appId: string,
		value: unknown,
	): Promise<PlaygroundRoutingRule[]> {
		const parsedRules = AIService.parsePlaygroundRoutingRules(value)
		if (parsedRules.length === 0) return []

		const modelKeys = Array.from(
			new Set(
				parsedRules
					.map((rule) => AIService.toOptionalTrimmedString(rule.model_key))
					.filter((key): key is string => Boolean(key)),
			),
		)
		const modelRows =
			modelKeys.length > 0
				? await prisma.ai_playground_models.findMany({
						where: {
							app_id: appId,
							model_key: { in: modelKeys },
						},
					})
				: []
		const modelByKey = new Map(modelRows.map((row) => [row.model_key, row]))

		return parsedRules.map((rule, index) => {
			const normalizedModelKey = AIService.toOptionalTrimmedString(
				rule.model_key,
			)
			const model = normalizedModelKey
				? modelByKey.get(normalizedModelKey)
				: null
			if (normalizedModelKey && !model) {
				throw new Error(
					`Rule ${index + 1}: model "${normalizedModelKey}" tidak ditemukan`,
				)
			}

			const providerFromRule = AIService.toOptionalTrimmedString(rule.provider)
			const providerFromModel = model
				? AIService.normalizeRoutingProvider(model.vendor)
				: null
			const normalizedProviderFromRule = providerFromRule
				? AIService.normalizeRoutingProvider(providerFromRule)
				: null
			const normalizedProvider = normalizedProviderFromRule || providerFromModel
			if (!normalizedProvider) {
				throw new Error(
					`Rule ${index + 1}: provider wajib diisi jika model tidak dipilih`,
				)
			}
			if (
				normalizedProviderFromRule &&
				providerFromModel &&
				normalizedProviderFromRule !== providerFromModel
			) {
				throw new Error(
					`Rule ${index + 1}: model "${model?.name}" tidak cocok dengan provider "${providerFromRule}"`,
				)
			}

			const minConfidence = rule.min_confidence
			const maxConfidence = rule.max_confidence
			if (
				minConfidence !== null &&
				maxConfidence !== null &&
				minConfidence > maxConfidence
			) {
				throw new Error(
					`Rule ${index + 1}: minConfidence tidak boleh > maxConfidence`,
				)
			}

			return {
				id:
					AIService.toOptionalTrimmedString(rule.id) ||
					AIService.slugifyPlaygroundKey(`rule-${index + 1}`),
				name:
					AIService.toOptionalTrimmedString(rule.name) || `Rule ${index + 1}`,
				provider: normalizedProvider,
				model_key: model?.model_key || normalizedModelKey || null,
				model_name: model?.name || rule.model_name || null,
				min_confidence: minConfidence,
				max_confidence: maxConfidence,
				priority: index,
			}
		})
	}

	private static routingRuleMatchesConfidence(
		rule: PlaygroundRoutingRule,
		confidence: number,
	): boolean {
		if (rule.min_confidence !== null && confidence < rule.min_confidence) {
			return false
		}
		if (rule.max_confidence !== null && confidence > rule.max_confidence) {
			return false
		}
		return true
	}

	private static simulatePlaygroundConfidence(message: string): number {
		const normalizedLength = Math.min(1, message.length / 420)
		const baseline = 0.48 + normalizedLength * 0.34
		const jitter = (Math.random() - 0.5) * 0.18
		return clamp(Number((baseline + jitter).toFixed(2)), 0.05, 0.99)
	}

	private static normalizeSettingsUpdatePayload(data: Record<string, any>) {
		const nextData: Record<string, any> = {}

		const aiMode = AIService.toOptionalTrimmedString(data.ai_mode)
		if (aiMode !== undefined) nextData.ai_mode = aiMode

		const modelProvider = AIService.toOptionalTrimmedString(data.model_provider)
		if (modelProvider !== undefined) nextData.model_provider = modelProvider

		const modelName = AIService.toOptionalTrimmedString(data.model_name)
		if (modelName !== undefined) nextData.model_name = modelName

		const responseTone = AIService.toOptionalTrimmedString(data.response_tone)
		if (responseTone !== undefined) nextData.response_tone = responseTone

		const apiKey = AIService.toOptionalTrimmedString(data.api_key)
		if (apiKey !== undefined) nextData.api_key = apiKey

		const apiEndpoint = AIService.toOptionalTrimmedString(data.api_endpoint)
		if (apiEndpoint !== undefined) nextData.api_endpoint = apiEndpoint

		const apiVersion = AIService.toOptionalTrimmedString(data.api_version)
		if (apiVersion !== undefined) nextData.api_version = apiVersion

		const deploymentName = AIService.toOptionalTrimmedString(
			data.deployment_name,
		)
		if (deploymentName !== undefined) nextData.deployment_name = deploymentName

		const temperature = AIService.toOptionalFiniteNumber(data.temperature)
		if (temperature !== undefined) nextData.temperature = temperature

		const maxTokens = AIService.toOptionalFiniteNumber(data.max_tokens)
		if (maxTokens !== undefined) nextData.max_tokens = Math.trunc(maxTokens)

		const autoReplyConfidence = AIService.toOptionalFiniteNumber(
			data.auto_reply_confidence,
		)
		if (autoReplyConfidence !== undefined) {
			nextData.auto_reply_confidence = autoReplyConfidence
		}

		const maxRepliesPerConversation = AIService.toOptionalFiniteNumber(
			data.max_ai_replies_per_conversation,
		)
		if (maxRepliesPerConversation !== undefined) {
			nextData.max_ai_replies_per_conversation = Math.trunc(
				maxRepliesPerConversation,
			)
		}

		const cooldownAfterLimit = AIService.toOptionalFiniteNumber(
			data.cooldown_after_limit_minutes,
		)
		if (cooldownAfterLimit !== undefined) {
			nextData.cooldown_after_limit_minutes = Math.trunc(cooldownAfterLimit)
		}

		const autoDetectLanguage = AIService.toOptionalBoolean(
			data.auto_detect_language,
		)
		if (autoDetectLanguage !== undefined) {
			nextData.auto_detect_language = autoDetectLanguage
		}

		const usePlatformCredentials = AIService.toOptionalBoolean(
			data.use_platform_credentials,
		)
		if (usePlatformCredentials !== undefined) {
			nextData.use_platform_credentials = usePlatformCredentials
		}

		const handoffKeywords = AIService.toOptionalStringArray(
			data.handoff_keywords,
		)
		if (handoffKeywords !== undefined) {
			nextData.handoff_keywords = handoffKeywords
		}

		const supportedLanguages = AIService.toOptionalStringArray(
			data.supported_languages,
		)
		if (supportedLanguages !== undefined) {
			nextData.supported_languages = supportedLanguages
		}

		return nextData
	}

	private static toProviderProtocol(
		value: unknown,
	): ProviderProtocol | undefined {
		const normalized = AIService.toOptionalTrimmedString(value)?.toLowerCase()
		if (normalized === 'openai' || normalized === 'anthropic') {
			return normalized
		}
		return undefined
	}

	private static toProviderAuthHeader(
		value: unknown,
	): ProviderAuthHeader | undefined {
		const normalized = AIService.toOptionalTrimmedString(value)?.toLowerCase()
		if (normalized === 'authorization' || normalized === 'x-api-key') {
			return normalized
		}
		return undefined
	}

	private static toProviderAuthScheme(
		value: unknown,
	): ProviderAuthScheme | undefined {
		const normalized = AIService.toOptionalTrimmedString(value)?.toLowerCase()
		if (normalized === 'bearer' || normalized === 'raw') {
			return normalized
		}
		return undefined
	}

	private static sanitizeProviderChannelInput(
		value: unknown,
	): ProviderChannelInput | undefined {
		const record = toRecord(value)
		if (!record) return undefined

		const baseUrl = AIService.toOptionalTrimmedString(record.base_url)
		if (!baseUrl) return undefined

		const sanitized: ProviderChannelInput = { base_url: baseUrl }
		const normalizedPath = AIService.toOptionalTrimmedString(record.path)
		if (normalizedPath) {
			sanitized.path = normalizedPath.startsWith('/')
				? normalizedPath
				: `/${normalizedPath}`
		}

		const authHeader = AIService.toProviderAuthHeader(record.auth_header)
		if (authHeader) sanitized.auth_header = authHeader
		const authScheme = AIService.toProviderAuthScheme(record.auth_scheme)
		if (authScheme) sanitized.auth_scheme = authScheme

		return sanitized
	}

	private static sanitizeProviderChannels(
		value: unknown,
	): Partial<Record<ProviderProtocol, ProviderChannelInput>> | undefined {
		const channelsRecord = toRecord(value)
		if (!channelsRecord) return undefined

		const sanitized: Partial<Record<ProviderProtocol, ProviderChannelInput>> =
			{}
		const openaiChannel = AIService.sanitizeProviderChannelInput(
			channelsRecord.openai,
		)
		if (openaiChannel) sanitized.openai = openaiChannel
		const anthropicChannel = AIService.sanitizeProviderChannelInput(
			channelsRecord.anthropic,
		)
		if (anthropicChannel) sanitized.anthropic = anthropicChannel

		return Object.keys(sanitized).length > 0 ? sanitized : undefined
	}

	private static sanitizeProviderModelCatalog(
		value: unknown,
	): ProviderModelCatalogItem[] | undefined {
		if (!Array.isArray(value)) return undefined

		const sanitized: ProviderModelCatalogItem[] = []
		for (const entry of value) {
			const record = toRecord(entry)
			if (!record) continue
			const rawId = AIService.toOptionalTrimmedString(record.id)
			if (!rawId) continue
			const id = rawId.replace(/-free$/, '')
			sanitized.push({
				id,
				name: AIService.toOptionalTrimmedString(record.name) || rawId,
				vendor: AIService.toOptionalTrimmedString(record.vendor) || 'Unknown',
				context_window:
					AIService.toOptionalTrimmedString(record.context_window) || '-',
				max_output: AIService.toOptionalTrimmedString(record.max_output) || '-',
			})
		}

		return sanitized.length > 0 ? sanitized : undefined
	}

	private static buildDefaultGrowthcircleProviderConfig(): ProviderConfigRecord {
		return {
			provider: DEFAULT_AI_PROVIDER,
			base_url: GROWTHCIRCLE_OPENAI_BASE_URL,
			plan_type: 'free',
			model_name: GROWTHCIRCLE_DEFAULT_MODEL_ID,
			default_protocol: 'openai',
			channels: {
				openai: {
					base_url: GROWTHCIRCLE_OPENAI_BASE_URL,
					auth_header: 'authorization',
					auth_scheme: 'bearer',
				},
				anthropic: {
					base_url: GROWTHCIRCLE_ANTHROPIC_BASE_URL,
					path: GROWTHCIRCLE_ANTHROPIC_PATH,
					auth_header: 'x-api-key',
					auth_scheme: 'raw',
				},
			},
			models: GROWTHCIRCLE_DEFAULT_MODEL_CATALOG,
		}
	}

	private static parseProviderConfig(
		provider: AIProvider,
		rawValue: string,
	): ProviderConfigRecord | null {
		try {
			const parsed = JSON.parse(rawValue) as ProviderConfigInput
			return AIService.sanitizeProviderInput(provider, parsed)
		} catch {
			return null
		}
	}

	private static sanitizeProviderInput(
		provider: AIProvider,
		data: ProviderConfigInput,
	): ProviderConfigRecord {
		const baseUrl = String(data.base_url || '').trim()
		if (!baseUrl) {
			throw new Error('base_url is required')
		}

		const sanitized: ProviderConfigRecord = {
			provider,
			base_url: baseUrl,
		}

		if (typeof data.api_key === 'string' && data.api_key.trim()) {
			sanitized.api_key = data.api_key.trim()
		}
		if (
			data.plan_type === 'free' ||
			data.plan_type === 'paid' ||
			data.plan_type === 'team'
		) {
			sanitized.plan_type = data.plan_type
		}
		if (typeof data.model_name === 'string' && data.model_name.trim()) {
			sanitized.model_name = data.model_name.trim()
		}
		if (typeof data.api_version === 'string' && data.api_version.trim()) {
			sanitized.api_version = data.api_version.trim()
		}
		if (
			typeof data.deployment_name === 'string' &&
			data.deployment_name.trim()
		) {
			sanitized.deployment_name = data.deployment_name.trim()
		}

		const parsedTemperature = AIService.toOptionalFiniteNumber(data.temperature)
		if (parsedTemperature !== undefined)
			sanitized.temperature = parsedTemperature

		const parsedMaxTokens = AIService.toOptionalFiniteNumber(data.max_tokens)
		if (parsedMaxTokens !== undefined) {
			sanitized.max_tokens = Math.trunc(parsedMaxTokens)
		}

		const defaultProtocol = AIService.toProviderProtocol(data.default_protocol)
		if (defaultProtocol) sanitized.default_protocol = defaultProtocol

		const channels = AIService.sanitizeProviderChannels(data.channels)
		if (channels) sanitized.channels = channels

		const models = AIService.sanitizeProviderModelCatalog(data.models)
		if (models) sanitized.models = models

		if (provider === 'growthcircle') {
			if (!sanitized.model_name) {
				sanitized.model_name = GROWTHCIRCLE_DEFAULT_MODEL_ID
			}

			const planType = sanitized.plan_type || 'free'
			if (planType === 'paid' || planType === 'team') {
				sanitized.model_name = sanitized.model_name.replace(/-free$/, '')
			} else if (
				planType === 'free' &&
				!sanitized.model_name.endsWith('-free')
			) {
				sanitized.model_name = `${sanitized.model_name}-free`
			}

			sanitized.default_protocol =
				sanitized.default_protocol ||
				AIService.toProviderProtocol(
					sanitized.channels?.openai ? 'openai' : undefined,
				) ||
				'openai'

			sanitized.channels = {
				openai: {
					base_url:
						sanitized.channels?.openai?.base_url ||
						GROWTHCIRCLE_OPENAI_BASE_URL,
					auth_header:
						sanitized.channels?.openai?.auth_header || 'authorization',
					auth_scheme: sanitized.channels?.openai?.auth_scheme || 'bearer',
				},
				anthropic: {
					base_url:
						sanitized.channels?.anthropic?.base_url ||
						GROWTHCIRCLE_ANTHROPIC_BASE_URL,
					path:
						sanitized.channels?.anthropic?.path || GROWTHCIRCLE_ANTHROPIC_PATH,
					auth_header:
						sanitized.channels?.anthropic?.auth_header || 'x-api-key',
					auth_scheme: sanitized.channels?.anthropic?.auth_scheme || 'raw',
				},
			}

			sanitized.models =
				sanitized.models && sanitized.models.length > 0
					? sanitized.models
					: GROWTHCIRCLE_DEFAULT_MODEL_CATALOG
		}

		return sanitized
	}

	private static ensureSupportedProvider(provider: string): AIProvider {
		const normalized = provider.trim().toLowerCase() as AIProvider
		if (!SUPPORTED_AI_PROVIDERS.includes(normalized)) {
			throw new Error(
				`Unsupported provider "${provider}". Supported providers: ${SUPPORTED_AI_PROVIDERS.join(', ')}`,
			)
		}
		return normalized
	}

	private static normalizeProviderConfigRecord(
		provider: AIProvider,
		rawValue: unknown,
	): ProviderConfigRecord | null {
		if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
			return null
		}

		try {
			return AIService.sanitizeProviderInput(
				provider,
				rawValue as ProviderConfigInput,
			)
		} catch {
			return null
		}
	}

	private static resolveValidProviderCandidate(
		value: unknown,
		providers: Record<AIProvider, ProviderConfigRecord | null>,
	): AIProvider | null {
		const candidate =
			typeof value === 'string' ? value.trim().toLowerCase() : ''
		if (!SUPPORTED_AI_PROVIDERS.includes(candidate as AIProvider)) return null
		const normalized = candidate as AIProvider
		return providers[normalized] ? normalized : null
	}

	private static pickAutoEmbeddingProvider(
		providers: Record<AIProvider, ProviderConfigRecord | null>,
		activeProvider: AIProvider | null,
	): AIProvider | null {
		if (providers.sumopod) return 'sumopod'
		if (activeProvider && providers[activeProvider]) return activeProvider
		for (const provider of SUPPORTED_AI_PROVIDERS) {
			if (providers[provider]) return provider
		}
		return null
	}

	private static normalizeProviderConfigurationsPayload(
		rawValue: unknown,
	): ProviderConfigurationsPayload | null {
		if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) {
			return null
		}

		const parsed = rawValue as Record<string, unknown>
		const providersRaw =
			parsed.providers && typeof parsed.providers === 'object'
				? (parsed.providers as Record<string, unknown>)
				: null
		if (!providersRaw) return null

		const providers = SUPPORTED_AI_PROVIDERS.reduce(
			(acc, provider) => {
				acc[provider] = AIService.normalizeProviderConfigRecord(
					provider,
					providersRaw[provider],
				)
				return acc
			},
			{} as Record<AIProvider, ProviderConfigRecord | null>,
		)

		const active_provider = AIService.resolveValidProviderCandidate(
			parsed.active_provider,
			providers,
		)
		const active_embedding_provider = AIService.resolveValidProviderCandidate(
			parsed.active_embedding_provider,
			providers,
		)

		return { active_provider, active_embedding_provider, providers }
	}

	private static async readProviderConfigurationsCache() {
		try {
			const raw = await redis.get(PROVIDER_CONFIG_CACHE_KEY)
			if (!raw) return null
			return AIService.normalizeProviderConfigurationsPayload(JSON.parse(raw))
		} catch (error) {
			console.warn(
				'[AIService] Failed to read provider configurations from Redis cache',
				error,
			)
			return null
		}
	}

	private static async writeProviderConfigurationsCache(
		payload: ProviderConfigurationsPayload,
	) {
		try {
			await redis.set(
				PROVIDER_CONFIG_CACHE_KEY,
				JSON.stringify(payload),
				'EX',
				PROVIDER_CONFIG_CACHE_TTL_SECONDS,
			)
		} catch (error) {
			console.warn(
				'[AIService] Failed to write provider configurations to Redis cache',
				error,
			)
		}
	}

	private static async invalidateProviderConfigurationsCache() {
		try {
			await redis.del(PROVIDER_CONFIG_CACHE_KEY)
		} catch (error) {
			console.warn(
				'[AIService] Failed to invalidate provider configurations cache',
				error,
			)
		}
	}

	private static async getProviderConfigurationsFromDb(): Promise<ProviderConfigurationsPayload> {
		const providerKeys = SUPPORTED_AI_PROVIDERS.map((provider) =>
			providerConfigKey(provider),
		)

		const rows = await prisma.platform_settings.findMany({
			where: {
				key: {
					in: [
						ACTIVE_PROVIDER_KEY,
						ACTIVE_EMBEDDING_PROVIDER_KEY,
						...providerKeys,
					],
				},
			},
			select: { key: true, value: true },
		})

		const rowMap = new Map(rows.map((row) => [row.key, row.value]))

		const providers = SUPPORTED_AI_PROVIDERS.reduce(
			(acc, provider) => {
				const raw = rowMap.get(providerConfigKey(provider))
				acc[provider] =
					typeof raw === 'string'
						? AIService.parseProviderConfig(provider, raw)
						: null
				return acc
			},
			{} as Record<AIProvider, ProviderConfigRecord | null>,
		)

		const active_provider = AIService.resolveValidProviderCandidate(
			rowMap.get(ACTIVE_PROVIDER_KEY),
			providers,
		)
		const active_embedding_provider = AIService.resolveValidProviderCandidate(
			rowMap.get(ACTIVE_EMBEDDING_PROVIDER_KEY),
			providers,
		)

		return { active_provider, active_embedding_provider, providers }
	}

	private static async ensureDefaultProviderConfigurations(
		payload: ProviderConfigurationsPayload,
	): Promise<ProviderConfigurationsPayload> {
		const providers = { ...payload.providers }
		let activeProvider =
			AIService.resolveValidProviderCandidate(
				payload.active_provider,
				providers,
			) || null
		let activeEmbeddingProvider =
			AIService.resolveValidProviderCandidate(
				payload.active_embedding_provider,
				providers,
			) || null
		const writes: Array<ReturnType<typeof prisma.platform_settings.upsert>> = []

		if (!providers[DEFAULT_AI_PROVIDER]) {
			const defaultGrowthcircle =
				AIService.buildDefaultGrowthcircleProviderConfig()
			providers[DEFAULT_AI_PROVIDER] = defaultGrowthcircle
			writes.push(
				prisma.platform_settings.upsert({
					where: { key: providerConfigKey(DEFAULT_AI_PROVIDER) },
					update: {
						value: JSON.stringify(defaultGrowthcircle),
						updated_at: new Date(),
					},
					create: {
						key: providerConfigKey(DEFAULT_AI_PROVIDER),
						value: JSON.stringify(defaultGrowthcircle),
					},
				}),
			)
		}

		if (!activeProvider || !providers[activeProvider]) {
			activeProvider = DEFAULT_AI_PROVIDER
			writes.push(
				prisma.platform_settings.upsert({
					where: { key: ACTIVE_PROVIDER_KEY },
					update: {
						value: DEFAULT_AI_PROVIDER,
						updated_at: new Date(),
					},
					create: {
						key: ACTIVE_PROVIDER_KEY,
						value: DEFAULT_AI_PROVIDER,
					},
				}),
			)
		}

		const autoEmbeddingProvider = AIService.pickAutoEmbeddingProvider(
			providers,
			activeProvider,
		)
		if (!activeEmbeddingProvider || !providers[activeEmbeddingProvider]) {
			activeEmbeddingProvider = autoEmbeddingProvider
			if (activeEmbeddingProvider) {
				writes.push(
					prisma.platform_settings.upsert({
						where: { key: ACTIVE_EMBEDDING_PROVIDER_KEY },
						update: {
							value: activeEmbeddingProvider,
							updated_at: new Date(),
						},
						create: {
							key: ACTIVE_EMBEDDING_PROVIDER_KEY,
							value: activeEmbeddingProvider,
						},
					}),
				)
			}
		}

		if (writes.length > 0) {
			await prisma.$transaction(writes)
		}

		return {
			active_provider: activeProvider,
			active_embedding_provider: activeEmbeddingProvider,
			providers,
		}
	}

	static async getProviderConfigurations() {
		const cached = await AIService.readProviderConfigurationsCache()
		if (cached) {
			const ensured =
				await AIService.ensureDefaultProviderConfigurations(cached)
			await AIService.writeProviderConfigurationsCache(ensured)
			return ensured
		}

		const fromDb = await AIService.getProviderConfigurationsFromDb()
		const ensured = await AIService.ensureDefaultProviderConfigurations(fromDb)
		await AIService.writeProviderConfigurationsCache(ensured)
		return ensured
	}

	static async upsertProviderConfiguration(providerInput: string, data: any) {
		const provider = AIService.ensureSupportedProvider(providerInput)
		const sanitized = AIService.sanitizeProviderInput(provider, data)

		await prisma.platform_settings.upsert({
			where: { key: providerConfigKey(provider) },
			update: {
				value: JSON.stringify(sanitized),
				updated_at: new Date(),
			},
			create: {
				key: providerConfigKey(provider),
				value: JSON.stringify(sanitized),
			},
		})

		await AIService.invalidateProviderConfigurationsCache()

		return sanitized
	}

	static async setActiveProvider(providerInput: string) {
		const provider = AIService.ensureSupportedProvider(providerInput)

		await prisma.platform_settings.upsert({
			where: { key: ACTIVE_PROVIDER_KEY },
			update: {
				value: provider,
				updated_at: new Date(),
			},
			create: {
				key: ACTIVE_PROVIDER_KEY,
				value: provider,
			},
		})

		await AIService.invalidateProviderConfigurationsCache()

		return provider
	}

	static async setActiveEmbeddingProvider(providerInput: string) {
		const provider = AIService.ensureSupportedProvider(providerInput)

		await prisma.platform_settings.upsert({
			where: { key: ACTIVE_EMBEDDING_PROVIDER_KEY },
			update: {
				value: provider,
				updated_at: new Date(),
			},
			create: {
				key: ACTIVE_EMBEDDING_PROVIDER_KEY,
				value: provider,
			},
		})

		await AIService.invalidateProviderConfigurationsCache()

		return provider
	}

	static async getRuntimeProviderConfig(
		purpose: RuntimeProviderPurpose = 'completion',
	) {
		const config = await AIService.getProviderConfigurations()
		const activeProvider =
			purpose === 'embedding'
				? config.active_embedding_provider
				: config.active_provider
		if (!activeProvider) return null
		return config.providers[activeProvider]
	}

	static async testProviderModel(
		providerInput: string,
		payload: ProviderModelTestInput,
	) {
		const provider = AIService.ensureSupportedProvider(providerInput)
		const providerConfig = payload?.config
			? AIService.sanitizeProviderInput(provider, payload.config)
			: (await AIService.getProviderConfigurations()).providers[provider]
		if (!providerConfig) {
			throw new Error(`Provider "${provider}" belum dikonfigurasi`)
		}

		const apiKey =
			AIService.toOptionalTrimmedString(payload?.apiKey) ||
			AIService.toOptionalTrimmedString(providerConfig.api_key)
		if (!apiKey) {
			throw new Error('API Key belum diisi untuk provider ini')
		}

		const modelCatalog = Array.isArray(providerConfig.models)
			? providerConfig.models
			: []
		const requestedModelId = AIService.toOptionalTrimmedString(payload?.modelId)
		const selectedModelId =
			requestedModelId ||
			AIService.toOptionalTrimmedString(providerConfig.model_name) ||
			modelCatalog[0]?.id
		if (!selectedModelId) {
			throw new Error('Model ID belum dipilih')
		}

		const selectedModel =
			modelCatalog.find(
				(item) => item.id === selectedModelId || item.name === selectedModelId,
			) || null
		let resolvedModelId = selectedModel?.id || selectedModelId

		if (provider === 'growthcircle') {
			const planType = providerConfig.plan_type || 'free'
			if (planType === 'paid' || planType === 'team') {
				resolvedModelId = resolvedModelId.replace(/-free$/, '')
			} else if (planType === 'free' && !resolvedModelId.endsWith('-free')) {
				resolvedModelId = `${resolvedModelId}-free`
			}
		}

		const fallbackProtocol =
			AIService.toProviderProtocol(providerConfig.default_protocol) ||
			(providerConfig.channels?.openai ? 'openai' : undefined) ||
			(providerConfig.channels?.anthropic ? 'anthropic' : undefined) ||
			'openai'
		const protocolOverride = AIService.toProviderProtocol(payload?.protocol)
		let protocol =
			protocolOverride ||
			AIService.inferProtocolFromModelCatalog({
				modelId: resolvedModelId,
				vendor: selectedModel?.vendor,
				fallback: fallbackProtocol,
			})

		const availableProtocols: ProviderProtocol[] = []
		if (providerConfig.channels?.openai) availableProtocols.push('openai')
		if (providerConfig.channels?.anthropic) availableProtocols.push('anthropic')
		if (
			availableProtocols.length > 0 &&
			!availableProtocols.includes(protocol)
		) {
			protocol = availableProtocols[0]
		}
		if (availableProtocols.length > 0 && !providerConfig.channels?.[protocol]) {
			protocol = availableProtocols[0]
		}

		const channel = providerConfig.channels?.[protocol]
		const baseUrl =
			AIService.toOptionalTrimmedString(channel?.base_url) ||
			AIService.toOptionalTrimmedString(providerConfig.base_url)
		if (!baseUrl) {
			throw new Error('Base URL provider belum diisi')
		}

		const channelPath = AIService.toOptionalTrimmedString(channel?.path)
		const baseUrlEndsWithVersion = /\/v\d+\/?$/i.test(baseUrl)
		const path =
			channelPath ||
			(protocol === 'anthropic'
				? baseUrlEndsWithVersion
					? '/messages'
					: '/v1/messages'
				: baseUrlEndsWithVersion
					? '/chat/completions'
					: '/v1/chat/completions')
		const endpoint = provider === 'custom' ? baseUrl : joinUrl(baseUrl, path)
		const authHeader: ProviderAuthHeader =
			channel?.auth_header ||
			(protocol === 'anthropic' ? 'x-api-key' : 'authorization')
		const authScheme: ProviderAuthScheme =
			channel?.auth_scheme ||
			(authHeader === 'authorization' ? 'bearer' : 'raw')
		const authValue = authScheme === 'bearer' ? `Bearer ${apiKey}` : apiKey

		const prompt = AIService.toOptionalTrimmedString(payload?.message) || 'Halo'
		const overrideMaxTokens = AIService.toOptionalFiniteNumber(
			payload?.maxTokens,
		)
		const maxTokensFromModel = AIService.parseTokenLimit(
			selectedModel?.max_output,
		)
		const maxTokensFromProvider = AIService.toOptionalFiniteNumber(
			providerConfig.max_tokens,
		)
		const maxTokens = Math.max(
			1,
			Math.trunc(
				overrideMaxTokens ?? maxTokensFromModel ?? maxTokensFromProvider ?? 256,
			),
		)

		const requestBody =
			protocol === 'anthropic'
				? {
						model: resolvedModelId,
						max_tokens: maxTokens,
						messages: [{ role: 'user', content: prompt }],
					}
				: {
						model: resolvedModelId,
						max_tokens: maxTokens,
						messages: [{ role: 'user', content: prompt }],
					}

		const headers: Record<string, string> = {
			'Content-Type': 'application/json',
		}
		if (authHeader === 'authorization') {
			headers.Authorization = authValue
		} else {
			headers['x-api-key'] = authValue
		}

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

		try {
			const response = await fetch(endpoint, {
				method: 'POST',
				headers,
				body: JSON.stringify(requestBody),
				signal: controller.signal,
			})

			const rawText = await response.text()
			let responsePayload: unknown = rawText
			if (rawText) {
				try {
					responsePayload = JSON.parse(rawText)
				} catch {
					responsePayload = rawText
				}
			}

			if (!response.ok) {
				const errorDetail =
					AIService.extractProviderErrorMessage(responsePayload) ||
					'Unknown provider error'
				throw new Error(
					`Provider test gagal (${response.status}) [${endpoint}]: ${errorDetail} DEBUG: sent auth=${authValue}, model=${resolvedModelId}`,
				)
			}

			const responseRecord = toRecord(responsePayload)
			return {
				provider,
				protocol,
				endpoint,
				model: {
					id: resolvedModelId,
					name: selectedModel?.name || null,
					vendor: selectedModel?.vendor || null,
				},
				request: {
					model: resolvedModelId,
					message: prompt,
					max_tokens: maxTokens,
				},
				response: {
					status: response.status,
					text: extractCompletionContent(responsePayload),
					usage: responseRecord?.usage || null,
					raw: responsePayload,
				},
			}
		} catch (error) {
			if (error instanceof Error && error.name === 'AbortError') {
				throw new Error('Provider test timeout, coba lagi')
			}
			throw error
		} finally {
			clearTimeout(timer)
		}
	}

	private static toSummaryRuntimeConfig(args: {
		settings: any
		runtimeProvider: ProviderConfigRecord | null
		embeddingRuntimeProvider?: ProviderConfigRecord | null
	}): SummaryRuntimeConfig {
		const settingsProvider = AIService.toOptionalTrimmedString(
			args.settings?.model_provider,
		)
		const provider =
			(args.runtimeProvider?.provider as AIProvider | undefined) ||
			(settingsProvider &&
			SUPPORTED_AI_PROVIDERS.includes(settingsProvider as AIProvider)
				? (settingsProvider as AIProvider)
				: null)

		const baseUrl =
			AIService.toOptionalTrimmedString(args.runtimeProvider?.base_url) ||
			AIService.toOptionalTrimmedString(args.settings?.api_endpoint) ||
			null
		const apiKey =
			AIService.toOptionalTrimmedString(args.runtimeProvider?.api_key) ||
			AIService.toOptionalTrimmedString(args.settings?.api_key) ||
			null
		let modelName =
			AIService.toOptionalTrimmedString(args.runtimeProvider?.model_name) ||
			AIService.toOptionalTrimmedString(args.settings?.model_name) ||
			DEFAULT_CHAT_MODEL

		if (provider === 'growthcircle') {
			const planType = args.runtimeProvider?.plan_type || 'free'
			if (planType === 'paid' || planType === 'team') {
				modelName = modelName.replace(/-free$/, '')
			} else if (planType === 'free' && !modelName.endsWith('-free')) {
				modelName = `${modelName}-free`
			}
		}
		const apiVersion =
			AIService.toOptionalTrimmedString(args.runtimeProvider?.api_version) ||
			AIService.toOptionalTrimmedString(args.settings?.api_version) ||
			'2024-02-15-preview'
		const deploymentName =
			AIService.toOptionalTrimmedString(
				args.runtimeProvider?.deployment_name,
			) ||
			AIService.toOptionalTrimmedString(args.settings?.deployment_name) ||
			modelName
		const embeddingProvider =
			(args.embeddingRuntimeProvider?.provider as AIProvider | undefined) ||
			provider
		const embeddingBaseUrl =
			AIService.toOptionalTrimmedString(
				args.embeddingRuntimeProvider?.base_url,
			) || baseUrl
		const embeddingApiKey =
			AIService.toOptionalTrimmedString(
				args.embeddingRuntimeProvider?.api_key,
			) || apiKey
		const embeddingApiVersion =
			AIService.toOptionalTrimmedString(
				args.embeddingRuntimeProvider?.api_version,
			) || apiVersion
		const embeddingDeploymentName =
			AIService.toOptionalTrimmedString(
				args.embeddingRuntimeProvider?.deployment_name,
			) || deploymentName

		const temperature = clamp(
			AIService.toOptionalFiniteNumber(args.runtimeProvider?.temperature) ??
				AIService.toOptionalFiniteNumber(args.settings?.temperature) ??
				0.2,
			0,
			1,
		)
		const maxTokens = Math.max(
			120,
			Math.min(
				700,
				Math.trunc(
					AIService.toOptionalFiniteNumber(args.runtimeProvider?.max_tokens) ??
						AIService.toOptionalFiniteNumber(args.settings?.max_tokens) ??
						280,
				),
			),
		)

		return {
			provider,
			baseUrl,
			apiKey,
			modelName,
			apiVersion,
			deploymentName,
			temperature,
			maxTokens,
			embeddingModel:
				AIService.toOptionalTrimmedString(process.env.AI_EMBEDDING_MODEL) ||
				DEFAULT_EMBEDDING_MODEL,
			embeddingProvider,
			embeddingBaseUrl,
			embeddingApiKey,
			embeddingApiVersion,
			embeddingDeploymentName,
		}
	}

	private static isAzureRuntime(runtime: SummaryRuntimeConfig): boolean {
		return (
			(runtime.provider || '').toLowerCase() === 'azure' ||
			Boolean(runtime.baseUrl?.includes('.openai.azure.com'))
		)
	}

	private static normalizeConversationMessageForSummary(row: {
		id: string
		message_type: string
		content: string | null
		content_type: string | null
		content_attributes: unknown
		sender_type: string | null
		private: boolean | null
		created_at: Date | null
	}): ConversationMessageForSummary | null {
		if (row.private === true) return null

		const messageType = String(row.message_type || '').toLowerCase()
		const senderType = String(row.sender_type || '').toLowerCase()
		const contentType = String(row.content_type || 'text').toLowerCase()
		if (senderType === 'system' || messageType === 'system') return null

		const role: ConversationMessageForSummary['role'] =
			senderType === 'contact' || messageType === 'incoming'
				? 'customer'
				: 'agent'

		const attributes = toRecord(row.content_attributes)
		const textCandidates = [
			toTrimmedString(row.content),
			toTrimmedString(attributes?.text),
			toTrimmedString(attributes?.body),
			toTrimmedString(attributes?.caption),
			toTrimmedString(attributes?.description),
			toTrimmedString(attributes?.preview),
			toTrimmedString(attributes?.title),
		].filter(Boolean) as string[]

		let normalizedText = textCandidates[0] || ''
		if (!normalizedText) {
			if (contentType === 'image') normalizedText = '[Image]'
			else if (contentType === 'video') normalizedText = '[Video]'
			else if (contentType === 'audio') normalizedText = '[Audio]'
			else if (contentType === 'document') normalizedText = '[Document]'
			else if (contentType === 'template') normalizedText = '[Template message]'
			else normalizedText = '[Message]'
		}

		normalizedText = truncateText(
			normalizeWhitespace(normalizedText),
			SUMMARY_MAX_MESSAGE_TEXT_LENGTH,
		)
		if (!normalizedText) return null

		return {
			id: row.id,
			createdAt: row.created_at || new Date(),
			role,
			text: normalizedText,
		}
	}

	private static async loadConversationMessagesForSummary(args: {
		appId: string
		conversationId: string
	}) {
		const conversation = await prisma.conversations.findFirst({
			where: {
				id: args.conversationId,
				app_id: args.appId,
			},
			select: {
				id: true,
				inbox_id: true,
			},
		})

		if (!conversation) {
			throw new Error('Conversation not found')
		}

		const rows = await prisma.messages.findMany({
			where: {
				conversation_id: args.conversationId,
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
			},
			select: {
				id: true,
				message_type: true,
				content: true,
				content_type: true,
				content_attributes: true,
				sender_type: true,
				private: true,
				created_at: true,
			},
			orderBy: { created_at: 'desc' },
			take: SUMMARY_MAX_MESSAGES,
		})

		const normalized = rows
			.reverse()
			.map((row) => AIService.normalizeConversationMessageForSummary(row))
			.filter(Boolean) as ConversationMessageForSummary[]

		return {
			conversation,
			messages: normalized,
		}
	}

	private static async requestEmbeddingBatch(args: {
		runtime: SummaryRuntimeConfig
		inputs: string[]
	}): Promise<number[][]> {
		const embeddingProvider =
			args.runtime.embeddingProvider || args.runtime.provider
		const embeddingBaseUrl =
			args.runtime.embeddingBaseUrl || args.runtime.baseUrl
		const embeddingApiKey = args.runtime.embeddingApiKey || args.runtime.apiKey
		const embeddingApiVersion =
			args.runtime.embeddingApiVersion || args.runtime.apiVersion
		const embeddingDeploymentName =
			args.runtime.embeddingDeploymentName || args.runtime.deploymentName
		const isAzureEmbeddingRuntime =
			(embeddingProvider || '').toLowerCase() === 'azure' ||
			Boolean(embeddingBaseUrl?.includes('.openai.azure.com'))

		if (!embeddingBaseUrl || !embeddingApiKey || args.inputs.length === 0) {
			return []
		}

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)

		try {
			if (isAzureEmbeddingRuntime) {
				const deployment =
					embeddingDeploymentName || args.runtime.embeddingModel
				const endpoint = joinUrl(
					embeddingBaseUrl,
					`openai/deployments/${encodeURIComponent(deployment)}/embeddings?api-version=${encodeURIComponent(embeddingApiVersion)}`,
				)

				const response = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'api-key': embeddingApiKey,
					},
					body: JSON.stringify({ input: args.inputs }),
					signal: controller.signal,
				})
				if (!response.ok) return []
				const payload = (await response.json().catch(() => null)) as unknown
				return extractEmbeddingVectors(payload)
			}

			const baseUrlEndsWithVersion = /\/v\d+\/?$/i.test(embeddingBaseUrl)
			const embeddingPath = baseUrlEndsWithVersion
				? '/embeddings'
				: '/v1/embeddings'
			const endpoint = joinUrl(embeddingBaseUrl, embeddingPath)
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${embeddingApiKey}`,
				},
				body: JSON.stringify({
					model: args.runtime.embeddingModel,
					input: args.inputs,
				}),
				signal: controller.signal,
			})
			if (!response.ok) return []
			const payload = (await response.json().catch(() => null)) as unknown
			return extractEmbeddingVectors(payload)
		} catch (error) {
			console.warn('[AIService] Failed to generate embedding batch', error)
			return []
		} finally {
			clearTimeout(timer)
		}
	}

	private static async requestSummaryCompletion(args: {
		runtime: SummaryRuntimeConfig
		systemPrompt: string
		userPrompt: string
	}): Promise<SummaryCompletionResult> {
		if (!args.runtime.baseUrl || !args.runtime.apiKey) {
			return {
				content: null,
				providerHit: false,
				endpoint: null,
				statusCode: null,
				error: 'missing_runtime_configuration',
				requestPayload: null,
			}
		}

		const controller = new AbortController()
		const timer = setTimeout(() => controller.abort(), AI_REQUEST_TIMEOUT_MS)
		let endpoint: string | null = null
		let requestPayload: Record<string, unknown> | null = null

		try {
			const messages = [
				{ role: 'system', content: args.systemPrompt },
				{ role: 'user', content: args.userPrompt },
			]

			if (AIService.isAzureRuntime(args.runtime)) {
				requestPayload = {
					messages,
					temperature: args.runtime.temperature,
					max_tokens: args.runtime.maxTokens,
				}
				const deployment = args.runtime.deploymentName || args.runtime.modelName
				endpoint = joinUrl(
					args.runtime.baseUrl,
					`openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(args.runtime.apiVersion)}`,
				)
				const response = await fetch(endpoint, {
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						'api-key': args.runtime.apiKey,
					},
					body: JSON.stringify(requestPayload),
					signal: controller.signal,
				})
				if (!response.ok) {
					const payload = (await response.json().catch(() => null)) as unknown
					return {
						content: null,
						providerHit: false,
						endpoint,
						statusCode: response.status,
						error:
							AIService.extractProviderErrorMessage(payload) ||
							`HTTP ${response.status} ${response.statusText}`,
						requestPayload,
					}
				}
				const payload = (await response.json().catch(() => null)) as unknown
				return {
					content: extractCompletionContent(payload),
					providerHit: true,
					endpoint,
					statusCode: response.status,
					error: null,
					requestPayload,
				}
			}

			const baseUrlEndsWithVersion = /\/v\d+\/?$/i.test(args.runtime.baseUrl)
			const completionPath = baseUrlEndsWithVersion
				? '/chat/completions'
				: '/v1/chat/completions'
			endpoint =
				args.runtime.provider === 'custom'
					? args.runtime.baseUrl
					: joinUrl(args.runtime.baseUrl, completionPath)
			requestPayload = {
				model: args.runtime.modelName,
				messages,
				temperature: args.runtime.temperature,
				max_tokens: args.runtime.maxTokens,
			}
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${args.runtime.apiKey}`,
				},
				body: JSON.stringify(requestPayload),
				signal: controller.signal,
			})
			if (!response.ok) {
				const payload = (await response.json().catch(() => null)) as unknown
				return {
					content: null,
					providerHit: false,
					endpoint,
					statusCode: response.status,
					error:
						AIService.extractProviderErrorMessage(payload) ||
						`HTTP ${response.status} ${response.statusText}`,
					requestPayload,
				}
			}
			const payload = (await response.json().catch(() => null)) as unknown
			return {
				content: extractCompletionContent(payload),
				providerHit: true,
				endpoint,
				statusCode: response.status,
				error: null,
				requestPayload,
			}
		} catch (error) {
			console.warn(
				'[AIService] Failed to generate AI summary completion',
				error,
			)
			return {
				content: null,
				providerHit: false,
				endpoint,
				statusCode: null,
				error:
					error instanceof Error
						? error.name === 'AbortError'
							? 'provider_timeout'
							: error.message
						: 'provider_request_failed',
				requestPayload,
			}
		} finally {
			clearTimeout(timer)
		}
	}

	private static buildFallbackSummary(
		messages: ConversationMessageForSummary[],
	): string {
		const lastCustomer = [...messages]
			.reverse()
			.find((message) => message.role === 'customer')
		const lastAgent = [...messages]
			.reverse()
			.find((message) => message.role === 'agent')
		const latestMessage = messages[messages.length - 1]
		const recentTranscript = messages
			.slice(-3)
			.map(
				(item) =>
					`${item.role === 'customer' ? 'Customer' : 'Agent'}: ${item.text}`,
			)
			.join(' | ')

		const points = [
			lastCustomer?.text
				? `Konsumen menyampaikan kebutuhan utama: ${lastCustomer.text}`
				: 'Kebutuhan utama konsumen belum terlihat jelas.',
			recentTranscript
				? `Detail percakapan terbaru: ${recentTranscript}`
				: 'Percakapan masih sangat singkat.',
			latestMessage
				? `Pesan terakhir dikirim oleh ${latestMessage.role === 'customer' ? 'konsumen' : 'agent'}.`
				: 'Belum ada aktivitas percakapan.',
			lastAgent
				? 'Lanjutkan follow-up sesuai kebutuhan terakhir konsumen.'
				: 'Agent perlu melakukan respons awal ke konsumen.',
		]
		return AIService.toSummaryBulletList(points.join('\n'))
	}

	private static buildPlaygroundFallbackResponse(message: string): string {
		const normalizedMessage = normalizeWhitespace(message || '')
		const lowerMessage = normalizedMessage.toLowerCase()

		if (
			lowerMessage.includes('produk') ||
			lowerMessage.includes('barang') ||
			lowerMessage.includes('item')
		) {
			return 'Kami punya beberapa kategori produk dengan opsi harga dan fitur berbeda. Boleh kasih tahu kebutuhan utama dan kisaran budget kamu supaya saya rekomendasikan yang paling pas?'
		}

		if (
			lowerMessage.includes('layanan') ||
			lowerMessage.includes('service') ||
			lowerMessage.includes('jasa')
		) {
			return 'Kami menyediakan beberapa layanan sesuai kebutuhan bisnis. Biar tepat, sebutkan dulu tujuan utama kamu dan prioritasnya (kecepatan, biaya, atau hasil) supaya saya arahkan ke layanan yang paling cocok.'
		}

		const trimmed = truncateText(normalizedMessage, 140)
		return `Siap, untuk pertanyaan "${trimmed}", saya sarankan kita mulai dari kebutuhan paling prioritas dulu, lalu saya bantu susun opsi terbaik beserta estimasi biaya dan langkah lanjutnya.`
	}

	private static buildPlaygroundNoRagResponse(args: {
		message: string
		retrievalError?: string
	}): string {
		const normalizedMessage = normalizeWhitespace(args.message || '')
		const trimmedMessage = truncateText(normalizedMessage, 120)
		if (args.retrievalError) {
			return `Maaf, saat ini data knowledge base sedang belum bisa diakses. Saya belum bisa memastikan jawaban untuk "${trimmedMessage}" tanpa referensi yang valid. Boleh coba lagi sebentar lagi atau saya bantu eskalasi ke agent?`
		}
		return `Saya belum menemukan referensi yang cukup relevan di knowledge base untuk "${trimmedMessage}". Boleh berikan detail tambahan (nama produk/varian/konteks kebutuhan) supaya saya cek ulang, atau saya bantu handover ke agent?`
	}

	private static toSummaryBulletList(raw: string): string {
		const normalizedLines = raw
			.split(/\r?\n/)
			.map((line) => line.trim())
			.filter(Boolean)
			.filter((line) => !/^ai\s+summary[:\s-]*/i.test(line))
			.map((line) => line.replace(/^[-*•]\s+/, '').trim())
			.map((line) => {
				const matchedLabel = line.match(
					/^(Intent|Detail Penting|Status|Next Action)\s*:\s*(.+)$/i,
				)
				if (matchedLabel && matchedLabel[2]) {
					return matchedLabel[2].trim()
				}
				return line
			})
			.filter(Boolean)

		if (normalizedLines.length === 0) {
			return '- Percakapan belum memiliki konteks yang cukup untuk diringkas.'
		}

		return normalizedLines
			.slice(0, 5)
			.map((line) => `- ${line}`)
			.join('\n')
	}

	private static async generateConversationSummary(args: {
		appId: string
		conversationId: string
		settings: any
		runtimeProvider: ProviderConfigRecord | null
		embeddingRuntimeProvider: ProviderConfigRecord | null
	}): Promise<SummaryGenerationResult> {
		const runtime = AIService.toSummaryRuntimeConfig({
			settings: args.settings,
			runtimeProvider: args.runtimeProvider,
			embeddingRuntimeProvider: args.embeddingRuntimeProvider,
		})
		const loaded = await AIService.loadConversationMessagesForSummary({
			appId: args.appId,
			conversationId: args.conversationId,
		})
		const sourceMessages = loaded.messages

		if (sourceMessages.length === 0) {
			return {
				suggestion:
					'- Belum ada percakapan yang bisa diringkas.\n- Menunggu pesan konsumen berikutnya.',
				confidence: 0.5,
				retrieval: {
					totalMessages: 0,
					indexedMessages: 0,
					selectedMessages: 0,
					semanticMatches: 0,
				},
			}
		}

		const embeddingCandidates = sourceMessages.slice(
			-SUMMARY_MAX_EMBED_MESSAGES,
		)
		const latestCustomer = [...embeddingCandidates]
			.reverse()
			.find((item) => item.role === 'customer')
		const latestMessage = embeddingCandidates[embeddingCandidates.length - 1]
		const queryText =
			latestCustomer?.text ||
			latestMessage?.text ||
			'Ringkasan percakapan customer'

		const embeddingInputs = [
			queryText,
			...embeddingCandidates.map((item) => item.text),
		]
		const vectors = await AIService.requestEmbeddingBatch({
			runtime,
			inputs: embeddingInputs,
		})

		let semanticMatches = 0
		const selectedIndices = new Set<number>()
		const recentStart = Math.max(
			0,
			embeddingCandidates.length - SUMMARY_RECENT_WINDOW,
		)
		for (let i = recentStart; i < embeddingCandidates.length; i++) {
			selectedIndices.add(i)
		}

		if (vectors.length === embeddingInputs.length) {
			const queryVector = vectors[0]
			const scored = vectors
				.slice(1)
				.map((vector, index) => ({
					index,
					score: cosineSimilarity(queryVector, vector),
				}))
				.filter((item) => Number.isFinite(item.score))
				.sort((a, b) => b.score - a.score)
				.slice(0, SUMMARY_SEMANTIC_TOP_K)

			for (const item of scored) {
				selectedIndices.add(item.index)
			}
			semanticMatches = scored.length
		}

		const selectedMessages = Array.from(selectedIndices)
			.sort((a, b) => a - b)
			.map((index) => embeddingCandidates[index])

		const transcript = selectedMessages
			.map((message) => {
				const ts = message.createdAt.toISOString()
				const role = message.role === 'customer' ? 'Customer' : 'Agent'
				return `- [${ts}] ${role}: ${message.text}`
			})
			.join('\n')

		const systemPrompt = [
			'You are a senior customer support analyst.',
			'Write concise and accurate summary from provided transcript only.',
			'Use Indonesian language.',
			'Do not invent facts.',
			'Output exactly 3-5 bullet points.',
			'Each line must start with "- " and contain one concrete point.',
			'Do not add heading, numbering, markdown bold, or extra explanation.',
		].join(' ')

		const userPrompt = [
			`Conversation ID: ${args.conversationId}`,
			`Total message considered: ${selectedMessages.length} / ${sourceMessages.length}`,
			'Transcript:',
			transcript,
		].join('\n\n')

		const completionResult = await AIService.requestSummaryCompletion({
			runtime,
			systemPrompt,
			userPrompt,
		})
		const completion = completionResult.content
		const suggestion = AIService.toSummaryBulletList(
			toTrimmedString(completion) ||
				AIService.buildFallbackSummary(selectedMessages),
		)

		const confidence = clamp(
			0.58 +
				(completion ? 0.2 : 0.05) +
				Math.min(0.15, semanticMatches * 0.01) +
				Math.min(0.1, selectedMessages.length * 0.005),
			0.45,
			0.95,
		)

		void prisma.ai_conversation_contexts
			.upsert({
				where: { conversation_id: args.conversationId },
				update: {
					context_summary: suggestion,
					last_ai_action: 'summary_generated',
					last_ai_action_at: new Date(),
					updated_at: new Date(),
				},
				create: {
					conversation_id: args.conversationId,
					context_summary: suggestion,
					last_ai_action: 'summary_generated',
					last_ai_action_at: new Date(),
					updated_at: new Date(),
				},
			})
			.catch((error) => {
				console.warn('[AIService] Failed to persist ai_conversation_contexts', {
					conversationId: args.conversationId,
					error,
				})
			})

		return {
			suggestion,
			confidence: Number(confidence.toFixed(2)),
			retrieval: {
				totalMessages: sourceMessages.length,
				indexedMessages: embeddingCandidates.length,
				selectedMessages: selectedMessages.length,
				semanticMatches,
			},
		}
	}

	static async calculateCreditCost(modelName: string): Promise<number> {
		const pricing = await prisma.ai_model_pricing.findFirst({
			where: {
				model_name: modelName,
				is_active: true,
			},
			select: { cost_per_request: true },
		})

		if (!pricing) {
			return 1.0
		}

		const parsedCost = Number(pricing.cost_per_request)
		return Number.isFinite(parsedCost) && parsedCost > 0 ? parsedCost : 1.0
	}

	static async reserveCredits(
		appId: string,
		modelName: string,
		description: string,
		metadata: TransactionMetadata = {},
	): Promise<ReservationResult> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		const organizationId = await AIService.getOrganizationIdFromApp(targetAppId)
		const cost = await AIService.calculateCreditCost(modelName)

		let reservationTransaction: { id: string; metadata: unknown } | null = null

		try {
			reservationTransaction = await AIService.deductOrgCredits(
				organizationId,
				cost,
				`${description} (${modelName})`,
				{
					...metadata,
					app_id: targetAppId,
					model_name: modelName,
					reservation_stage: 'reserved',
				},
			)
		} catch (error) {
			console.error('[AIService] Failed to reserve credits', {
				appId: targetAppId,
				organizationId,
				modelName,
				cost,
				error,
			})
			throw error
		}

		const reservationId = reservationTransaction.id

		try {
			const baseMetadata = AIService.toMetadataObject(
				reservationTransaction.metadata,
			)

			await prisma.credit_transactions.update({
				where: { id: reservationId },
				data: {
					payment_status: 'reserved',
					reservation_id: reservationId,
					metadata: {
						...baseMetadata,
						reservation_id: reservationId,
						reservation_stage: 'reserved',
						reserved_at: new Date().toISOString(),
					},
				},
			})
		} catch (error) {
			console.error('[AIService] Failed to persist reservation state', {
				reservationId,
				organizationId,
				modelName,
				error,
			})

			try {
				await AIService.topUpOrgCredits(
					organizationId,
					cost,
					`Rollback AI reservation ${reservationId}`,
					reservationId,
				)
			} catch (rollbackError) {
				console.error('[AIService] Failed to rollback reservation deduction', {
					reservationId,
					organizationId,
					cost,
					error: rollbackError,
				})
			}

			throw error
		}

		return {
			reservationId,
			organizationId,
			cost,
			modelName,
		}
	}

	static async finalizeReservation(reservationId: string) {
		const reservation = await prisma.credit_transactions.findUnique({
			where: { id: reservationId },
			select: {
				id: true,
				payment_status: true,
				metadata: true,
			},
		})

		if (!reservation) {
			throw new Error(`Reservation not found: ${reservationId}`)
		}

		if (reservation.payment_status === 'completed') {
			return
		}

		if (reservation.payment_status !== 'reserved') {
			throw new Error(
				`Cannot finalize reservation ${reservationId} with status ${reservation.payment_status}`,
			)
		}

		try {
			const baseMetadata = AIService.toMetadataObject(reservation.metadata)

			await prisma.credit_transactions.update({
				where: { id: reservationId },
				data: {
					payment_status: 'completed',
					metadata: {
						...baseMetadata,
						reservation_stage: 'completed',
						finalized_at: new Date().toISOString(),
					},
				},
			})
		} catch (error) {
			console.error('[AIService] Failed to finalize reservation', {
				reservationId,
				error,
			})
			throw error
		}
	}

	static async refundReservation(
		reservationId: string,
		reason = 'AI generation failed',
	) {
		const reservation = await prisma.credit_transactions.findUnique({
			where: { id: reservationId },
			select: {
				id: true,
				organization_id: true,
				amount: true,
				payment_status: true,
				metadata: true,
			},
		})

		if (!reservation) {
			throw new Error(`Reservation not found: ${reservationId}`)
		}

		if (reservation.payment_status === 'refunded') {
			return
		}

		if (reservation.payment_status === 'completed') {
			console.warn(
				`[AIService] Reservation ${reservationId} already finalized; skip refund`,
			)
			return
		}

		if (reservation.payment_status !== 'reserved') {
			throw new Error(
				`Cannot refund reservation ${reservationId} with status ${reservation.payment_status}`,
			)
		}

		if (!reservation.organization_id) {
			throw new Error(`Reservation ${reservationId} has no organization_id`)
		}

		const reservedAmount = Math.abs(Number(reservation.amount))

		if (!Number.isFinite(reservedAmount) || reservedAmount <= 0) {
			throw new Error(
				`Invalid reserved amount for reservation ${reservationId}: ${reservation.amount}`,
			)
		}

		try {
			await AIService.topUpOrgCredits(
				reservation.organization_id,
				reservedAmount,
				`Refund AI reservation ${reservationId}: ${reason}`,
				reservationId,
			)

			const baseMetadata = AIService.toMetadataObject(reservation.metadata)

			await prisma.credit_transactions.update({
				where: { id: reservationId },
				data: {
					payment_status: 'refunded',
					metadata: {
						...baseMetadata,
						reservation_stage: 'refunded',
						refunded_at: new Date().toISOString(),
						refund_reason: reason,
					},
				},
			})
		} catch (error) {
			console.error('[AIService] Failed to refund reservation', {
				reservationId,
				error,
			})
			throw error
		}
	}

	private static toPlaygroundTrend(
		value: string | null | undefined,
	): PlaygroundMetricTrend {
		if (value === 'up' || value === 'down' || value === 'neutral') return value
		return 'neutral'
	}

	private static parseMetricNumber(value: string | null | undefined): number {
		if (!value) return 0
		const normalized = value.replace(/[^0-9.-]/g, '')
		if (!normalized) return 0
		const parsed = Number.parseFloat(normalized)
		return Number.isFinite(parsed) ? parsed : 0
	}

	private static parseDurationMs(value: string | null | undefined): number {
		const raw = String(value || '')
			.trim()
			.toLowerCase()
		if (!raw) return 0
		if (raw.endsWith('ms')) {
			const parsed = Number.parseFloat(raw.replace(/ms$/g, '').trim())
			return Number.isFinite(parsed) ? parsed : 0
		}
		if (raw.endsWith('s')) {
			const parsed = Number.parseFloat(raw.replace(/s$/g, '').trim())
			return Number.isFinite(parsed) ? Math.round(parsed * 1000) : 0
		}
		return AIService.parseMetricNumber(raw)
	}

	private static formatMetricCount(value: number): string {
		return Math.max(0, Math.round(value)).toLocaleString('en-US')
	}

	private static formatUsd(value: number, fractionDigits = 2): string {
		if (!Number.isFinite(value)) return '$0'
		return `$${Math.max(0, value).toFixed(Math.max(0, fractionDigits))}`
	}

	private static formatSignedPercent(value: number): string {
		const normalized = Number.isFinite(value) ? Math.round(value) : 0
		const sign = normalized > 0 ? '+' : ''
		return `${sign}${normalized}%`
	}

	private static formatSignedMs(value: number): string {
		const normalized = Number.isFinite(value) ? Math.round(value) : 0
		const sign = normalized > 0 ? '+' : ''
		return `${sign}${normalized}ms`
	}

	private static formatDurationMs(value: number): string {
		const normalized = Math.max(0, Math.round(value))
		if (normalized >= 1000) return `${(normalized / 1000).toFixed(1)}s`
		return `${normalized}ms`
	}

	private static async ensurePlaygroundSeedData(appId: string) {
		await prisma.$transaction(async (tx) => {
			const [modelCount, routingCount, guardrailCount, metricCount] =
				await Promise.all([
					tx.ai_playground_models.count({ where: { app_id: appId } }),
					tx.ai_playground_routing_strategies.count({
						where: { app_id: appId },
					}),
					tx.ai_playground_guardrails.count({ where: { app_id: appId } }),
					tx.ai_playground_metric_items.count({ where: { app_id: appId } }),
				])

			if (modelCount === 0) {
				await tx.ai_playground_models.createMany({
					data: PLAYGROUND_DEFAULT_MODELS.map((model) => ({
						app_id: appId,
						...model,
					})),
				})
			}

			if (routingCount === 0) {
				await tx.ai_playground_routing_strategies.createMany({
					data: PLAYGROUND_DEFAULT_ROUTING_STRATEGIES.map((strategy) => ({
						app_id: appId,
						...strategy,
					})),
				})
			}

			const existingPersonas = await tx.ai_playground_personas.findMany({
				where: { app_id: appId },
				select: {
					persona_key: true,
					is_default: true,
				},
			})
			const hasExistingDefaultPersona = existingPersonas.some((persona) =>
				Boolean(persona.is_default),
			)
			const existingPersonaKeySet = new Set(
				existingPersonas.map((persona) =>
					AIService.slugifyPlaygroundKey(persona.persona_key),
				),
			)
			const missingPersonas = PLAYGROUND_DEFAULT_PERSONAS.filter(
				(persona) =>
					!existingPersonaKeySet.has(
						AIService.slugifyPlaygroundKey(persona.persona_key),
					),
			)

			if (missingPersonas.length > 0) {
				await tx.ai_playground_personas.createMany({
					data: missingPersonas.map((persona) => ({
						app_id: appId,
						...persona,
						is_default: hasExistingDefaultPersona ? false : persona.is_default,
					})),
				})
			}

			const defaultPersonaCount = await tx.ai_playground_personas.count({
				where: { app_id: appId, is_default: true },
			})
			if (defaultPersonaCount === 0) {
				const timestamp = new Date()
				const preferredDefaultPersonaKey =
					AIService.getPlaygroundDefaultPersonaKeyForAgentType('ai_general')
				if (preferredDefaultPersonaKey) {
					await tx.ai_playground_personas.updateMany({
						where: {
							app_id: appId,
							persona_key: preferredDefaultPersonaKey,
						},
						data: {
							is_default: true,
							updated_at: timestamp,
						},
					})
				}

				const fallbackDefaultCount = await tx.ai_playground_personas.count({
					where: { app_id: appId, is_default: true },
				})
				if (fallbackDefaultCount === 0) {
					const fallbackPersona = await tx.ai_playground_personas.findFirst({
						where: { app_id: appId },
						orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
						select: { id: true },
					})
					if (fallbackPersona?.id) {
						await tx.ai_playground_personas.update({
							where: { id: fallbackPersona.id },
							data: {
								is_default: true,
								updated_at: timestamp,
							},
						})
					}
				}
			}

			if (guardrailCount === 0) {
				await tx.ai_playground_guardrails.createMany({
					data: PLAYGROUND_DEFAULT_GUARDRAILS.map((guardrail) => ({
						app_id: appId,
						...guardrail,
					})),
				})
			}

			if (metricCount === 0) {
				await tx.ai_playground_metric_items.createMany({
					data: PLAYGROUND_DEFAULT_METRICS.map((metric) => ({
						app_id: appId,
						...metric,
					})),
				})
			}
		})
	}

	private static async resolvePlaygroundDefaults(appId: string) {
		const connectedModel = await prisma.ai_playground_models.findFirst({
			where: { app_id: appId, connected: true },
			orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
		})
		const fallbackModel = connectedModel
			? null
			: await prisma.ai_playground_models.findFirst({
					where: { app_id: appId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				})
		const model = connectedModel || fallbackModel

		const activeStrategy =
			await prisma.ai_playground_routing_strategies.findFirst({
				where: { app_id: appId, is_active: true },
				orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
			})
		const fallbackStrategy = activeStrategy
			? null
			: await prisma.ai_playground_routing_strategies.findFirst({
					where: { app_id: appId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				})
		const strategy = activeStrategy || fallbackStrategy

		const defaultPersona = await prisma.ai_playground_personas.findFirst({
			where: { app_id: appId, is_default: true },
			orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
		})
		const fallbackPersona = defaultPersona
			? null
			: await prisma.ai_playground_personas.findFirst({
					where: { app_id: appId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				})
		const persona = defaultPersona || fallbackPersona

		if (!model || !strategy || !persona) {
			throw new Error('Playground defaults are incomplete')
		}

		return { model, strategy, persona }
	}

	private static async findPlaygroundModelBySelection(
		appId: string,
		selection: string,
	) {
		const value = AIService.toOptionalTrimmedString(selection)
		if (!value) return null
		if (isUuid(value)) {
			return prisma.ai_playground_models.findFirst({
				where: {
					app_id: appId,
					OR: [{ id: value }, { model_key: value }],
				},
			})
		}
		return prisma.ai_playground_models.findFirst({
			where: { app_id: appId, model_key: value },
		})
	}

	private static async findPlaygroundStrategyBySelection(
		appId: string,
		selection: string,
	) {
		const value = AIService.toOptionalTrimmedString(selection)
		if (!value) return null
		if (isUuid(value)) {
			return prisma.ai_playground_routing_strategies.findFirst({
				where: {
					app_id: appId,
					OR: [{ id: value }, { strategy_key: value }],
				},
			})
		}
		return prisma.ai_playground_routing_strategies.findFirst({
			where: { app_id: appId, strategy_key: value },
		})
	}

	private static async findPlaygroundPersonaBySelection(
		appId: string,
		selection: string,
	) {
		const value = AIService.toOptionalTrimmedString(selection)
		if (!value) return null
		if (isUuid(value)) {
			return prisma.ai_playground_personas.findFirst({
				where: {
					app_id: appId,
					OR: [{ id: value }, { persona_key: value }],
				},
			})
		}
		return prisma.ai_playground_personas.findFirst({
			where: { app_id: appId, persona_key: value },
		})
	}

	private static async createPlaygroundSession(
		appId: string,
		selection: PlaygroundSelectionInput = {},
	): Promise<string> {
		const defaults = await AIService.resolvePlaygroundDefaults(appId)

		const requestedModelId = AIService.toOptionalTrimmedString(
			selection.modelId,
		)
		const requestedStrategyId = AIService.toOptionalTrimmedString(
			selection.strategyId,
		)
		const requestedPersonaId = AIService.toOptionalTrimmedString(
			selection.personaId,
		)

		const requestedModel = requestedModelId
			? await AIService.findPlaygroundModelBySelection(appId, requestedModelId)
			: null
		if (requestedModelId && !requestedModel) {
			throw new Error(`Model "${requestedModelId}" not found`)
		}

		const requestedStrategy = requestedStrategyId
			? await AIService.findPlaygroundStrategyBySelection(
					appId,
					requestedStrategyId,
				)
			: null
		if (requestedStrategyId && !requestedStrategy) {
			throw new Error(`Routing strategy "${requestedStrategyId}" not found`)
		}

		const requestedPersona = requestedPersonaId
			? await AIService.findPlaygroundPersonaBySelection(
					appId,
					requestedPersonaId,
				)
			: null
		if (requestedPersonaId && !requestedPersona) {
			throw new Error(`Persona "${requestedPersonaId}" not found`)
		}

		const targetModel = requestedModel || defaults.model
		const targetStrategy = requestedStrategy || defaults.strategy
		const targetPersona = requestedPersona || defaults.persona

		const session = await prisma.ai_playground_sessions.create({
			data: {
				app_id: appId,
				selected_model_id: targetModel.id,
				selected_strategy_id: targetStrategy.id,
				selected_persona_id: targetPersona.id,
				status: 'active',
			},
			select: { id: true },
		})

		const initialTurns = [
			{
				role: 'system',
				content: targetPersona.system_instruction,
				model_name: null as string | null,
				tokens_in: null as number | null,
				tokens_out: null as number | null,
				latency_ms: null as number | null,
				cost_usd: null as number | null,
			},
		]

		await prisma.ai_playground_turns.createMany({
			data: initialTurns.map((turn, index) => ({
				app_id: appId,
				session_id: session.id,
				role: turn.role,
				content: turn.content,
				model_name: turn.model_name,
				tokens_in: turn.tokens_in,
				tokens_out: turn.tokens_out,
				latency_ms: turn.latency_ms,
				cost_usd: turn.cost_usd,
				sort_order: index,
			})),
		})

		return session.id
	}

	private static async findPlaygroundSession(appId: string, sessionId: string) {
		return prisma.ai_playground_sessions.findFirst({
			where: { id: sessionId, app_id: appId },
			include: {
				selected_model: true,
				selected_strategy: true,
				selected_persona: true,
			},
		})
	}

	private static async ensurePlaygroundSession(
		appId: string,
		sessionId?: string,
	) {
		if (sessionId && isUuid(sessionId)) {
			const explicit = await AIService.findPlaygroundSession(appId, sessionId)
			if (explicit) return explicit
		}

		const latest = await prisma.ai_playground_sessions.findFirst({
			where: { app_id: appId, status: 'active' },
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
			include: {
				selected_model: true,
				selected_strategy: true,
				selected_persona: true,
			},
		})
		if (latest) return latest

		const createdId = await AIService.createPlaygroundSession(appId)
		return AIService.findPlaygroundSession(appId, createdId)
	}

	private static async applyPlaygroundSessionSelection(
		appId: string,
		sessionId: string,
		selection: PlaygroundSelectionInput,
	) {
		if (!isUuid(sessionId)) throw new Error('Invalid session ID')

		const existingSession = await prisma.ai_playground_sessions.findFirst({
			where: { id: sessionId, app_id: appId },
			select: { id: true },
		})
		if (!existingSession) {
			throw new Error('Playground session not found')
		}

		const updateData: Record<string, unknown> = {}
		let nextPersonaInstruction: string | null = null

		const requestedModelId = AIService.toOptionalTrimmedString(
			selection.modelId,
		)
		if (requestedModelId !== undefined) {
			const model = await AIService.findPlaygroundModelBySelection(
				appId,
				requestedModelId,
			)
			if (!model) throw new Error(`Model "${requestedModelId}" not found`)
			updateData.selected_model_id = model.id
		}

		const requestedStrategyId = AIService.toOptionalTrimmedString(
			selection.strategyId,
		)
		if (requestedStrategyId !== undefined) {
			const strategy = await AIService.findPlaygroundStrategyBySelection(
				appId,
				requestedStrategyId,
			)
			if (!strategy) {
				throw new Error(`Routing strategy "${requestedStrategyId}" not found`)
			}
			updateData.selected_strategy_id = strategy.id
		}

		const requestedPersonaId = AIService.toOptionalTrimmedString(
			selection.personaId,
		)
		if (requestedPersonaId !== undefined) {
			const persona = await AIService.findPlaygroundPersonaBySelection(
				appId,
				requestedPersonaId,
			)
			if (!persona) throw new Error(`Persona "${requestedPersonaId}" not found`)
			updateData.selected_persona_id = persona.id
			nextPersonaInstruction = persona.system_instruction
		}

		if (Object.keys(updateData).length > 0) {
			await prisma.ai_playground_sessions.update({
				where: { id: sessionId },
				data: {
					...updateData,
					updated_at: new Date(),
				},
			})
		}

		if (nextPersonaInstruction) {
			const systemTurn = await prisma.ai_playground_turns.findFirst({
				where: { app_id: appId, session_id: sessionId, role: 'system' },
				orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				select: { id: true },
			})

			if (systemTurn) {
				await prisma.ai_playground_turns.update({
					where: { id: systemTurn.id },
					data: { content: nextPersonaInstruction },
				})
			} else {
				await prisma.ai_playground_turns.create({
					data: {
						app_id: appId,
						session_id: sessionId,
						role: 'system',
						content: nextPersonaInstruction,
						sort_order: 0,
					},
				})
			}
		}
	}

	private static async resetPlaygroundSessionTurns(
		appId: string,
		sessionId: string,
		systemInstruction: string,
	) {
		await prisma.$transaction(async (tx) => {
			await tx.ai_playground_turns.deleteMany({
				where: { app_id: appId, session_id: sessionId },
			})

			await tx.ai_playground_turns.create({
				data: {
					app_id: appId,
					session_id: sessionId,
					role: 'system',
					content: systemInstruction,
					sort_order: 0,
				},
			})

			await tx.ai_playground_sessions.update({
				where: { id: sessionId },
				data: { updated_at: new Date() },
			})
		})
	}

	private static async updatePlaygroundMetricsAfterRun(
		appId: string,
		params: {
			tokensIn: number
			tokensOut: number
			latencyMs: number
			costUsd: number
		},
	) {
		const metrics = await prisma.ai_playground_metric_items.findMany({
			where: { app_id: appId },
		})
		if (metrics.length === 0) return

		const map = new Map(metrics.map((metric) => [metric.metric_key, metric]))
		const requestsMetric = map.get('requests')
		const currentRequests = requestsMetric
			? Math.max(
					0,
					Math.round(AIService.parseMetricNumber(requestsMetric.value)),
				)
			: 0
		const nextRequests = currentRequests + 1

		if (requestsMetric) {
			await prisma.ai_playground_metric_items.update({
				where: { id: requestsMetric.id },
				data: {
					value: AIService.formatMetricCount(nextRequests),
					delta: '+1%',
					trend: 'up',
					updated_at: new Date(),
				},
			})
		}

		const tokensMetric = map.get('tokens')
		if (tokensMetric) {
			const oldAverage = Math.max(
				0,
				Math.round(AIService.parseMetricNumber(tokensMetric.value)),
			)
			const sampleValue = params.tokensIn + params.tokensOut
			const nextAverage =
				currentRequests > 0
					? Math.round(
							(oldAverage * currentRequests + sampleValue) /
								Math.max(1, nextRequests),
						)
					: sampleValue
			const deltaPercent =
				oldAverage > 0 ? ((nextAverage - oldAverage) / oldAverage) * 100 : 0
			await prisma.ai_playground_metric_items.update({
				where: { id: tokensMetric.id },
				data: {
					value: AIService.formatMetricCount(nextAverage),
					delta: AIService.formatSignedPercent(deltaPercent),
					trend:
						nextAverage === oldAverage
							? 'neutral'
							: nextAverage > oldAverage
								? 'up'
								: 'down',
					updated_at: new Date(),
				},
			})
		}

		const p50Metric = map.get('latency-p50')
		if (p50Metric) {
			const oldP50 = Math.max(0, AIService.parseDurationMs(p50Metric.value))
			const nextP50 =
				currentRequests > 0
					? Math.round(
							(oldP50 * currentRequests + params.latencyMs) /
								Math.max(1, nextRequests),
						)
					: params.latencyMs
			await prisma.ai_playground_metric_items.update({
				where: { id: p50Metric.id },
				data: {
					value: `${nextP50}ms`,
					delta: AIService.formatSignedMs(nextP50 - oldP50),
					trend:
						nextP50 === oldP50 ? 'neutral' : nextP50 > oldP50 ? 'up' : 'down',
					updated_at: new Date(),
				},
			})
		}

		const p95Metric = map.get('latency-p95')
		if (p95Metric) {
			const oldP95 = Math.max(0, AIService.parseDurationMs(p95Metric.value))
			const sampledTailLatency =
				params.latencyMs + Math.max(120, Math.round(params.tokensOut * 1.1))
			const nextP95 =
				currentRequests > 0
					? Math.round(
							(oldP95 * currentRequests + sampledTailLatency) /
								Math.max(1, nextRequests),
						)
					: sampledTailLatency
			await prisma.ai_playground_metric_items.update({
				where: { id: p95Metric.id },
				data: {
					value: AIService.formatDurationMs(nextP95),
					delta: AIService.formatSignedMs(nextP95 - oldP95),
					trend:
						nextP95 === oldP95 ? 'neutral' : nextP95 > oldP95 ? 'up' : 'down',
					updated_at: new Date(),
				},
			})
		}

		const costMetric = map.get('cost')
		const nextCost = costMetric
			? Math.max(0, AIService.parseMetricNumber(costMetric.value)) +
				params.costUsd
			: params.costUsd
		if (costMetric) {
			await prisma.ai_playground_metric_items.update({
				where: { id: costMetric.id },
				data: {
					value: AIService.formatUsd(nextCost, 2),
					delta: `Rp ${Math.round(nextCost * PLAYGROUND_IDR_PER_USD).toLocaleString('id-ID')}`,
					trend: 'neutral',
					updated_at: new Date(),
				},
			})
		}

		const cacheMetric = map.get('cache-hit-rate')
		if (cacheMetric) {
			const oldHitRate = clamp(
				Math.round(AIService.parseMetricNumber(cacheMetric.value)),
				0,
				100,
			)
			const adjustment = params.latencyMs <= 800 ? 1 : -1
			const nextHitRate = clamp(oldHitRate + adjustment, 20, 98)
			const savedUsd = Math.round(nextCost * (nextHitRate / 100) * 0.45)
			await prisma.ai_playground_metric_items.update({
				where: { id: cacheMetric.id },
				data: {
					value: `${nextHitRate}%`,
					delta: `-${AIService.formatUsd(savedUsd, 0)} saved`,
					trend:
						nextHitRate === oldHitRate
							? 'neutral'
							: nextHitRate > oldHitRate
								? 'up'
								: 'down',
					updated_at: new Date(),
				},
			})
		}
	}

	static async getPlaygroundState(appId: string, sessionId?: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)
		let session = await AIService.ensurePlaygroundSession(
			targetAppId,
			sessionId,
		)
		if (!session) throw new Error('Failed to initialize playground session')

		const defaults = await AIService.resolvePlaygroundDefaults(targetAppId)
		if (
			!session.selected_model ||
			!session.selected_strategy ||
			!session.selected_persona
		) {
			await prisma.ai_playground_sessions.update({
				where: { id: session.id },
				data: {
					selected_model_id: session.selected_model?.id || defaults.model.id,
					selected_strategy_id:
						session.selected_strategy?.id || defaults.strategy.id,
					selected_persona_id:
						session.selected_persona?.id || defaults.persona.id,
					updated_at: new Date(),
				},
			})
			if (!session.selected_persona) {
				const systemTurn = await prisma.ai_playground_turns.findFirst({
					where: {
						app_id: targetAppId,
						session_id: session.id,
						role: 'system',
					},
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
					select: { id: true },
				})
				if (systemTurn) {
					await prisma.ai_playground_turns.update({
						where: { id: systemTurn.id },
						data: { content: defaults.persona.system_instruction },
					})
				}
			}
			session = await AIService.findPlaygroundSession(targetAppId, session.id)
			if (!session) throw new Error('Failed to reload playground session')
		}

		const [models, routingStrategies, personas, guardrails, metrics, turns] =
			await Promise.all([
				prisma.ai_playground_models.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				}),
				prisma.ai_playground_routing_strategies.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				}),
				prisma.ai_playground_personas.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				}),
				prisma.ai_playground_guardrails.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				}),
				prisma.ai_playground_metric_items.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				}),
				prisma.ai_playground_turns.findMany({
					where: { app_id: targetAppId, session_id: session.id },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
				}),
			])

		const selectedModel = session.selected_model || defaults.model
		const selectedStrategy = session.selected_strategy || defaults.strategy
		const selectedPersona = session.selected_persona || defaults.persona
		const selectedAgentType =
			AIService.resolvePlaygroundAgentTypeFromPersonaKey(
				selectedPersona.persona_key,
			)
		const defaultPersonaIdByType =
			AIService.resolvePlaygroundDefaultPersonaIdByType(
				personas.map((persona) => ({
					id: persona.persona_key,
					persona_key: persona.persona_key,
					sort_order: persona.sort_order ?? null,
				})),
			)

		return {
			sessionId: session.id,
			selectedModelId: selectedModel.model_key,
			selectedStrategyId: selectedStrategy.strategy_key,
			selectedPersonaId: selectedPersona.persona_key,
			selectedAgentType,
			agentTypes: PLAYGROUND_AGENT_TYPE_ORDER.map((agentType) => ({
				id: agentType,
				label: PLAYGROUND_AGENT_TYPE_LABELS[agentType],
			})),
			models: models.map((model) => ({
				id: model.model_key,
				name: model.name,
				vendor: model.vendor,
				contextWindow: model.context_window,
				priceIn: AIService.formatUsd(Number(model.price_in || 0), 3),
				priceOut: AIService.formatUsd(Number(model.price_out || 0), 3),
				speed: model.speed,
				tier: model.tier,
				connected: Boolean(model.connected),
				latencyMs: model.latency_ms,
				usage: clamp(Math.round(Number(model.usage_percent || 0)), 0, 100),
			})),
			routingStrategies: routingStrategies.map((strategy) => {
				const rules = AIService.parsePlaygroundRoutingRules(
					strategy.routing_rules,
				)
				const description =
					AIService.toOptionalTrimmedString(strategy.description) ||
					AIService.buildRoutingDescriptionFromRules(rules)

				return {
					id: strategy.strategy_key,
					label: strategy.label,
					description,
					rules: rules.map((rule) => ({
						id: rule.id,
						name: rule.name,
						provider: rule.provider,
						modelId: rule.model_key || undefined,
						modelName: rule.model_name || undefined,
						minConfidence: rule.min_confidence ?? undefined,
						maxConfidence: rule.max_confidence ?? undefined,
					})),
				}
			}),
			personas: personas.map((persona) => {
				const agentType = AIService.resolvePlaygroundAgentTypeFromPersonaKey(
					persona.persona_key,
				)
				return {
					id: persona.persona_key,
					personaId: persona.id,
					label: persona.label,
					systemInstruction: persona.system_instruction,
					agentType,
					isDefault: Boolean(persona.is_default),
					isDefaultForType:
						defaultPersonaIdByType.get(agentType) === persona.persona_key,
				}
			}),
			guardrails: guardrails.map((guardrail) => ({
				id: guardrail.guardrail_key,
				label: guardrail.label,
				enabled: Boolean(guardrail.enabled),
			})),
			metrics: metrics.map((metric) => ({
				id: metric.metric_key,
				label: metric.label,
				value: metric.value,
				delta: metric.delta,
				trend: AIService.toPlaygroundTrend(metric.trend),
				positiveWhen: AIService.toPlaygroundTrend(metric.positive_when),
			})),
			transcript: turns.map((turn) => ({
				id: turn.id,
				role:
					turn.role === 'system' ||
					turn.role === 'user' ||
					turn.role === 'assistant'
						? turn.role
						: 'assistant',
				text: turn.content,
				model: turn.model_name || undefined,
				tokensIn: turn.tokens_in ?? undefined,
				tokensOut: turn.tokens_out ?? undefined,
				latencyMs: turn.latency_ms ?? undefined,
				cost:
					turn.cost_usd !== null && turn.cost_usd !== undefined
						? AIService.formatUsd(Number(turn.cost_usd), 4)
						: undefined,
			})),
		}
	}

	static async resetPlaygroundSession(
		appId: string,
		selection: PlaygroundResetInput = {},
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)

		const requestedSessionId = AIService.toOptionalTrimmedString(
			selection.sessionId,
		)
		const selectionForSession: PlaygroundSelectionInput = {
			modelId: selection.modelId,
			strategyId: selection.strategyId,
			personaId: selection.personaId,
		}

		if (requestedSessionId) {
			if (!isUuid(requestedSessionId)) {
				throw new Error('Invalid session ID')
			}

			const existingSession = await AIService.findPlaygroundSession(
				targetAppId,
				requestedSessionId,
			)
			if (!existingSession) {
				throw new Error('Playground session not found')
			}

			await AIService.applyPlaygroundSessionSelection(
				targetAppId,
				requestedSessionId,
				selectionForSession,
			)

			const refreshedSession = await AIService.findPlaygroundSession(
				targetAppId,
				requestedSessionId,
			)
			const defaults = await AIService.resolvePlaygroundDefaults(targetAppId)
			const selectedPersona =
				refreshedSession?.selected_persona || defaults.persona

			await AIService.resetPlaygroundSessionTurns(
				targetAppId,
				requestedSessionId,
				selectedPersona.system_instruction,
			)
			await AIService.clearPlaygroundWorkflowContext(requestedSessionId)
			return AIService.getPlaygroundState(targetAppId, requestedSessionId)
		}

		const sessionId = await AIService.createPlaygroundSession(
			targetAppId,
			selectionForSession,
		)
		return AIService.getPlaygroundState(targetAppId, sessionId)
	}

	static async updatePlaygroundSession(
		appId: string,
		sessionId: string,
		selection: PlaygroundSelectionInput,
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)
		await AIService.applyPlaygroundSessionSelection(
			targetAppId,
			sessionId,
			selection,
		)
		return AIService.getPlaygroundState(targetAppId, sessionId)
	}

	static async createPlaygroundRoutingStrategy(
		appId: string,
		payload: PlaygroundCreateStrategyInput,
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)

		const label = AIService.toOptionalTrimmedString(payload?.label)
		if (!label) throw new Error('Strategy name is required')

		const routingRules =
			await AIService.normalizePlaygroundRoutingRulesForCreate(
				targetAppId,
				payload?.rules || [],
			)
		const explicitDescription = AIService.toOptionalTrimmedString(
			payload?.description,
		)
		const description =
			explicitDescription ||
			AIService.buildRoutingDescriptionFromRules(routingRules)
		const shouldActivate = payload?.activate !== false
		const strategyKey = await AIService.ensureUniquePlaygroundStrategyKey(
			targetAppId,
			label,
		)
		const timestamp = new Date()

		const createdStrategy = await prisma.$transaction(async (tx) => {
			const lastStrategy = await tx.ai_playground_routing_strategies.findFirst({
				where: { app_id: targetAppId },
				orderBy: [{ sort_order: 'desc' }, { created_at: 'desc' }],
				select: { sort_order: true },
			})
			const nextSortOrder = Number(lastStrategy?.sort_order ?? -1) + 1

			if (shouldActivate) {
				await tx.ai_playground_routing_strategies.updateMany({
					where: { app_id: targetAppId, is_active: true },
					data: { is_active: false, updated_at: timestamp },
				})
			}

			return tx.ai_playground_routing_strategies.create({
				data: {
					app_id: targetAppId,
					strategy_key: strategyKey,
					label,
					description,
					routing_rules: routingRules as any,
					is_active: shouldActivate,
					sort_order: nextSortOrder,
					updated_at: timestamp,
				},
				select: { id: true },
			})
		})

		const latestSession = await prisma.ai_playground_sessions.findFirst({
			where: { app_id: targetAppId, status: 'active' },
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
			select: { id: true },
		})

		if (latestSession) {
			await prisma.ai_playground_sessions.update({
				where: { id: latestSession.id },
				data: {
					selected_strategy_id: createdStrategy.id,
					updated_at: new Date(),
				},
			})
		}

		return AIService.getPlaygroundState(targetAppId, latestSession?.id)
	}

	static async getPlaygroundPersonas(appId: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)
		const personas = await prisma.ai_playground_personas.findMany({
			where: { app_id: targetAppId },
			orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
		})
		const defaultPersonaIdByType =
			AIService.resolvePlaygroundDefaultPersonaIdByType(
				personas.map((persona) => ({
					id: persona.persona_key,
					persona_key: persona.persona_key,
					sort_order: persona.sort_order ?? null,
				})),
			)

		return {
			agentTypes: PLAYGROUND_AGENT_TYPE_ORDER.map((agentType) => ({
				id: agentType,
				label: PLAYGROUND_AGENT_TYPE_LABELS[agentType],
			})),
			personas: personas.map((persona) => {
				const agentType = AIService.resolvePlaygroundAgentTypeFromPersonaKey(
					persona.persona_key,
				)
				return {
					id: persona.persona_key,
					personaId: persona.id,
					label: persona.label,
					systemInstruction: persona.system_instruction,
					agentType,
					isDefault: Boolean(persona.is_default),
					isDefaultForType:
						defaultPersonaIdByType.get(agentType) === persona.persona_key,
				}
			}),
		}
	}

	static async createPlaygroundPersona(
		appId: string,
		payload: PlaygroundCreatePersonaInput,
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)

		const label = AIService.toOptionalTrimmedString(payload?.label)
		if (!label) throw new Error('Persona label is required')
		const systemInstruction = AIService.toOptionalTrimmedString(
			payload?.systemInstruction,
		)
		if (!systemInstruction) throw new Error('System instruction is required')
		const agentType = AIService.toPlaygroundAgentTypeOrThrow(payload?.agentType)
		const setAsDefaultForType = payload?.setAsDefaultForType === true
		const setAsGlobalDefault = payload?.setAsGlobalDefault === true

		const personaKey = await AIService.ensureUniquePlaygroundPersonaKey(
			targetAppId,
			agentType,
			label,
		)

		await prisma.$transaction(async (tx) => {
			const lastPersona = await tx.ai_playground_personas.findFirst({
				where: { app_id: targetAppId },
				orderBy: [{ sort_order: 'desc' }, { created_at: 'desc' }],
				select: { sort_order: true },
			})
			const nextSortOrder = Number(lastPersona?.sort_order ?? -1) + 1

			const existingDefaultCount = await tx.ai_playground_personas.count({
				where: { app_id: targetAppId, is_default: true },
			})
			const shouldSetGlobalDefault =
				setAsGlobalDefault || existingDefaultCount === 0
			if (shouldSetGlobalDefault) {
				await tx.ai_playground_personas.updateMany({
					where: { app_id: targetAppId, is_default: true },
					data: {
						is_default: false,
						updated_at: new Date(),
					},
				})
			}

			const createdPersona = await tx.ai_playground_personas.create({
				data: {
					app_id: targetAppId,
					persona_key: personaKey,
					label,
					system_instruction: systemInstruction,
					is_default: shouldSetGlobalDefault,
					sort_order: nextSortOrder,
					updated_at: new Date(),
				},
				select: {
					id: true,
					sort_order: true,
					persona_key: true,
				},
			})

			if (setAsDefaultForType) {
				const orderedPersonas = await tx.ai_playground_personas.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
					select: { id: true, persona_key: true, sort_order: true },
				})
				const currentSort = Number(createdPersona.sort_order ?? 0)
				const minSortForType = orderedPersonas
					.filter(
						(persona) =>
							AIService.resolvePlaygroundAgentTypeFromPersonaKey(
								persona.persona_key,
							) === agentType,
					)
					.reduce(
						(minValue, persona) =>
							Math.min(minValue, Number(persona.sort_order ?? 0)),
						currentSort,
					)
				if (currentSort >= minSortForType) {
					await tx.ai_playground_personas.update({
						where: { id: createdPersona.id },
						data: {
							sort_order: minSortForType - 1,
							updated_at: new Date(),
						},
					})
				}
			}
		})

		return AIService.getPlaygroundPersonas(targetAppId)
	}

	static async updatePlaygroundPersona(
		appId: string,
		personaId: string,
		payload: PlaygroundUpdatePersonaInput,
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)

		const personaKey = AIService.toOptionalTrimmedString(personaId)
		if (!personaKey) throw new Error('Persona ID is required')
		const existingPersona = await prisma.ai_playground_personas.findFirst({
			where: {
				app_id: targetAppId,
				persona_key: personaKey,
			},
			select: {
				id: true,
				persona_key: true,
				label: true,
				system_instruction: true,
				sort_order: true,
				is_default: true,
			},
		})
		if (!existingPersona) {
			throw new Error(`Persona "${personaKey}" not found`)
		}

		const nextLabelRaw =
			payload?.label === undefined
				? existingPersona.label
				: AIService.toOptionalTrimmedString(payload.label)
		const nextLabel = AIService.toOptionalTrimmedString(nextLabelRaw)
		if (!nextLabel) throw new Error('Persona label is required')

		const nextSystemInstructionRaw =
			payload?.systemInstruction === undefined
				? existingPersona.system_instruction
				: AIService.toOptionalTrimmedString(payload.systemInstruction)
		const nextSystemInstruction = AIService.toOptionalTrimmedString(
			nextSystemInstructionRaw,
		)
		if (!nextSystemInstruction)
			throw new Error('System instruction is required')

		const currentAgentType = AIService.resolvePlaygroundAgentTypeFromPersonaKey(
			existingPersona.persona_key,
		)
		const nextAgentType =
			payload?.agentType === undefined
				? currentAgentType
				: AIService.toPlaygroundAgentTypeOrThrow(payload.agentType)

		const nextPersonaKey =
			nextAgentType === currentAgentType
				? existingPersona.persona_key
				: await AIService.ensureUniquePlaygroundPersonaKey(
						targetAppId,
						nextAgentType,
						nextLabel,
						existingPersona.id,
					)

		const setAsDefaultForType = payload?.setAsDefaultForType === true
		const setAsGlobalDefault = payload?.setAsGlobalDefault === true

		await prisma.$transaction(async (tx) => {
			if (setAsGlobalDefault) {
				await tx.ai_playground_personas.updateMany({
					where: {
						app_id: targetAppId,
						is_default: true,
						id: { not: existingPersona.id },
					},
					data: {
						is_default: false,
						updated_at: new Date(),
					},
				})
			}

			const updatedPersona = await tx.ai_playground_personas.update({
				where: { id: existingPersona.id },
				data: {
					persona_key: nextPersonaKey,
					label: nextLabel,
					system_instruction: nextSystemInstruction,
					...(setAsGlobalDefault ? { is_default: true } : {}),
					updated_at: new Date(),
				},
				select: {
					id: true,
					sort_order: true,
					persona_key: true,
				},
			})

			if (setAsDefaultForType) {
				const orderedPersonas = await tx.ai_playground_personas.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
					select: { id: true, persona_key: true, sort_order: true },
				})
				const currentSort = Number(updatedPersona.sort_order ?? 0)
				const minSortForType = orderedPersonas
					.filter(
						(persona) =>
							AIService.resolvePlaygroundAgentTypeFromPersonaKey(
								persona.persona_key,
							) === nextAgentType,
					)
					.reduce(
						(minValue, persona) =>
							Math.min(minValue, Number(persona.sort_order ?? 0)),
						currentSort,
					)
				if (currentSort >= minSortForType) {
					await tx.ai_playground_personas.update({
						where: { id: updatedPersona.id },
						data: {
							sort_order: minSortForType - 1,
							updated_at: new Date(),
						},
					})
				}
			}
		})

		return AIService.getPlaygroundPersonas(targetAppId)
	}

	static async deletePlaygroundPersona(appId: string, personaId: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		await AIService.ensurePlaygroundSeedData(targetAppId)

		const personaKey = AIService.toOptionalTrimmedString(personaId)
		if (!personaKey) throw new Error('Persona ID is required')
		const existingPersona = await prisma.ai_playground_personas.findFirst({
			where: {
				app_id: targetAppId,
				persona_key: personaKey,
			},
			select: {
				id: true,
				persona_key: true,
				is_default: true,
			},
		})
		if (!existingPersona) {
			throw new Error(`Persona "${personaKey}" not found`)
		}

		const allPersonas = await prisma.ai_playground_personas.findMany({
			where: { app_id: targetAppId },
			orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
			select: { id: true, persona_key: true },
		})
		if (allPersonas.length <= 1) {
			throw new Error('Cannot delete the last persona')
		}

		const deletingType = AIService.resolvePlaygroundAgentTypeFromPersonaKey(
			existingPersona.persona_key,
		)
		const remainingInType = allPersonas.filter(
			(persona) =>
				AIService.resolvePlaygroundAgentTypeFromPersonaKey(
					persona.persona_key,
				) === deletingType && persona.id !== existingPersona.id,
		)
		if (remainingInType.length === 0) {
			const typeLabel =
				PLAYGROUND_AGENT_TYPE_LABELS[deletingType] || deletingType
			throw new Error(
				`Cannot delete the last persona for ${typeLabel}. Create another persona first.`,
			)
		}

		await prisma.$transaction(async (tx) => {
			await tx.ai_playground_personas.delete({
				where: { id: existingPersona.id },
			})

			if (existingPersona.is_default) {
				const fallbackPersonas = await tx.ai_playground_personas.findMany({
					where: { app_id: targetAppId },
					orderBy: [{ sort_order: 'asc' }, { created_at: 'asc' }],
					select: { id: true, persona_key: true },
				})
				const nextGlobalDefault =
					fallbackPersonas.find(
						(persona) =>
							AIService.resolvePlaygroundAgentTypeFromPersonaKey(
								persona.persona_key,
							) === 'ai_general',
					) || fallbackPersonas[0]

				if (nextGlobalDefault?.id) {
					await tx.ai_playground_personas.update({
						where: { id: nextGlobalDefault.id },
						data: {
							is_default: true,
							updated_at: new Date(),
						},
					})
				}
			}
		})

		return AIService.getPlaygroundPersonas(targetAppId)
	}

	private static buildPlaygroundWorkflowContextKey(sessionId: string): string {
		return `${PLAYGROUND_WORKFLOW_CONTEXT_KEY_PREFIX}${sessionId}`
	}

	private static normalizePlaygroundChannelType(
		value: string | null | undefined,
	): 'whatsapp' | 'instagram' | 'tiktok' {
		const normalized = String(value || '')
			.trim()
			.toLowerCase()
		if (normalized === 'instagram') return 'instagram'
		if (normalized === 'tiktok') return 'tiktok'
		return 'whatsapp'
	}

	private static async clearPlaygroundWorkflowContext(
		sessionId: string,
	): Promise<void> {
		try {
			await redis.del(AIService.buildPlaygroundWorkflowContextKey(sessionId))
		} catch (error) {
			console.warn('[AIService] Failed clearing playground workflow context', {
				sessionId,
				error,
			})
		}
	}

	private static async resolvePlaygroundWorkflowContext(
		appId: string,
		sessionId: string,
	): Promise<{
		context: PlaygroundWorkflowContext
		contact: {
			id: string
			name: string | null
			phone_number: string | null
			identifier: string | null
			avatar_url: string | null
			meta: unknown
			metadata: unknown
		}
	}> {
		const key = AIService.buildPlaygroundWorkflowContextKey(sessionId)
		let cached: PlaygroundWorkflowContext | null = null
		try {
			const raw = await redis.get(key)
			if (raw) {
				const parsed = JSON.parse(raw) as Record<string, unknown>
				const inboxId = AIService.toOptionalTrimmedString(parsed.inboxId)
				const conversationId = AIService.toOptionalTrimmedString(
					parsed.conversationId,
				)
				const contactId = AIService.toOptionalTrimmedString(parsed.contactId)
				if (inboxId && conversationId && contactId) {
					cached = {
						inboxId,
						conversationId,
						contactId,
						channelType: AIService.normalizePlaygroundChannelType(
							AIService.toOptionalTrimmedString(parsed.channelType),
						),
						channelName:
							AIService.toOptionalTrimmedString(parsed.channelName) || null,
						channelBadgeUrl:
							AIService.toOptionalTrimmedString(parsed.channelBadgeUrl) || null,
					}
				}
			}
		} catch (error) {
			console.warn('[AIService] Failed reading playground workflow context', {
				sessionId,
				error,
			})
		}

		const validateCached = async (context: PlaygroundWorkflowContext) => {
			if (
				!isUuid(context.inboxId) ||
				!isUuid(context.conversationId) ||
				!isUuid(context.contactId)
			) {
				return null
			}

			const [inbox, conversation, contact] = await Promise.all([
				prisma.inboxes.findFirst({
					where: {
						id: context.inboxId,
						app_id: appId,
						deleted_at: null,
					},
					select: {
						id: true,
						name: true,
						channel_type: true,
					},
				}),
				prisma.conversations.findFirst({
					where: {
						id: context.conversationId,
						app_id: appId,
						inbox_id: context.inboxId,
						contact_id: context.contactId,
						deleted_at: null,
					},
					select: { id: true },
				}),
				prisma.contacts.findFirst({
					where: {
						id: context.contactId,
						app_id: appId,
						deleted_at: null,
					},
					select: {
						id: true,
						name: true,
						phone_number: true,
						identifier: true,
						avatar_url: true,
						meta: true,
						metadata: true,
					},
				}),
			])

			if (!inbox || !conversation || !contact) return null

			return {
				context: {
					...context,
					channelType: AIService.normalizePlaygroundChannelType(
						inbox.channel_type,
					),
					channelName: inbox.name || context.channelName || null,
				},
				contact,
			}
		}

		if (cached) {
			const validated = await validateCached(cached)
			if (validated) return validated
		}

		const inboxes = await prisma.inboxes.findMany({
			where: {
				app_id: appId,
				deleted_at: null,
				OR: [{ is_active: true }, { is_active: null }],
			},
			select: {
				id: true,
				name: true,
				channel_type: true,
				channel_config: true,
				account_id: true,
			},
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
		})
		if (inboxes.length === 0) {
			throw new Error('No active inbox found for workflow simulation')
		}

		const inboxIds = inboxes.map((item) => item.id)
		const whatsappChannels =
			inboxIds.length > 0
				? await prisma.whatsapp_channels.findMany({
						where: {
							app_id: appId,
							deleted_at: null,
							inbox_id: { in: inboxIds },
						},
						select: {
							inbox_id: true,
							extended_metadata: true,
							badge_url: true,
						},
					})
				: []
		const whatsappByInboxId = new Map(
			whatsappChannels
				.filter((item) => item.inbox_id)
				.map((item) => [String(item.inbox_id), item]),
		)

		const inboxCandidates = inboxes.map((inbox) => {
			return {
				inbox,
				badgeUrl:
					AIService.toOptionalTrimmedString(
						whatsappByInboxId.get(inbox.id)?.badge_url,
					) || null,
			}
		})

		const preferredInboxCandidate =
			inboxCandidates.find(
				(item) =>
					AIService.normalizePlaygroundChannelType(item.inbox.channel_type) ===
					'whatsapp',
			) ||
			inboxCandidates.find(
				(item) =>
					AIService.normalizePlaygroundChannelType(item.inbox.channel_type) ===
					'whatsapp',
			) ||
			inboxCandidates[0]

		const selectedInbox = preferredInboxCandidate.inbox
		const channelType = AIService.normalizePlaygroundChannelType(
			selectedInbox.channel_type,
		)
		const identifier = `ai-playground-${sessionId}`

		let contact = await prisma.contacts.findFirst({
			where: {
				app_id: appId,
				identifier,
				deleted_at: null,
			},
			select: {
				id: true,
				name: true,
				phone_number: true,
				identifier: true,
				avatar_url: true,
				meta: true,
				metadata: true,
			},
		})
		if (!contact) {
			contact = await prisma.contacts.create({
				data: {
					app_id: appId,
					account_id: selectedInbox.account_id || null,
					name: 'Playground Visitor',
					identifier,
					channel_type: channelType,
					metadata: {
						source: 'ai_playground',
						session_id: sessionId,
					},
					meta: {
						source: 'ai_playground',
						session_id: sessionId,
					},
				},
				select: {
					id: true,
					name: true,
					phone_number: true,
					identifier: true,
					avatar_url: true,
					meta: true,
					metadata: true,
				},
			})
		}

		const conversation = await prisma.conversations.create({
			data: {
				app_id: appId,
				account_id: selectedInbox.account_id || null,
				inbox_id: selectedInbox.id,
				contact_id: contact.id,
				channel_type: channelType,
				status: 'open',
				additional_attributes: {
					source: 'ai_playground_workflow',
					session_id: sessionId,
				},
			},
			select: { id: true },
		})

		const context: PlaygroundWorkflowContext = {
			inboxId: selectedInbox.id,
			conversationId: conversation.id,
			contactId: contact.id,
			channelType,
			channelName: selectedInbox.name || null,
			channelBadgeUrl: preferredInboxCandidate.badgeUrl,
		}

		try {
			await redis.set(
				key,
				JSON.stringify(context),
				'EX',
				PLAYGROUND_WORKFLOW_CONTEXT_TTL_SECONDS,
			)
		} catch (error) {
			console.warn('[AIService] Failed writing playground workflow context', {
				sessionId,
				error,
			})
		}

		return { context, contact }
	}

	private static async runPlaygroundWorkflowSimulation(args: {
		appId: string
		sessionId: string
		message: string
	}): Promise<PlaygroundWorkflowSimulationResult> {
		const startedAt = Date.now()
		try {
			const { context, contact } =
				await AIService.resolvePlaygroundWorkflowContext(
					args.appId,
					args.sessionId,
				)
			const now = new Date()
			const incomingMessage = await prisma.messages.create({
				data: {
					app_id: args.appId,
					inbox_id: context.inboxId,
					conversation_id: context.conversationId,
					message_type: 'incoming',
					content: args.message,
					content_type: 'text',
					sender_type: 'contact',
					status: 'sent',
					created_at: now,
					additional_attributes: {
						source: 'ai_playground_workflow',
						session_id: args.sessionId,
					},
				},
				select: {
					id: true,
					content: true,
					content_type: true,
					created_at: true,
					content_attributes: true,
				},
			})
			await prisma.conversations.update({
				where: { id: context.conversationId },
				data: {
					last_message_at: now,
					updated_at: now,
				},
			})

			const result = await FlowRuntimeService.executeInbound({
				appId: args.appId,
				inboxId: context.inboxId,
				conversationId: context.conversationId,
				incomingMessage: {
					id: incomingMessage.id,
					content: incomingMessage.content || '',
					content_type: incomingMessage.content_type || 'text',
					created_at: incomingMessage.created_at,
					content_attributes: incomingMessage.content_attributes,
				},
				contact: {
					id: contact.id,
					name: contact.name || null,
					phone_number: contact.phone_number || null,
					identifier: contact.identifier || null,
					avatar_url: contact.avatar_url || null,
					meta: contact.meta,
					metadata: contact.metadata,
				},
				channelType: context.channelType,
				channelName: context.channelName,
				channelBadgeUrl: context.channelBadgeUrl,
			})

			const replyRows = await prisma.messages.findMany({
				where: {
					conversation_id: context.conversationId,
					sender_type: 'bot',
					deleted_at: null,
					OR: [{ is_deleted: false }, { is_deleted: null }],
					created_at: {
						gte: incomingMessage.created_at || now,
					},
				},
				orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
				select: {
					content: true,
				},
			})
			const assistantContent = replyRows
				.map((row) => String(row.content || '').trim())
				.filter((item) => item.length > 0)
				.join('\n\n')

			const latencyMs = Math.max(1, Date.now() - startedAt)
			return {
				assistantContent: assistantContent || null,
				traceLine: `[Workflow Trace] ${
					result.flowId || '-'
				} ${result.reason} (matched=${result.matched ? 'yes' : 'no'}, skip_chatbot=${
					result.skipChatbot ? 'yes' : 'no'
				})`,
				flowId: result.flowId,
				matched: result.matched,
				skipChatbot: result.skipChatbot,
				reason: result.reason,
				latencyMs,
			}
		} catch (error) {
			const latencyMs = Math.max(1, Date.now() - startedAt)
			const reason =
				error instanceof Error && error.message.trim().length > 0
					? error.message
					: 'workflow_simulation_failed'
			return {
				assistantContent: null,
				traceLine: `[Workflow Trace] ERROR (${reason})`,
				flowId: null,
				matched: false,
				skipChatbot: false,
				reason: 'error',
				latencyMs,
			}
		}
	}

	private static buildPlaygroundRunJobKey(jobId: string): string {
		return `${PLAYGROUND_RUN_JOB_KEY_PREFIX}${jobId}`
	}

	private static buildPlaygroundRunQueueKey(appId: string): string {
		return `${PLAYGROUND_RUN_QUEUE_KEY_PREFIX}${appId}`
	}

	private static createPlaygroundRunJobId(): string {
		if (typeof globalThis.crypto?.randomUUID === 'function') {
			return globalThis.crypto.randomUUID()
		}
		return `playground-run-${Date.now()}-${Math.round(Math.random() * 1_000_000_000)}`
	}

	private static parsePlaygroundRunJobRecord(
		raw: string | null | undefined,
	): PlaygroundRunJobRecord | null {
		if (!raw) return null
		try {
			const parsed = JSON.parse(raw) as PlaygroundRunJobRecord
			if (!parsed || typeof parsed !== 'object') return null
			const id = AIService.toOptionalTrimmedString(parsed.id)
			const appId = AIService.toOptionalTrimmedString(parsed.appId)
			const status = AIService.toOptionalTrimmedString(parsed.status) as
				| PlaygroundRunJobStatus
				| undefined
			const payload =
				parsed.payload && typeof parsed.payload === 'object'
					? (parsed.payload as PlaygroundRunInput)
					: null
			if (
				!id ||
				!appId ||
				!payload ||
				!status ||
				!['queued', 'running', 'completed', 'failed'].includes(status)
			) {
				return null
			}
			return {
				id,
				appId,
				status,
				payload,
				state: parsed.state ?? null,
				error: AIService.toOptionalTrimmedString(parsed.error) || null,
				createdAt:
					AIService.toOptionalTrimmedString(parsed.createdAt) ||
					new Date().toISOString(),
				updatedAt:
					AIService.toOptionalTrimmedString(parsed.updatedAt) ||
					new Date().toISOString(),
			}
		} catch {
			return null
		}
	}

	private static async readPlaygroundRunJobRecord(
		jobId: string,
	): Promise<PlaygroundRunJobRecord | null> {
		const key = AIService.buildPlaygroundRunJobKey(jobId)
		const raw = await redis.get(key)
		return AIService.parsePlaygroundRunJobRecord(raw)
	}

	private static async writePlaygroundRunJobRecord(
		record: PlaygroundRunJobRecord,
	): Promise<void> {
		const key = AIService.buildPlaygroundRunJobKey(record.id)
		await redis.set(
			key,
			JSON.stringify(record),
			'EX',
			PLAYGROUND_RUN_JOB_TTL_SECONDS,
		)
	}

	private static async processPlaygroundRunJob(
		appId: string,
		jobId: string,
	): Promise<void> {
		const record = await AIService.readPlaygroundRunJobRecord(jobId)
		if (!record || record.appId !== appId) return

		record.status = 'running'
		record.error = null
		record.updatedAt = new Date().toISOString()
		await AIService.writePlaygroundRunJobRecord(record)

		try {
			const state = await AIService.runPlayground(appId, {
				...record.payload,
				enqueue: false,
			})
			record.status = 'completed'
			record.state = state
			record.updatedAt = new Date().toISOString()
			await AIService.writePlaygroundRunJobRecord(record)
		} catch (error) {
			record.status = 'failed'
			record.error =
				AIService.extractProviderErrorMessage(error) ||
				(error instanceof Error && error.message.trim().length > 0
					? error.message.trim()
					: 'playground_background_job_failed')
			record.updatedAt = new Date().toISOString()
			await AIService.writePlaygroundRunJobRecord(record)
		}
	}

	private static drainPlaygroundRunQueue(appId: string): void {
		if (AIService.playgroundQueueDraining.has(appId)) return
		AIService.playgroundQueueDraining.add(appId)

		void (async () => {
			const queueKey = AIService.buildPlaygroundRunQueueKey(appId)
			try {
				for (;;) {
					const queuedJobId = await redis.lpop(queueKey)
					const jobId = AIService.toOptionalTrimmedString(queuedJobId)
					if (!jobId) break
					await AIService.processPlaygroundRunJob(appId, jobId)
				}
			} catch (error) {
				console.warn('[AIService] Failed draining playground run queue', {
					appId,
					error,
				})
			} finally {
				AIService.playgroundQueueDraining.delete(appId)
				try {
					const remainingJobs = await redis.llen(queueKey)
					if (Number(remainingJobs) > 0) {
						AIService.drainPlaygroundRunQueue(appId)
					}
				} catch {
					// fail-open
				}
			}
		})()
	}

	private static async enqueuePlaygroundRun(
		appId: string,
		payload: PlaygroundRunInput,
	): Promise<{
		mode: 'queued'
		jobId: string
		status: PlaygroundRunJobStatus
	}> {
		const jobId = AIService.createPlaygroundRunJobId()
		const nowIso = new Date().toISOString()
		const normalizedPayload: PlaygroundRunInput = {
			sessionId: payload.sessionId,
			message: payload.message,
			modelId: payload.modelId,
			strategyId: payload.strategyId,
			personaId: payload.personaId,
			selectedSourceIds: payload.selectedSourceIds,
			ragTopK: payload.ragTopK,
			enqueue: false,
		}
		const record: PlaygroundRunJobRecord = {
			id: jobId,
			appId,
			status: 'queued',
			payload: normalizedPayload,
			state: null,
			error: null,
			createdAt: nowIso,
			updatedAt: nowIso,
		}
		await AIService.writePlaygroundRunJobRecord(record)
		await redis.rpush(AIService.buildPlaygroundRunQueueKey(appId), jobId)
		AIService.drainPlaygroundRunQueue(appId)
		return {
			mode: 'queued',
			jobId,
			status: 'queued',
		}
	}

	static async getPlaygroundRunJob(appId: string, jobId: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')
		const normalizedJobId = AIService.toOptionalTrimmedString(jobId)
		if (!normalizedJobId) throw new Error('Invalid playground run job ID')

		const record = await AIService.readPlaygroundRunJobRecord(normalizedJobId)
		if (!record || record.appId !== targetAppId) {
			throw new Error('Playground run background job not found')
		}
		if (record.status === 'queued') {
			AIService.drainPlaygroundRunQueue(targetAppId)
		}

		return {
			mode: 'queued' as const,
			jobId: record.id,
			status: record.status,
			state: record.state,
			error: record.error,
			updatedAt: record.updatedAt,
		}
	}

	static async runPlayground(appId: string, payload: PlaygroundRunInput) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		const enqueueRequested =
			AIService.toOptionalBoolean(
				(payload as Record<string, unknown>).enqueue,
			) === true
		if (enqueueRequested) {
			const message = AIService.toOptionalTrimmedString(payload.message)
			if (!message) throw new Error('Message is required')
			if (!isUuid(payload.sessionId)) throw new Error('Invalid session ID')
			return AIService.enqueuePlaygroundRun(targetAppId, {
				...payload,
				message,
				enqueue: false,
			})
		}

		await AIService.ensurePlaygroundSeedData(targetAppId)
		const message = AIService.toOptionalTrimmedString(payload.message)
		if (!message) throw new Error('Message is required')
		if (!isUuid(payload.sessionId)) throw new Error('Invalid session ID')

		await AIService.applyPlaygroundSessionSelection(
			targetAppId,
			payload.sessionId,
			{
				modelId: payload.modelId,
				strategyId: payload.strategyId,
				personaId: payload.personaId,
			},
		)

		const session = await AIService.findPlaygroundSession(
			targetAppId,
			payload.sessionId,
		)
		if (!session) throw new Error('Playground session not found')
		const sessionRecordId = session.id

		const defaults = await AIService.resolvePlaygroundDefaults(targetAppId)
		const selectedModel = session.selected_model || defaults.model
		const selectedStrategy = session.selected_strategy || defaults.strategy
		const selectedPersona = session.selected_persona || defaults.persona
		const hasExplicitModelSelection = Boolean(
			AIService.toOptionalTrimmedString(payload.modelId),
		)
		const strategyRules = AIService.parsePlaygroundRoutingRules(
			selectedStrategy.routing_rules,
		)
		const confidence = AIService.simulatePlaygroundConfidence(message)
		const matchedRule =
			strategyRules.find((rule) =>
				AIService.routingRuleMatchesConfidence(rule, confidence),
			) || null
		let routedModel = selectedModel
		const canOverrideModelFromRouting = !hasExplicitModelSelection
		if (
			canOverrideModelFromRouting &&
			matchedRule?.model_key &&
			matchedRule.model_key !== selectedModel.model_key
		) {
			const overrideModel = await prisma.ai_playground_models.findFirst({
				where: { app_id: targetAppId, model_key: matchedRule.model_key },
			})
			if (overrideModel) {
				routedModel = overrideModel
			}
		}

		const settings = await AIService.getSettings(targetAppId)
		const [runtimeProvider, embeddingRuntimeProvider] = await Promise.all([
			AIService.getRuntimeProviderConfig('completion'),
			AIService.getRuntimeProviderConfig('embedding'),
		])
		const runtime = AIService.toSummaryRuntimeConfig({
			settings,
			runtimeProvider,
			embeddingRuntimeProvider,
		})
		runtime.modelName =
			AIService.toOptionalTrimmedString(routedModel.model_key) ||
			runtime.modelName

		// Re-apply growthcircle plan_type suffix after model override
		if (runtime.provider === 'growthcircle' && runtimeProvider) {
			const planType = runtimeProvider.plan_type || 'free'
			if (planType === 'paid' || planType === 'team') {
				runtime.modelName = runtime.modelName.replace(/-free$/, '')
			} else if (planType === 'free' && !runtime.modelName.endsWith('-free')) {
				runtime.modelName = `${runtime.modelName}-free`
			}
		}

		const selectedSourceIds = (
			AIService.toOptionalStringArray(payload.selectedSourceIds) || []
		).filter((id) => isUuid(id))
		const requestedRagTopK = AIService.toOptionalFiniteNumber(payload.ragTopK)
		const ragTopK =
			requestedRagTopK !== undefined
				? clamp(Math.round(requestedRagTopK), 1, 8)
				: 5

		let ragResult: PlaygroundRagResult | null = null
		let ragRetrievalError: string | null = null
		try {
			const { KnowledgeService } = await import('../knowledge/service')
			ragResult = await KnowledgeService.retrievalTest(targetAppId, {
				query: message,
				selectedSourceIds:
					selectedSourceIds.length > 0 ? selectedSourceIds : undefined,
				topK: ragTopK,
				channel: 'live',
			})
		} catch (error) {
			ragRetrievalError = AIService.extractProviderErrorMessage(error) || null
		}
		const ragTopChunks = Array.isArray(ragResult?.topChunks)
			? ragResult.topChunks
					.slice(0, Math.max(1, Math.min(ragTopK, 5)))
					.map((chunk, index) => {
						const source = normalizeWhitespace(
							String(chunk.source || 'Knowledge'),
						)
						const locator = normalizeWhitespace(
							String(chunk.locator || 'sec.1'),
						)
						const snippet = normalizeWhitespace(String(chunk.snippet || ''))
						const scoreValue = Number(chunk.score || 0)
						const score = Number.isFinite(scoreValue)
							? scoreValue.toFixed(3)
							: '0.000'
						return `[S${index + 1}] ${source} (${locator}, score ${score}): ${snippet}`
					})
					.filter((line) => line.length > 0)
			: []
		const hasRagGrounding = Boolean(
			ragResult?.ragHit && ragTopChunks.length > 0 && !ragRetrievalError,
		)

		const recentTurns = await prisma.ai_playground_turns.findMany({
			where: {
				app_id: targetAppId,
				session_id: sessionRecordId,
				role: { in: ['user', 'assistant'] },
			},
			orderBy: [{ sort_order: 'desc' }, { created_at: 'desc' }],
			take: 6,
			select: {
				role: true,
				content: true,
			},
		})
		const transcriptLines = recentTurns
			.slice()
			.reverse()
			.map((turn) => {
				const role = turn.role === 'user' ? 'User' : 'Assistant'
				return `${role}: ${normalizeWhitespace(String(turn.content || ''))}`
			})
			.filter((line) => line.length > 0)

		const systemPrompt = [
			selectedPersona.system_instruction,
			'Jawab dalam Bahasa Indonesia.',
			'Berikan jawaban natural, relevan, dan langsung bisa ditindaklanjuti.',
			hasRagGrounding
				? 'Gunakan hanya fakta yang didukung konteks knowledge (RAG) yang diberikan. Untuk klaim penting (harga, stok, varian, syarat), wajib cantumkan referensi [S1]/[S2]/dst.'
				: 'Jika tidak ada konteks knowledge yang tervalidasi, jangan membuat fakta atau asumsi. Jelaskan secara jujur bahwa referensi belum ditemukan dan minta klarifikasi atau tawarkan handover.',
			'Jangan tampilkan metadata internal seperti confidence, model, provider, token, atau kata "simulasi".',
		].join(' ')

		const userPrompt =
			transcriptLines.length > 0
				? [
						'Konteks percakapan terakhir:',
						transcriptLines.join('\n'),
						'',
						'Konteks Knowledge (RAG):',
						hasRagGrounding
							? ragTopChunks.join('\n')
							: ragRetrievalError
								? `Retrieval error: ${ragRetrievalError}`
								: 'Tidak ada chunk knowledge yang lolos ambang relevansi.',
						'',
						`Pertanyaan terbaru user: ${message}`,
					].join('\n')
				: [
						'Konteks Knowledge (RAG):',
						hasRagGrounding
							? ragTopChunks.join('\n')
							: ragRetrievalError
								? `Retrieval error: ${ragRetrievalError}`
								: 'Tidak ada chunk knowledge yang lolos ambang relevansi.',
						'',
						`Pertanyaan user: ${message}`,
					].join('\n')

		const workflowSimulation = await AIService.runPlaygroundWorkflowSimulation({
			appId: targetAppId,
			sessionId: payload.sessionId,
			message,
		})
		const systemTraceLines: string[] = [workflowSimulation.traceLine]
		const workflowAssistantContent = AIService.toOptionalTrimmedString(
			workflowSimulation.assistantContent,
		)

		let assistantContent =
			workflowAssistantContent ||
			AIService.buildPlaygroundNoRagResponse({
				message,
				retrievalError: ragRetrievalError || undefined,
			})

		if (!workflowAssistantContent) {
			const completionResult: SummaryCompletionResult =
				await AIService.requestSummaryCompletion({
					runtime,
					systemPrompt,
					userPrompt,
				})
			const completionContent = AIService.toOptionalTrimmedString(
				completionResult.content,
			)
			const fallbackReason = completionContent
				? null
				: completionResult.providerHit
					? 'empty_provider_content'
					: completionResult.error === 'missing_runtime_configuration'
						? 'provider_unavailable'
						: 'provider_error'
			assistantContent =
				completionContent ||
				(hasRagGrounding
					? AIService.buildPlaygroundFallbackResponse(message)
					: AIService.buildPlaygroundNoRagResponse({
							message,
							retrievalError: ragRetrievalError || undefined,
						}))

			const providerName = runtime.provider || 'unknown'
			const providerStatus = completionResult.statusCode
				? `HTTP ${completionResult.statusCode}`
				: 'NO_HTTP_STATUS'
			const providerEndpointSuffix = completionResult.endpoint
				? ` @ ${completionResult.endpoint}`
				: ''
			const providerErrorSuffix = completionResult.error
				? ` · ${completionResult.error}`
				: ''
			const providerTraceLine = truncateText(
				fallbackReason
					? `[Provider Trace] ${providerName} FALLBACK (${fallbackReason}, ${providerStatus})${providerErrorSuffix}${providerEndpointSuffix}`
					: `[Provider Trace] ${providerName} HIT (${providerStatus})${providerEndpointSuffix}`,
				320,
			)
			systemTraceLines.push(providerTraceLine)
			if (completionResult.requestPayload) {
				systemTraceLines.push(
					truncateText(
						`[Provider Payload] ${JSON.stringify(completionResult.requestPayload)}`,
						1200,
					),
				)
			}
		}

		const lastTurn = await prisma.ai_playground_turns.findFirst({
			where: { app_id: targetAppId, session_id: session.id },
			orderBy: [{ sort_order: 'desc' }, { created_at: 'desc' }],
			select: { sort_order: true },
		})
		const nextOrder = (lastTurn?.sort_order ?? -1) + 1

		const tokensIn = Math.max(120, Math.floor(message.length * 1.8))
		const tokensOut = Math.max(64, Math.floor(assistantContent.length * 1.6))
		const hasWorkflowReply = Boolean(workflowAssistantContent)
		const assistantModelName = hasWorkflowReply
			? `workflow:${workflowSimulation.flowId || workflowSimulation.reason}`
			: routedModel.name
		const baseLatency = Number(routedModel.latency_ms || 920)
		const latencyMs = hasWorkflowReply
			? Math.max(120, workflowSimulation.latencyMs)
			: Math.max(260, baseLatency + Math.floor(Math.random() * 140) - 70)
		const priceIn = Math.max(0, Number(routedModel.price_in || 0))
		const estimatedCost = Math.max(0, (tokensIn / 1000) * priceIn)
		const usageIncrement = Math.max(1, Math.round(tokensOut / 70))
		const nextUsage = clamp(
			Math.round(Number(routedModel.usage_percent || 0)) + usageIncrement,
			0,
			100,
		)
		const nextModelLatency = Math.max(
			180,
			Math.round(
				(Number(routedModel.latency_ms || latencyMs) * 4 + latencyMs) / 5,
			),
		)
		const systemTraceTurns = systemTraceLines.map((line, index) => ({
			app_id: targetAppId,
			session_id: sessionRecordId,
			role: 'system' as const,
			content: line,
			sort_order: nextOrder + 2 + index,
		}))

		await prisma.$transaction(async (tx) => {
			await tx.ai_playground_turns.createMany({
				data: [
					{
						app_id: targetAppId,
						session_id: sessionRecordId,
						role: 'user',
						content: message,
						sort_order: nextOrder,
					},
					{
						app_id: targetAppId,
						session_id: sessionRecordId,
						role: 'assistant',
						content: assistantContent,
						model_name: assistantModelName,
						tokens_in: tokensIn,
						tokens_out: tokensOut,
						latency_ms: latencyMs,
						cost_usd: estimatedCost,
						sort_order: nextOrder + 1,
					},
					...systemTraceTurns,
				],
			})

			await tx.ai_playground_models.update({
				where: { id: routedModel.id },
				data: {
					usage_percent: nextUsage,
					latency_ms: nextModelLatency,
					updated_at: new Date(),
				},
			})

			await tx.ai_playground_sessions.update({
				where: { id: sessionRecordId },
				data: { updated_at: new Date() },
			})
		})

		await AIService.updatePlaygroundMetricsAfterRun(targetAppId, {
			tokensIn,
			tokensOut,
			latencyMs,
			costUsd: estimatedCost,
		})

		const refreshedSession = await AIService.findPlaygroundSession(
			targetAppId,
			sessionRecordId,
		)
		if (!refreshedSession)
			throw new Error('Playground session not found after run')
		return AIService.getPlaygroundState(targetAppId, refreshedSession.id)
	}

	static async getSettings(appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.ai_settings.findUnique({
			where: { app_id: targetAppId || undefined },
		})
	}

	static async updateSettings(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')
		const normalizedData = AIService.normalizeSettingsUpdatePayload(
			(data || {}) as Record<string, any>,
		)

		return prisma.ai_settings.upsert({
			where: { app_id: targetAppId },
			update: { ...normalizedData, updated_at: new Date() },
			create: {
				...normalizedData,
				app_id: targetAppId,
				use_platform_credentials:
					normalizedData.use_platform_credentials ?? false,
			},
		})
	}

	static async getSuggestions(conversationId: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')
		if (!isUuid(conversationId)) throw new Error('Invalid conversation ID')

		const settings = await AIService.getSettings(targetAppId)
		const [runtimeProvider, embeddingRuntimeProvider] = await Promise.all([
			AIService.getRuntimeProviderConfig('completion'),
			AIService.getRuntimeProviderConfig('embedding'),
		])
		const modelName =
			settings?.model_name || runtimeProvider?.model_name || DEFAULT_CHAT_MODEL
		const reservation = await AIService.reserveCredits(
			targetAppId,
			modelName,
			`AI Suggestion for conversation ${conversationId}`,
			{ conversation_id: conversationId },
		)

		try {
			const summaryResult = await AIService.generateConversationSummary({
				appId: targetAppId,
				conversationId,
				settings,
				runtimeProvider,
				embeddingRuntimeProvider,
			})

			const result = {
				suggestion: summaryResult.suggestion,
				confidence: summaryResult.confidence,
				provider: runtimeProvider?.provider || settings?.model_provider || null,
				base_url: runtimeProvider?.base_url || settings?.api_endpoint || null,
				retrieval: summaryResult.retrieval,
			}

			await AIService.finalizeReservation(reservation.reservationId)
			const conversationContext = await prisma.conversations.findUnique({
				where: { id: conversationId },
				select: { id: true, inbox_id: true },
			})
			void BusinessWebhookDispatchService.dispatch({
				event: 'ai_summary.generated',
				appId: targetAppId,
				inboxId: conversationContext?.inbox_id || null,
				payload: {
					conversation_id: conversationId,
					summary: result.suggestion,
					confidence: result.confidence,
					provider: result.provider,
					base_url: result.base_url,
					retrieval: result.retrieval,
				},
			})

			return result
		} catch (error) {
			console.error('[AIService] Suggestion flow failed after reservation', {
				conversationId,
				appId: targetAppId,
				reservationId: reservation.reservationId,
				error,
			})

			try {
				await AIService.refundReservation(
					reservation.reservationId,
					'Suggestion generation failure',
				)
			} catch (refundError) {
				console.error('[AIService] Suggestion refund failed', {
					conversationId,
					appId: targetAppId,
					reservationId: reservation.reservationId,
					error: refundError,
				})
			}

			throw error
		}
	}

	static async generateResponse(appId: string, payload: any) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		const settings = await AIService.getSettings(targetAppId)
		const runtimeProvider = await AIService.getRuntimeProviderConfig()
		const modelName =
			settings?.model_name || runtimeProvider?.model_name || DEFAULT_CHAT_MODEL
		const reservation = await AIService.reserveCredits(
			targetAppId,
			modelName,
			'AI Response generation',
			{ conversation_id: payload?.conversationId },
		)

		try {
			const result = {
				content: 'Automated AI response based on your query.',
				model: modelName,
				provider: runtimeProvider?.provider || settings?.model_provider || null,
				base_url: runtimeProvider?.base_url || settings?.api_endpoint || null,
			}

			await AIService.finalizeReservation(reservation.reservationId)

			return result
		} catch (error) {
			console.error(
				'[AIService] Response generation failed after reservation',
				{
					appId: targetAppId,
					reservationId: reservation.reservationId,
					error,
				},
			)

			try {
				await AIService.refundReservation(
					reservation.reservationId,
					'Response generation failure',
				)
			} catch (refundError) {
				console.error('[AIService] Response refund failed', {
					appId: targetAppId,
					reservationId: reservation.reservationId,
					error: refundError,
				})
			}

			throw error
		}
	}

	static async recordEvaluation(data: any) {
		const targetAppId = await resolveAppId(data.appId)
		return prisma.ai_evaluations.create({
			data: {
				app_id: targetAppId || data.appId,
				chatbot_id: data.chatbotId,
				content: data.content,
				type: data.type || 'evaluation',
				metadata: {
					score: data.score,
					feedback: data.feedback,
					conversation_id: data.conversationId,
				},
			},
		})
	}
}
