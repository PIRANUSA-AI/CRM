import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * Opportunity was a separate page with its own manual create form. It is now a
 * band of the Deals board, a deal at or above the team's threshold, so there
 * is nothing left here to show and nothing to type in.
 *
 * The route is kept as a redirect rather than deleted so existing links,
 * bookmarks and the odd hardcoded reference land somewhere useful instead of
 * on a 404.
 */
export const Route = createFileRoute('/_app/opportunity')({
	beforeLoad: () => {
		throw redirect({ to: '/deals', search: { bucket: 'opportunity' } })
	},
})
