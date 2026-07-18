import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'
import { getRealtimeIO } from '../../lib/realtime'
import { NotificationService } from '../notifications/service'
import { SalesProfileService } from '../sales-profiles/service'

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
}

async function loadConversation(actor: RoutingActor, conversationId: string): Promise<ConversationContext> {
	const conversation = await prisma.conversations.findFirst({
		where: { id: conversationId, app_id: actor.appId, deleted_at: null },
		select: {
			id: true,
			contact_id: true,
			contacts: {
				select: { id: true, name: true, phone_number: true, custom_attributes: true },
			},
		},
	})
	if (!conversation) throw new RoutingNotFoundError('Percakapan tidak ditemukan')
	const attrs = asRecord(conversation.contacts?.custom_attributes)
	const productInterest = String(attrs.product_interest || '').trim()
	return {
		id: conversation.id,
		contactId: conversation.contact_id,
		contactName:
			conversation.contacts?.name || conversation.contacts?.phone_number || 'Lead',
		productInterest,
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
		return {
			conversationId: context.id,
			contactName: context.contactName,
			productInterest: context.productInterest || null,
			candidates: scoreCandidates(candidates, context.productInterest, lastAssigned),
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
		const target = salesUserId
			? ranked.find((candidate) => candidate.userId === salesUserId)
			: ranked[0]
		if (!target)
			throw new RoutingError('Sales tujuan tidak valid atau di luar tim Anda')

		const now = new Date()
		const dueAt = new Date(now.getTime() + 24 * 3600_000)
		const title = `Follow-up ${context.productInterest || 'lead'} — ${context.contactName}`.slice(0, 255)

		await prisma.conversations.update({
			where: { id: context.id },
			data: { assignee_id: target.userId, team_id: target.teamId, updated_at: now },
		})

		// Reuse an existing open routing task for this conversation instead of
		// stacking duplicates on re-assign.
		const existing = await prisma.tasks.findFirst({
			where: {
				app_id: actor.appId,
				conversation_id: context.id,
				source: 'routing',
				status: { in: ACTIVE_TASK_STATUSES },
			},
			select: { id: true },
		})

		let taskId: string
		if (existing) {
			await prisma.tasks.update({
				where: { id: existing.id },
				data: { assignee_id: target.userId, team_id: target.teamId, title, updated_at: now },
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
					conversation_id: context.id,
					action_kind: 'follow_up',
					title,
					priority: 'medium',
					status: 'open',
					due_at: dueAt,
					source: 'routing',
					ai_snapshot: {},
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
			conversationId: context.id,
			taskId,
			dedupKey: `lead_assign:${context.id}`,
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
