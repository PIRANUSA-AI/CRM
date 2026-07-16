/**
 * Frontend API Client
 *
 * All API calls go through Express proxy
 * Automatically includes auth token
 */

import { getAppIdFromCookie, getOrgSlugFromCookie } from './organization'
import { api as treatyApi } from './server'

export const API_BASE = import.meta.env.VITE_API_URL
	? `${import.meta.env.VITE_API_URL}/api`
	: 'http://localhost:3010/api'

function getAuthHeaders(): HeadersInit {
	const token =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('crm_token')
			: null

	let orgSlug = getOrgSlugFromCookie()
	if (!orgSlug && typeof localStorage !== 'undefined') {
		orgSlug = localStorage.getItem('crm_org_slug')
	}
	if (!orgSlug && typeof window !== 'undefined') {
		// Legacy fallback: /$lang/$orgSlug/...
		const pathMatch = window.location.pathname.match(/^\/[^/]+\/([^/]+)/)
		orgSlug = pathMatch?.[1] || null
	}

	// Legacy fallback: still support X-App-Id for transition period
	const appId =
		getAppIdFromCookie() ||
		(typeof localStorage !== 'undefined'
			? localStorage.getItem('crm_app_id')
			: null)
	const appSecret =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('crm_app_secret')
			: null

	return {
		'Content-Type': 'application/json',
		...(token && { Authorization: `Bearer ${token}` }),
		// New: Use org slug from URL
		...(orgSlug && { 'X-Org-Slug': orgSlug }),
		// Legacy: Still send app_id during transition
		...(appId && { 'X-App-Id': appId }),
		...(appSecret ? { 'X-App-Secret': appSecret } : {}),
	}
}

function getMultipartAuthHeaders(): HeadersInit {
	const headers = getAuthHeaders() as Record<string, string>
	const multipartHeaders = { ...headers }
	delete multipartHeaders['Content-Type']
	delete multipartHeaders['content-type']
	return multipartHeaders
}

export interface ApiResponse<T = any> {
	success: boolean
	data?: T
	payload?: T
	error?: string
}

export async function readApiResponse(response: Response): Promise<unknown> {
	const text = await response.text()
	if (!text.trim()) return null

	try {
		return JSON.parse(text)
	} catch {
		return text
	}
}

export function getApiErrorMessage(
	payload: unknown,
	fallback = 'Request failed',
): string {
	if (typeof payload === 'string' && payload.trim().length > 0) {
		return payload
	}

	if (!payload || typeof payload !== 'object') {
		return fallback
	}

	const record = payload as Record<string, unknown>
	const error = record.error
	if (typeof error === 'string' && error.trim().length > 0) {
		return error
	}

	if (error && typeof error === 'object') {
		const nestedMessage = (error as Record<string, unknown>).message
		if (typeof nestedMessage === 'string' && nestedMessage.trim().length > 0) {
			return nestedMessage
		}
	}

	const message = record.message
	if (typeof message === 'string' && message.trim().length > 0) {
		return message
	}

	return fallback
}

export type ContactDetailSignalTone = 'success' | 'warning' | 'info' | 'neutral'

export interface ContactDetailSignal {
	value: string
	tone: ContactDetailSignalTone
}

export interface ConversationContactDetailResponse {
	conversation: {
		id: string
		contact_id: string | null
		inbox_id: string | null
		pipeline_id: string | null
		stage_id: string | null
		status: string | null
		channel_type: string | null
	}
	customer: {
		id: string | null
		name: string | null
		email: string | null
		phone_number: string | null
		avatar_url: string | null
		is_vip: boolean
		repeat_orders: number
		lifetime_value: number
	} | null
	badges: {
		vip: boolean
		repeat_orders: number
		lifetime_value: number
	}
	ai_summary: {
		text: string
		source: 'context' | 'heuristic'
		updated_at: string
	}
	live_signals: {
		sentiment: ContactDetailSignal
		intent: ContactDetailSignal
		buying_stage: ContactDetailSignal
		churn_risk: ContactDetailSignal & {
			percent: number
		}
	}
	open_cart: Record<string, unknown> | null
	order_history: Record<string, unknown>[]
	tags: Record<string, unknown>[]
	notes: Record<string, unknown>[]
	payment_methods: Array<{
		id: string
		label: string
		provider?: string
	}>
	backend_notes: string[]
}

type ApiErrorPayload = {
	error?: unknown
	code?: unknown
	follow_up_url?: unknown
	[key: string]: unknown
}

type ApiRequestError = Error & {
	status?: number
	code?: string
	followUpUrl?: string
	details?: ApiErrorPayload
}

function buildApiRequestError(
	payload: ApiErrorPayload | null,
	status: number,
): ApiRequestError {
	const message =
		typeof payload?.error === 'string' && payload.error.trim().length > 0
			? payload.error
			: `HTTP ${status}`

	const error = new Error(message) as ApiRequestError
	error.status = status
	error.details = payload || undefined

	if (typeof payload?.code === 'string' && payload.code.trim().length > 0) {
		error.code = payload.code
	}

	if (
		typeof payload?.follow_up_url === 'string' &&
		payload.follow_up_url.trim().length > 0
	) {
		error.followUpUrl = payload.follow_up_url
	}

	return error
}

async function apiRequest<T>(
	endpoint: string,
	options?: RequestInit & { _retry?: boolean },
): Promise<T> {
	const response = await fetch(`${API_BASE}${endpoint}`, {
		credentials: 'include',
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
			const refreshToken =
				typeof localStorage !== 'undefined'
					? localStorage.getItem('crm_refresh_token')
					: null

			if (refreshToken) {
				try {
					const refreshResponse = await fetch(`${API_BASE}/auth/refresh`, {
						method: 'POST',
						credentials: 'include',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ refreshToken }),
					})

					if (refreshResponse.ok) {
						const data = await refreshResponse.json()
						if (typeof localStorage !== 'undefined') {
							localStorage.setItem('crm_token', data.token)
							if (data.refreshToken) {
								localStorage.setItem(
									'crm_refresh_token',
									data.refreshToken,
								)
							}
						}

						return apiRequest<T>(endpoint, {
							...options,
							_retry: true,
						})
					} else {
						if (typeof localStorage !== 'undefined') {
							localStorage.removeItem('crm_token')
							localStorage.removeItem('crm_refresh_token')
							localStorage.removeItem('crm_user')
						}
					}
				} catch (e) {
					console.error('Token refresh failed:', e)
				}
			}
		}

		const payload = (await response
			.json()
			.catch(() => ({ error: 'Request failed' }))) as ApiErrorPayload
		throw buildApiRequestError(payload, response.status)
	}

	return response.json() as Promise<T>
}

function getTreatyErrorMessage(error: unknown, status: number): string {
	if (typeof error === 'object' && error !== null && 'value' in error) {
		const value = (error as { value?: unknown }).value
		if (typeof value === 'string') {
			return value
		}
		if (typeof value === 'object' && value !== null && 'error' in value) {
			return String((value as { error?: unknown }).error ?? `HTTP ${status}`)
		}
	}

	return `HTTP ${status}`
}

function unwrapTreatyResponse<T>(response: {
	data: T | null
	error: unknown
	status: number
}): T {
	if (response.error || response.data === null) {
		throw new Error(getTreatyErrorMessage(response.error, response.status))
	}

	return response.data
}

// Auth
export const auth = {
	login: (
		email: string,
		password: string,
		appId?: string,
		appSecret?: string,
	) =>
		apiRequest('/auth/login', {
			method: 'POST',
			body: JSON.stringify({
				email,
				password,
				// Legacy: app_id is optional now, org context comes from session
				...(appId && { app_id: appId }),
				...(appSecret && { app_secret: appSecret }),
			}),
		}),

	logout: () => apiRequest('/auth/logout', { method: 'POST' }),

	me: () => apiRequest('/auth/me'),

	getProfile: () => apiRequest<{
		success: boolean
		data: { id: string; name: string; email: string; role: string | null; avatar_url: string | null }
	}>('/auth/profile'),

	updateProfile: (payload: { name: string; avatarUrl?: string | null }) =>
		apiRequest<{
			success: boolean
			data: { id: string; name: string; email: string; role: string | null; avatar_url: string | null }
		}>('/auth/profile', { method: 'PATCH', body: JSON.stringify(payload) }),

	changePassword: (payload: { currentPassword: string; newPassword: string }) =>
		apiRequest<{ success: boolean }>('/auth/change-password', {
			method: 'POST',
			body: JSON.stringify(payload),
		}),

	getWhatsAppSession: () =>
		apiRequest<{
			success: boolean
			data: {
				phoneNumber: string | null
				status: string
				pairedSince: string | null
				durationSeconds: number
				lastConnectedAt: string | null
				lastSeenAt: string | null
			} | null
		}>('/auth/whatsapp-session'),

	disconnectWhatsAppSession: () =>
		apiRequest<{ success: boolean; message: string }>(
			'/auth/whatsapp-session/disconnect',
			{ method: 'POST' },
		),
}

