import { aiProcessingQueue } from '../../lib/queue'
import prisma from '../../lib/prisma'
import { isUuid } from '../../lib/utils'
import type { CanonicalRole } from '../../lib/require-role'
import { TaskAnalyzer, type TaskAnalysisDecision } from './analyzer'
import type { TaskActor } from './policy'
import { TaskService } from './service'

const TASK_ANALYSIS_ATTEMPTS = Math.max(
	1,
	Math.min(5, Number(process.env.TASK_ANALYSIS_ATTEMPTS || 3)),
)
const TASK_ANALYSIS_BACKOFF_MS = Math.max(
	1_000,
	Math.min(60_000, Number(process.env.TASK_ANALYSIS_BACKOFF_MS || 2_000)),
)
const TASK_ANALYSIS_MIN_CONFIDENCE = Math.max(
	0,
	Math.min(1, Number(process.env.TASK_ANALYSIS_MIN_CONFIDENCE || 0.7)),
)
const TASK_ANALYSIS_REVIEW_CONFIDENCE = Math.max(
	0,
	Math.min(
		TASK_ANALYSIS_MIN_CONFIDENCE,
		Number(process.env.TASK_ANALYSIS_REVIEW_CONFIDENCE || 0.5),
	),
)

export const TASK_ANALYSIS_CONCURRENCY = Math.max(
	1,
	Math.min(10, Number(process.env.TASK_ANALYSIS_CONCURRENCY || 3)),
)

// Escalating read window: analyze the most recent messages first, then widen to
// more history only when the first pass is an uncertain "ignore". Keeps the
// common case cheap while still catching leads buried deeper in the thread.
const TASK_ANALYSIS_WINDOW_INITIAL = Math.max(
	1,
	Math.min(200, Number(process.env.TASK_ANALYSIS_WINDOW_INITIAL || 25)),
)
const TASK_ANALYSIS_WINDOW_MAX = Math.max(
	TASK_ANALYSIS_WINDOW_INITIAL,
	Math.min(200, Number(process.env.TASK_ANALYSIS_WINDOW_MAX || 50)),
)
const PRODUCT_CONTEXT_MAX_CHARS = 4_000
const PRODUCT_CONTEXT_MAX_SNIPPETS = 5

export type TaskAnalysisJobData = {
	appId: string
	messageId: string
	ownerUserId?: string
}

