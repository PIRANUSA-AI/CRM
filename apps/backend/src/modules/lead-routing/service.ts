import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'
import { getRealtimeIO } from '../../lib/realtime'
import { NotificationService } from '../notifications/service'
import { PersonalAiReplyService } from '../personal-whatsapp-inbox/ai-reply'
import { PersonalTakeoverService } from '../personal-whatsapp-inbox/takeover'
import { SalesProfileService } from '../sales-profiles/service'
import { generateHandoffBrief, type LeadContact } from '../tasks/lead-brief'

export type RoutingActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export class RoutingError extends Error {}
export class RoutingNotFoundError extends Error {}

// M2 deterministic weights (no AI). See docs/lead-auto-assign.md §3.
const WEIGHTS = { product: 0.4, load: 0.3, fairness: 0.3 }
const ACTIVE_TASK_STATUSES = ['open', 'in_progress']

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function tokenize(value: string): string[] {
	return [
		...new Set(
			String(value || '')
				.toLowerCase()
				.replace(/[^a-z0-9\s]/g, ' ')
				.split(/\s+/)
				.filter((word) => word.length >= 3),
		),
	]
}

// Which of a sales' skills overlap the lead's product interest (token overlap).
function matchedSkills(skills: string[], productInterest: string): string[] {
	const need = new Set(tokenize(productInterest))
	if (!need.size) return []
	return skills.filter((skill) => tokenize(skill).some((token) => need.has(token)))
}

function clamp01(value: number): number {
	if (!Number.isFinite(value)) return 0
	return Math.max(0, Math.min(1, value))
}

type Candidate = Awaited<ReturnType<typeof SalesProfileService.listWithProfiles>>[number]

type ConversationContext = {
	id: string
	contactId: string | null
	contactName: string
	productInterest: string
	// F1: structured lead-need profile (if the leader AI qualified this lead).
	leadNeed: Record<string, unknown> | null
	// F4: full contact for the handoff briefing.
	contact: LeadContact | null
}

async function loadConversation(actor: RoutingActor, conversationId: string): Promise<ConversationContext> {
	const conversation = await prisma.conversations.findFirst({
		where: { id: conversationId, app_id: actor.appId, deleted_at: null },
		select: {
			id: true,
			contact_id: true,
			additional_attributes: true,
			contacts: {
				select: {
					id: true,
					name: true,
					email: true,
					phone_number: true,
					company: true,
					city: true,
					source: true,
					custom_attributes: true,
				},
			},
		},
	})
	if (!conversation) throw new RoutingNotFoundError('Percakapan tidak ditemukan')
	const attrs = asRecord(conversation.contacts?.custom_attributes)
	const leadNeedRaw = asRecord(asRecord(conversation.additional_attributes).lead_need)
	const leadNeed = Object.keys(leadNeedRaw).length ? leadNeedRaw : null
	// Prefer the qualified product from lead_need; fall back to contact attribute.
	const productInterest =
		String(leadNeed?.product || attrs.product_interest || '').trim()
	const contact = conversation.contacts
		? {
				name: conversation.contacts.name,
				email: conversation.contacts.email,
				phone_number: conversation.contacts.phone_number,
				company: conversation.contacts.company,
				city: conversation.contacts.city,
				source: conversation.contacts.source,
				custom_attributes: conversation.contacts.custom_attributes,
			}
		: null
	return {
		id: conversation.id,
		contactId: conversation.contact_id,
		contactName:
			conversation.contacts?.name || conversation.contacts?.phone_number || 'Lead',
		productInterest,
		leadNeed,
		contact,
	}
}

