import prisma from '../../lib/prisma'
import { getRealtimeIO } from '../../lib/realtime'
import { BaileysServiceClient } from '../whatsapp/baileys-service-client'
import type { TaskAnalysisDecision } from './analyzer'
import {
	assertAssignableTask,
	dueAtFromRecommendation,
	taskVisibilityScope,
	type TaskActor,
} from './policy'

const ACTIVE_STATUSES = ['open', 'in_progress']

type TaskRecord = {
	id: string
	app_id: string
	assignee_id: string | null
	team_id: string | null
	created_by: string | null
	conversation_id: string | null
	contact_id: string | null
	source_message_id: string | null
	action_kind: string
	title: string
	description: string | null
	priority: string
	status: string
	due_at: Date | null
	snoozed_until: Date | null
	completed_at: Date | null
	source: string
	ai_snapshot: unknown
	analysis_version: string | null
	confidence: number | null
	created_at: Date
	updated_at: Date
}

export class TaskNotFoundError extends Error {}
export class TaskConflictError extends Error {}

function dayBounds(now = new Date()) {
	const start = new Date(now)
	start.setHours(0, 0, 0, 0)
	const end = new Date(start)
	end.setDate(end.getDate() + 1)
	return { start, end }
}

function activeAndVisibleAt(now: Date) {
	return {
		status: { in: ACTIVE_STATUSES },
		OR: [{ snoozed_until: null }, { snoozed_until: { lte: now } }],
	}
}

function emitTask(event: 'task:created' | 'task:updated', task: TaskRecord) {
	const payload = {
		taskId: task.id,
		appId: task.app_id,
		conversationId: task.conversation_id,
		status: task.status,
		priority: task.priority,
		actionKind: task.action_kind,
		updatedAt: task.updated_at,
	}
	const io = getRealtimeIO()
	io?.to(`app:${task.app_id}`).emit(event, payload)
	if (task.conversation_id) {
		io?.to(`conversation:${task.conversation_id}`).emit('task:updated', payload)
	}
}

function asTask(record: unknown) {
	return record as TaskRecord
}

async function ensureContext(
	appId: string,
	input: {
		conversationId?: string | null
		contactId?: string | null
		sourceMessageId?: string | null
	},
) {
	let conversation: { id: string; contact_id: string | null; assignee_id: string | null; team_id: string | null } | null = null
	if (input.conversationId) {
		conversation = await prisma.conversations.findFirst({
			where: { id: input.conversationId, app_id: appId, deleted_at: null },
			select: { id: true, contact_id: true, assignee_id: true, team_id: true },
		})
		if (!conversation) throw new TaskNotFoundError('Conversation tidak ditemukan pada app aktif')
	}
	if (input.contactId) {
		const contact = await prisma.contacts.findFirst({
			where: { id: input.contactId, app_id: appId, deleted_at: null },
			select: { id: true },
		})
		if (!contact) throw new TaskNotFoundError('Contact tidak ditemukan pada app aktif')
	}
	if (input.sourceMessageId) {
		const message = await prisma.messages.findFirst({
			where: {
				id: input.sourceMessageId,
				app_id: appId,
				deleted_at: null,
				...(input.conversationId ? { conversation_id: input.conversationId } : {}),
			},
			select: { id: true, conversation_id: true },
		})
		if (!message) throw new TaskNotFoundError('Pesan sumber tidak ditemukan pada app aktif')
	}
	return conversation
}

