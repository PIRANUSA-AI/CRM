import { treaty } from '@elysiajs/eden'
import type { App } from 'backend'
import { getAppIdFromCookie, getOrgSlugFromCookie } from './organization'

// Use environment variable for API URL or fallback to backend
// NOTE: Don't use window.location.origin as it will use the frontend dev server port (3005)
const API_URL =
	import.meta.env.VITE_API_URL || 'http://localhost:3010'

const getClientHeaders = () => {
	if (typeof localStorage === 'undefined') {
		return {}
	}

	const token = localStorage.getItem('scalechat_token')
	const appId =
		getAppIdFromCookie() || localStorage.getItem('scalechat_app_id')
	const appSecret =
		localStorage.getItem('scalechat_app_secret')
	const orgSlug =
		getOrgSlugFromCookie() || localStorage.getItem('scalechat_org_slug')

	return {
		...(token ? { Authorization: `Bearer ${token}` } : {}),
		...(appId ? { 'x-app-id': appId } : {}),
		...(orgSlug ? { 'x-org-slug': orgSlug } : {}),
		...(appSecret ? { 'x-app-secret': appSecret } : {}),
	}
}

export const api = treaty<App>(API_URL, {
	headers: () => getClientHeaders(),
})

// Helper for session token
export const setAuthToken = (token: string) => {
	if (typeof localStorage !== 'undefined') {
		localStorage.setItem('auth_token', token)
	}
}

export const getAuthToken = () => {
	if (typeof localStorage !== 'undefined') {
		return localStorage.getItem('auth_token')
	}
	return null
}

export default api
