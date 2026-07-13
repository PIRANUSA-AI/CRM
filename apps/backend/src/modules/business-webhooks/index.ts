import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { BusinessWebhooksService } from './service'

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

function asPayload(value: unknown) {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}
	return value as Record<string, unknown>
}

export const businessWebhooks = new Elysia({
	prefix: '/business_webhooks',
	tags: ['Business Webhooks'],
})
	.use(appContext)
	.get(
		'/',
		async ({ query, headers, orgId, resolvedAppId, set }) => {
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

			return BusinessWebhooksService.listWebhooks(businessId)
		},
		{
			query: t.Object({
				business_id: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/',
		async ({ query, headers, orgId, resolvedAppId, body, set }) => {
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
				return await BusinessWebhooksService.createWebhook(
					businessId,
					asPayload(body),
				)
			} catch (error: any) {
				set.status = 400
				return { error: error?.message || 'Failed to create webhook' }
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
		async ({ params, query, headers, orgId, resolvedAppId, body, set }) => {
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
				const updated = await BusinessWebhooksService.updateWebhook(
					businessId,
					params.id,
					asPayload(body),
				)

				if (!updated) {
					set.status = 404
					return { error: 'Webhook not found' }
				}

				return updated
			} catch (error: any) {
				set.status = 400
				return { error: error?.message || 'Failed to update webhook' }
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
		async ({ params, query, headers, orgId, resolvedAppId, set }) => {
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

			const deleted = await BusinessWebhooksService.deleteWebhook(
				businessId,
				params.id,
			)
			if (!deleted) {
				set.status = 404
				return { error: 'Webhook not found' }
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
