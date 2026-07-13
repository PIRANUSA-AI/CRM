import { randomUUID } from 'crypto'
import prisma from '../../lib/prisma'
import { maintenanceQueue } from '../../lib/queue'
import type { Prisma } from '../../generated/prisma'

const RETRY_AI_RESPONSE_LOG_JOB = 'retry-ai-response-log'
const ANALYZE_AI_RESPONSE_LOG_JOB = 'analyze-ai-response-log'
const RETRY_ATTEMPTS = Math.max(
	1,
	Math.min(10, Number(process.env.AI_RESPONSE_LOG_RETRY_ATTEMPTS || 5)),
)
const RETRY_BACKOFF_MS = Math.max(
	1_000,
	Math.min(60_000, Number(process.env.AI_RESPONSE_LOG_RETRY_BACKOFF_MS || 2_500)),
)
const ANALYZE_ATTEMPTS = Math.max(
	1,
	Math.min(10, Number(process.env.AI_RESPONSE_ANALYZE_ATTEMPTS || 3)),
)
const ANALYZE_BACKOFF_MS = Math.max(
	1_000,
	Math.min(
		60_000,
		Number(process.env.AI_RESPONSE_ANALYZE_BACKOFF_MS || 3_000),
	),
)

type CreateOptions = {
	asyncPersist?: boolean
	enqueueAnalysis?: boolean
}

export type KnowledgeReferenceLog = {
	type: 'faq' | 'source'
	id: string
	title: string
	score: number
	excerpt: string
}

export type RtkProviderTraceLog = {
	provider: string | null
	endpoint: string | null
	status_code: number | null
	hit: boolean
	used_fallback: boolean
	fallback_reason: string | null
	error: string | null
}

export type RtkSummaryLog = {
	before_count: number
	after_count: number
	before_chars: number
	after_chars: number
	deduped_count: number
	dropped_count: number
	dropped_items: string[]
	provider_trace?: RtkProviderTraceLog
}

export type AiResponseLogEntrypoint =
	| 'webhook_live'
	| 'flow_runtime'
	| 'followup'
	| 'simulate'
	| 'unknown'

type AiResponseLogStatus =
	| 'generated'
	| 'delivered'
	| 'retry_pending'
	| 'synthetic'
	| 'failed'

export type CreateAiResponseLogInput = {
	logId?: string
	appId: string
	chatbotId: string
	conversationId?: string | null
	entrypoint: AiResponseLogEntrypoint
	provider?: string | null
	modelName?: string | null
	promptTokens?: number
	completionTokens?: number
	totalTokens?: number
	usageCredits?: number
	usageUsd?: number
	usageIdr?: number
	billedCredits?: number
	knowledgeReferences?: KnowledgeReferenceLog[]
	rtkSummary?: RtkSummaryLog | Record<string, unknown>
	messageIds?: string[]
	knowledgeSnapshotAt?: string | Date | null
	status?: AiResponseLogStatus
	retryCount?: number
}

type RetryCreatePayload = {
	action: 'create'
	createInput: CreateAiResponseLogInput
	retryCount: number
}

type RetryLinkagePayload = {
	action: 'linkage'
	logId: string
	messageIds: string[]
	status?: AiResponseLogStatus
	retryCount: number
}

type RetryPayload = RetryCreatePayload | RetryLinkagePayload

type AnalyzePayload = {
	logId: string
}

type AiResponseOperationalAnalysis = {
	version: 1
	analyzed_at: string
	reference_count: number
	unique_reference_count: number
	average_reference_score: number
	prompt_tokens: number
	completion_tokens: number
	total_tokens: number
	usage_credits: number
	usage_usd: number
	usage_idr: number
	completion_ratio: number
	token_to_credit_ratio: number
	retrieval_score: number
	efficiency_score: number
	cost_score: number
	overall_score: number
}

function normalizeString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeNumber(value: unknown, fallback = 0): number {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return fallback
	if (numeric < 0) return 0
	return Math.round(numeric)
}

function normalizeDecimal(value: unknown, fallback = 0): number {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return fallback
	if (numeric < 0) return 0
	return Number(numeric.toFixed(6))
}

