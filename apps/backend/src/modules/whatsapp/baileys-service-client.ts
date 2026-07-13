function normalizeUrl(value: string | null | undefined) {
	const trimmed = String(value || '').trim()
	if (!trimmed) return null

	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return null
		}
		return parsed.toString().replace(/\/+$/, '')
	} catch {
		return null
	}
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function extractErrorMessage(payload: unknown, fallback: string) {
	if (typeof payload === 'string' && payload.trim().length > 0) {
		return payload.trim()
	}

	const record = asRecord(payload)
	return (
		asString(record.error) ||
		asString(record.message) ||
		asString(asRecord(record.data).error) ||
		asString(asRecord(record.data).message) ||
		fallback
	)
}

export type BaileysServiceSessionSnapshot = {
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

const BAILEYS_SERVICE_TIMEOUT_MS = Math.max(
	1_500,
	Math.min(30_000, Number(process.env.BAILEYS_SERVICE_TIMEOUT_MS || 12_000)),
)

export function getBaileysServiceBaseUrl() {
	return (
		normalizeUrl(process.env.BAILEYS_SERVICE_URL || null) ||
		'http://127.0.0.1:3012'
	)
}

export function getBaileysServiceSendUrl() {
	return `${getBaileysServiceBaseUrl()}/api/v1/send`
}

async function requestBaileysService(
	pathname: string,
	init: RequestInit & { bodyJson?: unknown } = {},
) {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), BAILEYS_SERVICE_TIMEOUT_MS)

	try {
		const headers = new Headers(init.headers || {})
		const internalToken = String(
			process.env.BAILEYS_SERVICE_INTERNAL_TOKEN || '',
		).trim()
		if (internalToken) {
			headers.set('X-Crm-Internal-Token', internalToken)
		}

		let body = init.body
		if (init.bodyJson !== undefined) {
			body = JSON.stringify(init.bodyJson)
			if (!headers.has('Content-Type')) {
				headers.set('Content-Type', 'application/json')
			}
		}

		const response = await fetch(`${getBaileysServiceBaseUrl()}${pathname}`, {
			...init,
			headers,
			body,
			signal: controller.signal,
		})

		const text = await response.text()
		const payload = text.trim()
			? (() => {
					try {
						return JSON.parse(text)
					} catch {
						return text
					}
				})()
			: null

		if (!response.ok) {
			throw new Error(
				extractErrorMessage(
					payload,
					`Baileys service request failed (HTTP ${response.status})`,
				),
			)
		}

		return payload
	} catch (error: any) {
		if (error?.name === 'AbortError') {
			throw new Error('Baileys service request timed out')
		}
		throw error
	} finally {
		clearTimeout(timeout)
	}
}

function unwrapData<T>(payload: unknown): T {
	const record = asRecord(payload)
	if (record.data && typeof record.data === 'object') {
		return record.data as T
	}
	return record as T
}

export abstract class BaileysServiceClient {
	static async getSession(channelId: string) {
		const payload = await requestBaileysService(`/api/v1/sessions/${channelId}`)
		return unwrapData<BaileysServiceSessionSnapshot>(payload)
	}

	static async startSession(channelId: string) {
		const payload = await requestBaileysService(
			`/api/v1/sessions/${channelId}/start`,
			{
				method: 'POST',
			},
		)
		return unwrapData<BaileysServiceSessionSnapshot>(payload)
	}

	static async sendMessage(
		body: Record<string, unknown>,
		headers?: Record<string, string>,
	) {
		const payload = await requestBaileysService('/api/v1/send', {
			method: 'POST',
			headers,
			bodyJson: body,
		})
		return unwrapData<{ externalId?: string }>(payload)
	}

	static async markMessagesRead(
		body: Record<string, unknown>,
		headers?: Record<string, string>,
	) {
		const payload = await requestBaileysService('/api/v1/read', {
			method: 'POST', headers, bodyJson: body,
		})
		return unwrapData<{ read: number }>(payload)
	}

	static async sendPresence(body: Record<string, unknown>, headers?: Record<string, string>) {
		const payload = await requestBaileysService('/api/v1/presence', { method: 'POST', headers, bodyJson: body })
		return unwrapData<{ sent: boolean }>(payload)
	}

	static async getProfilePicture(body: Record<string, unknown>, headers?: Record<string, string>) {
		const payload = await requestBaileysService('/api/v1/profile-picture', { method: 'POST', headers, bodyJson: body })
		return unwrapData<{ url: string | null; available: boolean }>(payload)
	}
}
