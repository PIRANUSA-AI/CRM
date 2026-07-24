import { type Job, Worker } from 'bullmq'
import { sendInstagramMessage, sendWhatsAppMessage } from '../lib/meta-api'
import { sendTikTokMessage } from '../lib/tiktok-api'
import prisma from '../lib/prisma'
import { emitRealtimeToRoom } from '../lib/realtime-emitter'
import { BAILEYS_INTERNAL_SEND_PATH } from '../modules/whatsapp/webhook-config'
import { getBaileysServiceSendUrl } from '../modules/whatsapp/baileys-service-client'
import {
	maintenanceQueue,
	outboundMessageQueue,
	webhookQueue,
} from '../lib/queue'
import { redis } from '../lib/redis'
import { ChatbotFollowupService } from '../modules/chatbot/followup-service'
import { AIResponseLogService } from '../modules/chatbot/response-log-service'
import { InstagramService } from '../modules/instagram/service'
import { BusinessWebhookDispatchService } from '../modules/business-webhooks/dispatch-service'
import { KnowledgeIndexService } from '../modules/knowledge/indexing-service'
import { generateAndStorePersonaSuggestion } from '../modules/sales-profiles/ai-suggest'
import { WebhookService } from '../modules/webhook/service'
import { PersonalAiReplyService } from '../modules/personal-whatsapp-inbox/ai-reply'
import { NotificationService } from '../modules/notifications/service'
import { startWhatsappProfileSyncWorker } from '../modules/personal-whatsapp-inbox/profile-sync'
import {
	processTaskAnalysisJob,
	TASK_ANALYSIS_CONCURRENCY,
} from '../modules/tasks/worker'
import {
	ConversationBulkEditService,
	type ConversationBulkEditJobData,
} from '../modules/conversation/bulk-service'
import {
	resolveBroadcastAudience,
	type BroadcastAudienceRecipient,
} from '../modules/broadcast/service'

const APP_MODE = (process.env.APP_MODE || 'api').toLowerCase()
// WORKER_MODE_ENABLED: this process runs background tasks at all (worker or
// scheduler) - gates one-off startup replay scans and job registration.
const WORKER_MODE_ENABLED = APP_MODE === 'worker' || APP_MODE === 'scheduler'
const SCHEDULER_MODE_ENABLED = APP_MODE === 'scheduler'
// RUN_WORKERS: this process actually consumes queues. Only 'worker' does -
// 'scheduler' only registers repeatable jobs and does startup catch-up scans,
// it must not also run a full duplicate set of BullMQ Workers.
const RUN_WORKERS = APP_MODE === 'worker'
const WORKER_VERBOSE_LOGS = process.env.WORKER_VERBOSE_LOGS === 'true'

function workerDebug(message: string) {
	if (WORKER_VERBOSE_LOGS) console.log(message)
}

const WEBHOOK_MAX_RETRIES = Math.max(
	1,
	Number(process.env.WEBHOOK_MAX_RETRIES || 10),
)
const WEBHOOK_RETRY_COOLDOWN_MS = Math.max(
	15_000,
	Number(process.env.WEBHOOK_RETRY_COOLDOWN_MS || 60_000),
)
const WEBHOOK_REPLAY_WINDOW_HOURS = Math.max(
	1,
	Number(process.env.WEBHOOK_REPLAY_WINDOW_HOURS || 24),
)
const WEBHOOK_REPLAY_JOB_ATTEMPTS = Math.max(
	1,
	Number(process.env.WEBHOOK_REPLAY_JOB_ATTEMPTS || 3),
)
const WEBHOOK_REPLAY_JOB_BACKOFF_MS = Math.max(
	1_000,
	Number(process.env.WEBHOOK_REPLAY_JOB_BACKOFF_MS || 2_000),
)
const CHATBOT_FOLLOWUP_DISPATCH_BATCH_LIMIT = Math.max(
	1,
	Math.min(
		500,
		Number(process.env.CHATBOT_FOLLOWUP_DISPATCH_BATCH_LIMIT || 100),
	),
)
const WHATSAPP_MEDIA_URL_VALIDATION_TIMEOUT_MS = Math.max(
	1_500,
	Math.min(
		20_000,
		Number(process.env.WHATSAPP_MEDIA_URL_VALIDATION_TIMEOUT_MS || 7_000),
	),
)
const WHATSAPP_MEDIA_TRUSTED_HOSTS = new Set(
	String(process.env.WHATSAPP_MEDIA_TRUSTED_HOSTS || 'files.cekat.ai')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter((value) => value.length > 0),
)
const OUTBOUND_CONVERSATION_LOCK_TTL_MS = Math.max(
	30_000,
	Number(process.env.OUTBOUND_CONVERSATION_LOCK_TTL_MS || 120_000),
)
const OUTBOUND_CONVERSATION_LOCK_WAIT_MS = Math.max(
	1_000,
	Number(process.env.OUTBOUND_CONVERSATION_LOCK_WAIT_MS || 15_000),
)
const OUTBOUND_CONVERSATION_LOCK_POLL_MS = Math.max(
	100,
	Math.min(
		2_000,
		Number(process.env.OUTBOUND_CONVERSATION_LOCK_POLL_MS || 200),
	),
)
const OUTBOUND_CONVERSATION_LOCK_RENEW_MS = Math.max(
	1_000,
	Math.min(
		30_000,
		Number(process.env.OUTBOUND_CONVERSATION_LOCK_RENEW_MS || 10_000),
	),
)
const OUTBOUND_DEFER_DELAY_MS = Math.max(
	300,
	Math.min(10_000, Number(process.env.OUTBOUND_DEFER_DELAY_MS || 750)),
)

function asRecord(value: unknown): Record<string, any> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, any>
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function resolveSelectedBroadcastInboxId(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeRecipientPhone(
	value: string | null | undefined,
): string | null {
	if (!value || typeof value !== 'string') return null
	const normalized = value.replace(/[^\d]/g, '')
	return normalized.length >= 8 ? normalized : null
}

function normalizeWhatsappJid(value: string | null | undefined): string | null {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized) return null
	const match = normalized.match(
		/^([0-9]+)(?::[0-9]+)?@(s\.whatsapp\.net|lid)$/,
	)
	if (!match?.[1] || !match?.[2]) return null
	return `${match[1]}@${match[2]}`
}

function resolveWhatsappAddressingMode(
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
): string | null {
	const normalizedRecipient = normalizeRecipientPhone(recipientWaId)
	if (!normalizedRecipient) return null
	return `${normalizedRecipient}@${
		addressingMode === 'lid' ? 'lid' : 's.whatsapp.net'
	}`
}

function extractStoredWhatsappJid(
	additionalAttributes: Record<string, any>,
): string | null {
	return (
		normalizeWhatsappJid(
			asString(additionalAttributes.whatsapp_jid) ||
				asString(additionalAttributes.whatsappJid) ||
				asString(additionalAttributes.wa_jid) ||
				asString(additionalAttributes.waJid),
		) || null
	)
}

async function lookupBaileysSessionRecipientJid(params: {
	channelId: string
	recipientWaId: string
}) {
	const lidJid = buildWhatsappJid(params.recipientWaId, 'lid')
	const pnJid = buildWhatsappJid(params.recipientWaId, 'pn')
	if (!lidJid && !pnJid) return null

	const [match] = await prisma.$queryRaw<
		Array<{ recipient_jid: string | null }>
	>`
		SELECT
			CASE
				WHEN ${lidJid} IS NOT NULL AND auth_state::text LIKE ${`%${lidJid}%`} THEN ${lidJid}
				WHEN ${pnJid} IS NOT NULL AND auth_state::text LIKE ${`%${pnJid}%`} THEN ${pnJid}
				ELSE NULL
			END AS recipient_jid
		FROM baileys_sessions
		WHERE channel_id = ${params.channelId}
		LIMIT 1
	`

	return normalizeWhatsappJid(match?.recipient_jid || null)
}

async function resolveBaileysRecipient(params: {
	channelId: string
	contact: {
		id: string
		phone_number: string | null
		whatsapp_id: string | null
		additional_attributes?: unknown
	}
}) {
	const additionalAttributes = asRecord(params.contact.additional_attributes)
	const storedJid =
		extractStoredWhatsappJid(additionalAttributes) ||
		normalizeWhatsappJid(params.contact.phone_number) ||
		normalizeWhatsappJid(params.contact.whatsapp_id)
	if (storedJid) {
		return {
			recipientWaId:
				normalizeRecipientPhone(params.contact.phone_number) ||
				normalizeRecipientPhone(params.contact.whatsapp_id) ||
				storedJid.split('@')[0] ||
				'',
			recipientJid: storedJid,
			addressingMode: resolveWhatsappAddressingMode(storedJid),
			persistResolvedJid: false,
		}
	}

	const recipientWaId =
		normalizeRecipientPhone(params.contact.phone_number) ||
		normalizeRecipientPhone(params.contact.whatsapp_id)
	if (!recipientWaId) {
		return {
			recipientWaId: '',
			recipientJid: null,
			addressingMode: null,
			persistResolvedJid: false,
		}
	}

	const storedAddressingMode = resolveWhatsappAddressingMode(
		asString(additionalAttributes.whatsapp_addressing_mode) ||
			asString(additionalAttributes.whatsappAddressingMode),
	)
	if (storedAddressingMode) {
		return {
			recipientWaId,
			recipientJid: buildWhatsappJid(recipientWaId, storedAddressingMode),
			addressingMode: storedAddressingMode,
			persistResolvedJid: true,
		}
	}

	const lookedUpJid = await lookupBaileysSessionRecipientJid({
		channelId: params.channelId,
		recipientWaId,
	})
	if (lookedUpJid) {
		return {
			recipientWaId,
			recipientJid: lookedUpJid,
			addressingMode: resolveWhatsappAddressingMode(lookedUpJid),
			persistResolvedJid: true,
		}
	}

	return {
		recipientWaId,
		recipientJid: buildWhatsappJid(recipientWaId, 'pn'),
		addressingMode: 'pn' as const,
		persistResolvedJid: false,
	}
}

function resolveTemplateLanguage(value: unknown): string | undefined {
	if (typeof value === 'string' && value.trim().length > 0) {
		return value
	}

	if (
		value &&
		typeof value === 'object' &&
		typeof (value as Record<string, unknown>).code === 'string'
	) {
		return String((value as Record<string, unknown>).code)
	}

	return undefined
}

function resolveTemplateComponents(value: unknown): any[] | undefined {
	if (Array.isArray(value) && value.length > 0) {
		return value
	}
	return undefined
}

