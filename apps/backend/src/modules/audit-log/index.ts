import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import { AuditLogService, type AuditLogActor } from './service'

// Audit trail is superadmin's technical domain, not an operational feature -
// consistent with the decision to keep superadmin out of the dashboard/
// analytics/metrics/target surfaces entirely and confined to system-level
// tooling (kelola-tim, developers, import, channel config).
const ALLOWED_ROLES: CanonicalRole[] = ['superadmin']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<AuditLogActor | null> {
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

export const auditLog = new Elysia({ prefix: '/audit-log', tags: ['AuditLog'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, userId, query, set }) => {
			const actor = await resolveActor(resolvedAppId, userId, set)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			return { data: await AuditLogService.list(actor, query) }
		},
		{
			query: t.Object({
				entityType: t.Optional(t.String()),
				action: t.Optional(t.String()),
				limit: t.Optional(t.Numeric()),
			}),
		},
	)
