import prisma from '../../lib/prisma'
import { isUuid } from '../../lib/utils'
import { buildAiAnalytics } from '../conversation/ai-analytics'
import { KnowledgeService } from '../knowledge/service'
import { CHAT_ASSIGNABLE_ROLES } from '../../lib/require-role'

export type DecisionIntent =
	| 'inquiry_general'
	| 'pricing_request'
	| 'product_lookup'
	| 'stock_check'
	| 'variant_match'
	| 'order_intent'
	| 'complaint'
	| 'handover_request'
	| 'churn_signal'
	| 'unknown'

export type SentimentState = 'positive' | 'neutral' | 'negative'
export type BuyingStage =
	| 'awareness'
	| 'consideration'
	| 'intent_to_buy'
	| 'payment_pending'
	| 'purchased'
export type ConfidenceBand = 'high' | 'medium' | 'low'
export type DecisionRouteTarget = 'workflow' | 'clarify' | 'handover'
export type DecisionRecommendedAction =
	| 'knowledge_reply'
	| 'list_products'
	| 'product_detail'
	| 'stock_check'
	| 'variant_match'
	| 'order_assist'
	| 'retain_customer'
	| 'clarify_need'
	| 'handover_pending_approval'

const DECISION_INTENT_KEYS: DecisionIntent[] = [
	'inquiry_general',
	'pricing_request',
	'product_lookup',
	'stock_check',
	'variant_match',
	'order_intent',
	'complaint',
	'handover_request',
	'churn_signal',
	'unknown',
]
const DECISION_INTENT_SET = new Set<DecisionIntent>(DECISION_INTENT_KEYS)

const OPEN_ORDER_PHASES = ['cart', 'checkout', 'payment_pending']
const BUYING_STAGE_ORDER_PHASES = [...OPEN_ORDER_PHASES, 'paid']
const INTENT_KEYWORDS: Record<DecisionIntent, string[]> = {
	inquiry_general: [
		'info',
		'informasi',
		'tanya',
		'bertanya',
		'bagaimana',
		'cara',
		'apa itu',
	],
	pricing_request: [
		'harga',
		'price',
		'biaya',
		'berapa',
		'pricelist',
		'promo',
		'diskon',
	],
	product_lookup: [
		'produk',
		'product',
		'katalog',
		'catalog',
		'cari produk',
		'rekomendasi',
		'pilihan',
	],
	stock_check: [
		'stok',
		'stock',
		'ready',
		'tersedia',
		'available',
		'cek stok',
		'masih ada',
	],
	variant_match: [
		'ukuran',
		'size',
		'warna',
		'color',
		'varian',
		'variant',
		'tipe',
	],
	order_intent: [
		'beli',
		'pesan',
		'order',
		'checkout',
		'bayar',
		'pembayaran',
		'keranjang',
		'cart',
		'ambil',
	],
	complaint: [
		'komplain',
		'complain',
		'keluhan',
		'kecewa',
		'marah',
		'buruk',
		'jelek',
		'lambat',
		'tidak sesuai',
	],
	handover_request: [
		'admin',
		'agent',
		'agen',
		'cs',
		'customer service',
		'manusia',
		'operator',
		'staff',
	],
	churn_signal: [
		'cancel',
		'batal',
		'refund',
		'unsubscribe',
		'berhenti',
		'tidak jadi',
	],
	unknown: [],
}
const GREETING_PATTERNS = [
	'halo',
	'hai',
	'haii',
	'hallo',
	'hello',
	'hi',
	'hey',
	'pagi',
	'siang',
	'sore',
	'malam',
	'assalamualaikum',
]
const LOW_CONFIDENCE_WORKFLOW_INTENTS = new Set<DecisionIntent>([
	'inquiry_general',
	'pricing_request',
	'product_lookup',
	'stock_check',
	'variant_match',
])
const DEFAULT_INTENT_RECOMMENDED_ACTIONS: Record<DecisionIntent, DecisionRecommendedAction> = {
	inquiry_general: 'knowledge_reply',
	pricing_request: 'knowledge_reply',
	product_lookup: 'knowledge_reply',
	stock_check: 'stock_check',
	variant_match: 'variant_match',
	order_intent: 'order_assist',
	complaint: 'retain_customer',
	handover_request: 'handover_pending_approval',
	churn_signal: 'retain_customer',
	unknown: 'clarify_need',
}
const POSITIVE_SENTIMENT_KEYWORDS = [
	'terima kasih',
	'makasih',
	'thanks',
	'ok',
	'siap',
	'bagus',
	'deal',
	'great',
]
const NEGATIVE_SENTIMENT_KEYWORDS = [
	'kecewa',
	'buruk',
	'jelek',
	'marah',
	'kesal',
	'komplain',
	'complain',
	'lama',
	'lambat',
	'cancel',
]
const PROMPT_INJECTION_KEYWORDS = [
	'ignore previous instruction',
	'ignore all previous',
	'reveal system prompt',
	'system prompt',
	'developer mode',
	'jailbreak',
	'bypass safety',
	'disable guardrail',
	'abaikan instruksi sebelumnya',
	'aktifkan developer mode',
	'buka prompt sistem',
]
const DEFAULT_SENTIMENT_SENSITIVE_INTENTS: Partial<Record<SentimentState, DecisionIntent[]>> = {
	negative: [],
}
const DEFAULT_APPROVAL_REASON_TEMPLATES: {
	low_confidence: string
	high_churn_risk: string
	negative_sentiment: string
	prompt_injection_risk: string
	intent: Partial<Record<DecisionIntent, string>>
} = {
	low_confidence: 'low confidence',
	high_churn_risk: 'high churn risk',
	negative_sentiment: 'negative sentiment',
	prompt_injection_risk: 'prompt injection risk',
	intent: {},
}

export type ConversationAISignal = {
	id: string
	app_id: string
	conversation_id: string
	flow_id: string | null
	message_id: string | null
	channel_type: string | null
	source: string | null
	intent: DecisionIntent
	intent_confidence: number
	sentiment_state: SentimentState
	sentiment_transition: string
	buying_stage: BuyingStage
	churn_risk_score: number
	model_confidence: number
	retrieval_score: number
	product_match_score: number
	rule_modifier_score: number
	overall_confidence: number
	confidence_band: ConfidenceBand
	recommended_action: DecisionRecommendedAction
	route_target: DecisionRouteTarget
	requires_approval: boolean
	approval_reason: string | null
	persona_id: string | null
	signal_payload: Record<string, unknown>
	created_at: string
}

export type DecisionEnvelope = {
	intent: DecisionIntent
	intent_confidence: number
	sentiment_state: SentimentState
	sentiment_transition: string
	buying_stage: BuyingStage
	churn_risk_score: number
	overall_confidence: number
	confidence_band: ConfidenceBand
	recommended_action: DecisionRecommendedAction
	requires_approval: boolean
	approval_reason: string | null
	persona_id: string | null
	route_target: DecisionRouteTarget
	model_confidence: number
	retrieval_score: number
	product_match_score: number
	rule_modifier_score: number
	clarification_prompt: string | null
	applied_policy: DecisionPolicy
	created_at: string
}

export type DecisionPolicyThreshold = {
	high: number
	medium: number
}

export type DecisionPolicyIntentOverride = {
	high?: number
	medium?: number
	require_approval?: boolean
	persona_id?: string | null
}

type DecisionPolicySentimentKeywords = {
	positive: string[]
	negative: string[]
}

export type DecisionPolicy = {
	thresholds: DecisionPolicyThreshold
	intent_overrides: Partial<Record<DecisionIntent, DecisionPolicyIntentOverride>>
	intent_persona_map: Partial<Record<DecisionIntent, string>>
	intent_keywords: Record<DecisionIntent, string[]>
	sentiment_keywords: DecisionPolicySentimentKeywords
	prompt_injection_keywords: string[]
	intent_recommended_actions: Partial<Record<DecisionIntent, DecisionRecommendedAction>>
	sensitive_intents: DecisionIntent[]
	sentiment_sensitive_intents: Partial<Record<SentimentState, DecisionIntent[]>>
	approval_reasons: {
		low_confidence: string
		high_churn_risk: string
		negative_sentiment: string
		prompt_injection_risk: string
		intent: Partial<Record<DecisionIntent, string>>
	}
	clarification_prompt: string
	not_found_approval_reason: string
	not_found_clarification_prompt: string
	not_found_recommended_action: DecisionRecommendedAction
	sensitive_actions: string[]
	approval: {
		mode: 'always_approval'
		escalation_minutes: number[]
		triage_status_on_timeout: string
	}
	assignment: {
		strategy: 'skill_load_sla'
	}
	weights: {
		model: number
		retrieval_product: number
		rule_modifier: number
	}
}

