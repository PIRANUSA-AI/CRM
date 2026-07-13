export type ConversationAiAnalytics = {
	confidence: number | null
	intent: string | null
	workflow_id: string | null
	workflow_name: string | null
	rag_label: string | null
	rag_intent: string | null
	updated_at: string
}

type NormalizeOptions = {
	workflowNameById?: Map<string, string>
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

function asNullableDate(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value
	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value)
		if (!Number.isNaN(parsed.getTime())) return parsed
	}
	return null
}

function toIsoDate(value: unknown): string {
	return (asNullableDate(value) || new Date()).toISOString()
}

function normalizeConfidence(value: unknown): number | null {
	if (value === null || value === undefined) return null
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return null

	const normalized =
		parsed > 1 && parsed <= 100 ? Number((parsed / 100).toFixed(4)) : parsed

	const clamped = Math.max(0, Math.min(1, normalized))
	return Number(clamped.toFixed(4))
}

function buildRagLabelFromReferences(value: unknown): string | null {
	if (!Array.isArray(value)) return null
	const refs = value
		.map((item) => asRecord(item))
		.filter((item) => Object.keys(item).length > 0)
	const first = refs[0]
	if (!first) return null

	const firstTitle = asString(first.title) || asString(first.id)
	if (!firstTitle) return null
	if (refs.length <= 1) return firstTitle
	return `${firstTitle} +${refs.length - 1}`
}

export function buildAiAnalytics(params: {
	confidence?: unknown
	intent?: unknown
	workflowId?: unknown
	workflowName?: unknown
	ragLabel?: unknown
	ragIntent?: unknown
	knowledgeReferences?: unknown
	updatedAt?: unknown
}): ConversationAiAnalytics | null {
	const confidence = normalizeConfidence(params.confidence)
	const ragIntent = asString(params.ragIntent)
	const intent = asString(params.intent) || ragIntent
	const workflowId = asString(params.workflowId)
	const workflowName = asString(params.workflowName)
	const ragLabel =
		asString(params.ragLabel) ||
		buildRagLabelFromReferences(params.knowledgeReferences) ||
		ragIntent

	const hasAnyData = Boolean(
		confidence !== null ||
			intent ||
			workflowId ||
			workflowName ||
			ragLabel ||
			ragIntent,
	)
	if (!hasAnyData) return null

	return {
		confidence,
		intent: intent || null,
		workflow_id: workflowId || null,
		workflow_name: workflowName || null,
		rag_label: ragLabel || null,
		rag_intent: ragIntent || null,
		updated_at: toIsoDate(params.updatedAt),
	}
}

function resolveContactIntent(contact: Record<string, unknown>): string | null {
	const metadata = asRecord(contact.metadata)
	const meta = asRecord(contact.meta)
	return (
		asString(metadata.intent) ||
		asString(metadata.last_intent) ||
		asString(meta.intent) ||
		asString(meta.last_intent)
	)
}

function resolveWorkflowName(
	workflowId: string | null,
	explicitName: string | null,
	options?: NormalizeOptions,
) {
	if (explicitName) return explicitName
	if (!workflowId) return null
	const mapped = options?.workflowNameById?.get(workflowId)
	return mapped ? mapped : null
}

export function normalizeAiAnalytics(
	value: unknown,
	options?: NormalizeOptions,
): ConversationAiAnalytics | null {
	const record = asRecord(value)
	if (Object.keys(record).length === 0) return null

	const workflowId =
		asString(record.workflow_id) ||
		asString(record.workflowId) ||
		asString(record.flow_id) ||
		null
	const workflowName = resolveWorkflowName(
		workflowId,
		asString(record.workflow_name) || asString(record.workflowName),
		options,
	)

	return buildAiAnalytics({
		confidence: record.confidence,
		intent: record.intent,
		workflowId,
		workflowName,
		ragLabel: record.rag_label || record.ragLabel,
		ragIntent: record.rag_intent || record.ragIntent,
		knowledgeReferences:
			record.ai_knowledge_references || record.knowledge_references,
		updatedAt: record.updated_at || record.updatedAt,
	})
}

export function deriveAiAnalyticsFromConversation(params: {
	conversation: Record<string, unknown>
	options?: NormalizeOptions
}): ConversationAiAnalytics | null {
	const conversation = params.conversation
	const options = params.options
	const additionalAttributes = asRecord(conversation.additional_attributes)
	const directFromConversation = normalizeAiAnalytics(
		additionalAttributes.ai_analytics_last,
		options,
	)
	if (directFromConversation) return directFromConversation

	const contact = asRecord(conversation.contacts)
	const contactIntent = resolveContactIntent(contact)
	const flowRuntime = asRecord(additionalAttributes.flow_runtime)
	const flowRuntimeVars = asRecord(flowRuntime.variables)
	const fallbackWorkflowId = asString(flowRuntime.flow_id)

	const messages = Array.isArray(conversation.messages)
		? (conversation.messages as Array<Record<string, unknown>>)
		: []

	for (const message of messages) {
		const contentAttributes = asRecord(message.content_attributes)
		const nested = normalizeAiAnalytics(contentAttributes.ai_analytics, options)
		if (nested) return nested

		const legacy = buildAiAnalytics({
			confidence:
				contentAttributes.ai_confidence ??
				contentAttributes.last_ai_confidence ??
				flowRuntimeVars.last_ai_confidence,
			intent:
				contentAttributes.intent || contentAttributes.rag_intent || contactIntent,
			workflowId:
				contentAttributes.workflow_id ||
				contentAttributes.workflowId ||
				contentAttributes.flow_id ||
				fallbackWorkflowId,
			workflowName:
				contentAttributes.workflow_name || contentAttributes.workflowName,
			ragLabel: contentAttributes.rag_label || contentAttributes.ragLabel,
			ragIntent: contentAttributes.rag_intent || contentAttributes.ragIntent,
			knowledgeReferences:
				contentAttributes.ai_knowledge_references ||
				contentAttributes.knowledge_references,
			updatedAt:
				message.created_at || conversation.updated_at || conversation.created_at,
		})

		const normalizedLegacy = normalizeAiAnalytics(legacy, options)
		if (normalizedLegacy) return normalizedLegacy
	}

	const fallback = buildAiAnalytics({
		confidence: flowRuntimeVars.last_ai_confidence,
		intent: contactIntent,
		workflowId: fallbackWorkflowId,
		ragIntent:
			asString(additionalAttributes.last_rag_intent) ||
			asString(additionalAttributes.rag_intent),
		updatedAt: conversation.updated_at || conversation.created_at,
	})

	return normalizeAiAnalytics(fallback, options)
}