function normalizeBoolean(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		if (['true', '1', 'yes', 'on', 'active'].includes(normalized)) return true
		if (['false', '0', 'no', 'off', 'inactive'].includes(normalized))
			return false
	}
	return fallback
}

function normalizeStatusCode(value: unknown): number | null {
	const numeric = Number(value)
	if (!Number.isFinite(numeric)) return null
	const normalized = Math.trunc(numeric)
	return normalized > 0 ? normalized : null
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min
	if (value < min) return min
	if (value > max) return max
	return value
}

function normalizeMessageIds(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const unique = new Set<string>()
	for (const item of value) {
		const normalized = normalizeString(item)
		if (!normalized) continue
		unique.add(normalized)
	}
	return [...unique]
}

function normalizeReferences(value: unknown): KnowledgeReferenceLog[] {
	if (!Array.isArray(value)) return []
	const normalized: KnowledgeReferenceLog[] = []
	for (const raw of value) {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue
		const record = raw as Record<string, unknown>
		const id = normalizeString(record.id)
		const title = normalizeString(record.title)
		const excerpt = normalizeString(record.excerpt)
		const typeRaw = normalizeString(record.type)
		const type: 'faq' | 'source' = typeRaw === 'faq' ? 'faq' : 'source'
		if (!id || !title || !excerpt) continue
		normalized.push({
			type,
			id,
			title,
			score: Number(Number(record.score || 0).toFixed(6)),
			excerpt,
		})
	}
	return normalized
}

function normalizeReferenceScoreForAnalysis(rawScore: number): number {
	if (!Number.isFinite(rawScore)) return 0
	if (rawScore <= 1) return clamp(rawScore * 100, 0, 100)
	return clamp(rawScore, 0, 100)
}

function normalizeProviderTrace(value: unknown): RtkProviderTraceLog | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
	const record = value as Record<string, unknown>
	return {
		provider: normalizeString(record.provider) || null,
		endpoint: normalizeString(record.endpoint) || null,
		status_code: normalizeStatusCode(record.status_code),
		hit: normalizeBoolean(record.hit),
		used_fallback: normalizeBoolean(record.used_fallback),
		fallback_reason: normalizeString(record.fallback_reason) || null,
		error: normalizeString(record.error) || null,
	}
}

function normalizeRtkSummary(
	value: CreateAiResponseLogInput['rtkSummary'],
): RtkSummaryLog | Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {
			before_count: 0,
			after_count: 0,
			before_chars: 0,
			after_chars: 0,
			deduped_count: 0,
			dropped_count: 0,
			dropped_items: [],
		}
	}
	const record = value as Record<string, unknown>
	const providerTrace = normalizeProviderTrace(record.provider_trace)
	const droppedItems = Array.isArray(record.dropped_items)
		? record.dropped_items
				.map((item) => normalizeString(item))
				.filter((item): item is string => Boolean(item))
		: []
	const normalized: RtkSummaryLog = {
		before_count: normalizeNumber(record.before_count),
		after_count: normalizeNumber(record.after_count),
		before_chars: normalizeNumber(record.before_chars),
		after_chars: normalizeNumber(record.after_chars),
		deduped_count: normalizeNumber(record.deduped_count),
		dropped_count: normalizeNumber(record.dropped_count),
		dropped_items: droppedItems,
	}
	if (providerTrace) {
		normalized.provider_trace = providerTrace
	}
	return normalized
}

function normalizeDate(value: unknown): Date | null {
	if (!value) return null
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value
	const asDate = new Date(String(value))
	return Number.isNaN(asDate.getTime()) ? null : asDate
}

function shouldPreferAsyncPersistence(input: CreateAiResponseLogInput): boolean {
	return input.entrypoint !== 'simulate'
}

