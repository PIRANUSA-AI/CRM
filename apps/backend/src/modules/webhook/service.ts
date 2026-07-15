import prisma from '../../lib/prisma'
import { webhookQueue } from '../../lib/queue'
import { getRealtimeIO } from '../../lib/realtime'
import redis from '../../lib/redis'
import { ChatbotService } from '../chatbot/service'
import { ChatbotFollowupService } from '../chatbot/followup-service'
import {
	registerInboundPersonalLead,
	resolvePersonalLeadOwner,
} from '../personal-whatsapp-inbox/lead-access'
import { PersonalAiReplyService } from '../personal-whatsapp-inbox/ai-reply'
import { AIResponseLogService } from '../chatbot/response-log-service'
import { FlowRuntimeService } from '../flow/runtime-service'
import { MessageService } from '../message/service'
import { ConversationService } from '../conversation/service'
import { CHAT_ASSIGNABLE_ROLES } from '../../lib/require-role'
import { buildAiAnalytics } from '../conversation/ai-analytics'
import { CustomerService } from '../customer/service'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'
import { BUSINESS_WEBHOOK_EVENTS } from '../business-webhooks/constants'
import { PutObjectCommand } from '@aws-sdk/client-s3'
import crypto from 'crypto'
import {
	s3,
	BUCKET_NAME,
	buildS3PublicUrl,
	isS3UploadConfigured,
} from '../../lib/s3'

const MESSAGING_WINDOW_HOURS = 24
const META_GRAPH_VERSION = process.env.META_GRAPH_VERSION || 'v23.0'
const WEBHOOK_JOB_ATTEMPTS = Math.max(
	1,
	Number(process.env.WEBHOOK_JOB_ATTEMPTS || 5),
)
const WEBHOOK_JOB_BACKOFF_MS = Math.max(
	1_000,
	Number(process.env.WEBHOOK_JOB_BACKOFF_MS || 2_000),
)
const ENABLE_INBOX_FLOW_RUNTIME = !['0', 'false', 'no', 'off'].includes(
	String(process.env.ENABLE_INBOX_FLOW_RUNTIME ?? 'true').toLowerCase(),
)
const AI_BUBBLE_DELAY_ENABLED = !['0', 'false', 'no', 'off'].includes(
	String(process.env.AI_BUBBLE_DELAY_ENABLED ?? 'true').toLowerCase(),
)
const AI_BUBBLE_DELAY_MIN_MS = Math.max(
	0,
	Number(process.env.AI_BUBBLE_DELAY_MIN_MS || 1_000),
)
const AI_BUBBLE_DELAY_MAX_MS = Math.max(
	AI_BUBBLE_DELAY_MIN_MS,
	Number(process.env.AI_BUBBLE_DELAY_MAX_MS || 3_000),
)
const AI_AUTOREPLY_DEBOUNCE_ENABLED = !['0', 'false', 'no', 'off'].includes(
	String(process.env.AI_AUTOREPLY_DEBOUNCE_ENABLED ?? 'true').toLowerCase(),
)
const AI_AUTOREPLY_DEBOUNCE_MIN_SECONDS = Math.max(
	1,
	Number(process.env.AI_AUTOREPLY_DEBOUNCE_MIN_SECONDS || 3),
)
const AI_AUTOREPLY_DEBOUNCE_MAX_SECONDS = Math.max(
	AI_AUTOREPLY_DEBOUNCE_MIN_SECONDS,
	Number(process.env.AI_AUTOREPLY_DEBOUNCE_MAX_SECONDS || 5),
)
const AI_AUTOREPLY_DEBOUNCE_BURST_MIN_SECONDS = Math.max(
	AI_AUTOREPLY_DEBOUNCE_MAX_SECONDS,
	Number(process.env.AI_AUTOREPLY_DEBOUNCE_BURST_MIN_SECONDS || 5),
)
const AI_AUTOREPLY_DEBOUNCE_BURST_MAX_SECONDS = Math.max(
	AI_AUTOREPLY_DEBOUNCE_BURST_MIN_SECONDS,
	Number(process.env.AI_AUTOREPLY_DEBOUNCE_BURST_MAX_SECONDS || 10),
)
const AI_AUTOREPLY_BURST_WINDOW_SECONDS = Math.max(
	5,
	Number(process.env.AI_AUTOREPLY_BURST_WINDOW_SECONDS || 15),
)
const AI_AUTOREPLY_TOKEN_TTL_SECONDS = Math.max(
	30,
	Number(process.env.AI_AUTOREPLY_TOKEN_TTL_SECONDS || 300),
)
const AI_AUTOREPLY_JOB_ATTEMPTS = Math.max(
	1,
	Number(process.env.AI_AUTOREPLY_JOB_ATTEMPTS || 3),
)
const AI_AUTOREPLY_JOB_BACKOFF_MS = Math.max(
	1_000,
	Number(process.env.AI_AUTOREPLY_JOB_BACKOFF_MS || 2_000),
)
const AI_AGENT_HISTORY_LIMIT_MAX = Math.max(
	1,
	Number(process.env.AI_AGENT_HISTORY_LIMIT_MAX || 50),
)

function toFiniteNumber(value: unknown, fallback: number): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return fallback
	return parsed
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

function asUuidOrNull(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	if (normalized.length === 0) return null
	return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
		normalized,
	)
		? normalized
		: null
}

function asBoolean(value: unknown): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return Number.isFinite(value) && value !== 0
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized) return false
	return ['true', '1', 'yes', 'on', 'active'].includes(normalized)
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

function isConversationHandoffActive(
	conversation: {
		assignee_id?: string | null
		additional_attributes?: unknown
	} | null,
): boolean {
	if (!conversation) return false
	if (asUuidOrNull(conversation.assignee_id)) return true
	const additionalAttributes = asRecord(conversation.additional_attributes)
	return asBoolean(
		additionalAttributes.ai_handoff_active ??
			additionalAttributes.human_handoff_active ??
			additionalAttributes.handoff_active,
	)
}

function resolveConfiguredChatbotId(
	config: Record<string, unknown>,
): string | null {
	return (
		asUuidOrNull(config.default_chatbot_id) ||
		asUuidOrNull(config.defaultChatbotId) ||
		null
	)
}

type DistributionMethod = 'round_robin' | 'least_assigned'

function asUuidArray(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value
			.map((item) => asUuidOrNull(item))
			.filter((item): item is string => Boolean(item))
	}

	if (typeof value === 'string') {
		const normalized = value.trim()
		if (!normalized) return []
		try {
			const parsed = JSON.parse(normalized)
			if (Array.isArray(parsed)) {
				return parsed
					.map((item) => asUuidOrNull(item))
					.filter((item): item is string => Boolean(item))
			}
		} catch {
			return normalized
				.split(',')
				.map((item) => asUuidOrNull(item))
				.filter((item): item is string => Boolean(item))
		}
	}

	return []
}

function resolveConfiguredTeamIds(config: Record<string, unknown>): string[] {
	return Array.from(
		new Set([
			...asUuidArray(config.default_team_ids),
			...asUuidArray(config.defaultTeamIds),
		]),
	)
}

function resolveConfiguredAgentIds(config: Record<string, unknown>): string[] {
	return Array.from(
		new Set([
			...asUuidArray(config.default_agent_ids),
			...asUuidArray(config.defaultAgentIds),
		]),
	)
}

function resolveConfiguredDistributionMethod(
	config: Record<string, unknown>,
): DistributionMethod | null {
	const normalized = String(
		config.distribution_method || config.distributionMethod || '',
	)
		.trim()
		.toLowerCase()
	if (!normalized) return null
	if (normalized === 'least_assigned') return 'least_assigned'
	if (normalized === 'round_robin') return 'round_robin'
	return null
}

function normalizeStatusExtractedValue(value: string): string {
	return String(value || '')
		.trim()
		.replace(/^["'`]+|["'`]+$/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

function extractStatusArgumentValue(
	statusTimelineTexts: string[],
	key: 'reason' | 'division',
): string | null {
	for (const text of statusTimelineTexts) {
		const source = String(text || '')
		if (!source.trim()) continue

		const jsonMatch = source.match(
			new RegExp(`"${key}"\\s*:\\s*"([^"\\n\\r]+)"`, 'i'),
		)
		if (jsonMatch?.[1]) {
			const normalized = normalizeStatusExtractedValue(jsonMatch[1])
			if (normalized) return normalized
		}

		const plainMatch = source.match(
			new RegExp(`\\b${key}\\b\\s*[:=]\\s*([^\\n\\r,}]+)`, 'i'),
		)
		if (plainMatch?.[1]) {
			const normalized = normalizeStatusExtractedValue(plainMatch[1])
			if (normalized) return normalized
		}
	}
	return null
}

function extractPreferredDivisionName(
	statusTimelineTexts: string[],
): string | null {
	for (const text of statusTimelineTexts) {
		const match = text.match(/assigned to division:\s*([^\n\r]+)/i)
		const divisionName = match?.[1] ? String(match[1]).trim() : ''
		if (divisionName) return divisionName
	}
	return extractStatusArgumentValue(statusTimelineTexts, 'division')
}

function extractHandoffReason(statusTimelineTexts: string[]): string | null {
	return extractStatusArgumentValue(statusTimelineTexts, 'reason')
}

function hasExplicitHandoffStatus(statusTimelineTexts: string[]): boolean {
	return statusTimelineTexts.some((text) =>
		/(handing off to human agent|transfer to human|handoff to human|assigned this conversation to)/i.test(
			String(text || ''),
		),
	)
}

function isLikelyEscalationIntent(
	labelApplied: unknown,
	flowRuntimeVariables: Record<string, unknown> = {},
): boolean {
	const decision = asRecord(flowRuntimeVariables.decision)
	const decisionRouteTarget = String(
		asString(decision.route_target) || asString(flowRuntimeVariables['decision.route_target']) || '',
	).toLowerCase()
	if (decisionRouteTarget === 'handover') return true

	if (
		decision.requires_approval === true ||
		asBoolean(flowRuntimeVariables['decision.requires_approval']) ||
		asBoolean(flowRuntimeVariables['decision_requires_approval']) ||
		Boolean(asString(decision.handover_request_id)) ||
		Boolean(asString(flowRuntimeVariables['handover_request_id']))
	) {
		return true
	}

	const normalizedLabel = String(labelApplied || '')
		.trim()
		.toLowerCase()
	return normalizedLabel === 'handover' || normalizedLabel === 'handover_request'
}

function getExtensionFromMimeType(mimeType?: string): string {
	const mimeMap: Record<string, string> = {
		'image/jpeg': 'jpg',
		'image/jpg': 'jpg',
		'image/png': 'png',
		'image/webp': 'webp',
		'image/gif': 'gif',
		'video/mp4': 'mp4',
		'video/3gpp': '3gp',
		'audio/ogg': 'ogg',
		'audio/mpeg': 'mp3',
		'application/pdf': 'pdf',
	}

	if (!mimeType) return 'bin'
	return mimeMap[mimeType.toLowerCase()] || 'bin'
}

function toBigIntOrNull(value: unknown): bigint | null {
	if (typeof value === 'bigint') return value
	if (typeof value === 'number' && Number.isFinite(value)) {
		return BigInt(Math.trunc(value))
	}
	if (typeof value === 'string' && value.trim()) {
		try {
			return BigInt(value)
		} catch {
			return null
		}
	}
	return null
}

function isMetaProtectedMediaUrl(url: string): boolean {
	return (
		url.includes('lookaside.fbsbx.com') || url.includes('graph.facebook.com')
	)
}

function buildMessageMediaExtras(contentType: string, contentAttributes: any) {
	const media = contentAttributes?.media
	if (!media || typeof media !== 'object') return undefined

	const url =
		typeof media.url === 'string'
			? media.url
			: typeof media.local_url === 'string'
				? media.local_url
				: typeof media.media_url === 'string'
					? media.media_url
					: null

	if (!url) return undefined

	return {
		media: {
			type: contentType,
			url,
			mimeType:
				typeof media.mime_type === 'string'
					? media.mime_type
					: typeof media.mimeType === 'string'
						? media.mimeType
						: undefined,
			fileName:
				typeof media.filename === 'string'
					? media.filename
					: typeof media.file_name === 'string'
						? media.file_name
						: typeof media.fileName === 'string'
							? media.fileName
							: undefined,
		},
	}
}

function parseUnixTimestamp(value: unknown): Date {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return new Date(value * 1000)
	}

	if (typeof value === 'string') {
		const asNumber = Number(value)
		if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
			return new Date(asNumber * 1000)
		}
	}

	return new Date()
}

function isLowSignalHistoryContent(content: string): boolean {
	const text = String(content || '').trim()
	if (!text) return true

	const normalized = text.toLowerCase()
	if (
		normalized === '[ig_reel]' ||
		normalized === '[ig_story]' ||
		normalized === '[ig_media]'
	) {
		return true
	}

	if (/^test\d*$/i.test(normalized)) return true
	if (/^\d{1,8}$/.test(text)) return true

	return false
}

function extractStatusTimelineTexts(timeline: unknown[]): string[] {
	const texts: string[] = []

	for (const item of timeline) {
		if (!item || typeof item !== 'object') continue
		const record = item as Record<string, unknown>
		const type = String(record.type || '')
			.trim()
			.toLowerCase()
		if (type !== 'status') continue

		const text = String(record.text || '').trim()
		if (!text) continue
		if (texts.includes(text)) continue
		texts.push(text)
	}

	return texts
}

function splitAssistantTextForDelivery(content: string): string[] {
	const normalized = String(content || '')
		.replace(/\r\n/g, '\n')
		.trim()
	if (!normalized) return []

	const delimiterToken = '[[AI_SEGMENT_DELIMITER]]'
	const withDelimiters = normalized
		.replace(/(?:^|\n)\s*###\s*(?=\n|$)/g, `\n${delimiterToken}\n`)
		.replace(/\s+###\s+/g, `\n${delimiterToken}\n`)

	const chunks = withDelimiters
		.split(delimiterToken)
		.map((chunk) =>
			chunk
				.replace(/^\s*###\s*/gm, '')
				.replace(/[ \t]+\n/g, '\n')
				.replace(/\n{3,}/g, '\n\n')
				.trim(),
		)
		.filter(Boolean)

	if (chunks.length > 0) return chunks
	return [
		normalized
			.replace(/^\s*###\s*/gm, '')
			.replace(/[ \t]+\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim(),
	].filter(Boolean)
}

function resolveToolCallCount(value: unknown): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return 0
	return Math.max(0, Math.floor(parsed))
}

function resolveRandomAiBubbleDelayMs(): number {
	if (!AI_BUBBLE_DELAY_ENABLED) return 0
	if (AI_BUBBLE_DELAY_MAX_MS <= 0) return 0
	if (AI_BUBBLE_DELAY_MAX_MS <= AI_BUBBLE_DELAY_MIN_MS) {
		return AI_BUBBLE_DELAY_MIN_MS
	}
	return (
		AI_BUBBLE_DELAY_MIN_MS +
		Math.floor(
			Math.random() * (AI_BUBBLE_DELAY_MAX_MS - AI_BUBBLE_DELAY_MIN_MS + 1),
		)
	)
}

function resolveRandomIntInclusive(min: number, max: number): number {
	if (max <= min) return min
	return min + Math.floor(Math.random() * (max - min + 1))
}

function resolveAutoReplyDebounceDelayMs(burstCount: number): number {
	const [minSeconds, maxSeconds] =
		burstCount > 1
			? [
					AI_AUTOREPLY_DEBOUNCE_BURST_MIN_SECONDS,
					AI_AUTOREPLY_DEBOUNCE_BURST_MAX_SECONDS,
				]
			: [AI_AUTOREPLY_DEBOUNCE_MIN_SECONDS, AI_AUTOREPLY_DEBOUNCE_MAX_SECONDS]
	return resolveRandomIntInclusive(minSeconds * 1000, maxSeconds * 1000)
}

function buildAutoReplyBurstKey(conversationId: string): string {
	return `chatbot:auto-reply:burst:${conversationId}`
}

function buildAutoReplyLatestTokenKey(conversationId: string): string {
	return `chatbot:auto-reply:latest-token:${conversationId}`
}

type AutoReplyContact = {
	id: string
	name: string | null
	phone_number?: string | null
	identifier: string | null
	avatar_url?: string | null
	meta?: any
	metadata?: any
}

type AutoReplyParams = {
	appId: string
	inboxId: string
	conversationId: string
	incomingMessage?: any
	contact: AutoReplyContact
	channelType: 'whatsapp' | 'instagram' | 'tiktok'
	channelName: string | null
	channelBadgeUrl: string | null
	channelProvider?: string | null
	isNewLead: boolean
	aggregatePendingInbound?: boolean
	debounceToken?: string | null
}

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return
	await new Promise((resolve) => setTimeout(resolve, ms))
}

function mapWhatsAppMessageStatus(status: string | undefined) {
	switch ((status || '').toLowerCase()) {
		case 'sent':
			return 'sent'
		case 'delivered':
			return 'delivered'
		case 'read':
			return 'read'
		case 'failed':
			return 'failed'
		default:
			return 'sent'
	}
}

function extractMessageContent(message: any): {
	content: string
	contentType: WhatsAppInboundContentType
	contentAttributes: Record<string, any>
} {
	const type = String(message?.type || 'text')
	const contextId = message?.context?.id || null

	if (type === 'text') {
		return {
			content: message?.text?.body || '',
			contentType: 'text',
			contentAttributes: {
				type,
				text: message?.text || null,
				...(contextId ? { context: { message_id: contextId } } : {}),
			},
		}
	}

	if (
		type === 'image' ||
		type === 'video' ||
		type === 'audio' ||
		type === 'document'
	) {
		const media = message?.[type] || {}
		return {
			content: media.caption || `[${type.toUpperCase()}]`,
			contentType: type,
			contentAttributes: {
				type,
				media,
				...(contextId ? { context: { message_id: contextId } } : {}),
			},
		}
	}

	if (type === 'interactive') {
		const interactive = message?.interactive || {}
		const title =
			interactive?.button_reply?.title ||
			interactive?.list_reply?.title ||
			interactive?.list_reply?.description ||
			'Interactive response'
		return {
			content: title,
			contentType: 'interactive',
			contentAttributes: {
				type,
				interactive,
				...(contextId ? { context: { message_id: contextId } } : {}),
			},
		}
	}

	if (type === 'button') {
		return {
			content: message?.button?.text || 'Button response',
			contentType: 'button',
			contentAttributes: {
				type,
				button: message?.button || null,
				...(contextId ? { context: { message_id: contextId } } : {}),
			},
		}
	}

	return {
		content: `[${type.toUpperCase()}]`,
		contentType: 'text',
		contentAttributes: {
			type,
			raw: message?.[type] || null,
			...(contextId ? { context: { message_id: contextId } } : {}),
		},
	}
}

async function fetchMetaMediaMetadata(mediaId: string, accessToken: string) {
	const response = await fetch(
		`https://graph.facebook.com/${META_GRAPH_VERSION}/${mediaId}`,
		{
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		},
	)

	if (!response.ok) {
		const body = (await response.json().catch(() => null)) as any
		throw new Error(
			body?.error?.message ||
				`Failed to fetch media metadata (${response.status})`,
		)
	}

	return (await response.json()) as {
		id?: string
		url?: string
		mime_type?: string
		sha256?: string
		file_size?: number | string
	}
}

async function downloadMetaMediaBuffer(url: string, accessToken: string) {
	const response = await fetch(url, {
		...(isMetaProtectedMediaUrl(url)
			? {
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				}
			: {}),
	})

	if (!response.ok) {
		throw new Error(`Failed to download media binary (${response.status})`)
	}

	const arrayBuffer = await response.arrayBuffer()
	return Buffer.from(arrayBuffer)
}

async function persistInboundMediaToS3(params: {
	appId: string
	inboxId: string
	contentType: string
	externalMessageId: string
	accessToken: string
	media: any
}) {
	if (!isS3UploadConfigured()) return null

	const originalMedia = params.media || {}
	const mediaId = String(originalMedia?.id || '').trim()
	if (!mediaId) return null
	if (!params.accessToken?.trim()) return null

	let mediaUrl =
		typeof originalMedia?.url === 'string' ? originalMedia.url : undefined
	let mimeType =
		typeof originalMedia?.mime_type === 'string'
			? originalMedia.mime_type
			: undefined
	let sha256 =
		typeof originalMedia?.sha256 === 'string' ? originalMedia.sha256 : undefined
	let fileSize =
		typeof originalMedia?.file_size === 'number' ||
		typeof originalMedia?.file_size === 'string'
			? originalMedia.file_size
			: undefined

	try {
		if (!mediaUrl) {
			const metadata = await fetchMetaMediaMetadata(mediaId, params.accessToken)
			mediaUrl = metadata.url
			mimeType = metadata.mime_type || mimeType
			sha256 = metadata.sha256 || sha256
			fileSize = metadata.file_size || fileSize
		}

		if (!mediaUrl) return null

		let buffer: Buffer
		try {
			buffer = await downloadMetaMediaBuffer(mediaUrl, params.accessToken)
		} catch {
			const refreshed = await fetchMetaMediaMetadata(
				mediaId,
				params.accessToken,
			)
			if (!refreshed.url) throw new Error('Media URL not available')
			mediaUrl = refreshed.url
			mimeType = refreshed.mime_type || mimeType
			sha256 = refreshed.sha256 || sha256
			fileSize = refreshed.file_size || fileSize
			buffer = await downloadMetaMediaBuffer(mediaUrl, params.accessToken)
		}

		const extension = getExtensionFromMimeType(mimeType)
		const random = crypto.randomBytes(6).toString('hex')
		const key = `whatsapp/inbound/${params.appId}/${params.contentType}/${Date.now()}_${random}.${extension}`

		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET_NAME,
				Key: key,
				Body: buffer,
				ContentType: mimeType || undefined,
				Metadata: {
					appId: params.appId,
					inboxId: params.inboxId,
					mediaId,
					externalMessageId: params.externalMessageId,
					contentType: params.contentType,
				},
			}),
		)

		const publicUrl = buildS3PublicUrl(key)
		if (!publicUrl) return null

		return {
			mediaId,
			publicUrl,
			key,
			originalUrl: mediaUrl,
			mimeType: mimeType || null,
			sha256: sha256 || null,
			fileSize: fileSize ?? null,
		}
	} catch (error: any) {
		console.error('[WebhookService] Failed to persist inbound media:', error)
		return null
	}
}

function detectWhatsAppEventType(payload: any) {
	const normalizedBridgeEvent = asString(payload?.event)
	if (normalizedBridgeEvent) return normalizedBridgeEvent

	const changes =
		payload?.entry?.flatMap((entry: any) => entry?.changes || []) || []
	const hasMessages = changes.some(
		(change: any) =>
			Array.isArray(change?.value?.messages) &&
			change.value.messages.length > 0,
	)
	const hasStatuses = changes.some(
		(change: any) =>
			Array.isArray(change?.value?.statuses) &&
			change.value.statuses.length > 0,
	)

	if (hasMessages) return 'message.received'
	if (hasStatuses) return 'message.status'
	return 'webhook.received'
}

type WhatsAppInboundContentType =
	| 'text'
	| 'image'
	| 'video'
	| 'gif'
	| 'audio'
	| 'voice'
	| 'document'
	| 'sticker'
	| 'reaction'
	| 'interactive'
	| 'button'

type NormalizedWhatsAppInboundMessage = {
	externalMessageId: string
	senderWaId: string
	senderJid?: string | null
	contactName: string
	messageAt: Date
	content: string
	contentType: WhatsAppInboundContentType
	contentAttributes: Record<string, any>
	replyToExternalId?: string | null
	rawPayload?: unknown
}

type StoredWhatsAppInboundResult =
	| {
			status: 'duplicate'
	  }
	| {
			status: 'created'
			appId: string
			inboxId: string
			conversationId: string
			message: any
			contact: {
				id: string
				name: string | null
				phone_number: string | null
				identifier: string | null
			}
			channelName: string | null
			channelBadgeUrl: string | null
			channelProvider: string | null
			isNewLead: boolean
	  }

function normalizeBridgeWhatsAppContentType(
	value: unknown,
): WhatsAppInboundContentType {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (normalized === 'image') return 'image'
	if (normalized === 'video') return 'video'
	if (normalized === 'gif') return 'gif'
	if (normalized === 'audio') return 'audio'
	if (normalized === 'voice') return 'voice'
	if (normalized === 'document' || normalized === 'file') return 'document'
	if (normalized === 'sticker') return 'sticker'
	if (normalized === 'reaction') return 'reaction'
	if (normalized === 'interactive') return 'interactive'
	if (normalized === 'button') return 'button'
	return 'text'
}

function parseBridgeWhatsAppTimestamp(value: unknown): Date {
	if (value instanceof Date && !Number.isNaN(value.getTime())) return value

	if (typeof value === 'number' && Number.isFinite(value)) {
		const asMillis = value > 1_000_000_000_000 ? value : value * 1000
		return new Date(asMillis)
	}

	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) return new Date()

		const asNumber = Number(trimmed)
		if (!Number.isNaN(asNumber) && Number.isFinite(asNumber)) {
			const asMillis =
				asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000
			return new Date(asMillis)
		}

		const parsed = new Date(trimmed)
		if (!Number.isNaN(parsed.getTime())) return parsed
	}

	return new Date()
}