export type FlowDecisionPolicy = {
	id: string | null
	app_id: string
	flow_id: string | null
	active: boolean
	policy: DecisionPolicy
	updated_at: string | null
}

type MessageHistoryRow = {
	sender_type: string | null
	content: string | null
	created_at: Date | null
}

type EvaluateInboundParams = {
	appId: string
	conversationId: string
	flowId: string | null
	messageId?: string | null
	channelType?: string | null
	incomingText: string
	source?: 'inbound' | 'commerce_event'
}

type CommerceSnapshot = {
	openOrderPhase: string | null
	repeatOrders: number
	lifetimeValue: number
	productMatchScore: number
	productMatchMeta: Record<string, unknown>
}

const DEFAULT_DECISION_POLICY: DecisionPolicy = {
	thresholds: {
		high: 0.75,
		medium: 0.55,
	},
	intent_overrides: {},
	intent_persona_map: {},
	intent_keywords: INTENT_KEYWORDS,
	sentiment_keywords: {
		positive: POSITIVE_SENTIMENT_KEYWORDS,
		negative: NEGATIVE_SENTIMENT_KEYWORDS,
	},
	prompt_injection_keywords: PROMPT_INJECTION_KEYWORDS,
	intent_recommended_actions: DEFAULT_INTENT_RECOMMENDED_ACTIONS,
	sensitive_intents: [],
	sentiment_sensitive_intents: DEFAULT_SENTIMENT_SENSITIVE_INTENTS,
	approval_reasons: DEFAULT_APPROVAL_REASON_TEMPLATES,
	clarification_prompt:
		'Agar saya bantu lebih tepat, boleh jelaskan produk/tujuan yang Anda cari?',
	not_found_approval_reason: 'Conversation not found during decision evaluation',
	not_found_clarification_prompt: 'Boleh dijelaskan kebutuhan utama Anda saat ini?',
	not_found_recommended_action: 'handover_pending_approval',
	sensitive_actions: [
		'handover',
		'price_change',
		'discount_change',
		'cancel_order',
		'critical_customer_update',
	],
	approval: {
		mode: 'always_approval',
		escalation_minutes: [5, 15, 30],
		triage_status_on_timeout: 'pending_supervisor_note',
	},
	assignment: {
		strategy: 'skill_load_sla',
	},
	weights: {
		model: 0.55,
		retrieval_product: 0.25,
		rule_modifier: 0.2,
	},
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function asDate(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value
	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value)
		if (!Number.isNaN(parsed.getTime())) return parsed
	}
	return null
}

