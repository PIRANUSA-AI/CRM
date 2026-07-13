import { PutObjectCommand } from '@aws-sdk/client-s3'
import makeWASocket, {
	BufferJSON,
	Browsers,
	DisconnectReason,
	downloadMediaMessage,
	getContentType,
	initAuthCreds,
	isJidGroup,
	isJidStatusBroadcast,
	makeCacheableSignalKeyStore,
	normalizeMessageContent,
	proto,
	type AuthenticationState,
	type WAMessage,
	type WAMessageUpdate,
	type WASocket,
} from '@whiskeysockets/baileys'
import {
	BAILEYS_CHANNEL_SYNC_INTERVAL_MS,
	BAILEYS_LINK_MODE,
	CRM_BAILEYS_WEBHOOK_URL,
} from './config'
import {
	createUuid,
	ensureBaileysSessionStorage,
	execute,
	queryMany,
	queryOne,
} from './db'
import {
	BUCKET_NAME,
	buildS3PublicUrl,
	getS3UploadConfigurationError,
	s3,
} from './s3'

const BAILEYS_PROVIDER = 'baileys'

type JsonRecord = Record<string, unknown>

type BaileysChannelRecord = {
	id: string
	app_id: string
	name: string | null
	phone_number: string | null
	api_key: string | null
	extended_metadata: unknown
	is_active: boolean | null
	deleted_at: Date | null
}

type BaileysSessionRow = {
	id: string
	channel_id: string
	app_id: string
	provider_channel_key: string
	phone_number: string | null
	status: string | null
	auth_state: unknown
	pairing_code: string | null
	qr_code: string | null
	last_error: string | null
	last_connected_at: Date | string | null
	last_seen_at: Date | string | null
	metadata: unknown
	created_at: Date | string | null
	updated_at: Date | string | null
}

type PersistedAuthEnvelope = {
	creds?: unknown
	keys?: Record<string, Record<string, unknown | null>>
}

type RuntimeEntry = {
	channelId: string
	providerChannelKey: string
	phoneNumber: string | null
	apiKey: string | null
	socket: WASocket | null
	starting: boolean
	desiredRunning: boolean
	pairingCodeRequested: boolean
	restartTimer: ReturnType<typeof setTimeout> | null
}

