import prisma from '../../lib/prisma'
import { BUSINESS_WEBHOOK_EVENTS } from './constants'

const DEFAULT_WEBHOOK_NAME = 'Webhook'
const DEFAULT_WEBHOOK_EVENTS = [...BUSINESS_WEBHOOK_EVENTS]
const SAFE_WEBHOOK_FALLBACK_COLUMNS = new Set([
	'id',
	'account_id',
	'url',
	'subscriptions',
	'created_at',
])

let webhookColumnCachePromise: Promise<Set<string>> | null = null

const ALLOWED_WEBHOOK_EVENTS: ReadonlySet<string> = new Set(
	BUSINESS_WEBHOOK_EVENTS,
)

function normalizeUrl(value: unknown) {
	const trimmed = String(value || '').trim()
	if (!trimmed) {
		throw new Error('Webhook URL is required')
	}

	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			throw new Error('Webhook URL must use http or https')
		}
		return parsed.toString()
	} catch {
		throw new Error('Webhook URL must be a valid URL')
	}
}

function normalizeName(value: unknown) {
	const trimmed = String(value || '').trim()
	return trimmed || DEFAULT_WEBHOOK_NAME
}

function normalizeInboxId(value: unknown) {
	const trimmed = String(value || '').trim()
	return trimmed || null
}

function normalizeEvents(value: unknown) {
	if (!Array.isArray(value)) {
		return [...DEFAULT_WEBHOOK_EVENTS]
	}

	const deduplicated = new Set<string>()

	for (const eventName of value) {
		const normalized = String(eventName || '').trim()
		if (!normalized) continue
		if (!ALLOWED_WEBHOOK_EVENTS.has(normalized)) continue
		deduplicated.add(normalized)
	}

	if (deduplicated.size === 0) {
		return [...DEFAULT_WEBHOOK_EVENTS]
	}

	return [...deduplicated]
}

function normalizeHeaders(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	return value as Record<string, unknown>
}

function normalizeBoardId(value: unknown) {
	const trimmed = String(value || '').trim()
	return trimmed || null
}

function normalizeSecret(value: unknown) {
	const trimmed = String(value || '').trim()
	return trimmed || null
}

function normalizeIsActive(value: unknown) {
	return typeof value === 'boolean' ? value : true
}

function normalizeIsHidden(value: unknown) {
	return typeof value === 'boolean' ? value : false
}

function extractWebhookUrl(payload: Record<string, unknown>) {
	return payload.webhook_url || payload.webhookUrl || payload.url
}

async function getWebhookColumns() {
	if (!webhookColumnCachePromise) {
		webhookColumnCachePromise = prisma
			.$queryRaw<Array<{ column_name: string }>>`
				SELECT column_name
				FROM information_schema.columns
				WHERE table_schema = 'public'
				  AND table_name = 'webhooks'
			`
			.then((rows) => {
				const discovered = new Set<string>()
				for (const row of rows) {
					const name = String(row?.column_name || '').trim()
					if (!name) continue
					discovered.add(name)
				}
				return discovered.size > 0 ? discovered : SAFE_WEBHOOK_FALLBACK_COLUMNS
			})
			.catch(() => SAFE_WEBHOOK_FALLBACK_COLUMNS)
	}

	return webhookColumnCachePromise
}

function hasWebhookColumn(columns: Set<string>, name: string) {
	return columns.has(name)
}

