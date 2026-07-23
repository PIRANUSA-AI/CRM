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

// Root PORT belongs to the CRM API. This service must have its own port.
export const PORT = Number(process.env.WHATSAPP_SERVICE_PORT || 3012)
export const HOST = String(process.env.HOST || '127.0.0.1').trim()
export const BAILEYS_CHANNEL_SYNC_INTERVAL_MS = Math.max(
	5_000,
	Number(process.env.BAILEYS_CHANNEL_SYNC_INTERVAL_MS || 15_000),
)
export const BAILEYS_LINK_MODE = String(process.env.BAILEYS_LINK_MODE || 'qr')
	.trim()
	.toLowerCase()

export const CRM_API_BASE_URL =
	normalizeUrl(process.env.CRM_API_BASE_URL || null) ||
	'http://localhost:3010'

const configuredWebhookPath = String(
	process.env.CRM_BAILEYS_WEBHOOK_PATH || '/api/personal-whatsapp-inbox/ingest',
).trim()

export const CRM_BAILEYS_WEBHOOK_PATH = configuredWebhookPath.startsWith('/')
	? configuredWebhookPath
	: `/${configuredWebhookPath}`

export const CRM_BAILEYS_WEBHOOK_URL = `${CRM_API_BASE_URL}${CRM_BAILEYS_WEBHOOK_PATH}`
export const BAILEYS_SOCKS_PROXY = String(process.env.BAILEYS_SOCKS_PROXY || '').trim() || null
export const BAILEYS_SOCKS_PROXIES = (String(process.env.BAILEYS_SOCKS_PROXY_LIST || process.env.BAILEYS_SOCKS_PROXY || '').trim())
	.split(',')
	.map((s) => s.trim())
	.filter(Boolean)

export const BAILEYS_BOOTSTRAP_BATCH_SIZE = Math.max(
	1,
	Number(process.env.BAILEYS_BOOTSTRAP_BATCH_SIZE || 5),
)
export const BAILEYS_BOOTSTRAP_BATCH_DELAY_MS = Math.max(
	0,
	Number(process.env.BAILEYS_BOOTSTRAP_BATCH_DELAY_MS || 1_000),
)

export const INBOUND_MEDIA_MAX_BYTES = Math.max(
	1024 * 1024,
	Number(process.env.INBOUND_MEDIA_MAX_BYTES || 64 * 1024 * 1024),
)
export const INBOUND_MEDIA_MAX_CONCURRENCY = Math.max(
	1,
	Number(process.env.INBOUND_MEDIA_MAX_CONCURRENCY || 6),
)