export type BaileysSessionSnapshot = {
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

const runtimeEntries = new Map<string, RuntimeEntry>()

const baileysLogger = {
	level: 'silent',
	child() {
		return baileysLogger
	},
	trace() {},
	debug() {},
	info() {},
	warn(...args: unknown[]) {
		console.warn('[BaileysService]', ...args)
	},
	error(...args: unknown[]) {
		console.error('[BaileysService]', ...args)
	},
	fatal(...args: unknown[]) {
		console.error('[BaileysService]', ...args)
	},
} as const

function asRecord(value: unknown): JsonRecord {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as JsonRecord
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeDigits(value: string | null | undefined) {
	return String(value || '').replace(/\D/g, '').trim()
}

function normalizeProviderChannelKey(metadata: unknown): string | null {
	const record = asRecord(metadata)
	return (
		asString(record.provider_channel_key) ||
		asString(record.providerChannelKey) ||
		null
	)
}

function shouldUsePairingCode(channel: BaileysChannelRecord) {
	const metadata = asRecord(channel.extended_metadata)
	const configuredMode =
		asString(metadata.baileys_link_mode) ||
		asString(metadata.link_mode) ||
		BAILEYS_LINK_MODE

	return String(configuredMode || '')
		.trim()
		.toLowerCase() === 'pairing_code'
}

function serializeBufferJson(value: unknown) {
	return JSON.parse(JSON.stringify(value, BufferJSON.replacer))
}

function deserializeBufferJson<T>(value: unknown) {
	return JSON.parse(JSON.stringify(value ?? null), BufferJSON.reviver) as T
}

function toIsoString(value: Date | string | null | undefined) {
	if (!value) return null
	if (typeof value === 'string') return value
	return value.toISOString()
}

function mapBaileysStatus(value: number | null | undefined): string | null {
	switch (value) {
		case proto.WebMessageInfo.Status.PENDING:
		case proto.WebMessageInfo.Status.SERVER_ACK:
			return 'sent'
		case proto.WebMessageInfo.Status.DELIVERY_ACK:
			return 'delivered'
		case proto.WebMessageInfo.Status.READ:
			return 'read'
		case proto.WebMessageInfo.Status.PLAYED:
			return 'played'
		default:
			return null
	}
}

function extractDisconnectCode(error: unknown): number | null {
	const record = error as {
		output?: { statusCode?: unknown }
		statusCode?: unknown
	}
	const outputCode =
		typeof record?.output?.statusCode === 'number'
			? record.output.statusCode
			: null
	if (outputCode !== null) return outputCode
	return typeof record?.statusCode === 'number' ? record.statusCode : null
}

function buildDisconnectMessage(error: unknown) {
	if (error instanceof Error && error.message) return error.message
	const record = error as {
		data?: { reason?: unknown }
		output?: { payload?: { message?: unknown } }
	}
	return (
		asString(record?.data?.reason) ||
		asString(record?.output?.payload?.message) ||
		'Baileys connection closed'
	)
}

function getWaIdFromJid(value: string | null | undefined) {
	const jid = String(value || '').trim()
	if (!jid) return null
	return jid.split('@')[0] || null
}

function normalizeWhatsappJid(value: string | null | undefined) {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized) return null
	const match = normalized.match(/^([0-9]+)(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/)
	if (!match?.[1] || !match?.[2]) return null
	return `${match[1]}@${match[2]}`
}

function resolveRecipientAddressingMode(
	value: string | null | undefined,
): 'lid' | 'pn' | null {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized) return null
	if (normalized === 'lid' || normalized.endsWith('@lid')) return 'lid'
	if (
		normalized === 'pn' ||
		normalized === 's.whatsapp.net' ||
		normalized.endsWith('@s.whatsapp.net')
	) {
		return 'pn'
	}
	return null
}

function buildWhatsappJid(
	recipientWaId: string | null | undefined,
	addressingMode: 'lid' | 'pn',
) {
	const normalizedRecipient = normalizeDigits(recipientWaId)
	if (!normalizedRecipient) return null
	return `${normalizedRecipient}@${
		addressingMode === 'lid' ? 'lid' : 's.whatsapp.net'
	}`
}

function getMessageTimestamp(value: unknown) {
	if (typeof value === 'number') {
		return value > 10_000_000_000 ? value : value * 1000
	}
	const record = value as { toNumber?: () => number; low?: number } | null
	if (typeof record?.toNumber === 'function') {
		const next = record.toNumber()
		return next > 10_000_000_000 ? next : next * 1000
	}
	if (typeof record?.low === 'number') {
		return record.low > 10_000_000_000 ? record.low : record.low * 1000
	}
	return Date.now()
}

function getMediaExtension(mimeType: string | null) {
	const normalized = String(mimeType || '').trim().toLowerCase()
	const map: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'video/mp4': 'mp4',
		'video/quicktime': 'mov',
		'audio/ogg': 'ogg',
		'audio/mpeg': 'mp3',
		'audio/mp4': 'm4a',
		'application/pdf': 'pdf',
	}
	return map[normalized] || 'bin'
}

function parseDbValue(value: unknown) {
	if (value === undefined) return null
	if (value === null) return null
	if (value instanceof Date) return value
	if (typeof value === 'object') return JSON.stringify(value)
	return value
}

function createEntry(params: {
	channelId: string
	providerChannelKey: string
	phoneNumber: string | null
	apiKey: string | null
}) {
	const existing = runtimeEntries.get(params.channelId)
	if (existing) {
		existing.providerChannelKey = params.providerChannelKey
		existing.phoneNumber = params.phoneNumber
		existing.apiKey = params.apiKey
		return existing
	}

	const entry: RuntimeEntry = {
		channelId: params.channelId,
		providerChannelKey: params.providerChannelKey,
		phoneNumber: params.phoneNumber,
		apiKey: params.apiKey,
		socket: null,
		starting: false,
		desiredRunning: true,
		pairingCodeRequested: false,
		restartTimer: null,
	}
	runtimeEntries.set(params.channelId, entry)
	return entry
}

async function getChannelById(channelId: string) {
	const channel = await queryOne<BaileysChannelRecord>(
		`
			SELECT
				id,
				app_id,
				name,
				phone_number,
				api_key,
				extended_metadata,
				is_active,
				deleted_at
			FROM public.whatsapp_channels
			WHERE id = $1
				AND provider = $2
				AND deleted_at IS NULL
			LIMIT 1
		`,
		[channelId, BAILEYS_PROVIDER],
	)

	if (!channel?.app_id) return null
	return channel
}

async function getChannelByProviderKey(providerChannelKey: string) {
	return queryOne<BaileysChannelRecord>(
		`
			SELECT
				id,
				app_id,
				name,
				phone_number,
				api_key,
				extended_metadata,
				is_active,
				deleted_at
			FROM public.whatsapp_channels
			WHERE provider = $1
				AND deleted_at IS NULL
				AND extended_metadata ->> 'provider_channel_key' = $2
			LIMIT 1
		`,
		[BAILEYS_PROVIDER, providerChannelKey],
	)
}