function buildInstagramInboxIdCandidates(
	rawIds: Array<string | null | undefined>,
) {
	const normalized = rawIds
		.map((value) => String(value || '').trim())
		.filter((value) => value.length > 0)
	const uniqueIds = Array.from(new Set(normalized))

	const numericIds = uniqueIds
		.map((value) => Number(value))
		.filter((value) => Number.isFinite(value))
	const uniqueNumericIds = Array.from(new Set(numericIds))

	return { uniqueIds, uniqueNumericIds }
}

async function findInstagramInbox(
	candidateIds: Array<string | null | undefined>,
) {
	const { uniqueIds, uniqueNumericIds } =
		buildInstagramInboxIdCandidates(candidateIds)
	if (uniqueIds.length === 0) return null

	const jsonIdMatchers: Array<Record<string, unknown>> = []
	for (const candidateId of uniqueIds) {
		jsonIdMatchers.push({
			channel_config: { path: ['instagram_id'], equals: candidateId },
		})
		jsonIdMatchers.push({
			channel_config: { path: ['fb_page_id'], equals: candidateId },
		})
	}
	for (const numericCandidateId of uniqueNumericIds) {
		jsonIdMatchers.push({
			channel_config: { path: ['instagram_id'], equals: numericCandidateId },
		})
		jsonIdMatchers.push({
			channel_config: { path: ['fb_page_id'], equals: numericCandidateId },
		})
	}

	const inbox = await prisma.inboxes.findFirst({
		where: {
			channel_type: 'instagram',
			is_active: true,
			deleted_at: null,
			OR: jsonIdMatchers,
		},
	})

	if (!inbox) return null

	const config = inbox.channel_config as any
	return {
		id: inbox.id,
		app_id: inbox.app_id!,
		name: inbox.name,
		config: {
			access_token: config.access_token,
			page_access_token: config.page_access_token,
			fb_page_id: config.fb_page_id,
			instagram_id: config.instagram_id,
			username: config.username,
			profile_picture_url: config.profile_picture_url,
		},
	}
}

async function findTikTokInbox(candidateIds: Array<string | null | undefined>) {
	const uniqueIds = Array.from(
		new Set(
			candidateIds
				.map((value) => String(value || '').trim())
				.filter((value) => value.length > 0),
		),
	)
	if (uniqueIds.length === 0) return null

	const jsonMatchers: Array<Record<string, unknown>> = []
	for (const candidateId of uniqueIds) {
		jsonMatchers.push({
			channel_config: { path: ['tiktok_id'], equals: candidateId },
		})
		jsonMatchers.push({
			channel_config: { path: ['open_id'], equals: candidateId },
		})
		jsonMatchers.push({
			channel_config: { path: ['account_id'], equals: candidateId },
		})
	}

	const inbox = await prisma.inboxes.findFirst({
		where: {
			channel_type: 'tiktok',
			is_active: true,
			deleted_at: null,
			OR: jsonMatchers,
		},
	})
	if (!inbox) return null

	const config = asRecord(inbox.channel_config)
	return {
		id: inbox.id,
		app_id: inbox.app_id!,
		name: inbox.name,
		config: {
			tiktok_id: config.tiktok_id,
			open_id: config.open_id,
			account_id: config.account_id,
			display_name: config.display_name,
			avatar_url: config.avatar_url,
			access_token: config.access_token,
			refresh_token: config.refresh_token,
			token_expires_at: config.token_expires_at,
		},
	}
}

function parseTikTokTimestamp(value: unknown): Date {
	const asNumber = Number(value)
	if (Number.isFinite(asNumber) && asNumber > 0) {
		const asMillis = asNumber > 1_000_000_000_000 ? asNumber : asNumber * 1000
		return new Date(asMillis)
	}
	return new Date()
}

function normalizeTikTokMediaType(
	value: unknown,
): 'image' | 'video' | 'audio' | 'document' | null {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized) return null
	if (['image', 'photo', 'picture'].includes(normalized)) return 'image'
	if (['video', 'clip'].includes(normalized)) return 'video'
	if (['audio', 'voice'].includes(normalized)) return 'audio'
	if (['file', 'document', 'doc'].includes(normalized)) return 'document'
	return null
}

type NormalizedTikTokInboundEvent = {
	senderId: string
	recipientId: string
	messageId: string
	text: string
	contentType: 'text' | 'image' | 'video' | 'audio' | 'document'
	mediaUrl: string | null
	mediaMimeType: string | null
	mediaFileName: string | null
	timestamp: Date
	raw: Record<string, unknown>
}

function parseTikTokContentRecord(value: unknown): Record<string, unknown> {
	if (!value) return {}
	if (typeof value === 'string') {
		const trimmed = value.trim()
		if (!trimmed) return {}
		try {
			return asRecord(JSON.parse(trimmed))
		} catch {
			return {}
		}
	}
	return asRecord(value)
}

function normalizeTikTokInboundEvents(
	payload: any,
): NormalizedTikTokInboundEvent[] {
	const baseEvents = Array.isArray(payload?.events)
		? payload.events
		: Array.isArray(payload?.data)
			? payload.data
			: Array.isArray(payload?.entry)
				? payload.entry.flatMap((entry: any) =>
						Array.isArray(entry?.messaging) ? entry.messaging : [entry],
					)
				: payload
					? [payload]
					: []

	const normalizedEvents: NormalizedTikTokInboundEvent[] = []
	for (const baseEvent of baseEvents) {
		const record = asRecord(baseEvent)
		const recordContent = parseTikTokContentRecord(record.content)
		const contentMessage = asRecord(recordContent.message)
		const contentData = asRecord(recordContent.data)
		const messageRecord = asRecord(
			record.message ||
				record.data ||
				contentMessage ||
				contentData ||
				recordContent ||
				record.event ||
				record,
		)
		const messageContentRecord = parseTikTokContentRecord(messageRecord.content)
		const senderRecord = asRecord(
			record.sender ||
				messageRecord.sender ||
				recordContent.sender ||
				contentMessage.sender ||
				messageContentRecord.sender ||
				{},
		)
		const recipientRecord = asRecord(
			record.recipient ||
				messageRecord.recipient ||
				recordContent.recipient ||
				contentMessage.recipient ||
				messageContentRecord.recipient ||
				{},
		)
		const fromRecord = asRecord(
			record.from ||
				messageRecord.from ||
				recordContent.from ||
				contentMessage.from ||
				messageContentRecord.from ||
				{},
		)
		const toRecord = asRecord(
			record.to ||
				messageRecord.to ||
				recordContent.to ||
				contentMessage.to ||
				messageContentRecord.to ||
				{},
		)

		const senderId = String(
			senderRecord.id ||
				senderRecord.open_id ||
				fromRecord.id ||
				fromRecord.open_id ||
				record.sender_id ||
				messageRecord.sender_id ||
				messageRecord.from_user_id ||
				recordContent.sender_id ||
				recordContent.from_user_id ||
				contentMessage.sender_id ||
				contentMessage.from_user_id ||
				messageContentRecord.sender_id ||
				messageContentRecord.from_user_id ||
				'',
		).trim()
		const recipientId = String(
			recipientRecord.id ||
				recipientRecord.open_id ||
				toRecord.id ||
				toRecord.open_id ||
				record.recipient_id ||
				messageRecord.recipient_id ||
				messageRecord.to_user_id ||
				record.user_openid ||
				messageRecord.user_openid ||
				recordContent.user_openid ||
				recordContent.recipient_id ||
				recordContent.to_user_id ||
				contentMessage.recipient_id ||
				contentMessage.to_user_id ||
				messageContentRecord.recipient_id ||
				messageContentRecord.to_user_id ||
				record.account_id ||
				messageRecord.account_id ||
				recordContent.account_id ||
				contentMessage.account_id ||
				'',
		).trim()
		const messageId = String(
			record.message_id ||
				messageRecord.message_id ||
				recordContent.message_id ||
				contentMessage.message_id ||
				messageContentRecord.message_id ||
				messageRecord.mid ||
				recordContent.mid ||
				contentMessage.mid ||
				record.mid ||
				'',
		).trim()

		if (!senderId || !recipientId || !messageId) continue

		const text = String(
			asString(messageRecord.text) ||
				asString(asRecord(messageRecord.text).text) ||
				asString(messageContentRecord.text) ||
				asString(asRecord(messageContentRecord.text).text) ||
				asString(recordContent.text) ||
				asString(contentMessage.text) ||
				asString(asRecord(contentMessage.text).text) ||
				asString(asRecord(messageRecord.content).text) ||
				record.text ||
				record.content ||
				'',
		).trim()

		const contentRecord = {
			...recordContent,
			...messageContentRecord,
			...asRecord(messageRecord.content),
			...asRecord(contentMessage.content),
		}
		const contentAttachments = contentRecord.attachments
		const attachmentsRaw: unknown[] = Array.isArray(messageRecord.attachments)
			? messageRecord.attachments
			: Array.isArray(contentMessage.attachments)
				? (contentMessage.attachments as unknown[])
				: Array.isArray(recordContent.attachments)
					? (recordContent.attachments as unknown[])
					: Array.isArray(messageContentRecord.attachments)
						? (messageContentRecord.attachments as unknown[])
						: Array.isArray(asRecord(messageRecord.media).attachments)
							? (asRecord(messageRecord.media).attachments as unknown[])
							: []
		const firstAttachment = asRecord(attachmentsRaw[0])
		const firstAttachmentPayload = asRecord(firstAttachment.payload)
		const mediaRecord = {
			...asRecord(recordContent.media),
			...asRecord(contentMessage.media),
			...asRecord(messageContentRecord.media),
			...asRecord(messageRecord.media),
		}

		const mediaType =
			normalizeTikTokMediaType(
				firstAttachment.type ||
					firstAttachment.media_type ||
					firstAttachmentPayload.media_type ||
					messageRecord.media_type ||
					recordContent.media_type ||
					contentMessage.media_type ||
					messageContentRecord.media_type ||
					mediaRecord.media_type ||
					'',
			) || null
		const mediaUrl = String(
			firstAttachmentPayload.url ||
				firstAttachment.url ||
				messageRecord.media_url ||
				recordContent.media_url ||
				contentMessage.media_url ||
				messageContentRecord.media_url ||
				mediaRecord.url ||
				mediaRecord.media_url ||
				'',
		).trim()
		const mediaMimeType = String(
			firstAttachmentPayload.mime_type ||
				firstAttachment.mime_type ||
				recordContent.mime_type ||
				contentMessage.mime_type ||
				messageContentRecord.mime_type ||
				mediaRecord.mime_type ||
				'',
		).trim()
		const mediaFileName = String(
			firstAttachmentPayload.file_name ||
				firstAttachment.file_name ||
				recordContent.file_name ||
				contentMessage.file_name ||
				messageContentRecord.file_name ||
				mediaRecord.file_name ||
				'',
		).trim()

		const contentType = mediaType || 'text'
		const contentText =
			text || (contentType === 'text' ? '' : `[${contentType}]`)

		normalizedEvents.push({
			senderId,
			recipientId,
			messageId,
			text: contentText,
			contentType,
			mediaUrl: mediaUrl || null,
			mediaMimeType: mediaMimeType || null,
			mediaFileName: mediaFileName || null,
			timestamp: parseTikTokTimestamp(
				record.timestamp ||
					record.time ||
					record.event_time ||
					record.create_time ||
					messageRecord.timestamp ||
					messageRecord.create_time ||
					recordContent.timestamp ||
					recordContent.create_time ||
					contentMessage.timestamp ||
					contentMessage.create_time ||
					messageContentRecord.timestamp ||
					messageContentRecord.create_time ||
					0,
			),
			raw: record,
		})
	}

	return normalizedEvents
}

