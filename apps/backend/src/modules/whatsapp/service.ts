import { PutObjectCommand } from '@aws-sdk/client-s3'
import {
	s3,
	BUCKET_NAME,
	buildS3PublicUrl,
	getS3UploadConfigurationError,
} from '../../lib/s3'
import crypto from 'crypto'
import prisma from '../../lib/prisma'
import { resolveAppId, isUuid } from '../../lib/utils'
import { ensureBaileysSessionStorage } from './baileys-storage'

const OFFICIAL_WHATSAPP_PROVIDER = 'whatsapp_cloud'
const BAILEYS_WHATSAPP_PROVIDER = 'baileys'
const BAILEYS_SECRET_LENGTH = 24

type WhatsAppProvider =
	| typeof OFFICIAL_WHATSAPP_PROVIDER
	| typeof BAILEYS_WHATSAPP_PROVIDER

type BaileysSessionSummaryRecord = {
	channel_id: string
	status: string | null
	last_error: string | null
	last_connected_at: Date | null
	last_seen_at: Date | null
	pairing_code: string | null
	qr_code: string | null
}

function getExtensionFromMimeType(mimeType: string): string {
	const mimeMap: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/png': 'png',
		'image/gif': 'gif',
		'image/webp': 'webp',
	}
	return mimeMap[mimeType] || 'bin'
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function toUuidStringOrNull(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	if (!normalized) return null
	return isUuid(normalized) ? normalized : null
}

type ActiveWhatsappChannelOwnership = {
	id: string
	app_id: string | null
	inbox_id: string | null
	phone_number_id: string | null
}

export class WhatsAppChannelAssignmentConflictError extends Error {
	readonly channelId: string
	readonly phoneNumberId: string
	readonly existingAppId: string

	constructor(params: {
		channelId: string
		phoneNumberId: string
		existingAppId: string
	}) {
		super(
			`WhatsApp channel ${params.phoneNumberId} is already assigned to another app`,
		)
		this.name = 'WhatsAppChannelAssignmentConflictError'
		this.channelId = params.channelId
		this.phoneNumberId = params.phoneNumberId
		this.existingAppId = params.existingAppId
	}
}