async function enrichTasks(rows: TaskRecord[]) {
	const contactIds = [...new Set(rows.map((row) => row.contact_id).filter(Boolean))] as string[]
	const conversationIds = [...new Set(rows.map((row) => row.conversation_id).filter(Boolean))] as string[]
	const [contacts, conversations] = await Promise.all([
		contactIds.length
			? prisma.contacts.findMany({
					where: { id: { in: contactIds }, deleted_at: null },
					select: { id: true, name: true, phone_number: true, whatsapp_id: true },
				})
			: [],
		conversationIds.length
			? prisma.conversations.findMany({
					where: { id: { in: conversationIds }, deleted_at: null },
					select: { id: true, status: true },
				})
			: [],
	])
	const contactsById = new Map(contacts.map((contact) => [contact.id, contact]))
	const conversationsById = new Map(conversations.map((conversation) => [conversation.id, conversation]))
	return rows.map((row) => {
		const contact = row.contact_id ? contactsById.get(row.contact_id) : null
		const conversation = row.conversation_id
			? conversationsById.get(row.conversation_id)
			: null
		return {
			id: row.id,
			appId: row.app_id,
			assigneeId: row.assignee_id,
			teamId: row.team_id,
			conversationId: row.conversation_id,
			contactId: row.contact_id,
			sourceMessageId: row.source_message_id,
			actionKind: row.action_kind,
			title: row.title,
			description: row.description,
			priority: row.priority,
			status: row.status,
			dueAt: row.due_at,
			snoozedUntil: row.snoozed_until,
			completedAt: row.completed_at,
			source: row.source,
			aiSnapshot: row.ai_snapshot,
			analysisVersion: row.analysis_version,
			confidence: row.confidence,
			contactName: contact?.name || null,
			contactPhone: contact?.phone_number || contact?.whatsapp_id || null,
			conversationStatus: conversation?.status || null,
			createdAt: row.created_at,
			updatedAt: row.updated_at,
		}
	})
}

export abstract class TaskService {
	static async list(
		actor: TaskActor,
		input: {
			view?: 'today' | 'all' | 'overdue' | 'done'
			status?: string
			priority?: string
			cursor?: string
			limit?: number
		},
	) {
		const now = new Date()
		const { start, end } = dayBounds(now)
		const scope = await taskVisibilityScope(actor)
		const filters: Record<string, unknown>[] = []
		const view = input.view || 'today'
		if (view === 'done') filters.push({ status: 'done' })
		else {
			filters.push(activeAndVisibleAt(now))
			if (view === 'today') filters.push({ due_at: { gte: start, lt: end } })
			if (view === 'overdue') filters.push({ due_at: { lt: start } })
		}
		if (input.status) filters.push({ status: input.status })
		if (input.priority) filters.push({ priority: input.priority })

		const rows = await prisma.tasks.findMany({
			where: {
				app_id: actor.appId,
				...scope,
				AND: filters,
			} as any,
			orderBy: [{ due_at: 'asc' }, { created_at: 'desc' }],
			take: Math.max(1, Math.min(100, input.limit || 25)) + 1,
			...(input.cursor ? { cursor: { id: input.cursor }, skip: 1 } : {}),
		})
		const hasMore = rows.length > Math.max(1, Math.min(100, input.limit || 25))
		const page = rows.slice(0, Math.max(1, Math.min(100, input.limit || 25))).map(asTask)
		return {
			data: await enrichTasks(page),
			nextCursor: hasMore ? page.at(-1)?.id || null : null,
		}
	}

	static async get(actor: TaskActor, taskId: string) {
		const scope = await taskVisibilityScope(actor)
		const task = await prisma.tasks.findFirst({
			where: { id: taskId, app_id: actor.appId, ...scope } as any,
		})
		if (!task) throw new TaskNotFoundError('Task tidak ditemukan')
		return (await enrichTasks([asTask(task)]))[0]
	}

	static async events(actor: TaskActor, taskId: string) {
		await TaskService.get(actor, taskId)
		const rows = await prisma.task_events.findMany({
			where: { task_id: taskId },
			orderBy: { created_at: 'desc' },
			take: 100,
		})
		return rows.map((event) => ({
			id: event.id,
			taskId: event.task_id,
			eventType: event.event_type,
			actorId: event.actor_id,
			actorType: event.actor_type,
			metadata: event.metadata,
			reason: event.reason,
			createdAt: event.created_at,
		}))
	}

	static async summary(actor: TaskActor) {
		const now = new Date()
		const { start, end } = dayBounds(now)
		const scope = await taskVisibilityScope(actor)
		const base = { app_id: actor.appId, ...scope } as any
		const visible = activeAndVisibleAt(now)
		const [overdue, today, completedToday] = await Promise.all([
			prisma.tasks.count({ where: { ...base, AND: [visible, { due_at: { lt: start } }] } }),
			prisma.tasks.count({ where: { ...base, AND: [visible, { due_at: { gte: start, lt: end } }] } }),
			prisma.tasks.count({ where: { ...base, status: 'done', completed_at: { gte: start, lt: end } } }),
		])
		return { overdue, today, completedToday }
	}