// Conversations
export const conversations = {
	getCounts: () =>
		treatyApi.api.conversations.counts.get().then(unwrapTreatyResponse),

	list: (params?: {
		status?: 'open' | 'resolved' | 'pending'
		assignee_id?: string
		inbox_id?: string
		page?: number
		limit?: number
		dateFrom?: string
		dateTo?: string
		labelIds?: string
		resolvedBy?: string
		aiAgentId?: string
		pipelineStageId?: string
		channelType?: string
		provider?: 'all' | 'official' | 'baileys'
	}) =>
		treatyApi.api.conversations
			.get({
				query: {
					status: params?.status,
					agentId: params?.assignee_id,
					inboxId: params?.inbox_id,
					page: params?.page ? String(params.page) : undefined,
					limit: params?.limit ? String(params.limit) : undefined,
					dateFrom: params?.dateFrom,
					dateTo: params?.dateTo,
					labelIds: params?.labelIds,
					resolvedBy: params?.resolvedBy,
					aiAgentId: params?.aiAgentId,
					pipelineStageId: params?.pipelineStageId,
					channelType: params?.channelType,
					provider: params?.provider,
				},
			})
			.then(unwrapTreatyResponse),

	get: (id: string) =>
		treatyApi.api.conversations({ id }).get().then(unwrapTreatyResponse),

	getContactDetail: async (id: string) => {
		const response = await apiRequest<
			| { data?: ConversationContactDetailResponse | null }
			| ConversationContactDetailResponse
		>(`/conversations/${id}/contact-detail`)

		const payload =
			response &&
			typeof response === 'object' &&
			'data' in response &&
			(response as { data?: ConversationContactDetailResponse | null }).data
				? (response as { data: ConversationContactDetailResponse }).data
				: (response as ConversationContactDetailResponse)

		if (!payload || typeof payload !== 'object') {
			throw new Error('Invalid contact detail response')
		}

		return payload
	},

	getMessages: (
		id: string,
		params?: {
			limit?: number
			before?: string
		},
	) =>
		treatyApi.api
			.conversations({ id })
			.messages.get({
				query: {
					limit: String(
						typeof params?.limit === 'number' &&
							Number.isFinite(params.limit) &&
							params.limit > 0
							? Math.floor(params.limit)
							: 50,
					),
					before: params?.before,
				},
			})
			.then(unwrapTreatyResponse),

	sendMessage: (
		id: string,
		data: {
			content: any
			message_type?: 'outgoing' | 'incoming'
			type?:
				| 'text'
				| 'image'
				| 'document'
				| 'template'
				| 'interactive'
			content_type?: string
			media_url?: string
			media?: Record<string, unknown>
			private?: boolean
			reply_to_message_id?: string
			unique_temp_id?: string
			sender_type?: 'agent' | 'system'
			content_attributes?: Record<string, unknown>
		},
	) =>
		apiRequest(`/conversations/${id}/messages`, {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	assign: (
		id: string,
		data: {
			assignee_id: string
			team_id?: string
		},
	) =>
		treatyApi.api
			.conversations({ id })
			.assign.post({ agentId: data.assignee_id })
			.then(unwrapTreatyResponse),

	updateStatus: (id: string, status: 'open' | 'resolved' | 'pending') =>
		treatyApi.api
			.conversations({ id })
			.status.post({ status })
			.then(unwrapTreatyResponse),

	markAsRead: (id: string) =>
		treatyApi.api.conversations({ id }).read.post().then(unwrapTreatyResponse),

	suggestReply: (id: string) =>
		apiRequest(`/conversations/${id}/suggest-reply`, {
			method: 'POST',
		}),

	// Conversation Management (Advanced)
	resolve: (id: string) =>
		treatyApi.api
			.conversations({ id })
			.resolve.post()
			.then(unwrapTreatyResponse),

	bulkEdit: (data: {
		conversationIds: string[]
		collaboratorIds?: string[]
		handledById?: string
		labelId?: string
		pipelineStageId?: string
		resolveStatus?: 'open' | 'pending' | 'resolved'
	}) =>
		apiRequest('/conversations/bulk-edit', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	getBulkEditJob: (jobId: string) =>
		apiRequest(`/conversations/bulk-edit/${jobId}`),

	getAgents: (id: string) =>
		treatyApi.api.conversations({ id }).agents.get().then(unwrapTreatyResponse),

	addAgent: (id: string, agentId: string) =>
		apiRequest(`/conversations/${id}/agents`, {
			method: 'POST',
			body: JSON.stringify({ agent_id: agentId }),
		}),

	removeAgent: (id: string, agentId: string) =>
		apiRequest(`/conversations/${id}/agents/${agentId}`, {
			method: 'DELETE',
		}),

	takeover: (id: string, agentId?: string) =>
		apiRequest(`/conversations/${id}/takeover`, {
			method: 'POST',
			...(agentId ? { body: JSON.stringify({ agentId }) } : {}),
		}),

	getActivity: (id: string) =>
		treatyApi.api
			.conversations({ id })
			.activity.get()
			.then(unwrapTreatyResponse),

	// Notes
	getNotes: (id: string) =>
		treatyApi.api.conversations({ id }).notes.get().then(unwrapTreatyResponse),

	addNote: (id: string, content: string) =>
		treatyApi.api
			.conversations({ id })
			.notes.post({ content })
			.then(unwrapTreatyResponse),

	deleteNote: (noteId: string) =>
		apiRequest(`/conversation-notes/${noteId}`, {
			method: 'DELETE',
		}),

	// Labels
	getLabels: (id: string) =>
		treatyApi.api.conversations({ id }).labels.get().then(unwrapTreatyResponse),

	addLabel: (id: string, labelId: string) =>
		treatyApi.api
			.conversations({ id })
			.labels.post({ labelId })
			.then(unwrapTreatyResponse),

	removeLabel: (id: string, labelId: string) =>
		treatyApi.api
			.conversations({ id })
			.labels({ labelId })
			.delete()
			.then(unwrapTreatyResponse),
}

// Contact conversations history
export const contactConversations = {
	list: async (contactId: string) => {
		const response: any = await apiRequest(
			`/contacts/${contactId}/conversations`,
		)
		const payload = Array.isArray(response?.payload)
			? response.payload
			: Array.isArray(response?.data)
				? response.data
				: []

		return {
			success: typeof response?.success === 'boolean' ? response.success : true,
			payload,
			data: payload,
		}
	},
}

// User Timezone
export const userTimezone = {
	get: () =>
		treatyApi.api.user.timezone.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: {
					timezone: data.timezone,
					timezone_auto_detected: false,
					timezone_updated_at: null,
				},
			}
		}),

	update: (timezone: string) =>
		apiRequest('/user/timezone', {
			method: 'PUT',
			body: JSON.stringify({ timezone }),
		}),

	detect: (detectedTimezone: string) =>
		apiRequest<{
			success: boolean
			payload: {
				timezone: string
				timezone_auto_detected: boolean
				updated: boolean
			}
		}>('/user/timezone/detect', {
			method: 'POST',
			body: JSON.stringify({ detected_timezone: detectedTimezone }),
		}),

	reset: () =>
		apiRequest('/user/timezone/reset', {
			method: 'POST',
		}),
}

// Agents
export const agents = {
	list: () =>
		treatyApi.api.agents.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return { success: true, data: (data.data ?? []) as any[] }
		}),
}

// Teams
export interface Team {
	id: string
	name: string
	description?: string
	allow_auto_assign: boolean
	created_at: string
	members?: TeamMember[]
}

export interface TeamMember {
	id: string
	name: string
	email: string
	role: string
	active: boolean
	joined_at: string
}

export const teams = {
	list: () =>
		treatyApi.api.teams.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: (data.data ?? []) as unknown as Team[],
			}
		}),

	get: (id: string) =>
		treatyApi.api
			.teams({ id })
			.get()
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return { success: true, payload: data.data as unknown as Team }
			}),

	create: (data: {
		name: string
		description?: string
		allow_auto_assign?: boolean
	}) =>
		treatyApi.api.teams.post(data).then((response) => {
			const payload = unwrapTreatyResponse(response)
			return { success: true, payload: payload.data as unknown as Team }
		}),

	update: (
		id: string,
		data: { name?: string; description?: string; allow_auto_assign?: boolean },
	) =>
		treatyApi.api
			.teams({ id })
			.patch(data)
			.then((response) => {
				const payload = unwrapTreatyResponse(response)
				return { success: true, payload: payload.data as unknown as Team }
			}),

	delete: (id: string) =>
		treatyApi.api
			.teams({ id })
			.delete()
			.then(() => ({
				success: true,
				message: 'Team deleted',
			})),

	addMember: (teamId: string, userId: string) =>
		treatyApi.api
			.teams({ id: teamId })
			.members.post({ userId })
			.then(() => ({ success: true, message: 'Member added' })),

	removeMember: (teamId: string, userId: string) =>
		treatyApi.api
			.teams({ id: teamId })
			.members({ userId })
			.delete()
			.then(() => ({ success: true, message: 'Member removed' })),
}