function computeAiResponseOperationalAnalysis(args: {
	references: KnowledgeReferenceLog[]
	promptTokens: number
	completionTokens: number
	totalTokens: number
	usageCredits: number
	usageUsd: number
	usageIdr: number
}): AiResponseOperationalAnalysis {
	const normalizedRefs = Array.isArray(args.references) ? args.references : []
	const uniqueRefCount = new Set(
		normalizedRefs.map((item) => `${item.type}:${item.id}`),
	).size
	const avgRefScoreRaw =
		normalizedRefs.length > 0
			? normalizedRefs.reduce((sum, item) => sum + Number(item.score || 0), 0) /
				normalizedRefs.length
			: 0
	const avgRefScore = normalizeReferenceScoreForAnalysis(avgRefScoreRaw)

	const promptTokens = normalizeNumber(args.promptTokens)
	const completionTokens = normalizeNumber(args.completionTokens)
	const totalTokens = normalizeNumber(args.totalTokens)
	const usageCredits = normalizeDecimal(args.usageCredits)
	const usageUsd = normalizeDecimal(args.usageUsd)
	const usageIdr = normalizeDecimal(args.usageIdr)

	const completionRatio =
		totalTokens > 0
			? Number((completionTokens / Math.max(totalTokens, 1)).toFixed(6))
			: 0
	const tokenToCreditRatio =
		totalTokens > 0
			? Number((usageCredits / Math.max(totalTokens, 1)).toFixed(6))
			: 0

	const retrievalScore = clamp(
		avgRefScore * 0.65 +
			Math.min(uniqueRefCount, 4) * 8 +
			(normalizedRefs.length > 0 ? 12 : 0),
		0,
		100,
	)

	const completionBalanceScore = clamp(
		100 - Math.abs(completionRatio - 0.45) * 220,
		0,
		100,
	)
	const tokenBudgetScore =
		totalTokens <= 0
			? 0
			: totalTokens <= 1_600
				? 100
				: clamp(100 - (totalTokens - 1_600) / 25, 25, 100)
	const efficiencyScore = clamp(
		completionBalanceScore * 0.6 + tokenBudgetScore * 0.4,
		0,
		100,
	)

	const tokenCreditDriftScore =
		totalTokens <= 0
			? 100
			: clamp(100 - Math.abs(tokenToCreditRatio - 1) * 220, 0, 100)
	const idrUsdParityScore = clamp(
		100 - Math.abs(usageIdr - usageUsd) * 20,
		0,
		100,
	)
	const costScore = clamp(
		tokenCreditDriftScore * 0.8 + idrUsdParityScore * 0.2,
		0,
		100,
	)

	const overallScore = clamp(
		retrievalScore * 0.45 + efficiencyScore * 0.35 + costScore * 0.2,
		0,
		100,
	)

	return {
		version: 1,
		analyzed_at: new Date().toISOString(),
		reference_count: normalizedRefs.length,
		unique_reference_count: uniqueRefCount,
		average_reference_score: Number(avgRefScore.toFixed(4)),
		prompt_tokens: promptTokens,
		completion_tokens: completionTokens,
		total_tokens: totalTokens,
		usage_credits: usageCredits,
		usage_usd: usageUsd,
		usage_idr: usageIdr,
		completion_ratio: completionRatio,
		token_to_credit_ratio: tokenToCreditRatio,
		retrieval_score: Number(retrievalScore.toFixed(4)),
		efficiency_score: Number(efficiencyScore.toFixed(4)),
		cost_score: Number(costScore.toFixed(4)),
		overall_score: Number(overallScore.toFixed(4)),
	}
}

function buildAnalyzePayload(logId: string): AnalyzePayload {
	return {
		logId: normalizeString(logId) || '',
	}
}

function toCreateData(input: CreateAiResponseLogInput) {
	const logId = normalizeString(input.logId) || randomUUID()
	return {
		id: logId,
		app_id: input.appId,
		chatbot_id: input.chatbotId,
		conversation_id: normalizeString(input.conversationId) || null,
		entrypoint: normalizeString(input.entrypoint) || 'unknown',
		provider: normalizeString(input.provider) || null,
		model_name: normalizeString(input.modelName) || null,
		prompt_tokens: normalizeNumber(input.promptTokens),
		completion_tokens: normalizeNumber(input.completionTokens),
		total_tokens: normalizeNumber(input.totalTokens),
		usage_credits: normalizeDecimal(input.usageCredits),
		usage_usd: normalizeDecimal(input.usageUsd),
		usage_idr: normalizeDecimal(input.usageIdr),
		billed_credits: normalizeDecimal(input.billedCredits),
		knowledge_references:
			normalizeReferences(input.knowledgeReferences) as unknown as Prisma.InputJsonValue,
		rtk_summary:
			normalizeRtkSummary(input.rtkSummary) as unknown as Prisma.InputJsonValue,
		message_ids: normalizeMessageIds(input.messageIds),
		status: normalizeString(input.status) || 'generated',
		retry_count: normalizeNumber(input.retryCount),
		knowledge_snapshot_at: normalizeDate(input.knowledgeSnapshotAt),
		updated_at: new Date(),
	}
}

