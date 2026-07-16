import prisma from '../../lib/prisma'
import { getRealtimeIO } from '../../lib/realtime'
import { NotificationService } from '../notifications/service'

// Per-conversation takeover for personal WhatsApp leads. A lead is either
// handled by the AI (ai_handling_enabled = true) or taken over by a human
// (false). Two triggers reach the same state:
//   - manual : the sales clicks "Ambil Alih" in the chat
//   - ai     : the AI review decides it needs a human (needsHuman / low conf)
// Taken-over leads surface in the "Alih Tugas" page until returned to the AI.

export type TakeoverSource = 'manual' | 'ai'

export type TakeoverActor = {
	userId: string
	role: string
	appId: string
}

// Leads waiting on a human longer than this are flagged as overdue in the UI.
const TAKEOVER_SLA_MINUTES = Math.max(
	1,
	Math.min(1_440, Number(process.env.PERSONAL_TAKEOVER_SLA_MINUTES || 30)),
)

function isSupervisor(role: string) {
	const normalized = String(role || '').toLowerCase()
	return normalized === 'leader' || normalized === 'ceo' || normalized === 'superadmin'
}

function emit(appId: string, conversationId: string, aiHandling: boolean) {
	try {
		getRealtimeIO()?.to(`app:${appId}`).emit('personal-takeover:updated', {
			conversationId,
			aiHandling,
		})
	} catch (error) {
		console.error('[PersonalTakeover] Failed to emit event:', error)
	}
}

async function logEvent(input: {
	appId: string
	conversationId: string
	action: 'personal_takeover' | 'personal_release'
	actorId?: string | null
	actorType: 'user' | 'system'
	metadata?: Record<string, unknown>
}) {
	try {
		await prisma.conversation_activity_log.create({
			data: {
				conversation_id: input.conversationId,
				action: input.action,
				actor_id: input.actorId || null,
				actor_type: input.actorType,
				metadata: (input.metadata || {}) as any,
			},
		})
	} catch (error) {
		// Audit logging must never block the takeover flow.
		console.error('[PersonalTakeover] Failed to write audit log:', error)
	}
}

// Latest AI review reason + composed draft (if any) per conversation, read from
// the raw-SQL personal_ai_reply_tasks table. A composed draft only exists for
// draft-mode tasks; handover tasks carry the review reason but usually no draft.
async function aiContextByConversation(conversationIds: string[]) {
	const map = new Map<string, { reason: string | null; draft: string | null }>()
	if (!conversationIds.length) return map
	try {
		const rows = await prisma.$queryRawUnsafe<
			Array<{ conversation_id: string; review_reason: string | null; draft_text: string | null }>
		>(
			`
				SELECT DISTINCT ON ("conversation_id")
					"conversation_id", "review_reason", "draft_text"
				FROM "personal_ai_reply_tasks"
				WHERE "conversation_id" = ANY($1::uuid[])
				ORDER BY "conversation_id", "updated_at" DESC
			`,
			conversationIds,
		)
		for (const row of rows) {
			map.set(row.conversation_id, {
				reason: row.review_reason,
				draft: row.draft_text,
			})
		}
	} catch (error) {
		console.error('[PersonalTakeover] Failed to read AI context:', error)
	}
	return map
}

export abstract class PersonalTakeoverService {
	// True when the AI is still allowed to auto-reply to this conversation.
	// Missing registration is treated as enabled (fail-open: never silently mute
	// the AI just because a registration row is absent).
	static async isAiHandlingEnabled(
		appId: string,
		ownerUserId: string,
		conversationId: string,
	) {
		const registration = await prisma.whatsapp_lead_registrations.findFirst({
			where: {
				app_id: appId,
				owner_user_id: ownerUserId,
				conversation_id: conversationId,
			},
			select: { ai_handling_enabled: true },
			orderBy: { updated_at: 'desc' },
		})
		return registration ? registration.ai_handling_enabled : true
	}

