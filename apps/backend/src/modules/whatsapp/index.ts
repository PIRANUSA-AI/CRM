import { Elysia, t } from 'elysia'
import {
	WhatsAppChannelAssignmentConflictError,
	WhatsAppService,
} from './service'
import { BaileysServiceClient } from './baileys-service-client'
import { WhatsAppRequestModel } from './model'
import { appContext } from '../../plugins'
import {
	getBaileysProviderWebhookUrl,
	getBaileysWhatsappWebhookCallbackUrl,
} from './webhook-config'
import { requireRole } from '../../lib/require-role'

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

function isBaileysStorageBootstrapError(error: unknown) {
	return (
		error instanceof Error &&
		error.message.includes('Baileys session storage is not ready')
	)
}

export const whatsapp = new Elysia({ tags: ['WhatsApp'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, query, userId, set }) => {
			const guard = await requireRole(userId, ['ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const channels = await WhatsAppService.getChannels(
				resolvedAppId,
				query.search,
			)
			return { data: channels }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
				search: t.Optional(t.String()),
			}),
		},
	)
	.get('/baileys/config', async ({ request, headers }) => {
		return {
			success: true,
			data: {
				providerWebhookUrl:
					getBaileysProviderWebhookUrl(
						request,
						headers as Record<string, unknown>,
					) || null,
			},
		}
	})
	.post(
		'/baileys',
		async ({ resolvedAppId, body, request, headers, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const defaultProviderWebhookUrl = getBaileysProviderWebhookUrl(
					request,
					headers as Record<string, unknown>,
				)
				const result = await WhatsAppService.createBaileysChannel(
					{
						name: body.name,
						phoneNumber: body.phoneNumber,
						providerChannelKey: body.providerChannelKey,
						providerWebhookUrl:
							body.providerWebhookUrl || defaultProviderWebhookUrl || null,
					},
					resolvedAppId,
				)
				let session = await WhatsAppService.getBaileysSessionSnapshot(
					result.channel.id,
				)
				try {
					session = await BaileysServiceClient.startSession(result.channel.id)
				} catch (error) {
					console.error(
						'[WhatsApp] Failed to warm up external Baileys service:',
						error,
					)
				}

				return {
					success: true,
					data: {
						channelId: result.channel.id,
						channel: result.channel,
						session,
						webhook: {
							callbackUrl: getBaileysWhatsappWebhookCallbackUrl(
								request,
								headers as Record<string, unknown>,
							),
							secret: result.secret,
						},
					},
				}
			} catch (error: any) {
				console.error('[WhatsApp] Create Baileys channel error:', error)
				set.status = isBaileysStorageBootstrapError(error) ? 503 : 400
				return {
					error: error?.message || 'Failed to create Baileys WhatsApp channel',
				}
			}
		},
		{
			body: WhatsAppRequestModel.createBaileys,
		},
	)
	.post(
		'/baileys/send',
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

			const channel = await WhatsAppService.authenticateBaileysChannel(
				channelKey,
				secret,
			)
			if (!channel) {
				set.status = 403
				return { error: 'Invalid Baileys channel secret' }
			}

			try {
				const result = await BaileysServiceClient.sendMessage(
					body as Record<string, unknown>,
					{
						Authorization: `Bearer ${secret}`,
						'X-Crm-Channel-Secret': secret,
					},
				)
				return {
					success: true,
					externalId: result.externalId,
				}
			} catch (error: any) {
				console.error('[WhatsApp] Baileys internal send error:', error)
				set.status = 503
				return {
					error: error?.message || 'Failed to send Baileys message',
					channelId: channel.id,
				}
			}
		},
		{
			body: t.Any(),
		},
	)
	.get(
		'/:id/baileys/session',
		async ({ params, set }) => {
			const channel = await WhatsAppService.getChannelById(params.id)
			if (!channel || channel.provider !== 'baileys') {
				set.status = 404
				return { error: 'Baileys channel not found' }
			}

			try {
				let session = null
				try {
					session = await BaileysServiceClient.getSession(params.id)
				} catch (error) {
					console.error(
						'[WhatsApp] Failed to fetch external Baileys session snapshot:',
						error,
					)
				}

				if (!session) {
					session = await WhatsAppService.getBaileysSessionSnapshot(params.id)
				}
				if (!session) {
					throw new Error('Baileys session not found')
				}
				return { success: true, data: session }
			} catch (error: any) {
				set.status = isBaileysStorageBootstrapError(error) ? 503 : 404
				return { error: error?.message || 'Baileys session not found' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/:id/baileys/session/start',
		async ({ params, set }) => {
			const channel = await WhatsAppService.getChannelById(params.id)
			if (!channel || channel.provider !== 'baileys') {
				set.status = 404
				return { error: 'Baileys channel not found' }
			}

			try {
				const session = await BaileysServiceClient.startSession(params.id)
				return { success: true, data: session }
			} catch (error: any) {
				set.status = isBaileysStorageBootstrapError(error) ? 503 : 400
				return { error: error?.message || 'Failed to start Baileys session' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.get(
		'/:id/details',
		async ({ params, userId, set }) => {
			const guard = await requireRole(userId, ['ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const channel = await WhatsAppService.getChannelById(params.id)
			if (!channel) {
				set.status = 404
				return { error: 'Channel not found' }
			}

			// Map quality and limits for the frontend expected shapes
			const getQualityScore = (rating: string | null) => {
				if (rating === 'GREEN') return { percentage: 100, color: 'emerald', label: 'High' }
				if (rating === 'YELLOW') return { percentage: 50, color: 'yellow', label: 'Medium' }
				if (rating === 'RED') return { percentage: 20, color: 'red', label: 'Low' }
				return { percentage: 0, color: 'gray', label: 'Unknown' }
			}
			
			const getTierLimit = (tier: string | null) => {
				switch (tier) {
					case 'TIER_50': return { tier_level: 0, daily_limit: '50' }
					case 'TIER_250': return { tier_level: 0, daily_limit: '250' }
					case 'TIER_1K': return { tier_level: 1, daily_limit: '1K' }
					case 'TIER_10K': return { tier_level: 2, daily_limit: '10K' }
					case 'TIER_100K': return { tier_level: 3, daily_limit: '100K' }
					case 'TIER_UNLIMITED': return { tier_level: 4, daily_limit: 'Unlimited' }
					default: return { tier_level: -1, daily_limit: 'Unknown' }
				}
			}

			const enrichedChannel = {
				...channel,
				metadata:
					channel.extended_metadata &&
					typeof channel.extended_metadata === 'object' &&
					!Array.isArray(channel.extended_metadata)
						? channel.extended_metadata
						: {},
				quality_rating: channel.quality_rating || 'UNKNOWN',
				quality_score: getQualityScore(channel.quality_rating),
				limit_info: getTierLimit(channel.messaging_limit_tier),
				messaging_limit: channel.messaging_limit_tier || 'UNKNOWN'
			}

			return { data: enrichedChannel, success: true }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/:id/badge',
		async ({ params, body, set }) => {
			try {
				const file = (body as any).badge as File
				if (!file) {
					set.status = 400
					return { error: 'No file provided. Use "badge" field.' }
				}
				const result = await WhatsAppService.uploadBadge(params.id, file)
				return { success: true, ...result }
			} catch (error: any) {
				console.error('[Badge Upload Error]', error.message)
				set.status = error.message.includes('not found') ? 404 : 400
				return { error: error.message }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				badge: t.File({
					type: ['image/jpeg', 'image/jpg', 'image/png'],
					maxSize: '2m',
				}),
			}),
		},
	)
	.delete(
		'/:id/badge',
		async ({ params, set }) => {
			try {
				const result = await WhatsAppService.removeBadge(params.id)
				return { success: true, ...result }
			} catch (error: any) {
				console.error('[Badge Remove Error]', error.message)
				set.status = error.message.includes('not found') ? 404 : 400
				return { error: error.message }
			}
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.get(
		'/:id',
		async ({ params, userId, set }) => {
			const guard = await requireRole(userId, ['ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const channel = await WhatsAppService.getChannelById(params.id)
			if (!channel) {
				set.status = 404
				return { error: 'Channel not found' }
			}
			return { data: channel }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, body, userId, set }) => {
			const guard = await requireRole(userId, ['ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				const channel = await WhatsAppService.createChannel(body, resolvedAppId)
				return { data: channel }
			} catch (error: any) {
				console.error('[WhatsApp] Create channel error:', error)
				const errorCode = String(error?.code || '').toUpperCase()
				if (
					error instanceof WhatsAppChannelAssignmentConflictError ||
					errorCode === 'P2002'
				) {
					set.status = 409
					return {
						error:
							error?.message ||
							'WhatsApp channel is already assigned to another app',
					}
				}
				set.status = 400
				return { error: error?.message || 'Failed to create WhatsApp channel' }
			}
		},
		{
			body: WhatsAppRequestModel.create,
		},
	)
	.patch(
		'/:id',
		async ({ params, body, userId, set }) => {
			const guard = await requireRole(userId, ['ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			const channel = await WhatsAppService.updateChannel(params.id, body)
			if (!channel) {
				set.status = 404
				return { error: 'Channel not found' }
			}
			return { data: channel }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: WhatsAppRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params, userId, set }) => {
			const guard = await requireRole(userId, ['ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			await WhatsAppService.deleteChannel(params.id)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post('/exchange-token', async ({ set }) => {
		set.status = 410
		return { error: 'Embedded signup is no longer available. Please use manual token connection.' }
	}, {
		body: WhatsAppRequestModel.exchangeToken,
	})
	.post('/init-signup', async ({ set }) => {
		set.status = 410
		return { error: 'Embedded signup is no longer available. Please use manual token connection.' }
	})