// Chatbots
export const chatbots = {
	list: () =>
		treatyApi.api.chatbots.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			const nested = data as { data?: unknown; payload?: unknown }
			const nestedData = nested?.data
			const nestedPayload = nested?.payload
			const nextData = Array.isArray(data)
				? data
				: Array.isArray(nestedData)
					? nestedData
					: Array.isArray(nestedPayload)
						? nestedPayload
						: Array.isArray(
									(nestedData as { data?: unknown } | undefined)?.data,
								)
							? (nestedData as { data?: unknown[] }).data
							: []
			return { success: true, data: nextData as any[] }
		}),

	getDefault: () =>
		treatyApi.api.chatbots.default.get().then((response) => {
			const data = unwrapTreatyResponse(response) as {
				data?: { id?: string; name?: string } | null
			}
			return {
				success: true,
				data: data?.data && typeof data.data === 'object' ? data.data : null,
			}
		}),

	get: (id: string) =>
		treatyApi.api.chatbots({ id }).get().then(unwrapTreatyResponse),

	create: (data: {
		name: string
		description?: string
		prompt?: string
		model?: string
		is_active?: boolean
	}) => treatyApi.api.chatbots.post(data).then(unwrapTreatyResponse),

	update: (
		id: string,
		data: {
			name?: string
			description?: string
			prompt?: string
			model?: string
			is_active?: boolean
		},
	) => treatyApi.api.chatbots({ id }).patch(data).then(unwrapTreatyResponse),

	delete: (id: string) =>
		treatyApi.api.chatbots({ id }).delete().then(unwrapTreatyResponse),

	// Documents
	documents: {
		list: (chatbotId: string) =>
			treatyApi.api
				.chatbots({ id: chatbotId })
				.documents.get()
				.then(unwrapTreatyResponse),
		create: (
			chatbotId: string,
			data: { title: string; content: string; type?: string },
		) =>
			treatyApi.api
				.chatbots({ id: chatbotId })
				.documents.post(data)
				.then(unwrapTreatyResponse),
	},
}

// Labels
export const labels = {
	list: () => treatyApi.api.labels.get().then(unwrapTreatyResponse),
	create: (data: any) =>
		treatyApi.api.labels.post(data).then(unwrapTreatyResponse),
	update: (id: string, data: any) =>
		treatyApi.api.labels({ id }).patch(data).then(unwrapTreatyResponse),
	delete: (id: string) =>
		treatyApi.api.labels({ id }).delete().then(unwrapTreatyResponse),
}

