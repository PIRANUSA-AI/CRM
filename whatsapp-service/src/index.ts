import './bootstrap-env'

import { Elysia, t } from 'elysia'
import { node } from '@elysiajs/node'
import { HOST, PORT } from './config'
import { closeDb, ensureBaileysSessionStorage } from './db'
import { BaileysServiceRuntime } from './runtime'

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

function resolveBaileysSecret(headers: Record<string, unknown>) {
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

function isAuthorizedInternalRequest(headers: Record<string, unknown>) {
	const expectedToken = String(
		process.env.BAILEYS_SERVICE_INTERNAL_TOKEN || '',
	).trim()
	if (!expectedToken) return true

	const receivedToken =
		getHeaderString(headers['x-crm-internal-token']) ||
		getHeaderString(headers['X-Crm-Internal-Token']) ||
		null
	return receivedToken === expectedToken
}

const service = new Elysia({ adapter: node() as any })
	.get('/health', async () => {
		await ensureBaileysSessionStorage()
		return {
			status: 'healthy',
			service: 'whatsapp-service',
			timestamp: new Date().toISOString(),
		}
	})
	.group('/api/v1', (app) =>
		app
			.get(
				'/sessions/:channelId',
				async ({ params, headers, set }) => {
					if (!isAuthorizedInternalRequest(headers as Record<string, unknown>)) {
						set.status = 403
						return { error: 'Invalid internal token' }
					}

					const data = await BaileysServiceRuntime.getSessionSnapshot(
						params.channelId,
					)
					return { success: true, data }
				},
				{
					params: t.Object({ channelId: t.String() }),
				},
			)
			.post(
				'/sessions/:channelId/start',
				async ({ params, headers, set }) => {
					if (!isAuthorizedInternalRequest(headers as Record<string, unknown>)) {
						set.status = 403
						return { error: 'Invalid internal token' }
					}

					const data = await BaileysServiceRuntime.ensureChannel(
						params.channelId,
						{
							forceRestart: true,
							waitForReadyMs: 8_000,
							allowUnpaired: true,
						},
					)
					return { success: true, data }
				},
				{
					params: t.Object({ channelId: t.String() }),
				},
			)
			.post(
				'/sessions/:channelId/reset',
				async ({ params, headers, set }) => {
					if (!isAuthorizedInternalRequest(headers as Record<string, unknown>)) {
						set.status = 403
						return { error: 'Invalid internal token' }
					}

					const data = await BaileysServiceRuntime.resetChannel(params.channelId)
					return { success: true, data }
				},
				{
					params: t.Object({ channelId: t.String() }),
				},
			)
			.post(
				'/send',
				async ({ body, headers, set }) => {
					const channelKey = resolveBaileysChannelKey(body)
					if (!channelKey) {
						set.status = 400
						return { error: 'channelKey is required' }
					}

					const secret = resolveBaileysSecret(headers as Record<string, unknown>)
					if (!secret) {
						set.status = 403
						return { error: 'Invalid Baileys channel secret' }
					}

					const channel = await BaileysServiceRuntime.authenticateChannelSecret(
						channelKey,
						secret,
					)
					if (!channel) {
						set.status = 403
						return { error: 'Invalid Baileys channel secret' }
					}

					try {
						const result = await BaileysServiceRuntime.sendMessage(
							body as Record<string, unknown>,
						)
						return {
							success: true,
							externalId: result.externalId,
						}
					} catch (error: any) {
						set.status = 503
						return {
							error: error?.message || 'Failed to send Baileys message',
						}
					}
				},
				{
					body: t.Any(),
				},
			)
			.post('/read', async ({ body, headers, set }) => {
				const channelKey = resolveBaileysChannelKey(body)
				const secret = resolveBaileysSecret(headers as Record<string, unknown>)
				if (!channelKey || !secret || !(await BaileysServiceRuntime.authenticateChannelSecret(channelKey, secret))) {
					set.status = 403
					return { error: 'Invalid Baileys channel credentials' }
				}
				try {
					return { data: await BaileysServiceRuntime.markMessagesRead(body as Record<string, unknown>) }
				} catch (error: any) {
					set.status = 503
					return { error: error?.message || 'Failed to mark Baileys messages read' }
				}
			}, { body: t.Any() })
			.post('/presence', async ({ body, headers, set }) => {
				const channelKey = resolveBaileysChannelKey(body)
				const secret = resolveBaileysSecret(headers as Record<string, unknown>)
				if (!channelKey || !secret || !(await BaileysServiceRuntime.authenticateChannelSecret(channelKey, secret))) {
					set.status = 403
					return { error: 'Invalid Baileys channel credentials' }
				}
				return { data: await BaileysServiceRuntime.sendPresence(body as Record<string, unknown>) }
			}, { body: t.Any() })
			.post('/block-status', async ({ body, headers, set }) => {
				const channelKey = resolveBaileysChannelKey(body)
				const secret = resolveBaileysSecret(headers as Record<string, unknown>)
				if (!channelKey || !secret || !(await BaileysServiceRuntime.authenticateChannelSecret(channelKey, secret))) {
					set.status = 403
					return { error: 'Invalid Baileys channel credentials' }
				}
				try {
					return { data: await BaileysServiceRuntime.updateBlockStatus(body as Record<string, unknown>) }
				} catch (error: any) {
					set.status = 503
					return { error: error?.message || 'Failed to update WhatsApp block status' }
				}
			}, { body: t.Any() })
			.post('/profile-picture', async ({ body, headers, set }) => {
				const channelKey = resolveBaileysChannelKey(body)
				const secret = resolveBaileysSecret(headers as Record<string, unknown>)
				if (!channelKey || !secret || !(await BaileysServiceRuntime.authenticateChannelSecret(channelKey, secret))) {
					set.status = 403
					return { error: 'Invalid Baileys channel credentials' }
				}
				return { data: await BaileysServiceRuntime.getProfilePicture(body as Record<string, unknown>) }
			}, { body: t.Any() }),
	)

await ensureBaileysSessionStorage()
await BaileysServiceRuntime.bootstrap()

service.listen({ hostname: HOST, port: PORT })

console.log(`CRM WhatsApp Service running at http://${HOST}:${PORT}`)

const shutdown = async () => {
	console.log('Shutting down CRM WhatsApp Service...')
	await BaileysServiceRuntime.shutdown()
	await closeDb()
	process.exit(0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
