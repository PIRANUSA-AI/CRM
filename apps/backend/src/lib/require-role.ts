import prisma from './prisma'

export const CANONICAL_ROLES = ['sales', 'leader', 'ceo', 'superadmin'] as const
export type CanonicalRole = (typeof CANONICAL_ROLES)[number]

export const ROLE_RANK: Record<CanonicalRole, number> = {
	sales: 0,
	leader: 1,
	ceo: 2,
	superadmin: 3,
}

// Roles eligible to receive an auto-assigned conversation (day-to-day CS work).
export const CHAT_ASSIGNABLE_ROLES: CanonicalRole[] = ['sales', 'leader']

// Roles that appear in the staff roster / CS metrics reporting.
export const STAFF_ROSTER_ROLES: CanonicalRole[] = ['sales', 'leader', 'ceo']

type RequireRoleResult =
	| { ok: true; role: string }
	| { ok: false; status: number; error: string }

export async function requireRole(
	userId: string | null,
	allowedRoles: CanonicalRole[],
): Promise<RequireRoleResult> {
	if (!userId) {
		return { ok: false, status: 403, error: 'Not authenticated' }
	}

	const user = await prisma.users.findUnique({
		where: { id: userId },
		select: { role: true },
	})

	if (!user || !allowedRoles.includes(user.role as CanonicalRole)) {
		return { ok: false, status: 403, error: 'Not authorized' }
	}

	return { ok: true, role: user.role as string }
}

/**
 * A role may only grant accounts at or below its own tier. A `leader`
 * cannot mint a `ceo`; only `superadmin` can mint another `superadmin`.
 * `ceo` and `superadmin` may also grant their own tier (peer accounts);
 * `sales` and `leader` may only grant strictly lower tiers.
 */
export function canGrantRole(granterRole: string, targetRole: string): boolean {
	if (!CANONICAL_ROLES.includes(granterRole as CanonicalRole)) return false
	if (!CANONICAL_ROLES.includes(targetRole as CanonicalRole)) return false
	const granterRank = ROLE_RANK[granterRole as CanonicalRole]
	const targetRank = ROLE_RANK[targetRole as CanonicalRole]
	const canGrantPeerTier = granterRole === 'ceo' || granterRole === 'superadmin'
	return canGrantPeerTier ? targetRank <= granterRank : targetRank < granterRank
}
