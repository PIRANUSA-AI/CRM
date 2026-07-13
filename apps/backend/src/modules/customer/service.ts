import prisma from '../../lib/prisma'
import { Prisma } from '../../generated/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'

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
	},
	messageCount: number,
	lastContactAt: Date | null,
	tags: CustomerTag[],
	stageMap?: Map<string, { name: string; color: string | null }>,
	orderStats?: CustomerOrderStats,
): CustomerDTO {
	const customAttributes = parseJsonObject(contact.custom_attributes)
	const stageId =
		typeof customAttributes.pipeline_stage_id === 'string'
			? customAttributes.pipeline_stage_id
			: null
	const stageMeta = stageId && stageMap ? stageMap.get(stageId) : undefined

	return {
		id: contact.id,
		name: contact.name || 'Unknown',
		email: contact.email,
		phone_number: contact.phone_number,
		avatar_url: contact.avatar_url,
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

		if (params.viewerRole === 'sales' && params.viewerUserId) {
			whereParts.push(
				Prisma.sql`EXISTS (
					SELECT 1 FROM conversations conv
					WHERE conv.contact_id = c.id
					AND conv.assignee_id = ${params.viewerUserId}::uuid
				)`,
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
				window_expires_at: true,
				consent_status: true,
				custom_attributes: true,
			},
		})
		if (!contact) return null

		const stageId =
			typeof parseJsonObject(contact.custom_attributes).pipeline_stage_id ===
			'string'
				? (parseJsonObject(contact.custom_attributes)
						.pipeline_stage_id as string)
				: null
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
		)
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
		let stagePayload: {
			pipeline_stage_id?: string | null
			pipeline_stage_name?: string | null
			pipeline_stage_color?: string | null
		} = {}

		if (data.pipeline_stage_id !== undefined) {
			if (!data.pipeline_stage_id) {
				stagePayload = {
					pipeline_stage_id: null,
					pipeline_stage_name: null,
					pipeline_stage_color: null,
				}
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
				stagePayload = {
					pipeline_stage_id: stage.id,
					pipeline_stage_name: stage.name,
					pipeline_stage_color: stage.color || '#3B82F6',
				}
			}
		}

		const mergedCustom = {
			...existingCustom,
			...dynamicCustom,
			...(data.notes !== undefined ? { notes: data.notes } : {}),
			...(data.lead_score !== undefined ? { lead_score: data.lead_score } : {}),
			...stagePayload,
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
