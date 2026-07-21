import { createFileRoute, redirect } from '@tanstack/react-router'

/**
 * The page moved to /deals, which is what the team calls it and what the stage
 * labels now say. "Pipeline" also names the `pipelines` table that drives the
 * contact lifecycle, so keeping it on this page had one word meaning two things.
 *
 * Kept as a redirect rather than deleted so bookmarks and the odd hardcoded
 * link land on the board instead of a 404. The bucket filter is forwarded so a
 * link to /pipeline?bucket=opportunity still arrives pre-filtered.
 */
export const Route = createFileRoute('/_app/pipeline')({
	validateSearch: (search: Record<string, unknown>) => {
		const next: { bucket?: string } = {}
		if (typeof search.bucket === 'string') next.bucket = search.bucket
		return next
	},
	beforeLoad: ({ search }) => {
		throw redirect({ to: '/deals', search })
	},
})