export function extractInstagramMessageContent(message: {
	text?: string
	attachments?: Array<{
		type: string
		payload: {
			url: string
			sticker_id?: number
			reel_video_id?: string
		}
	}>
	reply_to?: { mid: string }
}): {
	content: string
	contentType: string
	contentAttributes: Record<string, any>
} {
	const replyTo = message.reply_to
		? { reply_to: { mid: message.reply_to.mid } }
		: {}

	// Text-only message (no attachments)
	if (message.text && !message.attachments?.length) {
		return {
			content: message.text,
			contentType: 'text',
			contentAttributes: { ...replyTo },
		}
	}

	// Message with attachments
	if (message.attachments?.length) {
		const attachment = message.attachments[0]
		const type = attachment.type

		const contentTypeMap: Record<string, string> = {
			image: 'image',
			video: 'video',
			audio: 'audio',
			file: 'document',
			share: 'link',
			story_mention: 'story_mention',
			reel: 'reel',
		}

		const contentType = contentTypeMap[type] || 'text'
		const content = message.text || `[${type}]`

		return {
			content,
			contentType,
			contentAttributes: {
				media: {
					url: attachment.payload.url,
					type: contentType,
					sticker_id: attachment.payload.sticker_id,
					reel_video_id: attachment.payload.reel_video_id,
				},
				...replyTo,
			},
		}
	}

	// Fallback: no text and no attachments
	return {
		content: message.text || '',
		contentType: 'text',
		contentAttributes: { ...replyTo },
	}
}

async function fetchInstagramUserProfile(
	userId: string,
	accessToken: string,
	igBusinessAccountId?: string,
): Promise<{
	name: string | null
	username: string | null
	profilePicture: string | null
	followerCount: number | null
	isUserFollowBusiness: boolean | null
	isBusinessFollowUser: boolean | null
} | null> {
	try {
		const buildUrl = (baseUrl: string, fields: string) => {
			const url = new URL(`${baseUrl}/v23.0/${userId}`)
			url.searchParams.set('fields', fields)
			url.searchParams.set('access_token', accessToken)
			return url.toString()
		}

		// NOTE:
		// `graph.instagram.com` exposes `profile_pic`, not `profile_picture_url`.
		// Using the wrong field returns 400 and silently prevents profile enrichment.
		const primaryResponse = await fetch(
			buildUrl(
				'https://graph.instagram.com',
				'id,username,name,profile_pic,follower_count,is_user_follow_business,is_business_follow_user',
			),
		)

		if (primaryResponse.ok) {
			const data: any = await primaryResponse.json()
			console.log(
				`[fetchInstagramUserProfile] Got profile for ${userId}:`,
				JSON.stringify(data),
			)
			return {
				name: data.name || data.username || null,
				username: data.username || null,
				profilePicture: data.profile_pic || null,
				followerCount:
					typeof data.follower_count === 'number' ? data.follower_count : null,
				isUserFollowBusiness:
					typeof data.is_user_follow_business === 'boolean'
						? data.is_user_follow_business
						: null,
				isBusinessFollowUser:
					typeof data.is_business_follow_user === 'boolean'
						? data.is_business_follow_user
						: null,
			}
		}

		const primaryErrorBody = await primaryResponse.text()
		console.warn(
			`[fetchInstagramUserProfile] IG API failed for ${userId} (${primaryResponse.status}):`,
			primaryErrorBody,
		)

		// Fallback: keep minimal fields in case advanced relationship fields are unavailable.
		const fallbackResponse = await fetch(
			buildUrl('https://graph.instagram.com', 'id,username,name,profile_pic'),
		)

		if (fallbackResponse.ok) {
			const fallbackData: any = await fallbackResponse.json()
			console.log(
				`[fetchInstagramUserProfile] Got fallback profile for ${userId}:`,
				JSON.stringify(fallbackData),
			)
			return {
				name: fallbackData.name || fallbackData.username || null,
				username: fallbackData.username || null,
				profilePicture: fallbackData.profile_pic || null,
				followerCount: null,
				isUserFollowBusiness: null,
				isBusinessFollowUser: null,
			}
		}

		const fallbackErrorBody = await fallbackResponse.text()
		console.warn(
			`[fetchInstagramUserProfile] IG fallback API also failed for ${userId} (${fallbackResponse.status}):`,
			fallbackErrorBody,
		)
		return null
	} catch (error) {
		console.warn(
			`[fetchInstagramUserProfile] Error fetching profile for ${userId}:`,
			error,
		)
		return null
	}
}

async function persistInstagramMediaToS3(params: {
	appId: string
	inboxId: string
	contentType: string
	externalMessageId: string
	mediaUrl: string
	accessToken: string
}): Promise<{
	mediaId: string
	publicUrl: string
	key: string
	originalUrl: string
	mimeType: string | null
	fileSize: number | null
} | null> {
	if (!isS3UploadConfigured()) return null
	if (!params.mediaUrl?.trim()) return null

	try {
		const response = await fetch(params.mediaUrl, {
			headers: params.accessToken?.trim()
				? { Authorization: `Bearer ${params.accessToken}` }
				: undefined,
		})

		if (!response.ok) {
			console.error(
				`[persistInstagramMediaToS3] Download failed (${response.status}) for ${params.mediaUrl}`,
			)
			return null
		}

		const mimeType =
			response.headers.get('content-type')?.split(';')[0]?.trim() || null
		const arrayBuffer = await response.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const fileSize = buffer.length

		const extension = getExtensionFromMimeType(mimeType || undefined)
		const mediaId = crypto.randomUUID()
		const random = crypto.randomBytes(6).toString('hex')
		const filename = `${random}.${extension}`
		const key = `${params.appId}/instagram/${params.inboxId}/${params.externalMessageId}/${filename}`

		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET_NAME,
				Key: key,
				Body: buffer,
				ContentType: mimeType || undefined,
				Metadata: {
					appId: params.appId,
					inboxId: params.inboxId,
					externalMessageId: params.externalMessageId,
					contentType: params.contentType,
				},
			}),
		)

		const publicUrl = buildS3PublicUrl(key)
		if (!publicUrl) return null

		return {
			mediaId,
			publicUrl,
			key,
			originalUrl: params.mediaUrl,
			mimeType,
			fileSize: fileSize > 0 ? fileSize : null,
		}
	} catch (error: any) {
		console.error(
			'[persistInstagramMediaToS3] Failed to persist Instagram media:',
			error,
		)
		return null
	}
}

export abstract class WebhookService {
	// Outbound Webhooks (Management)
	static async getWebhooks(accountId: string) {
		return prisma.webhooks.findMany({
			where: { account_id: accountId },
		})
	}

	static async createWebhook(accountId: string, data: any) {
		return prisma.webhooks.create({
			data: {
				account_id: accountId,
				url: data.url,
				subscriptions:
					Array.isArray(data.events) && data.events.length > 0
						? data.events
						: [...BUSINESS_WEBHOOK_EVENTS],
			},
		})
	}

	static async deleteWebhook(id: string) {
		return prisma.webhooks.delete({
			where: { id },
		})
	}

	// Inbound Webhooks (Processing)
	static async processWhatsAppPayload(payload: any) {
		const webhookEvent = await prisma.webhook_events.create({
			data: {
				source: 'whatsapp',
				event_type: detectWhatsAppEventType(payload),
				raw_payload: payload as any,
				status: 'pending',
			},
		})

		await webhookQueue.add(
			'whatsapp-inbound',
			{
				payload,
				webhookEventId: webhookEvent.id,
			},
			{
				jobId: `webhook-${webhookEvent.id}`,
				attempts: WEBHOOK_JOB_ATTEMPTS,
				backoff: { type: 'exponential', delay: WEBHOOK_JOB_BACKOFF_MS },
				removeOnComplete: 2000,
				removeOnFail: 2000,
			},
		)

		return { success: true }
	}

	static async processInstagramPayload(payload: any) {
		const webhookEvent = await prisma.webhook_events.create({
			data: {
				source: 'instagram',
				event_type: 'message.received',
				raw_payload: payload as any,
				status: 'pending',
			},
		})

		await webhookQueue.add(
			'instagram-inbound',
			{
				payload,
				webhookEventId: webhookEvent.id,
			},
			{
				jobId: `webhook-${webhookEvent.id}`,
				attempts: WEBHOOK_JOB_ATTEMPTS,
				backoff: { type: 'exponential', delay: WEBHOOK_JOB_BACKOFF_MS },
				removeOnComplete: 2000,
				removeOnFail: 2000,
			},
		)

		return { success: true }
	}

	static async processTikTokPayload(payload: any) {
		const webhookEvent = await prisma.webhook_events.create({
			data: {
				source: 'tiktok',
				event_type: 'message.received',
				raw_payload: payload as any,
				status: 'pending',
			},
		})

		await webhookQueue.add(
			'tiktok-inbound',
			{
				payload,
				webhookEventId: webhookEvent.id,
			},
			{
				jobId: `webhook-${webhookEvent.id}`,
				attempts: WEBHOOK_JOB_ATTEMPTS,
				backoff: { type: 'exponential', delay: WEBHOOK_JOB_BACKOFF_MS },
				removeOnComplete: 2000,
				removeOnFail: 2000,
			},
		)

		return { success: true }
	}

	private static async processCreatedWhatsAppInboundResult(
		result: Extract<StoredWhatsAppInboundResult, { status: 'created' }>,
	) {
		let personalLeadOwnerUserId: string | null = null
		try {
			await ChatbotFollowupService.clearOnInboundContactMessage(
				result.conversationId,
			)
		} catch (followupStateError) {
			console.error(
				'[WebhookService] Failed clearing chatbot follow-up state (fail-open):',
				followupStateError,
			)
		}

		if (result.channelProvider === 'baileys') {
			const owner = await resolvePersonalLeadOwner(result.appId, result.inboxId)
			if (!owner) {
				console.warn('[WebhookService] Personal WhatsApp inbound held because its sales owner is missing.', {
					appId: result.appId,
					inboxId: result.inboxId,
					conversationId: result.conversationId,
				})
				await this.emitMessageCreatedEvent({
					appId: result.appId,
					conversationId: result.conversationId,
					message: result.message,
					contact: result.contact,
					channelName: result.channelName,
					channelBadgeUrl: result.channelBadgeUrl,
					channelProvider: result.channelProvider,
				})
				return
			}
			personalLeadOwnerUserId = owner.owner_user_id

			const registration = await registerInboundPersonalLead({
				appId: result.appId,
				ownerUserId: owner.owner_user_id,
				phoneNumber: result.contact.phone_number || '',
				contactId: result.contact.id,
				conversationId: result.conversationId,
				displayName: result.contact.name,
			})
			const conversation = await prisma.conversations.findUnique({
				where: { id: result.conversationId },
				select: { additional_attributes: true },
			})
			await prisma.conversations.update({
				where: { id: result.conversationId },
				data: {
					additional_attributes: {
						...asRecord(conversation?.additional_attributes),
						personal_whatsapp: {
							owner_user_id: owner.owner_user_id,
							lead_registration_id: registration?.id || null,
							lead_status: registration?.status || 'pending',
						},
					} as any,
					...(registration?.status === 'blocked' ? { unread_count: 0 } : {}),
					updated_at: new Date(),
				},
			})

			if (registration?.status !== 'confirmed') {
				await this.emitMessageCreatedEvent({
					appId: result.appId,
					conversationId: result.conversationId,
					message: result.message,
					contact: result.contact,
					channelName: result.channelName,
					channelBadgeUrl: result.channelBadgeUrl,
					channelProvider: result.channelProvider,
				})
				getRealtimeIO()?.to(`app:${result.appId}`).emit('personal-lead:updated', {
					registrationId: registration?.id || null,
					status: registration?.status || 'pending',
					conversationId: result.conversationId,
				})
				return
			}
		}
		void BusinessWebhookDispatchService.dispatch({
			event: 'message.received',
			appId: result.appId,
			inboxId: result.inboxId,
			payload: {
				source: 'whatsapp',
				conversation: {
					id: result.conversationId,
					app_id: result.appId,
					inbox_id: result.inboxId,
				},
				message: {
					id: result.message.id,
					external_id: result.message.external_id || null,
					content: result.message.content,
					content_type: result.message.content_type,
					sender_type: result.message.sender_type,
					status: result.message.status,
					created_at: result.message.created_at,
				},
				contact: result.contact,
			},
		})
		if (result.isNewLead) {
			void BusinessWebhookDispatchService.dispatch({
				event: 'conversation.created',
				appId: result.appId,
				inboxId: result.inboxId,
				payload: {
					source: 'whatsapp',
					conversation: {
						id: result.conversationId,
						app_id: result.appId,
						inbox_id: result.inboxId,
						channel_type: 'whatsapp',
						status: 'open',
					},
					contact: result.contact,
					trigger: {
						event: 'message.received',
						message_id: result.message.id,
					},
				},
			})
		}
		await this.emitMessageCreatedEvent({
			appId: result.appId,
			conversationId: result.conversationId,
			message: result.message,
			contact: result.contact,
			channelName: result.channelName,
			channelBadgeUrl: result.channelBadgeUrl,
			channelProvider: result.channelProvider,
		})

		if (result.channelProvider === 'baileys' && personalLeadOwnerUserId) {
			// Pending and blocked personal leads return above. The worker revalidates
			// this state, while the deterministic job ID prevents duplicate analysis.
			try {
				const { enqueueTaskAnalysis } = await import('../tasks/worker')
				await enqueueTaskAnalysis({
					appId: result.appId,
					messageId: String(result.message.id),
					ownerUserId: personalLeadOwnerUserId,
				})
			} catch (taskAnalysisError) {
				console.error(
					'[WebhookService] Failed to enqueue task analysis (fail-open):',
					taskAnalysisError,
				)
			}

			await PersonalAiReplyService.scheduleInbound({
				appId: result.appId,
				ownerUserId: personalLeadOwnerUserId,
				conversationId: result.conversationId,
				inboundMessageId: result.message.id,
			})
			return
		}

		let skipChatbotAutoReply = false
		if (ENABLE_INBOX_FLOW_RUNTIME) {
			const hasCustomerData =
				Boolean(asUuidOrNull(result.contact?.id)) &&
				(Boolean(asString(result.contact.phone_number)) ||
					Boolean(asString(result.contact.identifier)))
			if (!hasCustomerData) {
				console.warn(
					'[WebhookService] WhatsApp inbound skipped flow runtime due incomplete contact data.',
					{
						conversationId: result.conversationId,
						contactId: result.contact.id || null,
					},
				)
			} else {
				try {
					const flowRuntimeResult = await FlowRuntimeService.executeInbound({
						appId: result.appId,
						inboxId: result.inboxId,
						conversationId: result.conversationId,
						incomingMessage: result.message,
						contact: result.contact,
						channelType: 'whatsapp',
						channelName: result.channelName,
						channelBadgeUrl: result.channelBadgeUrl,
					})
					skipChatbotAutoReply = flowRuntimeResult.skipChatbot
				} catch (flowRuntimeError) {
					console.error(
						'[WebhookService] Flow runtime failed (fail-open):',
						flowRuntimeError,
					)
				}
			}
		}

		if (!skipChatbotAutoReply) {
			try {
				await this.scheduleChatbotAutoReply({
					appId: result.appId,
					inboxId: result.inboxId,
					conversationId: result.conversationId,
					incomingMessage: result.message,
					contact: result.contact,
					channelType: 'whatsapp',
					channelName: result.channelName,
					channelBadgeUrl: result.channelBadgeUrl,
					isNewLead: result.isNewLead,
				})
			} catch (autoReplyError) {
				console.error(
					'[WebhookService] Failed to process chatbot auto-reply:',
					autoReplyError,
				)
			}
		}
	}

