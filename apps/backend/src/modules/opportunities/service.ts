import prisma from '../../lib/prisma'
import { isUuid } from '../../lib/utils'
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from './model'
import {
	DEFAULT_DEAL_THRESHOLD,
	DEFAULT_STAGE_ID,
	dealBucket,
	resolveProbability,
	resolveStage,
	type DealBucket,
} from './stages'

export type OpportunityActor = {
	appId: string
	userId: string | null
	role?: string | null
}

type CreateInput = {
	contactId?: string | null
	name: string
	product?: string | null
	value?: number | null
	currency?: string
	ownerId?: string | null
	stage?: string | null
	probability?: number | null
	status?: string
	notes?: string | null
	source?: string | null
}

type UpdateInput = Partial<CreateInput>

function normalizeStatus(value: unknown): OpportunityStatus {
	const v = String(value ?? '').toLowerCase()
	return (OPPORTUNITY_STATUSES as readonly string[]).includes(v)
		? (v as OpportunityStatus)
		: 'open'
}

// Resolve the first team a user belongs to, to tag the opportunity's line
// (AEC/MFG) the same way lead routing tags conversations.
async function resolveTeamId(appId: string, userId: string | null): Promise<string | null> {
	if (!userId) return null
	const teams = await prisma.teams.findMany({
		where: { app_id: appId, deleted_at: null },
		select: { id: true },
	})
	if (!teams.length) return null
	const membership = await prisma.team_members.findFirst({
		where: { team_id: { in: teams.map((t) => t.id) }, user_id: userId },
		select: { team_id: true },
	})
	return membership?.team_id ?? null
}

/**
 * Which deals the actor may see. Mirrors taskVisibilityScope: a sales sees
 * their own, a leader sees their team's plus their own, everyone above sees
 * all.
 */
export async function dealVisibilityScope(actor: OpportunityActor) {
	const role = String(actor.role || '').toLowerCase()
	if (role === 'sales') return { owner_id: actor.userId }
	if (role === 'leader') {
		const memberships = await prisma.team_members.findMany({
			where: { user_id: actor.userId || '' },
			select: { team_id: true },
		})
		return {
			OR: [
				{ owner_id: actor.userId },
				{ team_id: { in: memberships.map(({ team_id }) => team_id) } },
			],
		}
	}
	return {}
}

async function enrich(rows: Array<Record<string, any>>) {
	const ownerIds = [...new Set(rows.map((r) => r.owner_id).filter(Boolean))] as string[]
	const contactIds = [...new Set(rows.map((r) => r.contact_id).filter(Boolean))] as string[]
	const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))] as string[]
	const [owners, contacts, teams] = await Promise.all([
		ownerIds.length
			? prisma.users.findMany({ where: { id: { in: ownerIds } }, select: { id: true, name: true, email: true } })
			: [],
		contactIds.length
			? prisma.contacts.findMany({ where: { id: { in: contactIds } }, select: { id: true, name: true } })
			: [],
		teamIds.length
			? prisma.teams.findMany({
					where: { id: { in: teamIds } },
					select: { id: true, name: true, deal_threshold: true },
				})
			: [],
	])
	const ownerById = new Map(owners.map((o) => [o.id, o]))
	const contactById = new Map(contacts.map((c) => [c.id, c]))
	const teamById = new Map(teams.map((t) => [t.id, t]))
	return rows.map((row) => {
		// The threshold belongs to the team that owns the deal, so a deal with no
		// team falls back to the global default rather than borrowing another
		// team's setting.
		const team = row.team_id ? teamById.get(row.team_id) : null
		const threshold = team?.deal_threshold ?? DEFAULT_DEAL_THRESHOLD
		const probability = Number(row.probability ?? 0)
		return {
		id: row.id,
		contactId: row.contact_id,
		contactName: row.contact_id ? contactById.get(row.contact_id)?.name || null : null,
		ownerId: row.owner_id,
		ownerName: row.owner_id
			? ownerById.get(row.owner_id)?.name || ownerById.get(row.owner_id)?.email?.split('@')[0] || null
			: null,
			teamId: row.team_id,
			teamName: team?.name ?? null,
			name: row.name,
			product: row.product,
			value: row.value != null ? Number(row.value) : null,
			currency: row.currency,
			status: row.status,
			stage: row.stage || DEFAULT_STAGE_ID,
			stageLabel: resolveStage(row.stage).label,
			probability,
			threshold,
			bucket: dealBucket(probability, row.status, threshold),
			source: row.source,
			notes: row.notes,
			closedAt: row.closed_at ? row.closed_at.toISOString() : null,
			// Falls back to creation so a row written before this column existed
			// counts from something real rather than showing nothing.
			stageChangedAt: (row.stage_changed_at || row.created_at)?.toISOString() ?? null,
			createdAt: row.created_at ? row.created_at.toISOString() : null,
			updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
		}
	})
}

