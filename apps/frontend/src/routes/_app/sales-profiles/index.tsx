import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Sales profiles are no longer their own sidebar entry. A profile describes a
 * member of a team, so it is reached by opening that member inside Kelola Tim
 * rather than from a second list of the same people.
 *
 * Kept as a redirect so bookmarks land somewhere useful.
 */
export const Route = createFileRoute('/_app/sales-profiles/')({
	beforeLoad: () => {
		throw redirect({ to: '/kelola-tim' })
	},
})