function normalizePhoneNumberId(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizePhoneNumber(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeWhatsappProvider(value: unknown): WhatsAppProvider {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (normalized === BAILEYS_WHATSAPP_PROVIDER) return BAILEYS_WHATSAPP_PROVIDER
	return OFFICIAL_WHATSAPP_PROVIDER
}

function normalizeProviderChannelKey(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeProviderWebhookUrl(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	if (!normalized) return null

	try {
		const parsed = new URL(normalized)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString()
	} catch {
		return null
	}
}

function getProviderChannelKeyFromMetadata(value: unknown): string | null {
	const metadata = asRecord(value)
	return normalizeProviderChannelKey(
		metadata.provider_channel_key || metadata.providerChannelKey,
	)
}

function getProviderWebhookUrlFromMetadata(value: unknown): string | null {
	const metadata = asRecord(value)
	return normalizeProviderWebhookUrl(
		metadata.provider_webhook_url || metadata.providerWebhookUrl,
	)
}

function getWhatsappProviderLabel(provider: unknown): string {
	return normalizeWhatsappProvider(provider) === BAILEYS_WHATSAPP_PROVIDER
		? 'Non Official (Baileys)'
		: 'Official WABA'
}

function buildWhatsappInboxConfig(
	existing: unknown,
	patch: Record<string, unknown>,
) {
	return {
		...asRecord(existing),
		...patch,
	}
}

function generateBaileysSecret() {
	return crypto.randomBytes(BAILEYS_SECRET_LENGTH).toString('hex')
}

function generateBaileysSessionId() {
	return crypto.randomUUID()
}

function normalizeChannelRecord<T extends Record<string, unknown>>(channel: T) {
	const provider = normalizeWhatsappProvider(channel.provider)
	const metadata = asRecord(channel.extended_metadata)

	return {
		...channel,
		provider,
		provider_channel_key: getProviderChannelKeyFromMetadata(metadata),
		provider_webhook_url: getProviderWebhookUrlFromMetadata(metadata),
		channel_tag: getWhatsappProviderLabel(provider),
		metadata,
	}
}

function buildBaileysSessionSummary(
	provider: WhatsAppProvider,
	session: BaileysSessionSummaryRecord | null | undefined,
	channelIsActive: unknown,
) {
	if (provider !== BAILEYS_WHATSAPP_PROVIDER) {
		return {
			baileys_session_status: null,
			baileys_is_connected: null,
			baileys_last_error: null,
			baileys_last_connected_at: null,
			baileys_last_seen_at: null,
			baileys_pairing_code_ready: null,
			baileys_qr_ready: null,
		}
	}

	const fallbackStatus =
		channelIsActive === false ? 'disabled' : session?.status || 'pending'

	return {
		baileys_session_status: fallbackStatus,
		baileys_is_connected: fallbackStatus === 'connected',
		baileys_last_error: session?.last_error || null,
		baileys_last_connected_at:
			session?.last_connected_at?.toISOString() || null,
		baileys_last_seen_at: session?.last_seen_at?.toISOString() || null,
		baileys_pairing_code_ready:
			Boolean(session?.pairing_code) || fallbackStatus === 'pairing_code_ready',
		baileys_qr_ready:
			Boolean(session?.qr_code) || fallbackStatus === 'qr_ready',
	}
}

async function attachBaileysSessionSummaries<T extends Record<string, unknown>>(
	channels: T[],
) {
	if (channels.length === 0)
		return channels.map((channel) => normalizeChannelRecord(channel))

	const normalizedChannels = channels.map((channel) =>
		normalizeChannelRecord(channel),
	)
	const baileysChannelIds = normalizedChannels
		.filter((channel) => channel.provider === BAILEYS_WHATSAPP_PROVIDER)
		.map((channel) => String(channel.id || '').trim())
		.filter((channelId) => channelId.length > 0)

	if (baileysChannelIds.length === 0) {
		return normalizedChannels.map((channel) => ({
			...channel,
			...buildBaileysSessionSummary(channel.provider, null, channel.is_active),
		}))
	}

	const sessions = await prisma.baileys_sessions.findMany({
		where: {
			channel_id: { in: baileysChannelIds },
		},
		select: {
			channel_id: true,
			status: true,
			last_error: true,
			last_connected_at: true,
			last_seen_at: true,
			pairing_code: true,
			qr_code: true,
		},
	})

	const sessionMap = new Map(
		sessions.map((session) => [
			session.channel_id,
			session as BaileysSessionSummaryRecord,
		]),
	)

	return normalizedChannels.map((channel) => ({
		...channel,
		...buildBaileysSessionSummary(
			channel.provider,
			sessionMap.get(String(channel.id || '').trim()) || null,
			channel.is_active,
		),
	}))
}

function ensureChannelNotOwnedByAnotherApp(
	existingChannel: ActiveWhatsappChannelOwnership | null,
	targetAppId: string,
) {
	if (!existingChannel?.app_id) return
	if (existingChannel.app_id === targetAppId) return

	throw new WhatsAppChannelAssignmentConflictError({
		channelId: existingChannel.id,
		phoneNumberId: existingChannel.phone_number_id || 'unknown',
		existingAppId: existingChannel.app_id,
	})
}

export abstract class WhatsAppService {
	static async getChannels(accountId: string, search?: string) {
		const targetAppId = await resolveAppId(accountId)

		const channels = await prisma.whatsapp_channels.findMany({
			where: {
				app_id: targetAppId || undefined,
				deleted_at: null,
				...(search
					? {
							OR: [
								{ name: { contains: search, mode: 'insensitive' } },
								{ phone_number: { contains: search, mode: 'insensitive' } },
							],
						}
					: {}),
			},
			orderBy: { created_at: 'desc' },
			omit: { api_key: true },
		})

		return attachBaileysSessionSummaries(channels)
	}

	static async getChannelById(id: string) {
		if (!isUuid(id)) return null

		const channel = await prisma.whatsapp_channels.findUnique({
			where: { id },
			omit: { api_key: true },
		})
		if (!channel) return null

		const [enrichedChannel] = await attachBaileysSessionSummaries([channel])
		return enrichedChannel || null
	}

	static async createChannel(data: any, appId: string) {
		const normalizedPhoneNumberId = normalizePhoneNumberId(data.phone_number_id)
		if (!normalizedPhoneNumberId) {
			throw new Error('phone_number_id is required')
		}
		const provider = normalizeWhatsappProvider(data.provider)

		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) {
			throw new Error('App ID required')
		}

		return prisma.$transaction(async (tx) => {
			const existingChannel = await tx.whatsapp_channels.findFirst({
				where: {
					phone_number_id: normalizedPhoneNumberId,
					deleted_at: null,
				},
				select: {
					id: true,
					app_id: true,
					inbox_id: true,
					phone_number_id: true,
				},
				orderBy: { updated_at: 'desc' },
			})
			ensureChannelNotOwnedByAnotherApp(existingChannel, targetAppId)

			let inboxId = data.inbox_id || existingChannel?.inbox_id

			if (!inboxId) {
				const existingInbox = await tx.inboxes.findFirst({
					where: {
						app_id: targetAppId,
						channel_type: 'whatsapp',
						deleted_at: null,
						channel_config: {
							path: ['phoneNumberId'],
							equals: normalizedPhoneNumberId,
						},
					},
					select: { id: true },
				})

				if (existingInbox?.id) {
					inboxId = existingInbox.id
				}
			}

			if (!inboxId) {
				const inbox = await tx.inboxes.create({
					data: {
						app_id: targetAppId,
						name: `WA: ${data.name || data.phone_number}`,
						channel_type: 'whatsapp',
						channel_config: {
							phoneNumberId: normalizedPhoneNumberId,
							provider,
						},
					},
				})
				inboxId = inbox.id
			} else if (isUuid(inboxId)) {
				const inbox = await tx.inboxes.findUnique({
					where: { id: inboxId },
					select: { channel_config: true },
				})
				if (inbox) {
					await tx.inboxes.update({
						where: { id: inboxId },
						data: {
							name: `WA: ${data.name || data.phone_number}`,
							channel_config: buildWhatsappInboxConfig(inbox.channel_config, {
								phoneNumberId: normalizedPhoneNumberId,
								provider,
							}) as any,
							deleted_at: null,
							updated_at: new Date(),
						},
					})
				}
			}

			if (existingChannel) {
				const updatedChannel = await tx.whatsapp_channels.update({
					where: { id: existingChannel.id },
					data: {
						name: data.name,
						phone_number: data.phone_number,
						phone_number_id: normalizedPhoneNumberId,
						waba_id: data.waba_id,
						business_name: data.business_name,
						inbox_id: inboxId,
						app_id: targetAppId,
						provider,
						api_key: data.api_key,
						is_active: true,
						deleted_at: null,
						updated_at: new Date(),
					},
				})
				return normalizeChannelRecord(updatedChannel)
			}

			const createdChannel = await tx.whatsapp_channels.create({
				data: {
					name: data.name,
					phone_number: data.phone_number,
					phone_number_id: normalizedPhoneNumberId,
					waba_id: data.waba_id,
					business_name: data.business_name,
					inbox_id: inboxId,
					app_id: targetAppId,
					provider,
					api_key: data.api_key,
				},
			})
			return normalizeChannelRecord(createdChannel)
		})
	}

	static async createBaileysChannel(
		data: {
			name: string
			phoneNumber: string
			providerChannelKey: string
			providerWebhookUrl?: string | null
		},
		appId: string,
	) {
		const name = String(data.name || '').trim()
		const phoneNumber = normalizePhoneNumber(data.phoneNumber)
		const providerChannelKey = normalizeProviderChannelKey(
			data.providerChannelKey,
		)
		const providerWebhookUrl = normalizeProviderWebhookUrl(
			data.providerWebhookUrl,
		)

		if (!name) throw new Error('name is required')
		if (!phoneNumber) throw new Error('phoneNumber is required')
		if (!providerChannelKey) throw new Error('providerChannelKey is required')
		if (!providerWebhookUrl) {
			throw new Error('providerWebhookUrl must be a valid URL')
		}

		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) {
			throw new Error('App ID required')
		}

		await ensureBaileysSessionStorage()

		const generatedSecret = generateBaileysSecret()

		return prisma.$transaction(async (tx) => {
			const existingChannel = await tx.whatsapp_channels.findFirst({
				where: {
					provider: BAILEYS_WHATSAPP_PROVIDER,
					deleted_at: null,
					extended_metadata: {
						path: ['provider_channel_key'],
						equals: providerChannelKey,
					},
				},
				select: {
					id: true,
					app_id: true,
					inbox_id: true,
					extended_metadata: true,
				},
				orderBy: { updated_at: 'desc' },
			})

			if (existingChannel?.app_id && existingChannel.app_id !== targetAppId) {
				throw new Error(
					`Baileys channel ${providerChannelKey} is already assigned to another app`,
				)
			}

			let inbox =
				existingChannel?.inbox_id && isUuid(existingChannel.inbox_id)
					? await tx.inboxes.findFirst({
							where: {
								id: existingChannel.inbox_id,
								app_id: targetAppId,
							},
						})
					: null

			if (!inbox) {
				inbox = await tx.inboxes.findFirst({
					where: {
						app_id: targetAppId,
						channel_type: 'whatsapp',
						deleted_at: null,
						channel_config: {
							path: ['providerChannelKey'],
							equals: providerChannelKey,
						},
					},
				})
			}

			if (!inbox) {
				inbox = await tx.inboxes.create({
					data: {
						app_id: targetAppId,
						name: `WA: ${name}`,
						channel_type: 'whatsapp',
						channel_config: {
							provider: BAILEYS_WHATSAPP_PROVIDER,
							providerChannelKey: providerChannelKey,
							phoneNumber,
						},
					},
				})
			} else {
				await tx.inboxes.update({
					where: { id: inbox.id },
					data: {
						name: `WA: ${name}`,
						deleted_at: null,
						channel_config: buildWhatsappInboxConfig(inbox.channel_config, {
							provider: BAILEYS_WHATSAPP_PROVIDER,
							providerChannelKey: providerChannelKey,
							phoneNumber,
						}) as any,
						updated_at: new Date(),
					},
				})
			}

			const nextMetadata = {
				...asRecord(existingChannel?.extended_metadata),
				provider_channel_key: providerChannelKey,
				provider_webhook_url: providerWebhookUrl,
			}

			if (existingChannel) {
				const updatedChannel = await tx.whatsapp_channels.update({
					where: { id: existingChannel.id },
					data: {
						app_id: targetAppId,
						name,
						phone_number: phoneNumber,
						inbox_id: inbox.id,
						api_key: generatedSecret,
						provider: BAILEYS_WHATSAPP_PROVIDER,
						extended_metadata: nextMetadata as any,
						is_active: true,
						is_on_cloud: false,
						is_official_business_account: false,
						deleted_at: null,
						updated_at: new Date(),
					},
				})

				await tx.baileys_sessions.upsert({
					where: { channel_id: updatedChannel.id },
					update: {
						app_id: targetAppId,
						provider_channel_key: providerChannelKey,
						phone_number: phoneNumber,
						status: 'pending',
						last_error: null,
						updated_at: new Date(),
						metadata: {
							channel_name: name,
							provider_webhook_url: providerWebhookUrl,
						},
					},
					create: {
						id: generateBaileysSessionId(),
						channel_id: updatedChannel.id,
						app_id: targetAppId,
						provider_channel_key: providerChannelKey,
						phone_number: phoneNumber,
						status: 'pending',
						metadata: {
							channel_name: name,
							provider_webhook_url: providerWebhookUrl,
						},
					},
				})

				return {
					channel: normalizeChannelRecord(updatedChannel),
					secret: generatedSecret,
				}
			}

			const createdChannel = await tx.whatsapp_channels.create({
				data: {
					app_id: targetAppId,
					name,
					phone_number: phoneNumber,
					inbox_id: inbox.id,
					api_key: generatedSecret,
					provider: BAILEYS_WHATSAPP_PROVIDER,
					extended_metadata: nextMetadata as any,
					is_on_cloud: false,
					is_official_business_account: false,
				},
			})

			await tx.baileys_sessions.create({
				data: {
					id: generateBaileysSessionId(),
					channel_id: createdChannel.id,
					app_id: targetAppId,
					provider_channel_key: providerChannelKey,
					phone_number: phoneNumber,
					status: 'pending',
					metadata: {
						channel_name: name,
						provider_webhook_url: providerWebhookUrl,
					},
				},
			})

			return {
				channel: normalizeChannelRecord(createdChannel),
				secret: generatedSecret,
			}
		})
	}

	static async getBaileysChannelByProviderKey(providerChannelKey: string) {
		const normalizedKey = normalizeProviderChannelKey(providerChannelKey)
		if (!normalizedKey) return null

		return prisma.whatsapp_channels.findFirst({
			where: {
				provider: BAILEYS_WHATSAPP_PROVIDER,
				deleted_at: null,
				extended_metadata: {
					path: ['provider_channel_key'],
					equals: normalizedKey,
				},
			},
		})
	}

	static async authenticateBaileysChannel(
		providerChannelKey: string,
		secret: string,
	) {
		const channel =
			await this.getBaileysChannelByProviderKey(providerChannelKey)
		if (!channel) return null

		const normalizedSecret = String(secret || '').trim()
		if (!normalizedSecret || channel.api_key !== normalizedSecret) return null

		return normalizeChannelRecord(channel)
	}

	static async getBaileysSessionSnapshot(channelId: string) {
		if (!isUuid(channelId)) return null

		await ensureBaileysSessionStorage()

		const session = await prisma.baileys_sessions.findUnique({
			where: { channel_id: channelId },
		})
		if (!session) return null

		return {
			channelId,
			providerChannelKey: session.provider_channel_key,
			phoneNumber: session.phone_number || null,
			status: session.status || 'pending',
			pairingCode: session.pairing_code || null,
			qrCode: session.qr_code || null,
			lastError: session.last_error || null,
			lastConnectedAt: session.last_connected_at?.toISOString() || null,
			lastSeenAt: session.last_seen_at?.toISOString() || null,
			isConnected: session.status === 'connected',
			hasConnectedBefore: Boolean(session.first_connected_at || session.last_connected_at),
		}
	}

	static async getPersonalBaileysConnection(appId: string, userId: string) {
		const rows = await prisma.$queryRawUnsafe<any[]>(
			`SELECT s.*, c.name AS channel_name
			 FROM baileys_sessions s
			 JOIN whatsapp_channels c ON c.id = s.channel_id
			 WHERE s.app_id = $1::uuid AND s.owner_user_id = $2::uuid
			   AND c.deleted_at IS NULL
			 LIMIT 1`,
			appId,
			userId,
		)
		const session = rows[0]
		if (!session) return null
		return {
			channelId: session.channel_id,
			phoneNumber: session.phone_number || null,
			status: session.status || 'pending',
			pairingCode: session.pairing_code || null,
			qrCode: session.qr_code || null,
			lastError: session.last_error || null,
			lastConnectedAt: session.last_connected_at?.toISOString?.() || session.last_connected_at || null,
			isConnected: session.status === 'connected',
			requiresPairing: session.status !== 'connected',
			hasConnectedBefore: Boolean(session.first_connected_at || session.last_connected_at),
		}
	}

	static async canAccessBaileysConnection(channelId: string, appId: string, userId: string) {
		const rows = await prisma.$queryRawUnsafe<Array<{ allowed: boolean }>>(
			`SELECT true AS allowed
			 FROM baileys_sessions s
			 WHERE s.channel_id = $1::uuid AND s.app_id = $2::uuid
			   AND (s.owner_user_id IS NULL OR s.owner_user_id = $3::uuid)
			 LIMIT 1`,
			channelId, appId, userId,
		)
		return Boolean(rows[0]?.allowed)
	}

	static async ensurePersonalBaileysConnection(params: {
		appId: string
		userId: string
		userName: string
		providerWebhookUrl: string
	}) {
		const prisma = (await import('../../lib/prisma')).default
		const user = await prisma.users.findUnique({
			where: { id: params.userId },
			select: { phone_number: true },
		})
		const phoneNumber = user?.phone_number && user.phone_number !== '0000000000' ? user.phone_number : ''

		let existing = await this.getPersonalBaileysConnection(params.appId, params.userId)

		// Update phone number & pairing mode kalo user punya nomor valid
		if (phoneNumber && existing?.channelId) {
			await prisma.whatsapp_channels.update({
				where: { id: existing.channelId },
				data: {
					phone_number: phoneNumber,
					extended_metadata: {
						...(existing as any).extended_metadata || {},
						baileys_link_mode: 'pairing_code',
					},
				},
			})
			await prisma.baileys_sessions.update({
				where: { channel_id: existing.channelId },
				data: { phone_number: phoneNumber },
			})
		}

		if (existing) return existing

		const providerChannelKey = `personal-${params.appId}-${params.userId}`
		const created = await this.createBaileysChannel(
			{
				name: `${params.userName || 'Sales'} WhatsApp`,
				phoneNumber: phoneNumber || '0000000000',
				providerChannelKey,
				providerWebhookUrl: params.providerWebhookUrl,
			},
			params.appId,
		)

		if (phoneNumber) {
			await prisma.whatsapp_channels.update({
				where: { id: created.channel.id },
				data: {
					phone_number: phoneNumber,
					extended_metadata: {
						...(created.channel as any).extended_metadata || {},
						baileys_link_mode: 'pairing_code',
					},
				},
			})
		}
		return this.getPersonalBaileysConnection(params.appId, params.userId)
	}
		await prisma.$executeRawUnsafe(
			`UPDATE baileys_sessions SET owner_user_id = $1::uuid, updated_at = now() WHERE channel_id = $2::uuid`,
			params.userId,
			created.channel.id,
		)
		return this.getPersonalBaileysConnection(params.appId, params.userId)
	}

	static async updateChannel(id: string, data: any) {
		if (!isUuid(id)) return null

		const existingChannel = await prisma.whatsapp_channels.findUnique({
			where: { id },
			select: {
				id: true,
				app_id: true,
				inbox_id: true,
				provider: true,
				extended_metadata: true,
			},
		})
		if (!existingChannel) return null

		if (
			normalizeWhatsappProvider(existingChannel.provider) ===
			BAILEYS_WHATSAPP_PROVIDER
		) {
			await ensureBaileysSessionStorage()
		}

		const hasKey = (key: string) =>
			Object.prototype.hasOwnProperty.call(data || {}, key)

		const existingMetadata = asRecord(existingChannel.extended_metadata)
		const metadataUpdate: Record<string, unknown> = { ...existingMetadata }

		if (hasKey('tags')) {
			metadataUpdate.tags = Array.isArray(data.tags)
				? data.tags
						.map((item: unknown) => String(item || '').trim())
						.filter((item: string) => item.length > 0)
				: []
		}
		if (hasKey('default_chatbot_id')) {
			metadataUpdate.default_chatbot_id = toUuidStringOrNull(
				data.default_chatbot_id,
			)
		}
		if (hasKey('default_flow_id')) {
			metadataUpdate.default_flow_id = toUuidStringOrNull(data.default_flow_id)
		}
		if (hasKey('default_team_ids')) {
			metadataUpdate.default_team_ids = Array.isArray(data.default_team_ids)
				? data.default_team_ids
						.map((item: unknown) => toUuidStringOrNull(item))
						.filter((item: string | null): item is string => Boolean(item))
				: []
		}
		if (hasKey('default_agent_ids')) {
			metadataUpdate.default_agent_ids = Array.isArray(data.default_agent_ids)
				? data.default_agent_ids
						.map((item: unknown) => toUuidStringOrNull(item))
						.filter((item: string | null): item is string => Boolean(item))
				: []
		}
		if (hasKey('distribution_method')) {
			metadataUpdate.distribution_method =
				typeof data.distribution_method === 'string'
					? data.distribution_method
					: null
		}
		if (hasKey('provider_channel_key')) {
			metadataUpdate.provider_channel_key = normalizeProviderChannelKey(
				data.provider_channel_key,
			)
		}
		if (hasKey('provider_webhook_url')) {
			metadataUpdate.provider_webhook_url = normalizeProviderWebhookUrl(
				data.provider_webhook_url,
			)
		}

		return prisma.$transaction(async (tx) => {
			const updatedChannel = await tx.whatsapp_channels.update({
				where: { id },
				data: {
					name: data.name,
					phone_number: data.phone_number,
					is_active: data.is_active,
					business_name: data.business_name,
					extended_metadata: metadataUpdate as any,
					updated_at: new Date(),
				},
			})

			if (existingChannel.inbox_id && isUuid(existingChannel.inbox_id)) {
				const inbox = await tx.inboxes.findUnique({
					where: { id: existingChannel.inbox_id },
					select: { channel_config: true },
				})
				const channelConfigUpdate: Record<string, unknown> = {}
				if (hasKey('default_chatbot_id')) {
					channelConfigUpdate.default_chatbot_id =
						metadataUpdate.default_chatbot_id
				}
				if (hasKey('default_flow_id')) {
					channelConfigUpdate.default_flow_id = metadataUpdate.default_flow_id
				}
				if (hasKey('default_team_ids')) {
					channelConfigUpdate.default_team_ids =
						metadataUpdate.default_team_ids || []
				}
				if (hasKey('default_agent_ids')) {
					channelConfigUpdate.default_agent_ids =
						metadataUpdate.default_agent_ids || []
				}
				if (hasKey('distribution_method')) {
					channelConfigUpdate.distribution_method =
						metadataUpdate.distribution_method
				}
				if (hasKey('provider_channel_key')) {
					channelConfigUpdate.providerChannelKey =
						metadataUpdate.provider_channel_key || null
				}
				if (hasKey('provider_webhook_url')) {
					channelConfigUpdate.providerWebhookUrl =
						metadataUpdate.provider_webhook_url || null
				}

				const inboxData: Record<string, unknown> = {
					updated_at: new Date(),
				}
				if (hasKey('default_chatbot_id')) {
					inboxData.chatbot_id =
						(metadataUpdate.default_chatbot_id as string | null) || null
				}
				if (Object.keys(channelConfigUpdate).length > 0) {
					inboxData.channel_config = {
						...asRecord(inbox?.channel_config),
						...channelConfigUpdate,
					}
				}

				await tx.inboxes.update({
					where: { id: existingChannel.inbox_id },
					data: inboxData,
				})
			}

			if (
				normalizeWhatsappProvider(updatedChannel.provider) ===
					BAILEYS_WHATSAPP_PROVIDER &&
				updatedChannel.app_id
			) {
				const providerChannelKey =
					getProviderChannelKeyFromMetadata(metadataUpdate)
				if (providerChannelKey) {
					await tx.baileys_sessions.upsert({
						where: { channel_id: updatedChannel.id },
						update: {
							app_id: updatedChannel.app_id,
							provider_channel_key: providerChannelKey,
							phone_number:
								normalizePhoneNumber(data.phone_number) ||
								updatedChannel.phone_number,
							updated_at: new Date(),
							metadata: {
								channel_name: data.name || updatedChannel.name || null,
								provider_webhook_url:
									getProviderWebhookUrlFromMetadata(metadataUpdate),
							},
							...(hasKey('is_active')
								? {
										status: data.is_active === false ? 'disabled' : 'pending',
									}
								: {}),
						},
						create: {
							id: generateBaileysSessionId(),
							channel_id: updatedChannel.id,
							app_id: updatedChannel.app_id,
							provider_channel_key: providerChannelKey,
							phone_number:
								normalizePhoneNumber(data.phone_number) ||
								updatedChannel.phone_number,
							status: data.is_active === false ? 'disabled' : 'pending',
							metadata: {
								channel_name: data.name || updatedChannel.name || null,
								provider_webhook_url:
									getProviderWebhookUrlFromMetadata(metadataUpdate),
							},
						},
					})
				}
			}

			return normalizeChannelRecord(updatedChannel)
		})
	}

	/**
	 * Upload channel badge image to S3/R2
	 */
	static async uploadBadge(channelId: string, file: File) {
		if (!isUuid(channelId)) throw new Error('Invalid channel ID')

		// Validate file type
		const allowedTypes = ['image/jpeg', 'image/jpg', 'image/png']
		if (!allowedTypes.includes(file.type)) {
			throw new Error('Invalid file type. Only JPG, JPEG, and PNG are allowed')
		}

		// Validate file size (max 2MB)
		const maxSize = 2 * 1024 * 1024
		if (file.size > maxSize) {
			throw new Error('File size exceeds 2MB limit')
		}

		// Get channel info
		const channel = await prisma.whatsapp_channels.findUnique({
			where: { id: channelId },
			select: { phone_number_id: true },
		})

		if (!channel) throw new Error('Channel not found')

		const phoneNumberId = channel.phone_number_id || 'unknown'

		const s3ConfigError = getS3UploadConfigurationError()
		if (s3ConfigError) {
			throw new Error(s3ConfigError)
		}

		// Upload to S3/R2
		const extension = getExtensionFromMimeType(file.type)
		const hash = crypto.randomBytes(8).toString('hex')
		const key = `whatsapp/badges/${phoneNumberId}_${hash}.${extension}`

		const buffer = Buffer.from(await file.arrayBuffer())

		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET_NAME,
				Key: key,
				Body: buffer,
				ContentType: file.type,
				Metadata: {
					channelId,
					phoneNumberId,
					uploadedAt: new Date().toISOString(),
				},
			}),
		)

		const publicUrl = buildS3PublicUrl(key)
		if (!publicUrl) {
			throw new Error('S3 public URL is not configured')
		}

		// Update database
		await prisma.whatsapp_channels.update({
			where: { id: channelId },
			data: {
				badge_url: publicUrl,
				updated_at: new Date(),
			},
		})

		console.log('[Badge Upload] ✅ Badge uploaded:', publicUrl)

		return { badge_url: publicUrl }
	}

	/**
	 * Remove channel badge (reset to default profile picture)
	 */
	static async removeBadge(channelId: string) {
		if (!isUuid(channelId)) throw new Error('Invalid channel ID')

		const channel = await prisma.whatsapp_channels.findUnique({
			where: { id: channelId },
			select: { extended_metadata: true, profile_picture_url: true },
		})

		if (!channel) throw new Error('Channel not found')

		// Fallback to profile_picture_url or extended_metadata.profile_picture_url
		const metadata = (channel.extended_metadata as any) || {}
		const defaultBadge =
			channel.profile_picture_url || metadata.profile_picture_url || null

		await prisma.whatsapp_channels.update({
			where: { id: channelId },
			data: {
				badge_url: defaultBadge,
				updated_at: new Date(),
			},
		})

		console.log('[Badge Remove] ✓ Badge reset to default')

		return {
			badge_url: defaultBadge,
			message: defaultBadge
				? 'Badge reset to profile picture'
				: 'Badge removed',
		}
	}

	static async deleteChannel(id: string) {
		if (!isUuid(id)) return null

		const channel = await prisma.whatsapp_channels.findUnique({
			where: { id },
			select: { inbox_id: true },
		})

		if (!channel) throw new Error('Channel not found')

		const result = await prisma.$transaction(async (tx) => {
			await tx.whatsapp_channels.update({
				where: { id },
				data: {
					deleted_at: new Date(),
					is_active: false,
				},
			})

			if (channel.inbox_id) {
				await tx.inboxes.update({
					where: { id: channel.inbox_id },
					data: { deleted_at: new Date() },
				})
			}
			return true
		})
		return result
	}

	/**
	 * Complete WABA Sync and Channel Creation
	 * Handles the complex logic of discovering WABAs, Phones, and creating channels.
	 */
	static async completeWabaSync(
		accessToken: string,
		appId: string,
		seeds: { wabaIds: string[]; phoneIds: string[] },
	) {
		console.log('[WhatsAppService] Starting WABA Sync...', { seeds })
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) {
			throw new Error('App ID required')
		}
		console.log('[WhatsAppService] targetAppId resolved:', targetAppId)

		let activeToken = accessToken
		// Exchange short-lived token for long-lived user access token
		console.log('[WhatsAppService] Exchanging for long-lived token...')
		try {
			const longLivedResponse = await fetch(
				`https://graph.facebook.com/v23.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${process.env.FB_APP_ID}&client_secret=${process.env.FB_APP_SECRET}&fb_exchange_token=${activeToken}`,
			)
			const longLivedData = (await longLivedResponse.json()) as any
			if (longLivedData.access_token) {
				console.log('[WhatsAppService] Successfully acquired long-lived token.')
				activeToken = longLivedData.access_token
			} else {
				console.log(
					'[WhatsAppService] Failed to get long-lived token:',
					longLivedData.error,
				)
			}
		} catch (e) {
			console.error('[WhatsAppService] Error exchanging token:', e)
		}

		// 1. Get debug token info to verify scopes and granular IDs
		const appAccessToken = `${process.env.FB_APP_ID}|${process.env.FB_APP_SECRET}`
		console.log('[WhatsAppService] Calling debug_token...')
		const debugResponse = await fetch(
			`https://graph.facebook.com/v23.0/debug_token?input_token=${activeToken}&access_token=${appAccessToken}`,
		)
		const debugData = (await debugResponse.json()) as any
		console.log(
			'[WhatsAppService] debug_token result:',
			JSON.stringify(debugData, null, 2),
		)

		const discoveredWabaIds = new Set<string>(seeds.wabaIds)
		const potentialPhoneIds = new Set<string>(seeds.phoneIds)

		// Add from granular scopes
		const granularScopes = debugData.data?.granular_scopes || []
		for (const scope of granularScopes) {
			if (scope.scope === 'whatsapp_business_management') {
				scope.target_ids?.forEach((id: string) => discoveredWabaIds.add(id))
			}
			if (scope.scope === 'whatsapp_business_messaging') {
				scope.target_ids?.forEach((id: string) => potentialPhoneIds.add(id))
			}
		}

		if (debugData.data?.shared_waba_id) {
			discoveredWabaIds.add(debugData.data.shared_waba_id)
		}

		// Deep Discovery if no WABAs found
		if (discoveredWabaIds.size === 0) {
			console.log('[WhatsAppService] Deep Discovery: Fetching user WABAs...')
			try {
				const meResponse = await fetch(
					`https://graph.facebook.com/v23.0/me?fields=id,name,businesses{id,name,whatsapp_business_accounts{id,name}}&access_token=${activeToken}`,
				)
				const meData = (await meResponse.json()) as any

				// Check businesses
				if (meData.businesses?.data) {
					meData.businesses.data.forEach((biz: any) => {
						biz.whatsapp_business_accounts?.data?.forEach((waba: any) =>
							discoveredWabaIds.add(waba.id),
						)
					})
				}

				// Check direct WABAs
				if (discoveredWabaIds.size === 0) {
					const wabasResponse = await fetch(
						`https://graph.facebook.com/v23.0/me/whatsapp_business_accounts?access_token=${activeToken}`,
					)
					const wabasData = (await wabasResponse.json()) as any
					wabasData.data?.forEach((waba: any) => discoveredWabaIds.add(waba.id))
				}
			} catch (e) {
				console.error('[WhatsAppService] Deep Discovery failed', e)
			}
		}

		console.log(
			'[WhatsAppService] Discovered WABAs:',
			Array.from(discoveredWabaIds),
		)
		console.log(
			'[WhatsAppService] Potential Phone IDs:',
			Array.from(potentialPhoneIds),
		)

		const finalPhoneIds = new Set<string>()
		const phoneToWabaMap = new Map<string, string>()
		const firstWabaId = Array.from(discoveredWabaIds)[0]

		// Fetch phones for each WABA
		for (const wabaId of discoveredWabaIds) {
			try {
				let phonesResponse = await fetch(
					`https://graph.facebook.com/v23.0/${wabaId}/phone_numbers?access_token=${activeToken}`,
				)
				let phonesData = (await phonesResponse.json()) as any

				// Fallback to systemic token if user token lacks permissions
				if (phonesData.error && process.env.WHATSAPP_ACCESS_TOKEN) {
					console.log(
						`[WhatsAppService] User token failed to fetch phones. Retrying with system token...`,
					)
					phonesResponse = await fetch(
						`https://graph.facebook.com/v23.0/${wabaId}/phone_numbers?access_token=${process.env.WHATSAPP_ACCESS_TOKEN}`,
					)
					phonesData = (await phonesResponse.json()) as any
				}

				if (phonesData.data) {
					console.log(
						`[WhatsAppService] WABA ${wabaId} has ${phonesData.data.length} phones:`,
						phonesData.data.map((p: any) => p.id),
					)
					phonesData.data.forEach((p: any) => {
						finalPhoneIds.add(p.id)
						phoneToWabaMap.set(p.id, wabaId)
					})
				} else {
					console.log(
						`[WhatsAppService] WABA ${wabaId} phones response:`,
						JSON.stringify(phonesData),
					)
				}
			} catch (e) {
				console.error(
					`[WhatsAppService] Failed to fetch phones for WABA ${wabaId}`,
					e,
				)
			}
		}

		// Removed orphaned phone IDs feature since potentialPhoneIds contains WABA IDs, not Phone IDs

		// Subscribe WABAs to webhook
		for (const wabaId of discoveredWabaIds) {
			try {
				console.log(
					`[WhatsAppService] Subscribing WABA ${wabaId} to webhook...`,
				)
				const subResponse = await fetch(
					`https://graph.facebook.com/v23.0/${wabaId}/subscribed_apps?access_token=${activeToken}`,
					{
						method: 'POST',
						headers: {
							'Content-Type': 'application/json',
						},
					},
				)
				const subData = await subResponse.json()
				console.log(
					`[WhatsAppService] Subscribed WABA ${wabaId}:`,
					JSON.stringify(subData),
				)
			} catch (e) {
				console.error(`[WhatsAppService] Failed to subscribe WABA ${wabaId}`, e)
			}
		}

		const createdChannels = []
		const apiErrors: any[] = []

		// Process each phone number
		for (const phoneId of finalPhoneIds) {
			try {
				const wabaId = phoneToWabaMap.get(phoneId) || firstWabaId
				if (!wabaId) continue

				// Fetch details
				let tokenForFetch = activeToken
				let [wabaData, phoneData] = await Promise.all([
					fetch(
						`https://graph.facebook.com/v23.0/${wabaId}?fields=id,name,currency&access_token=${tokenForFetch}`,
					).then((r) => r.json() as Promise<any>),
					fetch(
						`https://graph.facebook.com/v23.0/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier&access_token=${tokenForFetch}`,
					).then((r) => r.json() as Promise<any>),
				])

				if (
					(wabaData.error || phoneData.error) &&
					process.env.WHATSAPP_ACCESS_TOKEN
				) {
					console.log(
						`[WhatsAppService] Details fetch failed with user token. Retrying with system token...`,
					)
					tokenForFetch = process.env.WHATSAPP_ACCESS_TOKEN
					const fallbackResults = await Promise.all([
						fetch(
							`https://graph.facebook.com/v23.0/${wabaId}?fields=id,name,currency&access_token=${tokenForFetch}`,
						).then((r) => r.json() as Promise<any>),
						fetch(
							`https://graph.facebook.com/v23.0/${phoneId}?fields=id,display_phone_number,verified_name,quality_rating,messaging_limit_tier&access_token=${tokenForFetch}`,
						).then((r) => r.json() as Promise<any>),
					])
					wabaData = fallbackResults[0]
					phoneData = fallbackResults[1]
				}

				if (wabaData.error || phoneData.error) {
					console.error(
						'[WhatsAppService] Error fetching details for',
						phoneId,
						wabaData.error || phoneData.error,
					)
					apiErrors.push({
						phoneId,
						wabaError: wabaData.error?.message,
						phoneError: phoneData.error?.message,
					})
					continue
				}

				// Create Channel using internal method (mimicking createChannel but with full data)
				const channelName =
					phoneData.verified_name ||
					phoneData.display_phone_number ||
					'WhatsApp Channel'

				const savedChannel = await prisma.$transaction(async (tx) => {
					const existingChannel = await tx.whatsapp_channels.findFirst({
						where: {
							phone_number_id: phoneId,
							deleted_at: null,
						},
						select: {
							id: true,
							app_id: true,
							inbox_id: true,
							phone_number_id: true,
						},
						orderBy: { updated_at: 'desc' },
					})
					ensureChannelNotOwnedByAnotherApp(existingChannel, targetAppId)

					let inbox =
						existingChannel?.inbox_id && isUuid(existingChannel.inbox_id)
							? await tx.inboxes.findFirst({
									where: {
										id: existingChannel.inbox_id,
										app_id: targetAppId,
									},
								})
							: null

					if (!inbox) {
						inbox = await tx.inboxes.findFirst({
							where: {
								app_id: targetAppId,
								channel_type: 'whatsapp',
								deleted_at: null,
								channel_config: { path: ['phoneNumberId'], equals: phoneId },
							},
						})
					}

					if (!inbox) {
						inbox = await tx.inboxes.create({
							data: {
								app_id: targetAppId,
								name: `WA: ${channelName}`,
								channel_type: 'whatsapp',
								channel_config: {
									phoneNumberId: phoneId,
									provider: OFFICIAL_WHATSAPP_PROVIDER,
								},
							},
						})
					} else {
						await tx.inboxes.update({
							where: { id: inbox.id },
							data: {
								name: `WA: ${channelName}`,
								deleted_at: null,
								channel_config: buildWhatsappInboxConfig(inbox.channel_config, {
									phoneNumberId: phoneId,
									provider: OFFICIAL_WHATSAPP_PROVIDER,
								}) as any,
								updated_at: new Date(),
							},
						})
					}

					if (existingChannel) {
						const updatedChannel = await tx.whatsapp_channels.update({
							where: { id: existingChannel.id },
							data: {
								app_id: targetAppId,
								name: channelName,
								phone_number: phoneData.display_phone_number,
								waba_id: wabaId,
								api_key: activeToken,
								business_name: wabaData.name,
								extended_metadata: {
									quality_rating: phoneData.quality_rating,
									messaging_limit: phoneData.messaging_limit_tier,
								},
								is_active: true,
								provider: OFFICIAL_WHATSAPP_PROVIDER,
								deleted_at: null,
								inbox_id: inbox.id,
								updated_at: new Date(),
							},
						})
						return normalizeChannelRecord(updatedChannel)
					} else {
						const createdChannel = await tx.whatsapp_channels.create({
							data: {
								app_id: targetAppId,
								name: channelName,
								phone_number: phoneData.display_phone_number,
								phone_number_id: phoneId,
								waba_id: wabaId,
								api_key: activeToken,
								business_name: wabaData.name,
								provider: OFFICIAL_WHATSAPP_PROVIDER,
								extended_metadata: {
									quality_rating: phoneData.quality_rating,
									messaging_limit: phoneData.messaging_limit_tier,
								},
								inbox_id: inbox.id,
							},
						})
						return normalizeChannelRecord(createdChannel)
					}
				})

				createdChannels.push(savedChannel)
			} catch (error: any) {
				console.error(
					'[WhatsAppService] Failed to process phoneId',
					phoneId,
					error,
				)
				if (error instanceof WhatsAppChannelAssignmentConflictError) {
					apiErrors.push({
						phoneId,
						code: 'CHANNEL_APP_CONFLICT',
						channelId: error.channelId,
						phoneNumberId: error.phoneNumberId,
						existingAppId: error.existingAppId,
						error: error.message,
					})
					continue
				}
				apiErrors.push({ phoneId, error: error.message || String(error) })
			}
		}

		if (createdChannels.length === 0) {
			const firstOwnershipConflict = apiErrors.find(
				(item) => item?.code === 'CHANNEL_APP_CONFLICT',
			)
			if (firstOwnershipConflict) {
				throw new WhatsAppChannelAssignmentConflictError({
					channelId: String(firstOwnershipConflict.channelId || ''),
					phoneNumberId:
						String(firstOwnershipConflict.phoneNumberId || '').trim() ||
						String(firstOwnershipConflict.phoneId || '').trim() ||
						'unknown',
					existingAppId: String(firstOwnershipConflict.existingAppId || ''),
				})
			}

			let errorReason = 'Unknown configuration error while syncing WABA'
			if (discoveredWabaIds.size === 0) {
				errorReason =
					'No WhatsApp Business Accounts found inside the provided Meta Account. If you just created one, please make sure it was successfully added.'
			} else if (finalPhoneIds.size === 0) {
				errorReason =
					'WhatsApp Business Account was found, but no phone numbers are linked to it. Please add a valid phone number in the Meta Business Manager and try again.'
			} else {
				errorReason =
					'Phone numbers were found but could not be processed due to Graph API permission errors. Is the WhatsApp account active? API Details: ' +
					JSON.stringify(apiErrors)
			}
			throw new Error(errorReason)
		}

		return createdChannels
	}
}
