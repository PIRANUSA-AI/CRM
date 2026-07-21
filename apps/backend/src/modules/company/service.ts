import prisma from '../../lib/prisma'
import { Prisma } from '../../generated/prisma'
import { resolveStage } from '../opportunities/stages'
import { displayCompanyName, normalizeCompanyName } from '../../lib/company'
import { industryLabel, isIndustry } from './industries'

/**
 * Reading companies.
 *
 * Visibility is deliberately derived rather than owned: a company is visible to
 * whoever can already see at least one of its contacts. That keeps one answer to
 * "whose is this": the one Phase 1 materialised onto contacts.owner_id, instead
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
	type: string
	contact_count: number
	deal_count: number
	deal_value: number
	last_activity_at: Date | null
	updated_at: Date | null
	created_at: Date | null
	/** A few PIC names, for the avatar stack, not the whole list. */
	contact_preview: string[]
	/** The sales working this firm, with their team. Usually one, sometimes two. */
	owners: Array<{ name: string; team: string | null }>
}

type ListParams = {
	appId: string
	search?: string
	page?: number
	perPage?: number
	viewerRole?: string
	viewerUserId?: string
	viewerTeamIds?: string[]
	/** perusahaan | perorangan */
	type?: string
	city?: string
	/** Only firms with at least one deal. */
	hasDeals?: boolean
	teamId?: string
	ownerId?: string
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


const IDR = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0,
})

const FIELD_LABELS: Record<string, string> = {
	name: 'Nama',
	city: 'Kota',
	website: 'Website',
	notes: 'Catatan',
	type: 'Tipe',
	industry: 'Industri',
}

/** Render a logged value for the feed. Long notes are cut: the timeline says
 *  what changed, and the field itself holds the text. */
function describe(value: unknown): string {
	if (value === null || value === undefined || value === '') return '(kosong)'
	const text = String(value)
	return text.length > 40 ? `${text.slice(0, 40)}…` : text
}

