import { createFileRoute, redirect } from '@tanstack/react-router'
import {
	extractNormalizedRole,
	getAllowedPrimaryPathsForRole,
} from '@/lib/role-access'

export const Route = createFileRoute('/')({
	beforeLoad: () => {
		if (typeof localStorage !== 'undefined') {
			const token = localStorage.getItem('crm_token')
			const storedUser = localStorage.getItem('crm_user')
			if (token && storedUser) {
				try {
					const parsed = JSON.parse(storedUser)
					const role = extractNormalizedRole(parsed)
					const allowedPaths = getAllowedPrimaryPathsForRole(role)
					const defaultPath = allowedPaths?.[0] || '/dashboard'
					const needsWhatsApp = ['sales', 'agent'].includes(role)
					throw redirect({
						to: needsWhatsApp ? '/whatsapp/connect' : defaultPath,
						replace: true,
					})
				} catch {
					throw redirect({ to: '/login', replace: true })
				}
			}
			if (token) {
				throw redirect({ to: '/whatsapp/connect', replace: true })
			}
		}
		throw redirect({ to: '/login', replace: true })
	},
})
