import prisma from '../../lib/prisma'
import { Prisma } from '../../generated/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'
import { resolveCompany } from '../../lib/company'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'
import { normalizePhone } from '../import/parser'

/** Raised when a manual add collides with a contact that already exists. */
export class CustomerDuplicateError extends Error {
	constructor(
		message: string,
		readonly existingId: string,
	) {
		super(message)
	}
}

type CustomerTag = {
	id: string
	name: string
	color: string
}

type CustomerDTO = {
	id: string
	name: string
	email: string | null
	phone_number: string | null
	avatar_url: string | null
	city: string | null
	company_id: string | null
	company_name: string | null
	owner_id: string | null
	owner_name: string | null
	deal_count: number
	updated_at: Date | null
	source: string | null
	created_at: Date | null
	last_contact_at: Date | null
	pipeline_stage_id: string | null
	pipeline_stage_name: string | null
	pipeline_stage_color: string | null
	is_window_active: boolean
	message_count: number
	notes: string | null
	lead_score: number
	consent_status: string | null
	custom_attributes: Record<string, unknown>
	ltv?: number
	total_spent?: number
	order_count?: number
	total_orders?: number
	paid_order_count?: number
	tags: CustomerTag[]
}

type CustomerStatsDTO = {
	total: number
	consented: number
	active_window: number
	blacklisted: number
}

type CustomerSortField =
	| 'name'
	| 'contact'
	| 'stage'
	| 'tags'
	| 'window'
	| 'messages'
	| 'last_contact'
	| 'created_at'

type CustomerSortOrder = 'asc' | 'desc'

type SortedCustomerRow = {
	id: string
	message_count: number | bigint
	last_contact_at: Date | string | null
}

type CustomerOrderStatsRow = {
	contact_id: string
	total_spent: number | string | null
	paid_order_count: number | bigint | null
}

type CustomerOrderStats = {
	totalSpent: number
	paidOrderCount: number
}

type CustomerLevelKey = 'vip' | 'premium' | 'basic'

type CustomerLevelDefinition = {
	id: CustomerLevelKey
	label: string
	minimum_total_order: number
}

type CustomerLevelAgentMappings = Record<CustomerLevelKey, string | null>

type CustomerLevelSettingsDTO = {
	levels: CustomerLevelDefinition[]
	mappings: CustomerLevelAgentMappings
}

type CustomerLevelPreviewItem = {
	customer_id: string
	customer_name: string
	email: string | null
	phone_number: string | null
	total_spent: number
	paid_order_count: number
	level_id: CustomerLevelKey | null
	level_label: string | null
	mapped_chatbot_id: string | null
	mapped_chatbot_name: string | null
	mapped_persona_id: string | null
	mapped_persona_name: string | null
}

type CustomerLevelRoutingResolution = {
	level_id: CustomerLevelKey | null
	level_label: string | null
	total_spent: number
	mapped_chatbot_id: string | null
	mapped_persona_id: string | null
}

const CUSTOMER_LEVEL_DEFINITIONS: CustomerLevelDefinition[] = [
	{
		id: 'vip',
		label: 'VIP',
		minimum_total_order: 20_000_000,
	},
	{
		id: 'premium',
		label: 'Premium',
		minimum_total_order: 10_000_000,
	},
	{
		id: 'basic',
		label: 'Basic',
		minimum_total_order: 0,
	},
]

const DEFAULT_CUSTOMER_LEVEL_MAPPINGS: CustomerLevelAgentMappings = {
	vip: null,
	premium: null,
	basic: null,
}

type ResolvedCustomerLevelAgent = {
	chatbot_id: string | null
	chatbot_name: string | null
	persona_id: string | null
	persona_name: string | null
}

function cloneCustomerLevelDefinitions(): CustomerLevelDefinition[] {
	return CUSTOMER_LEVEL_DEFINITIONS.map((item) => ({ ...item }))
}

function cloneDefaultMappings(): CustomerLevelAgentMappings {
	return {
		vip: DEFAULT_CUSTOMER_LEVEL_MAPPINGS.vip,
		premium: DEFAULT_CUSTOMER_LEVEL_MAPPINGS.premium,
		basic: DEFAULT_CUSTOMER_LEVEL_MAPPINGS.basic,
	}
}

function normalizeCustomerLevelMappingValue(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	if (!normalized) return null
	return isUuid(normalized) ? normalized : null
}

async function resolveCustomerLevelAgent(
	appId: string,
	mappedAgentId: string | null,
): Promise<ResolvedCustomerLevelAgent> {
	if (!mappedAgentId || !isUuid(mappedAgentId)) {
		return {
			chatbot_id: null,
			chatbot_name: null,
			persona_id: null,
			persona_name: null,
		}
	}

	const [chatbot, persona] = await Promise.all([
		prisma.chatbots.findFirst({
			where: {
				id: mappedAgentId,
				app_id: appId,
				is_deleted: false,
			},
			select: {
				id: true,
				name: true,
			},
		}),
		prisma.ai_playground_personas.findFirst({
			where: {
				id: mappedAgentId,
				app_id: appId,
			},
			select: {
				id: true,
				label: true,
			},
		}),
	])

	return {
		chatbot_id: chatbot?.id || null,
		chatbot_name: chatbot?.name || null,
		persona_id: persona?.id || null,
		persona_name: persona?.label || null,
	}
}

function resolveCustomerLevelFromTotalSpent(
	totalSpent: number,
): CustomerLevelKey | null {
	if (totalSpent > 20_000_000) return 'vip'
	if (totalSpent > 10_000_000) return 'premium'
	return 'basic'
}

function resolveCustomerLevelLabel(
	level: CustomerLevelKey | null,
): string | null {
	if (!level) return null
	const matched = CUSTOMER_LEVEL_DEFINITIONS.find((item) => item.id === level)
	return matched?.label || null
}

const CUSTOMER_SORT_SQL: Record<CustomerSortField, Prisma.Sql> = {
	name: Prisma.sql`LOWER(COALESCE(c.name, ''))`,
	contact: Prisma.sql`LOWER(COALESCE(NULLIF(c.phone_number, ''), NULLIF(c.email, ''), ''))`,
	stage: Prisma.sql`LOWER(COALESCE(c.custom_attributes->>'pipeline_stage_name', ''))`,
	tags: Prisma.sql`COALESCE(tag_stats.tag_count, 0)`,
	window: Prisma.sql`CASE WHEN c.window_expires_at IS NOT NULL AND c.window_expires_at > NOW() THEN 1 ELSE 0 END`,
	messages: Prisma.sql`COALESCE(conv_stats.message_count, 0)`,
	last_contact: Prisma.sql`COALESCE(conv_stats.last_contact_at, c.last_message_at, c.created_at)`,
	created_at: Prisma.sql`COALESCE(c.created_at, NOW())`,
}

function parseJsonObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function toNumber(value: unknown, fallback = 0): number {
	const num = Number(value)
	return Number.isFinite(num) ? num : fallback
}

