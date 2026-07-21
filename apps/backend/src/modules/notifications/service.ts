import prisma from '../../lib/prisma'
import { getRealtimeIO } from '../../lib/realtime'

// In-app notification categories. Kept as a plain union so producers stay
// explicit about what they emit and the frontend can map icons/routes.
export type NotificationType =
	| 'takeover'
	| 'lead_pending'
	| 'task_urgent'
	| 'task_due'
	| 'ai_draft'
	| 'wa_disconnected'

export type NotifyInput = {
	appId: string
	userId: string
	type: NotificationType
	title: string
	body?: string | null
	conversationId?: string | null
	taskId?: string | null
	// One live notification per subject. Re-notifying the same key refreshes the
	// notification and marks it unread again instead of stacking duplicates.
	dedupKey: string
	metadata?: Record<string, unknown>
}

export abstract class NotificationService {
	static async notify(input: NotifyInput) {
		if (!input.appId || !input.userId) return null
		const now = new Date()
		try {
			const notification = await prisma.notifications.upsert({
				where: {
					app_id_user_id_dedup_key: {
						app_id: input.appId,
						user_id: input.userId,
						dedup_key: input.dedupKey,
					},
				},
				create: {
					app_id: input.appId,
					user_id: input.userId,
					type: input.type,
					title: input.title.slice(0, 255),
					body: input.body?.slice(0, 2_000) || null,
					conversation_id: input.conversationId || null,
					task_id: input.taskId || null,
					dedup_key: input.dedupKey.slice(0, 200),
					metadata: (input.metadata || {}) as any,
				},
				update: {
					type: input.type,
					title: input.title.slice(0, 255),
					body: input.body?.slice(0, 2_000) || null,
					conversation_id: input.conversationId || null,
					task_id: input.taskId || null,
					metadata: (input.metadata || {}) as any,
					// Treat a repeat as a fresh event: resurface and re-mark unread.
					read_at: null,
					created_at: now,
					updated_at: now,
				},
			})
			// Content is not sent over the socket; clients refetch their own
			// (server-scoped) notifications when they receive this ping.
			getRealtimeIO()
				?.to(`app:${input.appId}`)
				.emit('notification:new', { userId: input.userId, type: input.type })
			return notification
		} catch (error) {
			// Notifications must never break the flow that triggered them.
			console.error('[NotificationService] Failed to create notification:', error)
			return null
		}
	}

	static async list(
		appId: string,
		userId: string,
		options?: {
			limit?: number
			offset?: number
			unreadOnly?: boolean
			type?: string
		},
	) {
		const rows = await prisma.notifications.findMany({
			where: {
				app_id: appId,
				user_id: userId,
				...(options?.unreadOnly ? { read_at: null } : {}),
				...(options?.type ? { type: options.type } : {}),
			},
			orderBy: { created_at: 'desc' },
			skip: Math.max(0, options?.offset || 0),
			take: Math.max(1, Math.min(100, options?.limit || 30)),
		})
		return rows.map((row) => ({
			id: row.id,
			type: row.type,
			title: row.title,
			body: row.body,
			conversationId: row.conversation_id,
			taskId: row.task_id,
			metadata:
				typeof row.metadata === 'object' && row.metadata !== null
					? (row.metadata as Record<string, unknown>)
					: {},
			read: Boolean(row.read_at),
			createdAt: row.created_at,
		}))
	}

	static async unreadCount(appId: string, userId: string) {
		return prisma.notifications.count({
			where: { app_id: appId, user_id: userId, read_at: null },
		})
	}

	// Auto-resolve a notification when its underlying condition clears (e.g. the
	// WhatsApp session reconnects, or a pending lead is confirmed). Marks the
	// matching unread notification as read and pings clients to refresh. Fail-open.
	static async resolve(appId: string, userId: string, dedupKey: string) {
		if (!appId || !userId || !dedupKey) return 0
		try {
			const now = new Date()
			const updated = await prisma.notifications.updateMany({
				where: { app_id: appId, user_id: userId, dedup_key: dedupKey, read_at: null },
				data: { read_at: now, updated_at: now },
			})
			if (updated.count > 0) {
				getRealtimeIO()
					?.to(`app:${appId}`)
					.emit('notification:new', { userId, type: 'resolved' })
			}
			return updated.count
		} catch (error) {
			console.error('[NotificationService] Failed to resolve notification:', error)
			return 0
		}
	}

	static async markRead(appId: string, userId: string, id: string) {
		const now = new Date()
		const updated = await prisma.notifications.updateMany({
			where: { id, app_id: appId, user_id: userId, read_at: null },
			data: { read_at: now, updated_at: now },
		})
		return updated.count > 0
	}

	static async markAllRead(appId: string, userId: string) {
		const now = new Date()
		const updated = await prisma.notifications.updateMany({
			where: { app_id: appId, user_id: userId, read_at: null },
			data: { read_at: now, updated_at: now },
		})
		return updated.count
	}

	/**
	 * Scheduler hook: remind assignees about tasks that have just come due.
	 *
	 * Runs on the maintenance queue. Fires once per task as it crosses `due_at`
	 * (windowed to the run interval so it is not re-sent every tick), deduped by
	 * `task-due:<id>` so an accidental repeat refreshes rather than stacks.
	 * Fail-open — a reminder
	 * failure must never break the maintenance cycle.
	 */
	static async remindDueTasks(windowMs = 5 * 60 * 1000) {
		const now = new Date()
		const windowStart = new Date(now.getTime() - windowMs)
		try {
			const due = await prisma.tasks.findMany({
				where: {
					status: { in: ['open', 'in_progress'] },
					assignee_id: { not: null },
					due_at: { lte: now, gt: windowStart },
				},
				select: {
					id: true,
					app_id: true,
					assignee_id: true,
					title: true,
					conversation_id: true,
				},
				take: 500,
			})
			for (const task of due) {
				if (!task.assignee_id) continue
				await NotificationService.notify({
					appId: task.app_id,
					userId: task.assignee_id,
					type: 'task_due',
					title: 'Tugas jatuh tempo',
					body: task.title,
					conversationId: task.conversation_id,
					taskId: task.id,
					dedupKey: `task-due:${task.id}`,
				})
			}
			return due.length
		} catch (error) {
			console.error('[NotificationService] remindDueTasks failed:', error)
			return 0
		}
	}
}
