import { createFileRoute, redirect } from '@tanstack/react-router'

export const Route = createFileRoute('/')({
	beforeLoad: () => {
		// Check if user is already logged in
		if (typeof localStorage !== 'undefined') {
			const token = localStorage.getItem('crm_token')
			if (token) {
				throw redirect({ to: '/whatsapp/connect', replace: true })
			}
		}
		throw redirect({ to: '/login', replace: true })
	},
})