async function enqueueRetry(payload: RetryPayload) {
	try {
		await maintenanceQueue.add(RETRY_AI_RESPONSE_LOG_JOB, payload, {
			attempts: RETRY_ATTEMPTS,
			backoff: {
				type: 'exponential',
				delay: RETRY_BACKOFF_MS,
			},
			removeOnComplete: 500,
			removeOnFail: 1_000,
		})
	} catch (enqueueError) {
		console.error('[AIResponseLogService] Failed enqueue retry-ai-response-log', {
			payload,
			enqueueError,
		})
	}
}

async function enqueueAnalysis(payload: AnalyzePayload) {
	const normalizedLogId = normalizeString(payload.logId)
	if (!normalizedLogId) return
	try {
		await maintenanceQueue.add(
			ANALYZE_AI_RESPONSE_LOG_JOB,
			buildAnalyzePayload(normalizedLogId),
			{
				attempts: ANALYZE_ATTEMPTS,
				backoff: {
					type: 'exponential',
					delay: ANALYZE_BACKOFF_MS,
				},
				removeOnComplete: 500,
				removeOnFail: 1_000,
				delay: 500,
			},
		)
	} catch (enqueueError) {
		console.error('[AIResponseLogService] Failed enqueue analyze-ai-response-log', {
			payload,
			enqueueError,
		})
	}
}

export abstract class AIResponseLogService {
	static async create(
		input: CreateAiResponseLogInput,
		options?: CreateOptions,
	): Promise<{
		logId: string
		persisted: boolean
	}> {
		const createData = toCreateData(input)
		const asyncPersist =
			typeof options?.asyncPersist === 'boolean'
				? options.asyncPersist
				: shouldPreferAsyncPersistence(input)
		const shouldEnqueueAnalysis = options?.enqueueAnalysis !== false

		if (asyncPersist) {
			await enqueueRetry({
				action: 'create',
				createInput: {
					...input,
					logId: createData.id,
					retryCount: createData.retry_count,
				},
				retryCount: createData.retry_count,
			})
			return { logId: createData.id, persisted: false }
		}

		try {
			await prisma.ai_response_logs.create({
				data: createData,
			})
			if (shouldEnqueueAnalysis) {
				void enqueueAnalysis({ logId: createData.id })
			}
			return { logId: createData.id, persisted: true }
		} catch (error) {
			console.error('[AIResponseLogService] Failed to create ai_response_logs row', {
				logId: createData.id,
				entrypoint: createData.entrypoint,
				error,
			})
			await enqueueRetry({
				action: 'create',
				createInput: {
					...input,
					logId: createData.id,
					retryCount: createData.retry_count + 1,
				},
				retryCount: createData.retry_count + 1,
			})
			return { logId: createData.id, persisted: false }
		}
	}

	static async attachMessageIds(params: {
		logId: string | null | undefined
		messageIds?: string[]
		status?: AiResponseLogStatus
	}): Promise<void> {
		const logId = normalizeString(params.logId)
		if (!logId) return
		const messageIds = normalizeMessageIds(params.messageIds)
		const status = normalizeString(params.status) || 'delivered'

		try {
			await prisma.ai_response_logs.update({
				where: { id: logId },
				data: {
					message_ids: messageIds,
					status,
					updated_at: new Date(),
				},
			})
		} catch (error) {
			console.error('[AIResponseLogService] Failed updating ai_response_logs linkage', {
				logId,
				messageIds,
				error,
			})
			await enqueueRetry({
				action: 'linkage',
				logId,
				messageIds,
				status: status as AiResponseLogStatus,
				retryCount: 1,
			})
		}
	}

	static async processRetryJob(raw: unknown): Promise<void> {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('Invalid retry-ai-response-log payload')
		}