	private static async handleNormalizedBridgeWhatsAppInbound(
		payload: any,
		webhookEventId?: string,
	) {
		const stats = {
			messagesCreated: 0,
			statusesUpdated: 0,
			duplicates: 0,
			unknownChannel: 0,
			errors: 0,
		}
		const errors: string[] = []
		let resolvedAppId: string | null = null
		let resolvedInboxId: string | null = null

		try {
			const event = asString(payload?.event)?.toLowerCase() || 'webhook.received'
			const channelKey =
				asString(payload?.channelKey) || asString(payload?.channel_key)
			if (!channelKey) {
				stats.errors += 1
				errors.push('Baileys webhook missing channelKey')
				return { success: false, stats, errors }
			}

			const channel = await prisma.whatsapp_channels.findFirst({
				where: {
					provider: 'baileys',
					deleted_at: null,
					extended_metadata: {
						path: ['provider_channel_key'],
						equals: channelKey,
					},
				},
				select: {
					id: true,
					app_id: true,
					inbox_id: true,
					name: true,
					badge_url: true,
					api_key: true,
					provider: true,
				},
			})

			if (!channel?.app_id || !channel?.inbox_id) {
				stats.unknownChannel += 1
				errors.push(`Baileys channel not found for channelKey=${channelKey}`)
				return { success: false, stats, errors }
			}

			const resolvedChannel = {
				id: channel.id,
				app_id: channel.app_id,
				inbox_id: channel.inbox_id,
				name: channel.name,
				badge_url: channel.badge_url,
				api_key: channel.api_key,
				provider: channel.provider,
			}

			resolvedAppId = resolvedChannel.app_id
			resolvedInboxId = resolvedChannel.inbox_id

			if (event === 'message.received') {
				const messageRecord = asRecord(payload?.message)
				const contactRecord = asRecord(payload?.contact)
				const externalMessageId =
					asString(messageRecord.id) ||
					asString(messageRecord.externalId) ||
					asString(messageRecord.external_id)
				const senderJid =
					normalizeWhatsappJid(
						asString(messageRecord.fromJid) ||
							asString(messageRecord.from_jid) ||
							asString(contactRecord.waJid) ||
							asString(contactRecord.wa_jid) ||
							asString(contactRecord.whatsappJid) ||
							asString(contactRecord.whatsapp_jid) ||
							asString(payload?.fromJid) ||
							asString(payload?.from_jid) ||
							asString(payload?.waJid) ||
							asString(payload?.wa_jid) ||
							asString(messageRecord.from),
					) || null
				const senderWaId =
					getWaIdFromJid(senderJid) ||
					asString(messageRecord.from) ||
					asString(contactRecord.waId) ||
					asString(contactRecord.wa_id) ||
					asString(payload?.from)
				if (!externalMessageId || !senderWaId) {
					stats.errors += 1
					errors.push('Baileys inbound message missing id or sender')
					return { success: false, stats, errors }
				}

				const contentType = normalizeBridgeWhatsAppContentType(
					messageRecord.type || payload?.type,
				)
				const mediaUrl =
					asString(messageRecord.mediaUrl) ||
					asString(messageRecord.media_url) ||
					asString(messageRecord.url)
				const textContent =
					asString(messageRecord.text) ||
					asString(messageRecord.content) ||
					asString(messageRecord.body) ||
					asString(messageRecord.caption) ||
					''
				const replyToExternalId =
					asString(messageRecord.replyToExternalId) ||
					asString(messageRecord.reply_to_external_id) ||
					asString(messageRecord.replyToMessageId) ||
					asString(messageRecord.reply_to_message_id)
				const contentAttributes: Record<string, any> = {
					type: contentType,
					...(replyToExternalId
						? { context: { message_id: replyToExternalId } }
						: {}),
				}

				if (contentType !== 'text' && mediaUrl) {
					contentAttributes.media = {
						id:
							asString(messageRecord.mediaId) ||
							asString(messageRecord.media_id) ||
							externalMessageId,
						url: mediaUrl,
						original_url: mediaUrl,
						mime_type:
							asString(messageRecord.mimeType) ||
							asString(messageRecord.mime_type),
						filename:
							asString(messageRecord.fileName) ||
							asString(messageRecord.file_name),
						file_size:
							messageRecord.fileSize || messageRecord.file_size || undefined,
						sha256:
							asString(messageRecord.sha256) ||
							asString(messageRecord.hash) ||
							undefined,
						caption:
							asString(messageRecord.caption) ||
							(textContent ? textContent : undefined),
						download_status: 'downloaded',
					}
				}

				const normalizedMessage: NormalizedWhatsAppInboundMessage = {
					externalMessageId,
					senderWaId,
					senderJid,
					contactName:
						asString(contactRecord.name) ||
						asString(messageRecord.name) ||
						senderWaId,
					messageAt: parseBridgeWhatsAppTimestamp(
						messageRecord.timestamp || payload?.timestamp,
					),
					content:
						textContent ||
						(contentType === 'text' ? '' : `[${contentType.toUpperCase()}]`),
					contentType,
					contentAttributes,
					replyToExternalId,
					rawPayload: payload,
				}

				try {
					const result = await this.storeNormalizedWhatsAppInboundMessage({
						channel: resolvedChannel,
						message: normalizedMessage,
					})
					if (result.status === 'duplicate') {
						stats.duplicates += 1
					} else {
						stats.messagesCreated += 1
						await this.processCreatedWhatsAppInboundResult(result)
					}
				} catch (error: any) {
					stats.errors += 1
					errors.push(
						error?.message || 'Failed to process Baileys inbound message',
					)
				}
			} else if (event === 'message.status') {
				try {
					const updated = await this.applyBridgeWhatsAppStatus(
						Object.keys(asRecord(payload?.status)).length > 0
							? asRecord(payload?.status)
							: asRecord(payload),
					)
					if (updated) stats.statusesUpdated += 1
				} catch (error: any) {
					stats.errors += 1
					errors.push(
						error?.message || 'Failed to process Baileys status update',
					)
				}
			}
		} finally {
			if (webhookEventId) {
				const processedCount =
					stats.messagesCreated + stats.statusesUpdated + stats.duplicates
				const shouldFail = stats.errors > 0 && processedCount === 0

				await prisma.webhook_events.update({
					where: { id: webhookEventId },
					data: {
						status: shouldFail ? 'failed' : 'processed',
						...(shouldFail ? { retry_count: { increment: 1 } } : {}),
						processed_at: new Date(),
						updated_at: new Date(),
						error_message:
							errors.length > 0 ? errors.join(' | ').slice(0, 1000) : null,
						app_id: resolvedAppId || undefined,
						inbox_id: resolvedInboxId || undefined,
					},
				})
			}
		}

		return {
			success: stats.errors === 0,
			stats,
			errors,
		}
	}

	static async handleWhatsAppInbound(payload: any, webhookEventId?: string) {
		if (asString(payload?.event)) {
			return this.handleNormalizedBridgeWhatsAppInbound(
				payload,
				webhookEventId,
			)
		}

		const stats = {
			messagesCreated: 0,
			statusesUpdated: 0,
			duplicates: 0,
			unknownChannel: 0,
			errors: 0,
		}
		const errors: string[] = []
		let resolvedAppId: string | null = null
		let resolvedInboxId: string | null = null

		try {
			const entries = Array.isArray(payload?.entry) ? payload.entry : []

			for (const entry of entries) {
				const changes = Array.isArray(entry?.changes) ? entry.changes : []

				for (const change of changes) {
					const value = change?.value || {}
					const metadata = value?.metadata || {}
					const phoneNumberId = metadata?.phone_number_id

					if (!phoneNumberId) continue

					const channel = await prisma.whatsapp_channels.findFirst({
						where: {
							phone_number_id: String(phoneNumberId),
							deleted_at: null,
						},
						select: {
							id: true,
							app_id: true,
							inbox_id: true,
							name: true,
							badge_url: true,
							api_key: true,
							provider: true,
						},
					})

					if (!channel?.app_id || !channel?.inbox_id) {
						stats.unknownChannel += 1
						errors.push(
							`Channel not found for phone_number_id=${phoneNumberId}`,
						)
						continue
					}

					const resolvedChannel = {
						id: channel.id,
						app_id: channel.app_id,
						inbox_id: channel.inbox_id,
						name: channel.name,
						badge_url: channel.badge_url,
						api_key: channel.api_key,
						provider: channel.provider,
					}

					resolvedAppId = resolvedAppId || resolvedChannel.app_id
					resolvedInboxId = resolvedInboxId || resolvedChannel.inbox_id

					const incomingMessages = Array.isArray(value?.messages)
						? value.messages
						: []
					for (const inbound of incomingMessages) {
						try {
							const result = await this.storeIncomingWhatsAppMessage({
								channel: resolvedChannel,
								value,
								message: inbound,
							})
							if (result.status === 'duplicate') {
								stats.duplicates += 1
							} else {
								stats.messagesCreated += 1
								await this.processCreatedWhatsAppInboundResult(result)
							}
						} catch (error: any) {
							stats.errors += 1
							errors.push(error?.message || 'Failed to process inbound message')
						}
					}

					const statuses = Array.isArray(value?.statuses) ? value.statuses : []
					for (const status of statuses) {
						try {
							const updated = await this.applyWhatsAppStatus(status)
							if (updated) stats.statusesUpdated += 1
						} catch (error: any) {
							stats.errors += 1
							errors.push(error?.message || 'Failed to process status update')
						}
					}
				}
			}
		} finally {
			if (webhookEventId) {
				const processedCount =
					stats.messagesCreated + stats.statusesUpdated + stats.duplicates
				const shouldFail = stats.errors > 0 && processedCount === 0

				await prisma.webhook_events.update({
					where: { id: webhookEventId },
					data: {
						status: shouldFail ? 'failed' : 'processed',
						...(shouldFail ? { retry_count: { increment: 1 } } : {}),
						processed_at: new Date(),
						updated_at: new Date(),
						error_message:
							errors.length > 0 ? errors.join(' | ').slice(0, 1000) : null,
						app_id: resolvedAppId || undefined,
						inbox_id: resolvedInboxId || undefined,
					},
				})
			}
		}

		return {
			success: stats.errors === 0,
			stats,
			errors,
		}
	}

	static async handleInstagramInbound(payload: any, webhookEventId?: string) {
		const stats = {
			messagesCreated: 0,
			duplicates: 0,
			unknownChannel: 0,
			errors: 0,
		}
		const errors: string[] = []
		let resolvedAppId: string | null = null
		let resolvedInboxId: string | null = null

		try {
			const entries = Array.isArray(payload?.entry) ? payload.entry : []

			for (const entry of entries) {
				const messagingEvents = Array.isArray(entry?.messaging)
					? entry.messaging
					: []
				const entryId = String(entry?.id || '').trim()

				for (const event of messagingEvents) {
					// Skip non-message events
					if (
						!event.message ||
						event.message.is_echo ||
						event.message.is_deleted
					)
						continue
					if (event.read || event.delivery) continue

					const senderId = event.sender?.id
					const recipientId = event.recipient?.id
					if (!senderId || !recipientId) continue

					const inbox = await findInstagramInbox([recipientId, entryId])
					if (!inbox) {
						stats.unknownChannel += 1
						errors.push(
							`No inbox found for recipient_id=${recipientId}${
								entryId ? ` entry_id=${entryId}` : ''
							}`,
						)
						console.warn('[WebhookService] Instagram inbox lookup miss', {
							recipientId,
							entryId: entryId || null,
						})
						continue
					}

					resolvedAppId = resolvedAppId || inbox.app_id
					resolvedInboxId = resolvedInboxId || inbox.id

					try {
						const result = await this.storeIncomingInstagramMessage({
							inbox,
							event,
						})
						if (result.status === 'duplicate') {
							stats.duplicates += 1
						} else {
							stats.messagesCreated += 1
							try {
								await ChatbotFollowupService.clearOnInboundContactMessage(
									result.conversationId,
								)
							} catch (followupStateError) {
								console.error(
									'[WebhookService] Failed clearing chatbot follow-up state (fail-open):',
									followupStateError,
								)
							}
							void BusinessWebhookDispatchService.dispatch({
								event: 'message.received',
								appId: result.appId,
								inboxId: result.inboxId,
								payload: {
									source: 'instagram',
									conversation: {
										id: result.conversationId,
										app_id: result.appId,
										inbox_id: result.inboxId,
									},
									message: {
										id: result.message.id,
										external_id: result.message.external_id || null,
										content: result.message.content,
										content_type: result.message.content_type,
										sender_type: result.message.sender_type,
										status: result.message.status,
										created_at: result.message.created_at,
									},
									contact: result.contact,
								},
							})
							if (result.isNewLead) {
								void BusinessWebhookDispatchService.dispatch({
									event: 'conversation.created',
									appId: result.appId,
									inboxId: result.inboxId,
									payload: {
										source: 'instagram',
										conversation: {
											id: result.conversationId,
											app_id: result.appId,
											inbox_id: result.inboxId,
											channel_type: 'instagram',
											status: 'open',
										},
										contact: result.contact,
										trigger: {
											event: 'message.received',
											message_id: result.message.id,
										},
									},
								})
							}
							await this.emitInstagramMessageCreatedEvent({
								appId: result.appId,
								conversationId: result.conversationId,
								message: result.message,
								contact: result.contact,
								channelName: result.channelName,
							})

							let skipChatbotAutoReply = false
							if (ENABLE_INBOX_FLOW_RUNTIME) {
								try {
									const flowRuntimeResult =
										await FlowRuntimeService.executeInbound({
											appId: result.appId,
											inboxId: result.inboxId,
											conversationId: result.conversationId,
											incomingMessage: result.message,
											contact: result.contact,
											channelType: 'instagram',
											channelName: result.channelName,
											channelBadgeUrl: null,
										})
									skipChatbotAutoReply = flowRuntimeResult.skipChatbot
								} catch (flowRuntimeError) {
									console.error(
										'[WebhookService] Flow runtime failed (fail-open):',
										flowRuntimeError,
									)
								}
							}

							if (!skipChatbotAutoReply) {
								try {
									await this.scheduleChatbotAutoReply({
										appId: result.appId,
										inboxId: result.inboxId,
										conversationId: result.conversationId,
										incomingMessage: result.message,
										contact: result.contact,
										channelType: 'instagram',
										channelName: result.channelName,
										channelBadgeUrl: null,
										isNewLead: result.isNewLead,
									})
								} catch (autoReplyError) {
									console.error(
										'[WebhookService] Failed to process chatbot auto-reply:',
										autoReplyError,
									)
								}
							}
						}
					} catch (error: any) {
						stats.errors += 1
						errors.push(error?.message || 'Failed to process Instagram message')
					}
				}
			}
		} finally {
			if (webhookEventId) {
				const processedCount = stats.messagesCreated + stats.duplicates
				const shouldFail = stats.errors > 0 && processedCount === 0

				await prisma.webhook_events.update({
					where: { id: webhookEventId },
					data: {
						status: shouldFail ? 'failed' : 'processed',
						...(shouldFail ? { retry_count: { increment: 1 } } : {}),
						processed_at: new Date(),
						updated_at: new Date(),
						error_message:
							errors.length > 0 ? errors.join(' | ').slice(0, 1000) : null,
						app_id: resolvedAppId || undefined,
						inbox_id: resolvedInboxId || undefined,
					},
				})
			}
		}

		return {
			success: stats.errors === 0,
			stats,
			errors,
		}
	}

	static async handleTikTokInbound(payload: any, webhookEventId?: string) {
		const stats = {
			messagesCreated: 0,
			duplicates: 0,
			unknownChannel: 0,
			errors: 0,
		}
		const errors: string[] = []
		let resolvedAppId: string | null = null
		let resolvedInboxId: string | null = null

		try {
			const events = normalizeTikTokInboundEvents(payload)
			if (events.length === 0) {
				const payloadRecord = asRecord(payload)
				const eventName =
					asString(payloadRecord.event) || asString(payloadRecord.type)
				if (eventName && /message/i.test(eventName)) {
					console.warn(
						'[WebhookService] TikTok message payload could not be normalized',
						{
							event: eventName,
							keys: Object.keys(payloadRecord),
						},
					)
				} else if (eventName) {
					console.info(
						'[WebhookService] Ignoring non-message TikTok webhook event',
						{
							event: eventName,
						},
					)
				}
			}

			for (const event of events) {
				const inbox = await findTikTokInbox([event.recipientId])
				if (!inbox) {
					stats.unknownChannel += 1
					errors.push(
						`No inbox found for tiktok recipient_id=${event.recipientId}`,
					)
					console.warn('[WebhookService] TikTok inbox lookup miss', {
						recipientId: event.recipientId,
					})
					continue
				}

				resolvedAppId = resolvedAppId || inbox.app_id
				resolvedInboxId = resolvedInboxId || inbox.id

				try {
					const result = await this.storeIncomingTikTokMessage({
						inbox,
						event,
					})

					if (result.status === 'duplicate') {
						stats.duplicates += 1
						continue
					}

					stats.messagesCreated += 1
					try {
						await ChatbotFollowupService.clearOnInboundContactMessage(
							result.conversationId,
						)
					} catch (followupStateError) {
						console.error(
							'[WebhookService] Failed clearing chatbot follow-up state (fail-open):',
							followupStateError,
						)
					}

					void BusinessWebhookDispatchService.dispatch({
						event: 'message.received',
						appId: result.appId,
						inboxId: result.inboxId,
						payload: {
							source: 'tiktok',
							conversation: {
								id: result.conversationId,
								app_id: result.appId,
								inbox_id: result.inboxId,
							},
							message: {
								id: result.message.id,
								external_id: result.message.external_id || null,
								content: result.message.content,
								content_type: result.message.content_type,
								sender_type: result.message.sender_type,
								status: result.message.status,
								created_at: result.message.created_at,
							},
							contact: result.contact,
						},
					})

					if (result.isNewLead) {
						void BusinessWebhookDispatchService.dispatch({
							event: 'conversation.created',
							appId: result.appId,
							inboxId: result.inboxId,
							payload: {
								source: 'tiktok',
								conversation: {
									id: result.conversationId,
									app_id: result.appId,
									inbox_id: result.inboxId,
									channel_type: 'tiktok',
									status: 'open',
								},
								contact: result.contact,
								trigger: {
									event: 'message.received',
									message_id: result.message.id,
								},
							},
						})
					}

					await this.emitTikTokMessageCreatedEvent({
						appId: result.appId,
						conversationId: result.conversationId,
						message: result.message,
						contact: result.contact,
						channelName: result.channelName,
					})

					let skipChatbotAutoReply = false
					if (ENABLE_INBOX_FLOW_RUNTIME) {
						try {
							const flowRuntimeResult = await FlowRuntimeService.executeInbound(
								{
									appId: result.appId,
									inboxId: result.inboxId,
									conversationId: result.conversationId,
									incomingMessage: result.message,
									contact: result.contact,
									channelType: 'tiktok',
									channelName: result.channelName,
									channelBadgeUrl: null,
								},
							)
							skipChatbotAutoReply = flowRuntimeResult.skipChatbot
						} catch (flowRuntimeError) {
							console.error(
								'[WebhookService] Flow runtime failed (fail-open):',
								flowRuntimeError,
							)
						}
					}

					if (!skipChatbotAutoReply) {
						try {
							await this.scheduleChatbotAutoReply({
								appId: result.appId,
								inboxId: result.inboxId,
								conversationId: result.conversationId,
								incomingMessage: result.message,
								contact: result.contact,
								channelType: 'tiktok',
								channelName: result.channelName,
								channelBadgeUrl: null,
								isNewLead: result.isNewLead,
							})
						} catch (autoReplyError) {
							console.error(
								'[WebhookService] Failed to process chatbot auto-reply:',
								autoReplyError,
							)
						}
					}
				} catch (error: any) {
					stats.errors += 1
					errors.push(error?.message || 'Failed to process TikTok message')
				}
			}
		} finally {
			if (webhookEventId) {
				const processedCount = stats.messagesCreated + stats.duplicates
				const shouldFail = stats.errors > 0 && processedCount === 0

				await prisma.webhook_events.update({
					where: { id: webhookEventId },
					data: {
						status: shouldFail ? 'failed' : 'processed',
						...(shouldFail ? { retry_count: { increment: 1 } } : {}),
						processed_at: new Date(),
						updated_at: new Date(),
						error_message:
							errors.length > 0 ? errors.join(' | ').slice(0, 1000) : null,
						app_id: resolvedAppId || undefined,
						inbox_id: resolvedInboxId || undefined,
					},
				})
			}
		}

		return {
			success: stats.errors === 0,
			stats,
			errors,
		}
	}

	static async processDebouncedAutoReplyJob(payload: any) {
		const params = (payload || {}) as Partial<AutoReplyParams>
		const conversationId = String(params.conversationId || '').trim()
		const debounceToken =
			typeof params.debounceToken === 'string' ? params.debounceToken : null
		if (!conversationId) {
			return {
				success: false,
				skipped: true,
				reason: 'missing_conversation_id',
			}
		}
		if (
			!params.appId ||
			!params.inboxId ||
			!params.contact ||
			!params.channelType
		) {
			return { success: false, skipped: true, reason: 'invalid_payload' }
		}

		if (!(await this.isLatestAutoReplyToken(conversationId, debounceToken))) {
			return { success: true, skipped: true, reason: 'stale_token' }
		}

		await this.maybeSendChatbotAutoReply({
			appId: params.appId,
			inboxId: params.inboxId,
			conversationId,
			incomingMessage: params.incomingMessage,
			contact: params.contact,
			channelType: params.channelType,
			channelName: params.channelName || null,
			channelBadgeUrl: params.channelBadgeUrl || null,
			isNewLead: Boolean(params.isNewLead),
			aggregatePendingInbound: true,
			debounceToken,
		})

		return { success: true }
	}