export abstract class OpportunityService {
	static async list(
		actor: OpportunityActor,
		options: {
			status?: string
			ownerId?: string
			contactId?: string
			search?: string
			/** prospek | opportunity | closed — filtered after the threshold is known. */
			bucket?: DealBucket
			limit?: number
			offset?: number
		},
	) {
		const scope = await dealVisibilityScope(actor)
		const rows = await prisma.opportunities.findMany({
			where: {
				app_id: actor.appId,
				...scope,
				...(options.status ? { status: options.status } : {}),
				...(options.ownerId ? { owner_id: options.ownerId } : {}),
				...(options.contactId ? { contact_id: options.contactId } : {}),
				...(options.search
					? { name: { contains: options.search, mode: 'insensitive' as const } }
					: {}),
			} as any,
			orderBy: [{ probability: 'desc' }, { created_at: 'desc' }],
			skip: Math.max(0, options.offset || 0),
			take: Math.max(1, Math.min(200, options.limit || 100)),
		})
		const enriched = await enrich(rows)
		// The bucket depends on the owning team's threshold, which is only known
		// after enrichment, so this filter cannot move into the query.
		return options.bucket
			? enriched.filter((deal) => deal.bucket === options.bucket)
			: enriched
	}

	/**
	 * Move a deal to another stage. This is how a deal becomes an opportunity —
	 * there is no separate "promote" action, and nothing is entered by hand.
	 * Probability follows the stage unless the sales overrides it.
	 */
	static async moveStage(
		actor: OpportunityActor,
		id: string,
		stageId: string,
		probability?: number | null,
	) {
		if (!isUuid(id)) return null
		const scope = await dealVisibilityScope(actor)
		const existing = await prisma.opportunities.findFirst({
			where: { id, app_id: actor.appId, ...scope } as any,
			select: { id: true, probability: true, stage: true },
		})
		if (!existing) return null

		const stage = resolveStage(stageId)
		const row = await prisma.opportunities.update({
			where: { id },
			data: {
				stage: stage.id,
				probability: resolveProbability(stage, probability, existing.probability),
				status: stage.status,
				// Only when the column actually changes. Dropping a card back where
				// it started must not reset the "stuck for 30 days" counter that
				// tells the leader which deals have gone cold.
				...(existing.stage === stage.id ? {} : { stage_changed_at: new Date() }),
				closed_at: stage.status === 'open' ? null : new Date(),
			},
		})
		return (await enrich([row]))[0]
	}

	/**
	 * Header totals. Counted per bucket rather than per status, because that is
	 * the split the page shows — and because the bucket needs each deal's team
	 * threshold, which a groupBy cannot reach.
	 */
	static async stats(actor: OpportunityActor) {
		const scope = await dealVisibilityScope(actor)
		const rows = await prisma.opportunities.findMany({
			where: { app_id: actor.appId, ...scope } as any,
			select: { status: true, probability: true, value: true, team_id: true },
		})
		const teamIds = [...new Set(rows.map((r) => r.team_id).filter(Boolean))] as string[]
		const teams = teamIds.length
			? await prisma.teams.findMany({
					where: { id: { in: teamIds } },
					select: { id: true, deal_threshold: true },
				})
			: []
		const thresholdById = new Map(teams.map((t) => [t.id, t.deal_threshold]))

		const base: Record<string, { count: number; value: number }> = {
			prospek: { count: 0, value: 0 },
			opportunity: { count: 0, value: 0 },
			won: { count: 0, value: 0 },
			lost: { count: 0, value: 0 },
		}
		for (const row of rows) {
			const threshold =
				(row.team_id ? thresholdById.get(row.team_id) : null) ?? DEFAULT_DEAL_THRESHOLD
			const bucket = dealBucket(Number(row.probability ?? 0), row.status, threshold)
			const key = bucket === 'closed' ? row.status : bucket
			if (!base[key]) continue
			base[key].count += 1
			base[key].value += row.value != null ? Number(row.value) : 0
		}
		return base
	}