/**
 * Turn a raw contact `source` into a readable label for the activity timeline.
 * Prospect sources are stored as `prospect:<channel>` by the prospect form.
 */
function formatTimelineSource(source: string): string {
	const PROSPECT_LABELS: Record<string, string> = {
		event: 'Event',
		linkedin: 'LinkedIn',
		instagram: 'Instagram',
		whatsapp: 'WhatsApp',
		referral: 'Referral',
		other: 'Lainnya',
	}
	if (source.startsWith('prospect:')) {
		const channel = source.slice('prospect:'.length)
		return `Prospek · ${PROSPECT_LABELS[channel] || channel}`
	}
	return source
}

function toDateOrNull(value: unknown): Date | null {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value
	if (typeof value === 'string' || typeof value === 'number') {
		const parsed = new Date(value)
		if (!Number.isNaN(parsed.getTime())) return parsed
	}
	return null
}

function resolveSortField(value?: string): CustomerSortField {
	const normalized = (value || '').trim().toLowerCase()
	if (normalized in CUSTOMER_SORT_SQL) return normalized as CustomerSortField
	return 'created_at'
}

function resolveSortOrder(value?: string): CustomerSortOrder {
	return value?.toLowerCase() === 'asc' ? 'asc' : 'desc'
}

function normalizeSearch(value?: string): string | undefined {
	const normalized = value?.trim()
	if (!normalized) return undefined

	const lowered = normalized.toLowerCase()
	if (lowered === 'undefined' || lowered === 'null') return undefined

	return normalized
}

function mapContactToCustomer(
	contact: {
		id: string
		name: string | null
		email: string | null
		phone_number: string | null
		avatar_url: string | null
		source: string | null
		channel_type: string | null
		created_at: Date | null
		window_expires_at: Date | null
		consent_status: string | null
		custom_attributes: unknown
		pipeline_stage_id?: string | null
		city?: string | null
		owner_id?: string | null
		updated_at?: Date | null
		companies?: { id: string; name: string } | null
	},
	messageCount: number,
	lastContactAt: Date | null,
	tags: CustomerTag[],
	stageMap?: Map<string, { name: string; color: string | null }>,
	orderStats?: CustomerOrderStats,
	/** Appended last so no existing positional argument shifts. */
	extras?: { ownerName?: string | null; dealCount?: number },
): CustomerDTO {
	const customAttributes = parseJsonObject(contact.custom_attributes)
	// The column is the answer; the JSON key is only consulted for rows written
	// before it existed, and is not written to any more.
	const stageId =
		contact.pipeline_stage_id ||
		(typeof customAttributes.pipeline_stage_id === 'string'
			? customAttributes.pipeline_stage_id
			: null)
	const stageMeta = stageId && stageMap ? stageMap.get(stageId) : undefined

	return {
		id: contact.id,
		name: contact.name || 'Unknown',
		email: contact.email,
		phone_number: contact.phone_number,
		avatar_url: contact.avatar_url,
		// Carried so a picker can show which firm a contact belongs to at the
		// moment it is chosen, instead of naming a person with no context.
		// The stored column first, then the JSON blob it used to live in — an
		// older contact still keeps its city there and would otherwise read blank.
		city:
			contact.city ||
			(typeof customAttributes.city === 'string' ? customAttributes.city : null) ||
			null,
		company_id: contact.companies?.id ?? null,
		company_name: contact.companies?.name ?? null,
		owner_id: contact.owner_id ?? null,
		owner_name: extras?.ownerName ?? null,
		deal_count: extras?.dealCount ?? 0,
		updated_at: contact.updated_at ?? null,
		source: contact.source || contact.channel_type || 'direct',
		created_at: contact.created_at,
		last_contact_at: lastContactAt,
		pipeline_stage_id: stageId,
		pipeline_stage_name:
			stageMeta?.name ||
			(typeof customAttributes.pipeline_stage_name === 'string'
				? customAttributes.pipeline_stage_name
				: null),
		pipeline_stage_color:
			stageMeta?.color ||
			(typeof customAttributes.pipeline_stage_color === 'string'
				? customAttributes.pipeline_stage_color
				: null),
		is_window_active:
			contact.window_expires_at instanceof Date
				? contact.window_expires_at.getTime() > Date.now()
				: false,
		message_count: messageCount,
		notes:
			typeof customAttributes.notes === 'string'
				? customAttributes.notes
				: null,
		lead_score: toNumber(customAttributes.lead_score, 0),
		consent_status: contact.consent_status,
		custom_attributes: customAttributes,
		...(orderStats
			? {
					ltv: orderStats.totalSpent,
					total_spent: orderStats.totalSpent,
					order_count: orderStats.paidOrderCount,
					total_orders: orderStats.paidOrderCount,
					paid_order_count: orderStats.paidOrderCount,
				}
			: {}),
		tags,
	}
}

// biome-ignore lint/complexity/noStaticOnlyClass: This service module intentionally uses static methods.
export abstract class CustomerService {
	static async getCustomerStats(params: {
		appId: string
	}): Promise<CustomerStatsDTO> {
		const targetAppId = await resolveAppId(params.appId)
		if (!targetAppId) {
			return {
				total: 0,
				consented: 0,
				active_window: 0,
				blacklisted: 0,
			}
		}

		const statsResult = await prisma.$queryRaw<
			{
				total: number | bigint
				consented: number | bigint
				active_window: number | bigint
				blacklisted: number | bigint
			}[]
		>(Prisma.sql`
			SELECT
				COUNT(*)::bigint AS total,
				COUNT(*) FILTER (
					WHERE LOWER(COALESCE(c.consent_status, '')) IN (
						'granted',
						'consented',
						'consent_given',
						'opted_in',
						'opt_in',
						'approved'
					)
				)::bigint AS consented,
				COUNT(*) FILTER (
					WHERE c.window_expires_at IS NOT NULL
						AND c.window_expires_at > NOW()
				)::bigint AS active_window,
				COUNT(*) FILTER (
					WHERE
						LOWER(COALESCE(c.consent_status, '')) IN (
							'blacklisted',
							'blocked',
							'revoked',
							'opted_out',
							'opt_out',
							'unsubscribed'
						)
						OR LOWER(COALESCE(c.additional_attributes->>'is_blacklisted', 'false')) IN ('true', '1', 'yes')
						OR LOWER(COALESCE(c.custom_attributes->>'is_blacklisted', 'false')) IN ('true', '1', 'yes')
				)::bigint AS blacklisted
			FROM contacts c
			WHERE
				(c.account_id = ${targetAppId}::uuid OR c.app_id = ${targetAppId}::uuid)
				AND c.deleted_at IS NULL
		`)

		const row = statsResult[0]

		return {
			total: toNumber(row?.total, 0),
			consented: toNumber(row?.consented, 0),
			active_window: toNumber(row?.active_window, 0),
			blacklisted: toNumber(row?.blacklisted, 0),
		}
	}

