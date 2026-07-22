import { PutObjectCommand } from '@aws-sdk/client-s3'
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'
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


import { SocksProxyAgent } from 'socks-proxy-agent'
import {
	BAILEYS_CHANNEL_SYNC_INTERVAL_MS,
	BAILEYS_LINK_MODE,
	BAILEYS_SOCKS_PROXY,
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
	first_connected_at: Date | string | null
	last_seen_at: Date | string | null
	metadata: unknown
	created_at: Date | string | null
	updated_at: Date | string | null
}

type PersistedAuthEnvelope = {
	creds?: unknown
	keys?: Record<string, Record<string, unknown | null>>
}

type EncryptedAuthEnvelope = { encrypted: true; iv: string; tag: string; data: string }

function authEncryptionKey() {
	const secret = String(process.env.BAILEYS_AUTH_ENCRYPTION_KEY || '').trim()
	if (!secret) {
		if (process.env.NODE_ENV === 'production') {
			throw new Error('BAILEYS_AUTH_ENCRYPTION_KEY is required in production')
		}
		return null
	}
	return createHash('sha256').update(secret).digest()
}

function encryptAuthState(value: unknown): unknown {
	const key = authEncryptionKey()
	if (!key) return serializeBufferJson(value)
	const iv = randomBytes(12)
	const cipher = createCipheriv('aes-256-gcm', key, iv)
	const plaintext = Buffer.from(JSON.stringify(value, BufferJSON.replacer), 'utf8')
	const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
	return { encrypted: true, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: encrypted.toString('base64') } satisfies EncryptedAuthEnvelope
}

function decryptAuthState<T>(value: unknown): T {
	const record = asRecord(value)
	if (record.encrypted !== true) return deserializeBufferJson<T>(value)
	const key = authEncryptionKey()
	if (!key) throw new Error('Encrypted Baileys session cannot be read without BAILEYS_AUTH_ENCRYPTION_KEY')
	const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(String(record.iv), 'base64'))
	decipher.setAuthTag(Buffer.from(String(record.tag), 'base64'))
	const plaintext = Buffer.concat([decipher.update(Buffer.from(String(record.data), 'base64')), decipher.final()]).toString('utf8')
	return JSON.parse(plaintext, BufferJSON.reviver) as T
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
	lastHistoryProgress: number
	restartAttempts: number
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
const messageContentCache = new Map<string, proto.IMessage>()
const unresolvedIdentityCounts = new Map<string, number>()
const HISTORY_PROGRESS_STEP = Math.max(
	1,
	Math.min(100, Number(process.env.WHATSAPP_SYNC_PROGRESS_STEP || 10)),
)
const BASE_RESTART_DELAY_MS = 30_000
const MAX_RESTART_DELAY_MS = 60_000
const MAX_RESTART_ATTEMPTS = 10

function reportHistoryProgress(
	entry: RuntimeEntry,
	progress: unknown,
	messageCount: number,
	isLatest: boolean,
) {
	const numericProgress = Number(progress)
	const percentage = Number.isFinite(numericProgress)
		? Math.max(0, Math.min(100, Math.round(numericProgress)))
		: isLatest
			? 100
			: null
	if (percentage === null) return

	if (percentage < entry.lastHistoryProgress) entry.lastHistoryProgress = -1
	const bucket = isLatest
		? 100
		: Math.floor(percentage / HISTORY_PROGRESS_STEP) * HISTORY_PROGRESS_STEP
	if (bucket <= entry.lastHistoryProgress) return

	entry.lastHistoryProgress = bucket
	console.log(
		`[WhatsApp Sync] ${bucket}%${messageCount > 0 ? ` · ${messageCount} pesan pada batch ini` : ''}${isLatest ? ' · selesai' : ''}`,
	)
}

function rememberMessage(message: WAMessage) {
	const id = String(message.key?.id || '').trim()
	if (!id || !message.message) return
	messageContentCache.set(id, message.message)
	if (messageContentCache.size > 2_000) {
		const oldest = messageContentCache.keys().next().value
		if (oldest) messageContentCache.delete(oldest)
	}
}

