import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { APIToolsService } from './service'
import { requireRole } from '../../lib/require-role'

function resolveBusinessIdFromContext(args: {
	query: Record<string, unknown>
	headers: Record<string, unknown>
	orgId?: string | null
	resolvedAppId?: string | null
}) {
	const fromQuery = String(args.query?.business_id || '').trim()
	if (fromQuery) return fromQuery

	const fromHeader = String(
		args.headers['x-business-id'] || args.headers['X-Business-Id'] || '',
	).trim()
	if (fromHeader) return fromHeader

	const fromOrg = String(args.orgId || '').trim()
	if (fromOrg) return fromOrg

	const fromApp = String(args.resolvedAppId || '').trim()
	if (fromApp) return fromApp

	return ''
}

function valueToQueryString(value: unknown): string {
	if (value === null || value === undefined) return ''
	if (typeof value === 'string') return value
	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value)
	}

	try {
		return JSON.stringify(value)
	} catch {
		return String(value)
	}
}

export const apiTools = new Elysia({ prefix: '/ai_tools', tags: ['API Tools'] })
	.use(appContext)
	.get(
		'/',
		async ({ query, headers, orgId, resolvedAppId, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const businessId = resolveBusinessIdFromContext({
				query: query as Record<string, unknown>,
				headers: headers as Record<string, unknown>,
				orgId,
				resolvedAppId,
			})
			if (!businessId) {
				set.status = 400
				return { error: 'Business ID required' }
			}

			const tools = await APIToolsService.listTools(businessId)
			return { data: tools }
		},
		{
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
		},
	)
	.put(
		'/',
		async ({ query, headers, orgId, resolvedAppId, body, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const businessId = resolveBusinessIdFromContext({
				query: query as Record<string, unknown>,
				headers: headers as Record<string, unknown>,
				orgId,
				resolvedAppId,
			})
			if (!businessId) {
				set.status = 400
				return { error: 'Business ID required' }
			}

			const source = Array.isArray(body)
				? body
				: Array.isArray((body as any)?.data)
					? (body as any).data
					: []
			const tools = await APIToolsService.replaceTools(businessId, source)
			return { data: tools }
		},
		{
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
			body: t.Any(),
		},
	)
	.post(
		'/',
		async ({ query, headers, orgId, resolvedAppId, body, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const businessId = resolveBusinessIdFromContext({
				query: query as Record<string, unknown>,
				headers: headers as Record<string, unknown>,
				orgId,
				resolvedAppId,
			})
			if (!businessId) {
				set.status = 400
				return { error: 'Business ID required' }
			}

			try {
				const created = await APIToolsService.createTool(businessId, body)
				return { data: created }
			} catch (error: any) {
				set.status = 400
				return { error: error?.message || 'Failed to create tool' }
			}
		},
			{
				query: t.Object({
					business_id: t.Optional(t.String()),
				}),
				body: t.Any(),
			},
		)
		.post(
			'/execute',
			async ({ query, headers, orgId, resolvedAppId, body, userId, set }) => {
				const guard = await requireRole(userId, ['superadmin'])
				if (!guard.ok) {
					set.status = guard.status
					return { error: guard.error }
				}
				const businessId = resolveBusinessIdFromContext({
					query: query as Record<string, unknown>,
					headers: headers as Record<string, unknown>,
					orgId,
					resolvedAppId,
				})
				if (!businessId) {
					set.status = 400
					return { error: 'Business ID required' }
				}

				const rawBody =
					body && typeof body === 'object' && !Array.isArray(body)
						? (body as Record<string, unknown>)
						: {}
				const method = String(rawBody.method || 'POST').toUpperCase() === 'GET'
					? 'GET'
					: 'POST'
				const webhookAddress = String(rawBody.webhook_address || '').trim()
				if (!webhookAddress) {
					set.status = 400
					return { error: 'Webhook address is required' }
				}

				let parsedUrl: URL
				try {
					parsedUrl = new URL(webhookAddress)
				} catch {
					set.status = 400
					return { error: 'Webhook address must be a valid URL' }
				}

				if (parsedUrl.protocol !== 'http:' && parsedUrl.protocol !== 'https:') {
					set.status = 400
					return { error: 'Webhook protocol must be http or https' }
				}

				const payload =
					rawBody.payload &&
					typeof rawBody.payload === 'object' &&
					!Array.isArray(rawBody.payload)
						? (rawBody.payload as Record<string, unknown>)
						: {}

				const outgoingHeaders: Record<string, string> = {}
				const apiKey = String(rawBody.api_key || '').trim()
				if (apiKey) {
					outgoingHeaders['x-api-key'] = apiKey
				}

				const authorizationKey = String(rawBody.authorizationKey || '').trim()
				if (authorizationKey) {
					outgoingHeaders.Authorization = /^Bearer\s+/i.test(authorizationKey)
						? authorizationKey
						: `Bearer ${authorizationKey}`
				}

				let requestUrl = parsedUrl.toString()
				let requestBody = ''
				if (method === 'GET') {
					for (const [key, value] of Object.entries(payload)) {
						parsedUrl.searchParams.set(key, valueToQueryString(value))
					}
					requestUrl = parsedUrl.toString()
				} else {
					outgoingHeaders['Content-Type'] = 'application/json'
					requestBody = JSON.stringify(payload, null, 2)
				}

				try {
					const startedAt = Date.now()
					const response = await fetch(requestUrl, {
						method,
						headers: outgoingHeaders,
						body: method === 'POST' ? JSON.stringify(payload) : undefined,
					})
					const durationMs = Date.now() - startedAt
					const responseText = await response.text()

					return {
						data: {
							ok: response.ok,
							status: response.status,
							statusText: response.statusText,
							method,
							url: requestUrl,
							durationMs,
							requestBody:
								method === 'GET'
									? '(sent as query params)'
									: requestBody || '{}',
							responseBody: responseText,
						},
					}
				} catch (error: any) {
					set.status = 502
					return {
						error:
							error?.message ||
							'Request failed. It may be blocked by network policy.',
					}
				}
			},
			{
				query: t.Object({
					business_id: t.Optional(t.String()),
				}),
				body: t.Any(),
			},
		)
		.patch(
			'/:id',
		async ({ params, query, headers, orgId, resolvedAppId, body, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const businessId = resolveBusinessIdFromContext({
				query: query as Record<string, unknown>,
				headers: headers as Record<string, unknown>,
				orgId,
				resolvedAppId,
			})
			if (!businessId) {
				set.status = 400
				return { error: 'Business ID required' }
			}

			try {
				const updated = await APIToolsService.updateTool(
					businessId,
					params.id,
					body,
				)
				if (!updated) {
					set.status = 404
					return { error: 'Tool not found' }
				}
				return { data: updated }
			} catch (error: any) {
				set.status = 400
				return { error: error?.message || 'Failed to update tool' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
			body: t.Any(),
		},
	)
	.delete(
		'/:id',
		async ({ params, query, headers, orgId, resolvedAppId, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const businessId = resolveBusinessIdFromContext({
				query: query as Record<string, unknown>,
				headers: headers as Record<string, unknown>,
				orgId,
				resolvedAppId,
			})
			if (!businessId) {
				set.status = 400
				return { error: 'Business ID required' }
			}

			const deleted = await APIToolsService.deleteTool(businessId, params.id)
			if (!deleted) {
				set.status = 404
				return { error: 'Tool not found' }
			}
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
		},
	)