function normalizedText(value: unknown) {
	return String(value || '').trim()
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function tokenize(value: string) {
	return [
		...new Set(
			value
				.toLowerCase()
				.replace(/[^a-z0-9\p{L}\p{N}\s]/gu, ' ')
				.split(/\s+/)
				.filter((word) => word.length >= 3),
		),
	]
}

// Product-awareness for the classifier via keyword retrieval only (no
// embeddings) so it degrades gracefully when the embedding provider is down.
// Returns '' when the knowledge base is empty or nothing matches, in which case
// the analyzer simply runs without product context.
async function buildProductContext(appId: string, query: string) {
	const queryTokens = tokenize(query)
	if (!queryTokens.length) return ''
	const [faqs, chunks] = await Promise.all([
		prisma.knowledge_faqs.findMany({
			where: { app_id: appId, is_active: true },
			orderBy: [{ priority: 'desc' }, { updated_at: 'desc' }],
			take: 100,
			select: { question: true, answer: true, keywords: true },
		}),
		prisma.knowledge_chunks.findMany({
			where: { app_id: appId },
			orderBy: { updated_at: 'desc' },
			take: 160,
			select: { chunk_text: true, locator_label: true },
		}),
	])
	const candidates = [
		...faqs.map((faq) => ({
			label: faq.question,
			text: `Q: ${faq.question}\nA: ${faq.answer}${
				faq.keywords.length ? `\nKata kunci: ${faq.keywords.join(', ')}` : ''
			}`,
		})),
		...chunks.map((chunk) => ({
			label: chunk.locator_label || 'Knowledge',
			text: normalizedText(chunk.chunk_text),
		})),
	]
		.filter((item) => item.text.length > 0)
		.map((item) => {
			const haystack = item.text.toLowerCase()
			const score = queryTokens.reduce(
				(total, token) => total + (haystack.includes(token) ? 1 : 0),
				0,
			)
			return { ...item, score }
		})
		.filter((item) => item.score > 0)
		.sort((a, b) => b.score - a.score)
		.slice(0, PRODUCT_CONTEXT_MAX_SNIPPETS)
	if (!candidates.length) return ''

	let context = ''
	for (const candidate of candidates) {
		const block = `- ${candidate.label}: ${candidate.text}`.slice(0, 1_200)
		if (context.length + block.length + 1 > PRODUCT_CONTEXT_MAX_CHARS) break
		context += (context ? '\n' : '') + block
	}
	return context
}

function withHumanReview(
	decision: TaskAnalysisDecision,
): TaskAnalysisDecision | null {
	if (decision.action === 'ignore') return null
	if (decision.confidence < TASK_ANALYSIS_REVIEW_CONFIDENCE) return null
	if (
		decision.confidence < TASK_ANALYSIS_MIN_CONFIDENCE ||
		decision.safetyFlags.length > 0
	) {
		return {
			...decision,
			action: 'handover_review',
			priority: 'high',
			suggestedReply: null,
		}
	}
	return decision
}

export async function enqueueTaskAnalysis(data: TaskAnalysisJobData) {
	if (!isUuid(data.appId) || !isUuid(data.messageId)) return null
	// BullMQ custom IDs cannot contain ':'. Keep this deterministic so the
	// webhook and lead-confirmation paths remain idempotent.
	const jobId = `task-analysis-${data.messageId}`
	try {
		return await aiProcessingQueue.add('task-analysis', data, {
			jobId,
			attempts: TASK_ANALYSIS_ATTEMPTS,
			backoff: { type: 'exponential', delay: TASK_ANALYSIS_BACKOFF_MS },
			removeOnComplete: 2000,
			removeOnFail: 2000,
		})
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error)
		if (message.includes('already exists') && message.includes(jobId)) return null
		throw error
	}
}