	static async createManual(
		actor: TaskActor,
		input: {
			title: string
			description?: string | null
			actionKind?: string
			priority?: string
			dueAt?: Date | null
			assigneeId?: string | null
			teamId?: string | null
			conversationId?: string | null
			contactId?: string | null
		},
	) {
		const conversation = await ensureContext(actor.appId, input)
		const assigneeId = input.assigneeId || conversation?.assignee_id || actor.userId
		const teamId = input.teamId || conversation?.team_id || null
		const contactId = input.contactId || conversation?.contact_id || null
		await assertAssignableTask(actor, assigneeId, teamId)
		const task = await prisma.$transaction(async (tx) => {
			const created = await tx.tasks.create({
				data: {
					app_id: actor.appId,
					assignee_id: assigneeId,
					team_id: teamId,
					created_by: actor.userId,
					conversation_id: input.conversationId || null,
					contact_id: contactId,
					action_kind: input.actionKind || 'manual',
					title: input.title.trim(),
					description: input.description?.trim() || null,
					priority: input.priority || 'medium',
					status: 'open',
					due_at: input.dueAt || null,
					source: 'manual',
					ai_snapshot: {},
				},
			})
			await tx.task_events.create({
				data: {
					task_id: created.id,
					event_type: 'created',
					actor_id: actor.userId,
					metadata: { source: 'manual' },
				},
			})
			return asTask(created)
		})
		emitTask('task:created', task)
		return (await enrichTasks([task]))[0]
	}

	static async update(
		actor: TaskActor,
		taskId: string,
		input: { title?: string; description?: string | null; priority?: string; dueAt?: Date | null },
	) {
		const scope = await taskVisibilityScope(actor)
		const task = await prisma.$transaction(async (tx) => {
			const updated = await tx.tasks.updateMany({
				where: { id: taskId, app_id: actor.appId, ...scope, status: { in: ACTIVE_STATUSES } } as any,
				data: {
					...(input.title !== undefined ? { title: input.title.trim() } : {}),
					...(input.description !== undefined ? { description: input.description?.trim() || null } : {}),
					...(input.priority !== undefined ? { priority: input.priority } : {}),
					...(input.dueAt !== undefined ? { due_at: input.dueAt } : {}),
				},
			})
			if (!updated.count) throw new TaskNotFoundError('Task tidak ditemukan atau sudah selesai')
			await tx.task_events.create({
				data: { task_id: taskId, event_type: 'updated', actor_id: actor.userId, metadata: input },
			})
			const row = await tx.tasks.findUnique({ where: { id: taskId } })
			if (!row) throw new TaskNotFoundError('Task tidak ditemukan')
			return asTask(row)
		})
		emitTask('task:updated', task)
		return (await enrichTasks([task]))[0]
	}

	static async start(actor: TaskActor, taskId: string) {
		return TaskService.transition(actor, taskId, ['open'], 'in_progress', 'started')
	}

	static async complete(actor: TaskActor, taskId: string) {
		return TaskService.transition(actor, taskId, ACTIVE_STATUSES, 'done', 'completed')
	}

	static async cancel(actor: TaskActor, taskId: string, reason?: string) {
		return TaskService.transition(actor, taskId, ACTIVE_STATUSES, 'cancelled', 'cancelled', reason)
	}

	static async snooze(actor: TaskActor, taskId: string, snoozedUntil: Date, reason?: string) {
		const scope = await taskVisibilityScope(actor)
		const task = await prisma.$transaction(async (tx) => {
			const updated = await tx.tasks.updateMany({
				where: { id: taskId, app_id: actor.appId, ...scope, status: { in: ACTIVE_STATUSES } } as any,
				data: { snoozed_until: snoozedUntil },
			})
			if (!updated.count) throw new TaskNotFoundError('Task tidak ditemukan atau sudah selesai')
			await tx.task_events.create({
				data: { task_id: taskId, event_type: 'snoozed', actor_id: actor.userId, reason, metadata: { snoozedUntil } },
			})
			const row = await tx.tasks.findUnique({ where: { id: taskId } })
			if (!row) throw new TaskNotFoundError('Task tidak ditemukan')
			return asTask(row)
		})
		emitTask('task:updated', task)
		return (await enrichTasks([task]))[0]
	}