	// Switch a lead to human handling. Idempotent: re-taking an already taken lead
	// just refreshes the metadata. Returns null when no registration is found.
	static async takeover(input: {
		appId: string
		ownerUserId: string
		conversationId: string
		source: TakeoverSource
		byUserId?: string | null
		reason?: string | null
		note?: string | null
	}) {
		const now = new Date()
		const updated = await prisma.whatsapp_lead_registrations.updateMany({
			where: {
				app_id: input.appId,
				owner_user_id: input.ownerUserId,
				conversation_id: input.conversationId,
			},
			data: {
				ai_handling_enabled: false,
				takeover_by: input.byUserId || null,
				takeover_at: now,
				takeover_source: input.source,
				takeover_reason: input.reason?.slice(0, 2_000) || null,
				handoff_note: input.note?.slice(0, 2_000) || null,
				released_at: null,
				updated_at: now,
			},
		})
		if (!updated.count) return null
		await logEvent({
			appId: input.appId,
			conversationId: input.conversationId,
			action: 'personal_takeover',
			actorId: input.byUserId,
			actorType: input.source === 'ai' ? 'system' : 'user',
			metadata: {
				source: input.source,
				reason: input.reason || null,
				note: input.note || null,
			},
		})
		// Notify the owning sales when the AI escalates a lead to them. A manual
		// takeover is initiated by the sales, so no self-notification is needed.
		if (input.source === 'ai') {
			await NotificationService.notify({
				appId: input.appId,
				userId: input.ownerUserId,
				type: 'takeover',
				title: 'Lead dialihkan ke kamu oleh AI',
				body: input.reason || 'AI menilai percakapan ini perlu ditangani manusia.',
				conversationId: input.conversationId,
				dedupKey: `takeover:${input.conversationId}`,
			})
		}
		emit(input.appId, input.conversationId, false)
		return { conversationId: input.conversationId, aiHandling: false }
	}

	// Return a lead to the AI.
	static async release(input: {
		appId: string
		ownerUserId: string
		conversationId: string
		byUserId?: string | null
		note?: string | null
	}) {
		const now = new Date()
		const updated = await prisma.whatsapp_lead_registrations.updateMany({
			where: {
				app_id: input.appId,
				owner_user_id: input.ownerUserId,
				conversation_id: input.conversationId,
			},
			data: {
				ai_handling_enabled: true,
				handoff_note: input.note?.slice(0, 2_000) || null,
				released_at: now,
				updated_at: now,
			},
		})
		if (!updated.count) return null
		await logEvent({
			appId: input.appId,
			conversationId: input.conversationId,
			action: 'personal_release',
			actorId: input.byUserId,
			actorType: 'user',
			metadata: { note: input.note || null },
		})
		// The takeover is over — clear its notification for the owner.
		await NotificationService.resolve(
			input.appId,
			input.ownerUserId,
			`takeover:${input.conversationId}`,
		)
		emit(input.appId, input.conversationId, true)
		return { conversationId: input.conversationId, aiHandling: true }
	}

	// Number of leads currently handled by a human (for badges / notifications).
	static async count(actor: TakeoverActor) {
		return prisma.whatsapp_lead_registrations.count({
			where: {
				app_id: actor.appId,
				ai_handling_enabled: false,
				conversation_id: { not: null },
				...(isSupervisor(actor.role) ? {} : { owner_user_id: actor.userId }),
			},
		})
	}

