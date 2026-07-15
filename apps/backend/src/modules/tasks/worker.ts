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
	const jobId = `task-analysis:${data.messageId}`
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
				status: 'confirmed',
			},
			select: { id: true },
		})
		if (!registration) {
			return { skipped: true, reason: 'personal_lead_not_confirmed' }
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

	const historyRows = await prisma.messages.findMany({
		where: {
			conversation_id: conversation.id,
			app_id: data.appId,
			deleted_at: null,
			content: { not: null },
		},
		select: { message_type: true, content: true },
		orderBy: { created_at: 'desc' },
		take: 10,
	})
	const history = historyRows
		.reverse()
		.map((row) => ({
			role: row.message_type === 'incoming' ? ('Customer' as const) : ('Sales' as const),
			content: normalizedText(row.content),
		}))
		.filter((row) => row.content.length > 0)

	const decision = withHumanReview(
		await TaskAnalyzer.analyze({
			customerName: conversation.contacts?.name || null,
			latestMessage: latestContent,
			history,
		}),
	)
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
