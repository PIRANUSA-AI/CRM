import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
	beforeLoad: () => {
		// Check if user is already logged in
		if (typeof localStorage !== 'undefined') {
			const token = localStorage.getItem('scalechat_token')
			if (token) {
				throw redirect({ to: '/dashboard', replace: true })
			}
		}
		throw redirect({ to: '/login', replace: true })
	},
})