export async function processTaskAnalysisJob(data: TaskAnalysisJobData) {
	if (!isUuid(data.appId) || !isUuid(data.messageId)) {
		return { skipped: true, reason: 'invalid_job_payload' }
	}

	const message = await prisma.messages.findFirst({
		where: {
			id: data.messageId,
			app_id: data.appId,
			message_type: 'incoming',
			deleted_at: null,
		},
		select: {
			id: true,
			conversation_id: true,
			content: true,
			content_type: true,
		},
	})
	if (!message?.conversation_id) {
		return { skipped: true, reason: 'message_not_eligible' }
	}

	const latestContent = normalizedText(message.content)
	if (!latestContent || String(message.content_type || 'text').toLowerCase() !== 'text') {
		return { skipped: true, reason: 'message_without_text' }
	}

	const conversation = await prisma.conversations.findFirst({
		where: {
			id: message.conversation_id,
			app_id: data.appId,
			deleted_at: null,
			status: 'open',
		},
		select: {
			id: true,
			contact_id: true,
			assignee_id: true,
			team_id: true,
			additional_attributes: true,
			contacts: { select: { name: true } },
		},
	})
	if (!conversation) return { skipped: true, reason: 'conversation_not_open' }

	const latestInbound = await prisma.messages.findFirst({
		where: {
			conversation_id: conversation.id,
			app_id: data.appId,
			message_type: 'incoming',
			deleted_at: null,
		},
		select: { id: true },
		orderBy: { created_at: 'desc' },
	})
	if (latestInbound?.id !== message.id) {
		return { skipped: true, reason: 'newer_inbound_exists' }
	}

	const personalMetadata = asRecord(
		asRecord(conversation.additional_attributes).personal_whatsapp,
	)
	const persistedOwnerUserId = normalizedText(personalMetadata.owner_user_id) || undefined
	if (
		data.ownerUserId &&
		persistedOwnerUserId &&
		data.ownerUserId !== persistedOwnerUserId
	) {
		return { skipped: true, reason: 'personal_owner_mismatch' }
	}
	const ownerUserId = data.ownerUserId || persistedOwnerUserId
	if (ownerUserId) {
		if (!isUuid(ownerUserId)) {
			return { skipped: true, reason: 'invalid_owner' }
		}
		const registration = await prisma.whatsapp_lead_registrations.findFirst({
			where: {
				app_id: data.appId,
				owner_user_id: ownerUserId,
				conversation_id: conversation.id,
			},
			select: { status: true },
		})
		// Auto-detect leads regardless of confirmation state. Only explicitly
		// blocked leads (spam / opt-out) are skipped, so genuine buying signals
		// are never missed while a lead is still pending.
		if (registration?.status === 'blocked') {
			return { skipped: true, reason: 'personal_lead_blocked' }
		}
	}

	const assigneeId = conversation.assignee_id || ownerUserId || null
	if (!assigneeId) return { skipped: true, reason: 'missing_assignee' }
	const assignee = await prisma.users.findFirst({
		where: {
			id: assigneeId,
			app_id: data.appId,
			deleted_at: null,
			active: true,
			role: { in: ['sales', 'leader'] },
		},
		select: { id: true, role: true },
	})
	if (!assignee?.role) return { skipped: true, reason: 'assignee_not_eligible' }

	const recentRows = await prisma.messages.findMany({
		where: {
			conversation_id: conversation.id,
			app_id: data.appId,
			deleted_at: null,
			content: { not: null },
		},
		select: { message_type: true, content: true },
		orderBy: { created_at: 'desc' },
		take: TASK_ANALYSIS_WINDOW_MAX,
	})
	const chronological = recentRows
		.reverse()
		.map((row) => ({
			role: row.message_type === 'incoming' ? ('Customer' as const) : ('Sales' as const),
			content: normalizedText(row.content),
		}))
		.filter((row) => row.content.length > 0)

	// Analyze the most recent `windowSize` messages. The unanswered customer turn
	// (all trailing customer messages since the last sales reply) is always
	// analyzed in full so a trailing "ok"/emoji cannot mask an earlier actionable
	// question; older messages are context/history for the classifier.
	const analyzeWithWindow = async (windowSize: number) => {
		const window = chronological.slice(
			Math.max(0, chronological.length - windowSize),
		)
		let turnStart = window.length
		while (turnStart > 0 && window[turnStart - 1].role === 'Customer') {
			turnStart -= 1
		}
		const unansweredTurn = window.slice(turnStart)
		const history = window.slice(0, turnStart)
		const latestMessage = unansweredTurn.length
			? unansweredTurn.map((row) => row.content).join('\n')
			: latestContent
		const customerText = window
			.filter((row) => row.role === 'Customer')
			.map((row) => row.content)
			.join('\n')
		const productContext = await buildProductContext(
			data.appId,
			customerText || latestMessage,
		)
		return TaskAnalyzer.analyze({
			customerName: conversation.contacts?.name || null,
			latestMessage,
			history,
			productContext,
		})
	}

	// First pass reads the recent window. If it lands on an uncertain "ignore"
	// and more history exists, widen to the max window before concluding the
	// thread is not a lead. A confident "ignore" stops here to save model calls.
	let rawDecision = await analyzeWithWindow(TASK_ANALYSIS_WINDOW_INITIAL)
	if (
		rawDecision.action === 'ignore' &&
		rawDecision.confidence < TASK_ANALYSIS_MIN_CONFIDENCE &&
		chronological.length > TASK_ANALYSIS_WINDOW_INITIAL
	) {
		rawDecision = await analyzeWithWindow(TASK_ANALYSIS_WINDOW_MAX)
	}

	const decision = withHumanReview(rawDecision)
	if (!decision) return { skipped: true, reason: 'decision_not_actionable' }

	const actor: TaskActor = {
		appId: data.appId,
		userId: assignee.id,
		role: assignee.role as CanonicalRole,
	}
	const task = await TaskService.createFromAnalysis({
		actor,
		conversationId: conversation.id,
		contactId: conversation.contact_id,
		messageId: message.id,
		assigneeId: assignee.id,
		teamId: conversation.team_id,
		decision,
		analysisVersion: 'v1',
	})
	return task
		? { success: true, taskId: task.id, action: decision.action }
		: { skipped: true, reason: 'task_not_created' }
}
