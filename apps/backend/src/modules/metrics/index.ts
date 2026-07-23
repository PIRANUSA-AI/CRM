import { Elysia, t } from 'elysia'
import { MetricsService } from './service'
import { MetricsModel, MetricsRequestModel } from './model'
import { appContext } from '../../plugins'

export const metrics = new Elysia({ prefix: '/metrics', tags: ['Advanced'] })
	.use(appContext)
	.get(
		'/summary',
		async ({ resolvedAppId, integrationAuthError, query, set }) => {
			if (integrationAuthError) {
				set.status = 401
				return { error: integrationAuthError }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const summary = await MetricsService.getSummary(
				resolvedAppId,
				query.period,
			)
			return { data: summary }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				period: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/dashboard',
		async ({ resolvedAppId, integrationAuthError, query, set }) => {
			if (integrationAuthError) {
				set.status = 401
				return { error: integrationAuthError }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				return await MetricsService.getDashboard(resolvedAppId, query.period)
			} catch (error) {
				console.error('[Metrics] dashboard request failed', error)
				set.status = 500
				return { error: 'Failed to load dashboard metrics' }
			}
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				period: t.Optional(
					t.Union([
						t.Literal('today'),
						t.Literal('7d'),
						t.Literal('30d'),
					]),
				),
			}),
		},
	)
	.get(
		'/ai',
		async ({ resolvedAppId, integrationAuthError, set }) => {
			if (integrationAuthError) {
				set.status = 401
				return { error: integrationAuthError }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const metrics = await MetricsService.getAIMetrics(resolvedAppId)
			return { data: metrics }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