	private static async scheduleChatbotAutoReply(params: AutoReplyParams) {
		if (!AI_AUTOREPLY_DEBOUNCE_ENABLED) {
			await this.maybeSendChatbotAutoReply(params)
			return
		}

		const burstKey = buildAutoReplyBurstKey(params.conversationId)
		const latestTokenKey = buildAutoReplyLatestTokenKey(params.conversationId)
		const burstCount = await redis.incr(burstKey)
		if (burstCount === 1) {
			await redis.expire(burstKey, AI_AUTOREPLY_BURST_WINDOW_SECONDS)
		}

		const delayMs = resolveAutoReplyDebounceDelayMs(burstCount)
		const debounceToken = `${Date.now().toString(36)}-${Math.random()
			.toString(36)
			.slice(2, 10)}`
		await redis.set(
			latestTokenKey,
			debounceToken,
			'EX',
			AI_AUTOREPLY_TOKEN_TTL_SECONDS,
		)

		await webhookQueue.add(
			'chatbot-auto-reply',
			{
				...params,
				debounceToken,
				aggregatePendingInbound: true,
			},
			{
				jobId: `chatbot-auto-reply:${params.conversationId}:${debounceToken}`,
				delay: delayMs,
				attempts: AI_AUTOREPLY_JOB_ATTEMPTS,
				backoff: { type: 'exponential', delay: AI_AUTOREPLY_JOB_BACKOFF_MS },
				removeOnComplete: 2000,
				removeOnFail: 2000,
			},
		)
	}

	private static async isLatestAutoReplyToken(
		conversationId: string,
		debounceToken: string | null | undefined,
	): Promise<boolean> {
		if (!debounceToken) return true
		const latestToken = await redis.get(
			buildAutoReplyLatestTokenKey(conversationId),
		)
		return latestToken === debounceToken
	}

	private static async collectPendingInboundBatch(
		conversationId: string,
	): Promise<{
		incomingText: string
		excludedMessageIds: string[]
		latestIncomingMessageId: string | null
	} | null> {
		const lastBotMessage = await prisma.messages.findFirst({
			where: {
				conversation_id: conversationId,
				sender_type: 'bot',
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
			},
			orderBy: { created_at: 'desc' },
			select: { created_at: true },
		})

		const pendingMessages = await prisma.messages.findMany({
			where: {
				conversation_id: conversationId,
				sender_type: 'contact',
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
				...(lastBotMessage?.created_at
					? { created_at: { gt: lastBotMessage.created_at } }
					: {}),
			},
			orderBy: { created_at: 'desc' },
			take: 20,
			select: {
				id: true,
				content: true,
			},
		})

		if (pendingMessages.length === 0) return null

		const normalizedPending = pendingMessages
			.reverse()
			.map((item) => ({
				id: item.id,
				content: String(item.content || '').trim(),
			}))
			.filter((item) => item.content.length > 0)

		if (normalizedPending.length === 0) return null

		return {
			incomingText: normalizedPending.map((item) => item.content).join('\n'),
			excludedMessageIds: normalizedPending.map((item) => item.id),
			latestIncomingMessageId:
				normalizedPending[normalizedPending.length - 1]?.id || null,
		}
	}

	private static async pickAssigneeByDistribution(params: {
		appId: string
		candidateAgentIds: string[]
		distributionMethod: DistributionMethod
	}): Promise<string | null> {
		const uniqueCandidateAgentIds = Array.from(
			new Set(
				params.candidateAgentIds.filter((agentId) =>
					Boolean(asUuidOrNull(agentId)),
				),
			),
		)
		if (uniqueCandidateAgentIds.length === 0) return null
		if (uniqueCandidateAgentIds.length === 1) return uniqueCandidateAgentIds[0]

		const originalPosition = new Map<string, number>()
		for (let index = 0; index < uniqueCandidateAgentIds.length; index += 1) {
			originalPosition.set(uniqueCandidateAgentIds[index], index)
		}

		if (params.distributionMethod === 'least_assigned') {
			const workloads = await prisma.conversations.groupBy({
				by: ['assignee_id'],
				where: {
					app_id: params.appId,
					deleted_at: null,
					status: { not: 'resolved' },
					assignee_id: { in: uniqueCandidateAgentIds },
				},
				_count: { _all: true },
			})

			const workloadByAgentId = new Map<string, number>()
			for (const row of workloads) {
				if (row.assignee_id) {
					workloadByAgentId.set(row.assignee_id, row._count._all)
				}
			}

			const sortedCandidates = [...uniqueCandidateAgentIds].sort(
				(left, right) => {
					const leftLoad = workloadByAgentId.get(left) || 0
					const rightLoad = workloadByAgentId.get(right) || 0
					if (leftLoad !== rightLoad) return leftLoad - rightLoad
					return (
						(originalPosition.get(left) || 0) -
						(originalPosition.get(right) || 0)
					)
				},
			)
			return sortedCandidates[0] || null
		}

		const availabilities = await prisma.agent_availability.findMany({
			where: {
				app_id: params.appId,
				user_id: { in: uniqueCandidateAgentIds },
			},
			select: {
				user_id: true,
				last_assigned_at: true,
			},
		})

		const lastAssignedByAgentId = new Map<string, Date | null>()
		for (const row of availabilities) {
			lastAssignedByAgentId.set(row.user_id, row.last_assigned_at || null)
		}

		const sortedCandidates = [...uniqueCandidateAgentIds].sort(
			(left, right) => {
				const leftLastAssignedAt = lastAssignedByAgentId.get(left) || null
				const rightLastAssignedAt = lastAssignedByAgentId.get(right) || null

				if (!leftLastAssignedAt && !rightLastAssignedAt) {
					return (
						(originalPosition.get(left) || 0) -
						(originalPosition.get(right) || 0)
					)
				}
				if (!leftLastAssignedAt) return -1
				if (!rightLastAssignedAt) return 1
				if (leftLastAssignedAt.getTime() !== rightLastAssignedAt.getTime()) {
					return leftLastAssignedAt.getTime() - rightLastAssignedAt.getTime()
				}
				return (
					(originalPosition.get(left) || 0) - (originalPosition.get(right) || 0)
				)
			},
		)

		return sortedCandidates[0] || null
	}

	private static async escalateConversationToHuman(params: {
		appId: string
		conversationId: string
		defaultTeamIds: string[]
		defaultAgentIds: string[]
		distributionMethod: DistributionMethod
		preferredDivisionName?: string | null
	}) {
		const uniqueConfiguredTeamIds = Array.from(
			new Set(
				params.defaultTeamIds.filter((teamId) => Boolean(asUuidOrNull(teamId))),
			),
		)
		const uniqueConfiguredAgentIds = Array.from(
			new Set(
				params.defaultAgentIds.filter((agentId) =>
					Boolean(asUuidOrNull(agentId)),
				),
			),
		)

		const validTeamRows =
			uniqueConfiguredTeamIds.length > 0
				? await prisma.teams.findMany({
						where: {
							id: { in: uniqueConfiguredTeamIds },
							app_id: params.appId,
							deleted_at: null,
						},
						select: {
							id: true,
							name: true,
						},
					})
				: []
		const validTeamIdSet = new Set(validTeamRows.map((team) => team.id))
		let validTeamIds = uniqueConfiguredTeamIds.filter((teamId) =>
			validTeamIdSet.has(teamId),
		)

		const preferredDivisionName = String(
			params.preferredDivisionName || '',
		).trim()
		if (preferredDivisionName && validTeamRows.length > 0) {
			const preferredTeamIds = validTeamRows
				.filter((team) =>
					String(team.name || '')
						.trim()
						.toLowerCase()
						.includes(preferredDivisionName.toLowerCase()),
				)
				.map((team) => team.id)
			if (preferredTeamIds.length > 0) {
				validTeamIds = preferredTeamIds
			}
		}

		const teamMembers =
			validTeamIds.length > 0
				? await prisma.team_members.findMany({
						where: {
							team_id: { in: validTeamIds },
						},
						select: {
							team_id: true,
							user_id: true,
						},
					})
				: []

		const teamMemberIds = new Set<string>()
		const teamIdsByUserId = new Map<string, string[]>()
		for (const member of teamMembers) {
			teamMemberIds.add(member.user_id)
			const currentTeams = teamIdsByUserId.get(member.user_id) || []
			if (!currentTeams.includes(member.team_id)) {
				currentTeams.push(member.team_id)
				teamIdsByUserId.set(member.user_id, currentTeams)
			}
		}

		let candidateAgentIds = [...uniqueConfiguredAgentIds]
		if (candidateAgentIds.length > 0 && validTeamIds.length > 0) {
			candidateAgentIds = candidateAgentIds.filter((agentId) =>
				teamMemberIds.has(agentId),
			)
		}
		if (candidateAgentIds.length === 0 && validTeamIds.length > 0) {
			candidateAgentIds = Array.from(teamMemberIds)
		}

		if (candidateAgentIds.length === 0) {
			const fallbackAgents = await prisma.users.findMany({
				where: {
					app_id: params.appId,
					active: true,
					deleted_at: null,
					role: { in: CHAT_ASSIGNABLE_ROLES },
				},
				orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
				select: { id: true },
				take: 50,
			})
			candidateAgentIds = fallbackAgents.map((agent) => agent.id)
		}

		if (candidateAgentIds.length > 0) {
			const validAgents = await prisma.users.findMany({
				where: {
					id: { in: candidateAgentIds },
					app_id: params.appId,
					active: true,
					deleted_at: null,
					role: { in: CHAT_ASSIGNABLE_ROLES },
				},
				select: { id: true },
			})
			const validAgentIdSet = new Set(validAgents.map((agent) => agent.id))
			candidateAgentIds = candidateAgentIds.filter((agentId) =>
				validAgentIdSet.has(agentId),
			)
		}

		const selectedAgentId = await this.pickAssigneeByDistribution({
			appId: params.appId,
			candidateAgentIds,
			distributionMethod: params.distributionMethod,
		})

		let selectedTeamId: string | null = null
		if (validTeamIds.length > 0) {
			if (selectedAgentId) {
				const memberTeamIds = teamIdsByUserId.get(selectedAgentId) || []
				selectedTeamId =
					validTeamIds.find((teamId) => memberTeamIds.includes(teamId)) ||
					validTeamIds[0] ||
					null
			} else {
				selectedTeamId = validTeamIds[0] || null
			}
		}

		if (selectedTeamId) {
			await prisma.conversations.update({
				where: { id: params.conversationId },
				data: {
					team_id: selectedTeamId,
					updated_at: new Date(),
				},
			})
		}

		if (selectedAgentId) {
			await ConversationService.assignAgent(
				params.conversationId,
				selectedAgentId,
			)
		}

		await ConversationService.updateStatus(params.conversationId, 'pending')

		if (selectedAgentId && params.distributionMethod === 'round_robin') {
			await prisma.agent_availability.upsert({
				where: {
					user_id_app_id: {
						user_id: selectedAgentId,
						app_id: params.appId,
					},
				},
				create: {
					user_id: selectedAgentId,
					app_id: params.appId,
					is_available: true,
					last_assigned_at: new Date(),
				},
				update: {
					last_assigned_at: new Date(),
					updated_at: new Date(),
				},
			})
		}

		const conversation = await prisma.conversations.findFirst({
			where: {
				id: params.conversationId,
				app_id: params.appId,
				deleted_at: null,
			},
			select: {
				additional_attributes: true,
			},
		})
		const conversationAttributes = asRecord(conversation?.additional_attributes)
		const nextAdditionalAttributes: Record<string, unknown> = {
			...conversationAttributes,
			ai_handoff_active: true,
			ai_handoff_at: new Date().toISOString(),
			ai_handoff_source: 'chatbot_auto_reply',
			ai_handoff_reason: 'transfer_conditions',
		}
		if (selectedAgentId) {
			nextAdditionalAttributes.ai_handoff_agent_id = selectedAgentId
		}
		if (selectedTeamId) {
			nextAdditionalAttributes.ai_handoff_team_id = selectedTeamId
		}
		if (preferredDivisionName) {
			nextAdditionalAttributes.ai_handoff_division = preferredDivisionName
		}
		await prisma.conversations.update({
			where: { id: params.conversationId },
			data: {
				additional_attributes: nextAdditionalAttributes as any,
				updated_at: new Date(),
			},
		})

		return {
			selectedAgentId,
			selectedTeamId,
		}
	}

