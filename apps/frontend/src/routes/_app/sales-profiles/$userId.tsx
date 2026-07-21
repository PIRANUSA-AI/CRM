import { createFileRoute, redirect } from '@tanstack/react-router'

/** Moved under Kelola Tim; see sales-profiles/index.tsx. */
export const Route = createFileRoute('/_app/sales-profiles/$userId')({
	beforeLoad: ({ params }) => {
		throw redirect({ to: '/kelola-tim/$userId', params: { userId: params.userId } })
	},
})
