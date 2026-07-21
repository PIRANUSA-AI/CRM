import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Logging a prospect is no longer its own page. It produced a contact, a
 * follow-up task and a deal, which made it a second way to add a deal sitting
 * next to the first on the Deals page. It now happens inside Tambah Deal, at
 * the point the contact search comes up empty.
 *
 * Kept as a redirect so bookmarks and older links still land somewhere useful.
 */
export const Route = createFileRoute('/_app/prospek')({
	beforeLoad: () => {
		throw redirect({ to: '/deals' })
	},
})