	private static async maybeSendChatbotAutoReply(params: AutoReplyParams) {
		const inbox = await prisma.inboxes.findFirst({
			where: {
				id: params.inboxId,
				app_id: params.appId,
				deleted_at: null,
			},
			select: {
				chatbot_id: true,
				channel_config: true,
			},
		})

		const inboxChannelConfig = asRecord(inbox?.channel_config)
		const whatsappChannelMetadata =
			params.channelType === 'whatsapp'
				? asRecord(
						(
							await prisma.whatsapp_channels.findFirst({
								where: {
									inbox_id: params.inboxId,
									app_id: params.appId,
									deleted_at: null,
								},
								select: {
									extended_metadata: true,
								},
							})
						)?.extended_metadata,
					)
				: {}

		let preferredChatbotId =
			asUuidOrNull(inbox?.chatbot_id) ||
			resolveConfiguredChatbotId(inboxChannelConfig)
		if (!preferredChatbotId) {
			preferredChatbotId = resolveConfiguredChatbotId(whatsappChannelMetadata)
		}

		const mappedByLevel =
			await CustomerService.resolveMappedChatbotForCustomerLevel({
				appId: params.appId,
				contactId: params.contact.id,
			})
		if (mappedByLevel.mapped_chatbot_id) {
			preferredChatbotId = mappedByLevel.mapped_chatbot_id
		}

		const inboxHasTeamConfig =
			Object.prototype.hasOwnProperty.call(
				inboxChannelConfig,
				'default_team_ids',
			) ||
			Object.prototype.hasOwnProperty.call(inboxChannelConfig, 'defaultTeamIds')
		const inboxHasAgentConfig =
			Object.prototype.hasOwnProperty.call(
				inboxChannelConfig,
				'default_agent_ids',
			) ||
			Object.prototype.hasOwnProperty.call(
				inboxChannelConfig,
				'defaultAgentIds',
			)
		const inboxHasDistributionConfig =
			Object.prototype.hasOwnProperty.call(
				inboxChannelConfig,
				'distribution_method',
			) ||
			Object.prototype.hasOwnProperty.call(
				inboxChannelConfig,
				'distributionMethod',
			)
		const escalationDefaultTeamIds = inboxHasTeamConfig
			? resolveConfiguredTeamIds(inboxChannelConfig)
			: resolveConfiguredTeamIds(whatsappChannelMetadata)
		const escalationDefaultAgentIds = inboxHasAgentConfig
			? resolveConfiguredAgentIds(inboxChannelConfig)
			: resolveConfiguredAgentIds(whatsappChannelMetadata)
		const escalationDistributionMethod = inboxHasDistributionConfig
			? resolveConfiguredDistributionMethod(inboxChannelConfig) || 'round_robin'
			: resolveConfiguredDistributionMethod(whatsappChannelMetadata) ||
				'round_robin'

		if (!preferredChatbotId) return

		const chatbot = await ChatbotService.getChatbotById(
			preferredChatbotId,
			params.appId,
		)
		if (!chatbot) return
		const pluginData =
			chatbot.plugin_data &&
			typeof chatbot.plugin_data === 'object' &&
			!Array.isArray(chatbot.plugin_data)
				? (chatbot.plugin_data as Record<string, unknown>)
				: null
		const watcherEnabled =
			chatbot.watcher_enabled === true || pluginData?.watcher_enabled === true
		if (!watcherEnabled) return
		const sessionOnlyMemory =
			chatbot.session_only_memory === true ||
			asBoolean(pluginData?.session_only_memory)

		const aggregatePendingInbound = params.aggregatePendingInbound === true
		let incomingText = String(params.incomingMessage?.content || '').trim()
		let incomingMessageId =
			typeof params.incomingMessage?.id === 'string' &&
			params.incomingMessage.id.trim().length > 0
				? params.incomingMessage.id
				: null
		let excludedMessageIds: string[] = []

		if (aggregatePendingInbound || !incomingText) {
			const pendingBatch = await this.collectPendingInboundBatch(
				params.conversationId,
			)
			if (!pendingBatch) return
			incomingText = pendingBatch.incomingText
			incomingMessageId = pendingBatch.latestIncomingMessageId
			excludedMessageIds = pendingBatch.excludedMessageIds
		}

		if (!incomingText) return
		if (
			!(await this.isLatestAutoReplyToken(
				params.conversationId,
				params.debounceToken,
			))
		) {
			return
		}

		const conversation = await prisma.conversations.findFirst({
			where: {
				id: params.conversationId,
				app_id: params.appId,
				deleted_at: null,
			},
			select: {
				assignee_id: true,
				additional_attributes: true,
			},
		})
		if (isConversationHandoffActive(conversation)) {
			return
		}

		const cooldownSeconds = Math.max(
			0,
			Math.floor(toFiniteNumber(chatbot.message_await, 0)),
		)
		if (cooldownSeconds > 0 && !aggregatePendingInbound) {
			const latestBotMessage = await prisma.messages.findFirst({
				where: {
					conversation_id: params.conversationId,
					sender_type: 'bot',
					deleted_at: null,
					OR: [{ is_deleted: false }, { is_deleted: null }],
					created_at: {
						gte: new Date(Date.now() - cooldownSeconds * 1000),
					},
				},
				select: { id: true },
			})

			if (latestBotMessage) return
		}

		const maxReplies = Math.max(
			1,
			Math.floor(toFiniteNumber(chatbot.message_limit, 1000)),
		)
		const replyCount = await prisma.messages.count({
			where: {
				conversation_id: params.conversationId,
				sender_type: 'bot',
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
			},
		})
		if (replyCount >= maxReplies) return

		const historyLimit = Math.max(
			1,
			Math.min(
				AI_AGENT_HISTORY_LIMIT_MAX,
				Math.floor(toFiniteNumber(chatbot.history_limit, 15)),
			),
		)
		const historyWindow = historyLimit
		const excludeHistoryClause =
			excludedMessageIds.length > 0
				? { id: { notIn: excludedMessageIds } }
				: incomingMessageId
					? { id: { not: incomingMessageId } }
					: {}
		const recentMessages = sessionOnlyMemory
			? []
			: await prisma.messages.findMany({
					where: {
						conversation_id: params.conversationId,
						deleted_at: null,
						OR: [{ is_deleted: false }, { is_deleted: null }],
						sender_type: { in: ['contact', 'bot'] },
						...excludeHistoryClause,
					},
					orderBy: { created_at: 'desc' },
					take: historyWindow,
					select: {
						id: true,
						sender_type: true,
						content: true,
					},
				})

		const history = recentMessages
			.reverse()
			.map((item) => {
				const content = String(item.content || '').trim()
				if (!content) return null
				if (isLowSignalHistoryContent(content)) return null
				return {
					role: item.sender_type === 'contact' ? 'user' : 'assistant',
					content,
				}
			})
			.filter((item): item is { role: 'user' | 'assistant'; content: string } =>
				Boolean(item),
			)

		const response = await ChatbotService.generateAgentReply(
			chatbot.id,
			params.appId,
			{
				message: incomingText,
				history,
				runTools: true,
				mode: 'live',
				entrypoint: 'webhook_live',
				conversationId: params.conversationId,
				sourceMessageIds:
					incomingMessageId && typeof incomingMessageId === 'string'
						? [incomingMessageId]
						: [],
			},
		)
		if (
			!(await this.isLatestAutoReplyToken(
				params.conversationId,
				params.debounceToken,
			))
		) {
			return
		}
		const toolsCalled = resolveToolCallCount(response.meta.tools_called)
		const toolsSucceeded = resolveToolCallCount(response.meta.tools_succeeded)
		const syncedLabel = await this.syncAiLabelToConversation({
			appId: params.appId,
			conversationId: params.conversationId,
			labelId: response.meta.label_applied_id,
			labelName: response.meta.label_applied,
		})
		const appliedLabelName =
			syncedLabel?.title || response.meta.label_applied || null
		const appliedLabelId =
			syncedLabel?.id || response.meta.label_applied_id || null

		const timeline = Array.isArray(response.preview?.timeline)
			? response.preview.timeline
			: []
		let statusTimelineTexts = extractStatusTimelineTexts(timeline)
		const explicitHandoffStatusDetected =
			hasExplicitHandoffStatus(statusTimelineTexts)
		const flowRuntimeState = asRecord(
			asRecord(conversation?.additional_attributes).flow_runtime,
		)
		const flowRuntimeVariables = asRecord(flowRuntimeState.variables)
		const inferredEscalationIntent =
			Boolean(chatbot.agent_transfer) &&
			isLikelyEscalationIntent(appliedLabelName, flowRuntimeVariables)
		const shouldEscalateToHuman =
			explicitHandoffStatusDetected || inferredEscalationIntent
		const preferredDivisionName =
			extractPreferredDivisionName(statusTimelineTexts)
		if (shouldEscalateToHuman && !explicitHandoffStatusDetected) {
			const reasonText =
				extractHandoffReason(statusTimelineTexts) ||
				'Escalation triggered by transfer conditions.'
			const fallbackStatuses = [
				`Handing off to human agent: ${reasonText}`,
				...(preferredDivisionName
					? [`Assigned to division: ${preferredDivisionName}`]
					: []),
			]
			const existingStatusSet = new Set(
				statusTimelineTexts.map((text) =>
					String(text || '')
						.trim()
						.toLowerCase(),
				),
			)
			const dedupedFallbackStatuses = fallbackStatuses.filter((text) => {
				const normalized = String(text || '')
					.trim()
					.toLowerCase()
				if (!normalized || existingStatusSet.has(normalized)) return false
				existingStatusSet.add(normalized)
				return true
			})
			statusTimelineTexts = [...statusTimelineTexts, ...dedupedFallbackStatuses]
		}
		const suppressAssistantAfterHandoff =
			shouldEscalateToHuman &&
			(chatbot.stop_after_handoff === true ||
				chatbot.is_silent_handoff_agent === true)
		const timelineSegments: Array<{
			content: string
			contentType: 'text' | 'image'
			mediaUrl?: string
		}> = []
		for (const entry of timeline) {
			if (!entry || typeof entry !== 'object') continue
			if (entry.type === 'text') {
				const textChunks = splitAssistantTextForDelivery(
					String(entry.content || ''),
				)
				for (const chunk of textChunks) {
					timelineSegments.push({
						content: chunk,
						contentType: 'text',
					})
				}
				continue
			}
			if (entry.type === 'image') {
				const mediaUrl = String(entry.url || '').trim()
				if (!mediaUrl) continue
				timelineSegments.push({
					content: mediaUrl,
					contentType: 'image',
					mediaUrl,
				})
			}
		}

		const generatedText = String(response.content || '').trim()
		if (timelineSegments.length === 0) {
			if (!generatedText && statusTimelineTexts.length === 0) return
			if (!generatedText) {
				// Keep status-only timeline entries visible as system events.
				// No assistant bubble is sent when model content is empty.
			} else {
				const fallbackChunks = splitAssistantTextForDelivery(generatedText)
				for (const chunk of fallbackChunks) {
					timelineSegments.push({
						content: chunk,
						contentType: 'text',
					})
				}
			}
		}

		const inferredIsNewLead = params.isNewLead || replyCount === 0
			const aiTelemetryAttributes: Record<string, unknown> = {
				ai_response_log_id: response.meta.ai_response_log_id || null,
				ai_tokens_prompt: Number(response.meta.ai_tokens_prompt || 0),
				ai_tokens_completion: Number(response.meta.ai_tokens_completion || 0),
				ai_tokens_total: Number(response.meta.ai_tokens_total || 0),
				ai_cost_credits: Number(response.meta.ai_cost_credits || 0),
				ai_cost_usd: Number(response.meta.ai_cost_usd || 0),
				ai_cost_idr: Number(response.meta.ai_cost_idr || 0),
				ai_provider_hit: Boolean(response.meta.ai_provider_hit),
				ai_provider_endpoint: response.meta.ai_provider_endpoint || null,
				ai_provider_status_code: Number.isFinite(
					Number(response.meta.ai_provider_status_code),
				)
					? Number(response.meta.ai_provider_status_code)
					: null,
				ai_provider_error: response.meta.ai_provider_error || null,
				ai_fallback_reason: response.meta.ai_fallback_reason || null,
				ai_knowledge_references: Array.isArray(
					response.meta.ai_knowledge_references,
				)
				? response.meta.ai_knowledge_references
				: [],
			ai_rtk_summary:
				response.meta.ai_rtk_summary &&
				typeof response.meta.ai_rtk_summary === 'object'
					? response.meta.ai_rtk_summary
					: {},
			knowledge_snapshot_at: response.meta.knowledge_snapshot_at || null,
		}
		const workflowId = asString(flowRuntimeState.flow_id)
		const workflowRecord =
			workflowId && asUuidOrNull(workflowId)
				? await prisma.automation_flows.findFirst({
						where: {
							id: workflowId,
							app_id: params.appId,
						},
						select: {
							id: true,
							name: true,
						},
					})
				: null
		const responseMeta = response.meta as Record<string, unknown>
		const ragIntent = asString(responseMeta.rag_intent)
		const contactIntent =
			asString(asRecord(params.contact.metadata).intent) ||
			asString(asRecord(params.contact.meta).intent)
		const aiAnalytics = buildAiAnalytics({
			confidence: flowRuntimeVariables.last_ai_confidence,
			intent: ragIntent || contactIntent,
			workflowId,
			workflowName: asString(workflowRecord?.name),
			ragIntent,
			knowledgeReferences: aiTelemetryAttributes.ai_knowledge_references,
			updatedAt: new Date(),
		})
		const aiBaseAttributes = {
			is_ai: true,
			ai_generated: true,
			generated_by_ai: true,
			ai_source: response.meta.ai_source || chatbot.name,
			ai_agent_id: response.meta.ai_agent_id || chatbot.id,
			ai_agent_name: response.meta.ai_agent_name || chatbot.name,
			...(ragIntent ? { rag_intent: ragIntent } : {}),
			...(aiAnalytics ? { ai_analytics: aiAnalytics } : {}),
			ai_related: true,
			is_new_lead: inferredIsNewLead,
			lead_status: inferredIsNewLead ? 'new_lead' : 'existing_lead',
			...aiTelemetryAttributes,
		}
		const timelineBaseTime = Date.now()
		let timelineOffsetMs = 0
		const nextTimelineCreatedAt = () =>
			new Date(timelineBaseTime + timelineOffsetMs++)

		const emitRealtimeMessage = async (message: any) => {
			if (params.channelType === 'instagram') {
				await this.emitInstagramMessageCreatedEvent({
					appId: params.appId,
					conversationId: params.conversationId,
					message,
					contact: {
						id: params.contact.id,
						name: params.contact.name,
						identifier: params.contact.identifier,
						avatar_url: params.contact.avatar_url || null,
						meta: params.contact.meta,
						metadata: params.contact.metadata,
					},
					channelName: params.channelName,
				})
				return
			}

			if (params.channelType === 'tiktok') {
				await this.emitTikTokMessageCreatedEvent({
					appId: params.appId,
					conversationId: params.conversationId,
					message,
					contact: {
						id: params.contact.id,
						name: params.contact.name,
						identifier: params.contact.identifier,
						avatar_url: params.contact.avatar_url || null,
						meta: params.contact.meta,
						metadata: params.contact.metadata,
					},
					channelName: params.channelName,
				})
				return
			}

			await this.emitMessageCreatedEvent({
				appId: params.appId,
				conversationId: params.conversationId,
				message,
				contact: {
					id: params.contact.id,
					name: params.contact.name,
					phone_number: params.contact.phone_number || null,
					identifier: params.contact.identifier,
				},
				channelName: params.channelName,
				channelBadgeUrl: params.channelBadgeUrl,
				channelProvider: params.channelProvider || null,
			})
		}

		const sentSystemMessages = []
		for (const statusText of statusTimelineTexts) {
			const systemMessage = await MessageService.sendMessage({
				conversationId: params.conversationId,
				senderType: 'system',
				content: statusText,
				contentType: 'text',
				createdAt: nextTimelineCreatedAt(),
				contentAttributes: {
					type: 'text',
					system_event: 'ai_tool_status',
					...aiBaseAttributes,
				},
			})
			sentSystemMessages.push(systemMessage)
		}

		if (shouldEscalateToHuman) {
			try {
				await this.escalateConversationToHuman({
					appId: params.appId,
					conversationId: params.conversationId,
					defaultTeamIds: escalationDefaultTeamIds,
					defaultAgentIds: escalationDefaultAgentIds,
					distributionMethod: escalationDistributionMethod,
					preferredDivisionName,
				})
			} catch (escalationError) {
				console.error(
					'[WebhookService] Failed to escalate conversation to human agent (fail-open):',
					escalationError,
				)
			}
		}

		const assistantTimelineSegments = suppressAssistantAfterHandoff
			? []
			: timelineSegments
		const sentMessages = []
		for (let index = 0; index < assistantTimelineSegments.length; index += 1) {
			const segment = assistantTimelineSegments[index]
			const isFirstSegment = index === 0
			const isLastSegment = index === assistantTimelineSegments.length - 1
			const segmentAttributes: Record<string, unknown> = {
				type: segment.contentType,
				...aiBaseAttributes,
				ai_status_enabled: isFirstSegment,
				ai_credits_used: isLastSegment
					? Number(response.meta.credits_used || 0)
					: 0,
				...(segment.contentType === 'image' && segment.mediaUrl
					? {
							media_type: 'image',
							media_url: segment.mediaUrl,
							media: {
								type: 'image',
								url: segment.mediaUrl,
							},
						}
					: {}),
				...(isFirstSegment
					? {
							ai_tools_called: toolsCalled,
							ai_tools_succeeded: toolsSucceeded,
							ai_followups_matched: Number(
								response.meta.followups_matched || 0,
							),
							ai_label_applied: appliedLabelName,
							ai_label_applied_id: appliedLabelId,
							ai_status_tools_text:
								toolsCalled > 0
									? toolsSucceeded > 0
										? 'Successfully executed tool calls'
										: 'Tool calls failed, using fallback response'
									: null,
							ai_status_label_text: appliedLabelName
								? `Successfully labeled conversation with: ${appliedLabelName}`
								: null,
						}
					: {}),
			}

			const sentMessage = await MessageService.sendMessage({
				conversationId: params.conversationId,
				senderType: 'bot',
				content: segment.content,
				contentType: segment.contentType,
				createdAt: nextTimelineCreatedAt(),
				contentAttributes: segmentAttributes,
			})
			sentMessages.push(sentMessage)

			if (!isLastSegment) {
				await sleep(resolveRandomAiBubbleDelayMs())
			}
		}

		for (const systemMessage of sentSystemMessages) {
			await emitRealtimeMessage(systemMessage)
		}

		for (const sentMessage of sentMessages) {
			await emitRealtimeMessage(sentMessage)
		}

		await ConversationService.upsertAiAnalytics(
			params.conversationId,
			aiAnalytics,
		)

		void AIResponseLogService.attachMessageIds({
			logId: response.meta.ai_response_log_id,
			messageIds: [
				...sentSystemMessages
					.map((item) => String(item?.id || ''))
					.filter(Boolean),
				...sentMessages.map((item) => String(item?.id || '')).filter(Boolean),
			],
			status: 'delivered',
		}).catch((error) => {
			console.error(
				'[WebhookService] Failed attaching AI response log linkage (fail-open):',
				error,
			)
		})

		if (sentMessages.length > 0) {
			try {
				await ChatbotFollowupService.scheduleFromAiReply({
					conversationId: params.conversationId,
					appId: params.appId,
					chatbotId: chatbot.id,
					chatbotSnapshot: {
						id: chatbot.id,
						app_id: chatbot.app_id || params.appId,
						name: chatbot.name,
						watcher_enabled: chatbot.watcher_enabled,
						plugin_data: chatbot.plugin_data,
						ai_followups: chatbot.ai_followups,
					},
				})
			} catch (followupScheduleError) {
				console.error(
					'[WebhookService] Failed scheduling chatbot follow-up (fail-open):',
					followupScheduleError,
				)
			}
		}
	}

	private static async syncAiLabelToConversation(params: {
		appId: string
		conversationId: string
		labelId: string | null | undefined
		labelName: string | null | undefined
	}): Promise<{ id: string; title: string } | null> {
		let targetLabel: {
			id: string
			title: string
		} | null = null

		const normalizedLabelId = asUuidOrNull(params.labelId)
		if (normalizedLabelId) {
			targetLabel = await prisma.labels.findFirst({
				where: {
					id: normalizedLabelId,
					app_id: params.appId,
					deleted_at: null,
				},
				select: {
					id: true,
					title: true,
				},
			})
		}

		if (!targetLabel) {
			const normalizedLabelName = String(params.labelName || '').trim()
			if (!normalizedLabelName) return null
			targetLabel = await prisma.labels.findFirst({
				where: {
					app_id: params.appId,
					deleted_at: null,
					title: {
						equals: normalizedLabelName,
						mode: 'insensitive',
					},
				},
				select: {
					id: true,
					title: true,
				},
			})
		}

		if (!targetLabel) return null

		await prisma.conversation_labels.upsert({
			where: {
				conversation_id_label_id: {
					conversation_id: params.conversationId,
					label_id: targetLabel.id,
				},
			},
			create: {
				conversation_id: params.conversationId,
				label_id: targetLabel.id,
			},
			update: {},
		})

		return targetLabel
	}