async function resolveWebhookOwner(
	businessId: string,
	columns: Set<string>,
): Promise<{ appId: string | null; accountId: string | null }> {
	const rawBusinessId = String(businessId || '').trim()
	if (!rawBusinessId) {
		return { appId: null, accountId: null }
	}

	let appId: string | null = null
	if (hasWebhookColumn(columns, 'app_id')) {
		const byUuid = await prisma.apps.findUnique({
			where: { id: rawBusinessId },
			select: { id: true },
		})
		if (byUuid?.id) {
			appId = byUuid.id
		}

		if (!appId) {
			const bySlug = await prisma.apps.findFirst({
				where: { app_id: rawBusinessId },
				select: { id: true },
			})
			if (bySlug?.id) {
				appId = bySlug.id
			}
		}

		if (!appId) {
			const fromOrganization = await prisma.organization.findUnique({
				where: { id: rawBusinessId },
				select: { appId: true },
			})
			if (fromOrganization?.appId) {
				appId = fromOrganization.appId
			}
		}
	}

	let accountId: string | null = null
	if (hasWebhookColumn(columns, 'account_id')) {
		const byAccount = await prisma.accounts.findUnique({
			where: { id: rawBusinessId },
			select: { id: true },
		})
		if (byAccount?.id) {
			accountId = byAccount.id
		}

		// Legacy compatibility: if schema only has account_id, preserve old behavior
		// and store whatever business identifier is provided.
		if (!accountId && !hasWebhookColumn(columns, 'app_id')) {
			accountId = rawBusinessId
		}
	}

	return { appId, accountId }
}

function buildOwnedWebhookWhere(
	owner: { appId: string | null; accountId: string | null },
	columns: Set<string>,
) {
	const hasAppId = hasWebhookColumn(columns, 'app_id')
	const hasAccountId = hasWebhookColumn(columns, 'account_id')
	const ownerFilters: Record<string, unknown>[] = []

	if (hasAppId && owner.appId) {
		ownerFilters.push({ app_id: owner.appId })

		if (hasAccountId) {
			// Also include legacy rows that were scoped by account_id before app_id rollout.
			ownerFilters.push({
				AND: [{ app_id: null }, { account_id: owner.appId }],
			})
		}
	}

	if (hasAccountId && owner.accountId) {
		ownerFilters.push({ account_id: owner.accountId })
	}

	if (ownerFilters.length === 1) {
		return ownerFilters[0] as Record<string, unknown>
	}

	if (ownerFilters.length > 1) {
		return { OR: ownerFilters }
	}

	if (hasAppId || hasAccountId) {
		throw new Error(
			'Business ID cannot be resolved to a valid app/account owner',
		)
	}

	throw new Error('Webhooks table must contain either app_id or account_id column')
}

function buildWebhookSelect(columns: Set<string>) {
	const select: Record<string, boolean> = { id: true }
	const selectableColumns = [
		'account_id',
		'app_id',
		'inbox_id',
		'name',
		'url',
		'subscriptions',
		'is_active',
		'secret',
		'headers',
		'created_at',
		'is_hidden',
		'board_id',
	]

	for (const column of selectableColumns) {
		if (!hasWebhookColumn(columns, column)) continue
		select[column] = true
	}

	return select
}

function mapWebhookRecord(record: Record<string, any>) {
	const rawEvents = Array.isArray(record.subscriptions) ? record.subscriptions : []
	const events = rawEvents.map((event) => String(event || '').trim()).filter(Boolean)

	return {
		id: String(record.id || ''),
		name: String(record.name || DEFAULT_WEBHOOK_NAME),
		business_id: String(record.app_id || record.account_id || ''),
		inbox_id: record.inbox_id ? String(record.inbox_id) : null,
		webhook_url: String(record.url || ''),
		events,
		is_active: Boolean(record.is_active ?? true),
		secret: typeof record.secret === 'string' ? record.secret : null,
		headers:
			record.headers && typeof record.headers === 'object' && !Array.isArray(record.headers)
				? (record.headers as Record<string, unknown>)
				: null,
		created_at:
			record.created_at instanceof Date
				? record.created_at.toISOString()
				: String(record.created_at || ''),
		is_hidden: Boolean(record.is_hidden ?? false),
		board_id: record.board_id ? String(record.board_id) : null,
	}
}

export abstract class BusinessWebhooksService {
	static async listWebhooks(appId: string) {
		const columns = await getWebhookColumns()
		const owner = await resolveWebhookOwner(appId, columns)
		const query: Record<string, unknown> = {
			where: buildOwnedWebhookWhere(owner, columns),
			select: buildWebhookSelect(columns),
		}

		if (hasWebhookColumn(columns, 'created_at')) {
			query.orderBy = { created_at: 'desc' }
		}

		const rows = await prisma.webhooks.findMany(query as any)

		return rows.map((row) => mapWebhookRecord(row as unknown as Record<string, any>))
	}

