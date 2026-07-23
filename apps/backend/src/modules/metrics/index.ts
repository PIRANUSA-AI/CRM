import { Elysia, t } from 'elysia'
import { MetricsService } from './service'
import { appContext } from '../../plugins'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import type { MetricsActor } from './policy'

// Sales needs this endpoint for their own personal dashboard; everyone else
// gets their tier's usual widening (team, then everything).
const DASHBOARD_ROLES: CanonicalRole[] = [
	'sales',
	'leader',
	'administrator',
	'ceo',
	'superadmin',
]

// Analytics/AI metrics are a supervisory view (matches the /analytics and
// /metrics pages in role-access.ts, which sales cannot navigate to at all).
const SUPERVISOR_ROLES: CanonicalRole[] = [
	'leader',
	'administrator',
	'ceo',
	'superadmin',
]

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	allowedRoles: CanonicalRole[],
	set: { status?: number | string },
): Promise<MetricsActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, allowedRoles)
	if (!authorization.ok) {
		set.status = authorization.status
		return null
	}
	return {
		appId: resolvedAppId,
		userId,
		role: authorization.role as CanonicalRole,
	}
}

export const metrics = new Elysia({ prefix: '/metrics', tags: ['Advanced'] })
	.use(appContext)
	.get(
		'/summary',
		async ({ resolvedAppId, userId, query, set }) => {
			const actor = await resolveActor(
				resolvedAppId,
				userId,
				SUPERVISOR_ROLES,
				set,
			)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			const summary = await MetricsService.getSummary(actor, query.period)
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
		async ({ resolvedAppId, userId, query, set }) => {
			const actor = await resolveActor(
				resolvedAppId,
				userId,
				DASHBOARD_ROLES,
				set,
			)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			try {
				return await MetricsService.getDashboard(actor, query.period)
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
					t.Union([t.Literal('today'), t.Literal('7d'), t.Literal('30d')]),
				),
			}),
		},
	)
	.get(
		'/ai',
		async ({ resolvedAppId, userId, set }) => {
			const actor = await resolveActor(
				resolvedAppId,
				userId,
				SUPERVISOR_ROLES,
				set,
			)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			const aiMetrics = await MetricsService.getAIMetrics(actor.appId)
			return { data: aiMetrics }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