export const CompanyService = {
	async listCompanies(params: ListParams) {
		const page = Math.max(1, params.page || 1)
		const perPage = Math.min(100, Math.max(1, params.perPage || 20))
		const offset = (page - 1) * perPage

		const scope = contactScope(params)
		const search = String(params.search || '').trim()

		// Every narrowing the caller asked for, gathered once so the page query
		// and the count query cannot drift apart. A filtered list above a total
		// that ignored the filter is the classic way this breaks.
		const filters: Prisma.Sql[] = []
		if (search) filters.push(Prisma.sql`AND co.name ILIKE ${`%${search}%`}`)
		if (params.type) filters.push(Prisma.sql`AND co.type = ${params.type}`)
		let cityFilterIndex = -1
		if (params.city) {
			cityFilterIndex = filters.length
			filters.push(Prisma.sql`AND co.city = ${params.city}`)
		}
		if (params.hasDeals) {
			filters.push(Prisma.sql`AND EXISTS (
				SELECT 1 FROM opportunities o
				JOIN contacts c ON c.id = o.contact_id
				WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
			)`)
		}
		// Team and owner narrow through the contacts, because that is where
		// ownership lives. A company has no owner of its own, deliberately.
		if (params.teamId) {
			filters.push(Prisma.sql`AND EXISTS (
				SELECT 1 FROM contacts c
				WHERE c.company_id = co.id AND c.deleted_at IS NULL
					AND c.team_id = ${params.teamId}::uuid ${scope}
			)`)
		}
		if (params.ownerId) {
			filters.push(Prisma.sql`AND EXISTS (
				SELECT 1 FROM contacts c
				WHERE c.company_id = co.id AND c.deleted_at IS NULL
					AND c.owner_id = ${params.ownerId}::uuid ${scope}
			)`)
		}
		const searchClause = filters.length ? Prisma.sql`${Prisma.join(filters, ' ')}` : Prisma.empty

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
				type: string
				contact_count: bigint
				deal_count: bigint
				deal_value: Prisma.Decimal | null
				last_activity_at: Date | null
				updated_at: Date | null
				created_at: Date | null
				contact_preview: string[] | null
				owners: Array<{ name: string | null; team: string | null }> | null
			}>
		>`
			SELECT co.id, co.name, co.city, co.website, co.notes, co.type,
				co.created_at, co.updated_at,
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
				) AS last_activity_at,
				-- Capped at four: the column shows an avatar stack, not a roster,
				-- and a firm with forty PIC must not drag forty names per row.
				(
					SELECT COALESCE(ARRAY_AGG(x.name ORDER BY x.name), '{}')
					FROM (
						SELECT c.name FROM contacts c
						WHERE c.company_id = co.id AND c.deleted_at IS NULL AND c.name IS NOT NULL ${scope}
						ORDER BY c.name LIMIT 4
					) x
				) AS contact_preview,
				(
					SELECT COALESCE(JSON_AGG(DISTINCT JSONB_BUILD_OBJECT('name', u.name, 'team', t.name)), '[]')
					FROM contacts c
					JOIN users u ON u.id = c.owner_id
					LEFT JOIN teams t ON t.id = c.team_id
					WHERE c.company_id = co.id AND c.deleted_at IS NULL ${scope}
				) AS owners
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

		// The cities the filter can offer. Built without the city filter applied,
		// so picking Bandung does not empty the dropdown that offered it, the
		// same mistake the won-year filter on the deals board had to avoid.
		const cityFilters = filters.filter((_, index) => index !== cityFilterIndex)
		const cityClause = cityFilters.length ? Prisma.sql`${Prisma.join(cityFilters, ' ')}` : Prisma.empty
		const cityRows = await prisma.$queryRaw<Array<{ city: string }>>`
			SELECT DISTINCT co.city FROM companies co
			WHERE co.app_id = ${params.appId}::uuid
				AND co.deleted_at IS NULL
				AND co.city IS NOT NULL AND co.city <> ''
				${cityClause}
				AND ${visible}
			ORDER BY co.city ASC
		`

		const payload: CompanyDTO[] = rows.map((row) => ({
			id: row.id,
			name: row.name,
			city: row.city,
			website: row.website,
			notes: row.notes,
			type: row.type || 'perusahaan',
			contact_preview: row.contact_preview ?? [],
			owners: (row.owners ?? [])
				.filter((owner) => owner?.name)
				.map((owner) => ({ name: owner.name as string, team: owner.team })),
			updated_at: row.updated_at,
			contact_count: Number(row.contact_count),
			deal_count: Number(row.deal_count),
			deal_value: Number(row.deal_value || 0),
			last_activity_at: row.last_activity_at,
			created_at: row.created_at,
		}))

		return {
			payload,
			meta: {
				page,
				per_page: perPage,
				total,
				total_pages: Math.ceil(total / perPage),
				cities: cityRows.map((row) => row.city),
			},
		}
	},

	/**
	 * Returns null when the company does not exist OR when none of its contacts
	 * are visible to the viewer. The two are deliberately indistinguishable, so
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
				type: true,
				industry: true,
				updated_at: true,
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
			industry_label: industryLabel(company.industry),
			contacts,
			// Label resolved here rather than in the UI so the company page and the
			// pipeline cannot end up calling the same stage two different things.
			deals: deals.map((deal) => ({
				...deal,
				value: Number(deal.value || 0),
				stage_label: resolveStage(deal.stage).label,
			})),
			// The number the company page exists to answer: what is this firm
			// worth across every PIC we talk to, not per conversation.
			deal_value: deals.reduce((sum, deal) => sum + Number(deal.value || 0), 0),
		}
	},

	/**
	 * Edit the firm's own fields.
	 *
	 * Reuses getCompanyById as the permission check rather than repeating the
	 * scope: if the viewer cannot read this company, they cannot write it, and
	 * the two rules cannot drift apart by being stated twice.
	 *
	 * The name goes through normalizeCompanyName because norm_name carries the
	 * uniqueness constraint, renaming "PT Maju" to something that collapses onto
	 * an existing firm has to be refused rather than left to the database.
	 */
	async updateCompany(
		id: string,
		params: {
			appId: string
			viewerRole?: string
			viewerUserId?: string
			viewerTeamIds?: string[]
		},
		input: {
			name?: string
			city?: string | null
			website?: string | null
			notes?: string | null
			type?: string
			industry?: string | null
		},
	) {
		const existing = await CompanyService.getCompanyById(id, params)
		if (!existing) return null

		const data: Record<string, unknown> = {}

		if (input.name !== undefined) {
			const name = displayCompanyName(input.name)
			const norm = normalizeCompanyName(input.name)
			if (!name || !norm) throw new Error('Nama perusahaan wajib diisi')
			const clash = await prisma.companies.findFirst({
				where: { app_id: params.appId, norm_name: norm, deleted_at: null, NOT: { id } },
				select: { name: true },
			})
			if (clash) throw new Error(`Nama itu bentrok dengan perusahaan "${clash.name}"`)
			data.name = name
			data.norm_name = norm
		}
		if (input.city !== undefined) data.city = input.city?.trim() || null
		if (input.website !== undefined) data.website = input.website?.trim() || null
		if (input.notes !== undefined) data.notes = input.notes?.trim() || null
		if (input.type !== undefined) {
			data.type = input.type === 'perorangan' ? 'perorangan' : 'perusahaan'
		}
		if (input.industry !== undefined) {
			// An unrecognised id is stored as null rather than kept, so the column
			// can only ever hold something industryLabel knows how to render.
			data.industry = isIndustry(input.industry) ? input.industry : null
		}

		if (Object.keys(data).length === 0) return existing

		// What actually changed, recorded before the write so the "from" value is
		// still the old one. norm_name is skipped: it is derived from the name and
		// logging both would report one rename twice.
		const changes: Array<{ field: string; from: unknown; to: unknown }> = []
		for (const [field, to] of Object.entries(data)) {
			if (field === 'norm_name') continue
			const from = (existing as Record<string, unknown>)[field] ?? null
			if (from !== to) changes.push({ field, from, to })
		}

		await prisma.companies.update({ where: { id }, data })

		if (changes.length) {
			await prisma.company_activity_log.create({
				data: {
					company_id: id,
					action: 'company_updated',
					actor_id: params.viewerUserId ?? null,
					metadata: { changes } as never,
				},
			})
		}

		return CompanyService.getCompanyById(id, params)
	},

	/**
	 * Attach or detach a contact.
	 *
	 * Both sides are checked against the viewer's scope: attaching a contact you
	 * cannot see would let a sales discover who else works at a firm by trying
	 * ids, and detaching one would let them quietly remove another team's PIC.
	 */
	async setContactLink(
		companyId: string,
		params: { appId: string; viewerRole?: string; viewerUserId?: string; viewerTeamIds?: string[] },
		input: { contactId: string; attach: boolean },
	) {
		const company = await CompanyService.getCompanyById(companyId, params)
		if (!company) return null

		const scope = contactScope(params)
		const allowed = await prisma.$queryRaw<Array<{ id: string }>>`
			SELECT c.id FROM contacts c
			WHERE c.id = ${input.contactId}::uuid
				AND c.app_id = ${params.appId}::uuid
				AND c.deleted_at IS NULL ${scope}
		`
		if (!allowed.length) return null

		const contact = await prisma.contacts.findUnique({
			where: { id: input.contactId },
			select: { name: true },
		})

		await prisma.contacts.update({
			where: { id: input.contactId },
			data: input.attach
				? { company_id: companyId, company: company.name }
				: // The free-text company is cleared with the link. Leaving it would
					// show the contact as still working there on every screen that
					// falls back to the text when company_id is null.
					{ company_id: null, company: null },
		})

		await prisma.company_activity_log.create({
			data: {
				company_id: companyId,
				action: input.attach ? 'contact_attached' : 'contact_detached',
				actor_id: params.viewerUserId ?? null,
				target_id: input.contactId,
				// The name is copied rather than joined at read time so the entry
				// still reads correctly after the contact is renamed or deleted.
				metadata: { contact_name: contact?.name ?? null } as never,
			},
		})

		return CompanyService.getCompanyById(companyId, params)
	},
	/**
	 * Activity for one firm, newest first.
	 *
	 * Two sources merged into one feed. Edits come from company_activity_log,
	 * because nothing else records them. Everything else is derived from rows
	 * that already exist. The firm's own creation, contacts joining, deals
	 * opening and closing, which follows how the contact timeline is built and
	 * means no event has to be written twice to be shown.
	 *
	 * Scoped through getCompanyById, so a company the viewer cannot read has no
	 * readable history either.
	 */
	async getCompanyTimeline(
		id: string,
		params: { appId: string; viewerRole?: string; viewerUserId?: string; viewerTeamIds?: string[] },
	) {
		const company = await CompanyService.getCompanyById(id, params)
		if (!company) return null

		const scope = contactScope(params)

		const [logs, contacts, deals] = await Promise.all([
			prisma.company_activity_log.findMany({
				where: { company_id: id },
				orderBy: { created_at: 'desc' },
				take: 100,
			}),
			prisma.$queryRaw<Array<{ id: string; name: string | null; created_at: Date | null }>>`
				SELECT c.id, c.name, c.created_at FROM contacts c
				WHERE c.company_id = ${id}::uuid AND c.deleted_at IS NULL ${scope}
			`,
			prisma.$queryRaw<
				Array<{
					id: string
					name: string
					stage: string | null
					status: string
					value: Prisma.Decimal | null
					created_at: Date | null
					stage_changed_at: Date | null
					closed_at: Date | null
					contact_name: string | null
				}>
			>`
				SELECT o.id, o.name, o.stage, o.status, o.value, o.created_at,
					o.stage_changed_at, o.closed_at, c.name AS contact_name
				FROM opportunities o
				JOIN contacts c ON c.id = o.contact_id
				WHERE c.company_id = ${id}::uuid AND c.deleted_at IS NULL ${scope}
			`,
		])

		const actorIds = [...new Set(logs.map((row) => row.actor_id).filter(Boolean))] as string[]
		const actors = actorIds.length
			? await prisma.users.findMany({
					where: { id: { in: actorIds } },
					select: { id: true, name: true, email: true },
				})
			: []
		const actorById = new Map(actors.map((actor) => [actor.id, actor]))

		type Event = {
			id: string
			type: string
			title: string
			description: string | null
			tone: 'default' | 'info' | 'success' | 'warning'
			actorName: string | null
			at: Date
		}
		const events: Event[] = []

		for (const log of logs) {
			const actor = log.actor_id ? actorById.get(log.actor_id) : null
			const actorName = actor?.name || actor?.email?.split('@')[0] || null
			const meta = (log.metadata ?? {}) as Record<string, unknown>
			const at = log.created_at ?? new Date()

			if (log.action === 'company_updated') {
				const changes = Array.isArray(meta.changes)
					? (meta.changes as Array<{ field: string; from: unknown; to: unknown }>)
					: []
				events.push({
					id: log.id,
					type: 'company_updated',
					title: 'Data perusahaan diubah',
					description:
						changes
							.map((change) => `${FIELD_LABELS[change.field] || change.field}: ${describe(change.from)} → ${describe(change.to)}`)
							.join(', ') || null,
					tone: 'info',
					actorName,
					at,
				})
			} else if (log.action === 'contact_attached' || log.action === 'contact_detached') {
				const attached = log.action === 'contact_attached'
				events.push({
					id: log.id,
					type: log.action,
					title: attached ? 'Kontak ditautkan' : 'Kontak dilepas',
					description: (meta.contact_name as string) || 'Tanpa nama',
					tone: attached ? 'success' : 'warning',
					actorName,
					at,
				})
			}
		}

		for (const contact of contacts) {
			if (!contact.created_at) continue
			events.push({
				id: `contact-${contact.id}`,
				type: 'contact_created',
				title: 'Kontak masuk',
				description: contact.name || 'Tanpa nama',
				tone: 'default',
				actorName: null,
				at: contact.created_at,
			})
		}

		for (const deal of deals) {
			const amount = Number(deal.value || 0)
			const suffix = amount ? ` · ${IDR.format(amount)}` : ''
			if (deal.created_at) {
				events.push({
					id: `deal-${deal.id}`,
					type: 'deal_created',
					title: 'Deal dibuka',
					description: `${deal.name}${suffix}`,
					tone: 'info',
					actorName: null,
					at: deal.created_at,
				})
			}
			// Only when it differs from creation: a deal that never moved would
			// otherwise report being "moved" to the stage it started in.
			if (
				deal.stage_changed_at &&
				deal.created_at &&
				deal.stage_changed_at.getTime() - deal.created_at.getTime() > 1000 &&
				deal.status === 'open'
			) {
				events.push({
					id: `deal-stage-${deal.id}`,
					type: 'deal_stage',
					title: `Deal pindah ke ${resolveStage(deal.stage).label}`,
					description: deal.name,
					tone: 'info',
					actorName: null,
					at: deal.stage_changed_at,
				})
			}
			if (deal.closed_at && (deal.status === 'won' || deal.status === 'lost')) {
				events.push({
					id: `deal-closed-${deal.id}`,
					type: deal.status === 'won' ? 'deal_won' : 'deal_lost',
					title: deal.status === 'won' ? 'Deal menang' : 'Deal kalah',
					description: `${deal.name}${suffix}`,
					tone: deal.status === 'won' ? 'success' : 'warning',
					actorName: null,
					at: deal.closed_at,
				})
			}
		}

		if (company.created_at) {
			events.push({
				id: `company-${company.id}`,
				type: 'company_created',
				title: 'Perusahaan terdaftar',
				description: company.name,
				tone: 'default',
				actorName: null,
				at: company.created_at,
			})
		}

		return events
			.sort((a, b) => b.at.getTime() - a.at.getTime())
			.slice(0, 100)
			.map((event) => ({ ...event, at: event.at.toISOString() }))
	},
}
