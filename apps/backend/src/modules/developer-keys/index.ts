import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { DeveloperKeysService } from './service'
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

function resolveBaseApiUrl(requestUrl: string): string {
	const fromEnv = String(process.env.PUBLIC_API_BASE_URL || '').trim()
	if (fromEnv) {
		return fromEnv.replace(/\/+$/, '')
	}

	try {
		const parsed = new URL(requestUrl)
		return `${parsed.protocol}//${parsed.host}`
	} catch {
		return String(process.env.BETTER_AUTH_URL || 'http://localhost:3010').replace(
			/\/+$/,
			'',
		)
	}
}

function buildApiKeyPayload(args: {
	requestUrl: string
	apiKey: string
	createdAt: string
	updatedAt: string
}) {
	const baseUrl = resolveBaseApiUrl(args.requestUrl)
	return {
		api_key: args.apiKey,
		created_at: args.createdAt,
		updated_at: args.updatedAt,
		docs_url: `${baseUrl}/docs`,
		openapi_url: `${baseUrl}/docs/json`,
	}
}

export const developerKeys = new Elysia({
	prefix: '/developer_keys',
	tags: ['Developer Keys'],
})
	.use(appContext)
	.get(
		'/',
		async ({ query, headers, orgId, resolvedAppId, request, userId, set }) => {
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
				const keyRecord =
					await DeveloperKeysService.getOrCreateByBusinessId(businessId)
				return {
					data: buildApiKeyPayload({
						requestUrl: request.url,
						apiKey: keyRecord.api_key,
						createdAt: keyRecord.created_at,
						updatedAt: keyRecord.updated_at,
					}),
				}
			} catch (error: any) {
				set.status = 400
				return { error: error?.message || 'Failed to resolve developer key' }
			}
		},
		{
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/regenerate',
		async ({ query, headers, orgId, resolvedAppId, request, userId, set }) => {
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
				const keyRecord = await DeveloperKeysService.regenerateByBusinessId(
					businessId,
				)
				return {
					data: buildApiKeyPayload({
						requestUrl: request.url,
						apiKey: keyRecord.api_key,
						createdAt: keyRecord.created_at,
						updatedAt: keyRecord.updated_at,
					}),
				}
			} catch (error: any) {
				set.status = 400
				return { error: error?.message || 'Failed to regenerate developer key' }
			}
		},
		{
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
		},
	)