function normalizeText(value: string): string {
	return value.trim().toLowerCase()
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function containsKeyword(text: string, keyword: string): boolean {
	const normalizedText = normalizeText(text)
	const normalizedKeyword = normalizeText(keyword)
	if (!normalizedText || !normalizedKeyword) return false
	const pattern = new RegExp(
		`(^|[^\\p{L}\\p{N}_])${escapeRegExp(normalizedKeyword)}(?=$|[^\\p{L}\\p{N}_])`,
		'u',
	)
	return pattern.test(normalizedText)
}

function hasGreetingPrefix(text: string): boolean {
	const normalized = normalizeText(text)
	if (!normalized) return false
	return GREETING_PATTERNS.some(
		(greeting) => normalized === greeting || normalized.startsWith(`${greeting} `),
	)
}

function isLikelyGreeting(text: string): boolean {
	const normalized = normalizeText(text)
	if (!normalized || normalized.length > 40) return false
	if (GREETING_PATTERNS.includes(normalized)) return true
	const tokenCount = normalized.split(/\s+/).filter(Boolean).length
	if (tokenCount > 4) return false
	for (const greeting of GREETING_PATTERNS) {
		if (normalized === greeting || normalized.startsWith(`${greeting} `)) {
			return true
		}
	}
	return false
}

function shouldSkipLowConfidenceApproval(args: {
	intent: DecisionIntent
	incomingText: string
}): boolean {
	if (hasGreetingPrefix(args.incomingText)) return true
	return LOW_CONFIDENCE_WORKFLOW_INTENTS.has(args.intent)
}

function collectSentimentSensitiveIntents(
	source: Partial<Record<SentimentState, unknown[]>>,
): DecisionIntent[] {
	const normalized: DecisionIntent[] = []
	for (const state of ['positive', 'neutral', 'negative'] as SentimentState[]) {
		const values = Array.isArray(source[state]) ? source[state] : []
		for (const value of values) {
			const intent = normalizeDecisionIntent(value)
			if (intent) normalized.push(intent)
		}
	}
	return Array.from(new Set(normalized))
}

function normalizeDecisionIntent(value: unknown): DecisionIntent | null {
	const normalized = asString(value)
	if (!normalized) return null
	return (DECISION_INTENT_SET.has(normalizeText(normalized) as DecisionIntent)
		? (normalizeText(normalized) as DecisionIntent)
		: null)
}

function normalizeDecisionAction(value: unknown): DecisionRecommendedAction | null {
	const normalized = asString(value)
	if (!normalized) return null
	const action = normalizeText(normalized) as DecisionRecommendedAction
	const validActions: Set<string> = new Set([
		'knowledge_reply',
		'list_products',
		'product_detail',
		'stock_check',
		'variant_match',
		'order_assist',
		'retain_customer',
		'clarify_need',
		'handover_pending_approval',
	])
	return validActions.has(action) ? action : null
}

function clamp(value: number, min = 0, max = 1): number {
	if (!Number.isFinite(value)) return min
	if (value < min) return min
	if (value > max) return max
	return value
}

function toSafeNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeKeywordList(value: unknown): string[] {
	return Array.isArray(value)
		? value.map((item) => normalizeText(String(item || ''))).filter((item) => item.length > 0)
		: []
}

function normalizeConfidence(value: unknown, fallback = 0.5): number {
	const parsed = toSafeNumber(value, fallback)
	const normalized =
		parsed > 1 && parsed <= 100 ? Number((parsed / 100).toFixed(6)) : parsed
	return Number(clamp(normalized, 0, 1).toFixed(6))
}

function scoreKeywordHits(text: string, keywords: string[]): number {
	if (!text || keywords.length === 0) return 0
	let hits = 0
	for (const keyword of keywords) {
		if (!keyword) continue
		if (containsKeyword(text, keyword)) hits += 1
	}
	return hits
}

function normalizeThresholdPair(
	highInput: unknown,
	mediumInput: unknown,
	fallback: DecisionPolicyThreshold = DEFAULT_DECISION_POLICY.thresholds,
): DecisionPolicyThreshold {
	const high = clamp(toSafeNumber(highInput, fallback.high))
	const medium = clamp(toSafeNumber(mediumInput, fallback.medium))
	if (medium >= high) {
		return {
			high,
			medium: clamp(high - 0.1),
		}
	}
	return {
		high,
		medium,
	}
}

function normalizeConfidenceBand(
	overallConfidence: number,
	thresholds: DecisionPolicyThreshold,
): ConfidenceBand {
	if (overallConfidence >= thresholds.high) return 'high'
	if (overallConfidence >= thresholds.medium) return 'medium'
	return 'low'
}

function resolveBuyingStage(phaseRaw: string | null): BuyingStage {
	const phase = normalizeText(phaseRaw || '')
	if (phase === 'cart') return 'consideration'
	if (phase === 'checkout') return 'intent_to_buy'
	if (phase === 'payment_pending') return 'payment_pending'
	if (phase === 'paid') return 'purchased'
	return 'awareness'
}

function resolveCommerceSentimentState(
	baseSentiment: SentimentState,
	phaseRaw: string | null,
): SentimentState {
	if (baseSentiment === 'negative') return baseSentiment
	const phase = normalizeText(phaseRaw || '')
	if (BUYING_STAGE_ORDER_PHASES.includes(phase)) return 'positive'
	return baseSentiment
}

function detectSentimentState(
	texts: string[],
	policy: DecisionPolicy = DEFAULT_DECISION_POLICY,
): SentimentState {
	if (texts.length === 0) return 'neutral'
	let positiveHits = 0
	let negativeHits = 0
	for (const text of texts) {
		const positiveKeywords =
			policy.sentiment_keywords?.positive.length
				? policy.sentiment_keywords.positive
				: POSITIVE_SENTIMENT_KEYWORDS
		const negativeKeywords =
			policy.sentiment_keywords?.negative.length
				? policy.sentiment_keywords.negative
				: NEGATIVE_SENTIMENT_KEYWORDS
		positiveHits += scoreKeywordHits(text, positiveKeywords)
		negativeHits += scoreKeywordHits(text, negativeKeywords)
	}
	if (positiveHits > negativeHits) return 'positive'
	if (negativeHits > positiveHits) return 'negative'
	return 'neutral'
}

function detectIntentFromText(
	text: string,
	policy: DecisionPolicy = DEFAULT_DECISION_POLICY,
): {
	intent: DecisionIntent
	confidence: number
} {
	const normalized = normalizeText(text)
	if (isLikelyGreeting(normalized)) {
		return {
			intent: 'inquiry_general',
			confidence: 0.62,
		}
	}
	if (!normalized) {
		return {
			intent: 'unknown',
			confidence: 0.2,
		}
	}

	const intents = (
		Object.keys(policy.intent_keywords || {})
			.map((item) => normalizeDecisionIntent(item))
			.filter((item): item is DecisionIntent => Boolean(item))
	)
	const resolvedIntentKeys = intents.length > 0 ? intents : DECISION_INTENT_KEYS
	const fallbackIntent = resolvedIntentKeys.includes('inquiry_general')
		? 'inquiry_general'
		: resolvedIntentKeys[0] || 'unknown'
	let bestIntent: DecisionIntent = 'inquiry_general'
	let bestHits = 0
	for (const intent of resolvedIntentKeys) {
		const hits = scoreKeywordHits(
			normalized,
			policy.intent_keywords[intent] || [],
		)
		if (hits > bestHits) {
			bestHits = hits
			bestIntent = intent
		}
	}

	if (bestHits <= 0) {
		return {
			intent: fallbackIntent,
			confidence: 0.45,
		}
	}

	const baseConfidence = clamp(0.5 + bestHits * 0.13, 0.5, 0.93)
	return {
		intent: bestIntent,
		confidence: Number(baseConfidence.toFixed(6)),
	}
}

function detectPromptInjectionRisk(text: string, policy: DecisionPolicy = DEFAULT_DECISION_POLICY): boolean {
	const normalized = normalizeText(text || '')
	if (!normalized) return false
	const keywords = (
		policy.prompt_injection_keywords.length > 0
			? policy.prompt_injection_keywords
			: PROMPT_INJECTION_KEYWORDS
	).map((keyword) => normalizeText(String(keyword || '')))
	return keywords.some((keyword) =>
		keyword.length > 0 && normalized.includes(keyword),
	)
}

function resolveRecommendedAction(
	intent: DecisionIntent,
	policy: DecisionPolicy = DEFAULT_DECISION_POLICY,
	forcedAction?: DecisionRecommendedAction,
): DecisionRecommendedAction {
	if (forcedAction) return forcedAction
	const resolved = normalizeDecisionAction(policy.intent_recommended_actions[intent])
	if (resolved) return resolved
	return DEFAULT_INTENT_RECOMMENDED_ACTIONS[intent]
}

function resolveDecisionOutcome(args: {
	intent: DecisionIntent
	confidenceBand: ConfidenceBand
	churnRisk: number
	sentimentState: SentimentState
	defaultAction: DecisionRecommendedAction
	policy?: DecisionPolicy
	overrideRequireApproval?: boolean
	skipLowConfidenceApproval?: boolean
	policySensitiveActions?: string[]
	promptInjectionRisk?: boolean
}): {
	requiresApproval: boolean
	recommendedAction: DecisionRecommendedAction
	routeTarget: DecisionRouteTarget
} {
	const sensitiveActions = new Set(
		(args.policySensitiveActions || [])
			.map((value) => normalizeText(String(value || '')))
			.filter((value) => value.length > 0),
	)
	const skipLowConfidenceApproval = args.skipLowConfidenceApproval === true
	const sensitiveActionsSet = new Set<DecisionIntent>([
		...((args.policy || DEFAULT_DECISION_POLICY).sensitive_intents || []),
		...((args.policy || DEFAULT_DECISION_POLICY).sentiment_sensitive_intents?.[
			args.sentimentState
		] || []),
	].filter((intent): intent is DecisionIntent => Boolean(intent)))
	const sensitiveIntent = sensitiveActionsSet.has(args.intent) || args.churnRisk >= 70
	const sensitiveActionByPolicy =
		sensitiveActions.has(normalizeText(args.defaultAction))
	const requiresApproval =
		args.overrideRequireApproval === true ||
		sensitiveIntent ||
		(args.confidenceBand === 'low' && !skipLowConfidenceApproval) ||
		args.defaultAction === 'handover_pending_approval' ||
		sensitiveActionByPolicy ||
		args.promptInjectionRisk === true

	const recommendedAction: DecisionRecommendedAction = requiresApproval
		? 'handover_pending_approval'
		: args.confidenceBand === 'medium'
			? 'clarify_need'
			: args.defaultAction
	const routeTarget: DecisionRouteTarget = requiresApproval
		? 'handover'
		: args.confidenceBand === 'medium'
			? 'clarify'
			: 'workflow'

	return {
		requiresApproval,
		recommendedAction,
		routeTarget,
	}
}

function computeDecisionEvaluationMetrics(args: {
	signals: Array<{
		intent?: unknown
		route_target?: unknown
		requires_approval?: unknown
		churn_risk_score?: unknown
		sentiment_state?: unknown
	}>
	policy_sensitive_intents?: unknown[]
	policy_sentiment_sensitive_intents?: unknown[]
	labeledIntents?: Array<{
		predicted_intent?: unknown
		expected_intent?: unknown
	}>
}): {
	total_signals: number
	total_labeled: number
	intent_match_rate: number
	fallback_rate: number
	handover_precision: number
	approval_load_rate: number
} {
	const signals = Array.isArray(args.signals) ? args.signals : []
	const labeledIntents = Array.isArray(args.labeledIntents) ? args.labeledIntents : []

	const toRate = (numerator: number, denominator: number) => {
		if (denominator <= 0) return 0
		return Number(clamp(numerator / denominator, 0, 1).toFixed(6))
	}

	let fallbackCount = 0
	let approvalCount = 0
	let totalHandover = 0
	let sensitiveHandover = 0
	const sensitiveIntents = new Set<DecisionIntent>(
		(args.policy_sensitive_intents || DEFAULT_DECISION_POLICY.sensitive_intents).filter(
			(intent): intent is DecisionIntent => Boolean(normalizeDecisionIntent(intent)),
		),
	)
	const sensitiveIntentsBySentiment = new Set<DecisionIntent>(
		(
			args.policy_sentiment_sensitive_intents ||
			(DEFAULT_DECISION_POLICY.sentiment_sensitive_intents.negative || [])
		).filter(
			(intent): intent is DecisionIntent => Boolean(normalizeDecisionIntent(intent)),
		),
	)

	for (const signal of signals) {
		const routeTarget = normalizeText(String(signal.route_target || ''))
		const intent = normalizeDecisionIntent(signal.intent)
		const sentiment = normalizeText(String(signal.sentiment_state || ''))
		const churnRisk = toSafeNumber(signal.churn_risk_score, 0)
		const requiresApproval = signal.requires_approval === true

		if (routeTarget === 'clarify' || routeTarget === 'handover') fallbackCount += 1
		if (requiresApproval) approvalCount += 1
		if (routeTarget === 'handover') {
			totalHandover += 1
			const sensitiveIntent =
				(intent ? sensitiveIntents.has(intent) : false) ||
				(intent ? (sensitiveIntentsBySentiment.has(intent) && sentiment === 'negative') : false) ||
				churnRisk >= 70
			if (sensitiveIntent) sensitiveHandover += 1
		}
	}

	let intentMatched = 0
	for (const row of labeledIntents) {
		const predicted = normalizeText(String(row.predicted_intent || ''))
		const expected = normalizeText(String(row.expected_intent || ''))
		if (!predicted || !expected) continue
		if (predicted === expected) intentMatched += 1
	}

	return {
		total_signals: signals.length,
		total_labeled: labeledIntents.length,
		intent_match_rate: toRate(intentMatched, labeledIntents.length),
		fallback_rate: toRate(fallbackCount, signals.length),
		handover_precision: toRate(sensitiveHandover, totalHandover),
		approval_load_rate: toRate(approvalCount, signals.length),
	}
}

function computeOverallConfidence(args: {
	modelConfidence: number
	retrievalProductScore: number
	ruleModifierScore: number
	weights: {
		model: number
		retrieval_product: number
		rule_modifier: number
	}
}): number {
	return Number(
		clamp(
			args.modelConfidence * args.weights.model +
				args.retrievalProductScore * args.weights.retrieval_product +
				args.ruleModifierScore * args.weights.rule_modifier,
		).toFixed(6),
	)
}

function churnRiskScore(args: {
	lastCustomerMessageAt: Date | null
	buyingStage: BuyingStage
	repeatOrders: number
	lifetimeValue: number
	sentiment: SentimentState
}): number {
	let score = 42

	if (!args.lastCustomerMessageAt) {
		score += 18
	} else {
		const ageHours =
			(Date.now() - args.lastCustomerMessageAt.getTime()) / (1000 * 60 * 60)
		if (ageHours <= 24) score -= 10
		else if (ageHours <= 72) score -= 4
		else if (ageHours <= 168) score += 8
		else score += 16
	}

	if (args.buyingStage === 'consideration' || args.buyingStage === 'intent_to_buy') {
		score -= 10
	}
	if (args.buyingStage === 'payment_pending') score -= 6
	if (args.repeatOrders >= 3) score -= 8
	else if (args.repeatOrders === 0) score += 6
	if (args.lifetimeValue >= 10_000_000) score -= 10
	if (args.sentiment === 'negative') score += 12
	if (args.sentiment === 'positive') score -= 8

	return Math.round(clamp(score, 5, 95))
}

type FlowDecisionPolicyRow = {
	id: string
	app_id: string
	flow_id: string | null
	policy: unknown
	active: boolean | null
	updated_at: Date | null
}

type ConversationSignalRow = {
	id: string
	app_id: string
	conversation_id: string
	flow_id: string | null
	message_id: string | null
	channel_type: string | null
	source: string | null
	intent: string | null
	intent_confidence: number | string | null
	sentiment_state: string | null
	sentiment_transition: string | null
	buying_stage: string | null
	churn_risk_score: number | string | null
	model_confidence: number | string | null
	retrieval_score: number | string | null
	product_match_score: number | string | null
	rule_modifier_score: number | string | null
	overall_confidence: number | string | null
	confidence_band: string | null
	recommended_action: string | null
	route_target: string | null
	requires_approval: boolean | null
	approval_reason: string | null
	persona_id: string | null
	signal_payload: unknown
	created_at: Date | null
}

type PendingHandoverRow = {
	id: string
	status: string | null
}

type DecisionEvaluationSignalRow = {
	intent: string | null
	route_target: string | null
	requires_approval: boolean | null
	churn_risk_score: number | string | null
	sentiment_state: string | null
	expected_intent: string | null
}

export type DecisionEvaluationSummary = {
	total_signals: number
	total_labeled: number
	intent_match_rate: number
	fallback_rate: number
	handover_precision: number
	approval_load_rate: number
	window: {
		from: string
		to: string
	}
	flow_id: string | null
}

export abstract class DecisionEngineService {
	static async getPolicy(
		appId: string,
		flowId?: string | null,
	): Promise<FlowDecisionPolicy> {
		const targetFlowId = flowId && isUuid(flowId) ? flowId : null
		const rows = await prisma.$queryRawUnsafe<FlowDecisionPolicyRow[]>(
			`
				SELECT
					"id",
					"app_id",
					"flow_id",
					"policy",
					"active",
					"updated_at"
				FROM "flow_decision_policies"
				WHERE "app_id" = $1::uuid
				  AND COALESCE("active", true) = true
				  AND ($2::uuid IS NULL OR "flow_id" = $2::uuid OR "flow_id" IS NULL)
				ORDER BY
					CASE WHEN "flow_id" = $2::uuid THEN 0 ELSE 1 END,
					"updated_at" DESC NULLS LAST
				LIMIT 1
			`,
			appId,
			targetFlowId,
		)
		const row = rows[0]
		if (!row) {
			return {
				id: null,
				app_id: appId,
				flow_id: targetFlowId,
				active: true,
				policy: this.mergePolicy(DEFAULT_DECISION_POLICY),
				updated_at: null,
			}
		}

		return {
			id: row.id,
			app_id: row.app_id,
			flow_id: row.flow_id || null,
			active: row.active !== false,
			policy: this.mergePolicy(asRecord(row.policy)),
			updated_at: row.updated_at ? row.updated_at.toISOString() : null,
		}
	}

	static async upsertPolicy(params: {
		appId: string
		flowId?: string | null
		policyPatch: Record<string, unknown>
		active?: boolean
	}) {
		const targetFlowId =
			params.flowId && isUuid(params.flowId) ? params.flowId : null
		const existingRows = await prisma.$queryRawUnsafe<FlowDecisionPolicyRow[]>(
			`
				SELECT "id", "app_id", "flow_id", "policy", "active", "updated_at"
				FROM "flow_decision_policies"
				WHERE "app_id" = $1::uuid
				  AND (
					($2::uuid IS NULL AND "flow_id" IS NULL)
					OR "flow_id" = $2::uuid
				  )
				ORDER BY "updated_at" DESC NULLS LAST
				LIMIT 1
			`,
			params.appId,
			targetFlowId,
		)
		const existing = existingRows[0]
		const mergedPolicy = this.mergePolicy({
			...(existing ? asRecord(existing.policy) : {}),
			...params.policyPatch,
		})
		const nextActive = params.active === undefined ? true : params.active

		if (existing?.id) {
			await prisma.$executeRawUnsafe(
				`
					UPDATE "flow_decision_policies"
					SET
						"policy" = $2::jsonb,
						"active" = $3,
						"updated_at" = NOW()
					WHERE "id" = $1::uuid
				`,
				existing.id,
				JSON.stringify(mergedPolicy),
				nextActive,
			)
		} else {
			await prisma.$executeRawUnsafe(
				`
					INSERT INTO "flow_decision_policies" (
						"id",
						"app_id",
						"flow_id",
						"policy",
						"active",
						"created_at",
						"updated_at"
					)
					VALUES (
						gen_random_uuid(),
						$1::uuid,
						$2::uuid,
						$3::jsonb,
						$4,
						NOW(),
						NOW()
					)
				`,
				params.appId,
				targetFlowId,
				JSON.stringify(mergedPolicy),
				nextActive,
			)
		}

		return this.getPolicy(params.appId, targetFlowId)
	}

	static async evaluateInbound(
		params: EvaluateInboundParams,
	): Promise<DecisionEnvelope> {
		const policyEnvelope = await this.getPolicy(params.appId, params.flowId)
		const policy = policyEnvelope.policy
		const incomingText = String(params.incomingText || '').trim()

		const [conversation, historyRows] = await Promise.all([
			prisma.conversations.findUnique({
				where: { id: params.conversationId },
				select: {
					id: true,
					contact_id: true,
					status: true,
					additional_attributes: true,
					updated_at: true,
				},
			}),
			prisma.messages.findMany({
				where: {
					conversation_id: params.conversationId,
					deleted_at: null,
					OR: [{ is_deleted: false }, { is_deleted: null }],
					sender_type: { in: ['contact', 'bot'] },
				},
				orderBy: { created_at: 'desc' },
				take: 16,
				select: {
					sender_type: true,
					content: true,
					created_at: true,
				},
			}),
		])

		if (!conversation?.id) {
			const fallbackPolicy = this.mergePolicy(policy)
			return {
				intent: 'unknown',
				intent_confidence: 0.2,
				sentiment_state: 'neutral',
				sentiment_transition: 'neutral -> neutral',
				buying_stage: 'awareness',
				churn_risk_score: 50,
				overall_confidence: 0.2,
				confidence_band: 'low',
				recommended_action: fallbackPolicy.not_found_recommended_action,
				requires_approval: true,
				approval_reason: fallbackPolicy.not_found_approval_reason,
				persona_id: null,
				route_target: 'handover',
				model_confidence: 0.2,
				retrieval_score: 0,
				product_match_score: 0,
				rule_modifier_score: 0.2,
				clarification_prompt: fallbackPolicy.not_found_clarification_prompt,
				applied_policy: fallbackPolicy,
				created_at: new Date().toISOString(),
			}
		}

		const additionalAttributes = asRecord(conversation.additional_attributes)
		const decisionLast = asRecord(additionalAttributes.ai_decision_last)
		const aiAnalyticsLast = asRecord(additionalAttributes.ai_analytics_last)
		const flowRuntime = asRecord(additionalAttributes.flow_runtime)
		const flowVars = asRecord(flowRuntime.variables)

		const historicalMessagesAsc = [...historyRows].reverse()
		const customerMessages = historicalMessagesAsc.filter(
			(row) => normalizeText(String(row.sender_type || '')) === 'contact',
		)
		const customerTexts = customerMessages
			.map((row) => asString(row.content))
			.filter((row): row is string => Boolean(row))

		const previousSentiment = asString(decisionLast.sentiment_state)
		const detectedSentimentState = detectSentimentState(
			[...customerTexts.slice(-6), incomingText],
			policy,
		)

		const intentDetection = detectIntentFromText(incomingText, policy)
		const intent = intentDetection.intent
		const intentConfidence = intentDetection.confidence
		const isGreeting = isLikelyGreeting(incomingText)

		const knowledgeResult = await this.safeRetrieval(params.appId, incomingText)
		const retrievalScore = Number(
			clamp(
				knowledgeResult.hitScore > 0
					? knowledgeResult.hitScore / 10
					: knowledgeResult.ragHit
						? 0.62
						: 0.18,
			).toFixed(6),
		)

		const commerceSnapshot = await this.loadCommerceSnapshot({
			appId: params.appId,
			conversationId: params.conversationId,
			contactId: conversation.contact_id,
			incomingText,
		})
		const sentimentState = resolveCommerceSentimentState(
			detectedSentimentState,
			commerceSnapshot.openOrderPhase,
		)
		const sentimentTransition = `${previousSentiment || sentimentState} -> ${sentimentState}`
		const buyingStage = resolveBuyingStage(commerceSnapshot.openOrderPhase)

		const lastCustomerMessageAt =
			customerMessages[customerMessages.length - 1]?.created_at || null
		const churnRisk = churnRiskScore({
			lastCustomerMessageAt,
			buyingStage,
			repeatOrders: commerceSnapshot.repeatOrders,
			lifetimeValue: commerceSnapshot.lifetimeValue,
			sentiment: sentimentState,
		})

		const modelConfidence = normalizeConfidence(
			aiAnalyticsLast.confidence ?? flowVars.last_ai_confidence ?? 0.55,
			0.55,
		)

		const ruleModifierBase = (() => {
			let modifier = 0.65
			if (policy.sensitive_intents.includes(intent)) modifier -= 0.18
			if (sentimentState === 'negative') modifier -= 0.12
			if (sentimentState === 'positive') modifier += 0.08
			if (churnRisk >= 70) modifier -= 0.2
			if (churnRisk <= 30) modifier += 0.06
			if (knowledgeResult.ragHit) modifier += 0.08
			if (
				buyingStage === 'consideration' ||
				buyingStage === 'intent_to_buy' ||
				buyingStage === 'payment_pending'
			) {
				modifier += 0.06
			}
			return clamp(modifier)
		})()

		const retrievalProductScore = Number(
			clamp((retrievalScore + commerceSnapshot.productMatchScore) / 2).toFixed(6),
		)

		const weights = this.normalizeWeights(policy.weights)
		const overallConfidence = computeOverallConfidence({
			modelConfidence,
			retrievalProductScore,
			ruleModifierScore: ruleModifierBase,
			weights,
		})

		const thresholds = this.resolveThresholds(policy, intent)
		const confidenceBand = normalizeConfidenceBand(overallConfidence, thresholds)
		const override = policy.intent_overrides[intent]
		const defaultAction = resolveRecommendedAction(
			intent,
			policy,
			isGreeting ? 'knowledge_reply' : undefined,
		)
		const promptInjectionRisk = detectPromptInjectionRisk(incomingText, policy)
		const { requiresApproval, recommendedAction, routeTarget } =
			resolveDecisionOutcome({
				intent,
				confidenceBand,
				churnRisk,
				sentimentState,
				defaultAction,
				policy,
				overrideRequireApproval: override?.require_approval === true,
				skipLowConfidenceApproval:
					isGreeting ||
					shouldSkipLowConfidenceApproval({
						intent,
						incomingText,
					}),
				policySensitiveActions: policy.sensitive_actions,
				promptInjectionRisk,
			})
		const approvalReason = requiresApproval
			? this.resolveApprovalReason({
					confidenceBand,
					intent,
					churnRisk,
					sentimentState,
					promptInjectionRisk,
					policy,
				})
			: null

		const personaId = await this.resolvePersonaId({
			appId: params.appId,
			intent,
			policy,
		})

		const clarificationPrompt =
			routeTarget === 'clarify' ? policy.clarification_prompt : null

		const envelope: DecisionEnvelope = {
			intent,
			intent_confidence: intentConfidence,
			sentiment_state: sentimentState,
			sentiment_transition: sentimentTransition,
			buying_stage: buyingStage,
			churn_risk_score: churnRisk,
			overall_confidence: overallConfidence,
			confidence_band: confidenceBand,
			recommended_action: recommendedAction,
			requires_approval: requiresApproval,
			approval_reason: approvalReason,
			persona_id: personaId,
			route_target: routeTarget,
			model_confidence: modelConfidence,
			retrieval_score: retrievalScore,
			product_match_score: commerceSnapshot.productMatchScore,
			rule_modifier_score: Number(ruleModifierBase.toFixed(6)),
			clarification_prompt: clarificationPrompt,
			applied_policy: policy,
			created_at: new Date().toISOString(),
		}

		await this.persistConversationSignal({
			appId: params.appId,
			conversationId: params.conversationId,
			flowId: params.flowId,
			messageId: params.messageId || null,
			channelType: params.channelType || null,
			source: params.source || 'inbound',
			envelope,
			knowledgePayload: knowledgeResult.payload,
			productPayload: commerceSnapshot.productMatchMeta,
			conversationAdditionalAttributes: additionalAttributes,
		})

		return envelope
	}

	static async evaluateCommerceEvent(params: {
		appId: string
		conversationId: string
		flowId?: string | null
		event: string
	}): Promise<DecisionEnvelope | null> {
		if (!isUuid(params.conversationId)) return null
		const lastCustomerMessage = await prisma.messages.findFirst({
			where: {
				conversation_id: params.conversationId,
				sender_type: 'contact',
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
			},
			orderBy: { created_at: 'desc' },
			select: {
				id: true,
				content: true,
			},
		})

		const eventText = asString(lastCustomerMessage?.content) || params.event
		return this.evaluateInbound({
			appId: params.appId,
			conversationId: params.conversationId,
			flowId: params.flowId || null,
			messageId: lastCustomerMessage?.id || null,
			channelType: null,
			incomingText: eventText,
			source: 'commerce_event',
		})
	}

	static async listConversationSignals(params: {
		appId: string
		conversationId: string
		limit?: number
	}) {
		const limit = Math.max(1, Math.min(200, Math.floor(params.limit || 50)))
		const rows = await prisma.$queryRawUnsafe<ConversationSignalRow[]>(
			`
				SELECT
					"id",
					"app_id",
					"conversation_id",
					"flow_id",
					"message_id",
					"channel_type",
					"source",
					"intent",
					"intent_confidence",
					"sentiment_state",
					"sentiment_transition",
					"buying_stage",
					"churn_risk_score",
					"model_confidence",
					"retrieval_score",
					"product_match_score",
					"rule_modifier_score",
					"overall_confidence",
					"confidence_band",
					"recommended_action",
					"route_target",
					"requires_approval",
					"approval_reason",
					"persona_id",
					"signal_payload",
					"created_at"
				FROM "conversation_ai_signals"
				WHERE "app_id" = $1::uuid
				  AND "conversation_id" = $2::uuid
				ORDER BY "created_at" DESC
				LIMIT $3
			`,
			params.appId,
			params.conversationId,
			limit,
		)
		return rows.map((row) => this.mapSignalRow(row))
	}

	static async getDecisionEvaluationSummary(params: {
		appId: string
		flowId?: string | null
		from?: string | null
		to?: string | null
		limit?: number
	}): Promise<DecisionEvaluationSummary> {
		const targetFlowId = params.flowId && isUuid(params.flowId) ? params.flowId : null
		const policyEnvelope = await this.getPolicy(params.appId, targetFlowId)
		const toDate = asDate(params.to) || new Date()
		const fromDate = asDate(params.from)
		const resolvedFrom = fromDate || new Date(toDate.getTime() - 7 * 24 * 60 * 60 * 1000)
		const resolvedTo = toDate
		const limit = Math.max(1, Math.min(2000, Math.floor(params.limit || 500)))

		const rows = await prisma.$queryRawUnsafe<DecisionEvaluationSignalRow[]>(
			`
				SELECT
					"intent",
					"route_target",
					"requires_approval",
					"churn_risk_score",
					"sentiment_state",
					NULLIF(TRIM(COALESCE("signal_payload"->>'expected_intent', '')), '') AS "expected_intent"
				FROM "conversation_ai_signals"
				WHERE "app_id" = $1::uuid
				  AND ($2::uuid IS NULL OR "flow_id" = $2::uuid)
				  AND "created_at" >= $3::timestamptz
				  AND "created_at" <= $4::timestamptz
				ORDER BY "created_at" DESC
				LIMIT $5
			`,
			params.appId,
			targetFlowId,
			resolvedFrom.toISOString(),
			resolvedTo.toISOString(),
			limit,
		)

		const sentimentSensitiveIntentsForSummary = collectSentimentSensitiveIntents(
			policyEnvelope.policy.sentiment_sensitive_intents,
		)
		const metrics = computeDecisionEvaluationMetrics({
			signals: rows.map((row) => ({
				intent: row.intent,
				route_target: row.route_target,
				requires_approval: row.requires_approval,
				churn_risk_score: row.churn_risk_score,
				sentiment_state: row.sentiment_state,
			})),
			policy_sensitive_intents: policyEnvelope.policy.sensitive_intents,
			policy_sentiment_sensitive_intents:
				sentimentSensitiveIntentsForSummary.length > 0
					? sentimentSensitiveIntentsForSummary
					: policyEnvelope.policy.sensitive_intents,
			labeledIntents: rows
				.filter((row) => asString(row.expected_intent))
				.map((row) => ({
					predicted_intent: row.intent,
					expected_intent: row.expected_intent,
				})),
		})

		return {
			...metrics,
			window: {
				from: resolvedFrom.toISOString(),
				to: resolvedTo.toISOString(),
			},
			flow_id: targetFlowId,
		}
	}

	static async resolveBestAssignee(params: {
		appId: string
		intent: string | null
		candidateAgentIds?: string[]
	}): Promise<string | null> {
		const candidates = await prisma.users.findMany({
			where: {
				app_id: params.appId,
				active: true,
				deleted_at: null,
				role: { in: CHAT_ASSIGNABLE_ROLES },
				...(Array.isArray(params.candidateAgentIds) &&
				params.candidateAgentIds.length > 0
					? { id: { in: params.candidateAgentIds.filter((id) => isUuid(id)) } }
					: {}),
			},
			select: {
				id: true,
				status: true,
			},
			take: 100,
		})
		if (candidates.length === 0) return null

		const candidateIds = candidates.map((row) => row.id)
		const [availabilityRows, assignmentRows] = await Promise.all([
			prisma.agent_availability.findMany({
				where: {
					app_id: params.appId,
					user_id: { in: candidateIds },
				},
				select: {
					user_id: true,
					skills: true,
					max_conversations: true,
					current_conversations: true,
				},
			}),
			prisma.conversation_agents.groupBy({
				by: ['agent_id'],
				where: {
					agent_id: { in: candidateIds },
					status: 'active',
				},
				_count: { agent_id: true },
			}),
		])
		const availabilityById = new Map(availabilityRows.map((row) => [row.user_id, row]))
		const activeCountById = new Map(
			assignmentRows.map((row) => [row.agent_id || '', row._count.agent_id]),
		)
		const intentKeyword = normalizeText(params.intent || '')

		const scored = candidates.map((candidate) => {
			const availability = availabilityById.get(candidate.id)
			const skills = Array.isArray(availability?.skills)
				? availability?.skills.map((item) => normalizeText(String(item || '')))
				: []
			const skillMatched =
				intentKeyword.length > 0 &&
				skills.some((skill) => skill.includes(intentKeyword))
			const skillScore = skillMatched ? 1 : skills.length === 0 ? 0.4 : 0.2
			const capacity = Math.max(1, Number(availability?.max_conversations || 5))
			const activeChats = Number(
				activeCountById.get(candidate.id) ??
					availability?.current_conversations ??
					0,
			)
			const loadScore = clamp(1 - activeChats / capacity)
			const onlineScore =
				normalizeText(String(candidate.status || '')) === 'online' ? 1 : 0.6
			const finalScore = skillScore * 0.5 + loadScore * 0.3 + onlineScore * 0.2
			return {
				agentId: candidate.id,
				score: Number(finalScore.toFixed(6)),
			}
		})
		scored.sort((a, b) => b.score - a.score)
		return scored[0]?.agentId || null
	}

	private static resolveApprovalReason(args: {
		confidenceBand: ConfidenceBand
		intent: DecisionIntent
		churnRisk: number
		sentimentState: SentimentState
		promptInjectionRisk?: boolean
		policy?: DecisionPolicy
	}): string {
		const reasons: string[] = []
		if (args.confidenceBand === 'low') {
			reasons.push(
				args.policy?.approval_reasons.low_confidence ||
					DEFAULT_APPROVAL_REASON_TEMPLATES.low_confidence,
			)
		}
		const intentReason =
			(args.policy?.approval_reasons.intent?.[args.intent] || DEFAULT_APPROVAL_REASON_TEMPLATES.intent[args.intent])
		if (intentReason) reasons.push(intentReason)
		if (args.churnRisk >= 70) {
			reasons.push(
				args.policy?.approval_reasons.high_churn_risk ||
					DEFAULT_APPROVAL_REASON_TEMPLATES.high_churn_risk,
			)
		}
		if (args.sentimentState === 'negative') {
			reasons.push(
				args.policy?.approval_reasons.negative_sentiment ||
					DEFAULT_APPROVAL_REASON_TEMPLATES.negative_sentiment,
			)
		}
		if (args.promptInjectionRisk === true) {
			reasons.push(
				args.policy?.approval_reasons.prompt_injection_risk ||
					DEFAULT_APPROVAL_REASON_TEMPLATES.prompt_injection_risk,
			)
		}
		return reasons.join('; ')
	}

	private static normalizeWeights(input: DecisionPolicy['weights']) {
		const model = clamp(toSafeNumber(input.model, 0.55))
		const retrievalProduct = clamp(toSafeNumber(input.retrieval_product, 0.25))
		const ruleModifier = clamp(toSafeNumber(input.rule_modifier, 0.2))
		const total = model + retrievalProduct + ruleModifier
		if (total <= 0) {
			return {
				model: 0.55,
				retrieval_product: 0.25,
				rule_modifier: 0.2,
			}
		}
		return {
			model: Number((model / total).toFixed(6)),
			retrieval_product: Number((retrievalProduct / total).toFixed(6)),
			rule_modifier: Number((ruleModifier / total).toFixed(6)),
		}
	}

	private static resolveThresholds(
		policy: DecisionPolicy,
		intent: DecisionIntent,
	): DecisionPolicyThreshold {
		const override = policy.intent_overrides[intent]
		return normalizeThresholdPair(
			override?.high,
			override?.medium,
			policy.thresholds,
		)
	}

	private static mergePolicy(input: unknown): DecisionPolicy {
		const source = asRecord(input)
		const defaultPolicy = DEFAULT_DECISION_POLICY
		const thresholdsSource = asRecord(source.thresholds)
		const approvalSource = asRecord(source.approval)
		const assignmentSource = asRecord(source.assignment)
		const weightsSource = asRecord(source.weights)
		const sentimentKeywordsSource = asRecord(source.sentiment_keywords)
		const intentKeywordsSource = asRecord(source.intent_keywords)
		const sentimentPolicy = asRecord(source.sentiment_sensitive_intents)
		const approvalReasonsSource = asRecord(source.approval_reasons)
		const recommendedActionsSource = asRecord(source.intent_recommended_actions)

		const intentOverridesRaw = asRecord(source.intent_overrides)
		const intentOverrides: Partial<
			Record<DecisionIntent, DecisionPolicyIntentOverride>
		> = {}
			const intentKeys = DECISION_INTENT_KEYS
		for (const key of intentKeys) {
			const row = asRecord(intentOverridesRaw[key])
			if (Object.keys(row).length === 0) continue
			intentOverrides[key] = {
				high:
					row.high === undefined ? undefined : clamp(toSafeNumber(row.high, 0.75)),
				medium:
					row.medium === undefined
						? undefined
						: clamp(toSafeNumber(row.medium, 0.55)),
				require_approval:
					typeof row.require_approval === 'boolean'
						? row.require_approval
						: undefined,
				persona_id:
					typeof row.persona_id === 'string' ? row.persona_id : undefined,
			}
		}

		const intentPersonaMapRaw = asRecord(source.intent_persona_map)
		const intentPersonaMap: Partial<Record<DecisionIntent, string>> = {}
		for (const key of intentKeys) {
			const value = asString(intentPersonaMapRaw[key])
			if (value) intentPersonaMap[key] = value
		}

		const sentimentKeywords: DecisionPolicy['sentiment_keywords'] = {
			positive:
				normalizeKeywordList(sentimentKeywordsSource.positive).length > 0
					? normalizeKeywordList(sentimentKeywordsSource.positive)
					: defaultPolicy.sentiment_keywords.positive,
			negative:
				normalizeKeywordList(sentimentKeywordsSource.negative).length > 0
					? normalizeKeywordList(sentimentKeywordsSource.negative)
					: defaultPolicy.sentiment_keywords.negative,
		}

		const intentKeywords: DecisionPolicy['intent_keywords'] = {
			inquiry_general: INTENT_KEYWORDS.inquiry_general,
			pricing_request: INTENT_KEYWORDS.pricing_request,
			product_lookup: INTENT_KEYWORDS.product_lookup,
			stock_check: INTENT_KEYWORDS.stock_check,
			variant_match: INTENT_KEYWORDS.variant_match,
			order_intent: INTENT_KEYWORDS.order_intent,
			complaint: INTENT_KEYWORDS.complaint,
			handover_request: INTENT_KEYWORDS.handover_request,
			churn_signal: INTENT_KEYWORDS.churn_signal,
			unknown: INTENT_KEYWORDS.unknown,
		}
		for (const key of intentKeys) {
			const keywordList = normalizeKeywordList(intentKeywordsSource[key])
			if (keywordList.length > 0) {
				intentKeywords[key] = keywordList
			}
		}

		const normalizedSensitiveIntents = (
			Array.isArray(source.sensitive_intents)
				? source.sensitive_intents
				: defaultPolicy.sensitive_intents
		)
			.map((intent) => normalizeDecisionIntent(intent))
			.filter((intent): intent is DecisionIntent => Boolean(intent))
			.filter((intent, index, all) => all.indexOf(intent) === index)

		const sentimentSensitiveIntents: Partial<
			Record<SentimentState, DecisionIntent[]>
		> = {}
		for (const state of ['positive', 'neutral', 'negative'] as SentimentState[]) {
			const rawStateIntents = normalizeKeywordList(
				asRecord(sentimentPolicy)[state] as unknown,
			)
			const resolved = rawStateIntents
				.map((intent) => normalizeDecisionIntent(intent))
				.filter((intent): intent is DecisionIntent => Boolean(intent))
			sentimentSensitiveIntents[state] = Array.from(
				new Set(resolved.map((intent) => intent)),
			)
			}
			if (!sentimentSensitiveIntents.negative || sentimentSensitiveIntents.negative.length === 0) {
				sentimentSensitiveIntents.negative = [
					...(defaultPolicy.sentiment_sensitive_intents.negative || []),
				]
			}

		const intentRecommendations: Partial<Record<DecisionIntent, DecisionRecommendedAction>> = {}
		for (const key of intentKeys) {
			const resolved = normalizeDecisionAction(recommendedActionsSource[key])
			if (resolved) {
				intentRecommendations[key] = resolved
			}
		}

		const approvalReasons: DecisionPolicy['approval_reasons'] = {
			low_confidence:
				asString(approvalReasonsSource.low_confidence) ||
				defaultPolicy.approval_reasons.low_confidence,
			high_churn_risk:
				asString(approvalReasonsSource.high_churn_risk) ||
				defaultPolicy.approval_reasons.high_churn_risk,
			negative_sentiment:
				asString(approvalReasonsSource.negative_sentiment) ||
				defaultPolicy.approval_reasons.negative_sentiment,
			prompt_injection_risk:
				asString(approvalReasonsSource.prompt_injection_risk) ||
				defaultPolicy.approval_reasons.prompt_injection_risk,
			intent: {},
		}
		const approvalReasonsIntentSource = asRecord(approvalReasonsSource.intent)
		for (const key of intentKeys) {
			const reason = asString(approvalReasonsIntentSource[key])
			if (reason) {
				approvalReasons.intent[key] = reason
			} else if (defaultPolicy.approval_reasons.intent[key]) {
				approvalReasons.intent[key] = defaultPolicy.approval_reasons.intent[key]
			}
		}

		const promptInjectionKeywords = Array.isArray(source.prompt_injection_keywords)
			? normalizeKeywordList(source.prompt_injection_keywords)
			: defaultPolicy.prompt_injection_keywords
		const sensitiveActions = Array.isArray(source.sensitive_actions)
			? source.sensitive_actions
					.map((value) => String(value || '').trim())
					.filter((value) => value.length > 0)
			: defaultPolicy.sensitive_actions

		const escalationMinutesRaw = Array.isArray(approvalSource.escalation_minutes)
			? approvalSource.escalation_minutes
			: defaultPolicy.approval.escalation_minutes
		const escalationMinutes = escalationMinutesRaw
			.map((value) => Math.max(1, Math.round(toSafeNumber(value, 0))))
			.filter((value) => Number.isFinite(value))

		const normalizedThresholds = normalizeThresholdPair(
			thresholdsSource.high,
			thresholdsSource.medium,
			defaultPolicy.thresholds,
		)

		return {
			thresholds: normalizedThresholds,
			intent_overrides: intentOverrides,
			intent_persona_map: intentPersonaMap,
			intent_keywords: intentKeywords,
			sentiment_keywords: sentimentKeywords,
			prompt_injection_keywords:
				promptInjectionKeywords.length > 0
					? promptInjectionKeywords
					: defaultPolicy.prompt_injection_keywords,
			intent_recommended_actions: {
				...DEFAULT_INTENT_RECOMMENDED_ACTIONS,
				...intentRecommendations,
			},
			sensitive_intents: Array.from(new Set(normalizedSensitiveIntents)),
			sentiment_sensitive_intents: sentimentSensitiveIntents,
			approval_reasons: approvalReasons,
			clarification_prompt:
				asString(source.clarification_prompt) ||
				defaultPolicy.clarification_prompt,
			not_found_approval_reason:
				asString(source.not_found_approval_reason) ||
				defaultPolicy.not_found_approval_reason,
			not_found_clarification_prompt:
				asString(source.not_found_clarification_prompt) ||
				defaultPolicy.not_found_clarification_prompt,
			not_found_recommended_action:
				normalizeDecisionAction(source.not_found_recommended_action) ||
				defaultPolicy.not_found_recommended_action,
			sensitive_actions: sensitiveActions,
			approval: {
				mode: 'always_approval',
				escalation_minutes:
					escalationMinutes.length > 0
						? escalationMinutes
						: defaultPolicy.approval.escalation_minutes,
				triage_status_on_timeout:
					asString(approvalSource.triage_status_on_timeout) ||
					defaultPolicy.approval.triage_status_on_timeout,
			},
			assignment: {
				strategy:
					asString(assignmentSource.strategy) === 'skill_load_sla'
						? 'skill_load_sla'
						: defaultPolicy.assignment.strategy,
			},
			weights: {
				model: clamp(toSafeNumber(weightsSource.model, defaultPolicy.weights.model)),
				retrieval_product: clamp(
					toSafeNumber(
						weightsSource.retrieval_product,
						defaultPolicy.weights.retrieval_product,
					),
				),
				rule_modifier: clamp(
					toSafeNumber(
						weightsSource.rule_modifier,
						defaultPolicy.weights.rule_modifier,
					),
				),
			},
		}
	}

	private static async safeRetrieval(appId: string, incomingText: string) {
		try {
			const retrieval = await KnowledgeService.retrievalTest(appId, {
				query: incomingText,
				topK: 5,
				channel: 'live',
			})
			const bestScore = Math.max(
				0,
				...retrieval.topChunks.map((chunk) => Number(chunk.score || 0)),
			)
			return {
				ragHit: retrieval.ragHit,
				hitScore: bestScore,
				payload: {
					query_log_id: retrieval.queryLogId,
					grounded_sources: retrieval.groundedSources,
					top_chunks: retrieval.topChunks,
					answer: retrieval.answer,
				},
			}
		} catch (error) {
			return {
				ragHit: false,
				hitScore: 0,
				payload: {
					error: error instanceof Error ? error.message : 'retrieval_failed',
				},
			}
		}
	}

	private static async loadCommerceSnapshot(_params: {
		appId: string
		conversationId: string
		contactId: string | null
		incomingText: string
	}): Promise<CommerceSnapshot> {
		return {
			openOrderPhase: null,
			repeatOrders: 0,
			lifetimeValue: 0,
			productMatchScore: 0,
			productMatchMeta: {},
		}
	}
	private static async resolvePersonaId(params: {
		appId: string
		intent: DecisionIntent
		policy: DecisionPolicy
	}) {
		const intentMappedPersonaId = params.policy.intent_persona_map[params.intent]
		if (intentMappedPersonaId && isUuid(intentMappedPersonaId)) {
			return intentMappedPersonaId
		}

		const overridePersonaId = params.policy.intent_overrides[params.intent]?.persona_id
		if (overridePersonaId && isUuid(overridePersonaId)) {
			return overridePersonaId
		}

		const persona = await prisma.ai_playground_personas.findFirst({
			where: {
				app_id: params.appId,
				is_default: true,
			},
			orderBy: [{ sort_order: 'asc' }, { updated_at: 'desc' }],
			select: { id: true },
		})
		return persona?.id || null
	}

	private static mapSignalRow(row: ConversationSignalRow): ConversationAISignal {
		const intentRaw = asString(row.intent)
		const validIntent = normalizeDecisionIntent(intentRaw) || 'unknown'
		const sentiment = asString(row.sentiment_state)
		const sentimentState: SentimentState =
			sentiment === 'positive' || sentiment === 'negative' || sentiment === 'neutral'
				? sentiment
				: 'neutral'
		const band = asString(row.confidence_band)
		const confidenceBand: ConfidenceBand =
			band === 'high' || band === 'medium' || band === 'low' ? band : 'low'
		const route = asString(row.route_target)
		const routeTarget: DecisionRouteTarget =
			route === 'workflow' || route === 'clarify' || route === 'handover'
				? route
				: 'handover'
		const recommended = asString(row.recommended_action)
		const validRecommendedActions = new Set<DecisionRecommendedAction>([
			'knowledge_reply',
			'list_products',
			'product_detail',
			'stock_check',
			'variant_match',
			'order_assist',
			'retain_customer',
			'clarify_need',
			'handover_pending_approval',
		])
		const recommendedAction: DecisionRecommendedAction =
			recommended && validRecommendedActions.has(recommended as DecisionRecommendedAction)
				? (recommended as DecisionRecommendedAction)
				: 'handover_pending_approval'
		const buyingStageRaw = asString(row.buying_stage)
		const buyingStage: BuyingStage =
			buyingStageRaw === 'awareness' ||
			buyingStageRaw === 'consideration' ||
			buyingStageRaw === 'intent_to_buy' ||
			buyingStageRaw === 'payment_pending' ||
			buyingStageRaw === 'purchased'
				? buyingStageRaw
				: 'awareness'

		return {
			id: row.id,
			app_id: row.app_id,
			conversation_id: row.conversation_id,
			flow_id: row.flow_id,
			message_id: row.message_id,
			channel_type: row.channel_type,
			source: row.source,
			intent: validIntent,
			intent_confidence: normalizeConfidence(row.intent_confidence, 0),
			sentiment_state: sentimentState,
			sentiment_transition: asString(row.sentiment_transition) || 'neutral -> neutral',
			buying_stage: buyingStage,
			churn_risk_score: Math.max(
				0,
				Math.round(toSafeNumber(row.churn_risk_score, 0)),
			),
			model_confidence: normalizeConfidence(row.model_confidence, 0),
			retrieval_score: normalizeConfidence(row.retrieval_score, 0),
			product_match_score: normalizeConfidence(row.product_match_score, 0),
			rule_modifier_score: normalizeConfidence(row.rule_modifier_score, 0),
			overall_confidence: normalizeConfidence(row.overall_confidence, 0),
			confidence_band: confidenceBand,
			recommended_action: recommendedAction,
			route_target: routeTarget,
			requires_approval: row.requires_approval === true,
			approval_reason: asString(row.approval_reason),
			persona_id: row.persona_id,
			signal_payload: asRecord(row.signal_payload),
			created_at:
				(asDate(row.created_at) || new Date()).toISOString(),
		}
	}

	private static async persistConversationSignal(params: {
		appId: string
		conversationId: string
		flowId: string | null
		messageId: string | null
		channelType: string | null
		source: string
		envelope: DecisionEnvelope
		knowledgePayload: Record<string, unknown>
		productPayload: Record<string, unknown>
		conversationAdditionalAttributes: Record<string, unknown>
	}) {
		const payload = {
			knowledge: params.knowledgePayload,
			products: params.productPayload,
			decision: params.envelope,
		}
		await prisma.$executeRawUnsafe(
			`
				INSERT INTO "conversation_ai_signals" (
					"id",
					"app_id",
					"conversation_id",
					"flow_id",
					"message_id",
					"channel_type",
					"source",
					"intent",
					"intent_confidence",
					"sentiment_state",
					"sentiment_transition",
					"buying_stage",
					"churn_risk_score",
					"model_confidence",
					"retrieval_score",
					"product_match_score",
					"rule_modifier_score",
					"overall_confidence",
					"confidence_band",
					"recommended_action",
					"route_target",
					"requires_approval",
					"approval_reason",
					"persona_id",
					"signal_payload",
					"created_at",
					"updated_at"
				)
				VALUES (
					gen_random_uuid(),
					$1::uuid,
					$2::uuid,
					$3::uuid,
					$4::uuid,
					$5,
					$6,
					$7,
					$8,
					$9,
					$10,
					$11,
					$12,
					$13,
					$14,
					$15,
					$16,
					$17,
					$18,
					$19,
					$20,
					$21,
					$22,
					$23::uuid,
					$24::jsonb,
					NOW(),
					NOW()
				)
			`,
			params.appId,
			params.conversationId,
			params.flowId && isUuid(params.flowId) ? params.flowId : null,
			params.messageId && isUuid(params.messageId) ? params.messageId : null,
			params.channelType,
			params.source,
			params.envelope.intent,
			params.envelope.intent_confidence,
			params.envelope.sentiment_state,
			params.envelope.sentiment_transition,
			params.envelope.buying_stage,
			params.envelope.churn_risk_score,
			params.envelope.model_confidence,
			params.envelope.retrieval_score,
			params.envelope.product_match_score,
			params.envelope.rule_modifier_score,
			params.envelope.overall_confidence,
			params.envelope.confidence_band,
			params.envelope.recommended_action,
			params.envelope.route_target,
			params.envelope.requires_approval,
			params.envelope.approval_reason,
			params.envelope.persona_id && isUuid(params.envelope.persona_id)
				? params.envelope.persona_id
				: null,
			JSON.stringify(payload),
		)

		const aiAnalytics = buildAiAnalytics({
			confidence: params.envelope.overall_confidence,
			intent: params.envelope.intent,
			workflowId: params.flowId,
			ragIntent:
				params.envelope.recommended_action === 'knowledge_reply'
					? params.envelope.intent
					: null,
			updatedAt: new Date(),
		})
		const nextAdditionalAttributes = {
			...params.conversationAdditionalAttributes,
			ai_decision_last: params.envelope,
			ai_decision_policy: params.envelope.applied_policy,
			ai_decision_updated_at: new Date().toISOString(),
			...(aiAnalytics ? { ai_analytics_last: aiAnalytics } : {}),
		}

		await prisma.conversations.update({
			where: { id: params.conversationId },
			data: {
				additional_attributes: nextAdditionalAttributes as any,
				updated_at: new Date(),
			},
		})
	}

	static async getLatestPendingHandoverRequest(params: {
		appId: string
		conversationId: string
	}) {
		const rows = await prisma.$queryRawUnsafe<PendingHandoverRow[]>(
			`
				SELECT "id", "status"
				FROM "handover_requests"
				WHERE "app_id" = $1::uuid
				  AND "conversation_id" = $2::uuid
				  AND "status" = 'pending'
				ORDER BY "created_at" DESC NULLS LAST
				LIMIT 1
			`,
			params.appId,
			params.conversationId,
		)
		return rows[0] || null
	}
}

export const __test__ = {
	clamp,
	normalizeThresholdPair,
	normalizeConfidenceBand,
	resolveBuyingStage,
	resolveCommerceSentimentState,
	detectSentimentState,
	detectIntentFromText,
	detectPromptInjectionRisk,
	shouldSkipLowConfidenceApproval,
	churnRiskScore,
	resolveRecommendedAction,
	resolveDecisionOutcome,
	computeDecisionEvaluationMetrics,
	computeOverallConfidence,
}