async function listActiveChannels(): Promise<BaileysChannelRecord[]> {
	return queryMany<BaileysChannelRecord>(
		`
			SELECT
				id,
				app_id,
				name,
				phone_number,
				api_key,
				extended_metadata,
				is_active,
				deleted_at
			FROM public.whatsapp_channels
			WHERE provider = $1
				AND deleted_at IS NULL
				AND COALESCE(is_active, true) = true
				AND app_id IS NOT NULL
		`,
		[BAILEYS_PROVIDER],
	)
}

async function getSessionByChannelId(channelId: string) {
	return queryOne<BaileysSessionRow>(
		`
			SELECT *
			FROM public.baileys_sessions
			WHERE channel_id = $1
			LIMIT 1
		`,
		[channelId],
	)
}

async function updateSessionById(
	sessionId: string,
	patch: Record<string, unknown>,
) {
	const entries = Object.entries(patch)
	if (entries.length === 0) return

	const assignments = entries.map(
		([key], index) => `"${key}" = $${index + 2}`,
	)
	const values = entries.map(([, value]) => parseDbValue(value))

	await execute(
		`
			UPDATE public.baileys_sessions
			SET ${assignments.join(', ')}
			WHERE id = $1
		`,
		[sessionId, ...values],
	)
}

async function updateSessionByChannelId(
	channelId: string,
	patch: Record<string, unknown>,
) {
	const session = await getSessionByChannelId(channelId)
	if (!session?.id) return
	await updateSessionById(session.id, patch)
}

async function upsertSessionRecord(channel: BaileysChannelRecord) {
	const providerChannelKey = normalizeProviderChannelKey(channel.extended_metadata)
	if (!providerChannelKey) {
		throw new Error(`Baileys channel ${channel.id} missing provider_channel_key`)
	}

	const metadata = {
		channel_name: channel.name || null,
		provider_webhook_url:
			asString(asRecord(channel.extended_metadata).provider_webhook_url) || null,
	}

	const nextId = createUuid()
	const row = await queryOne<BaileysSessionRow>(
		`
			INSERT INTO public.baileys_sessions (
				id,
				channel_id,
				app_id,
				provider_channel_key,
				phone_number,
				status,
				metadata,
				created_at,
				updated_at
			)
			VALUES (
				$1,
				$2,
				$3,
				$4,
				$5,
				'pending',
				$6::jsonb,
				now(),
				now()
			)
			ON CONFLICT (channel_id) DO UPDATE SET
				app_id = EXCLUDED.app_id,
				provider_channel_key = EXCLUDED.provider_channel_key,
				phone_number = EXCLUDED.phone_number,
				metadata = EXCLUDED.metadata,
				updated_at = now()
			RETURNING *
		`,
		[
			nextId,
			channel.id,
			channel.app_id,
			providerChannelKey,
			channel.phone_number,
			JSON.stringify(metadata),
		],
	)
	if (!row) {
		throw new Error(`Failed to persist Baileys session for channel ${channel.id}`)
	}
	return row
}

function buildAuthState(sessionRow: BaileysSessionRow) {
	const restored = deserializeBufferJson<PersistedAuthEnvelope>(
		sessionRow.auth_state,
	)
	const persisted: PersistedAuthEnvelope = {
		creds:
			restored?.creds && typeof restored.creds === 'object'
				? restored.creds
				: initAuthCreds(),
		keys:
			restored?.keys && typeof restored.keys === 'object'
				? restored.keys
				: {},
	}

	const persist = async () => {
		await updateSessionById(sessionRow.id, {
			auth_state: serializeBufferJson(persisted),
			updated_at: new Date(),
			last_seen_at: new Date(),
		})
	}

	const state: AuthenticationState = {
		creds: persisted.creds as AuthenticationState['creds'],
		keys: {
			get: async (type, ids) => {
				const category = asRecord((persisted.keys || {})[type])
				const data: Record<string, unknown> = {}
				for (const id of ids) {
					let value = category[id]
					if (type === 'app-state-sync-key' && value) {
						value = proto.Message.AppStateSyncKeyData.fromObject(value as any)
					}
					if (value !== null && value !== undefined) {
						data[id] = value
					}
				}
				return data as any
			},
			set: async (data) => {
				for (const category of Object.keys(data || {})) {
					const nextValues = (data as Record<string, Record<string, unknown | null>>)[
						category
					]
					const bucket = {
						...asRecord((persisted.keys || {})[category]),
					}
					for (const [id, value] of Object.entries(nextValues || {})) {
						if (value === null) {
							delete bucket[id]
						} else {
							bucket[id] = value
						}
					}
					;(persisted.keys ||= {})[category] = bucket
				}
				await persist()
			},
		},
	}

	return {
		state,
		saveCreds: async () => {
			persisted.creds = state.creds as unknown
			await persist()
		},
	}
}

