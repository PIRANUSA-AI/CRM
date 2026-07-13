import { getBaileysServiceSendUrl } from './baileys-service-client'

const META_VERIFY_TOKEN =
	process.env.META_VERIFY_TOKEN ||
	process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN ||
	'scalechat_webhook_secret'

export const BAILEYS_INTERNAL_SEND_PATH =
	'/api/v1/whatsapp-channels/baileys/send'

function toHeaderString(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return value.trim()
	if (Array.isArray(value)) {
		const firstString = value.find(
			(item) => typeof item === 'string' && item.trim(),
		) as string | undefined
		if (firstString) return firstString.trim()
	}
	return null
}

function resolveOriginFromRequest(
	request: Request,
	headers: Record<string, unknown>,
) {
	const forwardedHost = toHeaderString(
		headers['x-forwarded-host'] || headers['X-Forwarded-Host'],
	)
	const forwardedProto = toHeaderString(
		headers['x-forwarded-proto'] || headers['X-Forwarded-Proto'],
	)
	if (forwardedHost && forwardedProto) {
		return `${forwardedProto}://${forwardedHost}`
	}

	try {
		const url = new URL(request.url)
		if (url.protocol === 'http:' || url.protocol === 'https:') {
			return `${url.protocol}//${url.host}`
		}
	} catch {
		// Ignore invalid request URL.
	}

	return null
}

function normalizeUrl(value: string | null | undefined): string | null {
	const trimmed = String(value || '').trim()
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString().replace(/\/+$/, '')
	} catch {
		return null
	}
}

function resolvePublicBaseUrl(
	request: Request,
	headers: Record<string, unknown>,
) {
	const fromEnv = normalizeUrl(
		process.env.API_PUBLIC_URL ||
			process.env.BACKEND_URL ||
			process.env.PUBLIC_API_BASE_URL ||
			null,
	)
	if (fromEnv) return fromEnv

	const redirectUri = process.env.WHATSAPP_REDIRECT_URI
	if (redirectUri) {
		try {
			const parsed = new URL(redirectUri)
			return `${parsed.origin}`.replace(/\/+$/, '')
		} catch {
			// Ignore invalid redirect URI and continue.
		}
	}

	return resolveOriginFromRequest(request, headers)
}

export function buildWebhookCallbackUrl(
	request: Request,
	headers: Record<string, unknown>,
	pathname: string,
) {
	const explicitUrl =
		pathname === '/api/v1/webhooks/whatsapp'
			? process.env.WHATSAPP_WEBHOOK_CALLBACK_URL
			: null
	if (explicitUrl) return explicitUrl

	const publicBaseUrl = resolvePublicBaseUrl(request, headers)
	if (publicBaseUrl) {
		return `${publicBaseUrl}${pathname}`
	}

	return `http://localhost:3010${pathname}`
}

export function getOfficialWhatsappWebhookSetupData(
	request: Request,
	headers: Record<string, unknown>,
) {
	return {
		callbackUrl: buildWebhookCallbackUrl(
			request,
			headers,
			'/api/v1/webhooks/whatsapp',
		),
		verifyToken: META_VERIFY_TOKEN,
	}
}

export function getBaileysWhatsappWebhookCallbackUrl(
	request: Request,
	headers: Record<string, unknown>,
) {
	return buildWebhookCallbackUrl(
		request,
		headers,
		'/api/v1/webhooks/whatsapp/baileys',
	)
}

export function getBaileysProviderWebhookUrl(
	request: Request,
	headers: Record<string, unknown>,
) {
	const explicitUrl = normalizeUrl(process.env.BAILEYS_PROVIDER_WEBHOOK_URL || null)
	if (explicitUrl) return explicitUrl

	const configuredPath = String(
		process.env.BAILEYS_PROVIDER_WEBHOOK_PATH || '',
	).trim()
	if (configuredPath) {
		const publicBaseUrl = resolvePublicBaseUrl(request, headers)
		if (!publicBaseUrl) return null

		const normalizedPath = configuredPath.startsWith('/')
			? configuredPath
			: `/${configuredPath}`
		return `${publicBaseUrl}${normalizedPath}`
	}

	return getBaileysServiceSendUrl()
}

export { META_VERIFY_TOKEN }