function normalizeTemplateVariables(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}

	const result: Record<string, string> = {}
	for (const [rawKey, rawValue] of Object.entries(
		value as Record<string, unknown>,
	)) {
		const key = String(rawKey || '').trim()
		if (!key) continue
		const match = key.match(/^\{\{\s*(\d+)\s*\}\}$/)
		const normalizedKey = match ? match[1] : key
		if (rawValue === null || rawValue === undefined) continue
		const normalizedValue = String(rawValue).trim()
		if (!normalizedValue) continue
		result[normalizedKey] = normalizedValue
	}

	return result
}

function resolveDelayMs(value: unknown): number {
	const seconds = Number(value)
	if (!Number.isFinite(seconds)) return 0
	const normalizedSeconds = Math.max(0, Math.min(seconds, 300))
	return Math.round(normalizedSeconds * 1000)
}

function mergeTemplateVariables(
	defaults: Record<string, string>,
	recipientVariables: Record<string, string>,
): Record<string, string> {
	return {
		...defaults,
		...recipientVariables,
	}
}

function resolveRecipientTemplateVariables(
	defaults: Record<string, string>,
	recipientVariables: Record<string, string>,
	recipientContactName: string | null,
): Record<string, string> {
	return resolveDynamicTemplateVariables(
		mergeTemplateVariables(defaults, recipientVariables),
		recipientContactName,
	)
}

function resolveDynamicTemplateValue(
	value: string,
	recipientContactName: string | null,
): string {
	const normalized = value.trim().toLowerCase()
	if (normalized === '{{customer_name}}') {
		const resolvedName = String(recipientContactName || '').trim()
		return resolvedName || 'Customer'
	}
	return value
}

function resolveDynamicTemplateVariables(
	variables: Record<string, string>,
	recipientContactName: string | null,
): Record<string, string> {
	const resolved: Record<string, string> = {}
	for (const [key, value] of Object.entries(variables)) {
		resolved[key] = resolveDynamicTemplateValue(value, recipientContactName)
	}
	return resolved
}

function buildBodyParametersFromVariables(
	variables: Record<string, string>,
): Array<{ type: 'text'; text: string }> {
	const numericKeys = Object.keys(variables)
		.filter((key) => /^\d+$/.test(key))
		.sort((a, b) => Number(a) - Number(b))

	return numericKeys.map((key) => ({
		type: 'text',
		text: variables[key],
	}))
}

function buildRecipientTemplateComponents(
	baseComponents: any[] | undefined,
	mergedVariables: Record<string, string>,
): any[] | undefined {
	const bodyParameters = buildBodyParametersFromVariables(mergedVariables)

	if (bodyParameters.length === 0) {
		return baseComponents
	}

	if (!Array.isArray(baseComponents) || baseComponents.length === 0) {
		return [{ type: 'body', parameters: bodyParameters }]
	}

	let hasBodyComponent = false
	const nextComponents = baseComponents.map((component) => {
		const componentType = String(component?.type || '').toLowerCase()
		if (componentType !== 'body') return component

		hasBodyComponent = true
		const existingParameters = Array.isArray(component?.parameters)
			? component.parameters
			: []
		const existingLength = existingParameters.length
		const targetLength = Math.max(existingLength, bodyParameters.length)
		const mergedParameters = Array.from(
			{ length: targetLength },
			(_, index) => {
				if (index < bodyParameters.length) {
					const existing = existingParameters[index]
					if (existing && typeof existing === 'object') {
						return {
							...existing,
							type: 'text',
							text: bodyParameters[index].text,
						}
					}
					return bodyParameters[index]
				}
				return existingParameters[index]
			},
		)

		return {
			...component,
			parameters: mergedParameters,
		}
	})

	if (!hasBodyComponent) {
		nextComponents.push({ type: 'body', parameters: bodyParameters })
	}

	return nextComponents
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return
	await new Promise((resolve) => setTimeout(resolve, ms))
}

type OutboundConversationLock = {
	key: string
	token: string
}

function buildOutboundConversationLockKey(conversationId: string): string {
	return `lock:outbound:conversation:${conversationId}`
}

async function tryAcquireOutboundConversationLock(
	conversationId: string,
): Promise<OutboundConversationLock | null> {
	const key = buildOutboundConversationLockKey(conversationId)
	const token = `${Date.now()}:${Math.random().toString(36).slice(2)}`
	const result = await redis.set(
		key,
		token,
		'PX',
		OUTBOUND_CONVERSATION_LOCK_TTL_MS,
		'NX',
	)
	if (result !== 'OK') return null
	return { key, token }
}

async function releaseOutboundConversationLock(
	lock: OutboundConversationLock | null,
): Promise<void> {
	if (!lock) return
	try {
		await redis.eval(
			'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("del", KEYS[1]) else return 0 end',
			1,
			lock.key,
			lock.token,
		)
	} catch (error) {
		console.warn('[OutboundWorker] Failed releasing conversation lock:', error)
	}
}

function startOutboundConversationLockAutoRenew(
	lock: OutboundConversationLock,
): () => void {
	const timer = setInterval(() => {
		void redis
			.eval(
				'if redis.call("get", KEYS[1]) == ARGV[1] then return redis.call("pexpire", KEYS[1], ARGV[2]) else return 0 end',
				1,
				lock.key,
				lock.token,
				String(OUTBOUND_CONVERSATION_LOCK_TTL_MS),
			)
			.catch((error) => {
				console.warn(
					'[OutboundWorker] Failed renewing conversation lock:',
					error,
				)
			})
	}, OUTBOUND_CONVERSATION_LOCK_RENEW_MS)

	return () => {
		clearInterval(timer)
	}
}

async function waitForOutboundConversationLock(
	conversationId: string,
	messageId: string,
): Promise<OutboundConversationLock | null> {
	const startedAt = Date.now()
	while (Date.now() - startedAt < OUTBOUND_CONVERSATION_LOCK_WAIT_MS) {
		const lock = await tryAcquireOutboundConversationLock(conversationId)
		if (lock) return lock

		const latestStatus = await prisma.messages.findUnique({
			where: { id: messageId },
			select: { status: true },
		})
		const normalizedStatus = String(latestStatus?.status || '')
			.trim()
			.toLowerCase()
		if (normalizedStatus && normalizedStatus !== 'pending') {
			return null
		}

		await sleep(OUTBOUND_CONVERSATION_LOCK_POLL_MS)
	}
	return null
}

async function isNextPendingOutboundMessage(
	conversationId: string,
	messageId: string,
): Promise<boolean> {
	const earliestPending = await prisma.messages.findFirst({
		where: {
			conversation_id: conversationId,
			message_type: 'outgoing',
			status: 'pending',
			deleted_at: null,
			OR: [{ is_deleted: false }, { is_deleted: null }],
		},
		select: { id: true },
		orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
	})

	if (!earliestPending?.id) return true
	return earliestPending.id === messageId
}

async function requeueOutboundMessage(
	messageId: string,
	delayMs = OUTBOUND_DEFER_DELAY_MS,
) {
	const bucket = Math.floor(Date.now() / Math.max(delayMs, 1))
	const jobId = `outbound-requeue-${messageId}-${bucket}`
	try {
		await outboundMessageQueue.add(
			'outbound-messages',
			{ messageId },
			{
				delay: Math.max(delayMs, 0),
				jobId,
				removeOnComplete: 2000,
				removeOnFail: 2000,
			},
		)
	} catch (error: any) {
		const message = String(error?.message || '')
		if (
			message.includes('Job') &&
			message.includes('already exists') &&
			message.includes(jobId)
		) {
			return
		}
		throw error
	}
}

async function markBroadcastFailed(
	broadcastId: string,
	message: string,
): Promise<void> {
	await prisma.broadcasts
		.update({
			where: { id: broadcastId },
			data: {
				status: 'failed',
				updated_at: new Date(),
			},
		})
		.catch(() => null)

	await prisma.broadcast_logs
		.create({
			data: {
				broadcast_id: broadcastId,
				status: 'failed',
				error_message: message,
			},
		})
		.catch(() => null)
}

function resolveWebhookInboundJobName(
	source: string | null | undefined,
): string | null {
	switch (
		String(source || '')
			.trim()
			.toLowerCase()
	) {
		case 'whatsapp':
			return 'whatsapp-inbound'
		case 'instagram':
			return 'instagram-inbound'
		case 'tiktok':
			return 'tiktok-inbound'
		default:
			return null
	}
}

function resolveWhatsAppMediaType(
	value: unknown,
): 'image' | 'video' | 'audio' | 'document' | null {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (
		normalized === 'image' ||
		normalized === 'video' ||
		normalized === 'audio' ||
		normalized === 'document'
	) {
		return normalized
	}
	return null
}

type WhatsAppMediaValidationResult =
	| {
			ok: true
			url: string
			statusCode: number
			contentType: string | null
	  }
	| {
			ok: false
			url: string
			reason: string
			statusCode: number | null
			contentType: string | null
	  }

function normalizeHttpMediaUrl(value: string): string | null {
	const trimmed = String(value || '').trim()
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString()
	} catch {
		return null
	}
}

function isTrustedWhatsAppMediaHost(url: string): boolean {
	if (WHATSAPP_MEDIA_TRUSTED_HOSTS.size === 0) return false
	try {
		const hostname = new URL(url).hostname.toLowerCase()
		return Array.from(WHATSAPP_MEDIA_TRUSTED_HOSTS).some(
			(trustedHost) =>
				hostname === trustedHost || hostname.endsWith(`.${trustedHost}`),
		)
	} catch {
		return false
	}
}

function resolveHeaderContentType(response: Response): string | null {
	const raw = String(response.headers.get('content-type') || '')
		.trim()
		.toLowerCase()
	return raw.length > 0 ? raw : null
}

function isCompatibleMediaContentType(
	mediaType: 'image' | 'video' | 'audio' | 'document',
	contentType: string | null,
): boolean {
	if (!contentType) return mediaType === 'document'

	if (mediaType === 'image') return contentType.startsWith('image/')
	if (mediaType === 'video') return contentType.startsWith('video/')
	if (mediaType === 'audio') return contentType.startsWith('audio/')

	// Document can be broad, but reject clearly non-binary html/xml responses.
	return (
		!contentType.startsWith('text/html') &&
		!contentType.startsWith('application/xml') &&
		!contentType.startsWith('text/xml')
	)
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit,
	timeoutMs: number,
): Promise<Response> {
	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), timeoutMs)
	try {
		return await fetch(url, {
			...init,
			signal: controller.signal,
		})
	} finally {
		clearTimeout(timer)
	}
}

