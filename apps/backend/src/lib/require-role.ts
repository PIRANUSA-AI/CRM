import prisma from './prisma'

export const CANONICAL_ROLES = [
	'sales',
	'leader',
	'administrator',
	'ceo',
	'superadmin',
] as const
export type CanonicalRole = (typeof CANONICAL_ROLES)[number]

export const ROLE_RANK: Record<CanonicalRole, number> = {
	sales: 0,
	leader: 1,
	administrator: 2,
	ceo: 3,
	superadmin: 4,
}

/**
 * An administrator oversees every team; a leader oversees the one team they
 * belong to. Anywhere a query has to decide between "your team" and
 * "everything", this is the test, not `role === 'leader'`, which silently
 * treats a new administrator as an ordinary user.
 */
export function isMultiTeamRole(role: string | null | undefined): boolean {
	const normalized = String(role || '').toLowerCase()
	return normalized === 'administrator' || normalized === 'ceo' || normalized === 'superadmin'
}

// Roles eligible to receive an auto-assigned conversation (day-to-day CS work).
// Leaders run a team and carry leads themselves; an administrator hands work
// out rather than doing it, so they are deliberately absent.
export const CHAT_ASSIGNABLE_ROLES: CanonicalRole[] = ['sales', 'leader']

// Roles that appear in the staff roster / CS metrics reporting.
export const STAFF_ROSTER_ROLES: CanonicalRole[] = [
	'sales',
	'leader',
	'administrator',
	'ceo',
]

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
 * Who may create an account, and of what role.
 *
 * Staffing is an administrator's job: they add teams and the people in them.
 * A leader runs the team they are given and cannot enlarge it, so leader and
 * sales grant nothing at all, even though a leader outranks a sales.
 *
 * Above that, a role may grant at or below its own tier: `ceo` and
 * `superadmin` may also mint a peer, an administrator may not.
 */
export function canGrantRole(granterRole: string, targetRole: string): boolean {
	if (!CANONICAL_ROLES.includes(granterRole as CanonicalRole)) return false
	if (!CANONICAL_ROLES.includes(targetRole as CanonicalRole)) return false
	if (granterRole === 'sales' || granterRole === 'leader') return false
	const granterRank = ROLE_RANK[granterRole as CanonicalRole]
	const targetRank = ROLE_RANK[targetRole as CanonicalRole]
	const canGrantPeerTier = granterRole === 'ceo' || granterRole === 'superadmin'
	return canGrantPeerTier ? targetRank <= granterRank : targetRank < granterRank
}
