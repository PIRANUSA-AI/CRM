import { Elysia } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import { SystemHealthService, type SystemHealthActor } from './service'

// Same domain split as audit-log: technical/system-level, superadmin only,
// deliberately outside the business dashboard's role scoping.
const ALLOWED_ROLES: CanonicalRole[] = ['superadmin']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<SystemHealthActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, ALLOWED_ROLES)
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

export const systemHealth = new Elysia({
	prefix: '/system-health',
	tags: ['SystemHealth'],
})
	.use(appContext)
	.get('/', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		return { data: await SystemHealthService.get(actor) }
	})