async function validateWhatsAppMediaUrl(args: {
	mediaType: 'image' | 'video' | 'audio' | 'document'
	mediaUrl: string
}): Promise<WhatsAppMediaValidationResult> {
	const normalizedUrl = normalizeHttpMediaUrl(args.mediaUrl)
	if (!normalizedUrl) {
		return {
			ok: false,
			url: String(args.mediaUrl || '').trim(),
			reason: 'Invalid media URL',
			statusCode: null,
			contentType: null,
		}
	}

	const validateResponse = (
		response: Response,
		fallbackReason: string,
	): WhatsAppMediaValidationResult => {
		const contentType = resolveHeaderContentType(response)
		if (!response.ok) {
			return {
				ok: false,
				url: normalizedUrl,
				reason: `${fallbackReason} (HTTP ${response.status})`,
				statusCode: response.status,
				contentType,
			}
		}
		if (!isCompatibleMediaContentType(args.mediaType, contentType)) {
			return {
				ok: false,
				url: normalizedUrl,
				reason: `Unsupported media content-type: ${contentType || 'unknown'}`,
				statusCode: response.status,
				contentType,
			}
		}
		return {
			ok: true,
			url: normalizedUrl,
			statusCode: response.status,
			contentType,
		}
	}

	try {
		const headResponse = await fetchWithTimeout(
			normalizedUrl,
			{ method: 'HEAD', redirect: 'follow' },
			WHATSAPP_MEDIA_URL_VALIDATION_TIMEOUT_MS,
		)

		const headValidated = validateResponse(
			headResponse,
			'Media URL not accessible',
		)
		if (headValidated.ok) {
			return headValidated
		}
		const headValidationReason =
			'reason' in headValidated ? headValidated.reason : ''

		const shouldProbeWithGet =
			headResponse.status === 405 ||
			headResponse.status === 501 ||
			headResponse.status === 401 ||
			headResponse.status === 403 ||
			headResponse.status === 429 ||
			headValidated.contentType === null ||
			headValidationReason.startsWith('Unsupported media content-type')

		if (shouldProbeWithGet) {
			const getProbe = await fetchWithTimeout(
				normalizedUrl,
				{
					method: 'GET',
					redirect: 'follow',
					headers: {
						Range: 'bytes=0-0',
					},
				},
				WHATSAPP_MEDIA_URL_VALIDATION_TIMEOUT_MS,
			)
			const getValidated = validateResponse(
				getProbe,
				'Media URL not accessible',
			)
			if (getValidated.ok) return getValidated
			return getValidated
		}

		return headValidated
	} catch (error: any) {
		return {
			ok: false,
			url: normalizedUrl,
			reason: error?.message || 'Media URL validation failed',
			statusCode: null,
			contentType: null,
		}
	}
}

function normalizeWhatsappChannelProvider(
	value: unknown,
): 'whatsapp_cloud' | 'baileys' {
	return String(value || '')
		.trim()
		.toLowerCase() === 'baileys'
		? 'baileys'
		: 'whatsapp_cloud'
}

function normalizeHttpUrl(value: unknown): string | null {
	const trimmed = String(value || '').trim()
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString()
	} catch {
		return null
	}
}

function getBaileysProviderChannelKey(value: unknown): string | null {
	const metadata = asRecord(value)
	const normalized = String(
		metadata.provider_channel_key || metadata.providerChannelKey || '',
	).trim()
	return normalized.length > 0 ? normalized : null
}

function getBaileysProviderWebhookUrl(value: unknown): string | null {
	const metadata = asRecord(value)
	const explicit = normalizeHttpUrl(
		metadata.provider_webhook_url || metadata.providerWebhookUrl,
	)
	if (explicit) return explicit

	const directServiceUrl = normalizeHttpUrl(getBaileysServiceSendUrl())
	if (directServiceUrl) return directServiceUrl

	const envBase = normalizeHttpUrl(
		process.env.API_PUBLIC_URL ||
			process.env.BACKEND_URL ||
			process.env.PUBLIC_API_BASE_URL ||
			null,
	)
	if (envBase) return `${envBase}${BAILEYS_INTERNAL_SEND_PATH}`

	const localPort = String(process.env.PORT || '3010').trim() || '3010'
	return `http://127.0.0.1:${localPort}${BAILEYS_INTERNAL_SEND_PATH}`
}

function parseFetchResponsePayload(text: string): unknown {
	const normalized = String(text || '').trim()
	if (!normalized) return null
	try {
		return JSON.parse(normalized)
	} catch {
		return normalized
	}
}

function extractBaileysOutboundExternalId(payload: unknown): string {
	if (typeof payload === 'string') {
		return payload.trim()
	}

	if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
		return ''
	}

	const record = payload as Record<string, unknown>
	const directExternalId = String(record.externalId || '').trim()
	if (directExternalId) return directExternalId

	const dataRecord = asRecord(record.data)
	const dataExternalId = String(dataRecord.externalId || '').trim()
	if (dataExternalId) return dataExternalId

	const messageRecord = asRecord(record.message)
	const messageExternalId = String(messageRecord.externalId || '').trim()
	if (messageExternalId) return messageExternalId

	return ''
}

function resolveBaileysBridgeErrorMessage(
	status: number,
	payload: unknown,
): string {
	if (typeof payload === 'string' && payload.trim().length > 0) {
		return `Baileys bridge rejected outbound message (HTTP ${status}): ${payload.trim()}`
	}

	if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
		const record = payload as Record<string, unknown>
		const errorMessage =
			typeof record.error === 'string'
				? record.error.trim()
				: typeof record.message === 'string'
					? record.message.trim()
					: ''
		if (errorMessage) {
			return `Baileys bridge rejected outbound message (HTTP ${status}): ${errorMessage}`
		}
	}

	return `Baileys bridge rejected outbound message (HTTP ${status})`
}

function extractBaileysInteractiveText(
	content: string,
	interactive: Record<string, unknown> | undefined,
): string {
	const interactiveRecord = asRecord(interactive)
	const actionRecord = asRecord(interactiveRecord.action)
	const buttons = Array.isArray(actionRecord.buttons)
		? actionRecord.buttons
				.map((button) => {
					const reply = asRecord(asRecord(button).reply)
					const title = String(reply.title || '').trim()
					return title.length > 0 ? title : null
				})
				.filter((value): value is string => Boolean(value))
		: []

	if (buttons.length > 0) {
		return buildButtonsFallbackText(content, buttons)
	}

	const parameters = asRecord(actionRecord.parameters)
	const ctaUrl = String(parameters.url || '').trim()
	const ctaDisplayText = String(
		parameters.display_text || parameters.displayText || '',
	).trim()

	if (ctaDisplayText && ctaUrl) {
		return [content.trim(), `${ctaDisplayText}: ${ctaUrl}`]
			.filter((value) => value.length > 0)
			.join('\n')
	}

	return content.trim()
}

function buildBaileysBridgePayload(params: {
	channelKey: string
	recipientWhatsAppId: string
	recipientJid?: string
	recipientAddressingMode?: 'lid' | 'pn' | null
	messageId: string
	type:
		| 'text'
		| 'template'
		| 'interactive'
		| 'image'
		| 'video'
		| 'audio'
		| 'document'
	content: string
	contentAttributes: Record<string, any>
	replyToExternalId?: string
	interactive?: Record<string, unknown>
	media?: {
		link: string
		caption?: string
		filename?: string
	}
}) {
	const mediaType = resolveWhatsAppMediaType(params.type)
	const recipientPayload = {
		recipientWhatsAppId: params.recipientJid || params.recipientWhatsAppId,
		...(params.recipientJid ? { recipientJid: params.recipientJid } : {}),
		...(params.recipientAddressingMode
			? { recipientAddressingMode: params.recipientAddressingMode }
			: {}),
	}
	if (mediaType && params.media?.link) {
		return {
			event: 'message.send',
			channelKey: params.channelKey,
			...recipientPayload,
			messageId: params.messageId,
			type: mediaType,
			media: {
				url: params.media.link,
				...(typeof params.contentAttributes.mime_type === 'string' &&
				params.contentAttributes.mime_type.trim().length > 0
					? { mimeType: params.contentAttributes.mime_type.trim() }
					: {}),
				...(params.media.filename ? { fileName: params.media.filename } : {}),
				...(params.media.caption ? { caption: params.media.caption } : {}),
			},
			...(params.replyToExternalId
				? { replyToExternalId: params.replyToExternalId }
				: {}),
		}
	}

	let textBody = params.content.trim()
	if (params.type === 'template') {
		textBody = String(
			params.contentAttributes.template_preview_text || params.content || '',
		).trim()
	}
	if (params.type === 'interactive') {
		textBody = extractBaileysInteractiveText(textBody, params.interactive)
	}
	if (!textBody) {
		textBody = 'Pesan WhatsApp'
	}

	return {
		event: 'message.send',
		channelKey: params.channelKey,
		...recipientPayload,
		messageId: params.messageId,
		type: 'text',
		text: {
			body: textBody,
		},
		...(params.replyToExternalId
			? { replyToExternalId: params.replyToExternalId }
			: {}),
	}
}

