/**
 * Agents Management API Helper
 * Extended API functions for the new Agents Management system
 */

import { API_BASE } from './api'
import { api as treatyApi } from './server'

function unwrapTreatyResponse<T>(response: {
	data: T | null
	error: unknown
	status: number
}): T {
	if (response.error || response.data === null) {
		const message =
			typeof response.error === 'object' &&
			response.error !== null &&
			'value' in response.error
				? String((response.error as { value?: unknown }).value)
				: `HTTP ${response.status}`
		throw new Error(message)
	}
	return response.data
}

function getAuthHeaders(): HeadersInit {
	const token = localStorage.getItem('crm_token')
	const appId = localStorage.getItem('crm_app_id')
	let orgSlug: string | null = null
	if (typeof window !== 'undefined') {
		const pathMatch = window.location.pathname.match(/^\/[^/]+\/([^/]+)/)
		orgSlug = pathMatch?.[1] || null
	}
	const appSecret =
		localStorage.getItem('crm_app_secret')

	return {
		'Content-Type': 'application/json',
		...(token && { Authorization: `Bearer ${token}` }),
		...(orgSlug && { 'X-Org-Slug': orgSlug }),
		...(appId && { 'X-App-Id': appId }),
		...(appSecret && { 'X-App-Secret': appSecret }),
	}
}

async function apiRequest<T>(
	endpoint: string,
	options?: RequestInit & { _retry?: boolean },
): Promise<T> {
	const response = await fetch(`${API_BASE}${endpoint}`, {
		...options,
		headers: {
			...getAuthHeaders(),
			...options?.headers,
		},
	})

	if (!response.ok) {
		if (
			response.status === 401 &&
			!options?._retry &&
			!endpoint.includes('/auth/refresh') &&
			!endpoint.includes('/auth/login')
		) {
			const refreshToken = localStorage.getItem('crm_refresh_token')

			if (refreshToken) {
				try {
					const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ refreshToken }),
					})

					if (refreshResponse.ok) {
						const data = await refreshResponse.json()
						localStorage.setItem('crm_token', data.token)
						if (data.refreshToken) {
							localStorage.setItem('crm_refresh_token', data.refreshToken)
						}

						return apiRequest<T>(endpoint, {
							...options,
							_retry: true,
						})
					} else {
						localStorage.removeItem('crm_token')
						localStorage.removeItem('crm_refresh_token')
						localStorage.removeItem('crm_user')
					}
				} catch (e) {
					console.error('Token refresh failed:', e)
				}
			}
		}

		const error = await response
			.json()
			.catch(() => ({ error: 'Request failed' }))
		throw new Error(error.error || `HTTP ${response.status}`)
	}

	return response.json()
}

// Agents Management API
export const agentsManagement = {
	// Agents
	list: (params?: {
		search?: string
		division?: string
		channel?: string
		status?: string
		page?: number
		limit?: number
	}) =>
		treatyApi.api.agents
			.get({
				query: {
					q: params?.search,
				},
			})
			.then(unwrapTreatyResponse),

	get: (id: string) =>
		// Note: Backend doesn't have individual GET endpoint yet, using list
		apiRequest(`/agents-management/${id}`),

	create: (data: {
		name: string
		email: string
		password?: string
		role?: string
		phone_number?: string
		supervisor_id?: string
		divisions?: string[]
		channels?: string[]
	}) => treatyApi.api.agents.post(data).then(unwrapTreatyResponse),

	update: (
		id: string,
		data: {
			name?: string
			email?: string
			role?: string
			phone_number?: string
			supervisor_id?: string
			active?: boolean
			status?: string
			divisions?: string[]
			channels?: string[]
		},
	) =>
		// Note: Backend uses PATCH, but we keep PUT for compatibility
		apiRequest(`/agents-management/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data),
		}),

	delete: (id: string) =>
		treatyApi.api.agents({ id }).delete().then(unwrapTreatyResponse),

	getLoginLink: () =>
		treatyApi.api.agents['login-link'].get().then(unwrapTreatyResponse),

	assignChannelAccounts: (
		id: string,
		data: {
			channel_type: string
			account_ids: string[]
		},
	) =>
		// Note: This endpoint doesn't exist in backend yet
		apiRequest(`/agents-management/${id}/assign-channel-accounts`, {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	// Divisions
	divisions: {
		list: () => treatyApi.api.agents.divisions.get().then(unwrapTreatyResponse),

		create: (data: { name: string; description?: string; color?: string }) =>
			treatyApi.api.agents.divisions.post(data).then(unwrapTreatyResponse),

		update: (
			id: string,
			data: {
				name?: string
				description?: string
				color?: string
			},
		) =>
			// Note: Backend doesn't have division update endpoint yet
			apiRequest(`/agents-management/divisions/${id}`, {
				method: 'PUT',
				body: JSON.stringify(data),
			}),

		delete: (id: string) =>
			// Note: Backend doesn't have division delete endpoint yet
			apiRequest(`/agents-management/divisions/${id}`, {
				method: 'DELETE',
			}),
	},

	// Channel Accounts
	channelAccounts: {
		list: (channelType?: string) => {
			// Note: This endpoint doesn't exist in backend yet
			const query = channelType ? `?type=${channelType}` : ''
			return apiRequest(`/agents-management/channel-accounts${query}`)
		},

		create: (data: {
			channel_type: string
			name: string
			account_data?: any
		}) =>
			// Note: This endpoint doesn't exist in backend yet
			apiRequest('/agents-management/channel-accounts', {
				method: 'POST',
				body: JSON.stringify(data),
			}),
	},

	// Agent Settings
	settings: {
		get: () =>
			// Note: This endpoint is at /agent-settings, not under /agents
			apiRequest('/agent-settings'),
		update: (data: any) =>
			apiRequest('/agent-settings', {
				method: 'PUT',
				body: JSON.stringify(data),
			}),
	},
}