	static async createWebhook(appId: string, payload: Record<string, unknown>) {
		const columns = await getWebhookColumns()
		const owner = await resolveWebhookOwner(appId, columns)
		const webhookUrl = normalizeUrl(extractWebhookUrl(payload))
		const ownershipWhere = buildOwnedWebhookWhere(owner, columns)
		const normalizedInboxId = hasWebhookColumn(columns, 'inbox_id')
			? normalizeInboxId(payload.inbox_id)
			: null
		if (
			!hasWebhookColumn(columns, 'account_id') &&
			!hasWebhookColumn(columns, 'app_id')
		) {
			throw new Error(
				'Webhooks table must contain either app_id or account_id column',
			)
		}

		const duplicateWhere: Record<string, unknown>[] = [ownershipWhere, { url: webhookUrl }]
		if (hasWebhookColumn(columns, 'inbox_id')) {
			duplicateWhere.push({ inbox_id: normalizedInboxId })
		}
		if (hasWebhookColumn(columns, 'is_active')) {
			duplicateWhere.push({ is_active: true })
		}

		const existingActive = await prisma.webhooks.findFirst({
			where: {
				AND: duplicateWhere,
			},
			select: buildWebhookSelect(columns) as any,
		})
		if (existingActive) {
			return mapWebhookRecord(existingActive as unknown as Record<string, any>)
		}

		const data: Record<string, unknown> = {
			url: webhookUrl,
		}

		if (hasWebhookColumn(columns, 'app_id') && owner.appId) {
			data.app_id = owner.appId
		} else if (hasWebhookColumn(columns, 'account_id') && owner.accountId) {
			data.account_id = owner.accountId
		} else {
			throw new Error('Business ID cannot be resolved to a valid app/account owner')
		}

		if (hasWebhookColumn(columns, 'name')) {
			data.name = normalizeName(payload.name)
		}

		if (hasWebhookColumn(columns, 'inbox_id')) {
			data.inbox_id = normalizedInboxId
		}

		if (hasWebhookColumn(columns, 'subscriptions')) {
			data.subscriptions = normalizeEvents(payload.events)
		}

		if (hasWebhookColumn(columns, 'is_active')) {
			data.is_active = normalizeIsActive(payload.is_active)
		}

		if (hasWebhookColumn(columns, 'secret')) {
			data.secret = normalizeSecret(payload.secret)
		}

		if (hasWebhookColumn(columns, 'headers')) {
			data.headers = normalizeHeaders(payload.headers)
		}

		if (hasWebhookColumn(columns, 'is_hidden')) {
			data.is_hidden = normalizeIsHidden(payload.is_hidden)
		}

		if (hasWebhookColumn(columns, 'board_id')) {
			data.board_id = normalizeBoardId(payload.board_id)
		}

		const created = await prisma.webhooks.create({
			data: data as any,
		})

		return mapWebhookRecord(created as unknown as Record<string, any>)
	}