	private static async storeIncomingInstagramMessage(params: {
		inbox: {
			id: string
			app_id: string
			name: string
			config: {
				access_token: string
				page_access_token: string
				fb_page_id: string
				instagram_id: string
				username: string
				profile_picture_url: string
			}
		}
		event: any
	}) {
		const { inbox, event } = params
		const message = event.message
		const mid = String(message?.mid || '').trim()
		if (!mid) {
			throw new Error('Incoming Instagram message missing mid')
		}

		const senderId = String(event.sender?.id || '').trim()
		if (!senderId) {
			throw new Error('Incoming Instagram message missing sender id')
		}

		const messageAt = new Date(event.timestamp)
		const windowExpiresAt = new Date(
			messageAt.getTime() + MESSAGING_WINDOW_HOURS * 60 * 60 * 1000,
		)

		// 1. Upsert contact
		const deterministicIdentifier = `ig:${inbox.app_id}:${senderId}`
		const existingContact = await prisma.contacts.findFirst({
			where: {
				app_id: inbox.app_id,
				deleted_at: null,
				OR: [
					{ identifier: deterministicIdentifier },
					{ instagram_igsid: senderId },
				],
			},
		})

		// Fetch Instagram profile for the sender
		const profile = await fetchInstagramUserProfile(
			senderId,
			inbox.config.page_access_token || inbox.config.access_token,
			inbox.config.instagram_id,
		)

		const contactName = profile?.username
			? profile.username
			: profile?.name || senderId

		const contactAvatar = profile?.profilePicture || null

		const contactMeta = profile
			? {
					instagram_username: profile.username,
					instagram_display_name: profile.name,
					instagram_bio:
						profile.name &&
						profile.username &&
						profile.name !== profile.username
							? profile.name
							: null,
					instagram_profile_picture_url: profile.profilePicture,
					instagram_follower_count: profile.followerCount,
					instagram_is_user_follow_business: profile.isUserFollowBusiness,
					instagram_is_business_follow_user: profile.isBusinessFollowUser,
				}
			: {}

		const contact = existingContact
			? await prisma.contacts.update({
					where: { id: existingContact.id },
					data: {
						identifier: existingContact.identifier || deterministicIdentifier,
						instagram_igsid: senderId,
						name:
							existingContact.name === senderId || !existingContact.name
								? contactName
								: existingContact.name,
						avatar_url:
							contactAvatar || existingContact.avatar_url || undefined,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						channel_type: 'instagram',
						app_id: inbox.app_id,
						deleted_at: null,
						updated_at: new Date(),
						meta: {
							...(typeof existingContact.meta === 'object' &&
							existingContact.meta !== null
								? (existingContact.meta as any)
								: {}),
							...contactMeta,
						},
					},
				})
			: await prisma.contacts.create({
					data: {
						identifier: deterministicIdentifier,
						name: contactName,
						avatar_url: contactAvatar,
						instagram_igsid: senderId,
						channel_type: 'instagram',
						app_id: inbox.app_id,
						first_contact_at: messageAt,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						source: 'instagram_webhook',
						created_at: messageAt,
						meta: contactMeta,
					},
				})

		// 2. Find or create conversation
		// Only reuse conversations that are NOT resolved.
		// If the latest conversation is resolved, create a new one so the
		// agent gets a fresh chatroom instead of reopening a closed thread.
		let isNewLead = false
		let conversation = await prisma.conversations.findFirst({
			where: {
				app_id: inbox.app_id,
				inbox_id: inbox.id,
				contact_id: contact.id,
				channel_type: 'instagram',
				deleted_at: null,
				status: { not: 'resolved' },
			},
			orderBy: { updated_at: 'desc' },
		})

		if (!conversation) {
			isNewLead = true
			conversation = await prisma.conversations.create({
				data: {
					app_id: inbox.app_id,
					inbox_id: inbox.id,
					contact_id: contact.id,
					channel_type: 'instagram',
					status: 'open',
					unread_count: 0,
					last_message_at: messageAt,
					last_activity_at: messageAt,
					messaging_window_open: true,
					is_within_messaging_window: true,
					messaging_window_opened_at: messageAt,
					messaging_window_expires_at: windowExpiresAt,
					created_at: messageAt,
					updated_at: messageAt,
				},
			})
		}

		// 3. Extract content and handle media
		const parsedMessage = extractInstagramMessageContent(message)

		const contentAttributes = {
			...(parsedMessage.contentAttributes || {}),
		} as Record<string, any>

		let mediaUploadResult: {
			mediaId: string
			publicUrl: string
			key: string
			originalUrl: string
			mimeType: string | null
			fileSize: number | null
		} | null = null

		if (parsedMessage.contentType !== 'text' && message.attachments?.length) {
			const attachment = message.attachments[0]
			mediaUploadResult = await persistInstagramMediaToS3({
				appId: inbox.app_id,
				inboxId: inbox.id,
				contentType: parsedMessage.contentType,
				externalMessageId: mid,
				mediaUrl: attachment.payload.url,
				accessToken: inbox.config.page_access_token,
			})

			if (mediaUploadResult?.publicUrl) {
				contentAttributes.media = {
					...(contentAttributes.media || {}),
					url: mediaUploadResult.publicUrl,
					original_url: mediaUploadResult.originalUrl,
					s3_key: mediaUploadResult.key,
					mime_type: mediaUploadResult.mimeType || undefined,
					file_size: mediaUploadResult.fileSize || undefined,
				}
			}
		}

		const messageExtras = buildMessageMediaExtras(
			parsedMessage.contentType,
			contentAttributes,
		)

		// 4. Resolve reply_to external mid to internal message id
		let replyToMessageId: string | null = null
		if (contentAttributes.reply_to?.mid) {
			const replyToMsg = await prisma.messages.findFirst({
				where: {
					external_id: contentAttributes.reply_to.mid,
					deleted_at: null,
				},
				select: { id: true },
			})
			if (replyToMsg) replyToMessageId = replyToMsg.id
		}

		// 5. Persist message in transaction with dedup lock
		const persistedPayload = await prisma.$transaction(async (tx) => {
			await tx.$executeRaw`
					SELECT pg_advisory_xact_lock(hashtext(${mid})::bigint)
				`

			const existing = await tx.messages.findFirst({
				where: {
					external_id: mid,
					deleted_at: null,
				},
				select: { id: true },
			})
			if (existing) return null

			const createdMessage = await tx.messages.create({
				data: {
					conversation_id: conversation.id,
					app_id: inbox.app_id,
					inbox_id: inbox.id,
					message_type: 'incoming',
					sender_type: 'contact',
					sender_id: contact.id,
					content: parsedMessage.content,
					content_type: parsedMessage.contentType,
					content_attributes: contentAttributes as any,
					extras: messageExtras as any,
					external_id: mid,
					status: 'sent',
					raw_payload: event as any,
					created_at: messageAt,
					updated_at: new Date(),
					...(replyToMessageId
						? { reply_to_message_id: replyToMessageId }
						: {}),
				},
			})

			// Create media_files record if media was uploaded
			if (mediaUploadResult) {
				await tx.media_files.create({
					data: {
						platform: 'instagram',
						media_id: mediaUploadResult.mediaId,
						message_id: createdMessage.id,
						media_type: parsedMessage.contentType,
						mime_type: mediaUploadResult.mimeType,
						media_url: mediaUploadResult.originalUrl,
						local_url: mediaUploadResult.publicUrl,
						download_status: 'downloaded',
						downloaded_at: new Date(),
						updated_at: new Date(),
					},
				})
			}

			const updatedConversation = await tx.conversations.update({
				where: { id: conversation.id },
				data: {
					status: 'open',
					unread_count: { increment: 1 },
					last_message_at: messageAt,
					last_activity_at: messageAt,
					messaging_window_open: true,
					is_within_messaging_window: true,
					messaging_window_opened_at: messageAt,
					messaging_window_expires_at: windowExpiresAt,
					updated_at: new Date(),
				},
			})

			return {
				createdMessage,
				updatedConversation,
			}
		})

		if (!persistedPayload) {
			return { status: 'duplicate' as const }
		}

		const { createdMessage, updatedConversation } = persistedPayload

		return {
			status: 'created' as const,
			appId: inbox.app_id,
			inboxId: inbox.id,
			conversationId: updatedConversation.id,
			message: createdMessage,
			contact: {
				id: contact.id,
				name: contact.name,
				identifier: contact.identifier,
				avatar_url: contact.avatar_url,
				meta: contact.meta,
				metadata: contact.metadata,
			},
			channelName: inbox.name || null,
			isNewLead,
		}
	}

	private static async emitInstagramMessageCreatedEvent(params: {
		appId: string
		conversationId: string
		message: any
		contact: {
			id: string
			name: string | null
			identifier: string | null
			avatar_url?: string | null
			meta?: any
			metadata?: any
		}
		channelName: string | null
	}) {
		try {
			const io = getRealtimeIO()
			if (!io) return

			const payload = {
				message: {
					id: params.message.id,
					external_id: params.message.external_id || null,
					content: params.message.content,
					message_type: params.message.message_type,
					content_type: params.message.content_type,
					content_attributes: params.message.content_attributes || {},
					extras: params.message.extras || {},
					status: params.message.status,
					sender_type: params.message.sender_type,
					sender_id: params.message.sender_id,
					created_at: params.message.created_at,
					reply_to_message_id: params.message.reply_to_message_id || null,
				},
				conversation: {
					id: params.conversationId,
					app_id: params.appId,
					channel_type: 'instagram',
					status: 'open',
					channel_name: params.channelName,
					contacts: params.contact,
				},
			}

			io.to(`app:${params.appId}`).emit('message:created', payload)
			io.to(`conversation:${params.conversationId}`).emit(
				'message:created',
				payload,
			)
		} catch (error) {
			console.error(
				'[WebhookService] Failed to emit Instagram realtime event:',
				error,
			)
		}
	}

	private static async storeIncomingTikTokMessage(params: {
		inbox: {
			id: string
			app_id: string
			name: string
			config: {
				tiktok_id?: unknown
				open_id?: unknown
				account_id?: unknown
				display_name?: unknown
				avatar_url?: unknown
				access_token?: unknown
				refresh_token?: unknown
				token_expires_at?: unknown
			}
		}
		event: NormalizedTikTokInboundEvent
	}) {
		const { inbox, event } = params
		const externalMessageId = String(event.messageId || '').trim()
		if (!externalMessageId) {
			throw new Error('Incoming TikTok message missing message id')
		}

		const senderId = String(event.senderId || '').trim()
		if (!senderId) {
			throw new Error('Incoming TikTok message missing sender id')
		}

		const messageAt =
			event.timestamp instanceof Date &&
			!Number.isNaN(event.timestamp.getTime())
				? event.timestamp
				: new Date()
		const windowExpiresAt = new Date(
			messageAt.getTime() + MESSAGING_WINDOW_HOURS * 60 * 60 * 1000,
		)

		const senderRecord = asRecord(event.raw.sender)
		const senderProfile = asRecord(
			senderRecord.profile ||
				senderRecord.user ||
				asRecord(asRecord(event.raw.message).sender),
		)
		const contactName =
			asString(senderProfile.display_name) ||
			asString(senderProfile.nickname) ||
			asString(senderProfile.username) ||
			event.text ||
			senderId
		const contactAvatar =
			asString(senderProfile.avatar_url) ||
			asString(senderProfile.avatar) ||
			null

		const deterministicIdentifier = `tt:${inbox.app_id}:${senderId}`
		const existingContact = await prisma.contacts.findFirst({
			where: {
				app_id: inbox.app_id,
				deleted_at: null,
				OR: [{ identifier: deterministicIdentifier }, { tiktok_id: senderId }],
			},
		})

		const nextMeta: Record<string, unknown> = {
			...asRecord(existingContact?.meta),
			tiktok_sender_id: senderId,
			tiktok_recipient_id: event.recipientId,
			tiktok_last_message_id: externalMessageId,
			...(asString(senderProfile.display_name)
				? { tiktok_display_name: asString(senderProfile.display_name) }
				: {}),
			...(asString(senderProfile.username)
				? { tiktok_username: asString(senderProfile.username) }
				: {}),
			...(contactAvatar ? { tiktok_avatar_url: contactAvatar } : {}),
		}

		const contact = existingContact
			? await prisma.contacts.update({
					where: { id: existingContact.id },
					data: {
						identifier: existingContact.identifier || deterministicIdentifier,
						tiktok_id: senderId,
						name:
							existingContact.name === senderId || !existingContact.name
								? contactName
								: existingContact.name,
						avatar_url:
							contactAvatar || existingContact.avatar_url || undefined,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						channel_type: 'tiktok',
						app_id: inbox.app_id,
						deleted_at: null,
						updated_at: new Date(),
						meta: nextMeta as any,
					},
				})
			: await prisma.contacts.create({
					data: {
						identifier: deterministicIdentifier,
						name: contactName,
						avatar_url: contactAvatar,
						tiktok_id: senderId,
						channel_type: 'tiktok',
						app_id: inbox.app_id,
						first_contact_at: messageAt,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						source: 'tiktok_webhook',
						created_at: messageAt,
						meta: nextMeta as any,
					},
				})

		let isNewLead = false
		let conversation = await prisma.conversations.findFirst({
			where: {
				app_id: inbox.app_id,
				inbox_id: inbox.id,
				contact_id: contact.id,
				channel_type: 'tiktok',
				deleted_at: null,
				status: { not: 'resolved' },
			},
			orderBy: { updated_at: 'desc' },
		})

		if (!conversation) {
			isNewLead = true
			conversation = await prisma.conversations.create({
				data: {
					app_id: inbox.app_id,
					inbox_id: inbox.id,
					contact_id: contact.id,
					channel_type: 'tiktok',
					status: 'open',
					unread_count: 0,
					last_message_at: messageAt,
					last_activity_at: messageAt,
					messaging_window_open: true,
					is_within_messaging_window: true,
					messaging_window_opened_at: messageAt,
					messaging_window_expires_at: windowExpiresAt,
					created_at: messageAt,
					updated_at: messageAt,
				},
			})
		}

		const contentAttributes: Record<string, any> = {
			type: event.contentType,
			tiktok: {
				sender_id: event.senderId,
				recipient_id: event.recipientId,
				message_id: externalMessageId,
			},
			raw_event: event.raw,
		}

		if (event.contentType !== 'text') {
			contentAttributes.media = {
				type: event.contentType,
				url: event.mediaUrl,
				mime_type: event.mediaMimeType,
				file_name: event.mediaFileName,
			}
		}

		const messageExtras = buildMessageMediaExtras(
			event.contentType,
			contentAttributes,
		)

		const persistedPayload = await prisma.$transaction(async (tx) => {
			await tx.$executeRaw`
				SELECT pg_advisory_xact_lock(hashtext(${externalMessageId})::bigint)
			`

			const existing = await tx.messages.findFirst({
				where: {
					external_id: externalMessageId,
					deleted_at: null,
				},
				select: { id: true },
			})
			if (existing) return null

			const createdMessage = await tx.messages.create({
				data: {
					conversation_id: conversation.id,
					app_id: inbox.app_id,
					inbox_id: inbox.id,
					message_type: 'incoming',
					sender_type: 'contact',
					sender_id: contact.id,
					content: event.text || `[${String(event.contentType).toUpperCase()}]`,
					content_type: event.contentType,
					content_attributes: contentAttributes as any,
					extras: messageExtras as any,
					external_id: externalMessageId,
					status: 'sent',
					raw_payload: event.raw as any,
					created_at: messageAt,
					updated_at: new Date(),
				},
			})

			if (event.contentType !== 'text' && event.mediaUrl) {
				await tx.media_files.create({
					data: {
						platform: 'tiktok',
						media_id: crypto.randomUUID(),
						message_id: createdMessage.id,
						media_type: event.contentType,
						mime_type: event.mediaMimeType,
						filename: event.mediaFileName,
						media_url: event.mediaUrl,
						local_url: event.mediaUrl,
						download_status: 'pending',
						updated_at: new Date(),
					},
				})
			}

			const updatedConversation = await tx.conversations.update({
				where: { id: conversation.id },
				data: {
					status: 'open',
					unread_count: { increment: 1 },
					last_message_at: messageAt,
					last_activity_at: messageAt,
					messaging_window_open: true,
					is_within_messaging_window: true,
					messaging_window_opened_at: messageAt,
					messaging_window_expires_at: windowExpiresAt,
					updated_at: new Date(),
				},
			})

			return {
				createdMessage,
				updatedConversation,
			}
		})

		if (!persistedPayload) {
			return { status: 'duplicate' as const }
		}

		const { createdMessage, updatedConversation } = persistedPayload

		return {
			status: 'created' as const,
			appId: inbox.app_id,
			inboxId: inbox.id,
			conversationId: updatedConversation.id,
			message: createdMessage,
			contact: {
				id: contact.id,
				name: contact.name,
				identifier: contact.identifier,
				avatar_url: contact.avatar_url,
				meta: contact.meta,
				metadata: contact.metadata,
			},
			channelName: inbox.name || null,
			isNewLead,
		}
	}

	private static async emitTikTokMessageCreatedEvent(params: {
		appId: string
		conversationId: string
		message: any
		contact: {
			id: string
			name: string | null
			identifier: string | null
			avatar_url?: string | null
			meta?: any
			metadata?: any
		}
		channelName: string | null
	}) {
		try {
			const io = getRealtimeIO()
			if (!io) return

			const payload = {
				message: {
					id: params.message.id,
					external_id: params.message.external_id || null,
					content: params.message.content,
					message_type: params.message.message_type,
					content_type: params.message.content_type,
					content_attributes: params.message.content_attributes || {},
					extras: params.message.extras || {},
					status: params.message.status,
					sender_type: params.message.sender_type,
					sender_id: params.message.sender_id,
					created_at: params.message.created_at,
					reply_to_message_id: params.message.reply_to_message_id || null,
				},
				conversation: {
					id: params.conversationId,
					app_id: params.appId,
					channel_type: 'tiktok',
					status: 'open',
					channel_name: params.channelName,
					contacts: params.contact,
				},
			}

			io.to(`app:${params.appId}`).emit('message:created', payload)
			io.to(`conversation:${params.conversationId}`).emit(
				'message:created',
				payload,
			)
		} catch (error) {
			console.error(
				'[WebhookService] Failed to emit TikTok realtime event:',
				error,
			)
		}
	}

