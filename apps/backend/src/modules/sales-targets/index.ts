import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import {
	SalesTargetError,
	SalesTargetNotFoundError,
	SalesTargetsService,
	type SalesTargetActor,
} from './service'

// Everyone operational may look at targets (scoped to what they may see);
// only administrator sets them, matching role-dan-akses.md's access matrix
// (ceo is explicitly view-only there, and superadmin is excluded per the
// decision to keep them out of the dashboard/analytics/metrics/target domain
// entirely).
const GET_ROLES: CanonicalRole[] = ['sales', 'leader', 'administrator', 'ceo']
const SET_ROLES: CanonicalRole[] = ['administrator']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	allowedRoles: CanonicalRole[],
	set: { status?: number | string },
): Promise<SalesTargetActor | null> {
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

function toErrorResponse(error: unknown, set: { status?: number | string }) {
	if (error instanceof SalesTargetNotFoundError) {
		set.status = 404
		return { error: error.message }
	}
	if (error instanceof SalesTargetError) {
		set.status = 400
		return { error: error.message }
	}
	if (error instanceof Error) {
		set.status = 400
		return { error: error.message }
	}
	set.status = 500
	return { error: 'Target tidak dapat diproses' }
}

export const salesTargets = new Elysia({
	prefix: '/sales-targets',
	tags: ['SalesTargets'],
})
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, userId, query, set }) => {
			const actor = await resolveActor(resolvedAppId, userId, GET_ROLES, set)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			try {
				return { data: await SalesTargetsService.list(actor, query) }
			} catch (error) {
				return toErrorResponse(error, set)
			}
		},
		{
			query: t.Object({
				periodType: t.Optional(
					t.Union([t.Literal('year'), t.Literal('month'), t.Literal('day')]),
				),
				periodKey: t.Optional(t.String({ maxLength: 10 })),
				userId: t.Optional(t.String()),
			}),
		},
	)
	.put(
		'/:userId',
		async ({ resolvedAppId, userId, params, body, set }) => {
			const actor = await resolveActor(resolvedAppId, userId, SET_ROLES, set)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			try {
				return {
					data: await SalesTargetsService.upsert(actor, params.userId, body),
				}
			} catch (error) {
				return toErrorResponse(error, set)
			}
		},
		{
			params: t.Object({ userId: t.String() }),
			body: t.Object({
				periodType: t.Union([
					t.Literal('year'),
					t.Literal('month'),
					t.Literal('day'),
				]),
				periodKey: t.String({ maxLength: 10 }),
				revenueTarget: t.Number(),
				dealCountTarget: t.Optional(t.Number()),
			}),
		},
	)