async function uploadInboundMedia(params: {
	channelId: string
	messageId: string
	buffer: Buffer
	mimeType: string | null
	fileName?: string | null
}) {
	const configError = getS3UploadConfigurationError()
	if (configError) return null

	const extension = getMediaExtension(params.mimeType)
	const key = `whatsapp/baileys/${params.channelId}/${params.messageId}.${extension}`

	await s3.send(
		new PutObjectCommand({
			Bucket: BUCKET_NAME,
			Key: key,
			Body: params.buffer,
			ContentType: params.mimeType || 'application/octet-stream',
			Metadata: {
				channelId: params.channelId,
				messageId: params.messageId,
				fileName: params.fileName || '',
			},
		}),
	)

	return buildS3PublicUrl(key)
}

async function postWebhookToCrm(entry: RuntimeEntry, payload: unknown) {
	if (!entry.apiKey) {
		throw new Error(`Baileys channel ${entry.channelId} missing api_key`)
	}

	const response = await fetch(CRM_BAILEYS_WEBHOOK_URL, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${entry.apiKey}`,
			'X-Crm-Channel-Secret': entry.apiKey,
		},
		body: JSON.stringify(payload),
	})

	if (response.ok) return

	const responseText = await response.text()
	const message = responseText.trim() || `HTTP ${response.status}`
	throw new Error(`CRM webhook rejected Baileys event: ${message}`)
}

export abstract class BaileysServiceRuntime {
	private static bootstrapPromise: Promise<void> | null = null
	private static syncTimer: ReturnType<typeof setInterval> | null = null

	static async bootstrap() {
		if (this.bootstrapPromise) return this.bootstrapPromise

		this.bootstrapPromise = (async () => {
			await ensureBaileysSessionStorage()
			await this.syncActiveChannels()

			if (!this.syncTimer) {
				this.syncTimer = setInterval(() => {
					void this.syncActiveChannels().catch((error) => {
						console.error('[BaileysService] Channel sync failed', error)
					})
				}, BAILEYS_CHANNEL_SYNC_INTERVAL_MS)
			}
		})().catch((error) => {
			this.bootstrapPromise = null
			throw error
		})

		return this.bootstrapPromise
	}

	static async syncActiveChannels() {
		await ensureBaileysSessionStorage()
		const channels = await listActiveChannels()
		const activeIds = new Set<string>()

		for (const channel of channels) {
			activeIds.add(channel.id)
		}

		await Promise.allSettled(
			channels.map((channel: BaileysChannelRecord) =>
				this.ensureLoadedChannel(channel, {
					waitForReadyMs: 0,
				}),
			),
		)

		await Promise.allSettled(
			Array.from(runtimeEntries.keys())
				.filter((channelId) => !activeIds.has(channelId))
				.map((channelId) => this.stopChannel(channelId, 'inactive')),
		)
	}

	static async ensureChannel(
		channelId: string,
		options?: { forceRestart?: boolean; waitForReadyMs?: number },
	) {
		await ensureBaileysSessionStorage()

		const channel = await getChannelById(channelId)
		if (!channel) throw new Error('Baileys channel not found')

		return this.ensureLoadedChannel(channel, options)
	}

	private static async ensureLoadedChannel(
		channel: BaileysChannelRecord,
		options?: { forceRestart?: boolean; waitForReadyMs?: number },
	) {
		const providerChannelKey = normalizeProviderChannelKey(channel.extended_metadata)
		if (!providerChannelKey) {
			throw new Error('Baileys channel missing provider channel key')
		}

		const entry = createEntry({
			channelId: channel.id,
			providerChannelKey,
			phoneNumber: channel.phone_number,
			apiKey: channel.api_key,
		})
		entry.desiredRunning = true

		if (options?.forceRestart) {
			this.clearRestartTimer(entry)
			const currentSocket = entry.socket
			entry.socket = null
			entry.pairingCodeRequested = false
			if (currentSocket) currentSocket.end(undefined)
		}

		if (!entry.socket && !entry.starting) {
			entry.starting = true
			void this.startSocket(channel, entry).finally(() => {
				entry.starting = false
			})
		}

		return options?.waitForReadyMs
			? this.waitForReadyState(channel.id, options.waitForReadyMs)
			: this.getSessionSnapshot(channel.id)
	}

	static async stopChannel(channelId: string, nextStatus = 'inactive') {
		const entry = runtimeEntries.get(channelId)
		if (!entry) {
			await updateSessionByChannelId(channelId, {
				status: nextStatus,
				last_error: null,
				pairing_code: null,
				qr_code: null,
				updated_at: new Date(),
			})
			return
		}

		entry.desiredRunning = false
		entry.pairingCodeRequested = false
		this.clearRestartTimer(entry)

		const currentSocket = entry.socket
		entry.socket = null
		if (currentSocket) currentSocket.end(undefined)

		await updateSessionByChannelId(channelId, {
			status: nextStatus,
			last_error: null,
			pairing_code: null,
			qr_code: null,
			updated_at: new Date(),
		})
	}

	static async getSessionSnapshot(
		channelId: string,
	): Promise<BaileysSessionSnapshot> {
		await ensureBaileysSessionStorage()

		const session = await getSessionByChannelId(channelId)
		if (!session) {
			throw new Error('Baileys session not found')
		}

		return {
			channelId,
			providerChannelKey: session.provider_channel_key,
			phoneNumber: session.phone_number || null,
			status: session.status || 'pending',
			pairingCode: session.pairing_code || null,
			qrCode: session.qr_code || null,
			lastError: session.last_error || null,
			lastConnectedAt: toIsoString(session.last_connected_at),
			lastSeenAt: toIsoString(session.last_seen_at),
			isConnected: session.status === 'connected',
		}
	}

	static async authenticateChannelSecret(
		providerChannelKey: string,
		secret: string,
	) {
		const channel = await getChannelByProviderKey(providerChannelKey)
		if (!channel?.api_key) return null

		const normalizedSecret = String(secret || '').trim()
		if (!normalizedSecret || channel.api_key !== normalizedSecret) return null

		return channel
	}

	static async sendMessage(payload: Record<string, unknown>) {
		const channelKey = asString(payload.channelKey) || asString(payload.channel_key)
		if (!channelKey) throw new Error('channelKey is required')

		const channel = await getChannelByProviderKey(channelKey)
		if (!channel?.id || !channel.app_id) {
			throw new Error(`Baileys channel ${channelKey} not found`)
		}

		const session = await this.ensureChannel(channel.id, {
			waitForReadyMs: 12_000,
		})
		if (session.status !== 'connected') {
			throw new Error(
				session.qrCode
					? 'Baileys session is waiting for QR scan'
					: `Baileys session is ${session.status}`,
			)
		}

		const entry = runtimeEntries.get(channel.id)
		if (!entry?.socket) {
			throw new Error('Baileys runtime socket is not available')
		}

		const explicitRecipientJid =
			normalizeWhatsappJid(
				asString(payload.recipientJid) ||
					asString(payload.recipient_jid) ||
					asString(payload.recipientWhatsAppJid) ||
					asString(payload.recipient_whatsapp_jid) ||
					asString(payload.recipientWhatsAppId) ||
					asString(payload.recipient_whats_app_id) ||
					asString(payload.to),
			) || null
		const recipientWaId = normalizeDigits(
			asString(payload.recipientWhatsAppId) ||
				asString(payload.recipient_whats_app_id) ||
				asString(payload.to),
		)
		const recipientAddressingMode = resolveRecipientAddressingMode(
			asString(payload.recipientAddressingMode) ||
				asString(payload.recipient_addressing_mode) ||
				explicitRecipientJid,
		)
		const recipientJid =
			explicitRecipientJid ||
			buildWhatsappJid(recipientWaId, recipientAddressingMode || 'pn')
		if (!recipientJid) throw new Error('recipientWhatsAppId is required')

		const messageBody = await this.buildOutboundMessage(payload)
		const sent = await entry.socket.sendMessage(
			recipientJid,
			messageBody as any,
		)

		await updateSessionByChannelId(channel.id, {
			last_seen_at: new Date(),
			updated_at: new Date(),
			last_error: null,
		})

		return {
			externalId:
				asString(sent?.key?.id) ||
				asString(payload.messageId) ||
				asString(payload.message_id) ||
				'',
		}
	}

	private static async buildOutboundMessage(payload: Record<string, unknown>) {
		const type = String(payload.type || 'text').trim().toLowerCase()
		const textRecord = asRecord(payload.text)
		const mediaRecord = asRecord(payload.media)

		if (type === 'image') {
			const url = asString(mediaRecord.url)
			if (!url) throw new Error('Baileys outbound image url is required')
			return {
				image: { url },
				...(asString(mediaRecord.caption)
					? { caption: asString(mediaRecord.caption) }
					: {}),
			}
		}

		if (type === 'video') {
			const url = asString(mediaRecord.url)
			if (!url) throw new Error('Baileys outbound video url is required')
			return {
				video: { url },
				...(asString(mediaRecord.caption)
					? { caption: asString(mediaRecord.caption) }
					: {}),
				ptv: false,
			}
		}

		if (type === 'audio') {
			const url = asString(mediaRecord.url)
			if (!url) throw new Error('Baileys outbound audio url is required')
			return {
				audio: { url },
				...(asString(mediaRecord.mimeType)
					? { mimetype: asString(mediaRecord.mimeType) }
					: {}),
			}
		}

		if (type === 'document') {
			const url = asString(mediaRecord.url)
			if (!url) throw new Error('Baileys outbound document url is required')
			return {
				document: { url },
				...(asString(mediaRecord.fileName)
					? { fileName: asString(mediaRecord.fileName) }
					: {}),
				...(asString(mediaRecord.caption)
					? { caption: asString(mediaRecord.caption) }
					: {}),
				...(asString(mediaRecord.mimeType)
					? { mimetype: asString(mediaRecord.mimeType) }
					: {}),
			}
		}

		const body =
			asString(textRecord.body) ||
			asString(payload.text) ||
			asString(payload.content) ||
			'Pesan WhatsApp'
		return { text: body }
	}

	private static async startSocket(
		channel: BaileysChannelRecord,
		entry: RuntimeEntry,
	) {
		const sessionRow = await upsertSessionRecord(channel)
		const auth = buildAuthState(sessionRow)

		await updateSessionById(sessionRow.id, {
			status: 'connecting',
			pairing_code: null,
			qr_code: null,
			last_error: null,
			updated_at: new Date(),
		})

		const socket = makeWASocket({
			auth: {
				creds: auth.state.creds,
				keys: makeCacheableSignalKeyStore(auth.state.keys, baileysLogger as any),
			},
			logger: baileysLogger as any,
			browser: Browsers.macOS('Google Chrome'),
			printQRInTerminal: false,
			markOnlineOnConnect: false,
			getMessage: async () => undefined,
		})

		entry.socket = socket
		entry.desiredRunning = true
		entry.pairingCodeRequested = false

		socket.ev.on('creds.update', () => {
			void auth.saveCreds().catch((error) => {
				console.error('[BaileysService] Failed to persist auth creds', error)
			})
		})

		socket.ev.on('connection.update', (update) => {
			void this.handleConnectionUpdate({
				channel,
				entry,
				socket,
				update,
			})
		})

		socket.ev.on('messages.upsert', ({ messages, type }) => {
			if (type !== 'notify') return
			void this.handleMessagesUpsert(entry, socket, messages)
		})

		socket.ev.on('messages.update', (updates) => {
			void this.handleMessageStatusUpdates(entry, updates)
		})
	}

	private static async handleConnectionUpdate(params: {
		channel: BaileysChannelRecord
		entry: RuntimeEntry
		socket: WASocket
		update: Partial<{
			connection: string
			lastDisconnect: { error?: unknown }
			qr: string
		}>
	}) {
		const { channel, entry, socket, update } = params
		const sessionRow = await getSessionByChannelId(channel.id)
		if (!sessionRow?.id) return

		if (update.qr) {
			await updateSessionById(sessionRow.id, {
				status: 'qr_ready',
				qr_code: update.qr,
				pairing_code: null,
				last_error: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
		}

		const normalizedPhoneNumber = normalizeDigits(channel.phone_number)
		if (
			shouldUsePairingCode(channel) &&
			normalizedPhoneNumber &&
			!socket.authState.creds.registered &&
			!entry.pairingCodeRequested &&
			Boolean(update.qr)
		) {
			entry.pairingCodeRequested = true
			void (async () => {
				try {
					const pairingCode = await socket.requestPairingCode(
						normalizedPhoneNumber,
					)
					await updateSessionById(sessionRow.id, {
						status: 'pairing_code_ready',
						pairing_code: pairingCode,
						qr_code: null,
						last_error: null,
						last_seen_at: new Date(),
						updated_at: new Date(),
					})
				} catch (error) {
					entry.pairingCodeRequested = false
					const latestSession = await getSessionByChannelId(channel.id)
					await updateSessionById(sessionRow.id, {
						status: latestSession?.qr_code ? 'qr_ready' : 'connecting',
						pairing_code: latestSession?.pairing_code || null,
						qr_code: latestSession?.qr_code || null,
						last_error:
							error instanceof Error
								? error.message
								: 'Failed to request Baileys pairing code',
						last_seen_at: new Date(),
						updated_at: new Date(),
					})
				}
			})()
		}

		if (update.connection === 'open') {
			entry.pairingCodeRequested = false
			await updateSessionById(sessionRow.id, {
				status: 'connected',
				pairing_code: null,
				qr_code: null,
				last_error: null,
				last_connected_at: new Date(),
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
			return
		}

		if (update.connection !== 'close') return
		if (entry.socket && entry.socket !== socket) return

		const disconnectCode = extractDisconnectCode(update.lastDisconnect?.error)
		const disconnectMessage = buildDisconnectMessage(update.lastDisconnect?.error)
		const formattedDisconnectMessage =
			disconnectCode !== null
				? `${disconnectMessage} (code ${disconnectCode})`
				: disconnectMessage

		console.warn('[BaileysService] Connection closed', {
			channelId: channel.id,
			providerChannelKey: entry.providerChannelKey,
			disconnectCode,
			disconnectMessage,
		})

		entry.socket = null
		entry.pairingCodeRequested = false

		if (!entry.desiredRunning) {
			await updateSessionById(sessionRow.id, {
				status: 'inactive',
				last_error: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
			return
		}

		if (disconnectCode === DisconnectReason.restartRequired) {
			await updateSessionById(sessionRow.id, {
				status: 'restarting',
				last_error: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
			this.scheduleRestart(entry.channelId, 250)
			return
		}

		if (
			disconnectCode === DisconnectReason.loggedOut ||
			disconnectCode === DisconnectReason.badSession
		) {
			await updateSessionById(sessionRow.id, {
				status: 'logged_out',
				auth_state: null,
				pairing_code: null,
				qr_code: null,
				last_error: formattedDisconnectMessage,
				updated_at: new Date(),
			})
			return
		}

		const shouldReconnect =
			disconnectCode !== DisconnectReason.connectionReplaced &&
			disconnectCode !== DisconnectReason.forbidden

		await updateSessionById(sessionRow.id, {
			status: shouldReconnect ? 'reconnecting' : 'disconnected',
			last_error: formattedDisconnectMessage,
			last_seen_at: new Date(),
			updated_at: new Date(),
		})

		if (shouldReconnect) {
			this.scheduleRestart(entry.channelId, 2_500)
		}
	}

	private static async handleMessagesUpsert(
		entry: RuntimeEntry,
		socket: WASocket,
		messages: WAMessage[],
	) {
		for (const message of messages) {
			try {
				if (!message.message || !message.key?.id) continue
				if (message.key.fromMe) continue
				const remoteJid = message.key.remoteJid || undefined
				if (
					remoteJid &&
					(isJidGroup(remoteJid) || isJidStatusBroadcast(remoteJid))
				) {
					continue
				}

				const normalizedContent = normalizeMessageContent(message.message)
				const contentType = getContentType(normalizedContent)
				if (!contentType) continue

				const senderJid =
					normalizeWhatsappJid(message.key.participant) ||
					normalizeWhatsappJid(message.key.remoteJid)
				const senderWaId =
					getWaIdFromJid(senderJid) ||
					getWaIdFromJid(message.key.participant) ||
					getWaIdFromJid(message.key.remoteJid)
				if (!senderWaId) continue

				const normalized = await this.normalizeInboundMessage({
					channelKey: entry.providerChannelKey,
					channelId: entry.channelId,
					socket,
					message,
					contentType,
					normalizedContent: normalizedContent as Record<string, any>,
					senderWaId,
					senderJid,
				})
				if (!normalized) continue

				await postWebhookToCrm(entry, normalized)
			} catch (error) {
				console.error('[BaileysService] Failed processing inbound message', error)
			}
		}
	}

	private static async normalizeInboundMessage(params: {
		channelKey: string
		channelId: string
		socket: WASocket
		message: WAMessage
		contentType: string
		normalizedContent: Record<string, any>
		senderWaId: string
		senderJid?: string | null
	}) {
		const { message, contentType, normalizedContent } = params
		const externalMessageId = String(message.key.id || '').trim()
		if (!externalMessageId) return null
		const messageTimestamp = getMessageTimestamp(message.messageTimestamp)
		const pushName = asString(message.pushName) || params.senderWaId
		let type: 'text' | 'image' | 'video' | 'audio' | 'document' = 'text'
		let text = ''
		let mediaUrl: string | null = null
		let mimeType: string | null = null
		let fileName: string | null = null
		let replyToExternalId: string | null = null

		if (contentType === 'conversation') {
			text = asString(normalizedContent.conversation) || ''
		} else if (contentType === 'extendedTextMessage') {
			type = 'text'
			text = asString(normalizedContent.extendedTextMessage?.text) || ''
			replyToExternalId =
				asString(normalizedContent.extendedTextMessage?.contextInfo?.stanzaId) ||
				null
		} else if (contentType === 'imageMessage') {
			type = 'image'
			text = asString(normalizedContent.imageMessage?.caption) || ''
			mimeType = asString(normalizedContent.imageMessage?.mimetype)
			replyToExternalId =
				asString(normalizedContent.imageMessage?.contextInfo?.stanzaId) || null
			mediaUrl = await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: null,
			})
		} else if (contentType === 'videoMessage') {
			type = 'video'
			text = asString(normalizedContent.videoMessage?.caption) || ''
			mimeType = asString(normalizedContent.videoMessage?.mimetype)
			replyToExternalId =
				asString(normalizedContent.videoMessage?.contextInfo?.stanzaId) || null
			mediaUrl = await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: null,
			})
		} else if (contentType === 'audioMessage') {
			type = 'audio'
			text = ''
			mimeType = asString(normalizedContent.audioMessage?.mimetype)
			replyToExternalId =
				asString(normalizedContent.audioMessage?.contextInfo?.stanzaId) || null
			mediaUrl = await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: null,
			})
		} else if (contentType === 'documentMessage') {
			type = 'document'
			text = asString(normalizedContent.documentMessage?.caption) || ''
			mimeType = asString(normalizedContent.documentMessage?.mimetype)
			fileName = asString(normalizedContent.documentMessage?.fileName)
			replyToExternalId =
				asString(normalizedContent.documentMessage?.contextInfo?.stanzaId) || null
			mediaUrl = await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName,
			})
		} else {
			return null
		}

		const payload: Record<string, unknown> = {
			event: 'message.received',
			channelKey: params.channelKey,
			timestamp: messageTimestamp,
			message: {
				id: externalMessageId,
				from: params.senderWaId,
				...(params.senderJid ? { fromJid: params.senderJid } : {}),
				type,
				text,
				timestamp: messageTimestamp,
			},
			contact: {
				waId: params.senderWaId,
				...(params.senderJid ? { waJid: params.senderJid } : {}),
				name: pushName,
			},
		}

		if (replyToExternalId) {
			;(payload.message as Record<string, unknown>).replyToExternalId =
				replyToExternalId
		}
		if (mediaUrl) {
			;(payload.message as Record<string, unknown>).mediaUrl = mediaUrl
		}
		if (mimeType) {
			;(payload.message as Record<string, unknown>).mimeType = mimeType
		}
		if (fileName) {
			;(payload.message as Record<string, unknown>).fileName = fileName
		}

		return payload
	}

	private static async resolveInboundMediaUrl(params: {
		channelId: string
		externalMessageId: string
		socket: WASocket
		message: WAMessage
		mimeType: string | null
		fileName: string | null
	}) {
		try {
			const buffer = await downloadMediaMessage(
				params.message,
				'buffer',
				{},
				{
					logger: baileysLogger as any,
					reuploadRequest: params.socket.updateMediaMessage,
				},
			)

			return uploadInboundMedia({
				channelId: params.channelId,
				messageId: params.externalMessageId,
				buffer,
				mimeType: params.mimeType,
				fileName: params.fileName,
			})
		} catch (error) {
			console.error('[BaileysService] Failed to download inbound media', error)
			return null
		}
	}

	private static async handleMessageStatusUpdates(
		entry: RuntimeEntry,
		updates: WAMessageUpdate[],
	) {
		for (const update of updates) {
			try {
				if (!update?.key?.id || !update.key.fromMe) continue
				const status = mapBaileysStatus(update.update.status ?? null)
				if (!status) continue

				await postWebhookToCrm(entry, {
					event: 'message.status',
					channelKey: entry.providerChannelKey,
					status: {
						externalId: update.key.id,
						status,
						timestamp: Date.now(),
					},
				})
			} catch (error) {
				console.error('[BaileysService] Failed processing message status', error)
			}
		}
	}

	private static async waitForReadyState(channelId: string, timeoutMs: number) {
		const startedAt = Date.now()
		while (Date.now() - startedAt <= timeoutMs) {
			const snapshot = await this.getSessionSnapshot(channelId)
			if (
				!['pending', 'connecting', 'reconnecting', 'restarting'].includes(
					snapshot.status,
				)
			) {
				return snapshot
			}
			await Bun.sleep(300)
		}
		return this.getSessionSnapshot(channelId)
	}

	private static scheduleRestart(channelId: string, delayMs: number) {
		const entry = runtimeEntries.get(channelId)
		if (!entry) return
		this.clearRestartTimer(entry)
		entry.restartTimer = setTimeout(() => {
			entry.restartTimer = null
			void this.ensureChannel(channelId, { forceRestart: true }).catch((error) => {
				console.error('[BaileysService] Failed to restart channel', error)
			})
		}, delayMs)
	}

	private static clearRestartTimer(entry: RuntimeEntry) {
		if (!entry.restartTimer) return
		clearTimeout(entry.restartTimer)
		entry.restartTimer = null
	}

	static async shutdown() {
		if (this.syncTimer) {
			clearInterval(this.syncTimer)
			this.syncTimer = null
		}

		await Promise.allSettled(
			Array.from(runtimeEntries.values()).map(async (entry) => {
				entry.desiredRunning = false
				this.clearRestartTimer(entry)
				const currentSocket = entry.socket
				entry.socket = null
				if (currentSocket) currentSocket.end(undefined)
			}),
		)
	}
}
