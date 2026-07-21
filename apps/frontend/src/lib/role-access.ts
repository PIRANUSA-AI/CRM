export type AppRole = 'sales' | 'leader' | 'ceo' | 'superadmin' | string

export function normalizeAppRole(role: string | null | undefined): string {
	const normalized = String(role || '')
		.trim()
		.toLowerCase()
	return normalized
}

type AnyRecord = Record<string, unknown> | null | undefined

export function extractNormalizedRole(source: AnyRecord): string {
	if (!source || typeof source !== 'object') return ''

	const roleCandidates: unknown[] = [
		source.role,
		source.app_role,
		source.appRole,
		source.user_role,
		source.userRole,
		source.organizationRole,
		source.memberRole,
		(source.metadata as AnyRecord)?.role,
		(source.user as AnyRecord)?.role,
		((source.user as AnyRecord)?.metadata as AnyRecord)?.role,
	]

	for (const candidate of roleCandidates) {
		if (typeof candidate !== 'string') continue
		const normalized = normalizeAppRole(candidate)
		if (normalized) return normalized
	}

	return ''
}

/**
 * Sees more than their own work: a leader across their team, an administrator
 * across every team. Pages use this to decide between the personal view and the
 * grouped one — spelling the roles out inline is how a newly added role ends up
 * silently rendering the sales view to a manager.
 */
export function isSupervisorRole(role: string | null | undefined): boolean {
	const normalized = normalizeAppRole(role)
	return (
		normalized === 'leader' ||
		normalized === 'administrator' ||
		normalized === 'ceo' ||
		normalized === 'superadmin'
	)
}

/** Oversees every team rather than one — the administrator tier and above. */
export function isMultiTeamRole(role: string | null | undefined): boolean {
	const normalized = normalizeAppRole(role)
	return (
		normalized === 'administrator' ||
		normalized === 'ceo' ||
		normalized === 'superadmin'
	)
}

export const SALES_PATHS = [
	'/dashboard',
	'/chat',
	'/tasks',
	'/prospek',
	'/alih-tugas',
	'/customers',
	'/companies',
	// '/opportunity' and '/pipeline' stay listed because they redirect to
	// /deals — drop them and the redirect bounces the sales off their own deals
	// before it ever arrives.
	'/deals',
	'/opportunity',
	'/pipeline',
	'/sakti',
	'/notifikasi',
	'/settings',
	'/help',
]

export const LEADER_PATHS = [
	'/dashboard',
	'/chat',
	'/tasks',
	'/prospek',
	'/alih-tugas',
	'/notifikasi',
	'/kelola-tim',
	'/sales-profiles',
	'/customers',
	'/companies',
	'/opportunity',
	'/sakti',
	'/deals',
	'/pipeline',
	'/broadcast',
	'/templates',
	'/flows',
	'/ai-agents',
	'/ai',
	'/knowledge',
	'/analytics',
	'/metrics',
	'/apps/meta-ads-tracker',
	'/integration',
	'/import',
	'/channels/whatsapp',
	'/channels/facebook',
	'/channels/line',
	'/channels/telegram',
	'/channels/livechat',
	'/channels/bot',
	'/channels/custom',
	'/settings',
	'/help',
]

/**
 * An administrator does everything a leader does, but across every team. The
 * pages are therefore the same set — what differs is the scope of the rows
 * inside them, which the backend decides, not this list.
 */
export const ADMINISTRATOR_PATHS = [...LEADER_PATHS]

export const CEO_PATHS = ['/dashboard', '/kelola-tim', '/notifikasi', '/analytics', '/metrics', '/settings', '/help']

export const SUPERADMIN_PATHS = ['/kelola-tim', '/developers', '/import', '/channels/whatsapp', '/settings', '/help']

/**
 * Returns null when unrestricted, otherwise returns exact allowed top-level paths.
 * An unrecognized or missing role fails CLOSED to SALES_PATHS (the most
 * restrictive tier) rather than falling through to unrestricted — see the
 * Better Auth `role`-field bug fixed earlier, which made every role
 * silently empty and every page silently unrestricted.
 *
 * Each role has its own independent list — CEO and Superadmin are NOT
 * supersets of Leader. CEO is monitoring-only (fewer operational pages
 * than Leader) and Superadmin is technical/IT-only (fewer business pages
 * than CEO), by design.
 */
export function getAllowedPrimaryPathsForRole(
	role: string | null | undefined,
): string[] | null {
	const normalizedRole = normalizeAppRole(role)

	if (normalizedRole === 'superadmin') return SUPERADMIN_PATHS
	if (normalizedRole === 'ceo') return CEO_PATHS
	if (normalizedRole === 'administrator') return ADMINISTRATOR_PATHS
	if (normalizedRole === 'leader') return LEADER_PATHS
	if (normalizedRole === 'sales') return SALES_PATHS

	return SALES_PATHS
}

export function isPathAllowedForRole(
	pathname: string,
	role: string | null | undefined,
): boolean {
	const allowedPaths = getAllowedPrimaryPathsForRole(role)
	if (!allowedPaths) return true

	return allowedPaths.some(
		(path) => pathname === path || pathname.startsWith(`${path}/`),
	)
}