	static async updateWebhook(
		appId: string,
		webhookId: string,
		payload: Record<string, unknown>,
	) {
		const columns = await getWebhookColumns()
		const owner = await resolveWebhookOwner(appId, columns)
		const ownershipWhere = buildOwnedWebhookWhere(owner, columns)
		const existingSelect: Record<string, boolean> = { id: true }
		if (hasWebhookColumn(columns, 'url')) {
			existingSelect.url = true
		}
		if (hasWebhookColumn(columns, 'inbox_id')) {
			existingSelect.inbox_id = true
		}
		if (hasWebhookColumn(columns, 'is_active')) {
			existingSelect.is_active = true
		}
		const existing = await prisma.webhooks.findFirst({
			where: {
				AND: [{ id: webhookId }, ownershipWhere],
			},
			select: existingSelect as any,
		})

		if (!existing) {
			return null
		}

		const updates: Record<string, unknown> = {}

		if (hasWebhookColumn(columns, 'updated_at')) {
			updates.updated_at = new Date()
		}

		if (payload.name !== undefined && hasWebhookColumn(columns, 'name')) {
			updates.name = normalizeName(payload.name)
		}

		if (
			hasWebhookColumn(columns, 'url') &&
			(payload.webhook_url !== undefined ||
				payload.webhookUrl !== undefined ||
				payload.url !== undefined)
		) {
			updates.url = normalizeUrl(extractWebhookUrl(payload))
		}

		if (payload.inbox_id !== undefined && hasWebhookColumn(columns, 'inbox_id')) {
			updates.inbox_id = normalizeInboxId(payload.inbox_id)
		}

		if (payload.events !== undefined && hasWebhookColumn(columns, 'subscriptions')) {
			updates.subscriptions = normalizeEvents(payload.events)
		}

		if (payload.is_active !== undefined && hasWebhookColumn(columns, 'is_active')) {
			updates.is_active = Boolean(payload.is_active)
		}

		if (payload.secret !== undefined && hasWebhookColumn(columns, 'secret')) {
			updates.secret = normalizeSecret(payload.secret)
		}

		if (payload.headers !== undefined && hasWebhookColumn(columns, 'headers')) {
			updates.headers = normalizeHeaders(payload.headers)
		}

		if (payload.is_hidden !== undefined && hasWebhookColumn(columns, 'is_hidden')) {
			updates.is_hidden = Boolean(payload.is_hidden)
		}

		if (payload.board_id !== undefined && hasWebhookColumn(columns, 'board_id')) {
			updates.board_id = normalizeBoardId(payload.board_id)
		}

		if (hasWebhookColumn(columns, 'url')) {
			const existingUrl = String((existing as Record<string, unknown>).url || '').trim()
			const nextUrl = String(updates.url || existingUrl || '').trim()
			if (nextUrl) {
				const nextInboxId = hasWebhookColumn(columns, 'inbox_id')
					? updates.inbox_id !== undefined
						? (updates.inbox_id as string | null)
						: ((existing as Record<string, unknown>).inbox_id as string | null)
					: null
				const nextIsActive =
					updates.is_active !== undefined
						? Boolean(updates.is_active)
						: Boolean((existing as Record<string, unknown>).is_active ?? true)

				if (nextIsActive) {
					const duplicateWhere: Record<string, unknown>[] = [
						ownershipWhere,
						{ id: { not: webhookId } },
						{ url: nextUrl },
					]
					if (hasWebhookColumn(columns, 'inbox_id')) {
						duplicateWhere.push({ inbox_id: nextInboxId })
					}
					if (hasWebhookColumn(columns, 'is_active')) {
						duplicateWhere.push({ is_active: true })
					}

					const duplicate = await prisma.webhooks.findFirst({
						where: {
							AND: duplicateWhere,
						},
						select: { id: true },
					})

					if (duplicate) {
						throw new Error(
							'Active webhook with same URL and inbox already exists',
						)
					}
				}
			}
		}

		if (Object.keys(updates).length === 0) {
			const current = await prisma.webhooks.findUnique({
				where: { id: webhookId },
				select: buildWebhookSelect(columns) as any,
			})

			if (!current) return null

			return mapWebhookRecord(current as unknown as Record<string, any>)
		}

		const updated = await prisma.webhooks.update({
			where: { id: webhookId },
			data: updates as any,
		})

		return mapWebhookRecord(updated as unknown as Record<string, any>)
	}

	static async deleteWebhook(appId: string, webhookId: string) {
		const columns = await getWebhookColumns()
		const owner = await resolveWebhookOwner(appId, columns)
		const ownershipWhere = buildOwnedWebhookWhere(owner, columns)
		const existing = await prisma.webhooks.findFirst({
			where: {
				AND: [{ id: webhookId }, ownershipWhere],
			},
			select: { id: true },
		})

		if (!existing) {
			return false
		}

		await prisma.webhooks.delete({
			where: { id: webhookId },
		})

		return true
	}
}
