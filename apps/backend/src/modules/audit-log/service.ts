import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'
import type { CanonicalRole } from '../../lib/require-role'

export type AuditLogActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export type AuditLogQuery = {
	entityType?: string
	action?: string
	limit?: number
}

export abstract class AuditLogService {
	static async list(actor: AuditLogActor, query: AuditLogQuery) {
		const targetAppId = await resolveAppId(actor.appId)
		if (!targetAppId) return []

		const limit = Math.min(query.limit || 100, 200)

		const rows = await prisma.audit_logs.findMany({
			where: {
				app_id: targetAppId,
				...(query.entityType ? { entity_type: query.entityType } : {}),
				...(query.action ? { action: query.action } : {}),
			},
			orderBy: { created_at: 'desc' },
			take: limit,
		})

		const actorIds = [
			...new Set(rows.map((row) => row.actor_id).filter(Boolean) as string[]),
		]
		const actors = actorIds.length
			? await prisma.users.findMany({
					where: { id: { in: actorIds } },
					select: { id: true, name: true, email: true },
				})
			: []
		const actorById = new Map(actors.map((user) => [user.id, user]))

		return rows.map((row) => ({
			id: row.id,
			entityType: row.entity_type,
			entityId: row.entity_id,
			action: row.action,
			actorId: row.actor_id,
			actorName: row.actor_id
				? actorById.get(row.actor_id)?.name ||
					actorById.get(row.actor_id)?.email ||
					null
				: null,
			metadata: (row.metadata || {}) as Record<string, unknown>,
			createdAt: row.created_at,
		}))
	}
}