	static async replyWhatsapp(actor: TaskActor, taskId: string, text: string) {
		const trimmed = text.trim()
		if (!trimmed) throw new Error('Balasan tidak boleh kosong')

		const scope = await taskVisibilityScope(actor)
		const task = await prisma.tasks.findFirst({
			where: { id: taskId, app_id: actor.appId, ...scope } as any,
		})
		if (!task) throw new TaskNotFoundError('Task tidak ditemukan')
		if (!ACTIVE_STATUSES.includes(task.status)) {
			throw new TaskConflictError('Task sudah selesai atau dibatalkan')
		}
		if (!task.conversation_id) {
			throw new Error('Task ini tidak terhubung ke percakapan WhatsApp')
		}

		const conversation = await prisma.conversations.findFirst({
			where: { id: task.conversation_id, app_id: actor.appId, deleted_at: null },
			select: {
				id: true,
				inbox_id: true,
				additional_attributes: true,
				contacts: { select: { phone_number: true, whatsapp_id: true } },
			},
		})
		if (!conversation?.inbox_id || !conversation.contacts) {
			throw new Error('Percakapan WhatsApp tidak ditemukan')
		}

		const personal = ((conversation.additional_attributes as Record<string, unknown>)
			?.personal_whatsapp || {}) as Record<string, unknown>
		const ownerUserId =
			(typeof personal.owner_user_id === 'string' && personal.owner_user_id) ||
			task.assignee_id
		if (!ownerUserId) throw new Error('Pemilik WhatsApp tidak diketahui')

		const session = await prisma.baileys_sessions.findFirst({
			where: { app_id: actor.appId, owner_user_id: ownerUserId, status: 'connected' },
			select: { provider_channel_key: true, channel_id: true },
		})
		if (!session) throw new Error('WhatsApp sales sedang tidak terhubung')
		const channel = await prisma.whatsapp_channels.findFirst({
			where: {
				id: session.channel_id,
				app_id: actor.appId,
				provider: 'baileys',
				deleted_at: null,
			},
			select: { api_key: true, inbox_id: true },
		})
		if (!channel?.api_key || channel.inbox_id !== conversation.inbox_id) {
			throw new Error('Channel WhatsApp sales tidak valid')
		}
		const phone = String(
			conversation.contacts.phone_number || conversation.contacts.whatsapp_id || '',
		).replace(/\D/g, '')
		if (!phone) throw new Error('Nomor WhatsApp customer tidak tersedia')

		const sent = await BaileysServiceClient.sendMessage(
			{
				channelKey: session.provider_channel_key,
				recipientWhatsAppId: phone,
				recipientAddressingMode: 'pn',
				type: 'text',
				text: { body: trimmed },
			},
			{
				Authorization: `Bearer ${channel.api_key}`,
				'X-Crm-Channel-Secret': channel.api_key,
			},
		)

		const now = new Date()
		const { task: updatedTask, message } = await prisma.$transaction(async (tx) => {
			const created = await tx.messages.create({
				data: {
					conversation_id: conversation.id,
					app_id: actor.appId,
					inbox_id: conversation.inbox_id,
					message_type: 'outgoing',
					sender_type: 'user',
					sender_id: actor.userId,
					content: trimmed,
					content_type: 'text',
					status: 'sent',
					external_id: sent.externalId || null,
					content_attributes: { from_task_id: taskId } as any,
					created_at: now,
					updated_at: now,
				},
			})
			await tx.conversations.update({
				where: { id: conversation.id },
				data: { last_message_at: now, last_activity_at: now, updated_at: now },
			})
			await tx.tasks.updateMany({
				where: { id: taskId, app_id: actor.appId, status: { in: ACTIVE_STATUSES } },
				data: { status: 'done', completed_at: now, snoozed_until: null },
			})
			await tx.task_events.create({
				data: {
					task_id: taskId,
					event_type: 'replied_whatsapp',
					actor_id: actor.userId,
					metadata: { messageExternalId: sent.externalId || null },
				},
			})
			const row = await tx.tasks.findUnique({ where: { id: taskId } })
			if (!row) throw new TaskNotFoundError('Task tidak ditemukan')
			return { task: asTask(row), message: created }
		})

		const io = getRealtimeIO()
		const payload = {
			message,
			conversation: { id: conversation.id, app_id: actor.appId, channel_type: 'whatsapp' },
		}
		io?.to(`app:${actor.appId}`).emit('message:created', payload)
		io?.to(`conversation:${conversation.id}`).emit('message:created', payload)
		emitTask('task:updated', updatedTask)
		return (await enrichTasks([updatedTask]))[0]
	}

