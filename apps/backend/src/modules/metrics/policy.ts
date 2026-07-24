import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'

export type MetricsActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export type MetricsScope =
	| { mode: 'all' }
	| { mode: 'self'; userId: string }
	| { mode: 'team'; userId: string; teamIds: string[] }

/**
 * Mirrors taskVisibilityScope/dealVisibilityScope: sales sees their own,
 * leader sees their team's plus their own, everyone above sees all.
 */
export async function resolveMetricsScope(
	actor: MetricsActor,
): Promise<MetricsScope> {
	if (actor.role === 'sales') return { mode: 'self', userId: actor.userId }
	if (actor.role === 'leader') {
		const memberships = await prisma.team_members.findMany({
			where: { user_id: actor.userId },
			select: { team_id: true },
		})
		return {
			mode: 'team',
			userId: actor.userId,
			teamIds: memberships.map(({ team_id }) => team_id),
		}
	}
	return { mode: 'all' }
}

/**
 * SQL fragment for the metrics module's raw $queryRawUnsafe queries, which use
 * positional `$N` placeholders written by hand rather than Prisma.sql
 * fragments (see queryRows/queryFirst below). `alias` is a table alias prefix
 * such as "c." or "" for an unaliased FROM table (e.g. contacts). `nextParamIndex`
 * is the next free `$N` slot in the caller's query; the fragment consumes one
 * slot for self/all and two for team (own id + team id array).
 */
export function scopeFragment(
	scope: MetricsScope,
	ownerColumn: string,
	teamColumn: string,
	alias: string,
	nextParamIndex: number,
): { clause: string; values: unknown[] } {
	if (scope.mode === 'all') return { clause: '', values: [] }
	if (scope.mode === 'self' || !scope.teamIds.length) {
		return {
			clause: `AND ${alias}${ownerColumn} = $${nextParamIndex}::uuid`,
			values: [scope.userId],
		}
	}
	return {
		clause: `AND (${alias}${ownerColumn} = $${nextParamIndex}::uuid OR ${alias}${teamColumn} = ANY($${nextParamIndex + 1}::uuid[]))`,
		values: [scope.userId, scope.teamIds],
	}
}
