import { randomUUID } from 'node:crypto'
import prisma from '../../lib/prisma'
import redis from '../../lib/redis'

export type APIToolRecord = {
	id: string
	created_at: string
	business_id: string
	name: string
	description: string
	webhook_address: string
	required: string[]
	properties: Record<string, unknown>[]
	max_tool_calls: number | null
	api_key: string | null
	additional_payload: Record<string, unknown>[] | null
	method: string
	authorizationKey: string | null
	workflow_id: string | null
	schema: Record<string, unknown> | null
	type: string
}

const STORAGE_PREFIX = 'ai_tools'
const CACHE_PREFIX = 'ai:tools'
const parsedToolsCacheTtlSeconds = Number.parseInt(
	process.env.AI_TOOLS_CACHE_TTL_SECONDS || '60',
	10,
)
const TOOLS_CACHE_TTL_SECONDS = Number.isFinite(parsedToolsCacheTtlSeconds)
	? Math.max(10, parsedToolsCacheTtlSeconds)
	: 60
const WORKFLOWS_HOST = 'workflows.crm.ai'

function parseHttpUrl(value: unknown): URL | null {
	const normalized = String(value || '').trim()
	if (!normalized) return null
	try {
		const parsed = new URL(normalized)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed
	} catch {
		return null
	}
}

function resolveWorkflowWebhookForEnvironment(value: string): string {
	const fallback = String(value || '').trim()
	if (!fallback) return fallback

	const parsedFallback = parseHttpUrl(fallback)
	if (!parsedFallback) return fallback
	if (parsedFallback.hostname.toLowerCase() !== WORKFLOWS_HOST) return fallback
	if (!parsedFallback.pathname.startsWith('/webhook/')) return fallback

	const parsedN8nBase = parseHttpUrl(process.env.N8N_BASE_URL)
	if (!parsedN8nBase) return fallback

	try {
		return new URL(
			`${parsedFallback.pathname}${parsedFallback.search}${parsedFallback.hash}`,
			`${parsedN8nBase.origin}/`,
		).toString()
	} catch {
		return fallback
	}
}

function getStorageKey(businessId: string) {
	return `${STORAGE_PREFIX}.${businessId}`.slice(0, 100)
}

function getCacheKey(businessId: string) {
	return `${CACHE_PREFIX}:${businessId}`
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function asObjectArray(value: unknown): Record<string, unknown>[] {
	if (!Array.isArray(value)) return []
	return value
		.filter((item) => item && typeof item === 'object' && !Array.isArray(item))
		.map((item) => ({ ...(item as Record<string, unknown>) }))
}

function normalizeMethod(value: unknown): string {
	const normalized = String(value || '')
		.trim()
		.toUpperCase()
	return ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(normalized)
		? normalized
		: 'POST'
}

function normalizeTool(
	value: unknown,
	fallbackBusinessId: string,
): APIToolRecord | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return null
	}

	const raw = value as Record<string, unknown>
	const name = String(raw.name || '').trim()
	const webhookAddress = resolveWorkflowWebhookForEnvironment(
		String(raw.webhook_address || '').trim(),
	)
	const description = String(raw.description || '').trim()
	if (!name || !webhookAddress) return null

	const additionalPayload =
		raw.additional_payload === null
			? null
			: asObjectArray(raw.additional_payload)

	return {
		id: String(raw.id || randomUUID()).trim(),
		created_at:
			typeof raw.created_at === 'string' && raw.created_at.trim()
				? raw.created_at
				: new Date().toISOString(),
		business_id: fallbackBusinessId,
		name,
		description,
		webhook_address: webhookAddress,
		required: asStringArray(raw.required),
		properties: asObjectArray(raw.properties),
		max_tool_calls:
			typeof raw.max_tool_calls === 'number' ? raw.max_tool_calls : null,
		api_key:
			typeof raw.api_key === 'string' && raw.api_key.trim()
				? raw.api_key.trim()
				: null,
		additional_payload: additionalPayload,
		method: normalizeMethod(raw.method),
		authorizationKey:
			typeof raw.authorizationKey === 'string' && raw.authorizationKey.trim()
				? raw.authorizationKey.trim()
				: null,
		workflow_id:
			typeof raw.workflow_id === 'string' && raw.workflow_id.trim()
				? raw.workflow_id.trim()
				: null,
		schema:
			raw.schema && typeof raw.schema === 'object' && !Array.isArray(raw.schema)
				? (raw.schema as Record<string, unknown>)
				: null,
		type:
			typeof raw.type === 'string' && raw.type.trim() ? raw.type.trim() : 'simple',
	}
}