const baileysLogger = {
	level: 'warn',
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

function sleep(ms: number) {
	return new Promise((resolve) => setTimeout(resolve, ms))
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
		lastHistoryProgress: -1,
		restartAttempts: 0,
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
				AND EXISTS (
					SELECT 1
					FROM public.baileys_sessions session
					WHERE session.channel_id = whatsapp_channels.id
						AND (
							session.first_connected_at IS NOT NULL
							OR session.status = 'connected'
						)
				)
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
	const restored = decryptAuthState<PersistedAuthEnvelope>(
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
			auth_state: encryptAuthState(persisted),
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

		// Keep a session that was explicitly started by a user alive while it is
		// waiting for pairing. It is intentionally excluded from the bootstrap
		// query above so an unpaired channel never starts by itself after restart.
		for (const [channelId, entry] of runtimeEntries) {
			if (entry.desiredRunning) activeIds.add(channelId)
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
		options?: {
			forceRestart?: boolean
			waitForReadyMs?: number
			allowUnpaired?: boolean
		},
	) {
		await ensureBaileysSessionStorage()

		const channel = await getChannelById(channelId)
		if (!channel) throw new Error('Baileys channel not found')

		return this.ensureLoadedChannel(channel, options)
	}

	private static async ensureLoadedChannel(
		channel: BaileysChannelRecord,
		options?: {
			forceRestart?: boolean
			waitForReadyMs?: number
			allowUnpaired?: boolean
		},
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
		const session = await getSessionByChannelId(channel.id)
		const hasConnectedBefore = Boolean(
			session?.first_connected_at || session?.status === 'connected',
		)

		if (!hasConnectedBefore && !options?.allowUnpaired) {
			return this.getSessionSnapshot(channel.id)
		}

		if (!entry.desiredRunning && !options?.forceRestart) {
			return this.getSessionSnapshot(channel.id)
		}

		if (!entry.desiredRunning) {
			entry.desiredRunning = true
			entry.restartAttempts = 0
		}

		if (options?.forceRestart) {
			this.clearRestartTimer(entry)
			const currentSocket = entry.socket
			entry.socket = null
			entry.pairingCodeRequested = false
			entry.restartAttempts = 0
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
		entry.restartAttempts = 0
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
		const quote = asRecord(payload.quote)
		const quotedExternalId = asString(quote.externalId)
		const quoted = quotedExternalId ? {
			key: {
				remoteJid: recipientJid,
				id: quotedExternalId,
				fromMe: quote.fromMe === true,
			},
			message: {
				extendedTextMessage: {
					text: asString(quote.content) || `[${asString(quote.contentType) || 'pesan'}]`,
				},
			},
			messageTimestamp: Number(quote.timestamp || Math.floor(Date.now() / 1000)),
		} as WAMessage : undefined
		const sent = await entry.socket.sendMessage(
			recipientJid,
			messageBody as any,
			quoted ? { quoted } : undefined,
		)
		if (sent) rememberMessage(sent)

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

	static async markMessagesRead(payload: Record<string, unknown>) {
		const channelKey = asString(payload.channelKey) || asString(payload.channel_key)
		if (!channelKey) throw new Error('channelKey is required')
		const channel = await getChannelByProviderKey(channelKey)
		if (!channel?.id) throw new Error(`Baileys channel ${channelKey} not found`)
		const session = await this.ensureChannel(channel.id, { waitForReadyMs: 8_000 })
		if (session.status !== 'connected') throw new Error(`Baileys session is ${session.status}`)
		const socket = runtimeEntries.get(channel.id)?.socket
		if (!socket) throw new Error('Baileys runtime socket is not available')
		const recipient = normalizeDigits(asString(payload.recipientWhatsAppId) || asString(payload.to))
		const remoteJid = buildWhatsappJid(recipient, 'pn')
		const messageIds = Array.isArray(payload.messageIds)
			? payload.messageIds.map((id) => String(id || '').trim()).filter(Boolean).slice(0, 100)
			: []
		if (!remoteJid || !messageIds.length) return { read: 0 }
		await socket.readMessages(messageIds.map((id) => ({ remoteJid, id, fromMe: false })))
		return { read: messageIds.length }
	}

	static async sendPresence(payload: Record<string, unknown>) {
		const channelKey = asString(payload.channelKey) || asString(payload.channel_key)
		if (!channelKey) throw new Error('channelKey is required')
		const channel = await getChannelByProviderKey(channelKey)
		if (!channel?.id) throw new Error(`Baileys channel ${channelKey} not found`)
		const session = await this.ensureChannel(channel.id, { waitForReadyMs: 5_000 })
		if (session.status !== 'connected') return { sent: false }
		const socket = runtimeEntries.get(channel.id)?.socket
		if (!socket) return { sent: false }
		const remoteJid = buildWhatsappJid(normalizeDigits(asString(payload.recipientWhatsAppId) || asString(payload.to)), 'pn')
		const allowed = new Set(['available', 'unavailable', 'composing', 'recording', 'paused'])
		const presence = String(payload.presence || 'paused')
		if (!remoteJid || !allowed.has(presence)) return { sent: false }
		await socket.sendPresenceUpdate(presence as 'available' | 'unavailable' | 'composing' | 'recording' | 'paused', remoteJid)
		return { sent: true }
	}

	static async updateBlockStatus(payload: Record<string, unknown>) {
		const channelKey = asString(payload.channelKey) || asString(payload.channel_key)
		if (!channelKey) throw new Error('channelKey is required')
		const channel = await getChannelByProviderKey(channelKey)
		if (!channel?.id) throw new Error(`Baileys channel ${channelKey} not found`)
		const session = await this.ensureChannel(channel.id, { waitForReadyMs: 8_000 })
		if (session.status !== 'connected') throw new Error(`Baileys session is ${session.status}`)
		const socket = runtimeEntries.get(channel.id)?.socket
		if (!socket) throw new Error('Baileys runtime socket is not available')
		const remoteJid = buildWhatsappJid(normalizeDigits(asString(payload.phoneNumber) || asString(payload.to)), 'pn')
		const action = String(payload.action || '').toLowerCase()
		if (!remoteJid) throw new Error('phoneNumber is required')
		if (action !== 'block' && action !== 'unblock') throw new Error('action must be block or unblock')
		await socket.updateBlockStatus(remoteJid, action)
		return { updated: true, action }
	}

	static async getProfilePicture(payload: Record<string, unknown>) {
		const channelKey = asString(payload.channelKey) || asString(payload.channel_key)
		if (!channelKey) throw new Error('channelKey is required')
		const channel = await getChannelByProviderKey(channelKey)
		if (!channel?.id) throw new Error(`Baileys channel ${channelKey} not found`)
		const session = await this.ensureChannel(channel.id, { waitForReadyMs: 8_000 })
		if (session.status !== 'connected') throw new Error(`Baileys session is ${session.status}`)
		const socket = runtimeEntries.get(channel.id)?.socket
		if (!socket) throw new Error('Baileys runtime socket is not available')
		const jid = buildWhatsappJid(normalizeDigits(asString(payload.phoneNumber) || asString(payload.to)), 'pn')
		if (!jid) throw new Error('phoneNumber is required')
		try {
			const url = await socket.profilePictureUrl(jid, 'image', 10_000)
			return { url: url || null, available: Boolean(url) }
		} catch {
			return { url: null, available: false }
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
				gifPlayback: payload.gifPlayback === true,
			}
		}

		if (type === 'audio') {
			const url = asString(mediaRecord.url)
			if (!url) throw new Error('Baileys outbound audio url is required')
			const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
			if (!response.ok) {
				throw new Error(`Failed fetching outbound audio (${response.status})`)
			}
			const declaredSize = Number(response.headers.get('content-length') || 0)
			if (declaredSize > 32 * 1024 * 1024) {
				throw new Error('Baileys outbound audio exceeds 32 MB')
			}
			const audio = Buffer.from(await response.arrayBuffer())
			if (!audio.length) throw new Error('Baileys outbound audio is empty')
			if (audio.length > 32 * 1024 * 1024) {
				throw new Error('Baileys outbound audio exceeds 32 MB')
			}
			return {
				audio,
				...(asString(mediaRecord.mimeType)
					? { mimetype: asString(mediaRecord.mimeType) }
					: {}),
				ptt: payload.ptt === true,
			}
		}

		if (type === 'sticker') {
			const url = asString(mediaRecord.url)
			if (!url) throw new Error('Baileys outbound sticker url is required')
			return {
				sticker: { url },
				isAnimated: payload.isAnimated === true,
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

		const agent = BAILEYS_SOCKS_PROXY ? new SocksProxyAgent(BAILEYS_SOCKS_PROXY) : undefined
		console.info('[BaileysService] Opening socket', {
			channelId: channel.id,
			transport: agent ? 'socks5' : 'direct',
		})
		const socket = makeWASocket({
			auth: {
				creds: auth.state.creds,
				keys: makeCacheableSignalKeyStore(auth.state.keys, baileysLogger as any),
			},
			logger: baileysLogger as any,
			browser: Browsers.windows('Chrome'),
			printQRInTerminal: false,
			markOnlineOnConnect: false,
			agent,
			getMessage: async () => undefined,
		})

		entry.socket = socket
		entry.desiredRunning = true
		entry.pairingCodeRequested = false

		void auth.saveCreds().catch((error) => {
			console.error('[BaileysService] Failed to persist initial auth creds', error)
		})

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
			void this.handleMessagesUpsert(entry, socket, messages, true)
		})

		socket.ev.on('messaging-history.set', ({ messages, lidPnMappings, progress, isLatest }: any) => {
			reportHistoryProgress(entry, progress, messages.length, isLatest === true)
			void (async () => {
				if (lidPnMappings?.length) {
					await socket.signalRepository.lidMapping.storeLIDPNMappings(lidPnMappings)
				}
				await this.handleMessagesUpsert(entry, socket, messages, false)
			})().catch((error) => {
				console.error('[BaileysService] Failed processing history batch', error)
			})
		})

		socket.ev.on('messages.update', (updates) => {
			void this.handleMessageStatusUpdates(entry, updates)
		})

		socket.ev.on('messages.delete', (event) => {
			if (!('keys' in event) || !event.keys.length) return
			const externalIds = event.keys.map((key) => String(key.id || '').trim()).filter(Boolean)
			if (!externalIds.length) return
			void postWebhookToCrm(entry, {
				event: 'message.deleted',
				channelKey: entry.providerChannelKey,
				externalIds,
				timestamp: Date.now(),
			}).catch((error) => console.warn('[BaileysService] Message delete event failed', error))
		})

		socket.ev.on('presence.update', ({ id, presences }) => {
			void (async () => {
				const candidates = [id, ...Object.keys(presences || {})].map(normalizeWhatsappJid).filter((jid): jid is string => Boolean(jid))
				let phoneJid = candidates.find((jid) => jid.endsWith('@s.whatsapp.net')) || null
				if (!phoneJid) {
					const lid = candidates.find((jid) => jid.endsWith('@lid'))
					if (lid) phoneJid = await socket.signalRepository.lidMapping.getPNForLID(lid)
				}
				const phone = getWaIdFromJid(phoneJid)
				const presence = Object.values(presences || {})[0]?.lastKnownPresence
				if (!phone || !presence) return
				await postWebhookToCrm(entry, { event: 'presence.update', channelKey: entry.providerChannelKey, phone, presence, timestamp: Date.now() })
			})().catch((error) => console.warn('[BaileysService] Presence update failed', error))
		})

		socket.ev.on('contacts.update', (contacts) => {
			for (const contact of contacts) {
				if (contact.imgUrl !== 'changed') continue
				void (async () => {
					let jid = normalizeWhatsappJid(contact.phoneNumber || contact.id)
					if (jid?.endsWith('@lid')) jid = await socket.signalRepository.lidMapping.getPNForLID(jid)
					const phone = getWaIdFromJid(jid)
					if (!phone) return
					await postWebhookToCrm(entry, { event: 'contact.profile_changed', channelKey: entry.providerChannelKey, phone, timestamp: Date.now() })
				})().catch((error) => console.warn('[BaileysService] Contact profile event failed', error))
			}
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
			isNewLogin: boolean
		}>
	}) {
		const { channel, entry, socket, update } = params
		const sessionRow = await getSessionByChannelId(channel.id)
		if (!sessionRow?.id) return

		if (update.isNewLogin) {
			console.info('[BaileysService] Pairing accepted', {
				channelId: channel.id,
			})
			await updateSessionById(sessionRow.id, {
				status: 'restarting',
				pairing_code: null,
				qr_code: null,
				last_error: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
		}

		if (update.qr) {
			await updateSessionById(sessionRow.id, {
				status: 'qr_ready',
				qr_code: update.qr,
				last_error: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
		}

		if (update.connection === 'open') {
			entry.pairingCodeRequested = false
			entry.restartAttempts = 0
			const connectedPhoneNumber = normalizeDigits(socket.user?.id?.split('@')[0]) || null
			await updateSessionById(sessionRow.id, {
				status: 'connected',
				pairing_code: null,
				qr_code: null,
				last_error: null,
				last_connected_at: new Date(),
				first_connected_at: sessionRow.first_connected_at || new Date(),
				phone_number: connectedPhoneNumber || sessionRow.phone_number,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
			if (connectedPhoneNumber) {
				await execute(
					`UPDATE public.whatsapp_channels
					 SET phone_number = $2::text, display_phone_number = $2::text, updated_at = now()
					 WHERE id = $1`,
					[channel.id, connectedPhoneNumber],
				)
			}
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
			this.scheduleRestart(entry.channelId, 1_000)
			return
		}

		if (disconnectCode === DisconnectReason.loggedOut) {
			// Rate-limited / blocked by WhatsApp — stop auto-retry
			await updateSessionById(sessionRow.id, {
				status: 'rate_limited',
				auth_state: null,
				first_connected_at: null,
				phone_number: null,
				pairing_code: null,
				qr_code: null,
				last_error: 'WhatsApp menolak koneksi, coba lagi nanti atau pakai proxy',
				updated_at: new Date(),
			})
			entry.desiredRunning = false
			entry.socket = null
			return
		}

		if (disconnectCode === DisconnectReason.badSession) {
			// Bad session means stored auth_state is stale/invalid (e.g. phone
			// number changed, WhatsApp Web session expired, creds corrupted).
			// Clear auth_state so buildAuthState() generates fresh credentials
			// on next start, which will show a QR code for re-pairing.
			await updateSessionById(sessionRow.id, {
				status: 'not_paired',
				auth_state: null,
				pairing_code: null,
				qr_code: null,
				last_error: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
			entry.desiredRunning = false
			return
		}

		// A never-paired channel must wait for an explicit start request. In
		// particular, do not restart it after the QR window expires (408), or the
		// service will keep generating QR codes for users who never need WhatsApp.
		if (disconnectCode === 408 && !sessionRow.first_connected_at) {
			await updateSessionById(sessionRow.id, {
				status: 'not_paired',
				last_error: formattedDisconnectMessage,
				pairing_code: null,
				qr_code: null,
				last_seen_at: new Date(),
				updated_at: new Date(),
			})
			entry.desiredRunning = false
			entry.restartAttempts = 0
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
			this.scheduleRestart(entry.channelId)
		}
	}

	private static async handleMessagesUpsert(
		entry: RuntimeEntry,
		socket: WASocket,
		messages: WAMessage[],
		downloadMedia: boolean,
	) {
		for (const message of messages) {
			try {
				if (!message.message || !message.key?.id) continue
				rememberMessage(message)
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

				const key = message.key as typeof message.key & { remoteJidAlt?: string; participantAlt?: string }
				const candidates = [key.participantAlt, key.remoteJidAlt, key.participant, key.remoteJid]
					.map(normalizeWhatsappJid)
					.filter((value): value is string => Boolean(value))
				let senderJid = candidates.find((value) => value.endsWith('@s.whatsapp.net')) || null
				if (!senderJid) {
					const lidJid = candidates.find((value) => value.endsWith('@lid'))
					if (lidJid) {
						senderJid = await socket.signalRepository.lidMapping.getPNForLID(lidJid)
					}
				}
				if (!senderJid) {
					const unresolvedCount = (unresolvedIdentityCounts.get(entry.channelId) || 0) + 1
					unresolvedIdentityCounts.set(entry.channelId, unresolvedCount)
					if (unresolvedCount === 1 || unresolvedCount % 100 === 0) {
						console.warn('[BaileysService] Holding messages until phone-number identities are available', { channelId: entry.channelId, heldMessages: unresolvedCount })
					}
					continue
				}
				const senderWaId =
					getWaIdFromJid(senderJid)
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
					downloadMedia,
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
		downloadMedia: boolean
	}) {
		const { message, contentType, normalizedContent } = params
		const externalMessageId = String(message.key.id || '').trim()
		if (!externalMessageId) return null
		const messageTimestamp = getMessageTimestamp(message.messageTimestamp)
		const pushName = asString(message.pushName) || params.senderWaId
		let type: 'text' | 'image' | 'video' | 'gif' | 'audio' | 'voice' | 'document' | 'sticker' | 'reaction' = 'text'
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
			mediaUrl = params.downloadMedia ? await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: null,
			}) : null
		} else if (contentType === 'videoMessage') {
			type = normalizedContent.videoMessage?.gifPlayback === true ? 'gif' : 'video'
			text = asString(normalizedContent.videoMessage?.caption) || ''
			mimeType = asString(normalizedContent.videoMessage?.mimetype)
			replyToExternalId =
				asString(normalizedContent.videoMessage?.contextInfo?.stanzaId) || null
			mediaUrl = params.downloadMedia ? await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: null,
			}) : null
		} else if (contentType === 'audioMessage') {
			type = normalizedContent.audioMessage?.ptt === true ? 'voice' : 'audio'
			text = ''
			mimeType = asString(normalizedContent.audioMessage?.mimetype)
			replyToExternalId =
				asString(normalizedContent.audioMessage?.contextInfo?.stanzaId) || null
			mediaUrl = params.downloadMedia ? await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: null,
			}) : null
		} else if (contentType === 'documentMessage') {
			type = 'document'
			text = asString(normalizedContent.documentMessage?.caption) || ''
			mimeType = asString(normalizedContent.documentMessage?.mimetype)
			fileName = asString(normalizedContent.documentMessage?.fileName)
			replyToExternalId =
				asString(normalizedContent.documentMessage?.contextInfo?.stanzaId) || null
			mediaUrl = params.downloadMedia ? await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName,
			}) : null
		} else if (contentType === 'stickerMessage') {
			type = 'sticker'
			text = '[STICKER]'
			mimeType = asString(normalizedContent.stickerMessage?.mimetype) || 'image/webp'
			mediaUrl = params.downloadMedia ? await this.resolveInboundMediaUrl({
				channelId: params.channelId,
				externalMessageId,
				socket: params.socket,
				message,
				mimeType,
				fileName: `${externalMessageId}.webp`,
			}) : null
		} else if (contentType === 'reactionMessage') {
			type = 'reaction'
			text = asString(normalizedContent.reactionMessage?.text) || ''
			replyToExternalId = asString(normalizedContent.reactionMessage?.key?.id)
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
				type,
				text,
				timestamp: messageTimestamp,
			},
			contact: {
				waId: params.senderWaId,
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
			await sleep(300)
		}
		return this.getSessionSnapshot(channelId)
	}

	private static scheduleRestart(channelId: string, fallbackDelayMs?: number) {
		const entry = runtimeEntries.get(channelId)
		if (!entry) return
		this.clearRestartTimer(entry)

		entry.restartAttempts += 1

		if (entry.restartAttempts > MAX_RESTART_ATTEMPTS) {
			console.error('[BaileysService] Max restart attempts reached, giving up', {
				channelId,
				attempts: entry.restartAttempts,
			})
			entry.desiredRunning = false
			entry.socket = null
			void updateSessionByChannelId(channelId, {
				status: 'error',
				last_error: `Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached`,
				pairing_code: null,
				qr_code: null,
				updated_at: new Date(),
			})
			return
		}

		const baseDelayMs = fallbackDelayMs && fallbackDelayMs > 0
			? fallbackDelayMs
			: BASE_RESTART_DELAY_MS
		const delayMs = Math.min(
			baseDelayMs * Math.pow(2, entry.restartAttempts - 1),
			MAX_RESTART_DELAY_MS,
		)

		console.warn('[BaileysService] Scheduling restart', {
			channelId,
			attempt: entry.restartAttempts,
			delayMs,
		})

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