async function dispatchWhatsAppProviderSend(params: {
	provider: unknown
	phoneNumberId?: string | null
	apiKey?: string | null
	providerChannelKey?: string | null
	providerWebhookUrl?: string | null
	to: string
	recipientJid?: string | null
	recipientAddressingMode?: 'lid' | 'pn' | null
	content: string
	contentAttributes: Record<string, any>
	type:
		| 'text'
		| 'template'
		| 'interactive'
		| 'image'
		| 'video'
		| 'audio'
		| 'document'
	components?: any[] | undefined
	templateLanguage?: string | undefined
	replyToExternalId?: string
	interactive?: Record<string, unknown>
	media?:
		| {
				link: string
				caption?: string
				filename?: string
		  }
		| undefined
	messageId: string
}) {
	const provider = normalizeWhatsappChannelProvider(params.provider)
	const apiKey = String(params.apiKey || '').trim()
	const recipientWhatsAppId = String(params.to || '').trim()

	if (!recipientWhatsAppId) {
		throw new Error('Missing WhatsApp recipient info')
	}

	if (provider === 'baileys') {
		const webhookUrl = normalizeHttpUrl(params.providerWebhookUrl)
		const channelKey = String(params.providerChannelKey || '').trim()

		if (!webhookUrl || !channelKey || !apiKey) {
			throw new Error('Missing Baileys bridge configuration or recipient info')
		}

		const bridgePayload = buildBaileysBridgePayload({
			channelKey,
			recipientWhatsAppId,
			recipientJid: params.recipientJid || undefined,
			recipientAddressingMode: params.recipientAddressingMode || null,
			messageId: params.messageId,
			type: params.type,
			content: params.content,
			contentAttributes: params.contentAttributes,
			replyToExternalId: params.replyToExternalId,
			interactive: params.interactive,
			media: params.media,
		})

		const response = await fetch(webhookUrl, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${apiKey}`,
				'X-Crm-Channel-Secret': apiKey,
			},
			body: JSON.stringify(bridgePayload),
		})
		const responseText = await response.text()
		const responsePayload = parseFetchResponsePayload(responseText)

		if (!response.ok) {
			throw new Error(
				resolveBaileysBridgeErrorMessage(response.status, responsePayload),
			)
		}

		return {
			provider,
			externalId: extractBaileysOutboundExternalId(responsePayload),
		}
	}

	const phoneNumberId = String(params.phoneNumberId || '').trim()
	if (!phoneNumberId || !apiKey) {
		throw new Error('Missing WhatsApp configuration or recipient info')
	}

	const result = await sendWhatsAppMessage({
		phoneNumberId,
		to: recipientWhatsAppId,
		content: params.content,
		apiKey,
		type: params.type,
		components: params.components,
		templateLanguage: params.templateLanguage,
		replyToWamid: params.replyToExternalId,
		interactive: params.interactive,
		media: params.media,
	})

	return {
		provider,
		externalId: result.messages?.[0]?.id || '',
	}
}

const KEYWORD_STOPWORDS = new Set([
	'dan',
	'atau',
	'yang',
	'untuk',
	'dengan',
	'dari',
	'pada',
	'adalah',
	'ini',
	'itu',
	'saya',
	'kami',
	'kak',
	'kaka',
	'kakak',
	'ya',
	'to',
	'the',
	'and',
	'for',
	'with',
	'from',
	'this',
	'that',
	'you',
	'your',
	'our',
	'are',
])

type ImageUrlContextCandidate = {
	url: string
	context: string
	sourceKind: 'source' | 'faq'
}

function normalizeKeywordText(value: string): string {
	return String(value || '')
		.toLowerCase()
		.replace(/[^a-z0-9\s]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function tokenizeKeywords(value: string): Set<string> {
	const normalized = normalizeKeywordText(value)
	if (!normalized) return new Set()
	const tokens = normalized
		.split(/\s+/)
		.map((token) => token.trim())
		.filter((token) => token.length >= 3 && !KEYWORD_STOPWORDS.has(token))
	return new Set(tokens)
}

function scoreKeywordOverlap(keywords: Set<string>, content: string): number {
	if (keywords.size === 0) return 0
	const haystack = normalizeKeywordText(content)
	if (!haystack) return 0
	let score = 0
	for (const keyword of keywords) {
		if (haystack.includes(keyword)) score += 1
	}
	return score
}

function looksLikeImageUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		const pathname = parsed.pathname.toLowerCase()
		if (/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(pathname)) return true
		return isTrustedWhatsAppMediaHost(url)
	} catch {
		return false
	}
}

function trimUrlToken(raw: string): string {
	return String(raw || '')
		.trim()
		.replace(/[),.;]+$/g, '')
}

function extractImageUrlContextsFromText(
	text: string,
	sourceKind: 'source' | 'faq',
): ImageUrlContextCandidate[] {
	const content = String(text || '')
	if (!content) return []
	const urlRegex = /https?:\/\/[^\s"'<>]+/gi
	const candidates: ImageUrlContextCandidate[] = []
	for (const match of content.matchAll(urlRegex)) {
		const url = trimUrlToken(match[0] || '')
		if (!url || !looksLikeImageUrl(url)) continue
		const index = typeof match.index === 'number' ? match.index : 0
		const contextStart = Math.max(0, index - 180)
		const contextEnd = Math.min(content.length, index + url.length + 180)
		const context = content
			.slice(contextStart, contextEnd)
			.replace(/\s+/g, ' ')
			.trim()
		candidates.push({
			url,
			context,
			sourceKind,
		})
	}
	return candidates
}

function collectAiKnowledgeReferenceIds(
	contentAttributes: Record<string, any>,
): {
	sourceIds: string[]
	faqIds: string[]
} {
	const refs = Array.isArray(contentAttributes.ai_knowledge_references)
		? contentAttributes.ai_knowledge_references
		: []
	const sourceSet = new Set<string>()
	const faqSet = new Set<string>()
	for (const ref of refs) {
		if (!ref || typeof ref !== 'object' || Array.isArray(ref)) continue
		const record = ref as Record<string, unknown>
		const id = String(record.id || '').trim()
		const type = String(record.type || '')
			.trim()
			.toLowerCase()
		if (!id) continue
		if (type === 'faq') {
			faqSet.add(id)
		} else {
			sourceSet.add(id)
		}
	}
	return {
		sourceIds: [...sourceSet],
		faqIds: [...faqSet],
	}
}

function resolveAiMediaContextText(args: {
	contentAttributes: Record<string, any>
	recentMessages: Array<{
		sender_type: string | null
		content_type: string | null
		content: string | null
		content_attributes: unknown
	}>
	originalUrl: string
}): string {
	const parts: string[] = []
	const aiLogId = String(args.contentAttributes.ai_response_log_id || '').trim()
	const caption = String(args.contentAttributes.media_caption || '').trim()
	if (caption) parts.push(caption)

	for (const item of args.recentMessages) {
		const content = String(item.content || '').trim()
		if (!content) continue
		const attrs = asRecord(item.content_attributes)
		const rowLogId = String(attrs.ai_response_log_id || '').trim()
		if (
			aiLogId &&
			rowLogId === aiLogId &&
			String(item.content_type || '').toLowerCase() === 'text'
		) {
			parts.push(content)
		}
	}

	const latestContactText = args.recentMessages.find(
		(item) =>
			String(item.sender_type || '').toLowerCase() === 'contact' &&
			String(item.content_type || '').toLowerCase() === 'text' &&
			String(item.content || '').trim().length > 0,
	)
	if (latestContactText?.content) {
		parts.push(String(latestContactText.content))
	}

	parts.push(args.originalUrl)
	return parts.join(' ')
}

async function resolveAiMediaFallbackUrl(args: {
	mediaType: 'image' | 'video' | 'audio' | 'document'
	originalUrl: string
	conversationId: string
	contentAttributes: Record<string, any>
}): Promise<string | null> {
	if (args.mediaType !== 'image') return null
	const { sourceIds, faqIds } = collectAiKnowledgeReferenceIds(
		args.contentAttributes,
	)
	if (sourceIds.length === 0 && faqIds.length === 0) return null

	const [sources, faqs, recentMessages] = await Promise.all([
		sourceIds.length > 0
			? prisma.knowledge_sources.findMany({
					where: {
						id: { in: sourceIds },
						is_active: true,
					},
					select: {
						id: true,
						title: true,
						content: true,
					},
				})
			: Promise.resolve([]),
		faqIds.length > 0
			? prisma.knowledge_faqs.findMany({
					where: {
						id: { in: faqIds },
						is_active: true,
					},
					select: {
						id: true,
						question: true,
						answer: true,
					},
				})
			: Promise.resolve([]),
		prisma.messages.findMany({
			where: {
				conversation_id: args.conversationId,
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
			},
			orderBy: { created_at: 'desc' },
			take: 60,
			select: {
				sender_type: true,
				content_type: true,
				content: true,
				content_attributes: true,
			},
		}),
	])

	const contextText = resolveAiMediaContextText({
		contentAttributes: args.contentAttributes,
		recentMessages,
		originalUrl: args.originalUrl,
	})
	const keywords = tokenizeKeywords(contextText)
	if (keywords.size === 0) return null

	const candidates: Array<{
		url: string
		score: number
	}> = []
	const originalNormalized = String(args.originalUrl || '')
		.trim()
		.toLowerCase()
	const contextHasPriceCue = /(promo|harga|price|flash|sale|rb|diskon)/i.test(
		contextText,
	)

	for (const source of sources) {
		const content = `${String(source.title || '')}\n${String(source.content || '')}`
		const urlContexts = extractImageUrlContextsFromText(content, 'source')
		for (const item of urlContexts) {
			const normalizedUrl = item.url.toLowerCase()
			if (!normalizedUrl || normalizedUrl === originalNormalized) continue
			const contextScore = scoreKeywordOverlap(keywords, item.context)
			const urlScore = scoreKeywordOverlap(keywords, item.url)
			const cueBoost =
				contextHasPriceCue &&
				/(promo|harga|price|flash|sale|rb|diskon)/i.test(
					item.context + ' ' + item.url,
				)
					? 4
					: 0
			const score = contextScore * 6 + urlScore * 8 + cueBoost
			if (score <= 0) continue
			candidates.push({ url: item.url, score })
		}
	}

	for (const faq of faqs) {
		const content = `${String(faq.question || '')}\n${String(faq.answer || '')}`
		const urlContexts = extractImageUrlContextsFromText(content, 'faq')
		for (const item of urlContexts) {
			const normalizedUrl = item.url.toLowerCase()
			if (!normalizedUrl || normalizedUrl === originalNormalized) continue
			const contextScore = scoreKeywordOverlap(keywords, item.context)
			const urlScore = scoreKeywordOverlap(keywords, item.url)
			const cueBoost =
				contextHasPriceCue &&
				/(promo|harga|price|flash|sale|rb|diskon)/i.test(
					item.context + ' ' + item.url,
				)
					? 4
					: 0
			const score = contextScore * 5 + urlScore * 7 + cueBoost
			if (score <= 0) continue
			candidates.push({ url: item.url, score })
		}
	}

	const ranked = candidates
		.reduce<Array<{ url: string; score: number }>>((acc, item) => {
			const existing = acc.find((row) => row.url === item.url)
			if (!existing) {
				acc.push(item)
				return acc
			}
			if (item.score > existing.score) existing.score = item.score
			return acc
		}, [])
		.sort((left, right) => right.score - left.score)

	return ranked[0]?.url || null
}

function buildButtonsFallbackText(
	messageText: string,
	options: string[],
): string {
	return [
		messageText.trim() || 'Please choose one option:',
		'',
		...options.map((option, index) => `${index + 1}. ${option}`),
	]
		.filter((line) => line.trim().length > 0)
		.join('\n')
}

function normalizeFlowButtonOptions(
	contentAttributes: Record<string, any>,
): string[] {
	const options = Array.isArray(contentAttributes.flow_buttons)
		? contentAttributes.flow_buttons
		: Array.isArray(contentAttributes.buttons)
			? contentAttributes.buttons
			: []
	return options
		.map((item) => String(item || '').trim())
		.filter((item) => item.length > 0)
		.slice(0, 10)
}

async function processBroadcastJob(job: Job) {
	const { broadcastId } = (job.data || {}) as { broadcastId?: string }
	if (!broadcastId) {
		throw new Error('Missing broadcastId in broadcast job payload')
	}

	try {
		console.log(`📣 Processing broadcast job: ${job.id} (${broadcastId})`)

		const broadcast = await prisma.broadcasts.findUnique({
			where: { id: broadcastId },
		})

		if (!broadcast || !broadcast.app_id) {
			console.warn(`[BroadcastWorker] Broadcast not found: ${broadcastId}`)
			return { success: false, reason: 'broadcast_not_found' }
		}

		const targetAudience = asRecord(broadcast.target_audience)
		const templatePayload = asRecord(broadcast.template_params)
		const selectedInboxId = resolveSelectedBroadcastInboxId(
			templatePayload.inbox_id ||
				templatePayload.inboxId ||
				targetAudience.inbox_id ||
				targetAudience.inboxId,
		)

		const waChannel = await prisma.whatsapp_channels.findFirst({
			where: {
				app_id: broadcast.app_id,
				deleted_at: null,
				is_active: true,
				...(selectedInboxId ? { inbox_id: selectedInboxId } : {}),
			},
			select: {
				id: true,
				inbox_id: true,
				api_key: true,
				phone_number_id: true,
			},
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
		})

		if (!waChannel?.phone_number_id || !waChannel.api_key) {
			const reason = selectedInboxId
				? 'No active WhatsApp channel found for the selected inbox'
				: 'No active WhatsApp channel with valid phone_number_id and api_key'
			await markBroadcastFailed(broadcast.id, reason)
			throw new Error(reason)
		}

		const recipients: BroadcastAudienceRecipient[] =
			await resolveBroadcastAudience(broadcast.app_id, targetAudience)

		await prisma.broadcast_logs.deleteMany({
			where: { broadcast_id: broadcast.id },
		})

		await prisma.broadcasts.update({
			where: { id: broadcast.id },
			data: {
				status: 'sending',
				total_recipients: recipients.length,
				success_count: 0,
				failed_count: 0,
				updated_at: new Date(),
			},
		})

		if (recipients.length === 0) {
			const reason = 'No eligible recipients found for broadcast'
			await markBroadcastFailed(broadcast.id, reason)
			throw new Error(reason)
		}

		const messageType =
			broadcast.message_type === 'template' ? 'template' : 'text'
		const templateLanguage = resolveTemplateLanguage(templatePayload.language)
		const templateComponents = resolveTemplateComponents(
			templatePayload.components,
		)
		const defaultVariables = normalizeTemplateVariables(
			templatePayload.variable_defaults,
		)
		const delayMs = resolveDelayMs(targetAudience.delaySeconds)
		const messageContent = String(broadcast.message_content || '').trim()

		if (!messageContent) {
			const reason =
				messageType === 'template'
					? 'Template name is empty'
					: 'Message content is empty'
			await markBroadcastFailed(broadcast.id, reason)
			throw new Error(reason)
		}

		let successCount = 0
		let failedCount = 0
		const csvDataRows: Array<Record<string, string>> = []
		const sendResults: Array<Record<string, unknown>> = []

		for (let index = 0; index < recipients.length; index += 1) {
			const recipient = recipients[index]
			const resolvedVariables = resolveRecipientTemplateVariables(
				defaultVariables,
				recipient.variables,
				recipient.contactName,
			)
			const csvDataRow: Record<string, string> = {
				phoneNumber: recipient.recipientPhone,
			}
			for (const [key, value] of Object.entries(resolvedVariables)) {
				csvDataRow[key] = value
			}
			csvDataRows.push(csvDataRow)

			try {
				const recipientComponents =
					messageType === 'template'
						? buildRecipientTemplateComponents(
								templateComponents,
								resolvedVariables,
							)
						: templateComponents

				const sendResponse = await sendWhatsAppMessage({
					phoneNumberId: waChannel.phone_number_id,
					to: recipient.recipientPhone,
					content: messageContent,
					apiKey: waChannel.api_key,
					type: messageType,
					components: recipientComponents,
					templateLanguage,
				})
				const messageId =
					typeof sendResponse?.messages?.[0]?.id === 'string'
						? sendResponse.messages[0].id
						: null

				successCount += 1
				sendResults.push({
					phoneNumber: recipient.recipientPhone,
					success: true,
					status: 'PENDING',
					...(messageId ? { messageId } : {}),
				})
				await prisma.broadcast_logs.create({
					data: {
						broadcast_id: broadcast.id,
						contact_id: recipient.contactId,
						status: 'sent',
					},
				})
			} catch (error: any) {
				failedCount += 1
				sendResults.push({
					phoneNumber: recipient.recipientPhone,
					success: false,
					status: 'FAILED',
					error: error?.message || 'Failed to send message',
				})
				await prisma.broadcast_logs.create({
					data: {
						broadcast_id: broadcast.id,
						contact_id: recipient.contactId,
						status: 'failed',
						error_message: error?.message || 'Failed to send message',
					},
				})
			}

			if (delayMs > 0 && index < recipients.length - 1) {
				await sleep(delayMs)
			}
		}

		const finalStatus = successCount > 0 ? 'completed' : 'failed'
		const nextTargetAudience = {
			...targetAudience,
			csvData: csvDataRows,
			results: sendResults,
			deliveredCount: Number(targetAudience.deliveredCount || 0),
			readCount: Number(targetAudience.readCount || 0),
		}
		await prisma.broadcasts.update({
			where: { id: broadcast.id },
			data: {
				status: finalStatus,
				total_recipients: recipients.length,
				success_count: successCount,
				failed_count: failedCount,
				target_audience: nextTargetAudience as any,
				updated_at: new Date(),
			},
		})

		return {
			success: finalStatus === 'completed',
			totalRecipients: recipients.length,
			successCount,
			failedCount,
		}
	} catch (error) {
		await prisma.broadcasts
			.update({
				where: { id: broadcastId },
				data: {
					status: 'failed',
					updated_at: new Date(),
				},
			})
			.catch(() => null)
		throw error
	}
}

async function processOutboundMessageJob(job: Job) {
	const { messageId } = (job.data || {}) as { messageId?: string }
	workerDebug(`📤 Processing outbound message job: ${job.id} (${messageId})`)

	if (!messageId) {
		throw new Error('Missing messageId in outbound job payload')
	}

	try {
		const messageMeta = await prisma.messages.findUnique({
			where: { id: messageId },
			select: {
				id: true,
				status: true,
				conversation_id: true,
				message_type: true,
				is_deleted: true,
			},
		})

		if (!messageMeta) {
			console.error(`[OutboundWorker] Message not found: ${messageId}`)
			return { success: false, reason: 'message_not_found' }
		}

		if (messageMeta.message_type !== 'outgoing') {
			return { success: true, skipped: true, reason: 'not_outgoing' }
		}

		if (messageMeta.is_deleted) {
			return { success: true, skipped: true, reason: 'message_deleted' }
		}

		const normalizedStatus = String(messageMeta.status || '')
			.trim()
			.toLowerCase()
		if (normalizedStatus && normalizedStatus !== 'pending') {
			return {
				success: true,
				skipped: true,
				reason: `message_status_${normalizedStatus}`,
			}
		}

		if (!messageMeta.conversation_id) {
			throw new Error('Conversation not found')
		}

		const conversationId = messageMeta.conversation_id
		const isNextMessageBeforeLock = await isNextPendingOutboundMessage(
			conversationId,
			messageId,
		)
		if (!isNextMessageBeforeLock) {
			await requeueOutboundMessage(messageId)
			return {
				success: false,
				deferred: true,
				reason: 'waiting_previous_message',
			}
		}

		let conversationLock: OutboundConversationLock | null =
			await waitForOutboundConversationLock(conversationId, messageId)
		let stopConversationLockAutoRenew: (() => void) | null = null

		if (!conversationLock) {
			const latestStatusRow = await prisma.messages.findUnique({
				where: { id: messageId },
				select: { status: true },
			})
			const latestStatus = String(latestStatusRow?.status || '')
				.trim()
				.toLowerCase()
			if (latestStatus && latestStatus !== 'pending') {
				return {
					success: true,
					skipped: true,
					reason: `message_status_${latestStatus}`,
				}
			}
			await requeueOutboundMessage(messageId)
			return { success: false, deferred: true, reason: 'conversation_locked' }
		}

		try {
			stopConversationLockAutoRenew =
				startOutboundConversationLockAutoRenew(conversationLock)

			const shouldProcessNow = await isNextPendingOutboundMessage(
				conversationId,
				messageId,
			)
			if (!shouldProcessNow) {
				await requeueOutboundMessage(messageId)
				return {
					success: false,
					deferred: true,
					reason: 'waiting_previous_message',
				}
			}

			const message = await prisma.messages.findUnique({
				where: { id: messageId },
				include: {
					conversations: {
						include: {
							inboxes: {
								include: {
									whatsapp_channels: true,
								},
							},
							contacts: true,
						},
					},
				},
			})

			if (!message) {
				console.error(
					`[OutboundWorker] Message not found after lock: ${messageId}`,
				)
				return { success: false, reason: 'message_not_found_after_lock' }
			}

			const latestMessageStatus = String(message.status || '')
				.trim()
				.toLowerCase()
			if (latestMessageStatus && latestMessageStatus !== 'pending') {
				return {
					success: true,
					skipped: true,
					reason: `message_status_${latestMessageStatus}`,
				}
			}

			const conversation = message.conversations
			if (!conversation) throw new Error('Conversation not found')

			const inbox = conversation.inboxes
			if (!inbox) throw new Error('Inbox not found')

			const contact = conversation.contacts
			if (!contact) throw new Error('Contact not found')

			let externalId = ''
			const channelType = inbox.channel_type
			let conversationProvider: string | null = null
			const conversationAttributes = asRecord(
				conversation.additional_attributes,
			)
			const conversationSource = String(conversationAttributes.source || '')
				.trim()
				.toLowerCase()
			const isPlaygroundWorkflowConversation =
				conversationSource === 'ai_playground_workflow'
			let sentMessageContent = message.content || ''
			let sentMessageContentType = String(message.content_type || 'text').trim()
			let sentMessageContentAttributes: Record<string, any> = asRecord(
				message.content_attributes,
			)

			if (
				channelType === 'whatsapp' &&
				isPlaygroundWorkflowConversation &&
				!normalizeRecipientPhone(contact.phone_number || contact.whatsapp_id)
			) {
				sentMessageContentType = String(message.content_type || 'text').trim()
				sentMessageContent = message.content || ''
				sentMessageContentAttributes = {
					...sentMessageContentAttributes,
					type: sentMessageContentType || 'text',
					delivery_mode: 'playground_simulated',
					delivery_skipped_reason: 'missing_recipient_playground',
				}
				externalId = `playground-sim-${message.id}`
				console.warn(
					`[OutboundWorker] Simulated WhatsApp outbound for playground message ${messageId} (missing recipient)`,
				)
			} else if (channelType === 'whatsapp') {
				const waChannel = inbox.whatsapp_channels[0]
				if (!waChannel) {
					throw new Error('WhatsApp channel not found for inbox')
				}

				const phoneNumberId = waChannel.phone_number_id
				const apiKey = waChannel.api_key
				const provider = normalizeWhatsappChannelProvider(waChannel.provider)
				conversationProvider = provider
				let to = contact.phone_number || contact.whatsapp_id
				let recipientJid: string | null = null
				let recipientAddressingMode: 'lid' | 'pn' | null = null

				if (provider === 'baileys') {
					const recipient = await resolveBaileysRecipient({
						channelId: waChannel.id,
						contact: {
							id: contact.id,
							phone_number: contact.phone_number,
							whatsapp_id: contact.whatsapp_id,
							additional_attributes: contact.additional_attributes,
						},
					})

					to = recipient.recipientWaId || to
					recipientJid = recipient.recipientJid
					recipientAddressingMode = recipient.addressingMode

					if (recipient.persistResolvedJid && recipient.recipientJid) {
						const nextAdditionalAttributes = {
							...asRecord(contact.additional_attributes),
							whatsapp_jid: recipient.recipientJid,
							...(recipient.addressingMode
								? { whatsapp_addressing_mode: recipient.addressingMode }
								: {}),
						}

						await prisma.contacts
							.update({
								where: { id: contact.id },
								data: {
									additional_attributes: nextAdditionalAttributes as any,
									updated_at: new Date(),
								},
							})
							.catch(() => null)
					}
				}

				if (!to) {
					throw new Error('Missing WhatsApp configuration or recipient info')
				}

				const contentAttributes = asRecord(message.content_attributes)
				sentMessageContentAttributes = {
					...contentAttributes,
				}
				const messageTypeRaw = String(
					contentAttributes.type || message.content_type || 'text',
				)
					.trim()
					.toLowerCase()
				const components = resolveTemplateComponents(
					contentAttributes.components,
				)
				const templateLanguage = resolveTemplateLanguage(
					contentAttributes.language,
				)

				let type:
					| 'text'
					| 'template'
					| 'interactive'
					| 'image'
					| 'video'
					| 'audio'
					| 'document' = 'text'
				let content = message.content || ''
				let interactivePayload: Record<string, unknown> | undefined
				let mediaPayload:
					| {
							link: string
							caption?: string
							filename?: string
					  }
					| undefined

				if (messageTypeRaw === 'template') {
					type = 'template'
				} else if (messageTypeRaw === 'interactive') {
					const options = normalizeFlowButtonOptions(contentAttributes)
					const fromAttributesInteractive = asRecord(
						contentAttributes.interactive,
					)
					const actionRecord = asRecord(fromAttributesInteractive.action)
					const nativeInteractiveType = String(
						fromAttributesInteractive.type || '',
					)
						.trim()
						.toLowerCase()
					const ctaParameters = asRecord(actionRecord.parameters)
					const ctaUrl = String(ctaParameters.url || '').trim()
					const ctaDisplayText = String(
						ctaParameters.display_text || ctaParameters.displayText || '',
					).trim()
					const nativeButtons = Array.isArray(actionRecord.buttons)
						? actionRecord.buttons
								.map((button) => {
									const reply = asRecord(asRecord(button).reply)
									const title = String(reply.title || '').trim()
									return title.length > 0 ? title : null
								})
								.filter((value): value is string => Boolean(value))
						: []
					const resolvedButtons =
						nativeButtons.length > 0 ? nativeButtons : options

					if (nativeInteractiveType === 'cta_url' && ctaUrl && ctaDisplayText) {
						type = 'interactive'
						const bodyText = String(
							asRecord(fromAttributesInteractive.body).text ||
								message.content ||
								'Silakan lanjutkan pembayaran.',
						).trim()
						interactivePayload = {
							type: 'cta_url',
							body: {
								text: bodyText || 'Silakan lanjutkan pembayaran.',
							},
							action: {
								name: 'cta_url',
								parameters: {
									display_text: ctaDisplayText.slice(0, 20),
									url: ctaUrl,
								},
							},
						}
					} else if (resolvedButtons.length === 0) {
						type = 'text'
					} else if (resolvedButtons.length > 3) {
						type = 'text'
						content = buildButtonsFallbackText(
							String(message.content || '').trim(),
							resolvedButtons,
						)
					} else {
						type = 'interactive'
						const bodyText = String(
							asRecord(fromAttributesInteractive.body).text ||
								message.content ||
								'Please choose one option:',
						).trim()
						interactivePayload = {
							type: 'button',
							body: {
								text: bodyText || 'Please choose one option:',
							},
							action: {
								buttons: resolvedButtons.map((label, index) => ({
									type: 'reply',
									reply: {
										id: `flow_btn_${index + 1}`,
										title: label.slice(0, 20),
									},
								})),
							},
						}

						const mediaUrl = String(
							contentAttributes.media_url ||
								asRecord(contentAttributes.media).url ||
								asRecord(contentAttributes.media).mediaUrl ||
								'',
						).trim()
						if (mediaUrl) {
							interactivePayload.header = {
								type: 'image',
								image: { link: mediaUrl },
							}
						}
					}
				} else {
					const mediaType = resolveWhatsAppMediaType(
						contentAttributes.media_type ||
							message.content_type ||
							messageTypeRaw,
					)
					const mediaUrl = String(
						contentAttributes.media_url ||
							asRecord(contentAttributes.media).url ||
							asRecord(contentAttributes.media).media_url ||
							'',
					).trim()

					if (mediaType && mediaUrl) {
						const mediaValidation = await validateWhatsAppMediaUrl({
							mediaType,
							mediaUrl,
						})
						let selectedMediaValidation = mediaValidation
						let repairedMediaUrl: string | null = null

						if (!selectedMediaValidation.ok && mediaType === 'image') {
							repairedMediaUrl = await resolveAiMediaFallbackUrl({
								mediaType,
								originalUrl: mediaUrl,
								conversationId: conversation.id,
								contentAttributes,
							})
							if (repairedMediaUrl) {
								const repairedValidation = await validateWhatsAppMediaUrl({
									mediaType,
									mediaUrl: repairedMediaUrl,
								})
								if (repairedValidation.ok) {
									selectedMediaValidation = repairedValidation
								}
							}
						}

						if (selectedMediaValidation.ok) {
							type = mediaType
							mediaPayload = {
								link: selectedMediaValidation.url,
								...(typeof contentAttributes.media_caption === 'string' &&
								contentAttributes.media_caption.trim().length > 0
									? { caption: contentAttributes.media_caption.trim() }
									: {}),
								...(typeof contentAttributes.file_name === 'string' &&
								contentAttributes.file_name.trim().length > 0
									? { filename: contentAttributes.file_name.trim() }
									: {}),
							}
							sentMessageContentType = mediaType
							sentMessageContent = selectedMediaValidation.url
							sentMessageContentAttributes = {
								...contentAttributes,
								type: mediaType,
								media_url: selectedMediaValidation.url,
								...(repairedMediaUrl && repairedMediaUrl !== mediaUrl
									? {
											media_repaired_from: mediaUrl,
											media_repaired_to: repairedMediaUrl,
										}
									: {}),
								media_validation: {
									ok: true,
									status_code: selectedMediaValidation.statusCode,
									content_type: selectedMediaValidation.contentType,
									...(repairedMediaUrl && repairedMediaUrl !== mediaUrl
										? {
												repaired_from_validation: {
													ok: false,
													reason:
														'reason' in mediaValidation
															? mediaValidation.reason
															: 'media_validation_failed',
													status_code: mediaValidation.statusCode,
													content_type: mediaValidation.contentType,
												},
											}
										: {}),
								},
							}
						} else {
							const validationReason =
								'reason' in selectedMediaValidation
									? selectedMediaValidation.reason
									: 'media_validation_failed'
							type = 'text'
							const fallbackLines = [
								String(message.content || '').trim(),
								selectedMediaValidation.url,
							]
								.filter((value) => value.length > 0)
								.filter((value, index, array) => array.indexOf(value) === index)
							content = fallbackLines.join('\n')
							sentMessageContentType = 'text'
							sentMessageContent = content
							sentMessageContentAttributes = {
								...contentAttributes,
								type: 'text',
								media_fallback_to_text: true,
								original_media_url: selectedMediaValidation.url,
								original_media_type: mediaType,
								...(repairedMediaUrl && repairedMediaUrl !== mediaUrl
									? {
											media_repair_attempted: true,
											media_repaired_candidate: repairedMediaUrl,
										}
									: {}),
								media_validation: {
									ok: false,
									reason: validationReason,
									status_code: selectedMediaValidation.statusCode,
									content_type: selectedMediaValidation.contentType,
								},
							}
						}
					}
				}

				if (type === 'text') {
					sentMessageContentType = 'text'
					sentMessageContent = content
					sentMessageContentAttributes = {
						...sentMessageContentAttributes,
						type: 'text',
					}
				} else if (type === 'template') {
					sentMessageContentType = 'template'
					sentMessageContent = content
					sentMessageContentAttributes = {
						...sentMessageContentAttributes,
						type: 'template',
					}
				} else if (type === 'interactive') {
					sentMessageContentType = 'interactive'
					sentMessageContent = content
					sentMessageContentAttributes = {
						...sentMessageContentAttributes,
						type: 'interactive',
						...(interactivePayload ? { interactive: interactivePayload } : {}),
					}
				}

				// Resolve reply_to_message_id to WhatsApp external wamid
				let replyToWamid: string | undefined
				if (message.reply_to_message_id) {
					const replyMsg = await prisma.messages.findUnique({
						where: { id: message.reply_to_message_id },
						select: { external_id: true },
					})
					if (replyMsg?.external_id) replyToWamid = replyMsg.external_id
				}

				const sendResult = await dispatchWhatsAppProviderSend({
					provider,
					phoneNumberId,
					apiKey,
					providerChannelKey: getBaileysProviderChannelKey(
						waChannel.extended_metadata,
					),
					providerWebhookUrl: getBaileysProviderWebhookUrl(
						waChannel.extended_metadata,
					),
					to,
					recipientJid,
					recipientAddressingMode,
					content,
					contentAttributes,
					type,
					components,
					templateLanguage,
					replyToExternalId: replyToWamid,
					interactive: interactivePayload,
					media: mediaPayload,
					messageId: message.id,
				})
				externalId = sendResult.externalId || ''
			} else if (channelType === 'instagram') {
				const config = inbox.channel_config as any
				// Instagram Messaging API uses the Instagram user token (access_token)
				// page_access_token is a fallback (set to access_token when no FB page is linked)
				const token = config?.access_token || config?.page_access_token
				const recipientId = contact.instagram_id || contact.instagram_igsid

				if (!token || !recipientId) {
					throw new Error('Missing Instagram configuration or recipient info')
				}

				const contentAttributes = asRecord(message.content_attributes)
				const mediaUrl = contentAttributes.media_url as string | undefined
				const mediaType = contentAttributes.media_type as string | undefined

				const result = await sendInstagramMessage(
					'', // pageId unused, Instagram API uses me/messages
					recipientId,
					message.content || '',
					token,
					mediaType,
					mediaUrl,
				)
				externalId = result.message_id || ''
			} else if (channelType === 'tiktok') {
				const config = asRecord(inbox.channel_config)
				const token = String(config.access_token || '').trim()
				const conversationAppId = String(conversation.app_id || '').trim()
				const identifier = String(contact.identifier || '').trim()
				const inferredRecipientId =
					conversationAppId &&
					identifier.startsWith(`tt:${conversationAppId}:`) &&
					identifier.split(':').length >= 3
						? identifier.split(':').slice(-1)[0]
						: null
				const recipientId = String(
					contact.tiktok_id || inferredRecipientId || '',
				).trim()

				if (!token || !recipientId) {
					throw new Error('Missing TikTok configuration or recipient info')
				}

				const contentAttributes = asRecord(message.content_attributes)
				const rawType = String(
					contentAttributes.media_type ||
						contentAttributes.type ||
						message.content_type ||
						'text',
				)
					.trim()
					.toLowerCase()
				const mediaType =
					rawType === 'image' ||
					rawType === 'video' ||
					rawType === 'audio' ||
					rawType === 'document'
						? rawType
						: 'text'
				const mediaUrl = String(
					contentAttributes.media_url ||
						asRecord(contentAttributes.media).url ||
						asRecord(contentAttributes.media).media_url ||
						'',
				).trim()

				const result = await sendTikTokMessage({
					accessToken: token,
					recipientId,
					content: String(message.content || ''),
					type: mediaType,
					mediaUrl: mediaType === 'text' ? undefined : mediaUrl || undefined,
				})
				externalId = result.messageId || ''

				if (mediaType !== 'text' && mediaUrl) {
					sentMessageContentType = mediaType
					sentMessageContent = mediaUrl
					sentMessageContentAttributes = {
						...contentAttributes,
						type: mediaType,
						media_type: mediaType,
						media_url: mediaUrl,
					}
				} else {
					sentMessageContentType = 'text'
					sentMessageContent = message.content || ''
					sentMessageContentAttributes = {
						...contentAttributes,
						type: 'text',
					}
				}
			} else {
				throw new Error(`Unsupported channel type: ${channelType}`)
			}

			await prisma.$transaction([
				prisma.messages.update({
					where: { id: messageId },
					data: {
						status: 'sent',
						external_id: externalId || null,
						content: sentMessageContent,
						content_type: sentMessageContentType,
						content_attributes: sentMessageContentAttributes,
						updated_at: new Date(),
					},
				}),
				prisma.conversations.update({
					where: { id: conversation.id },
					data: {
						last_message_at: new Date(),
						updated_at: new Date(),
					},
				}),
			])
			void BusinessWebhookDispatchService.dispatch({
				event: 'message.sent',
				appId: conversation.app_id,
				inboxId: conversation.inbox_id,
				payload: {
					source: channelType,
					conversation: {
						id: conversation.id,
						app_id: conversation.app_id,
						inbox_id: conversation.inbox_id,
						channel_type: channelType,
						provider: conversationProvider,
						whatsapp_provider: conversationProvider,
					},
					message: {
						id: message.id,
						external_id: externalId || null,
						content: sentMessageContent,
						content_type: sentMessageContentType,
						sender_type: message.sender_type,
						status: 'sent',
						created_at: message.created_at,
					},
					contact: {
						id: contact.id,
						name: contact.name,
						phone_number: contact.phone_number,
						identifier: contact.identifier,
					},
				},
			})

			workerDebug(`[OutboundWorker] Successfully sent message: ${messageId}`)
			return { success: true, externalId }
		} finally {
			if (stopConversationLockAutoRenew) {
				stopConversationLockAutoRenew()
				stopConversationLockAutoRenew = null
			}
			await releaseOutboundConversationLock(conversationLock)
			conversationLock = null
		}
	} catch (error: any) {
		console.error(
			`[OutboundWorker] Error processing message ${messageId}:`,
			error,
		)

		await prisma.messages.update({
			where: { id: messageId },
			data: {
				status: 'failed',
				error: { message: error?.message || 'Unknown outbound error' },
				updated_at: new Date(),
			},
		})

		throw error
	}
}

const dispatchDueScheduledBroadcasts = async () => {
	const dueBroadcasts = await prisma.broadcasts.findMany({
		where: {
			status: 'scheduled',
			deleted_at: null,
			app_id: { not: null },
			scheduled_at: { lte: new Date() },
		},
		select: {
			id: true,
			app_id: true,
		},
		orderBy: { scheduled_at: 'asc' },
		take: 200,
	})

	for (const broadcast of dueBroadcasts) {
		if (!broadcast.app_id) continue

		const claimed = await prisma.broadcasts.updateMany({
			where: {
				id: broadcast.id,
				status: 'scheduled',
			},
			data: {
				status: 'sending',
				updated_at: new Date(),
			},
		})

		if (claimed.count === 0) continue

		await outboundMessageQueue.add(
			'broadcast',
			{
				broadcastId: broadcast.id,
				appId: broadcast.app_id,
			},
			{
				jobId: `broadcast-scheduled-${broadcast.id}-${Date.now()}`,
				removeOnComplete: 1000,
				removeOnFail: 2000,
			},
		)
	}

	if (dueBroadcasts.length > 0) {
		console.log(
			`📆 Dispatched ${dueBroadcasts.length} scheduled broadcast(s) for processing`,
		)
	}
}

const dispatchDueChatbotFollowups = async () => {
	const result = await ChatbotFollowupService.dispatchDueFollowupsBatch(
		CHATBOT_FOLLOWUP_DISPATCH_BATCH_LIMIT,
	)
	if (result.queued > 0) {
		console.log(
			`🤖 Processed chatbot follow-ups: queued=${result.queued}, sent=${result.processed}`,
		)
	}
}

// Profile-photo sync consumer, owned by the worker process (see profile-sync.ts).
export const whatsappProfileSyncWorker = RUN_WORKERS
	? startWhatsappProfileSyncWorker()
	: null

export const incomingWorker = RUN_WORKERS
	? new Worker(
			'incoming-messages',
			async (job: Job) => {
				if (job.name === 'whatsapp.inbound' && (job.data as any)?.payload) {
					return WebhookService.handleWhatsAppInbound((job.data as any).payload)
				}
				return { success: true, skipped: true }
			},
			{ connection: redis, concurrency: 10 },
		)
	: null

export const outboundWorker = RUN_WORKERS
	? new Worker(
			'outbound-messages',
			async (job: Job) => {
				if (job.name === 'broadcast' || (job.data as any)?.broadcastId) {
					return processBroadcastJob(job)
				}

				return processOutboundMessageJob(job)
			},
			{
				connection: redis,
				concurrency: Number(process.env.OUTBOUND_WORKER_CONCURRENCY || 8),
			},
		)
	: null

export const webhookWorker = RUN_WORKERS
	? new Worker(
			'webhooks',
			async (job: Job) => {
				workerDebug(`🪝 Processing webhook job: ${job.name} (${job.id})`)

				const payload = (job.data as any)?.payload ?? job.data
				const webhookEventId = (job.data as any)?.webhookEventId as
					| string
					| undefined

				if (job.name === 'whatsapp-inbound') {
					return WebhookService.handleWhatsAppInbound(payload, webhookEventId)
				}

				if (job.name === 'instagram-inbound') {
					return WebhookService.handleInstagramInbound(payload, webhookEventId)
				}

				if (job.name === 'tiktok-inbound') {
					return WebhookService.handleTikTokInbound(payload, webhookEventId)
				}

				if (job.name === 'chatbot-auto-reply') {
					return WebhookService.processDebouncedAutoReplyJob(payload)
				}

				if (job.name === 'personal-ai-review') {
					const finalAttempt =
						job.attemptsMade + 1 >= Number(job.opts.attempts || 1)
					return PersonalAiReplyService.processReview(
						String(payload?.taskId || ''),
						finalAttempt,
					)
				}

				if (job.name === 'personal-ai-compose') {
					const finalAttempt =
						job.attemptsMade + 1 >= Number(job.opts.attempts || 1)
					return PersonalAiReplyService.processCompose(
						String(payload?.taskId || ''),
						finalAttempt,
					)
				}

				if (job.name === 'personal-ai-lead-qualify') {
					return PersonalAiReplyService.forceQualifyLeadNeed(
						String(payload?.appId || ''),
						String(payload?.conversationId || ''),
						String(payload?.requestedByUserId || ''),
					)
				}

				console.warn(`[WebhookWorker] Unknown job type: ${job.name}`)
				return { success: false, ignored: true, reason: 'unknown_job_type' }
			},
			{ connection: redis, concurrency: 5 },
		)
	: null

export const taskAnalysisWorker = RUN_WORKERS
	? new Worker(
			'ai-processing',
			async (job: Job) => {
				if (job.name !== 'task-analysis') {
					console.warn(`[TaskAnalysisWorker] Unknown job type: ${job.name}`)
					return { success: false, ignored: true, reason: 'unknown_job_type' }
				}
				return processTaskAnalysisJob(job.data)
			},
			{ connection: redis, concurrency: TASK_ANALYSIS_CONCURRENCY },
		)
	: null

export const maintenanceWorker = RUN_WORKERS
	? new Worker(
			'maintenance',
			async (job: Job) => {
				console.log(`🛠️ Processing maintenance job: ${job.name}`)
				if (job.name === 'check-expired-windows') {
					const now = new Date()
					const expiredConversations = await prisma.conversations.findMany({
						where: {
							messaging_window_open: true,
							messaging_window_expires_at: { lt: now },
						},
						select: { id: true, app_id: true },
					})

					if (expiredConversations.length > 0) {
						console.log(
							`🔒 Closing ${expiredConversations.length} expired windows`,
						)
						await prisma.conversations.updateMany({
							where: { id: { in: expiredConversations.map((c) => c.id) } },
							data: {
								messaging_window_open: false,
								is_within_messaging_window: false,
								updated_at: now,
							},
						})

						expiredConversations.forEach((conv) => {
							emitRealtimeToRoom(
								`app:${conv.app_id}`,
								'conversation:window_expired',
								{ conversationId: conv.id },
							)
							emitRealtimeToRoom(
								`conversation:${conv.id}`,
								'conversation:window_expired',
								{ conversationId: conv.id },
							)
						})
					}
				}

				if (job.name === 'dispatch-scheduled-broadcasts') {
					await dispatchDueScheduledBroadcasts()
				}

				if (job.name === 'notify-due-tasks') {
					// Window matches the 5-minute repeat so each task is reminded
					// once as it crosses its due time.
					await NotificationService.remindDueTasks(5 * 60 * 1000)
				}

				if (job.name === 'retry-failed-webhooks') {
					await replayRetryableFailedWebhookEvents()
				}

				if (job.name === 'dispatch-chatbot-followups') {
					await dispatchDueChatbotFollowups()
				}

				if (job.name === 'retry-ai-response-log') {
					await AIResponseLogService.processRetryJob(job.data)
				}

				if (job.name === 'analyze-ai-response-log') {
					await AIResponseLogService.processAnalyzeJob(job.data)
				}

				if (job.name === 'knowledge-change-event') {
					await KnowledgeIndexService.handleKnowledgeChangeEventJob(job.data)
				}

				if (job.name === 'sync-knowledge-index') {
					await KnowledgeIndexService.syncKnowledgeIndexJob(job.data)
				}

				if (job.name === 'purge-knowledge-index') {
					await KnowledgeIndexService.purgeKnowledgeIndexJob(job.data)
				}

				if (job.name === 'generate-sales-persona-suggestion') {
					const data = job.data as { appId?: string; userId?: string }
					if (data.appId && data.userId) {
						await generateAndStorePersonaSuggestion(data.appId, data.userId)
					}
				}

				if (job.name === 'generate-sales-persona-suggestions-sweep') {
					const profiles = await prisma.sales_profiles.findMany({
						select: { app_id: true, user_id: true },
					})
					for (const profile of profiles) {
						await generateAndStorePersonaSuggestion(
							profile.app_id,
							profile.user_id,
						).catch((error) => {
							console.warn(
								`[MaintenanceWorker] persona suggestion failed for ${profile.user_id}:`,
								error,
							)
						})
					}
				}

				return { success: true }
			},
			{
				connection: redis,
				concurrency: Number(process.env.MAINTENANCE_WORKER_CONCURRENCY || 4),
			},
		)
	: null

export const conversationBulkWorker = RUN_WORKERS
	? new Worker(
			'conversation-bulk',
			async (job: Job) => {
				console.log(`🧩 Processing conversation bulk job: ${job.name}`)

				if (job.name === 'conversation-bulk-update') {
					return ConversationBulkEditService.processBulkEditJob(
						job as Job<ConversationBulkEditJobData>,
					)
				}

				console.warn(`[ConversationBulkWorker] Unknown job type: ${job.name}`)
				return { success: false, ignored: true, reason: 'unknown_job_type' }
			},
			{ connection: redis, concurrency: 2 },
		)
	: null

export const cronWorker = RUN_WORKERS
	? new Worker(
			'cron-jobs',
			async (job: Job) => {
				console.log(`⏰ Processing cron job: ${job.name}`)
				if (job.name === 'instagram-token-refresh') {
					await InstagramService.refreshTokens()
				}

				return { success: true }
			},
			{ connection: redis },
		)
	: null

const repeatableJobCleanup = {
	removeOnComplete: { age: 3_600, count: 100 },
	removeOnFail: { age: 86_400, count: 500 },
}

const scheduleJobs = async () => {
	const { cronQueue } = await import('../lib/queue')
	await cronQueue.add(
		'instagram-token-refresh',
		{},
		{
			repeat: {
				pattern: '0 0 * * *',
			},
			jobId: 'instagram-token-refresh',
			...repeatableJobCleanup,
		},
	)
	await maintenanceQueue.add(
		'check-expired-windows',
		{},
		{
			repeat: { every: 10 * 60 * 1000 },
			jobId: 'check-expired-windows',
			...repeatableJobCleanup,
		},
	)
	await maintenanceQueue.add(
		'dispatch-scheduled-broadcasts',
		{},
		{
			repeat: { every: 60 * 1000 },
			jobId: 'dispatch-scheduled-broadcasts',
			...repeatableJobCleanup,
		},
	)
	await maintenanceQueue.add(
		'notify-due-tasks',
		{},
		{
			repeat: { every: 5 * 60 * 1000 },
			jobId: 'notify-due-tasks',
			...repeatableJobCleanup,
		},
	)
	await maintenanceQueue.add(
		'retry-failed-webhooks',
		{},
		{
			repeat: { every: 60 * 1000 },
			jobId: 'retry-failed-webhooks',
			...repeatableJobCleanup,
		},
	)
	await maintenanceQueue.add(
		'dispatch-chatbot-followups',
		{},
		{
			repeat: { every: 60 * 1000 },
			jobId: 'dispatch-chatbot-followups',
			...repeatableJobCleanup,
		},
	)
	// Weekly batch: refresh AI persona/level suggestions for every sales profile.
	// Monday 03:00 - off-hours, and gives the leader a fresh suggestion to review
	// at the start of the week rather than a stale one from mid-cycle.
	await maintenanceQueue.add(
		'generate-sales-persona-suggestions-sweep',
		{},
		{
			repeat: { pattern: '0 3 * * 1' },
			jobId: 'generate-sales-persona-suggestions-sweep',
			...repeatableJobCleanup,
		},
	)
}

const replayPendingWebhookEvents = async () => {
	const batchSize = 500
	let totalRequeued = 0

	while (true) {
		const pendingEvents = await prisma.webhook_events.findMany({
			where: {
				status: 'pending',
				source: { in: ['whatsapp', 'instagram', 'tiktok'] },
			},
			orderBy: { created_at: 'asc' },
			take: batchSize,
		})

		if (pendingEvents.length === 0) {
			break
		}

		for (const event of pendingEvents) {
			const jobName = resolveWebhookInboundJobName(event.source)
			if (!jobName) continue

			await webhookQueue.add(
				jobName,
				{
					payload: event.raw_payload,
					webhookEventId: event.id,
				},
				{
					jobId: `webhook-replay-${event.id}`,
					attempts: WEBHOOK_REPLAY_JOB_ATTEMPTS,
					backoff: {
						type: 'exponential',
						delay: WEBHOOK_REPLAY_JOB_BACKOFF_MS,
					},
					removeOnComplete: 2000,
					removeOnFail: 2000,
				},
			)
		}

		totalRequeued += pendingEvents.length
		if (pendingEvents.length < batchSize) {
			break
		}
	}

	if (totalRequeued > 0) {
		console.log(`🧩 Requeueing ${totalRequeued} pending webhook events`)
	}
}

const replayRetryableFailedWebhookEvents = async () => {
	const batchSize = 200
	let totalRequeued = 0
	const retryBefore = new Date(Date.now() - WEBHOOK_RETRY_COOLDOWN_MS)
	const replayWindowStart = new Date(
		Date.now() - WEBHOOK_REPLAY_WINDOW_HOURS * 60 * 60 * 1000,
	)

	while (true) {
		const failedEvents = await prisma.webhook_events.findMany({
			where: {
				status: 'failed',
				source: { in: ['whatsapp', 'instagram', 'tiktok'] },
				retry_count: { lt: WEBHOOK_MAX_RETRIES },
				updated_at: { lt: retryBefore },
				created_at: { gte: replayWindowStart },
			},
			orderBy: { updated_at: 'asc' },
			take: batchSize,
		})

		if (failedEvents.length === 0) {
			break
		}

		for (const event of failedEvents) {
			const claimed = await prisma.webhook_events.updateMany({
				where: {
					id: event.id,
					status: 'failed',
					retry_count: event.retry_count,
				},
				data: {
					status: 'pending',
					updated_at: new Date(),
				},
			})

			if (claimed.count === 0) continue

			const jobName = resolveWebhookInboundJobName(event.source)
			if (!jobName) continue
			const retryCount = event.retry_count ?? 0

			await webhookQueue.add(
				jobName,
				{
					payload: event.raw_payload,
					webhookEventId: event.id,
				},
				{
					jobId: `webhook-retry-${event.id}-r${retryCount + 1}-${Date.now()}`,
					attempts: WEBHOOK_REPLAY_JOB_ATTEMPTS,
					backoff: {
						type: 'exponential',
						delay: WEBHOOK_REPLAY_JOB_BACKOFF_MS,
					},
					removeOnComplete: 2000,
					removeOnFail: 2000,
				},
			)

			totalRequeued += 1
		}

		if (failedEvents.length < batchSize) {
			break
		}
	}

	if (totalRequeued > 0) {
		console.log(`♻️ Requeueing ${totalRequeued} retryable failed webhook events`)
	}
}

const replayPendingOutboundMessages = async () => {
	const batchSize = 500
	let totalRequeued = 0
	const replayBefore = new Date(Date.now() - 15 * 1000)

	while (true) {
		const pendingMessages = await prisma.messages.findMany({
			where: {
				message_type: 'outgoing',
				status: 'pending',
				is_deleted: false,
				conversation_id: { not: null },
				created_at: { lt: replayBefore },
			},
			select: { id: true },
			orderBy: { created_at: 'asc' },
			take: batchSize,
		})

		if (pendingMessages.length === 0) break

		for (const msg of pendingMessages) {
			await outboundMessageQueue.add(
				'outbound-messages',
				{ messageId: msg.id },
				{
					jobId: `outbound-replay-${msg.id}`,
					removeOnComplete: 2000,
					removeOnFail: 2000,
				},
			)
		}

		totalRequeued += pendingMessages.length
		if (pendingMessages.length < batchSize) break
	}

	if (totalRequeued > 0) {
		console.log(`📤 Requeueing ${totalRequeued} pending outbound messages`)
	}
}

if (WORKER_MODE_ENABLED) {
	if (SCHEDULER_MODE_ENABLED) {
		scheduleJobs().catch(console.error)
	}

	replayPendingWebhookEvents().catch(console.error)
	replayRetryableFailedWebhookEvents().catch(console.error)
	replayPendingOutboundMessages().catch(console.error)

	if (SCHEDULER_MODE_ENABLED) {
		dispatchDueScheduledBroadcasts().catch(console.error)
		dispatchDueChatbotFollowups().catch(console.error)
	}

	console.log(
		`👷 Workers initialized (APP_MODE=${APP_MODE}, scheduler=${SCHEDULER_MODE_ENABLED})`,
	)
} else {
	console.log(`ℹ️ Worker runtime skipped for APP_MODE=${APP_MODE}`)
}

export const __test__ = {
	normalizeWhatsappChannelProvider,
	buildBaileysBridgePayload,
	extractBaileysOutboundExternalId,
	resolveBaileysBridgeErrorMessage,
	dispatchWhatsAppProviderSend,
}