	private static async storeNormalizedWhatsAppInboundMessage(params: {
		channel: {
			id: string
			app_id: string
			inbox_id: string
			name?: string | null
			badge_url?: string | null
			api_key?: string | null
			provider?: string | null
		}
		message: NormalizedWhatsAppInboundMessage
	}) {
		const { channel, message } = params
		const externalMessageId = message.externalMessageId
		const senderWaId = message.senderWaId
		const messageAt = message.messageAt
		const windowExpiresAt = new Date(
			messageAt.getTime() + MESSAGING_WINDOW_HOURS * 60 * 60 * 1000,
		)

		const deterministicIdentifier = `wa:${channel.app_id}:${senderWaId}`
		const existingContact = await prisma.contacts.findFirst({
			where: {
				app_id: channel.app_id,
				deleted_at: null,
				OR: [
					{ identifier: deterministicIdentifier },
					{ whatsapp_id: senderWaId },
					{ phone_number: senderWaId },
				],
			},
		})
		const nextContactAdditionalAttributes = {
			...asRecord(existingContact?.additional_attributes),
			...(message.senderJid ? { whatsapp_jid: message.senderJid } : {}),
			...(resolveWhatsappAddressingMode(message.senderJid)
				? {
						whatsapp_addressing_mode: resolveWhatsappAddressingMode(
							message.senderJid,
						),
					}
				: {}),
		}

		const contact = existingContact
			? await prisma.contacts.update({
					where: { id: existingContact.id },
					data: {
						identifier: existingContact.identifier || deterministicIdentifier,
						name: message.contactName,
						phone_number: senderWaId,
						whatsapp_id: senderWaId,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						channel_type: 'whatsapp',
						app_id: channel.app_id,
						additional_attributes: nextContactAdditionalAttributes as any,
						deleted_at: null,
						updated_at: new Date(),
					},
				})
			: await prisma.contacts.create({
					data: {
						identifier: deterministicIdentifier,
						name: message.contactName,
						phone_number: senderWaId,
						whatsapp_id: senderWaId,
						channel_type: 'whatsapp',
						app_id: channel.app_id,
						first_contact_at: messageAt,
						last_inbound_message_at: messageAt,
						last_message_at: messageAt,
						window_expires_at: windowExpiresAt,
						source: 'whatsapp_webhook',
						additional_attributes: nextContactAdditionalAttributes as any,
						created_at: messageAt,
					},
				})

		// Only reuse conversations that are NOT resolved.
		// If the latest conversation is resolved, create a new one so the
		// agent gets a fresh chatroom instead of reopening a closed thread.
		let isNewLead = false
		let conversation = await prisma.conversations.findFirst({
			where: {
				app_id: channel.app_id,
				inbox_id: channel.inbox_id,
				contact_id: contact.id,
				channel_type: 'whatsapp',
				deleted_at: null,
				status: { not: 'resolved' },
			},
			orderBy: { updated_at: 'desc' },
		})

		if (!conversation) {
			isNewLead = true
			conversation = await prisma.conversations.create({
				data: {
					app_id: channel.app_id,
					inbox_id: channel.inbox_id,
					contact_id: contact.id,
					channel_type: 'whatsapp',
					status: 'open',
					unread_count: 0,
					last_message_at: messageAt,
					last_activity_at: messageAt,
					messaging_window_open: true,
					is_within_messaging_window: true,
					messaging_window_opened_at: messageAt,
					messaging_window_expires_at: windowExpiresAt,
					created_at: messageAt,
					updated_at: messageAt,
				},
			})
		}

		const isMediaMessage =
			message.contentType === 'image' ||
			message.contentType === 'video' ||
			message.contentType === 'gif' ||
			message.contentType === 'audio' ||
			message.contentType === 'voice' ||
			message.contentType === 'document' ||
			message.contentType === 'sticker'

		const contentAttributes = {
			...(message.contentAttributes || {}),
		} as Record<string, any>

		const messageExtras = buildMessageMediaExtras(
			message.contentType,
			contentAttributes,
		)

		// Resolve WhatsApp context.message_id to internal reply_to_message_id
		let replyToMessageId: string | null = null
		const waContextId =
			message.replyToExternalId || contentAttributes.context?.message_id
		if (waContextId) {
			const replyToMsg = await prisma.messages.findFirst({
				where: { external_id: waContextId, deleted_at: null },
				select: { id: true },
			})
			if (replyToMsg) replyToMessageId = replyToMsg.id
		}

		const persistedPayload = await prisma.$transaction(async (tx) => {
			await tx.$executeRaw`
					SELECT pg_advisory_xact_lock(hashtext(${externalMessageId})::bigint)
				`

			const existing = await tx.messages.findFirst({
				where: {
					external_id: externalMessageId,
					deleted_at: null,
				},
				select: { id: true },
			})
			if (existing) return null

			const createdMessage = await tx.messages.create({
				data: {
					conversation_id: conversation.id,
					app_id: channel.app_id,
					inbox_id: channel.inbox_id,
					message_type: 'incoming',
					sender_type: 'contact',
					sender_id: contact.id,
					content: message.content,
					content_type: message.contentType,
					content_attributes: contentAttributes as any,
					extras: messageExtras as any,
					external_id: externalMessageId,
					status: 'sent',
					raw_payload: (message.rawPayload ?? message) as any,
					created_at: messageAt,
					updated_at: new Date(),
					...(replyToMessageId
						? { reply_to_message_id: replyToMessageId }
						: {}),
				},
			})

			if (isMediaMessage) {
				const media = (contentAttributes as any)?.media || {}
				const mediaId = String(media?.id || '').trim()
				if (mediaId) {
					const mediaOriginalUrl =
						typeof media?.original_url === 'string'
							? media.original_url
							: typeof media?.media_url === 'string'
								? media.media_url
								: typeof media?.url === 'string'
									? media.url
									: null
					const downloadStatus =
						typeof media?.download_status === 'string'
							? media.download_status
							: typeof media?.url === 'string' || typeof media?.local_url === 'string'
								? 'downloaded'
								: 'pending'

					await tx.media_files.create({
						data: {
							platform: 'whatsapp',
							media_id: mediaId,
							message_id: createdMessage.id,
							media_type: message.contentType,
							mime_type:
								typeof media?.mime_type === 'string' ? media.mime_type : null,
							filename:
								typeof media?.filename === 'string'
									? media.filename
									: typeof media?.file_name === 'string'
										? media.file_name
										: null,
							caption:
								typeof media?.caption === 'string' ? media.caption : null,
							file_size: toBigIntOrNull(media?.file_size),
							sha256: typeof media?.sha256 === 'string' ? media.sha256 : null,
							media_url: mediaOriginalUrl,
							local_url:
								typeof media?.url === 'string'
									? media.url
									: typeof media?.local_url === 'string'
										? media.local_url
										: null,
							download_status: downloadStatus,
							downloaded_at:
								downloadStatus === 'downloaded' ? new Date() : null,
							url_expires_at: null,
							updated_at: new Date(),
						},
					})
				}
			}

			const updatedConversation = await tx.conversations.update({
				where: { id: conversation.id },
				data: {
					status: 'open',
					unread_count: { increment: 1 },
					last_message_at: messageAt,
					last_activity_at: messageAt,
					messaging_window_open: true,
					is_within_messaging_window: true,
					messaging_window_opened_at: messageAt,
					messaging_window_expires_at: windowExpiresAt,
					updated_at: new Date(),
				},
			})

			return {
				createdMessage,
				updatedConversation,
			}
		})

		if (!persistedPayload) {
			return { status: 'duplicate' as const }
		}

		const { createdMessage, updatedConversation } = persistedPayload

		return {
			status: 'created' as const,
			appId: channel.app_id,
			inboxId: channel.inbox_id,
			conversationId: updatedConversation.id,
			message: createdMessage,
			contact: {
				id: contact.id,
				name: contact.name,
				phone_number: contact.phone_number,
				identifier: contact.identifier,
			},
			channelName: channel.name || null,
			channelBadgeUrl: channel.badge_url || null,
			channelProvider: channel.provider || null,
			isNewLead,
		}
	}

	private static async storeIncomingWhatsAppMessage(params: {
		channel: {
			id: string
			app_id: string
			inbox_id: string
			name?: string | null
			badge_url?: string | null
			api_key?: string | null
			provider?: string | null
		}
		value: any
		message: any
	}) {
		const { channel, value, message } = params

		const externalMessageId = String(message?.id || '').trim()
		if (!externalMessageId) {
			throw new Error('Incoming message missing id')
		}

		const senderWaId = String(
			message?.from || value?.contacts?.[0]?.wa_id || '',
		).trim()
		if (!senderWaId) {
			throw new Error('Incoming message missing sender wa_id')
		}

		const contactName =
			value?.contacts?.find((contact: any) => contact?.wa_id === senderWaId)
				?.profile?.name ||
			value?.contacts?.[0]?.profile?.name ||
			senderWaId

		const parsedMessage = extractMessageContent(message)
		const isMediaMessage =
			parsedMessage.contentType === 'image' ||
			parsedMessage.contentType === 'video' ||
			parsedMessage.contentType === 'audio' ||
			parsedMessage.contentType === 'document'
		const contentAttributes = {
			...(parsedMessage.contentAttributes || {}),
		} as Record<string, any>

		if (isMediaMessage) {
			const mediaPayload = contentAttributes.media
			if (mediaPayload && typeof mediaPayload === 'object') {
				const mediaUploadResult = await persistInboundMediaToS3({
					appId: channel.app_id,
					inboxId: channel.inbox_id,
					contentType: parsedMessage.contentType,
					externalMessageId,
					accessToken: channel.api_key || '',
					media: mediaPayload,
				})

				if (mediaUploadResult?.publicUrl) {
					contentAttributes.media = {
						...mediaPayload,
						id: mediaUploadResult.mediaId,
						url: mediaUploadResult.publicUrl,
						original_url: mediaUploadResult.originalUrl,
						s3_key: mediaUploadResult.key,
						mime_type:
							mediaPayload?.mime_type ||
							mediaUploadResult.mimeType ||
							undefined,
						sha256:
							mediaPayload?.sha256 || mediaUploadResult.sha256 || undefined,
						file_size:
							mediaPayload?.file_size ||
							mediaUploadResult.fileSize ||
							undefined,
						filename:
							mediaPayload?.filename ||
							mediaPayload?.file_name ||
							`${mediaUploadResult.mediaId}.${getExtensionFromMimeType(mediaUploadResult.mimeType || undefined)}`,
						download_status: 'downloaded',
					}
				}
			}
		}

		return this.storeNormalizedWhatsAppInboundMessage({
			channel,
			message: {
				externalMessageId,
				senderWaId,
				contactName,
				messageAt: parseUnixTimestamp(message?.timestamp),
				content: parsedMessage.content,
				contentType: parsedMessage.contentType,
				contentAttributes,
				rawPayload: message,
			},
		})
	}

	private static async emitMessageCreatedEvent(params: {
		appId: string
		conversationId: string
		message: any
		contact: {
			id: string
			name: string | null
			phone_number: string | null
			identifier: string | null
		}
		channelName: string | null
		channelBadgeUrl: string | null
		channelProvider: string | null
	}) {
		try {
			const io = getRealtimeIO()
			if (!io) return

			const payload = {
				message: {
					id: params.message.id,
					external_id: params.message.external_id || null,
					content: params.message.content,
					message_type: params.message.message_type,
					content_type: params.message.content_type,
					content_attributes: params.message.content_attributes || {},
					extras: params.message.extras || {},
					status: params.message.status,
					sender_type: params.message.sender_type,
					sender_id: params.message.sender_id,
					created_at: params.message.created_at,
					reply_to_message_id: params.message.reply_to_message_id || null,
				},
				conversation: {
					id: params.conversationId,
					app_id: params.appId,
					channel_type: 'whatsapp',
					provider: params.channelProvider,
					whatsapp_provider: params.channelProvider,
					status: 'open',
					channel_name: params.channelName,
					channel_badge_url: params.channelBadgeUrl,
					contacts: params.contact,
				},
			}

			io.to(`app:${params.appId}`).emit('message:created', payload)
			io.to(`conversation:${params.conversationId}`).emit(
				'message:created',
				payload,
			)
		} catch (error) {
			console.error('[WebhookService] Failed to emit realtime event:', error)
		}
	}

	private static emitMessageStatusUpdatedEvent(params: {
		messageId: string
		externalMessageId: string | null
		conversationId: string
		appId: string | null
		status: string
		statusAt: Date
	}) {
		try {
			const io = getRealtimeIO()
			if (!io) return

			const payload = {
				message_id: params.messageId,
				external_id: params.externalMessageId,
				conversation_id: params.conversationId,
				app_id: params.appId,
				status: params.status,
				status_at: params.statusAt.toISOString(),
			}

			if (params.appId) {
				io.to(`app:${params.appId}`).emit('message:status_updated', payload)
			}
			io.to(`conversation:${params.conversationId}`).emit(
				'message:status_updated',
				payload,
			)
		} catch (error) {
			console.error(
				'[WebhookService] Failed to emit message status update event:',
				error,
			)
		}
	}

	static async getWhatsAppMediaContentByMessageId(messageId: string) {
		const message = await prisma.messages.findUnique({
			where: { id: messageId },
			select: {
				id: true,
				external_id: true,
				app_id: true,
				inbox_id: true,
				content_type: true,
				content_attributes: true,
				raw_payload: true,
			},
		})

		if (!message) return null
		const contentType = String(message.content_type || '').toLowerCase()
		if (
			contentType !== 'image' &&
			contentType !== 'video' &&
			contentType !== 'audio' &&
			contentType !== 'document'
		) {
			return null
		}

		const contentAttributes = (message.content_attributes || {}) as any
		const mediaFromAttributes = contentAttributes?.media || {}
		const mediaFromPayload = (message.raw_payload as any)?.[contentType] || {}
		const media = {
			...mediaFromPayload,
			...mediaFromAttributes,
		}
		let mediaUrl =
			typeof media?.url === 'string'
				? media.url
				: typeof media?.original_url === 'string'
					? media.original_url
					: typeof media?.media_url === 'string'
						? media.media_url
						: undefined
		let mimeType =
			typeof media?.mime_type === 'string' ? media.mime_type : undefined

		const mediaId = String(media?.id || '').trim()

		if (mediaUrl && !isMetaProtectedMediaUrl(mediaUrl)) {
			const response = await fetch(mediaUrl)
			if (!response.ok) return null
			const arrayBuffer = await response.arrayBuffer()
			return {
				buffer: Buffer.from(arrayBuffer),
				mimeType:
					response.headers.get('content-type') || mimeType || 'application/octet-stream',
			}
		}

		if (!mediaId) return null

		const channel = await prisma.whatsapp_channels.findFirst({
			where: {
				inbox_id: message.inbox_id || undefined,
				app_id: message.app_id || undefined,
				deleted_at: null,
			},
			select: { api_key: true, provider: true },
		})

		if (!channel?.api_key) return null

		// Try to persist to S3 for permanent URL while serving this request.
		const uploadResult = await persistInboundMediaToS3({
			appId: message.app_id || 'unknown',
			inboxId: message.inbox_id || 'unknown',
			contentType,
			externalMessageId: message.external_id || message.id,
			accessToken: channel.api_key,
			media,
		})

		if (uploadResult?.publicUrl) {
			const nextContentAttributes = {
				...(contentAttributes || {}),
				media: {
					...(media || {}),
					id: uploadResult.mediaId,
					url: uploadResult.publicUrl,
					original_url: uploadResult.originalUrl,
					s3_key: uploadResult.key,
					mime_type: media?.mime_type || uploadResult.mimeType || undefined,
					sha256: media?.sha256 || uploadResult.sha256 || undefined,
					file_size: media?.file_size || uploadResult.fileSize || undefined,
				},
			}
			const nextExtras = buildMessageMediaExtras(
				contentType,
				nextContentAttributes,
			)

			await prisma.messages.update({
				where: { id: message.id },
				data: {
					content_attributes: nextContentAttributes as any,
					extras: nextExtras as any,
					updated_at: new Date(),
				},
			})
		}

		mediaUrl =
			uploadResult?.publicUrl ||
			(typeof media?.url === 'string'
				? media.url
				: typeof media?.original_url === 'string'
					? media.original_url
					: undefined)
		mimeType =
			uploadResult?.mimeType ||
			(typeof media?.mime_type === 'string' ? media.mime_type : undefined)

		if (!mediaUrl) {
			const metadata = await fetchMetaMediaMetadata(mediaId, channel.api_key)
			mediaUrl = metadata.url || undefined
			mimeType = metadata.mime_type || mimeType
		}
		if (!mediaUrl) return null

		let buffer: Buffer
		try {
			buffer = await downloadMetaMediaBuffer(mediaUrl, channel.api_key)
		} catch {
			const refreshedMetadata = await fetchMetaMediaMetadata(
				mediaId,
				channel.api_key,
			)
			if (!refreshedMetadata.url) return null
			mediaUrl = refreshedMetadata.url
			mimeType = refreshedMetadata.mime_type || mimeType
			buffer = await downloadMetaMediaBuffer(mediaUrl, channel.api_key)
		}

		return {
			buffer,
			mimeType: mimeType || 'application/octet-stream',
		}
	}

	private static async applyBridgeWhatsAppStatus(statusPayload: any) {
		const internalMessageId =
			asUuidOrNull(statusPayload?.messageId) ||
			asUuidOrNull(statusPayload?.message_id) ||
			asUuidOrNull(statusPayload?.internalMessageId) ||
			asUuidOrNull(statusPayload?.internal_message_id)
		const externalMessageId =
			asString(statusPayload?.externalId) ||
			asString(statusPayload?.external_id) ||
			asString(statusPayload?.messageExternalId) ||
			asString(statusPayload?.message_external_id) ||
			asString(statusPayload?.id)

		const message = internalMessageId
			? await prisma.messages.findUnique({
					where: { id: internalMessageId },
				})
			: externalMessageId
				? await prisma.messages.findFirst({
						where: { external_id: externalMessageId },
						orderBy: { created_at: 'desc' },
					})
				: null
		if (!message) return false

		const nextStatus = mapWhatsAppMessageStatus(
			asString(statusPayload?.status) || undefined,
		)
		const statusAt = parseBridgeWhatsAppTimestamp(
			statusPayload?.timestamp ||
				statusPayload?.statusAt ||
				statusPayload?.status_at,
		)
		const firstError = asRecord(
			Array.isArray(statusPayload?.errors)
				? statusPayload.errors[0]
				: statusPayload?.error,
		)

		await prisma.messages.update({
			where: { id: message.id },
			data: {
				status: nextStatus,
				error:
					Object.keys(firstError).length > 0
						? {
								code: firstError.code || null,
								title: firstError.title || null,
								message: firstError.message || null,
							}
						: undefined,
				updated_at: new Date(),
			},
		})

		await prisma.message_status_history.create({
			data: {
				message_id: message.id,
				external_message_id:
					message.external_id || externalMessageId || undefined,
				status: nextStatus,
				previous_status: message.status || undefined,
				error_code: firstError.code ? String(firstError.code) : undefined,
				error_title:
					typeof firstError.title === 'string' ? firstError.title : undefined,
				error_message:
					typeof firstError.message === 'string'
						? firstError.message
						: undefined,
				error_details:
					(statusPayload?.errors || statusPayload?.error || null) as any,
				timestamp: statusAt,
				webhook_payload: statusPayload as any,
			},
		})

		if (message.conversation_id) {
			this.emitMessageStatusUpdatedEvent({
				messageId: message.id,
				externalMessageId:
					message.external_id || externalMessageId || message.id,
				conversationId: message.conversation_id,
				appId: message.app_id || null,
				status: nextStatus,
				statusAt,
			})
		}

		return true
	}

	private static async applyWhatsAppStatus(statusPayload: any) {
		const externalMessageId = String(statusPayload?.id || '').trim()
		if (!externalMessageId) return false

		const message = await prisma.messages.findFirst({
			where: { external_id: externalMessageId },
			orderBy: { created_at: 'desc' },
		})
		if (!message) return false

		const nextStatus = mapWhatsAppMessageStatus(statusPayload?.status)
		const statusAt = parseUnixTimestamp(statusPayload?.timestamp)
		const firstError = Array.isArray(statusPayload?.errors)
			? statusPayload.errors[0]
			: null

		await prisma.messages.update({
			where: { id: message.id },
			data: {
				status: nextStatus,
				error: firstError
					? {
							code: firstError?.code || null,
							title: firstError?.title || null,
							message: firstError?.message || null,
						}
					: undefined,
				updated_at: new Date(),
			},
		})

		await prisma.message_status_history.create({
			data: {
				message_id: message.id,
				external_message_id: externalMessageId,
				status: nextStatus,
				previous_status: message.status || undefined,
				error_code: firstError?.code ? String(firstError.code) : undefined,
				error_title: firstError?.title || undefined,
				error_message: firstError?.message || undefined,
				error_details: (statusPayload?.errors || null) as any,
				timestamp: statusAt,
				webhook_payload: statusPayload as any,
			},
		})

		if (message.conversation_id) {
			this.emitMessageStatusUpdatedEvent({
				messageId: message.id,
				externalMessageId: message.external_id || externalMessageId,
				conversationId: message.conversation_id,
				appId: message.app_id || null,
				status: nextStatus,
				statusAt,
			})
		}

		return true
	}
}

export const __test__ = {
	extractStatusTimelineTexts,
	splitAssistantTextForDelivery,
	isConversationHandoffActive,
}