function parseStoredTools(value: string, businessId: string): APIToolRecord[] | null {
	try {
		const parsed = JSON.parse(value) as unknown
		const source: unknown[] | null = Array.isArray(parsed)
			? parsed
			: Array.isArray((parsed as any)?.tools)
				? ((parsed as any).tools as unknown[])
				: null
		if (!source) return null

		return source
			.map((item: unknown) => normalizeTool(item, businessId))
			.filter((item: APIToolRecord | null): item is APIToolRecord => item !== null)
	} catch {
		return null
	}
}

async function readToolsCache(
	businessId: string,
): Promise<APIToolRecord[] | null> {
	try {
		const raw = await redis.get(getCacheKey(businessId))
		if (!raw) return null
		return parseStoredTools(raw, businessId)
	} catch (error) {
		console.warn('[APIToolsService] Failed to read tools cache from Redis', error)
		return null
	}
}

async function writeToolsCache(businessId: string, tools: APIToolRecord[]) {
	try {
		await redis.set(
			getCacheKey(businessId),
			JSON.stringify({ tools }),
			'EX',
			TOOLS_CACHE_TTL_SECONDS,
		)
	} catch (error) {
		console.warn('[APIToolsService] Failed to write tools cache to Redis', error)
	}
}

async function persistTools(businessId: string, tools: APIToolRecord[]) {
	const key = getStorageKey(businessId)
	const payload = JSON.stringify({
		version: 1,
		updated_at: new Date().toISOString(),
		tools,
	})

	await prisma.platform_settings.upsert({
		where: { key },
		update: { value: payload, updated_at: new Date() },
		create: { key, value: payload },
	})

	await writeToolsCache(businessId, tools)
}

export abstract class APIToolsService {
	static async listTools(businessId: string) {
		const cached = await readToolsCache(businessId)
		if (cached) return cached

		const key = getStorageKey(businessId)
		const row = await prisma.platform_settings.findUnique({
			where: { key },
			select: { value: true },
		})

		if (!row?.value) {
			return []
		}

		const parsed = parseStoredTools(row.value, businessId)
		if (!parsed) {
			return []
		}

		await writeToolsCache(businessId, parsed)
		return parsed
	}

	static async listToolsReadOnly(businessId: string) {
		const cached = await readToolsCache(businessId)
		if (cached) return cached

		const key = getStorageKey(businessId)
		const row = await prisma.platform_settings.findUnique({
			where: { key },
			select: { value: true },
		})

		if (!row?.value) {
			return []
		}

		const parsed = parseStoredTools(row.value, businessId)
		if (!parsed) {
			return []
		}

		await writeToolsCache(businessId, parsed)
		return parsed
	}

	static async replaceTools(businessId: string, data: unknown) {
		const source = Array.isArray(data) ? data : []
		const normalized = source
			.map((item) => normalizeTool(item, businessId))
			.filter((item): item is APIToolRecord => item !== null)
		await persistTools(businessId, normalized)
		return normalized
	}

	static async createTool(businessId: string, data: unknown) {
		const current = await APIToolsService.listTools(businessId)
		const normalized = normalizeTool(
			{
				...(data as Record<string, unknown>),
				id: (data as any)?.id || randomUUID(),
				created_at: (data as any)?.created_at || new Date().toISOString(),
			},
			businessId,
		)

		if (!normalized) {
			throw new Error('Invalid tool payload')
		}

		const next = [normalized, ...current.filter((tool) => tool.id !== normalized.id)]
		await persistTools(businessId, next)
		return normalized
	}

	static async updateTool(businessId: string, id: string, data: unknown) {
		const current = await APIToolsService.listTools(businessId)
		const existing = current.find((tool) => tool.id === id)
		if (!existing) return null

		const normalized = normalizeTool(
			{
				...existing,
				...(data as Record<string, unknown>),
				id: existing.id,
				created_at: existing.created_at,
			},
			businessId,
		)

		if (!normalized) {
			throw new Error('Invalid tool payload')
		}

		const next = current.map((tool) => (tool.id === id ? normalized : tool))
		await persistTools(businessId, next)
		return normalized
	}

	static async deleteTool(businessId: string, id: string) {
		const current = await APIToolsService.listTools(businessId)
		const next = current.filter((tool) => tool.id !== id)
		if (next.length === current.length) return false
		await persistTools(businessId, next)
		return true
	}
}

export const __test__ = {
	resolveWorkflowWebhookForEnvironment,
}