	static async createFromAnalysis(input: {
		actor: TaskActor
		conversationId: string
		contactId: string | null
		messageId: string
		assigneeId: string | null
		teamId: string | null
		decision: TaskAnalysisDecision
		analysisVersion: string
	}) {
		if (input.decision.action === 'ignore') return null
		const result = await prisma.$transaction(async (tx) => {
			const current = await tx.tasks.findFirst({
				where: { app_id: input.actor.appId, source_message_id: input.messageId },
			})
			if (current) return { task: asTask(current), event: null }
			const activeTask = await tx.tasks.findFirst({
				where: {
					app_id: input.actor.appId,
					conversation_id: input.conversationId,
					action_kind: input.decision.action,
					status: { in: ACTIVE_STATUSES },
				},
				orderBy: { updated_at: 'desc' },
			})
			const data = {
				assignee_id: input.assigneeId,
				team_id: input.teamId,
				contact_id: input.contactId,
				source_message_id: input.messageId,
				title: input.decision.title || 'Tindak lanjuti percakapan WhatsApp',
				description: input.decision.summary,
				priority: input.decision.priority || 'medium',
				due_at: dueAtFromRecommendation(input.decision.action, input.decision.dueInMinutes),
				ai_snapshot: input.decision,
				analysis_version: input.analysisVersion,
				confidence: input.decision.confidence,
			}
			if (activeTask) {
				const updated = await tx.tasks.update({
					where: { id: activeTask.id },
					data,
				})
				await tx.task_events.create({
					data: { task_id: updated.id, event_type: 'ai_analyzed', actor_type: 'system', metadata: input.decision },
				})
				return { task: asTask(updated), event: 'task:updated' as const }
			}
			const created = await tx.tasks.create({
				data: {
					app_id: input.actor.appId,
					created_by: null,
					conversation_id: input.conversationId,
					action_kind: input.decision.action,
					status: 'open',
					source: 'ai_whatsapp',
					...data,
				},
			})
			await tx.task_events.create({
				data: { task_id: created.id, event_type: 'created', actor_type: 'system', metadata: input.decision },
			})
			return { task: asTask(created), event: 'task:created' as const }
		})
		if (result.event) emitTask(result.event, result.task)
		return result.task
	}

	private static async transition(
		actor: TaskActor,
		taskId: string,
		from: string[],
		to: 'in_progress' | 'done' | 'cancelled',
		eventType: 'started' | 'completed' | 'cancelled',
		reason?: string,
	) {
		const scope = await taskVisibilityScope(actor)
		const now = new Date()
		const task = await prisma.$transaction(async (tx) => {
			const updated = await tx.tasks.updateMany({
				where: { id: taskId, app_id: actor.appId, ...scope, status: { in: from } } as any,
				data: {
					status: to,
					...(to === 'done' ? { completed_at: now, snoozed_until: null } : {}),
					...(to === 'in_progress' ? { snoozed_until: null } : {}),
				},
			})
			if (!updated.count) throw new TaskConflictError('Task tidak dapat diproses pada status saat ini')
			await tx.task_events.create({
				data: { task_id: taskId, event_type: eventType, actor_id: actor.userId, reason },
			})
			const row = await tx.tasks.findUnique({ where: { id: taskId } })
			if (!row) throw new TaskNotFoundError('Task tidak ditemukan')
			return asTask(row)
		})
		emitTask('task:updated', task)
		return (await enrichTasks([task]))[0]
	}
}
