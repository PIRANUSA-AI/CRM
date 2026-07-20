import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import {
	LeadRoutingService,
	RoutingError,
	RoutingNotFoundError,
	type RoutingActor,
} from './service'

// Distributing leads to sales is a leadership action.
const ALLOWED_ROLES: CanonicalRole[] = ['leader', 'administrator', 'ceo', 'superadmin']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<RoutingActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, ALLOWED_ROLES)
	if (!authorization.ok) {
		set.status = authorization.status
		return null
	}
	return { appId: resolvedAppId, userId, role: authorization.role as CanonicalRole }
}

function toErrorResponse(error: unknown, set: { status?: number | string }) {
	if (error instanceof RoutingNotFoundError) {
		set.status = 404
		return { error: error.message }
	}
	if (error instanceof RoutingError) {
		set.status = 400
		return { error: error.message }
	}
	if (error instanceof Error) {
		set.status = 400
		return { error: error.message }
	}
	set.status = 500
	return { error: 'Routing lead tidak dapat diproses' }
}

export const leadRouting = new Elysia({ prefix: '/lead-routing', tags: ['LeadRouting'] })
	.use(appContext)
	.get('/access', async ({ resolvedAppId, userId }) => {
		if (!resolvedAppId || !userId) {
			return { data: { canRoute: false, role: null } }
		}

		const authorization = await requireRole(userId, ALLOWED_ROLES)
		return {
			data: {
				canRoute: authorization.ok,
				role: authorization.ok ? authorization.role : null,
			},
		}
	})
	.get('/:conversationId/suggest', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await LeadRoutingService.suggest(actor, params.conversationId) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ conversationId: t.String() }) })
	.post('/:conversationId/assign', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return {
				data: await LeadRoutingService.assign(
					actor,
					params.conversationId,
					body?.salesUserId ?? null,
				),
			}
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Optional(t.Object({ salesUserId: t.Optional(t.String()) })),
	})