// AI
export const ai = {
	getProviders: () => apiRequest('/ai/providers'),

	// Note: Eden Treaty type inference issue - using apiRequest for now
	getSuggestion: (conversationId: string) =>
		apiRequest(`/ai/suggest/${conversationId}`),

	// Note: Backend doesn't have /ai/analyze endpoint yet
	analyze: (conversationId: string) =>
		apiRequest('/ai/analyze', {
			method: 'POST',
			body: JSON.stringify({ conversationId }),
		}),

	// Note: Backend doesn't have /ai/auto-respond endpoint yet
	autoRespond: (conversationId: string) =>
		apiRequest('/ai/auto-respond', {
			method: 'POST',
			body: JSON.stringify({ conversationId }),
		}),

	// Additional AI endpoints available in backend
	generateResponse: (message: string, conversationId?: string) =>
		treatyApi.api.ai.generate
			.post({ message, conversationId })
			.then(unwrapTreatyResponse),

	evaluate: (data: {
		conversationId: string
		score: number
		feedback?: string
	}) => treatyApi.api.ai.evaluate.post(data).then(unwrapTreatyResponse),

	getSettings: () => treatyApi.api.ai.settings.get().then(unwrapTreatyResponse),

	updateSettings: (data: any) =>
		treatyApi.api.ai.settings.patch(data).then(unwrapTreatyResponse),

	getPlayground: (sessionId?: string) =>
		apiRequest(
			`/ai/playground${sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : ''}`,
		),

	resetPlaygroundSession: (data?: {
		sessionId?: string
		modelId?: string
		strategyId?: string
		personaId?: string
	}) =>
		apiRequest('/ai/playground/session', {
			method: 'POST',
			body: JSON.stringify(data || {}),
		}),

	updatePlaygroundSession: (
		sessionId: string,
		data: {
			modelId?: string
			strategyId?: string
			personaId?: string
		},
	) =>
		apiRequest(`/ai/playground/session/${encodeURIComponent(sessionId)}`, {
			method: 'PATCH',
			body: JSON.stringify(data),
		}),

	createPlaygroundStrategy: (data: {
		label: string
		description?: string
		activate?: boolean
		rules?: Array<{
			name?: string
			provider?: string
			modelId?: string
			minConfidence?: number
			maxConfidence?: number
		}>
	}) =>
		apiRequest('/ai/playground/strategy', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	getPlaygroundPersonas: () => apiRequest('/ai/playground/personas'),

	createPlaygroundPersona: (data: {
		label: string
		systemInstruction: string
		agentType: 'ai_sales' | 'ai_support' | 'ai_general'
		setAsDefaultForType?: boolean
		setAsGlobalDefault?: boolean
	}) =>
		apiRequest('/ai/playground/personas', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	updatePlaygroundPersona: (
		personaId: string,
		data: {
			label?: string
			systemInstruction?: string
			agentType?: 'ai_sales' | 'ai_support' | 'ai_general'
			setAsDefaultForType?: boolean
			setAsGlobalDefault?: boolean
		},
	) =>
		apiRequest(`/ai/playground/personas/${encodeURIComponent(personaId)}`, {
			method: 'PATCH',
			body: JSON.stringify(data),
		}),

	deletePlaygroundPersona: (personaId: string) =>
		apiRequest(`/ai/playground/personas/${encodeURIComponent(personaId)}`, {
			method: 'DELETE',
		}),

	runPlayground: (data: {
		sessionId: string
		message: string
		modelId?: string
		strategyId?: string
		personaId?: string
		selectedSourceIds?: string[]
		ragTopK?: number
		enqueue?: boolean
	}) =>
		apiRequest('/ai/playground/run', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	getPlaygroundRunStatus: (jobId: string) =>
		apiRequest(`/ai/playground/run/${encodeURIComponent(jobId)}`),
}

// Routing
export const routing = {
	getRules: () => apiRequest('/routing/rules'),

	route: (conversationId: string) =>
		apiRequest('/routing/route', {
			method: 'POST',
			body: JSON.stringify({ conversationId }),
		}),
}

function toFiniteNumber(value: unknown, fallback = 0) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeMetricsDashboardPeriod(period?: string) {
	const normalized = String(period || '').trim().toLowerCase()
	if (normalized === 'today' || normalized === '24h') return 'today'
	if (normalized === '30d') return '30d'
	return '7d'
}

function mapDashboardSummaryToUiData(raw: any) {
	const dashboard = raw?.dashboard || {}
	const cards = dashboard?.cards || {}
	const volume = Array.isArray(dashboard?.volume) ? dashboard.volume : []
	const totalMessages = toFiniteNumber(raw?.total_messages)
	const activeConversations = toFiniteNumber(raw?.active_conversations)
	const totalCustomers = toFiniteNumber(raw?.total_customers)
	const avgResponseTime = toFiniteNumber(
		cards?.avgResponseSeconds?.value ?? raw?.avg_response_time,
	)
	const aiHandlingRate = toFiniteNumber(
		cards?.aiResolvedRate?.value ?? raw?.ai_handling_rate,
	)
	const deliveredMessages = toFiniteNumber(raw?.delivered_messages)
	const readMessages = toFiniteNumber(raw?.read_messages)
	const deliveryRate = toFiniteNumber(raw?.delivery_rate)
	const period =
		typeof raw?.period === 'string' && raw.period.trim() ? raw.period : '24h'
	const sentDetails = volume.map((entry: any) => ({
		date: String(entry.day || entry.date || ''),
		value: toFiniteNumber(
			entry.total ??
				toFiniteNumber(entry.ai) +
					toFiniteNumber(entry.cs) +
					toFiniteNumber(entry.handover),
		),
	}))

	return {
		messages: {
			total: totalMessages,
			today: toFiniteNumber(cards?.incomingChats?.value, totalMessages),
			thisWeek: totalMessages,
			thisMonth: totalMessages,
			sent: totalMessages,
			delivered: deliveredMessages,
			read: readMessages,
			failed: 0,
			growth: 0,
			deliveryRate,
			readRate: 0,
			byType: {
				text: totalMessages,
			},
			byChannel: {
				whatsapp: totalMessages,
				instagram: 0,
			},
			sentDetails,
		},
		customers: {
			total: totalCustomers,
			newThisWeek: 0,
			activeWindows: activeConversations,
			activeToday: activeConversations,
			growth: 0,
			customersDetails: [],
		},
		performance: {
			avgResponseTime: `${avgResponseTime}s`,
			resolutionRate: 0,
			satisfactionScore: 0,
			responseDetails: [],
		},
		channels: [
			{
				name: 'WhatsApp',
				value: totalMessages,
				color: '#10B981',
			},
			{
				name: 'Instagram',
				value: 0,
				color: '#EC4899',
			},
		],
		agents: Array.isArray(dashboard?.agents)
			? dashboard.agents.map((agent: any) => ({
					name: String(agent.name || 'Agent'),
					convs: toFiniteNumber(agent.chats),
					replies: toFiniteNumber(agent.chats),
					rating: toFiniteNumber(agent.csat),
				}))
			: [],
		whatsapp: {
			connected: totalMessages > 0 || activeConversations > 0,
		},
		instagram: {
			connected: false,
			conversations: 0,
			unreadCount: 0,
		},
		templates: {
			total: 0,
			approved: 0,
			pending: 0,
			rejected: 0,
			byCategory: {
				marketing: 0,
				utility: 0,
				authentication: 0,
			},
			usageThisMonth: 0,
		},
		quality: {
			rating: null,
			messagingTier: null,
			blockCount7days: 0,
			spamReportCount7days: 0,
			status: aiHandlingRate > 0 ? 'active' : 'unknown',
		},
		lastUpdated: new Date().toISOString(),
		source: {
			...(raw?.source || {}),
			period,
			total_messages: totalMessages,
			active_conversations: activeConversations,
			avg_response_time: avgResponseTime,
			ai_handling_rate: aiHandlingRate,
			revenue: toFiniteNumber(cards?.revenue?.value ?? raw?.source?.revenue),
			daily: volume,
			dashboard,
		},
	}
}

export type PersonalAiSettings = {
	autoReplyEnabled: boolean
	reviewEnabled: boolean
	replyDelaySeconds: number
	minConfidence: number
	personaPrompt: string | null
	model: string
}

export type PersonalAiDraft = {
	id: string
	status: 'draft_ready' | 'handover'
	conversationId: string
	contactName: string
	phoneNumber: string | null
	latestCustomerMessage: string | null
	draftText: string | null
	reviewReason: string | null
	reviewConfidence: number | null
	updatedAt: string
}

export type PersonalTakeoverItem = {
	conversationId: string
	contactName: string
	contactPhone: string
	preview: string | null
	lastMessageAt: string | null
	ownerUserId: string
	ownerName: string | null
	takenBy: string | null
	takenByName: string | null
	source: 'manual' | 'ai' | string
	reason: string | null
	note: string | null
	aiReason: string | null
	aiSuggestedReply: string | null
	takenAt: string | null
	awaitingResponse: boolean
	respondedAt: string | null
	waitingMinutes: number
	slaMinutes: number
	overdue: boolean
}

export type NotificationType =
	| 'takeover'
	| 'lead_pending'
	| 'task_urgent'
	| 'ai_draft'
	| 'wa_disconnected'
	| string

export type NotificationItem = {
	id: string
	type: NotificationType
	title: string
	body: string | null
	conversationId: string | null
	taskId: string | null
	metadata: Record<string, unknown>
	read: boolean
	createdAt: string
}

export const notifications = {
	list: (options?: { limit?: number; unreadOnly?: boolean }) => {
		const params = new URLSearchParams()
		if (options?.limit) params.set('limit', String(options.limit))
		if (options?.unreadOnly) params.set('unreadOnly', 'true')
		const query = params.toString()
		return apiRequest<{ data: NotificationItem[] }>(
			`/notifications${query ? `?${query}` : ''}`,
		)
	},
	count: () => apiRequest<{ count: number }>('/notifications/count'),
	markRead: (id: string) =>
		apiRequest<{ success: boolean }>(`/notifications/${id}/read`, { method: 'POST' }),
	markAllRead: () =>
		apiRequest<{ success: boolean; count: number }>('/notifications/read-all', {
			method: 'POST',
		}),
}

export type PersonalTakeoverHistoryItem = {
	id: string
	action: 'personal_takeover' | 'personal_release' | string
	actorType: string
	actorName: string | null
	source: string | null
	reason: string | null
	note: string | null
	createdAt: string
}

export const personalAi = {
	getSettings: () =>
		apiRequest<{ data: PersonalAiSettings }>('/personal-whatsapp-inbox/ai/settings'),
	updateSettings: (input: Partial<Pick<PersonalAiSettings, 'autoReplyEnabled' | 'replyDelaySeconds' | 'minConfidence' | 'personaPrompt'>>) =>
		apiRequest<{ data: PersonalAiSettings }>('/personal-whatsapp-inbox/ai/settings', {
			method: 'PATCH',
			body: JSON.stringify(input),
		}),
	listDrafts: () =>
		apiRequest<{ data: PersonalAiDraft[] }>('/personal-whatsapp-inbox/ai/drafts'),
	sendDraft: (taskId: string, content: string) =>
		apiRequest<{ success: boolean; data: { messageId: string } }>(`/personal-whatsapp-inbox/ai/drafts/${taskId}/send`, {
			method: 'POST',
			body: JSON.stringify({ content }),
		}),
	dismissDraft: (taskId: string) =>
		apiRequest<{ success: boolean }>(`/personal-whatsapp-inbox/ai/drafts/${taskId}/dismiss`, { method: 'POST' }),
	// Number of the sales' own inbox conversations with unread messages.
	inboxUnreadCount: () =>
		apiRequest<{ count: number }>('/personal-whatsapp-inbox/unread-count'),
	// Per-conversation takeover (AI -> human) for personal WhatsApp leads.
	listTakeovers: () =>
		apiRequest<{ data: PersonalTakeoverItem[] }>('/personal-whatsapp-inbox/takeovers'),
	takeoverCount: () =>
		apiRequest<{ count: number }>('/personal-whatsapp-inbox/takeovers/count'),
	takeoverHistory: (conversationId: string) =>
		apiRequest<{ data: PersonalTakeoverHistoryItem[] }>(
			`/personal-whatsapp-inbox/${conversationId}/takeover-history`,
		),
	takeover: (conversationId: string, options?: { reason?: string; note?: string }) =>
		apiRequest<{ success: boolean; conversationId: string; aiHandling: boolean }>(
			`/personal-whatsapp-inbox/${conversationId}/takeover`,
			{ method: 'POST', body: JSON.stringify(options || {}) },
		),
	release: (conversationId: string, note?: string) =>
		apiRequest<{ success: boolean; conversationId: string; aiHandling: boolean }>(
			`/personal-whatsapp-inbox/${conversationId}/release`,
			{ method: 'POST', body: JSON.stringify(note ? { note } : {}) },
		),
}

// Metrics
export const metrics = {
	getSummary: (period?: string) =>
		treatyApi.api.metrics.summary
			.get({ query: period ? { period } : undefined })
			.then(unwrapTreatyResponse),

	getAI: () => treatyApi.api.metrics.ai.get().then(unwrapTreatyResponse),

	// Note: Backend doesn't have /metrics/routing endpoint yet
	getRouting: (period?: string) =>
		apiRequest(`/metrics/routing${period ? `?period=${period}` : ''}`),

	getDashboard: async (period?: string) => {
		const normalizedPeriod = normalizeMetricsDashboardPeriod(period)
		const raw = await apiRequest<any>(
			`/metrics/dashboard?period=${encodeURIComponent(normalizedPeriod)}`,
		)
		const payload =
			raw && typeof raw === 'object' && 'data' in raw && raw.data
				? raw.data
				: raw

		return {
			success: true,
			data: mapDashboardSummaryToUiData(payload),
		}
	},

	// Note: Backend doesn't have /metrics/agents endpoint yet
	getAgents: () => apiRequest('/metrics/agents'),

	// Note: Backend doesn't have /metrics/clear endpoint yet
	clear: () =>
		apiRequest('/metrics/clear', {
			method: 'POST',
		}),
}

// Contacts/Customers
export const contacts = {
	list: (params?: { page?: number; per_page?: number; search?: string }) =>
		treatyApi.api.contacts
			.get({
				query: {
					q: params?.search,
				},
			})
			.then(unwrapTreatyResponse),

	get: (id: string) => apiRequest(`/contacts/${id}/detail`),

	create: (data: {
		name: string
		phone_number: string
		email?: string
	}) =>
		apiRequest('/contacts', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	update: (
		id: string,
		data: {
			name?: string
			email?: string
			phone_number?: string
		},
	) => treatyApi.api.contacts({ id }).patch(data).then(unwrapTreatyResponse),

	block: (id: string, reason: string) =>
		apiRequest(`/contacts/${id}/block`, {
			method: 'POST',
			body: JSON.stringify({ reason }),
		}),

	blockCall: (id: string, reason: string) =>
		apiRequest(`/contacts/${id}/block-call`, {
			method: 'POST',
			body: JSON.stringify({ reason }),
		}),

	merge: (id: string, targetContactId: string) =>
		apiRequest(`/contacts/${id}/merge`, {
			method: 'POST',
			body: JSON.stringify({ target_contact_id: targetContactId }),
		}),

	settings: {
		get: () => apiRequest('/contacts/settings'),
		createStage: (data: {
			name: string
			color?: string
			isDefault?: boolean
		}) =>
			apiRequest('/contacts/settings/stages', {
				method: 'POST',
				body: JSON.stringify(data),
			}),
		updateStage: (
			id: string,
			data: {
				name?: string
				color?: string
				isDefault?: boolean
			},
		) =>
			apiRequest(`/contacts/settings/stages/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		deleteStage: (id: string) =>
			apiRequest(`/contacts/settings/stages/${id}`, { method: 'DELETE' }),
		reorderStages: (stageIds: string[]) =>
			apiRequest('/contacts/settings/stages/reorder', {
				method: 'PATCH',
				body: JSON.stringify({ stageIds }),
			}),
		createField: (data: {
			fieldKey?: string
			fieldLabel: string
			fieldType: string
			options?: unknown[]
			isRequired?: boolean
			isVisible?: boolean
		}) =>
			apiRequest('/contacts/settings/fields', {
				method: 'POST',
				body: JSON.stringify(data),
			}),
		updateField: (
			id: string,
			data: {
				fieldKey?: string
				fieldLabel?: string
				fieldType?: string
				options?: unknown[]
				isRequired?: boolean
				isVisible?: boolean
			},
		) =>
			apiRequest(`/contacts/settings/fields/${id}`, {
				method: 'PATCH',
				body: JSON.stringify(data),
			}),
		deleteField: (id: string) =>
			apiRequest(`/contacts/settings/fields/${id}`, { method: 'DELETE' }),
		reorderFields: (fieldIds: string[]) =>
			apiRequest('/contacts/settings/fields/reorder', {
				method: 'PATCH',
				body: JSON.stringify({ fieldIds }),
			}),
	},
}

// Customers (Enhanced)
export const customers = {
	list: (params?: {
		page?: number
		per_page?: number
		search?: string
		pipeline_stage_id?: string
		consent_status?: string
		tag_id?: string
		channel?: string
		sort?: string
		order?: 'asc' | 'desc'
	}) => {
		const queryParams = new URLSearchParams()

		for (const [key, value] of Object.entries(params || {})) {
			if (value === undefined || value === null) continue

			if (typeof value === 'string') {
				const trimmed = value.trim()
				const lowered = trimmed.toLowerCase()
				if (!trimmed || lowered === 'undefined' || lowered === 'null') continue
				queryParams.set(key, trimmed)
				continue
			}

			queryParams.set(key, String(value))
		}

		const query = queryParams.toString()
		return apiRequest(`/customers${query ? `?${query}` : ''}`)
	},

	stats: () => apiRequest('/customers/stats'),

	get: (id: string) => apiRequest(`/customers/${id}`),

	update: (
		id: string,
		data: {
			name?: string
			email?: string
			phone_number?: string
			notes?: string
			lead_score?: number
			pipeline_stage_id?: string
			consent_status?: string
			consent_purpose?: string
			consent_source?: string
			custom_attributes?: Record<string, unknown>
		},
	) =>
		apiRequest(`/customers/${id}`, {
			method: 'PUT',
			body: JSON.stringify(data),
		}),

	addTag: (id: string, data: { tag_name?: string; tag_id?: string }) =>
		apiRequest(`/customers/${id}/tags`, {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	removeTag: (id: string, tagId: string) =>
		apiRequest(`/customers/${id}/tags/${tagId}`, {
			method: 'DELETE',
		}),

}

// Inboxes (Omnichannel)
export const inboxes = {
	list: () => treatyApi.api.inboxes.get().then(unwrapTreatyResponse),

	get: (id: string) =>
		treatyApi.api.inboxes({ id }).get().then(unwrapTreatyResponse),

	create: (data: {
		name: string
		channel_type: 'whatsapp' | 'instagram' | 'tiktok' | 'web'
		channel_config: any
	}) =>
		treatyApi.api.inboxes
			.post({
				name: data.name,
				channel_type: data.channel_type,
				channel_config: data.channel_config,
			})
			.then(unwrapTreatyResponse),

	update: (id: string, data: any) =>
		treatyApi.api.inboxes({ id }).patch(data).then(unwrapTreatyResponse),

	delete: (id: string) =>
		treatyApi.api.inboxes({ id }).delete().then(unwrapTreatyResponse),
}

type KnowledgeSourceInput = {
	title: string
	content?: string
	type?: string
	format?: string
	embedding_model?: string
	metadata?: Record<string, unknown>
	source_type?: string
	source_url?: string
	file_name?: string
	file_size?: number
	file_type?: string
	category_id?: string
	files?: Array<{
		file_name: string
		mime_type?: string
		file_size_bytes?: number
		checksum_sha256?: string
		storage_key?: string
		storage_url?: string
		language?: string
		page_count?: number
		duration_ms?: number
		extraction_metadata?: Record<string, unknown>
	}>
}

// Knowledge Base
export const knowledge = {
	list: (params?: { categoryId?: string; q?: string; limit?: number }) => {
		const query = new URLSearchParams()
		if (params?.categoryId) query.set('categoryId', params.categoryId)
		if (params?.q) query.set('q', params.q)
		if (typeof params?.limit === 'number' && Number.isFinite(params.limit)) {
			query.set('limit', String(Math.max(1, Math.round(params.limit))))
		}
		const suffix = query.toString() ? `?${query.toString()}` : ''
		return apiRequest(`/knowledge/sources${suffix}`)
	},

	getSource: (id: string) =>
		apiRequest(`/knowledge/sources/${encodeURIComponent(id)}`),

	createSource: (data: KnowledgeSourceInput) =>
		apiRequest('/knowledge/sources', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	updateSource: (id: string, data: Partial<KnowledgeSourceInput>) =>
		apiRequest(`/knowledge/sources/${encodeURIComponent(id)}`, {
			method: 'PATCH',
			body: JSON.stringify(data),
		}),

	deleteSource: (id: string) =>
		apiRequest(`/knowledge/sources/${encodeURIComponent(id)}`, {
			method: 'DELETE',
		}),

	uploadSourceFile: async (args: {
		file: File
		embeddingModel?: string
		title?: string
		isPrivate?: boolean
		tags?: string[]
	}) => {
		const formData = new FormData()
		formData.append('file', args.file)
		if (args.embeddingModel)
			formData.append('embeddingModel', args.embeddingModel)
		if (args.title) formData.append('title', args.title)
		if (args.isPrivate === true) formData.append('isPrivate', 'true')
		if (Array.isArray(args.tags)) {
			for (const tag of args.tags) {
				const normalized = String(tag || '').trim()
				if (!normalized) continue
				formData.append('tags', normalized)
			}
		}

		const response = await fetch(`${API_BASE}/knowledge/sources/upload`, {
			method: 'POST',
			headers: getMultipartAuthHeaders(),
			body: formData,
		})

		const payload = (await response
			.json()
			.catch(() => ({ error: 'Upload failed' }))) as ApiErrorPayload
		if (!response.ok) {
			throw buildApiRequestError(payload, response.status)
		}
		return payload as {
			success: boolean
			data?: {
				source?: { id: string; title: string }
				upload?: {
					url: string
					key: string
					type: string
					mimeType: string
					fileName: string
					fileSize: number
					checksumSha256?: string
				}
			}
		}
	},

	retrievalTest: (data: {
		query: string
		selectedSourceIds?: string[]
		topK?: number
		modelId?: string
		provider?: string
	}) =>
		apiRequest('/knowledge/retrieval/test', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	analytics: (params?: { window?: string; channel?: string }) => {
		const query = new URLSearchParams()
		if (params?.window) query.set('window', params.window)
		if (params?.channel) query.set('channel', params.channel)
		const suffix = query.toString() ? `?${query.toString()}` : ''
		return apiRequest(`/knowledge/analytics${suffix}`)
	},

	// Backward compatibility aliases
	add: (data: {
		title: string
		content: string
		type?: 'text' | 'url' | 'pdf'
	}) =>
		apiRequest('/knowledge', {
			method: 'POST',
			body: JSON.stringify(data),
		}),

	query: (query: string) =>
		apiRequest('/knowledge/query', {
			method: 'POST',
			body: JSON.stringify({
				query,
			}),
		}),
}

// WhatsApp Channels
export const whatsappChannels = {
	getMyConnection: () =>
		apiRequest<{ success: boolean; data: PersonalWhatsAppConnection }>(
			'/whatsapp-channels/me/connection',
		),

	startMyConnection: () =>
		apiRequest<{ success: boolean; data: PersonalWhatsAppConnection }>(
			'/whatsapp-channels/me/connection/start',
			{ method: 'POST' },
		),

	stopMyConnection: () =>
		apiRequest<{ success: boolean; data: PersonalWhatsAppConnection | null }>(
			'/whatsapp-channels/me/connection/stop',
			{ method: 'POST' },
		),
	sync: (channelId: string) =>
		apiRequest(`/whatsapp/${channelId}/sync`, {
			method: 'POST',
		}),

	getBaileysSession: (channelId: string) =>
		apiRequest<{
			success: boolean
			data: {
				channelId: string
				providerChannelKey: string
				phoneNumber: string | null
				status: string
				pairingCode: string | null
				qrCode: string | null
				lastError: string | null
				lastConnectedAt: string | null
				lastSeenAt: string | null
				isConnected: boolean
			}
		}>(`/whatsapp-channels/${channelId}/baileys/session`),

	restartBaileysSession: (channelId: string) =>
		apiRequest<{
			success: boolean
			data: {
				channelId: string
				providerChannelKey: string
				phoneNumber: string | null
				status: string
				pairingCode: string | null
				qrCode: string | null
				lastError: string | null
				lastConnectedAt: string | null
				lastSeenAt: string | null
				isConnected: boolean
			}
		}>(`/whatsapp-channels/${channelId}/baileys/session/start`, {
			method: 'POST',
		}),

	getDetails: (channelId: string) =>
		apiRequest<{
			success: boolean
			data: {
				id: string
				name: string
				phone_number: string
				phone_number_id: string
				business_id: string
				business_name: string
				timezone: string
				currency: string
				business_verification_status: string
				phone_number_status: string
				quality_rating: string
				messaging_limit: string
				verified_name: string
				provider: string
				provider_channel_key: string | null
				provider_webhook_url: string | null
				is_active: boolean
				is_on_cloud: boolean
				is_bot_enabled: boolean
				is_auto_responder_enabled: boolean
				forward_enabled: boolean
				forward_url: string | null
				badge_url: string | null
				platform: string
				last_synced_at: string | null
				created_at: string
				updated_at: string
				quality_score: {
					percentage: number
					color: string
					label: string
				}
				limit_info: {
					daily_limit: string
					tier_level: number
				}
				metadata: {
					profile_picture_url?: string
					about?: string
					description?: string
					email?: string
					websites?: string[]
					vertical?: string
					// Configuration fields
					default_chatbot_id?: string
					default_flow_id?: string
					default_team_ids?: string[]
					default_agent_ids?: string[]
					distribution_method?: 'round_robin' | 'least_assigned'
					tags?: string[]
				}
			}
		}>(`/whatsapp/${channelId}/details`),

	uploadBadge: async (
		channelId: string,
		file: File,
	): Promise<{ success?: boolean; badge_url?: string | null }> => {
		const formData = new FormData()
		formData.append('badge', file)

		const response = await fetch(`${API_BASE}/whatsapp/${channelId}/badge`, {
			method: 'POST',
			headers: getMultipartAuthHeaders(),
			body: formData,
		})

		const payload = (await response
			.json()
			.catch(() => ({ error: 'Badge upload failed' }))) as ApiErrorPayload & {
			success?: boolean
			badge_url?: string | null
		}

		if (!response.ok) {
			throw buildApiRequestError(payload, response.status)
		}

		return payload
	},

	removeBadge: (channelId: string) =>
		apiRequest(`/whatsapp/${channelId}/badge`, {
			method: 'DELETE',
		}),

	update: (
		channelId: string,
		data: {
			name?: string
			tags?: string[]
			default_chatbot_id?: string | null
			default_flow_id?: string | null
			default_team_ids?: string[]
			default_agent_ids?: string[]
			distribution_method?: 'round_robin' | 'least_assigned'
		},
	) =>
		apiRequest(`/whatsapp-channels/${channelId}`, {
			method: 'PATCH',
			body: JSON.stringify(data),
		}),

	delete: (channelId: string) =>
		apiRequest(`/whatsapp-channels/${channelId}`, {
			method: 'DELETE',
		}),
}

export type PersonalWhatsAppConnection = {
	channelId: string | null
	phoneNumber: string | null
	status: string
	pairingCode: string | null
	qrCode: string | null
	lastError: string | null
	lastConnectedAt: string | null
	isConnected: boolean
	requiresPairing: boolean
	hasConnectedBefore: boolean
}

export const whatsappTemplates = {
	list: (
		status?: string,
		category?: string,
		options?: {
			inboxId?: string
			channelId?: string
			search?: string
			limit?: number
		},
	) => {
		const query = new URLSearchParams()
		if (status) query.set('status', status)
		if (category) query.set('category', category)
		if (options?.inboxId) query.set('inboxId', options.inboxId)
		if (options?.channelId) query.set('channelId', options.channelId)
		if (options?.search) query.set('search', options.search)
		if (
			typeof options?.limit === 'number' &&
			Number.isFinite(options.limit) &&
			options.limit > 0
		) {
			query.set('limit', String(Math.floor(options.limit)))
		}
		const suffix = query.toString() ? `?${query.toString()}` : ''
		return apiRequest<{ success: boolean; data: any[] }>(
			`/whatsapp/templates${suffix}`,
		)
	},
	sync: (channelId: string) =>
		apiRequest<{ success: boolean; data: any }>(`/whatsapp/templates/sync`, {
			method: 'POST',
			body: JSON.stringify({ channelId }),
		}),
}

// Media Upload
export const media = {
	upload: async (
		file: File,
		platform: 'whatsapp' | 'instagram' | 'tiktok' = 'whatsapp',
	): Promise<{
		success: boolean
		payload?: {
			url: string
			type: 'image' | 'document' | 'video' | 'audio'
			mimeType: string
			fileName: string
			fileSize: number
			key: string
		}
		error?: string
	}> => {
		const formData = new FormData()
		formData.append('file', file)
		formData.append('platform', platform)

		const response = await fetch(`${API_BASE}/media/upload`, {
			method: 'POST',
			headers: getMultipartAuthHeaders(),
			body: formData,
		})

		const text = await response.text()
		let parsed: any = null
		try {
			parsed = JSON.parse(text)
		} catch {
			parsed = null
		}

		if (!response.ok) {
			return {
				success: false,
				error:
					parsed?.error ||
					text ||
					`Upload failed with status ${response.status}`,
			}
		}

		if (parsed?.success === false) {
			return {
				success: false,
				error: parsed?.error || 'Upload failed',
			}
		}

		const payload = parsed?.payload || parsed?.data || parsed
		if (!payload?.url) {
			return {
				success: false,
				error: 'Upload response invalid',
			}
		}

		return {
			success: true,
			payload: {
				url: payload.url,
				type: payload.type,
				mimeType: payload.mimeType,
				fileName: payload.fileName,
				fileSize: payload.fileSize,
				key: payload.key,
			},
		}
	},
	gallery: async (options?: {
		type?: string
		take?: number
		cursor?: string
	}): Promise<{
		success: boolean
		payload?: Array<{
			id: string
			media_type: string | null
			mime_type: string | null
			filename: string | null
			file_size: number | null
			url: string | null
			created_at: string | null
		}>
		error?: string
	}> => {
		try {
			const params = new URLSearchParams()
			if (options?.type) params.set('type', options.type)
			if (options?.take) params.set('take', String(options.take))
			if (options?.cursor) params.set('cursor', options.cursor)
			const qs = params.toString()
			const data = await apiRequest<{ data: any[] }>(
				`/media/gallery${qs ? `?${qs}` : ''}`,
			)
			return { success: true, payload: data.data }
		} catch (err: unknown) {
			return {
				success: false,
				error: err instanceof Error ? err.message : 'Failed to load gallery',
			}
		}
	},
}
// Automation Flows
export const automationFlows = {
	list: () =>
		treatyApi.api.flows.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return { success: true, payload: (data.payload ?? []) as any[] }
		}),
	get: (id: string) =>
		treatyApi.api
			.flows({ id })
			.get()
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return { success: true, payload: data.data }
			}),
	getExecutions: (
		id: string,
		params?: {
			conversationId?: string
			executionId?: string
		},
	) =>
		treatyApi.api
			.flows({ id })
			.executions.get({
				query: {
					...(params?.conversationId?.trim()
						? { conversationId: params.conversationId.trim() }
						: {}),
					...(params?.executionId?.trim()
						? { executionId: params.executionId.trim() }
						: {}),
				},
			})
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return { success: true, payload: (data.payload ?? []) as any[] }
			}),
	getVersions: (id: string) =>
		treatyApi.api
			.flows({ id })
			.versions.get()
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return { success: true, payload: (data.payload ?? []) as any[] }
			}),
	getDefault: () =>
		apiRequest<any>('/flows/default').then((response) => ({
			success: true,
			payload: response?.payload ?? response?.data ?? response,
		})),
	setDefault: (id: string) =>
		apiRequest<any>(`/flows/${encodeURIComponent(id)}/default`, {
			method: 'POST',
			body: JSON.stringify({}),
		}).then((response) => ({
			success: true,
			payload: response?.payload ?? response?.data ?? response,
		})),
	testRun: (id: string, input?: Record<string, unknown>) =>
		treatyApi.api
			.flows({ id })
			['test-run'].post(input ? { input } : {})
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return { success: true, payload: data.payload }
			}),
	debugNode: (id: string, nodeId: string, input: Record<string, unknown>) =>
		treatyApi.api
			.flows({ id })
			['debug-node'].post({ nodeId, input })
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return { success: true, payload: data.payload }
			}),
	create: (data: any) =>
		treatyApi.api.flows.post(data).then((response) => {
			const payload = unwrapTreatyResponse(response)
			return { success: true, payload: payload.data }
		}),
	update: (id: string, data: any) =>
		treatyApi.api
			.flows({ id })
			.patch(data)
			.then((response) => {
				const payload = unwrapTreatyResponse(response)
				return { success: true, payload: payload.data }
			}),
	delete: (id: string) =>
		treatyApi.api
			.flows({ id })
			.delete()
			.then(() => ({
				success: true,
			})),
}

export const n8nEmbed = {
	login: (force = false) =>
		apiRequest<{
			success: boolean
			embedUrl?: string
			error?: string
		}>(`/n8n/embed-login${force ? '?force=1' : ''}`, {
			method: 'POST',
			credentials: 'include',
		}),
}

// Broadcasts
export const broadcasts = {
	list: () =>
		treatyApi.api.broadcasts.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return { success: true, payload: (data.data ?? []) as any[] }
		}),
	listJobs: async (params?: {
		page?: number
		limit?: number
		status?: string[]
	}) => {
		const query = new URLSearchParams()
		if (params?.page) query.set('page', String(params.page))
		if (params?.limit) query.set('limit', String(params.limit))
		if (Array.isArray(params?.status)) {
			params.status
				.filter((value) => typeof value === 'string' && value.trim().length > 0)
				.forEach((value) => {
					query.append('status', value)
				})
		}

		const suffix = query.toString()
		const data = await apiRequest<{
			success: boolean
			data?: any[]
			pagination?: {
				page: number
				limit: number
				total: number
				totalPages: number
			}
		}>(`/broadcasts/jobs${suffix ? `?${suffix}` : ''}`)

		return {
			success: Boolean(data.success),
			payload: (data.data ?? []) as any[],
			pagination: data.pagination,
		}
	},
	getJob: async (id: string) => {
		const data = await apiRequest<{ success: boolean; data?: any }>(
			`/broadcasts/jobs/${id}`,
		)
		return {
			success: Boolean(data.success),
			payload: data.data ?? null,
		}
	},
	get: (id: string) =>
		apiRequest<{ success: boolean; payload: any }>(`/broadcasts/${id}`),
	previewAudience: async (filters?: {
		cities?: string[]
		minPaidOrders?: number
		lastActiveWithinDays?: number
		excludeOptedOut?: boolean
	}) => {
		const data = await apiRequest<{
			success: boolean
			data?: {
				total: number
				filters: {
					cities: string[]
					minPaidOrders: number
					lastActiveWithinDays: number
					excludeOptedOut: boolean
				}
			}
		}>('/broadcasts/audience/preview', {
			method: 'POST',
			body: JSON.stringify({ filters: filters || {} }),
		})

		return {
			success: Boolean(data.success),
			payload: data.data ?? null,
		}
	},
	create: (data: {
		title: string
		message_content: string
		message_type?: 'text' | 'template'
		template_name?: string
		template_language?: string
		template_params?: Record<string, any>
		target_audience?: Record<string, any>
		scheduled_at?: string
	}) =>
		treatyApi.api.broadcasts.post(data).then((response) => {
			const payload = unwrapTreatyResponse(response)
			return { success: true, payload: payload.data }
		}),
	send: (id: string) =>
		treatyApi.api
			.broadcasts({ id })
			.send.post()
			.then((response) => {
				const payload = unwrapTreatyResponse(response)
				return { success: true, payload }
			}),
	delete: (id: string) =>
		apiRequest<{ success: boolean }>(`/broadcasts/${id}`, {
			method: 'DELETE',
		}),
}

export interface OrdersListParams {
	page?: number
	limit?: number
	paymentType?: string
	orderStatus?: string
	inboxId?: string
	search?: string
	sortField?: string
	sortDirection?: 'asc' | 'desc'
	includeConversation?: boolean
}

export interface OrderReportParams {
	startDate?: string
	endDate?: string
}

export interface SubscriptionsListParams {
	page?: number
	limit?: number
	search?: string
	sortField?: string
	sortDirection?: 'asc' | 'desc'
}

export interface TicketStage {
	id: string
	name: string
	color: string
	stage_order: number
}

export interface TicketBoard {
	id: string
	board_name: string
	is_default: boolean
	created_at: string | null
	statuses: TicketStage[]
}

export interface TicketCard {
	conversation_id: string
	board_id: string
	stage_id: string | null
	stage_name?: string | null
	contact_name: string
	contact_phone: string | null
	last_message: string | null
	conversation_status: string | null
	deal_value: number
	created_at: string | null
	updated_at: string | null
}

export interface TicketKanbanColumn {
	id: string
	name: string
	color: string
	stage_order: number
	tickets: TicketCard[]
}

export interface TicketListItem extends TicketCard {
	stage_name: string | null
}

export interface ConversationTicketSummary {
	conversation_id: string
	board_id: string
	board_name: string
	stage_id: string | null
	stage_name: string | null
	stage_color: string | null
	deal_value: number
	contact_name: string
	contact_phone: string | null
	last_message: string | null
	conversation_status: string | null
	created_at: string | null
	updated_at: string | null
}

export interface TicketsSettingsResponse {
	boards: TicketBoard[]
	default_board_id: string | null
	empty_state: {
		has_boards: boolean
		message: string | null
	}
}

export interface TicketsBoardResponse {
	view: 'kanban' | 'list'
	board: {
		id: string
		board_name: string
	} | null
	pagination: {
		page: number
		limit: number
		total: number
	}
	columns: TicketKanbanColumn[]
	items: TicketListItem[]
}

export interface TicketsBoardParams {
	board_id?: string | null
	page?: number
	limit?: number
	search?: string
	sort?: {
		field: 'created_at' | 'updated_at' | 'deal_value' | 'contact_name'
		direction: 'asc' | 'desc'
	}
	view?: 'kanban' | 'list'
}

// Handover
export interface HandoverQueueItem {
	id: string
	conversationId: string
	contactName: string
	contactPhone: string
	contactAvatar?: string
	preview: string
	reason: string
	intent: string
	aiConfidence: number
	waitingSeconds: number
	priority: 'urgent' | 'high' | 'medium'
	suggestedAgentId?: string
	suggestedAgentName?: string
	approvalState: 'pending' | 'approved' | 'rejected'
	slaDueAt?: string
	sourceRuleId?: string
	createdAt: string
}

export interface HandoverRuleItem {
	id: string
	name: string
	conditions: Record<string, unknown>
	action: string
	isActive: boolean
	triggered7d: number
	priority: number
	ruleType: string
}

export interface AgentRosterItem {
	id: string
	name: string
	email: string
	avatarUrl?: string
	role: string
	status: 'online' | 'offline' | 'break'
	activeChats: number
	capacity: number
	skills: string[]
}

export interface HandoverAnalytics {
	handoverRate: number
	avgWaitTimeSeconds: number
	slaCompliance: number
	csatPostHandover: number
	period: string
	totalRequests: number
	approvedRequests: number
	rejectedRequests: number
	pendingRequests: number
}

export interface HandoverLogItem {
	id: string
	conversationId: string
	action: string
	actorId?: string
	actorName?: string
	actorType: string
	targetId?: string
	targetName?: string
	metadata: Record<string, unknown>
	createdAt: string
}

export const handover = {
	getQueue: () =>
		treatyApi.api.handover.queue.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: (data.payload ?? []) as unknown as HandoverQueueItem[],
			}
		}),

	getRules: () =>
		treatyApi.api.handover.rules.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: (data.payload ?? []) as unknown as HandoverRuleItem[],
			}
		}),

	getRoster: () =>
		treatyApi.api.handover.roster.get().then((response) => {
			const data = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: (data.payload ?? []) as unknown as AgentRosterItem[],
			}
		}),

	getLogs: (params?: {
		conversationId?: string
		limit?: number
		period?: string
	}) => {
		const query: Record<string, string> = {}
		if (params?.conversationId) query.conversationId = params.conversationId
		if (params?.limit) query.limit = String(params.limit)
		if (params?.period) query.period = params.period
		return treatyApi.api.handover.logs.get({ query }).then((response) => {
			const data = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: (data.payload ?? []) as unknown as HandoverLogItem[],
			}
		})
	},

	getAnalytics: (period: string = '24h') =>
		treatyApi.api.handover.analytics
			.get({ query: { period } })
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return {
					success: true,
					payload: data.payload as unknown as HandoverAnalytics,
				}
			}),

	createRequest: (data: {
		conversationId: string
		requestType?: 'take' | 'reassign'
		targetAgentId?: string
		requestNote?: string
		sourceRuleId?: string
	}) =>
		treatyApi.api.handover.requests.post(data).then((response) => {
			const payload = unwrapTreatyResponse(response)
			return {
				success: true,
				payload: payload.payload,
				autoApproved: (payload as any).autoApproved ?? false,
			}
		}),

	approveRequest: (requestId: string, approvalNote?: string) =>
		treatyApi.api.handover
			.requests({ id: requestId })
			.approve.post({ approvalNote })
			.then((response) => {
				const payload = unwrapTreatyResponse(response)
				return { success: true, payload: payload.payload }
			}),

	rejectRequest: (requestId: string, rejectionNote?: string) =>
		treatyApi.api.handover
			.requests({ id: requestId })
			.reject.post({ rejectionNote })
			.then((response) => {
				const payload = unwrapTreatyResponse(response)
				return { success: true, payload: payload.payload }
			}),

	getConversationLogs: (conversationId: string) =>
		treatyApi.api.handover
			.conversation({ conversationId })
			.logs.get()
			.then((response) => {
				const data = unwrapTreatyResponse(response)
				return {
					success: true,
					payload: (data.payload ?? []) as unknown as HandoverLogItem[],
				}
			}),
}

export const tickets = {
	getSettings: () =>
		apiRequest<{ success: boolean; data: TicketsSettingsResponse }>(
			'/tickets/settings',
		).then((response) => response.data),

	setDefaultBoard: (board_id: string | null) =>
		apiRequest<{
			success: boolean
			data: {
				success: boolean
				default_board_id: string | null
			}
		}>('/tickets/settings/default-board', {
			method: 'PUT',
			body: JSON.stringify({ board_id }),
		}).then((response) => response.data),

	getBoard: (params: TicketsBoardParams) =>
		apiRequest<{ success: boolean; data: TicketsBoardResponse }>(
			'/tickets/kanban',
			{
				method: 'POST',
				body: JSON.stringify(params),
			},
		).then((response) => response.data),

	getConversationSummary: (conversationId: string, boardId?: string | null) =>
		apiRequest<{
			success: boolean
			data: ConversationTicketSummary | null
		}>(
			`/tickets/conversations/${conversationId}${boardId ? `?board_id=${encodeURIComponent(boardId)}` : ''}`,
		).then((response) => response.data),
}


export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskActionKind =
	| 'reply_now'
	| 'follow_up'
	| 'qualify_lead'
	| 'handover_review'
	| 'manual'

export interface Task {
	id: string
	appId: string
	assigneeId: string | null
	teamId: string | null
	conversationId: string | null
	contactId: string | null
	sourceMessageId: string | null
	actionKind: TaskActionKind
	title: string
	description: string | null
	priority: TaskPriority
	status: TaskStatus
	dueAt: string | null
	snoozedUntil: string | null
	completedAt: string | null
	source: string
	aiSnapshot: unknown
	analysisVersion: string | null
	confidence: number | null
	contactName: string | null
	contactPhone: string | null
	conversationStatus: string | null
	createdAt: string
	updatedAt: string
}

export interface TaskListParams {
	view?: 'today' | 'all' | 'overdue' | 'done'
	status?: TaskStatus
	priority?: TaskPriority
	contactId?: string
	cursor?: string
	limit?: number
}

export interface TaskListResponse {
	data: Task[]
	nextCursor: string | null
}

export interface TaskSummary {
	overdue: number
	today: number
	completedToday: number
}

export const tasks = {
	list: (params: TaskListParams = {}) => {
		const query = new URLSearchParams()
		for (const [key, value] of Object.entries(params)) {
			if (value === undefined || value === null) continue
			query.set(key, String(value))
		}
		const suffix = query.toString() ? `?${query.toString()}` : ''
		return apiRequest<TaskListResponse>(`/tasks${suffix}`)
	},

	summary: () => apiRequest<{ data: TaskSummary }>('/tasks/summary/today'),

	start: (id: string) =>
		apiRequest<{ data: Task }>(`/tasks/${encodeURIComponent(id)}/start`, {
			method: 'POST',
		}),

	complete: (id: string) =>
		apiRequest<{ data: Task }>(`/tasks/${encodeURIComponent(id)}/complete`, {
			method: 'POST',
		}),

	snooze: (id: string, snoozedUntil: string, reason?: string) =>
		apiRequest<{ data: Task }>(`/tasks/${encodeURIComponent(id)}/snooze`, {
			method: 'POST',
			body: JSON.stringify({ snoozedUntil, reason }),
		}),

	replyWhatsapp: (id: string, text: string) =>
		apiRequest<{ data: Task }>(
			`/tasks/${encodeURIComponent(id)}/reply-whatsapp`,
			{
				method: 'POST',
				body: JSON.stringify({ text }),
			},
		),

	detail: (id: string) =>
		apiRequest<{ data: TaskDetail }>(`/tasks/${encodeURIComponent(id)}/detail`),
}

export interface TaskMessage {
	id: string
	content: string | null
	contentType: string | null
	direction: 'in' | 'out'
	senderType: string | null
	status: string | null
	createdAt: string | null
}

export interface TaskEventEntry {
	id: string
	eventType: string
	actorType: string | null
	actorName: string | null
	reason: string | null
	metadata: unknown
	createdAt: string | null
}

export interface TaskContact {
	id: string
	name: string | null
	email: string | null
	phone_number: string | null
	whatsapp_id: string | null
	company: string | null
	city: string | null
	source: string | null
	custom_attributes: Record<string, unknown> | null
}

export interface TaskDetail {
	task: Task
	contact: TaskContact | null
	messages: TaskMessage[]
	events: TaskEventEntry[]
}


// Lead Import (CSV) — leader/ceo/superadmin only
export type ImportRowStatus = 'ok' | 'warning' | 'error' | 'imported' | 'skipped'

export interface ImportJobRow {
	id: string
	rowNumber: number
	status: ImportRowStatus
	messages: string[]
	mapped: Record<string, unknown>
	resolvedAssigneeId: string | null
	contactId: string | null
	taskId: string | null
}

export interface ImportJobView {
	job: {
		id: string
		filename: string | null
		status: string
		totalRows: number
		imported: number
		updated: number
		skipped: number
		errors: number
		tasksCreated: number
		createdAt: string | null
		completedAt: string | null
	}
	rows: ImportJobRow[]
	assignableOptions?: Array<{ email: string; name: string | null }>
	unmappedHeaders?: string[]
}

export interface ImportCommitResult {
	id: string
	status: string
	imported: number
	updated: number
	skipped: number
	errors: number
	tasksCreated: number
	errorLog: Array<{ row: number; reason: string }>
}

export const leadImport = {
	preview: (filename: string, content: string) =>
		apiRequest<{ data: ImportJobView }>('/import/csv/preview', {
			method: 'POST',
			body: JSON.stringify({ filename, content }),
		}),

	getJob: (jobId: string) =>
		apiRequest<{ data: ImportJobView }>(`/import/jobs/${encodeURIComponent(jobId)}`),

	updateRowAssignee: (jobId: string, rowId: string, assignedTo: string | null) =>
		apiRequest<{ data: ImportJobView }>(
			`/import/jobs/${encodeURIComponent(jobId)}/rows/${encodeURIComponent(rowId)}`,
			{ method: 'PATCH', body: JSON.stringify({ assignedTo }) },
		),

	commit: (jobId: string) =>
		apiRequest<{ data: ImportCommitResult }>(
			`/import/jobs/${encodeURIComponent(jobId)}/commit`,
			{ method: 'POST' },
		),

	history: () => apiRequest<{ data: ImportJobView['job'][] }>('/import/history'),
}