// Last messages of the leader conversation, oldest-first, as a compact
// transcript for the handoff briefing. Best-effort: never blocks the assign.
async function loadLeaderTranscript(appId: string, conversationId: string): Promise<string> {
	try {
		const rows = await prisma.messages.findMany({
			where: { conversation_id: conversationId, app_id: appId, deleted_at: null },
			orderBy: { created_at: 'desc' },
			take: 16,
			select: { content: true, content_type: true, message_type: true },
		})
		return rows
			.reverse()
			.map(
				(m) =>
					`${m.message_type === 'incoming' ? 'Customer' : 'Tim'}: ${
						String(m.content || '').trim() || `[${m.content_type || 'media'}]`
					}`,
			)
			.join('\n')
			.slice(0, 4000)
	} catch {
		return ''
	}
}

// Most recent assignment time per candidate (used for fairness / rotation).
async function lastAssignedMap(appId: string, ids: string[]): Promise<Map<string, number>> {
	if (!ids.length) return new Map()
	const rows = await prisma.tasks.groupBy({
		by: ['assignee_id'],
		where: { app_id: appId, assignee_id: { in: ids } },
		_max: { created_at: true },
	})
	const map = new Map<string, number>()
	for (const row of rows) {
		if (row.assignee_id) map.set(row.assignee_id, row._max.created_at?.getTime() || 0)
	}
	return map
}

type ScoredCandidate = {
	userId: string
	name: string | null
	email: string
	teamId: string | null
	activeLoad: number
	maxActive: number
	overloaded: boolean
	matchedSkills: string[]
	score: number
	reasons: string[]
}

function scoreCandidates(
	candidates: Candidate[],
	productInterest: string,
	lastAssigned: Map<string, number>,
): ScoredCandidate[] {
	// Fairness normalization bounds across the candidate set.
	const times = candidates.map((c) => lastAssigned.get(c.userId) ?? 0)
	const minTime = Math.min(...times)
	const maxTime = Math.max(...times)
	const span = maxTime - minTime

	const scored = candidates.map((candidate) => {
		const maxActive = candidate.profile.maxActive || 20
		const skills = candidate.profile.productSkills || []
		const matched = matchedSkills(skills, productInterest)

		const productScore = !productInterest ? 0.5 : matched.length ? 1 : 0.2
		const loadScore = clamp01(1 - candidate.activeLoad / maxActive)
		const last = lastAssigned.get(candidate.userId) ?? 0
		// Older last-assignment (or never) => more fair to pick now.
		const fairnessScore = span > 0 ? clamp01(1 - (last - minTime) / span) : 1

		const total =
			WEIGHTS.product * productScore +
			WEIGHTS.load * loadScore +
			WEIGHTS.fairness * fairnessScore
		const overloaded = candidate.activeLoad >= maxActive

		const reasons: string[] = []
		if (matched.length) reasons.push(`Cocok keahlian: ${matched.join(', ')}`)
		else if (productInterest) reasons.push(`Belum ada keahlian yang cocok untuk ${productInterest}`)
		else reasons.push('Produk lead belum diketahui')
		reasons.push(
			overloaded
				? `Beban penuh (${candidate.activeLoad}/${maxActive})`
				: `Beban ringan (${candidate.activeLoad}/${maxActive})`,
		)
		reasons.push(last ? 'Sudah pernah dapat lead' : 'Belum pernah dapat lead')

		return {
			userId: candidate.userId,
			name: candidate.name,
			email: candidate.email,
			teamId: candidate.teamId,
			activeLoad: candidate.activeLoad,
			maxActive,
			overloaded,
			matchedSkills: matched,
			// Overloaded sales are pushed to the bottom but still selectable.
			score: Math.round((overloaded ? total * 0.4 : total) * 100),
			reasons,
		}
	})

	return scored.sort((a, b) => b.score - a.score)
}

// Teams a leader has opted OUT of auto-assign for. Their members stay manually
// assignable (via "Bagikan"), but are excluded from automatic top-pick routing.
async function blockedAutoAssignTeamIds(appId: string): Promise<Set<string>> {
	const rows = await prisma.teams.findMany({
		where: { app_id: appId, deleted_at: null, allow_auto_assign: false },
		select: { id: true },
	})
	return new Set(rows.map((row) => row.id))
}