	// List leads currently handled by a human. Sales see their own; supervisors
	// (leader/ceo/superadmin) see all leads in the app. Enriched with SLA waiting
	// time, the AI reason/draft, and the handoff note.
	static async list(actor: TakeoverActor) {
		const registrations = await prisma.whatsapp_lead_registrations.findMany({
			where: {
				app_id: actor.appId,
				ai_handling_enabled: false,
				conversation_id: { not: null },
				...(isSupervisor(actor.role) ? {} : { owner_user_id: actor.userId }),
			},
			orderBy: { takeover_at: 'desc' },
			take: 200,
		})
		if (!registrations.length) return []

		const conversationIds = registrations
			.map((row) => row.conversation_id)
			.filter((id): id is string => Boolean(id))
		const ownerIds = [...new Set(registrations.map((row) => row.owner_user_id))]
		const takenByIds = [
			...new Set(registrations.map((row) => row.takeover_by).filter((id): id is string => Boolean(id))),
		]

		const [conversations, users, aiContext, lastInboundRows, lastAgentRows] =
			await Promise.all([
				conversationIds.length
					? prisma.conversations.findMany({
							where: { id: { in: conversationIds }, deleted_at: null },
							select: {
								id: true,
								contacts: { select: { name: true, phone_number: true, whatsapp_id: true } },
								messages: {
									where: { deleted_at: null },
									orderBy: { created_at: 'desc' },
									take: 1,
									select: { content: true, created_at: true },
								},
							},
						})
					: Promise.resolve([]),
				prisma.users.findMany({
					where: { id: { in: [...new Set([...ownerIds, ...takenByIds])] } },
					select: { id: true, name: true, email: true },
				}),
				aiContextByConversation(conversationIds),
				// Last customer (incoming) message per conversation.
				conversationIds.length
					? prisma.messages.groupBy({
							by: ['conversation_id'],
							where: {
								conversation_id: { in: conversationIds },
								message_type: 'incoming',
								deleted_at: null,
							},
							_max: { created_at: true },
						})
					: Promise.resolve([]),
				// Last human (sales) reply per conversation — bot replies do not count.
				conversationIds.length
					? prisma.messages.groupBy({
							by: ['conversation_id'],
							where: {
								conversation_id: { in: conversationIds },
								message_type: 'outgoing',
								sender_type: 'user',
								deleted_at: null,
							},
							_max: { created_at: true },
						})
					: Promise.resolve([]),
			])
		const conversationsById = new Map(conversations.map((row) => [row.id, row]))
		const userName = new Map(users.map((row) => [row.id, row.name || row.email]))
		const lastInboundAt = new Map(
			lastInboundRows.map((row) => [row.conversation_id, row._max.created_at?.getTime() || 0]),
		)
		const lastAgentAt = new Map(
			lastAgentRows.map((row) => [row.conversation_id, row._max.created_at?.getTime() || 0]),
		)
		const now = Date.now()

		return registrations
			.filter((row) => row.conversation_id)
			.map((row) => {
				const convId = row.conversation_id as string
				const conversation = conversationsById.get(convId)
				const ai = aiContext.get(convId)
				const takenAtMs = row.takeover_at ? new Date(row.takeover_at).getTime() : 0
				const customerAt = lastInboundAt.get(convId) || 0
				const agentAt = lastAgentAt.get(convId) || 0
				// Waiting = the customer's latest message is newer than the last human
				// reply (customer is still awaiting a response). Once the sales replies
				// after that message, it becomes "sudah dibalas" and the clock stops.
				const awaitingResponse = customerAt > 0 && customerAt > agentAt
				const waitingMinutes = awaitingResponse
					? Math.max(0, Math.floor((now - customerAt) / 60_000))
					: 0
				// A reply made after takeover marks the lead as responded.
				const respondedAt = agentAt > 0 && agentAt >= takenAtMs ? new Date(agentAt) : null
				return {
					conversationId: row.conversation_id,
					contactName:
						conversation?.contacts?.name ||
						row.display_name ||
						row.phone_number ||
						'Kontak WhatsApp',
					contactPhone:
						conversation?.contacts?.phone_number ||
						conversation?.contacts?.whatsapp_id ||
						row.phone_number ||
						'',
					preview: conversation?.messages[0]?.content || null,
					lastMessageAt: conversation?.messages[0]?.created_at || null,
					ownerUserId: row.owner_user_id,
					ownerName: userName.get(row.owner_user_id) || null,
					takenBy: row.takeover_by,
					takenByName: row.takeover_by ? userName.get(row.takeover_by) || null : null,
					source: row.takeover_source || 'manual',
					reason: row.takeover_reason || null,
					note: row.handoff_note || null,
					aiReason: ai?.reason || row.takeover_reason || null,
					aiSuggestedReply: ai?.draft || null,
					takenAt: row.takeover_at,
					awaitingResponse,
					respondedAt,
					waitingMinutes,
					slaMinutes: TAKEOVER_SLA_MINUTES,
					overdue: awaitingResponse && waitingMinutes > TAKEOVER_SLA_MINUTES,
				}
			})
	}

	// Audit trail (takeover / release events) for one conversation.
	static async history(appId: string, conversationId: string) {
		const rows = await prisma.conversation_activity_log.findMany({
			where: {
				conversation_id: conversationId,
				action: { in: ['personal_takeover', 'personal_release'] },
			},
			orderBy: { created_at: 'desc' },
			take: 50,
		})
		if (!rows.length) return []
		const actorIds = [...new Set(rows.map((row) => row.actor_id).filter((id): id is string => Boolean(id)))]
		const users = actorIds.length
			? await prisma.users.findMany({
					where: { id: { in: actorIds } },
					select: { id: true, name: true, email: true },
				})
			: []
		const userName = new Map(users.map((row) => [row.id, row.name || row.email]))
		return rows.map((row) => {
			const metadata =
				typeof row.metadata === 'object' && row.metadata !== null
					? (row.metadata as Record<string, unknown>)
					: {}
			return {
				id: row.id,
				action: row.action,
				actorType: row.actor_type || 'user',
				actorName: row.actor_id ? userName.get(row.actor_id) || null : null,
				source: (metadata.source as string) || null,
				reason: (metadata.reason as string) || null,
				note: (metadata.note as string) || null,
				createdAt: row.created_at,
			}
		})
	}
}