		const payload = raw as Record<string, unknown>
		const action = normalizeString(payload.action)
		if (action === 'create') {
			const createInput = payload.createInput
			if (!createInput || typeof createInput !== 'object' || Array.isArray(createInput)) {
				throw new Error('Invalid retry createInput payload')
			}
			const normalizedCreateInput = {
				...(createInput as CreateAiResponseLogInput),
				retryCount: normalizeNumber(payload.retryCount) || normalizeNumber((createInput as CreateAiResponseLogInput).retryCount),
			}
			const createData = toCreateData(normalizedCreateInput)
			await prisma.ai_response_logs.upsert({
				where: { id: createData.id },
				update: {
					app_id: createData.app_id,
					chatbot_id: createData.chatbot_id,
					conversation_id: createData.conversation_id,
					entrypoint: createData.entrypoint,
					provider: createData.provider,
					model_name: createData.model_name,
					prompt_tokens: createData.prompt_tokens,
					completion_tokens: createData.completion_tokens,
					total_tokens: createData.total_tokens,
					usage_credits: createData.usage_credits,
					usage_usd: createData.usage_usd,
					usage_idr: createData.usage_idr,
					billed_credits: createData.billed_credits,
					knowledge_references:
						createData.knowledge_references as unknown as Prisma.InputJsonValue,
					rtk_summary:
						createData.rtk_summary as unknown as Prisma.InputJsonValue,
					message_ids: createData.message_ids,
					status: createData.status,
					retry_count: createData.retry_count,
					knowledge_snapshot_at: createData.knowledge_snapshot_at,
					updated_at: new Date(),
				},
				create: createData,
			})
			void enqueueAnalysis({ logId: createData.id })
			return
		}

		if (action === 'linkage') {
			const logId = normalizeString(payload.logId)
			if (!logId) throw new Error('Invalid retry linkage logId payload')
			const messageIds = normalizeMessageIds(payload.messageIds)
			const status = normalizeString(payload.status) || 'delivered'
			const retryCount = normalizeNumber(payload.retryCount)
			await prisma.ai_response_logs.update({
				where: { id: logId },
				data: {
					message_ids: messageIds,
					status,
					retry_count: retryCount,
					updated_at: new Date(),
				},
			})
			return
		}

		throw new Error('Unknown retry-ai-response-log action')
	}

	static async processAnalyzeJob(raw: unknown): Promise<void> {
		if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new Error('Invalid analyze-ai-response-log payload')
		}
		const payload = raw as Record<string, unknown>
		const logId = normalizeString(payload.logId)
		if (!logId) throw new Error('Invalid analyze-ai-response-log logId payload')

		const record = await prisma.ai_response_logs.findUnique({
			where: { id: logId },
			select: {
				id: true,
				knowledge_references: true,
				prompt_tokens: true,
				completion_tokens: true,
				total_tokens: true,
				usage_credits: true,
				usage_usd: true,
				usage_idr: true,
				rtk_summary: true,
			},
		})
		if (!record) {
			throw new Error(`AI response log not found for analysis: ${logId}`)
		}

		const references = normalizeReferences(record.knowledge_references)
		const analysis = computeAiResponseOperationalAnalysis({
			references,
			promptTokens: Number(record.prompt_tokens || 0),
			completionTokens: Number(record.completion_tokens || 0),
			totalTokens: Number(record.total_tokens || 0),
			usageCredits: Number(record.usage_credits || 0),
			usageUsd: Number(record.usage_usd || 0),
			usageIdr: Number(record.usage_idr || 0),
		})

		const rawRtkSummary =
			record.rtk_summary && typeof record.rtk_summary === 'object'
				? (record.rtk_summary as Record<string, unknown>)
				: {}
		const nextRtkSummary = {
			...rawRtkSummary,
			analysis,
		}

		await prisma.ai_response_logs.update({
			where: { id: logId },
			data: {
				rtk_summary: nextRtkSummary as unknown as Prisma.InputJsonValue,
				updated_at: new Date(),
			},
		})
	}
}

export const __test__ = {
	computeAiResponseOperationalAnalysis,
	shouldPreferAsyncPersistence,
}