	static async listCustomers(params: {
		appId: string
		search?: string
		page?: number
		perPage?: number
		sort?: string
		order?: string
		viewerRole?: string
		viewerUserId?: string
		/**
		 * The teams the viewer leads. Only consulted for a leader — a sales is
		 * narrowed to their own contacts, and the administrator tier spans every
		 * team. Empty for a leader with no team means they see nothing, which is
		 * the correct fail-closed answer rather than falling back to everything.
		 */
		viewerTeamIds?: string[]
		/** belum_beli | sering_beli | idle_90d | prospek — see CUSTOMER_SEGMENTS. */
		segment?: string
		teamId?: string
		ownerId?: string
		/** A contact-pipeline stage id, or 'none' for contacts with no status. */
		stageId?: string
	}) {
		const targetAppId = await resolveAppId(params.appId)
		if (!targetAppId)
			return { payload: [], meta: { page: 1, per_page: 0, total: 0 } }

		const page = Math.max(1, params.page || 1)
		const perPage = Math.min(100, Math.max(1, params.perPage || 20))

		const sortField = resolveSortField(params.sort)
		const sortOrder = resolveSortOrder(params.order)
		const sortSql = CUSTOMER_SORT_SQL[sortField]
		const sortDirectionSql =
			sortOrder === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`
		const search = normalizeSearch(params.search)

		const whereParts: Prisma.Sql[] = [
			Prisma.sql`(c.account_id = ${targetAppId}::uuid OR c.app_id = ${targetAppId}::uuid)`,
			Prisma.sql`c.deleted_at IS NULL`,
		]

		// Ownership is a stored fact now (contacts.owner_id / contacts.team_id),
		// not something re-derived here from conversations, tasks and a JSON key.
		// See lib/contact-ownership.ts for who writes it.
		const viewerRole = String(params.viewerRole || '').trim().toLowerCase()

		if (viewerRole === 'sales' && params.viewerUserId) {
			whereParts.push(Prisma.sql`c.owner_id = ${params.viewerUserId}::uuid`)
		} else if (viewerRole === 'leader') {
			// A leader runs one team and sees that team's contacts — including the
			// ones their sales own. Contacts with no team are the unassigned intake
			// pool and belong to the administrator until they are handed out, so a
			// leader must not see them: they are not yet anybody's, and showing them
			// to both leaders would put every unrouted lead in both teams at once.
			const teamIds = params.viewerTeamIds ?? []
			whereParts.push(
				teamIds.length
					? Prisma.sql`c.team_id IN (${Prisma.join(teamIds.map((id) => Prisma.sql`${id}::uuid`))})`
					: Prisma.sql`FALSE`,
			)
		}

		if (params.stageId) {
			whereParts.push(
				params.stageId === 'none'
					? Prisma.sql`c.pipeline_stage_id IS NULL`
					: Prisma.sql`c.pipeline_stage_id = ${params.stageId}::uuid`,
			)
		}

		if (search) {
			const pattern = `%${search}%`
			whereParts.push(
				Prisma.sql`(
					c.name ILIKE ${pattern}
					OR c.email ILIKE ${pattern}
					OR c.phone_number ILIKE ${pattern}
				)`,
			)
		}

		// Both filters read the stored columns, so "tim: MFG" and "sales: Deska"
		// now agree with what Deska sees in her own list by construction — the two
		// used to be separate SQL expressions that could drift apart.
		if (params.teamId) {
			whereParts.push(Prisma.sql`c.team_id = ${params.teamId}::uuid`)
		}

		if (params.ownerId) {
			whereParts.push(Prisma.sql`c.owner_id = ${params.ownerId}::uuid`)
		}

		// A purchase is a won deal or a paid order. Won deals carry the weight
		// here: the orders table is not populated in this deployment, so keying
		// "sudah pernah beli" on orders alone would mark every contact as never
		// having bought.
		const purchaseCount = Prisma.sql`(
			(SELECT COUNT(*) FROM opportunities o WHERE o.contact_id = c.id AND o.status = 'won')
			+ (SELECT COUNT(*) FROM orders ord WHERE ord.contact_id = c.id
				AND (LOWER(COALESCE(ord.journey_phase,'')) IN ('paid')
					OR LOWER(COALESCE(ord.order_status,'')) IN ('paid','completed')))
		)`

		switch (params.segment) {
			case 'belum_beli':
				whereParts.push(Prisma.sql`${purchaseCount} = 0`)
				break
			case 'sering_beli':
				whereParts.push(Prisma.sql`${purchaseCount} >= 2`)
				break
			case 'idle_90d':
				whereParts.push(
					Prisma.sql`COALESCE(c.last_message_at, c.updated_at, c.created_at) < NOW() - INTERVAL '90 days'`,
				)
				break
			case 'prospek':
				// Has an open deal that has not crossed into opportunity territory.
				whereParts.push(
					Prisma.sql`EXISTS (SELECT 1 FROM opportunities o
						WHERE o.contact_id = c.id AND o.status = 'open' AND o.probability < 50)`,
				)
				break
			default:
				break
		}

		const whereClause = Prisma.sql`${Prisma.join(whereParts, ' AND ')}`

		const totalResult = await prisma.$queryRaw<{ total: number | bigint }[]>(
			Prisma.sql`
				SELECT COUNT(*)::bigint AS total
				FROM contacts c
				WHERE ${whereClause}
			`,
		)
		const total = toNumber(totalResult[0]?.total, 0)

		const sortedRows = await prisma.$queryRaw<SortedCustomerRow[]>(
			Prisma.sql`
				SELECT
					c.id,
					COALESCE(conv_stats.message_count, 0)::int AS message_count,
					COALESCE(conv_stats.last_contact_at, c.last_message_at) AS last_contact_at
				FROM contacts c
				LEFT JOIN (
					SELECT
						conv.contact_id,
						COUNT(m.id)::int AS message_count,
						MAX(conv.last_message_at) AS last_contact_at
					FROM conversations conv
					LEFT JOIN messages m ON m.conversation_id = conv.id
					WHERE conv.contact_id IS NOT NULL
					GROUP BY conv.contact_id
				) AS conv_stats ON conv_stats.contact_id = c.id
				LEFT JOIN (
					SELECT
						cta.contact_id,
						COUNT(*)::int AS tag_count
					FROM contact_tag_assignments cta
					GROUP BY cta.contact_id
				) AS tag_stats ON tag_stats.contact_id = c.id
				WHERE ${whereClause}
				ORDER BY ${sortSql} ${sortDirectionSql} NULLS LAST, c.id ASC
				OFFSET ${(page - 1) * perPage}
				LIMIT ${perPage}
			`,
		)

		const contactIds = sortedRows.map((row) => row.id)
		if (contactIds.length === 0) {
			return {
				payload: [],
				meta: { page, per_page: perPage, total },
			}
		}

		const orderStatsContactIds = contactIds.map((id) => Prisma.sql`${id}::uuid`)
		const [contacts, tagAssignments, orderStatsRows] = await Promise.all([
			prisma.contacts.findMany({
				where: {
					id: { in: contactIds },
					deleted_at: null,
				},
				select: {
					id: true,
					name: true,
					email: true,
					phone_number: true,
					avatar_url: true,
					source: true,
					channel_type: true,
					created_at: true,
					window_expires_at: true,
					consent_status: true,
					custom_attributes: true,
					pipeline_stage_id: true,
					city: true,
					owner_id: true,
					updated_at: true,
					companies: { select: { id: true, name: true } },
				},
			}),
			prisma.contact_tag_assignments.findMany({
				where: { contact_id: { in: contactIds } },
				select: {
					contact_id: true,
					contact_tags: {
						select: { id: true, name: true, color: true },
					},
				},
			}),
			prisma.$queryRaw<CustomerOrderStatsRow[]>(Prisma.sql`
					SELECT
						o.contact_id,
						COALESCE(SUM(o.grand_total), 0)::double precision AS total_spent,
						COUNT(*)::bigint AS paid_order_count
					FROM orders o
					WHERE
						o.app_id = ${targetAppId}::uuid
						AND o.contact_id IN (${Prisma.join(orderStatsContactIds)})
						AND (
							LOWER(COALESCE(o.journey_phase, '')) IN ('paid')
							OR LOWER(COALESCE(o.order_status, '')) IN ('paid', 'completed')
						)
					GROUP BY o.contact_id
				`),
		])

		const stageIds = Array.from(
			new Set(
				contacts
					.map(
						(contact) =>
							parseJsonObject(contact.custom_attributes).pipeline_stage_id,
					)
					.filter((value): value is string => typeof value === 'string'),
			),
		)

		const stageRows =
			stageIds.length > 0
				? await prisma.pipeline_stages.findMany({
						where: { id: { in: stageIds } },
						select: { id: true, name: true, color: true },
					})
				: []
		const stageMap = new Map(
			stageRows.map((stage) => [
				stage.id,
				{ name: stage.name, color: stage.color },
			]),
		)

		const contactsById = new Map(
			contacts.map((contact) => [contact.id, contact]),
		)
		const messageCountByContactId = new Map<string, number>()
		const lastContactAtByContactId = new Map<string, Date>()
		for (const row of sortedRows) {
			messageCountByContactId.set(row.id, toNumber(row.message_count, 0))
			const lastContactAt = toDateOrNull(row.last_contact_at)
			if (lastContactAt) {
				lastContactAtByContactId.set(row.id, lastContactAt)
			}
		}

		const tagsByContactId = new Map<string, CustomerTag[]>()
		for (const assignment of tagAssignments) {
			const existing = tagsByContactId.get(assignment.contact_id) || []
			existing.push({
				id: assignment.contact_tags.id,
				name: assignment.contact_tags.name,
				color: assignment.contact_tags.color || '#3B82F6',
			})
			tagsByContactId.set(assignment.contact_id, existing)
		}

		const orderStatsByContactId = new Map<string, CustomerOrderStats>()
		for (const row of orderStatsRows) {
			orderStatsByContactId.set(row.contact_id, {
				totalSpent: toNumber(row.total_spent, 0),
				paidOrderCount: toNumber(row.paid_order_count, 0),
			})
		}

		// Owner names and deal counts for this page only — two batched lookups
		// rather than a join, so the page query keeps its shape and neither can
		// fan the row set out.
		const pageOwnerIds = [
			...new Set(
				contactIds
					.map((id) => contactsById.get(id)?.owner_id)
					.filter((value): value is string => Boolean(value)),
			),
		]
		const [ownerRows, dealRows] = await Promise.all([
			pageOwnerIds.length
				? prisma.users.findMany({
						where: { id: { in: pageOwnerIds } },
						select: { id: true, name: true, email: true },
					})
				: Promise.resolve([]),
			contactIds.length
				? prisma.opportunities.groupBy({
						by: ['contact_id'],
						where: { contact_id: { in: contactIds } },
						_count: { _all: true },
					})
				: Promise.resolve([]),
		])
		const ownerNameById = new Map(
			ownerRows.map((owner) => [owner.id, owner.name || owner.email?.split('@')[0] || null]),
		)
		const dealCountByContactId = new Map(
			dealRows.map((row) => [row.contact_id as string, row._count._all]),
		)

		const payload = contactIds.flatMap((contactId) => {
			const contact = contactsById.get(contactId)
			if (!contact) return []

			return [
				mapContactToCustomer(
					contact,
					messageCountByContactId.get(contact.id) || 0,
					lastContactAtByContactId.get(contact.id) || null,
					tagsByContactId.get(contact.id) || [],
					stageMap,
					orderStatsByContactId.get(contact.id) || {
						totalSpent: 0,
						paidOrderCount: 0,
					},
					{
						ownerName: contact.owner_id ? ownerNameById.get(contact.owner_id) ?? null : null,
						dealCount: dealCountByContactId.get(contact.id) || 0,
					},
				),
			]
		})

		return {
			payload,
			meta: { page, per_page: perPage, total },
		}
	}

	static async getCustomerById(id: string) {
		if (!isUuid(id)) return null

		const contact = await prisma.contacts.findUnique({
			where: { id },
			select: {
				id: true,
				name: true,
				email: true,
				phone_number: true,
				avatar_url: true,
				source: true,
				channel_type: true,
				created_at: true,
				updated_at: true,
				window_expires_at: true,
				consent_status: true,
				custom_attributes: true,
				pipeline_stage_id: true,
				owner_id: true,
				city: true,
				companies: { select: { id: true, name: true } },
			},
		})
		if (!contact) return null

		// The detail page shows the same firm and sales as the list, so the same
		// two facts are resolved here rather than the page having to ask twice.
		const [owner, dealCount] = await Promise.all([
			contact.owner_id
				? prisma.users.findUnique({
						where: { id: contact.owner_id },
						select: { name: true, email: true },
					})
				: Promise.resolve(null),
			prisma.opportunities.count({ where: { contact_id: contact.id } }),
		])

		// Same precedence as the mapper: the column first, the JSON key only for
		// rows written before it existed. Reading these two differently is how the
		// detail page would name a stage the list did not.
		const stageId =
			contact.pipeline_stage_id ||
			(typeof parseJsonObject(contact.custom_attributes).pipeline_stage_id === 'string'
				? (parseJsonObject(contact.custom_attributes).pipeline_stage_id as string)
				: null)
		const stageMeta =
			stageId &&
			(await prisma.pipeline_stages.findUnique({
				where: { id: stageId },
				select: { id: true, name: true, color: true },
			}))
		const stageMap = new Map<string, { name: string; color: string | null }>()
		if (stageMeta) {
			stageMap.set(stageMeta.id, {
				name: stageMeta.name,
				color: stageMeta.color,
			})
		}

		const [conversations, tagAssignments] = await Promise.all([
			prisma.conversations.findMany({
				where: { contact_id: id },
				select: { id: true, last_message_at: true },
			}),
			prisma.contact_tag_assignments.findMany({
				where: { contact_id: id },
				select: {
					contact_tags: { select: { id: true, name: true, color: true } },
				},
			}),
		])

		const conversationIds = conversations.map((c) => c.id)
		const messageCount =
			conversationIds.length > 0
				? await prisma.messages.count({
						where: { conversation_id: { in: conversationIds } },
					})
				: 0

		const lastContactAt = conversations.reduce<Date | null>((latest, conv) => {
			if (!(conv.last_message_at instanceof Date)) return latest
			if (!latest || conv.last_message_at.getTime() > latest.getTime()) {
				return conv.last_message_at
			}
			return latest
		}, null)

		const tags = tagAssignments.map((assignment) => ({
			id: assignment.contact_tags.id,
			name: assignment.contact_tags.name,
			color: assignment.contact_tags.color || '#3B82F6',
		}))

		return mapContactToCustomer(
			contact,
			messageCount,
			lastContactAt,
			tags,
			stageMap,
			undefined,
			{
				ownerName: owner?.name || owner?.email?.split('@')[0] || null,
				dealCount,
			},
		)
	}

	/**
	 * Unified activity timeline for a contact — the sales↔lead history.
	 *
	 * Merges events from several existing tables (no dedicated audit table):
	 * lead creation, task lifecycle (task_events), internal notes, handover
	 * requests, conversation reassignments and pipeline stage moves. Everything
	 * is normalized to a single shape and returned newest-first so the UI can
	 * render one chronological feed. Conversation-keyed sources are looked up
	 * via the contact's conversations.
	 */
	static async getContactTimeline(id: string) {
		if (!isUuid(id)) return null

		const contact = await prisma.contacts.findUnique({
			where: { id },
			select: {
				id: true,
				created_at: true,
				first_contact_at: true,
				source: true,
			},
		})
		if (!contact) return null

		const conversations = await prisma.conversations.findMany({
			where: { contact_id: id },
			select: { id: true },
		})
		const conversationIds = conversations.map((c) => c.id)
		const hasConversations = conversationIds.length > 0

		const [taskRows, contactNotes, handovers, assignments, stageTransitions] =
			await Promise.all([
				prisma.tasks.findMany({
					where: { contact_id: id },
					select: { id: true, title: true },
				}),
				prisma.contact_notes.findMany({
					where: { contact_id: id },
					select: {
						id: true,
						content: true,
						user_id: true,
						created_at: true,
					},
					orderBy: { created_at: 'desc' },
					take: 50,
				}),
				hasConversations
					? prisma.handover_requests.findMany({
							where: { conversation_id: { in: conversationIds } },
							select: {
								id: true,
								request_type: true,
								status: true,
								requested_by: true,
								target_agent_id: true,
								approved_at: true,
								created_at: true,
							},
						})
					: Promise.resolve([]),
				hasConversations
					? prisma.assignment_history.findMany({
							where: { conversation_id: { in: conversationIds } },
							select: {
								id: true,
								assigned_to: true,
								assigned_from: true,
								assignment_type: true,
								created_at: true,
							},
						})
					: Promise.resolve([]),
				hasConversations
					? prisma.stage_transitions.findMany({
							where: { conversation_id: { in: conversationIds } },
							select: {
								id: true,
								from_stage_id: true,
								to_stage_id: true,
								user_id: true,
								transition_type: true,
								notes: true,
								created_at: true,
							},
						})
					: Promise.resolve([]),
			])

		const taskMap = new Map(taskRows.map((task) => [task.id, task.title]))
		const taskIds = taskRows.map((task) => task.id)
		const taskEvents = taskIds.length
			? await prisma.task_events.findMany({
					where: { task_id: { in: taskIds } },
					select: {
						id: true,
						task_id: true,
						event_type: true,
						actor_id: true,
						actor_type: true,
						reason: true,
						created_at: true,
					},
					orderBy: { created_at: 'desc' },
					take: 200,
				})
			: []

		const stageIds = new Set<string>()
		for (const st of stageTransitions) {
			if (st.from_stage_id) stageIds.add(st.from_stage_id)
			if (st.to_stage_id) stageIds.add(st.to_stage_id)
		}
		const stageNameMap = new Map<string, string>()
		if (stageIds.size > 0) {
			const stages = await prisma.pipeline_stages.findMany({
				where: { id: { in: [...stageIds] } },
				select: { id: true, name: true },
			})
			for (const stage of stages) stageNameMap.set(stage.id, stage.name)
		}

		type TimelineTone = 'default' | 'info' | 'success' | 'warning'
		type TimelineEvent = {
			id: string
			type: string
			title: string
			description: string | null
			actorId: string | null
			actorName: string | null
			tone: TimelineTone
			at: Date
		}

		const events: TimelineEvent[] = []
		const actorIds = new Set<string>()

		const createdAt = contact.first_contact_at || contact.created_at
		if (createdAt) {
			events.push({
				id: `lead-created-${contact.id}`,
				type: 'lead_created',
				title: 'Lead masuk',
				description: contact.source
					? `Sumber: ${formatTimelineSource(contact.source)}`
					: null,
				actorId: null,
				actorName: null,
				tone: 'info',
				at: createdAt,
			})
		}

		const TASK_EVENT_META: Record<
			string,
			{ title: string; tone: TimelineTone }
		> = {
			created: { title: 'Tugas dibuat', tone: 'default' },
			started: { title: 'Tugas dimulai', tone: 'info' },
			completed: { title: 'Tugas selesai', tone: 'success' },
			cancelled: { title: 'Tugas dibatalkan', tone: 'warning' },
			// Kept for history only — snoozing a task is no longer possible, but
			// the events from when it was still read on the timeline.
			snoozed: { title: 'Tugas ditunda', tone: 'warning' },
			reassigned: { title: 'Tugas dialihkan', tone: 'warning' },
			updated: { title: 'Tugas diperbarui', tone: 'default' },
			ai_analyzed: { title: 'AI menganalisis', tone: 'info' },
			replied_whatsapp: { title: 'Dibalas via WhatsApp', tone: 'success' },
		}
		for (const ev of taskEvents) {
			if (!(ev.created_at instanceof Date)) continue
			const meta = TASK_EVENT_META[ev.event_type] || {
				title: `Tugas: ${ev.event_type}`,
				tone: 'default' as TimelineTone,
			}
			const isAi = ev.actor_type === 'ai' || ev.actor_type === 'system'
			if (!isAi && ev.actor_id) actorIds.add(ev.actor_id)
			events.push({
				id: `task-event-${ev.id}`,
				type: `task_${ev.event_type}`,
				title: meta.title,
				description: taskMap.get(ev.task_id) || ev.reason || null,
				actorId: isAi ? null : ev.actor_id,
				actorName: isAi ? 'AI' : null,
				tone: meta.tone,
				at: ev.created_at,
			})
		}

		for (const note of contactNotes) {
			if (!(note.created_at instanceof Date)) continue
			if (note.user_id) actorIds.add(note.user_id)
			events.push({
				id: `note-${note.id}`,
				type: 'note_added',
				title: 'Catatan ditambahkan',
				description: note.content,
				actorId: note.user_id,
				actorName: null,
				tone: 'default',
				at: note.created_at,
			})
		}

		for (const h of handovers) {
			const at = h.approved_at || h.created_at
			if (!(at instanceof Date)) continue
			if (h.requested_by) actorIds.add(h.requested_by)
			if (h.target_agent_id) actorIds.add(h.target_agent_id)
			const isTake = h.request_type === 'take'
			events.push({
				id: `handover-${h.id}`,
				type: isTake ? 'handover_take' : 'handover_share',
				title: isTake ? 'Sales ambil alih percakapan' : 'Lead dibagikan ke sales',
				description: h.status ? `Status: ${h.status}` : null,
				actorId: h.requested_by,
				actorName: null,
				tone: 'info',
				at,
			})
		}

		for (const a of assignments) {
			if (!(a.created_at instanceof Date)) continue
			if (a.assigned_to) actorIds.add(a.assigned_to)
			if (a.assigned_from) actorIds.add(a.assigned_from)
			events.push({
				id: `assignment-${a.id}`,
				type: 'assignment',
				title: 'Percakapan di-assign',
				description: null,
				actorId: a.assigned_to,
				actorName: null,
				tone: 'info',
				at: a.created_at,
			})
		}

		for (const st of stageTransitions) {
			if (!(st.created_at instanceof Date)) continue
			if (st.user_id) actorIds.add(st.user_id)
			const fromName = st.from_stage_id
				? stageNameMap.get(st.from_stage_id)
				: null
			const toName = st.to_stage_id ? stageNameMap.get(st.to_stage_id) : null
			events.push({
				id: `stage-${st.id}`,
				type: 'stage_change',
				title: 'Pindah tahap pipeline',
				description: toName
					? fromName
						? `${fromName} → ${toName}`
						: `Ke ${toName}`
					: st.notes || null,
				actorId: st.user_id,
				actorName: null,
				tone: 'default',
				at: st.created_at,
			})
		}

		const actorNameMap = new Map<string, string>()
		if (actorIds.size > 0) {
			const users = await prisma.users.findMany({
				where: { id: { in: [...actorIds] } },
				select: { id: true, name: true, email: true },
			})
			for (const user of users) {
				actorNameMap.set(
					user.id,
					user.name?.trim() || user.email?.split('@')[0] || 'Pengguna',
				)
			}
		}

		return events
			.map((event) => ({
				id: event.id,
				type: event.type,
				title: event.title,
				description: event.description,
				tone: event.tone,
				actorName:
					event.actorName ||
					(event.actorId ? actorNameMap.get(event.actorId) || null : null),
				at: event.at.toISOString(),
			}))
			.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
	}

	/**
	 * Add a contact by hand from the Kontak page. The other two ways contacts
	 * appear — spreadsheet import and the WhatsApp webhook — both normalise the
	 * phone the same way, so this does too; a number stored in a different shape
	 * would never match an incoming message.
	 */
	static async createCustomer(
		appId: string,
		data: {
			name: string
			phone_number?: string | null
			email?: string | null
			company?: string | null
			city?: string | null
			notes?: string | null
		},
	) {
		const name = String(data.name || '').trim()
		if (!name) throw new Error('Nama kontak wajib diisi')

		const phoneInput = String(data.phone_number || '').trim()
		const phone = phoneInput ? normalizePhone(phoneInput) : null
		if (phoneInput && !phone) throw new Error('Nomor WhatsApp tidak valid')

		const email = String(data.email || '').trim().toLowerCase() || null
		if (!phone && !email) throw new Error('Isi minimal nomor WhatsApp atau email')

		// Incoming WhatsApp is matched to a contact by phone, so a second record
		// with the same number would split one customer's history in two and leave
		// whichever copy the webhook picks looking empty.
		const duplicate = await prisma.contacts.findFirst({
			where: {
				app_id: appId,
				deleted_at: null,
				OR: [
					...(phone ? [{ phone_number: phone }, { whatsapp_id: phone }] : []),
					...(email ? [{ email }] : []),
				],
			},
			select: { id: true, name: true },
		})
		if (duplicate) {
			throw new CustomerDuplicateError(
				`Kontak sudah ada: ${duplicate.name || phone || email}`,
				duplicate.id,
			)
		}

		const city = String(data.city || '').trim()
		const notes = String(data.notes || '').trim()
		const company = String(data.company || '').trim()
		const companyId = await resolveCompany(prisma, { appId, name: company, city })

		return prisma.contacts.create({
			data: {
				app_id: appId,
				// account_id is left null on purpose: it has an FK to `accounts`,
				// which this deployment does not populate, and every existing contact
				// (import and webhook alike) is app-scoped only.
				name,
				phone_number: phone,
				whatsapp_id: phone,
				// Same identifier shape the importer uses, so a manually added contact
				// is matched by the WhatsApp path rather than duplicated by it.
				identifier: phone ? `wa:${appId}:${phone}` : null,
				email,
				company: company || null,
				company_id: companyId,
				// city and company are real columns; only notes has nowhere else to go.
				// The prospect path writes them the same way, and a city hidden in
				// custom_attributes would be invisible to anything querying the column.
				city: city || null,
				source: 'manual',
				first_contact_at: new Date(),
				custom_attributes: (notes ? { notes } : {}) as Prisma.InputJsonValue,
			},
			select: { id: true, name: true, phone_number: true, email: true },
		})
	}

	static async updateCustomer(
		id: string,
		data: {
			name?: string
			email?: string
			phone_number?: string
			notes?: string
			lead_score?: number
			pipeline_stage_id?: string
			consent_status?: string
			consent_purpose?: string
			consent_source?: string
			custom_attributes?: Record<string, unknown>
		},
	) {
		if (!isUuid(id)) return null

		const existing = await prisma.contacts.findUnique({
			where: { id },
			select: {
				custom_attributes: true,
				app_id: true,
				account_id: true,
			},
		})
		if (!existing) return null

		const existingCustom = parseJsonObject(existing.custom_attributes)
		const dynamicCustom = parseJsonObject(data.custom_attributes)

		// The stage goes to contacts.pipeline_stage_id. The three JSON keys it
		// used to live in are cleared rather than kept in step: two copies of one
		// fact is what this change exists to remove, and a stale name left behind
		// would still be read by anything that falls back to the blob.
		let stageColumn: string | null | undefined
		const clearedStageKeys = {
			pipeline_stage_id: undefined,
			pipeline_stage_name: undefined,
			pipeline_stage_color: undefined,
		}

		if (data.pipeline_stage_id !== undefined) {
			if (!data.pipeline_stage_id) {
				stageColumn = null
			} else {
				const appId = existing.app_id || existing.account_id
				if (!appId) {
					throw new Error('App ID not found for this customer')
				}
				const stage = await prisma.pipeline_stages.findFirst({
					where: {
						id: data.pipeline_stage_id,
						pipelines: {
							app_id: appId,
							pipeline_type: 'contact',
						},
					},
					select: {
						id: true,
						name: true,
						color: true,
					},
				})
				if (!stage) {
					throw new Error('Invalid contact stage')
				}
				stageColumn = stage.id
			}
		}

		const mergedCustom = {
			...existingCustom,
			...dynamicCustom,
			...(data.notes !== undefined ? { notes: data.notes } : {}),
			...(data.lead_score !== undefined ? { lead_score: data.lead_score } : {}),
			...(stageColumn !== undefined ? clearedStageKeys : {}),
			...(data.consent_purpose !== undefined
				? { consent_purpose: data.consent_purpose }
				: {}),
			...(data.consent_source !== undefined
				? { consent_source: data.consent_source }
				: {}),
		}

		const updatedContact = await prisma.contacts.update({
			where: { id },
			data: {
				...(data.name !== undefined ? { name: data.name } : {}),
				...(data.email !== undefined ? { email: data.email } : {}),
				...(data.phone_number !== undefined
					? { phone_number: data.phone_number }
					: {}),
				...(data.consent_status !== undefined
					? { consent_status: data.consent_status }
					: {}),
				...(stageColumn !== undefined ? { pipeline_stage_id: stageColumn } : {}),
				custom_attributes: mergedCustom,
				updated_at: new Date(),
			},
		})
		const payload = await CustomerService.getCustomerById(id)

		const effectiveAppId = existing.app_id || existing.account_id || null
		if (effectiveAppId) {
			void BusinessWebhookDispatchService.dispatch({
				event: 'contact.updated',
				appId: effectiveAppId,
				payload: {
					source: 'customers.update',
					contact: {
						id: updatedContact.id,
						name: updatedContact.name,
						email: updatedContact.email,
						phone_number: updatedContact.phone_number,
						updated_at: updatedContact.updated_at,
						custom_attributes: updatedContact.custom_attributes,
					},
					customer: payload,
				},
			})
		}

		return payload
	}

	static async addTagToCustomer(
		customerId: string,
		appId: string,
		input: { tag_id?: string; tag_name?: string },
	) {
		if (!isUuid(customerId)) return null

		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return null

		let tagId = input.tag_id
		if (!tagId && input.tag_name?.trim()) {
			const tagName = input.tag_name.trim()
			const tag = await prisma.contact_tags.upsert({
				where: {
					app_id_name: {
						app_id: targetAppId,
						name: tagName,
					},
				},
				update: {},
				create: {
					app_id: targetAppId,
					name: tagName,
					color: '#3B82F6',
				},
				select: { id: true },
			})
			tagId = tag.id
		}

		if (!tagId || !isUuid(tagId)) return null

		await prisma.contact_tag_assignments.upsert({
			where: {
				contact_id_tag_id: {
					contact_id: customerId,
					tag_id: tagId,
				},
			},
			update: {},
			create: {
				contact_id: customerId,
				tag_id: tagId,
			},
		})

		return CustomerService.getCustomerById(customerId)
	}

	static async removeTagFromCustomer(customerId: string, tagId: string) {
		if (!isUuid(customerId) || !isUuid(tagId)) return null

		await prisma.contact_tag_assignments.deleteMany({
			where: {
				contact_id: customerId,
				tag_id: tagId,
			},
		})

		return CustomerService.getCustomerById(customerId)
	}

	static async getCustomerLevelSettings(params: { appId: string }) {
		const targetAppId = await resolveAppId(params.appId)
		if (!targetAppId) {
			return {
				levels: cloneCustomerLevelDefinitions(),
				mappings: cloneDefaultMappings(),
			} satisfies CustomerLevelSettingsDTO
		}

		const storedSettings = await prisma.customer_level_settings.findUnique({
			where: { app_id: targetAppId },
			select: {
				vip_chatbot_id: true,
				premium_chatbot_id: true,
				basic_chatbot_id: true,
			},
		})

		return {
			levels: cloneCustomerLevelDefinitions(),
			mappings: {
				vip: normalizeCustomerLevelMappingValue(storedSettings?.vip_chatbot_id),
				premium: normalizeCustomerLevelMappingValue(
					storedSettings?.premium_chatbot_id,
				),
				basic: normalizeCustomerLevelMappingValue(
					storedSettings?.basic_chatbot_id,
				),
			},
		} satisfies CustomerLevelSettingsDTO
	}

	static async updateCustomerLevelMappings(params: {
		appId: string
		mappings: {
			vip?: string | null
			premium?: string | null
			basic?: string | null
		}
	}) {
		const targetAppId = await resolveAppId(params.appId)
		if (!targetAppId) {
			throw new Error('Invalid App ID')
		}

		const storedSettings = await prisma.customer_level_settings.findUnique({
			where: { app_id: targetAppId },
			select: {
				vip_chatbot_id: true,
				premium_chatbot_id: true,
				basic_chatbot_id: true,
			},
		})

		const currentMappings: CustomerLevelAgentMappings = {
			vip: normalizeCustomerLevelMappingValue(storedSettings?.vip_chatbot_id),
			premium: normalizeCustomerLevelMappingValue(
				storedSettings?.premium_chatbot_id,
			),
			basic: normalizeCustomerLevelMappingValue(
				storedSettings?.basic_chatbot_id,
			),
		}
		const resolveNextMapping = async (
			value: string | null | undefined,
			currentValue: string | null,
			levelLabel: string,
		) => {
			if (value === undefined) return currentValue
			if (value === null) return null
			const normalized = value.trim()
			if (!normalized) return null

			const [chatbot, persona] = await Promise.all([
				isUuid(normalized)
					? prisma.chatbots.findFirst({
							where: {
								id: normalized,
								app_id: targetAppId,
								is_deleted: false,
							},
							select: { id: true },
						})
					: Promise.resolve(null),
				prisma.ai_playground_personas.findFirst({
					where: {
						app_id: targetAppId,
						OR: [
							...(isUuid(normalized) ? [{ id: normalized }] : []),
							{ persona_key: normalized },
						],
					},
					select: { id: true, persona_key: true },
				}),
			])

			if (chatbot?.id) {
				return chatbot.id
			}
			if (persona?.id) return persona.id

			throw new Error(`Invalid AI agent for ${levelLabel}`)
		}
		const nextMappings: CustomerLevelAgentMappings = {
			vip: await resolveNextMapping(
				params.mappings.vip,
				currentMappings.vip,
				'VIP',
			),
			premium: await resolveNextMapping(
				params.mappings.premium,
				currentMappings.premium,
				'Premium',
			),
			basic: await resolveNextMapping(
				params.mappings.basic,
				currentMappings.basic,
				'Basic',
			),
		}

		await prisma.customer_level_settings.upsert({
			where: { app_id: targetAppId },
			create: {
				app_id: targetAppId,
				vip_chatbot_id: nextMappings.vip,
				premium_chatbot_id: nextMappings.premium,
				basic_chatbot_id: nextMappings.basic,
			},
			update: {
				vip_chatbot_id: nextMappings.vip,
				premium_chatbot_id: nextMappings.premium,
				basic_chatbot_id: nextMappings.basic,
				updated_at: new Date(),
			},
		})

		return {
			levels: cloneCustomerLevelDefinitions(),
			mappings: nextMappings,
		} satisfies CustomerLevelSettingsDTO
	}

	static async getCustomerLevelPreview(params: {
		appId: string
		limit?: number
	}): Promise<CustomerLevelPreviewItem[]> {
		const targetAppId = await resolveAppId(params.appId)
		if (!targetAppId) return []

		const limit = Math.max(1, Math.min(100, Math.floor(params.limit || 20)))
		const settings = await CustomerService.getCustomerLevelSettings({
			appId: targetAppId,
		})

		const rows = await prisma.$queryRaw<
			Array<{
				id: string
				name: string | null
				email: string | null
				phone_number: string | null
				total_spent: number | string | null
				paid_order_count: number | bigint | null
			}>
		>(Prisma.sql`
			SELECT
				c.id,
				c.name,
				c.email,
				c.phone_number,
				COALESCE(
					SUM(
						CASE
							WHEN (
								LOWER(COALESCE(o.journey_phase, '')) IN ('paid')
								OR LOWER(COALESCE(o.order_status, '')) IN ('paid', 'completed')
							)
							THEN o.grand_total
							ELSE 0
						END
					),
					0
				)::double precision AS total_spent,
				COUNT(*) FILTER (
					WHERE (
						LOWER(COALESCE(o.journey_phase, '')) IN ('paid')
						OR LOWER(COALESCE(o.order_status, '')) IN ('paid', 'completed')
					)
				)::bigint AS paid_order_count
			FROM contacts c
			LEFT JOIN orders o
				ON o.contact_id = c.id
				AND o.app_id = ${targetAppId}::uuid
			WHERE
				(c.account_id = ${targetAppId}::uuid OR c.app_id = ${targetAppId}::uuid)
				AND c.deleted_at IS NULL
			GROUP BY c.id, c.name, c.email, c.phone_number, c.created_at
			ORDER BY total_spent DESC, paid_order_count DESC, c.created_at DESC
			LIMIT ${limit}
		`)

		const mappedAgentIds = Array.from(
			new Set(
				Object.values(settings.mappings).filter((value): value is string =>
					Boolean(value),
				),
			),
		)
		const [mappedChatbots, mappedPersonas] =
			mappedAgentIds.length > 0
				? await Promise.all([
						prisma.chatbots.findMany({
							where: {
								id: { in: mappedAgentIds },
								app_id: targetAppId,
								is_deleted: false,
							},
							select: {
								id: true,
								name: true,
							},
						}),
						prisma.ai_playground_personas.findMany({
							where: {
								id: { in: mappedAgentIds },
								app_id: targetAppId,
							},
							select: {
								id: true,
								label: true,
							},
						}),
					])
				: [[], []]
		const mappedChatbotById = new Map(
			mappedChatbots.map((chatbot) => [chatbot.id, chatbot.name]),
		)
		const mappedPersonaById = new Map(
			mappedPersonas.map((persona) => [persona.id, persona.label]),
		)

		return rows.map((row) => {
			const totalSpent = toNumber(row.total_spent, 0)
			const levelId = resolveCustomerLevelFromTotalSpent(totalSpent)
			const mappedAgentId = levelId ? settings.mappings[levelId] : null
			const mappedChatbotName = mappedAgentId
				? mappedChatbotById.get(mappedAgentId) || null
				: null
			const mappedPersonaName = mappedAgentId
				? mappedPersonaById.get(mappedAgentId) || null
				: null

			return {
				customer_id: row.id,
				customer_name: row.name || 'Unknown',
				email: row.email,
				phone_number: row.phone_number,
				total_spent: totalSpent,
				paid_order_count: toNumber(row.paid_order_count, 0),
				level_id: levelId,
				level_label: resolveCustomerLevelLabel(levelId),
				mapped_chatbot_id: mappedChatbotName ? mappedAgentId : null,
				mapped_chatbot_name: mappedChatbotName,
				mapped_persona_id: mappedPersonaName ? mappedAgentId : null,
				mapped_persona_name: mappedPersonaName,
			}
		})
	}

	static async resolveMappedChatbotForCustomerLevel(params: {
		appId: string
		contactId: string
	}): Promise<CustomerLevelRoutingResolution> {
		if (!isUuid(params.contactId)) {
			return {
				level_id: null,
				level_label: null,
				total_spent: 0,
				mapped_chatbot_id: null,
				mapped_persona_id: null,
			}
		}

		const targetAppId = await resolveAppId(params.appId)
		if (!targetAppId) {
			return {
				level_id: null,
				level_label: null,
				total_spent: 0,
				mapped_chatbot_id: null,
				mapped_persona_id: null,
			}
		}

		const settings = await CustomerService.getCustomerLevelSettings({
			appId: targetAppId,
		})
		const hasMappedAiAgent = Object.values(settings.mappings).some((value) =>
			Boolean(value),
		)

		const totalSpent = await CustomerService.getCustomerLifetimePaidOrderValue({
			appId: targetAppId,
			contactId: params.contactId,
		})
		const levelId = resolveCustomerLevelFromTotalSpent(totalSpent)
		const mappedAgentId =
			hasMappedAiAgent && levelId ? settings.mappings[levelId] : null
		if (!mappedAgentId) {
			return {
				level_id: levelId,
				level_label: resolveCustomerLevelLabel(levelId),
				total_spent: totalSpent,
				mapped_chatbot_id: null,
				mapped_persona_id: null,
			}
		}

		const resolvedAgent = await resolveCustomerLevelAgent(
			targetAppId,
			mappedAgentId,
		)

		return {
			level_id: levelId,
			level_label: resolveCustomerLevelLabel(levelId),
			total_spent: totalSpent,
			mapped_chatbot_id: resolvedAgent.chatbot_id,
			mapped_persona_id: resolvedAgent.persona_id,
		}
	}

	private static async getCustomerLifetimePaidOrderValue(params: {
		appId: string
		contactId: string
	}): Promise<number> {
		const rows = await prisma.$queryRaw<
			Array<{ total_spent: number | string | null }>
		>(Prisma.sql`
			SELECT COALESCE(SUM(o.grand_total), 0)::double precision AS total_spent
			FROM orders o
			WHERE
				o.app_id = ${params.appId}::uuid
				AND o.contact_id = ${params.contactId}::uuid
				AND (
					LOWER(COALESCE(o.journey_phase, '')) IN ('paid')
					OR LOWER(COALESCE(o.order_status, '')) IN ('paid', 'completed')
				)
		`)
		return toNumber(rows[0]?.total_spent, 0)
	}
}
