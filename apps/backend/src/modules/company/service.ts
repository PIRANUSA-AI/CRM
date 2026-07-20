import prisma from '../../lib/prisma'
import { Prisma } from '../../generated/prisma'

/**
 * Reading companies.
 *
 * Visibility is deliberately derived rather than owned: a company is visible to
 * whoever can already see at least one of its contacts. That keeps one answer to
 * "whose is this" — the one Phase 1 materialised onto contacts.owner_id — instead
 * of adding a second ownership model that would be free to disagree with it.
 * A sales who is handed a contact gains the company with it, and loses it the
 * same way, without anybody maintaining a separate list.
 */

export type CompanyDTO = {
	id: string
	name: string
	city: string | null
	website: string | null
	notes: string | null
	contact_count: number
	deal_count: number
	deal_value: number
	last_activity_at: Date | null
	created_at: Date | null
}

type ListParams = {
	appId: string
	search?: string
	page?: number
	perPage?: number
	viewerRole?: string
	viewerUserId?: string
	viewerTeamIds?: string[]
}

/**
 * The contact-level scope, expressed once and reused by both the list and the
 * detail read so they cannot drift apart. Mirrors CustomerService.listCustomers:
 * a sales sees their own, a leader sees their teams', the administrator tier
 * sees everything, and a leader with no team fails closed to nothing.
 */
function contactScope(params: {
	viewerRole?: string
	viewerUserId?: string
	viewerTeamIds?: string[]
}): Prisma.Sql {
	const role = String(params.viewerRole || '').trim().toLowerCase()

	if (role === 'sales' && params.viewerUserId) {
		return Prisma.sql`AND c.owner_id = ${params.viewerUserId}::uuid`
	}
	if (role === 'leader') {
		const teamIds = params.viewerTeamIds ?? []
		if (!teamIds.length) return Prisma.sql`AND FALSE`
		return Prisma.sql`AND c.team_id IN (${Prisma.join(
			teamIds.map((id) => Prisma.sql`${id}::uuid`),
		)})`
	}
	return Prisma.empty
}

export const CompanyService = {
	async listCompanies(params: ListParams) {
		const page = Math.max(1, params.page || 1)
		const perPage = Math.min(100, Math.max(1, params.perPage || 20))
		const offset = (page - 1) * perPage

		const scope = contactScope(params)
		const search = String(params.search || '').trim()
		const searchClause = search
			? Prisma.sql`AND co.name ILIKE ${`%${search}%`}`
			: Prisma.empty

		// A company with no visible contact is not listed at all. Without the
		// EXISTS a sales would see every firm in the database and only find out
		// it was not theirs on opening it.
		const visible = Prisma.sql`
			EXISTS (
				SELECT 1 FROM contacts c
				WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
			)
		`

		// Correlated subqueries rather than two LEFT JOINs and a GROUP BY: joining
		// contacts and opportunities together fans out one row per pair, so the
		// contact count would multiply by the number of deals and the value would
		// need a DISTINCT that silently drops two deals worth the same amount.
		const rows = await prisma.$queryRaw<
			Array<{
				id: string
				name: string
				city: string | null
				website: string | null
				notes: string | null
				contact_count: bigint
				deal_count: bigint
				deal_value: Prisma.Decimal | null
				last_activity_at: Date | null
				created_at: Date | null
			}>
		>`
			SELECT co.id, co.name, co.city, co.website, co.notes, co.created_at,
				(
					SELECT COUNT(*) FROM contacts c
					WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
				) AS contact_count,
				(
					SELECT COUNT(*) FROM opportunities o
					JOIN contacts c ON c.id = o.contact_id
					WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
				) AS deal_count,
				(
					SELECT COALESCE(SUM(o.value), 0) FROM opportunities o
					JOIN contacts c ON c.id = o.contact_id
					WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
				) AS deal_value,
				(
					SELECT MAX(c.last_activity_at) FROM contacts c
					WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
				) AS last_activity_at
			FROM companies co
			WHERE co.app_id = ${params.appId}::uuid
				AND co.deleted_at IS NULL
				${searchClause}
				AND ${visible}
			ORDER BY co.name ASC
			LIMIT ${perPage} OFFSET ${offset}
		`

		const totalRows = await prisma.$queryRaw<Array<{ total: bigint }>>`
			SELECT COUNT(*) AS total FROM companies co
			WHERE co.app_id = ${params.appId}::uuid
				AND co.deleted_at IS NULL
				${searchClause}
				AND ${visible}
		`
		const total = Number(totalRows[0]?.total || 0)

		const payload: CompanyDTO[] = rows.map((row) => ({
			id: row.id,
			name: row.name,
			city: row.city,
			website: row.website,
			notes: row.notes,
			contact_count: Number(row.contact_count),
			deal_count: Number(row.deal_count),
			deal_value: Number(row.deal_value || 0),
			last_activity_at: row.last_activity_at,
			created_at: row.created_at,
		}))

		return {
			payload,
			meta: { page, per_page: perPage, total, total_pages: Math.ceil(total / perPage) },
		}
	},

	/**
	 * Returns null when the company does not exist OR when none of its contacts
	 * are visible to the viewer — the two are deliberately indistinguishable, so
	 * a 404 does not confirm that a firm we hide from this user exists.
	 */
	async getCompanyById(
		id: string,
		params: { appId: string; viewerRole?: string; viewerUserId?: string; viewerTeamIds?: string[] },
	) {
		const scope = contactScope(params)

		const company = await prisma.companies.findFirst({
			where: { id, app_id: params.appId, deleted_at: null },
			select: {
				id: true,
				name: true,
				city: true,
				website: true,
				notes: true,
				created_at: true,
			},
		})
		if (!company) return null

		const contacts = await prisma.$queryRaw<
			Array<{
				id: string
				name: string | null
				email: string | null
				phone_number: string | null
				owner_name: string | null
				last_activity_at: Date | null
			}>
		>`
			SELECT c.id, c.name, c.email, c.phone_number, c.last_activity_at,
				u.name AS owner_name
			FROM contacts c
			LEFT JOIN users u ON u.id = c.owner_id
			WHERE c.company_id = ${id}::uuid AND c.deleted_at IS NULL ${scope}
			ORDER BY c.last_activity_at DESC NULLS LAST, c.name ASC
		`
		if (!contacts.length) return null

		const deals = await prisma.$queryRaw<
			Array<{
				id: string
				name: string
				stage: string | null
				value: Prisma.Decimal | null
				probability: number | null
				contact_name: string | null
			}>
		>`
			SELECT o.id, o.name, o.stage, o.value, o.probability, c.name AS contact_name
			FROM opportunities o
			JOIN contacts c ON c.id = o.contact_id
			WHERE c.company_id = ${id}::uuid AND c.deleted_at IS NULL ${scope}
			ORDER BY o.updated_at DESC
		`

		return {
			...company,
			contacts,
			deals: deals.map((deal) => ({ ...deal, value: Number(deal.value || 0) })),
			// The number the company page exists to answer: what is this firm
			// worth across every PIC we talk to, not per conversation.
			deal_value: deals.reduce((sum, deal) => sum + Number(deal.value || 0), 0),
		}
	},
}
