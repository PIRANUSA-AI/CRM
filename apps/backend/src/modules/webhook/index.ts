import { Elysia, t } from 'elysia'
import { WebhookService } from './service'
import { appContext } from '../../plugins'
import { WhatsAppService } from '../whatsapp/service'
import { META_VERIFY_TOKEN } from '../whatsapp/webhook-config'
import { requireRole } from '../../lib/require-role'
import { incomingMessageQueue } from '../../lib/queue'

const VERIFY_TOKEN = META_VERIFY_TOKEN

function getHeaderString(value: unknown): string | null {
	if (typeof value === 'string' && value.trim()) return value.trim()
	if (Array.isArray(value)) {
		const firstValue = value.find(
			(item) => typeof item === 'string' && item.trim(),
		) as string | undefined
		if (firstValue) return firstValue.trim()
	}
	return null
}

function resolveBaileysWebhookSecret(headers: Record<string, unknown>) {
	const explicitSecret =
		getHeaderString(headers['x-crm-channel-secret']) ||
		getHeaderString(headers['X-Crm-Channel-Secret']) ||
		getHeaderString(headers['x-baileys-secret']) ||
		getHeaderString(headers['X-Baileys-Secret'])
	if (explicitSecret) return explicitSecret

	const authorization =
		getHeaderString(headers.authorization) ||
		getHeaderString(headers.Authorization)
	if (!authorization) return null

	const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i)
	return bearerMatch?.[1]?.trim() || null
}

function resolveBaileysChannelKey(body: unknown) {
	if (!body || typeof body !== 'object' || Array.isArray(body)) return null
	const record = body as Record<string, unknown>
	const key = record.channelKey || record.channel_key
	return typeof key === 'string' && key.trim() ? key.trim() : null
}

console.log('[WEBHOOK] Loaded verify token:', VERIFY_TOKEN?.substring(0, 4) + '***')

export const webhook = new Elysia({ prefix: '/webhooks', tags: ['Webhook'] })
	.use(appContext)
	// WhatsApp Webhook Verification (GET)
	.get('/whatsapp', ({ query, set }) => {
		const mode = query['hub.mode']
		const token = query['hub.verify_token']
		const challenge = query['hub.challenge']

		console.log('[WEBHOOK] WhatsApp verification request:', {
			mode,
			tokenReceived: token?.substring(0, 4) + '***',
			tokenExpected: VERIFY_TOKEN?.substring(0, 4) + '***',
			tokenMatch: token === VERIFY_TOKEN,
			challenge: challenge?.substring(0, 10) + '...',
		})

		if (mode === 'subscribe' && token === VERIFY_TOKEN) {
			console.log('[WEBHOOK] WhatsApp verification successful')
			// Meta requires the challenge to be returned as plain text (not JSON)
			set.headers['content-type'] = 'text/plain'
			return challenge
		}
		console.error('[WEBHOOK] WhatsApp verification failed', { mode, token: token?.substring(0, 4) + '...' })
		set.status = 403
		return 'Forbidden'
	}, {
		query: t.Object({
			'hub.mode': t.Optional(t.String()),
			'hub.verify_token': t.Optional(t.String()),
			'hub.challenge': t.Optional(t.String()),
		}),
	})
	.get(
		'/whatsapp/media/:messageId',
		async ({ params, set }) => {
			try {
				const media =
					await WebhookService.getWhatsAppMediaContentByMessageId(params.messageId)
				if (!media) {
					set.status = 404
					return { error: 'Media not found' }
				}

				return new Response(media.buffer, {
					status: 200,
					headers: {
						'content-type': media.mimeType,
						'cache-control': 'public, max-age=300',
					},
				})
			} catch (error) {
				console.error('[WEBHOOK] Failed to stream WhatsApp media:', error)
				set.status = 500
				return { error: 'Failed to load media' }
			}
		},
		{
			params: t.Object({
				messageId: t.String(),
			}),
		},
	)
	// WhatsApp Webhook Payload (POST)
	.post('/whatsapp', async ({ body }) => {
		return WebhookService.processWhatsAppPayload(body)
	})
	.post(
		'/whatsapp/baileys',
		async ({ body, headers, set }) => {
			const channelKey = resolveBaileysChannelKey(body)
			if (!channelKey) {
				set.status = 400
				return { error: 'channelKey is required' }
			}

			const secret = resolveBaileysWebhookSecret(headers as Record<string, unknown>)
			if (!secret) {
				set.status = 403
				return { error: 'Invalid Baileys webhook secret' }
			}

			const channel = await WhatsAppService.authenticateBaileysChannel(
				channelKey,
				secret,
			)
			if (!channel) {
				set.status = 403
				return { error: 'Invalid Baileys webhook secret' }
			}

			const record = body as Record<string, any>
			if (String(record.event || '').toLowerCase() === 'message.received') {
				const externalId = String(record.message?.id || crypto.randomUUID())
				await incomingMessageQueue.add('whatsapp.inbound', { payload: body }, {
					jobId: `wa-${channel.id}-${externalId}`.replace(/[^a-zA-Z0-9_-]/g, '_'),
					attempts: 5,
					backoff: { type: 'exponential', delay: 1000 },
					removeOnComplete: 1000,
					removeOnFail: 5000,
				})
				set.status = 202
				return { success: true, queued: true }
			}
			return WebhookService.processWhatsAppPayload(body)
		},
		{
			body: t.Any(),
		},
	)

	// Outbound Management
	.get(
		'/',
		async ({ resolvedAppId, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const hooks = await WebhookService.getWebhooks(resolvedAppId)
			return { data: hooks }
		},
		{
			query: t.Object({ accountId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, body, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const hook = await WebhookService.createWebhook(resolvedAppId, body)
			return { data: hook }
		},
		{
			query: t.Object({ accountId: t.Optional(t.String()) }),
			body: t.Object({
				url: t.String(),
				name: t.Optional(t.String()),
				events: t.Optional(t.Array(t.String())),
			}),
		},
	)
	.delete(
		'/:id',
		async ({ params, userId, set }) => {
			const guard = await requireRole(userId, ['superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			await WebhookService.deleteWebhook(params.id)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
