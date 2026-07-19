import prisma from '../../lib/prisma'
import { isUuid } from '../../lib/utils'
import { OPPORTUNITY_STATUSES, type OpportunityStatus } from './model'

export type OpportunityActor = {
	appId: string
	userId: string | null
}

type CreateInput = {
	contactId?: string | null
	name: string
	product?: string | null
	value?: number | null
	currency?: string
	ownerId?: string | null
	stage?: string | null
	status?: string
	notes?: string | null
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
			? prisma.teams.findMany({ where: { id: { in: teamIds } }, select: { id: true, name: true } })
			: [],
	])
	const ownerById = new Map(owners.map((o) => [o.id, o]))
	const contactById = new Map(contacts.map((c) => [c.id, c]))
	const teamById = new Map(teams.map((t) => [t.id, t.name]))
	return rows.map((row) => ({
		id: row.id,
		contactId: row.contact_id,
		contactName: row.contact_id ? contactById.get(row.contact_id)?.name || null : null,
		ownerId: row.owner_id,
		ownerName: row.owner_id
			? ownerById.get(row.owner_id)?.name || ownerById.get(row.owner_id)?.email?.split('@')[0] || null
			: null,
		teamId: row.team_id,
		teamName: row.team_id ? teamById.get(row.team_id) || null : null,
		name: row.name,
		product: row.product,
		value: row.value != null ? Number(row.value) : null,
		currency: row.currency,
		status: row.status,
		stage: row.stage,
		source: row.source,
		notes: row.notes,
		closedAt: row.closed_at ? row.closed_at.toISOString() : null,
		createdAt: row.created_at ? row.created_at.toISOString() : null,
		updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
	}))
}

export abstract class OpportunityService {
	static async list(
		appId: string,
		options: {
			status?: string
			ownerId?: string
			contactId?: string
			search?: string
			limit?: number
			offset?: number
		},
	) {
		const rows = await prisma.opportunities.findMany({
			where: {
				app_id: appId,
				...(options.status ? { status: options.status } : {}),
				...(options.ownerId ? { owner_id: options.ownerId } : {}),
				...(options.contactId ? { contact_id: options.contactId } : {}),
				...(options.search
					? { name: { contains: options.search, mode: 'insensitive' as const } }
					: {}),
			},
			orderBy: { created_at: 'desc' },
			skip: Math.max(0, options.offset || 0),
			take: Math.max(1, Math.min(100, options.limit || 50)),
		})
		return enrich(rows)
	}

	// Totals per status + summed value, for the page header.
	static async stats(appId: string) {
		const grouped = await prisma.opportunities.groupBy({
			by: ['status'],
			where: { app_id: appId },
			_count: { _all: true },
			_sum: { value: true },
		})
		const base: Record<string, { count: number; value: number }> = {
			open: { count: 0, value: 0 },
			won: { count: 0, value: 0 },
			lost: { count: 0, value: 0 },
		}
		for (const g of grouped) {
			base[g.status] = {
				count: g._count._all,
				value: g._sum.value != null ? Number(g._sum.value) : 0,
			}
		}
		return base
	}

	static async getById(appId: string, id: string) {
		if (!isUuid(id)) return null
		const row = await prisma.opportunities.findFirst({ where: { id, app_id: appId } })
		if (!row) return null
		return (await enrich([row]))[0]
	}

	static async create(actor: OpportunityActor, input: CreateInput) {
		const name = input.name?.trim()
		if (!name) throw new Error('Nama opportunity wajib diisi')

		const ownerId = input.ownerId || actor.userId || null
		const teamId = await resolveTeamId(actor.appId, ownerId)
		const status = normalizeStatus(input.status)

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
				status,
				stage: input.stage?.slice(0, 60) || null,
				source: 'manual',
				notes: input.notes || null,
				created_by: actor.userId,
				closed_at: status === 'won' || status === 'lost' ? new Date() : null,
			},
		})
		return (await enrich([row]))[0]
	}

	static async update(appId: string, id: string, input: UpdateInput) {
		if (!isUuid(id)) return null
		const existing = await prisma.opportunities.findFirst({
			where: { id, app_id: appId },
			select: { id: true, status: true },
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
		if (input.stage !== undefined) data.stage = input.stage?.slice(0, 60) || null
		if (input.notes !== undefined) data.notes = input.notes || null
		if (input.status !== undefined) {
			const status = normalizeStatus(input.status)
			data.status = status
			// Stamp/clear the close time as the deal opens or closes.
			data.closed_at = status === 'won' || status === 'lost' ? new Date() : null
		}

		const row = await prisma.opportunities.update({ where: { id }, data })
		return (await enrich([row]))[0]
	}

	static async remove(appId: string, id: string) {
		if (!isUuid(id)) return false
		const result = await prisma.opportunities.deleteMany({ where: { id, app_id: appId } })
		return result.count > 0
	}
}