export abstract class LeadRoutingService {
	// Ranked sales recommendations for a conversation (no side effects).
	static async suggest(actor: RoutingActor, conversationId: string) {
		const context = await loadConversation(actor, conversationId)
		const candidates = await SalesProfileService.listWithProfiles(actor)
		if (!candidates.length) {
			return {
				conversationId: context.id,
				contactName: context.contactName,
				productInterest: context.productInterest || null,
				candidates: [] as ScoredCandidate[],
			}
		}
		const lastAssigned = await lastAssignedMap(
			actor.appId,
			candidates.map((c) => c.userId),
		)
		const blocked = await blockedAutoAssignTeamIds(actor.appId)
		const scored = scoreCandidates(candidates, context.productInterest, lastAssigned)
		return {
			conversationId: context.id,
			contactName: context.contactName,
			productInterest: context.productInterest || null,
			// Flag members whose team opted out of auto-assign so the leader knows
			// they only receive leads when picked manually.
			candidates: scored.map((candidate) =>
				candidate.teamId && blocked.has(candidate.teamId)
					? { ...candidate, reasons: [...candidate.reasons, 'Auto-assign tim ini dimatikan'] }
					: candidate,
			),
		}
	}

	// Assign a conversation to a sales (top suggestion by default, or an explicit
	// override). Sets conversations.assignee_id + team_id, creates/updates a
	// follow-up task, and notifies the sales.
	static async assign(actor: RoutingActor, conversationId: string, salesUserId?: string | null) {
		const context = await loadConversation(actor, conversationId)
		const candidates = await SalesProfileService.listWithProfiles(actor)
		if (!candidates.length) throw new RoutingError('Tidak ada sales yang bisa menerima lead')

		const lastAssigned = await lastAssignedMap(
			actor.appId,
			candidates.map((c) => c.userId),
		)
		const ranked = scoreCandidates(candidates, context.productInterest, lastAssigned)
		let target: (typeof ranked)[number] | undefined
		if (salesUserId) {
			// Explicit leader pick ("Bagikan") always wins, regardless of the
			// team's auto-assign setting.
			target = ranked.find((candidate) => candidate.userId === salesUserId)
		} else {
			// Auto top-pick: skip members whose team opted out of auto-assign. Fall
			// back to the full ranking if that leaves nobody, so a lead is never
			// dropped just because every team disabled auto-assign.
			const blocked = await blockedAutoAssignTeamIds(actor.appId)
			const eligible = ranked.filter(
				(candidate) => !candidate.teamId || !blocked.has(candidate.teamId),
			)
			target = (eligible.length ? eligible : ranked)[0]
		}
		if (!target)
			throw new RoutingError('Sales tujuan tidak valid atau di luar tim Anda')

		const now = new Date()
		const dueAt = new Date(now.getTime() + 24 * 3600_000)
		const title = `Balas lead baru: ${context.contactName}${
			context.productInterest ? ` — ${context.productInterest}` : ''
		}`.slice(0, 255)

		await prisma.conversations.update({
			where: { id: context.id },
			data: { assignee_id: target.userId, team_id: target.teamId, updated_at: now },
		})

		// Stop the leader-number AI for this lead. In Model B the assigned sales
		// continues from their OWN WhatsApp number (via "Mulai Chat"), so the AI on
		// the leader's intake number must not keep replying.
		const convRow = await prisma.conversations.findFirst({
			where: { id: context.id, app_id: actor.appId },
			select: { additional_attributes: true },
		})
		const personal = asRecord(asRecord(convRow?.additional_attributes).personal_whatsapp)
		const leaderOwnerId =
			typeof personal.owner_user_id === 'string' && personal.owner_user_id
				? personal.owner_user_id
				: actor.userId
		await PersonalTakeoverService.takeover({
			appId: actor.appId,
			ownerUserId: leaderOwnerId,
			conversationId: context.id,
			source: 'manual',
			byUserId: actor.userId,
			reason: `Dibagikan ke ${target.name || target.email}`,
		}).catch(() => null)
		await PersonalAiReplyService.cancelConversationTasks(
			actor.appId,
			leaderOwnerId,
			context.id,
		).catch(() => null)

		// The follow-up task is NOT linked to the leader's conversation: the sales
		// picks it up and chats the contact from their own number ("Mulai Chat" ->
		// openChat). Dedupe by contact so re-assign doesn't stack tasks.
		const existing = context.contactId
			? await prisma.tasks.findFirst({
					where: {
						app_id: actor.appId,
						contact_id: context.contactId,
						source: 'routing',
						status: { in: ACTIVE_TASK_STATUSES },
					},
					select: { id: true, ai_snapshot: true },
				})
			: null

		// F4: build the handoff briefing so the sales opens the task already knowing
		// what the lead wants and what was discussed with the leader. The AI has a
		// deterministic fallback, so a failure here never blocks the assignment.
		const transcript = await loadLeaderTranscript(actor.appId, context.id)
		const brief = context.contact
			? await generateHandoffBrief({
					contact: context.contact,
					leadNeed: context.leadNeed,
					transcript,
				}).catch(() => null)
			: null
		// F1 + F4: lead-need profile + briefing (summary + ready opener) carried into
		// the task's ai_snapshot for the sales pickup.
		const leadNeedSnapshot = {
			...(context.leadNeed ? { lead_need: context.leadNeed } : {}),
			...(brief ? { summary: brief.summary, suggestedReply: brief.suggestedReply } : {}),
		}
		const hasSnapshot = Object.keys(leadNeedSnapshot).length > 0

		let taskId: string
		if (existing) {
			await prisma.tasks.update({
				where: { id: existing.id },
				data: {
					assignee_id: target.userId,
					team_id: target.teamId,
					title,
					...(hasSnapshot
						? { ai_snapshot: { ...asRecord(existing.ai_snapshot), ...leadNeedSnapshot } as any }
						: {}),
					updated_at: now,
				},
			})
			taskId = existing.id
			await prisma.task_events.create({
				data: {
					task_id: taskId,
					event_type: 'reassigned',
					actor_id: actor.userId,
					actor_type: 'user',
					reason: 'Lead dibagikan ulang dari routing',
					metadata: { source: 'routing', assignee_id: target.userId, score: target.score },
				},
			})
		} else {
			const task = await prisma.tasks.create({
				data: {
					app_id: actor.appId,
					assignee_id: target.userId,
					team_id: target.teamId,
					created_by: actor.userId,
					contact_id: context.contactId,
					action_kind: 'follow_up',
					title,
					priority: 'medium',
					status: 'open',
					due_at: dueAt,
					source: 'routing',
					ai_snapshot: leadNeedSnapshot as any,
				},
			})
			taskId = task.id
			await prisma.task_events.create({
				data: {
					task_id: taskId,
					event_type: 'created',
					actor_id: actor.userId,
					actor_type: 'user',
					metadata: { source: 'routing', assignee_id: target.userId, score: target.score },
				},
			})
		}

		await NotificationService.notify({
			appId: actor.appId,
			userId: target.userId,
			type: 'lead_pending',
			title: 'Lead baru di-assign ke kamu',
			body: `${context.contactName}${context.productInterest ? ` — ${context.productInterest}` : ''}`,
			conversationId: null,
			taskId,
			dedupKey: `lead_assign:${taskId}`,
			metadata: { source: 'routing', by: actor.userId },
		})

		getRealtimeIO()
			?.to(`app:${actor.appId}`)
			.emit('lead-routing:assigned', {
				conversationId: context.id,
				assigneeId: target.userId,
				taskId,
			})

		return {
			conversationId: context.id,
			assignedTo: { userId: target.userId, name: target.name, email: target.email },
			taskId,
			score: target.score,
			reasons: target.reasons,
		}
	}
}
