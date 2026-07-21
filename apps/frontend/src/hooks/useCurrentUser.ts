import { useEffect, useState } from 'react'
import { extractNormalizedRole } from '@/lib/role-access'

export type CurrentUser = {
	id: string
	role: string
}

/**
 * The signed-in user's id and normalised role, read from the same localStorage
 * entry the sidebar and route guards use.
 *
 * Returns null until the effect runs: the app is server-rendered, so reading
 * localStorage during render would break hydration. Treat null as "not known
 * yet" rather than "not a leader", rendering the sales view while the role
 * loads would make the page flip layouts on every visit.
 */
export function useCurrentUser(): CurrentUser | null {
	const [user, setUser] = useState<CurrentUser | null>(null)

	useEffect(() => {
		try {
			const raw = localStorage.getItem('crm_user')
			if (!raw) return
			const parsed = JSON.parse(raw)
			const candidate =
				parsed && typeof parsed.user === 'object' && parsed.user ? parsed.user : parsed
			setUser({
				id: String(candidate?.id || '').trim(),
				role: extractNormalizedRole(candidate),
			})
		} catch {
			/* a malformed entry just means the role stays unknown */
		}
	}, [])

	return user
}