	static async getById(actor: OpportunityActor, id: string) {
		if (!isUuid(id)) return null
		const scope = await dealVisibilityScope(actor)
		const row = await prisma.opportunities.findFirst({
			where: { id, app_id: actor.appId, ...scope } as any,
		})
		if (!row) return null
		return (await enrich([row]))[0]
	}

	static async create(actor: OpportunityActor, input: CreateInput) {
		const name = input.name?.trim()
		if (!name) throw new Error('Nama opportunity wajib diisi')

		const ownerId = input.ownerId || actor.userId || null
		const teamId = await resolveTeamId(actor.appId, ownerId)
		// Status follows the stage rather than being set independently — the two
		// disagreeing is how a deal ends up "won" while still sitting at 10%.
		const stage = resolveStage(input.stage)

		const row = await prisma.opportunities.create({
			data: {
				app_id: actor.appId,
				contact_id: input.contactId || null,
				owner_id: ownerId,
				team_id: teamId,
				name: name.slice(0, 255),
				product: input.product?.slice(0, 120) || null,
				value: input.value != null ? input.value : null,
				currency: (input.currency || 'IDR').slice(0, 8),
				status: stage.status,
				stage: stage.id,
				probability: resolveProbability(stage, input.probability),
				source: (input.source || 'manual').slice(0, 40),
				notes: input.notes || null,
				created_by: actor.userId,
				stage_changed_at: new Date(),
				closed_at: stage.status === 'open' ? null : new Date(),
			},
		})
		return (await enrich([row]))[0]
	}

	/**
	 * Open a deal for a contact unless one is already running. Called from the
	 * prospect and lead-handoff paths so a lead shows up in Pipeline without
	 * anyone typing it in a second time.
	 */
	static async openForContact(
		actor: OpportunityActor,
		input: { contactId: string; name: string; product?: string | null; ownerId?: string | null; source?: string },
	) {
		const active = await prisma.opportunities.findFirst({
			where: {
				app_id: actor.appId,
				contact_id: input.contactId,
				status: 'open',
			},
			select: { id: true },
		})
		if (active) return null
		return OpportunityService.create(actor, {
			contactId: input.contactId,
			name: input.name,
			product: input.product ?? null,
			ownerId: input.ownerId ?? null,
			stage: DEFAULT_STAGE_ID,
			source: input.source || 'manual',
		})
	}

	static async update(actor: OpportunityActor, id: string, input: UpdateInput) {
		if (!isUuid(id)) return null
		const appId = actor.appId
		const scope = await dealVisibilityScope(actor)
		const existing = await prisma.opportunities.findFirst({
			where: { id, app_id: appId, ...scope } as any,
			select: { id: true, status: true, probability: true, stage: true },
		})
		if (!existing) return null

		const data: Record<string, unknown> = {}
		if (input.name !== undefined) data.name = input.name.trim().slice(0, 255)
		if (input.product !== undefined) data.product = input.product?.slice(0, 120) || null
		if (input.value !== undefined) data.value = input.value
		if (input.currency !== undefined) data.currency = (input.currency || 'IDR').slice(0, 8)
		if (input.ownerId !== undefined) {
			data.owner_id = input.ownerId || null
			data.team_id = await resolveTeamId(appId, input.ownerId || null)
		}
		if (input.notes !== undefined) data.notes = input.notes || null
		// Stage is the source of truth: it sets probability, status and close
		// time together. `status` on its own is accepted only for callers that
		// never touch the stage, and is ignored when a stage is supplied.
		if (input.stage !== undefined) {
			const stage = resolveStage(input.stage)
			data.stage = stage.id
			data.probability = resolveProbability(stage, input.probability, existing.probability)
			data.status = stage.status
			if (existing.stage !== stage.id) data.stage_changed_at = new Date()
			data.closed_at = stage.status === 'open' ? null : new Date()
		} else {
			if (input.probability !== undefined) {
				data.probability = resolveProbability(resolveStage(null), input.probability)
			}
			if (input.status !== undefined) {
				const status = normalizeStatus(input.status)
				data.status = status
				data.closed_at = status === 'won' || status === 'lost' ? new Date() : null
			}
		}

		const row = await prisma.opportunities.update({ where: { id }, data })
		return (await enrich([row]))[0]
	}

	static async remove(actor: OpportunityActor, id: string) {
		if (!isUuid(id)) return false
		const scope = await dealVisibilityScope(actor)
		const result = await prisma.opportunities.deleteMany({
			where: { id, app_id: actor.appId, ...scope } as any,
		})
		return result.count > 0
	}
}
