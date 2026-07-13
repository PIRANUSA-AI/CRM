import prisma from '../../lib/prisma'
import { maintenanceQueue } from '../../lib/queue'
import { isUuid } from '../../lib/utils'
import { ConversationService } from '../conversation/service'
import { buildAiAnalytics } from '../conversation/ai-analytics'
import { MessageService } from '../message/service'
import { AIResponseLogService } from './response-log-service'
import { ChatbotService } from './service'
import { CHAT_ASSIGNABLE_ROLES } from '../../lib/require-role'

const CHATBOT_FOLLOWUP_STATE_KEY = 'chatbot_followup'
const MAX_FOLLOWUP_RULES = 10
const MAX_FOLLOWUP_PROMPT_LENGTH = 2_000
const MAX_HISTORY_MESSAGES = 20
const MAX_FOLLOWUP_SEGMENTS = Math.max(
	0,
	Number(process.env.MAX_FOLLOWUP_SEGMENTS || 0),
)
const ENABLE_FOLLOWUP_IMAGE_SEGMENTS = !['0', 'false', 'no', 'off'].includes(
	String(process.env.ENABLE_FOLLOWUP_IMAGE_SEGMENTS ?? 'true').toLowerCase(),
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
const FOLLOWUP_PROCESSING_STALE_MS = Math.max(
	60_000,
	Number(process.env.CHATBOT_FOLLOWUP_PROCESSING_STALE_MS || 5 * 60_000),
)
const FOLLOWUP_DISPATCH_JOB = 'dispatch-chatbot-followups'
const FOLLOWUP_DISPATCH_DELAY_BUFFER_MS = Math.max(
	0,
	Number(process.env.CHATBOT_FOLLOWUP_DISPATCH_DELAY_BUFFER_MS || 1_000),
)

type ChatbotFollowupRule = {
	id: string
	prompt: string
	timeIntervalMinutes: number
	isActive: boolean
	options: {
		handoff: boolean
		sendExact: boolean
	}
}

type ChatbotFollowupState = {
	chatbot_id: string | null
	next_rule_index: number
	next_due_at: string | null
	anchor_at: string
	last_sent_at: string | null
	updated_at: string
}

type ChatbotSnapshotForFollowup = {
	id: string
	app_id: string
	name?: string | null
	watcher_enabled?: boolean | null
	plugin_data?: unknown
	ai_followups?: unknown
}

type FollowupMessageSegment =
	| {
			type: 'text'
			content: string
	  }
	| {
			type: 'image'
			url: string
	  }

type FollowupHistoryMessage = {
	role: 'user' | 'assistant'
	content: string
}

const FOLLOWUP_TREATMENT_CATALOG: Array<{
	canonical: string
	aliases: string[]
}> = [
	{
		canonical: 'Acne Laser Facial',
		aliases: ['acne laser facial'],
	},
	{
		canonical: 'IPL Acne',
		aliases: ['ipl acne'],
	},
	{
		canonical: 'Meso Acne',
		aliases: ['meso acne'],
	},
	{
		canonical: 'Acne Peel',
		aliases: ['acne peel'],
	},
	{
		canonical: 'Rejuran Scar',
		aliases: ['rejuran scar'],
	},
	{
		canonical: 'Skin Booster',
		aliases: ['skin booster'],
	},
	{
		canonical: 'HIFU',
		aliases: ['hifu'],
	},
	{
		canonical: 'Body Whitening Peel',
		aliases: ['body whitening peel'],
	},
	{
		canonical: 'Body Spot Repair',
		aliases: ['body spot repair'],
	},
	{
		canonical: 'Slimming Treatment',
		aliases: ['slimming treatment', 'slimming'],
	},
	{
		canonical: 'PRP Hair',
		aliases: ['prp hair'],
	},
	{
		canonical: 'Hair Grow',
		aliases: ['hair grow'],
	},
	{
		canonical: 'Biolight Hair',
		aliases: ['biolight hair'],
	},
	{
		canonical: 'Botox',
		aliases: ['botox'],
	},
	{
		canonical: 'Underarm Brightening',
		aliases: ['underarm brightening'],
	},
	{
		canonical: 'Glass Skin Facial',
		aliases: ['glass skin facial'],
	},
	{
		canonical: 'SOZO Signature Facial',
		aliases: ['sozo signature facial'],
	},
]

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => asString(item))
		.filter((item): item is string => Boolean(item))
}

function asBoolean(value: unknown, fallback = false): boolean {
	if (typeof value === 'boolean') return value
	if (typeof value === 'number') return value !== 0
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		if (['true', '1', 'yes', 'on', 'active'].includes(normalized)) return true
		if (['false', '0', 'no', 'off', 'inactive'].includes(normalized))
			return false
	}
	return fallback
}

function normalizeForTreatmentMatching(value: string): string {
	return String(value || '')
		.toLowerCase()
		.replace(/[_-]+/g, ' ')
		.replace(/[^a-z0-9\s/+&]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function extractTreatmentMentions(value: string): Set<string> {
	const normalized = normalizeForTreatmentMatching(value)
	const matches = new Set<string>()
	if (!normalized) return matches

	for (const treatment of FOLLOWUP_TREATMENT_CATALOG) {
		for (const alias of treatment.aliases) {
			const aliasPattern = alias
				.split(/\s+/)
				.filter(Boolean)
				.map((term) => escapeRegex(term))
				.join('\\s+')
			if (!aliasPattern) continue
			const regex = new RegExp(`\\b${aliasPattern}\\b`, 'i')
			if (regex.test(normalized)) {
				matches.add(treatment.canonical)
				break
			}
		}
	}

	return matches
}

function inferRecentConversationTreatment(
	history: FollowupHistoryMessage[],
): string | null {
	for (const item of [...history].reverse()) {
		const mentions = [...extractTreatmentMentions(item.content)]
		if (mentions.length === 0) continue
		return mentions[0]
	}
	return null
}

function alignSegmentsToTreatmentContext(params: {
	segments: FollowupMessageSegment[]
	contextTreatment: string | null
}): {
	segments: FollowupMessageSegment[]
	hadTreatmentSignals: boolean
	droppedCount: number
} {
	if (!params.contextTreatment) {
		return {
			segments: normalizeFollowupSegments(params.segments),
			hadTreatmentSignals: false,
			droppedCount: 0,
		}
	}

	const contextTreatment = params.contextTreatment
	const kept: FollowupMessageSegment[] = []
	let hadTreatmentSignals = false
	let droppedCount = 0

	for (const rawSegment of params.segments) {
		const normalizedSegment = normalizeFollowupSegments([rawSegment])[0]
		if (!normalizedSegment) continue
		const source =
			normalizedSegment.type === 'text'
				? normalizedSegment.content
				: normalizedSegment.url
		const mentions = extractTreatmentMentions(source)
		if (mentions.size === 0) {
			kept.push(normalizedSegment)
			continue
		}

		hadTreatmentSignals = true
		if (mentions.size === 1 && mentions.has(contextTreatment)) {
			kept.push(normalizedSegment)
			continue
		}

		droppedCount += 1
	}

	return {
		segments: normalizeFollowupSegments(kept),
		hadTreatmentSignals,
		droppedCount,
	}
}

function textFromSegments(segments: FollowupMessageSegment[]): string {
	return normalizeFollowupSegments(segments)
		.filter(
			(segment): segment is { type: 'text'; content: string } =>
				segment.type === 'text',
		)
		.map((segment) => segment.content)
		.filter((content) => content.trim().length > 0)
		.join('\n\n')
		.trim()
}

function hasFollowupPromptLeakage(value: string): boolean {
	const source = String(value || '')
	if (!source.trim()) return false
	const normalized = source.toLowerCase()

	const directLeakPatterns = [
		/\bberdasarkan knowledge\b/i,
		/\bknowledge\s*["“][^"”]{0,120}["”]/i,
		/\bcore identity\b/i,
		/\bagent transfer conditions?\b/i,
		/\byou are generating a follow-?up\b/i,
		/\binactivity window\b/i,
		/\bwrite one concise follow-?up\b/i,
		/\brule follow-?up\b/i,
		/\bstrict knowledge base\b/i,
		/\bno hallucination\b/i,
	]
	if (directLeakPatterns.some((pattern) => pattern.test(normalized))) {
		return true
	}

	// Common leakage from rule lists copied from behavior prompt.
	if (/\b\d+\.\s*jika\s+casenya\b/i.test(normalized)) return true
	if (
		/\b(jika|if)\b[\s\S]{0,140}\b(maka|then)\b[\s\S]{0,140}\bfollow-?up\b/i.test(
			normalized,
		)
	) {
		return true
	}

	return false
}

function shouldRejectGeneratedFollowupSegments(
	segments: FollowupMessageSegment[],
): boolean {
	const text = textFromSegments(segments)
	return hasFollowupPromptLeakage(text)
}

function asPositiveInt(value: unknown, fallback: number): number {
	const parsed =
		typeof value === 'number' ? value : Number.parseInt(String(value || ''), 10)
	if (!Number.isFinite(parsed) || parsed <= 0) return fallback
	return Math.floor(parsed)
}

function parseArrayLike(value: unknown): unknown[] {
	if (Array.isArray(value)) return value
	if (typeof value === 'string' && value.trim()) {
		try {
			const parsed = JSON.parse(value)
			return Array.isArray(parsed) ? parsed : []
		} catch {
			return []
		}
	}
	return []
}

function addMinutes(date: Date, minutes: number): Date {
	return new Date(date.getTime() + minutes * 60_000)
}

function normalizeFollowupRules(value: unknown): ChatbotFollowupRule[] {
	const source = parseArrayLike(value)
	return source
		.map((item, index) => {
			const record = asRecord(item)
			const prompt = String(record.prompt || '')
				.trim()
				.slice(0, MAX_FOLLOWUP_PROMPT_LENGTH)
			if (!prompt) return null
			const timeIntervalMinutes = Math.min(
				asPositiveInt(record.time_interval, 60),
				7 * 24 * 60,
			)
			const options = asRecord(record.options)
			return {
				id: asString(record.id) || `followup-${index + 1}`,
				prompt,
				timeIntervalMinutes,
				isActive: asBoolean(record.is_in_bot_reply, true),
				options: {
					handoff: asBoolean(options.handoff, false),
					sendExact: asBoolean(options.send_exact, false),
				},
			} satisfies ChatbotFollowupRule
		})
		.filter(
			(item): item is ChatbotFollowupRule =>
				item !== null && item.isActive === true,
		)
		.slice(0, MAX_FOLLOWUP_RULES)
}

function parseFollowupState(value: unknown): ChatbotFollowupState | null {
	const record = asRecord(value)
	const anchorAt = asString(record.anchor_at)
	const nextDueAt = asString(record.next_due_at)
	if (!anchorAt || !nextDueAt) return null

	const nextRuleIndex = Math.max(0, asPositiveInt(record.next_rule_index, 0))

	return {
		chatbot_id: asString(record.chatbot_id),
		next_rule_index: nextRuleIndex,
		next_due_at: nextDueAt,
		anchor_at: anchorAt,
		last_sent_at: asString(record.last_sent_at),
		updated_at: asString(record.updated_at) || new Date().toISOString(),
	}
}

function resolvePluginDataChatbotFlags(value: unknown) {
	const pluginData = asRecord(value)
	return {
		watcherEnabled: asBoolean(pluginData.watcher_enabled, false),
	}
}

function normalizeHttpUrl(value: string): string | null {
	let trimmed = String(value || '').trim()
	if (trimmed) {
		while (trimmed.length > 0) {
			const last = trimmed[trimmed.length - 1]
			if (/[.,!?;]$/.test(last)) {
				trimmed = trimmed.slice(0, -1)
				continue
			}

			if (last === ')' || last === ']' || last === '}') {
				const openParenCount = (trimmed.match(/\(/g) || []).length
				const closeParenCount = (trimmed.match(/\)/g) || []).length
				const hasUnbalancedClosingParen =
					last === ')' && closeParenCount > openParenCount
				if (hasUnbalancedClosingParen || last === ']' || last === '}') {
					trimmed = trimmed.slice(0, -1)
					continue
				}
			}

			break
		}
	}
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString()
	} catch {
		return null
	}
}

function isLikelyImageUrl(value: string): boolean {
	if (/\.(png|jpe?g|gif|webp|bmp|svg)(\?|#|$)/i.test(value)) {
		return true
	}

	try {
		const parsed = new URL(value)
		const hostname = parsed.hostname.toLowerCase()
		const pathname = parsed.pathname.toLowerCase()
		const looksLikeFileAsset = pathname.length > 1 && !pathname.endsWith('/')
		const hasBlockedExtension =
			/\.(pdf|txt|json|csv|docx?|xlsx?|zip|rar|7z)(\?|#|$)/i.test(pathname)
		if (
			looksLikeFileAsset &&
			!hasBlockedExtension &&
			(hostname === 'files.cekat.ai' || hostname.endsWith('.cekat.ai'))
		) {
			return true
		}
	} catch {
		// Ignore malformed URLs.
	}

	return false
}

function normalizeFollowupSegments(
	segments: FollowupMessageSegment[],
): FollowupMessageSegment[] {
	const normalized: FollowupMessageSegment[] = []
	const seenImageUrls = new Set<string>()

	for (const segment of segments) {
		if (segment.type === 'image') {
			const normalizedUrl = normalizeHttpUrl(segment.url)
			if (!normalizedUrl || !isLikelyImageUrl(normalizedUrl)) continue
			if (seenImageUrls.has(normalizedUrl)) continue
			seenImageUrls.add(normalizedUrl)
			normalized.push({
				type: 'image',
				url: normalizedUrl,
			})
			continue
		}

		const text = String(segment.content || '')
			.replace(/\r\n/g, '\n')
			.replace(/\n{3,}/g, '\n\n')
			.trim()
		if (!text) continue

		const lastItem = normalized[normalized.length - 1]
		if (lastItem?.type === 'text') {
			lastItem.content = `${lastItem.content}\n\n${text}`.trim()
		} else {
			normalized.push({
				type: 'text',
				content: text,
			})
		}
	}

	if (MAX_FOLLOWUP_SEGMENTS > 0) {
		return normalized.slice(0, MAX_FOLLOWUP_SEGMENTS)
	}
	return normalized
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

async function sleep(ms: number): Promise<void> {
	if (ms <= 0) return
	await new Promise((resolve) => setTimeout(resolve, ms))
}

function splitTextIntoFollowupSegments(
	value: string,
): FollowupMessageSegment[] {
	const source = String(value || '')
	if (!source.trim()) return []

	const imageTokenRegex =
		/!\[[^\]]*\]\s*\((https?:\/\/[^\s)]+)\)|(https?:\/\/[^\s"'<>]+)/gi
	const segments: FollowupMessageSegment[] = []
	let cursor = 0
	let match: RegExpExecArray | null = null

	while ((match = imageTokenRegex.exec(source)) !== null) {
		const tokenStart = match.index
		const tokenEnd = imageTokenRegex.lastIndex
		const tokenText = source.slice(tokenStart, tokenEnd)
		const before = source.slice(cursor, tokenStart)
		if (before.trim()) {
			segments.push({
				type: 'text',
				content: before,
			})
		}

		const rawUrl = String(match[1] || match[2] || '').trim()
		const normalizedUrl = normalizeHttpUrl(rawUrl)
		if (normalizedUrl && isLikelyImageUrl(normalizedUrl)) {
			segments.push({
				type: 'image',
				url: normalizedUrl,
			})
		} else if (tokenText.trim()) {
			segments.push({
				type: 'text',
				content: tokenText,
			})
		}

		cursor = tokenEnd
	}

	const trailing = source.slice(cursor)
	if (trailing.trim()) {
		segments.push({
			type: 'text',
			content: trailing,
		})
	}

	return normalizeFollowupSegments(segments)
}

function extractAssistantSegmentsFromReply(reply: {
	content?: string | null
	preview?: {
		timeline?: unknown[]
	}
}): FollowupMessageSegment[] {
	const timeline = Array.isArray(reply.preview?.timeline)
		? reply.preview.timeline
		: []
	const timelineSegments: FollowupMessageSegment[] = []

	for (const item of timeline) {
		if (!item || typeof item !== 'object') continue
		const record = item as Record<string, unknown>
		const type = String(record.type || '')
			.trim()
			.toLowerCase()

		if (type === 'text') {
			const content = asString(record.content)
			if (!content) continue
			timelineSegments.push({
				type: 'text',
				content,
			})
			continue
		}

		if (type === 'image') {
			const url = asString(record.url)
			if (!url) continue
			timelineSegments.push({
				type: 'image',
				url,
			})
		}
	}

	if (timelineSegments.length > 0) {
		const expanded = timelineSegments.flatMap((segment) => {
			if (segment.type === 'text') {
				return splitTextIntoFollowupSegments(segment.content)
			}
			return [segment]
		})
		const normalized = normalizeFollowupSegments(expanded)
		if (normalized.length > 0) return normalized
	}

	const fallbackContent = asString(reply.content)
	if (!fallbackContent) return []
	return splitTextIntoFollowupSegments(fallbackContent)
}

function extractAssistantTextFromReply(reply: {
	content?: string | null
	preview?: {
		timeline?: unknown[]
	}
}): string | null {
	const segments = extractAssistantSegmentsFromReply(reply)
	const textBlocks = segments
		.filter(
			(segment): segment is { type: 'text'; content: string } =>
				segment.type === 'text',
		)
		.map((segment) => segment.content)
	if (textBlocks.length > 0) {
		return textBlocks.join('\n\n').trim()
	}
	return asString(reply.content)
}

function toTextOnlyFollowupContent(value: string): string {
	const textBlocks = splitTextIntoFollowupSegments(value)
		.filter(
			(segment): segment is { type: 'text'; content: string } =>
				segment.type === 'text',
		)
		.map((segment) => segment.content)
		.filter((segment) => segment.trim().length > 0)
	return textBlocks.join('\n\n').trim()
}

function sanitizeFollowupSegmentsForDelivery(
	segments: FollowupMessageSegment[],
): FollowupMessageSegment[] {
	const normalized = normalizeFollowupSegments(segments)
	if (ENABLE_FOLLOWUP_IMAGE_SEGMENTS) return normalized
	return normalizeFollowupSegments(
		normalized.filter(
			(segment): segment is { type: 'text'; content: string } =>
				segment.type === 'text',
		),
	)
}

function isInstructionalFollowupPrompt(prompt: string): boolean {
	const normalized = String(prompt || '').toLowerCase()
	if (!normalized.trim()) return false

	if (
		/\b(jika|if)\b[\s\S]{0,220}\b(maka|then)\b[\s\S]{0,220}\bfollow-?up\b/i.test(
			normalized,
		)
	) {
		return true
	}

	if (/\b(kirimkan|kirim|send)\b[\s\S]{0,80}\bfollow-?up\b/i.test(normalized)) {
		return true
	}

	const conditionalMarkers = (normalized.match(/\b(jika|if)\b/g) || []).length
	const braceMarkers = (normalized.match(/[{}]/g) || []).length
	if (conditionalMarkers >= 2 && braceMarkers >= 2) {
		return true
	}

	return false
}

function sanitizeInstructionalTextForDelivery(value: string): string {
	const source = String(value || '')
	if (!source.trim()) return ''

	const filteredLines = source
		.split('\n')
		.map((line) => line.trim())
		.map((line) =>
			line
				.replace(/^[{[]+\s*/, '')
				.replace(/\s*[}\]]+$/, '')
				.trim(),
		)
		.filter((line) => line.length > 0)
		.filter((line) => !/^rule\s*:/i.test(line))
		.filter((line) => !/^inactivity window\s*:/i.test(line))
		.filter((line) => !/^write one concise follow-up/i.test(line))
		.filter((line) => !/^(you are generating|follow-up generation)/i.test(line))
		.filter((line) => !/^\{+$|^\}+$/i.test(line))
		.filter((line) => !/^\{?\s*(jika|if)\b/i.test(line))
		.filter((line) => !/\b(maka|then)\b[\s\S]{0,120}\bfollow-?up\b/i.test(line))
		.filter(
			(line) => !/\b(kirimkan|send)\b[\s\S]{0,80}\bfollow-?up\b/i.test(line),
		)

	return filteredLines.join('\n').trim()
}

type InstructionalFollowupVariant = {
	condition: string
	message: string
}

function parseInstructionalFollowupVariants(
	prompt: string,
): InstructionalFollowupVariant[] {
	const source = String(prompt || '')
	if (!source.trim()) return []

	const variants: InstructionalFollowupVariant[] = []
	const pattern = /([^\n:{}]{4,240}?)\s*:\s*\{([\s\S]*?)\}/g
	let match: RegExpExecArray | null = null
	while ((match = pattern.exec(source)) !== null) {
		const condition = String(match[1] || '')
			.replace(/\s+/g, ' ')
			.trim()
		const message = sanitizeInstructionalTextForDelivery(String(match[2] || ''))
		if (!condition || !message) continue
		variants.push({ condition, message })
	}
	return variants
}

function normalizeConversationCueText(value: string): string {
	return String(value || '')
		.toLowerCase()
		.replace(/\s+/g, ' ')
		.trim()
}

function isLikelyLeadAdOpener(value: string): boolean {
	const normalized = normalizeConversationCueText(value)
	if (!normalized) return false

	if (/^(halo|hai|hi|hello)\s*(kak|sozo)?[.!?, ]*$/.test(normalized)) {
		return true
	}

	return /\bhalo\b[\s\S]{0,40}\bsozo\b[\s\S]{0,80}\btertarik promo\b/i.test(
		normalized,
	)
}

function isAssistantAskingLocation(value: string): boolean {
	const normalized = normalizeConversationCueText(value)
	if (!normalized) return false

	return /(domisili|berdomisili|lokasi|cabang|alamat|terdekat|terjangkau|area|daerah|kota|kabupaten|kecamatan)/i.test(
		normalized,
	)
}

function resolveContextKeywordHints(
	history: FollowupHistoryMessage[],
	conversationTreatment: string | null,
): string[] {
	const userMessages = history
		.filter((item) => item.role === 'user')
		.map((item) => item.content)
	const nonLeadUserMessages = userMessages.filter(
		(item) => !isLikelyLeadAdOpener(item),
	)
	const latestUserMessage = nonLeadUserMessages[nonLeadUserMessages.length - 1] || ''
	const latestUserNormalized = normalizeConversationCueText(latestUserMessage)
	const latestAssistantMessage =
		[...history].reverse().find((item) => item.role === 'assistant')?.content || ''
	const userSource = nonLeadUserMessages.slice(-3).join(' ').toLowerCase()
	const hints: string[] = []

	const pushHint = (value: string) => {
		if (!hints.includes(value)) hints.push(value)
	}

	if (
		/\b(lokasi|cabang|alamat|terdekat|maps?|kecamatan|kelurahan|kota)\b/i.test(
			userSource,
		) ||
		isAssistantAskingLocation(latestAssistantMessage)
	) {
		pushHint('lokasi')
	}
	if (!hints.includes('lokasi') && latestUserNormalized) {
		const tokenCount = latestUserNormalized.split(/\s+/).filter(Boolean).length
		const hasLocationPrefix = /\b(di|domisili|lokasi|area|daerah|kota|kabupaten)\b/i.test(
			latestUserNormalized,
		)
		const looksLikePlaceName =
			tokenCount <= 4 &&
			/^[a-z][a-z .'-]{2,48}$/i.test(latestUserNormalized) &&
			!/\b(harga|promo|jadwal|weekend|weekday|booking|book|treatment|produk|skincare)\b/i.test(
				latestUserNormalized,
			)
		if (hasLocationPrefix || looksLikePlaceName) {
			pushHint('lokasi')
		}
	}
	if (/\b(jadwal|waktu|weekend|weekday|weekdays|jam|pukul|hari)\b/i.test(userSource)) {
		pushHint('jadwal')
	}
	if (/\b(promo|harga|biaya|diskon|voucher|deal|flash sale)\b/i.test(userSource)) {
		pushHint('promo')
	}
	if (/\b(skincare|produk)\b/i.test(userSource)) {
		pushHint('skincare')
	}
	if (/\b(booking|book|reservasi|slot|isi form)\b/i.test(userSource)) {
		pushHint('booking')
	}
	if (/\b(cancel|batal)\b/i.test(userSource)) {
		pushHint('cancel')
	}
	if (/\b(hamil|menyusui)\b/i.test(userSource)) {
		pushHint('sensitive_state')
	}
	if (/\b(walk in|walk-in|langsung datang)\b/i.test(userSource)) {
		pushHint('walkin')
	}
	if (
		/\b(treatment|jerawat|acne|flek|kusam|hair|rambut|slimming|botox|ipl|meso|hifu)\b/i.test(
			userSource,
		)
	) {
		pushHint('treatment')
	}
	if (conversationTreatment && hints.includes('treatment')) {
		pushHint('treatment_named')
	}

	return hints
}

function scoreInstructionalVariantByContext(args: {
	condition: string
	contextHints: string[]
	conversationTreatment: string | null
}): number {
	const condition = String(args.condition || '').toLowerCase()
	if (!condition) return 0
	let score = 0

	if (args.contextHints.includes('lokasi') && /\b(lokasi|cabang|alamat)\b/.test(condition)) {
		score += 6
	}
	if (args.contextHints.includes('jadwal') && /\b(jadwal|waktu|weekend|weekday|jam)\b/.test(condition)) {
		score += 6
	}
	if (args.contextHints.includes('promo') && /\b(promo|harga|mahal|diskon|voucher)\b/.test(condition)) {
		score += 6
	}
	if (args.contextHints.includes('skincare') && /\bskincare|product|produk\b/.test(condition)) {
		score += 5
	}
	if (args.contextHints.includes('booking') && /\bbooking|book|form\b/.test(condition)) {
		score += 5
	}
	if (args.contextHints.includes('cancel') && /\bcancel|batal\b/.test(condition)) {
		score += 5
	}
	if (args.contextHints.includes('sensitive_state') && /\bhamil|menyusui\b/.test(condition)) {
		score += 5
	}
	if (args.contextHints.includes('walkin') && /\bwalk[ -]?in|langsung datang\b/.test(condition)) {
		score += 5
	}
	if (
		args.contextHints.includes('treatment') &&
		/\b(treatment|jerawat|acne|ipl|meso|hifu|hair|slimming|botox)\b/.test(condition)
	) {
		score += 4
	}
	if (args.conversationTreatment && args.contextHints.includes('treatment_named')) {
		const treatmentNeedle = args.conversationTreatment.toLowerCase()
		if (condition.includes(treatmentNeedle)) score += 3
	}

	return score
}

function resolveFollowupPromptForConversationContext(args: {
	rulePrompt: string
	history: FollowupHistoryMessage[]
	conversationTreatment: string | null
}): string {
	const prompt = String(args.rulePrompt || '').trim()
	if (!prompt) return ''

	const variants = parseInstructionalFollowupVariants(prompt)
	if (variants.length === 0) {
		if (!isInstructionalFollowupPrompt(prompt)) return prompt
		return sanitizeInstructionalTextForDelivery(prompt)
	}

	const contextHints = resolveContextKeywordHints(
		args.history,
		args.conversationTreatment,
	)
	const ranked = variants
		.map((variant, index) => ({
			variant,
			index,
			score: scoreInstructionalVariantByContext({
				condition: variant.condition,
				contextHints,
				conversationTreatment: args.conversationTreatment,
			}),
		}))
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score
			return left.index - right.index
		})

	const best = ranked[0]?.variant
	if (!best) return sanitizeInstructionalTextForDelivery(prompt)
	return best.message
}

function sanitizeGeneratedSegmentsForPrompt(params: {
	prompt: string
	segments: FollowupMessageSegment[]
}): FollowupMessageSegment[] {
	if (!isInstructionalFollowupPrompt(params.prompt)) {
		return normalizeFollowupSegments(params.segments)
	}

	const cleaned = params.segments
		.map((segment) => {
			if (segment.type === 'image') return segment
			const text = sanitizeInstructionalTextForDelivery(segment.content)
			if (!text) return null
			return {
				type: 'text',
				content: text,
			} satisfies FollowupMessageSegment
		})
		.filter((segment): segment is FollowupMessageSegment => segment !== null)

	return normalizeFollowupSegments(cleaned)
}

function resolveExactRuleFollowupSegments(params: {
	rulePrompt: string
	scopedPromptSegments: FollowupMessageSegment[]
}): FollowupMessageSegment[] {
	const scoped = normalizeFollowupSegments(params.scopedPromptSegments)
	if (scoped.length > 0) return scoped

	const promptText = isInstructionalFollowupPrompt(params.rulePrompt)
		? sanitizeInstructionalTextForDelivery(params.rulePrompt)
		: toTextOnlyFollowupContent(params.rulePrompt)
	const normalizedText = String(promptText || '').trim()
	if (!normalizedText) return []
	return normalizeFollowupSegments([
		{
			type: 'text',
			content: normalizedText,
		},
	])
}

function shouldFallbackToPromptSegments(params: {
	promptSegments: FollowupMessageSegment[]
	generatedSegments: FollowupMessageSegment[]
}): boolean {
	const promptImageUrls = params.promptSegments
		.filter(
			(segment): segment is { type: 'image'; url: string } =>
				segment.type === 'image',
		)
		.map((segment) => segment.url)
	if (promptImageUrls.length === 0) return false

	const generatedImageUrls = new Set(
		params.generatedSegments
			.filter(
				(segment): segment is { type: 'image'; url: string } =>
					segment.type === 'image',
			)
			.map((segment) => segment.url),
	)
	if (generatedImageUrls.size < promptImageUrls.length) {
		return true
	}

	return promptImageUrls.some((url) => !generatedImageUrls.has(url))
}

function mergeMissingPromptImagesIntoGeneratedSegments(params: {
	promptSegments: FollowupMessageSegment[]
	generatedSegments: FollowupMessageSegment[]
}): FollowupMessageSegment[] {
	const generatedImageUrls = new Set(
		params.generatedSegments
			.filter(
				(segment): segment is { type: 'image'; url: string } =>
					segment.type === 'image',
			)
			.map((segment) => segment.url),
	)

	const missingImages = params.promptSegments.filter(
		(segment): segment is { type: 'image'; url: string } =>
			segment.type === 'image' && !generatedImageUrls.has(segment.url),
	)

	if (missingImages.length === 0) {
		return normalizeFollowupSegments(params.generatedSegments)
	}

	return normalizeFollowupSegments([
		...params.generatedSegments,
		...missingImages,
	])
}

function preservePromptImagesInSegments(params: {
	promptSegments: FollowupMessageSegment[]
	followupSegments: FollowupMessageSegment[]
}): {
	segments: FollowupMessageSegment[]
	appendedCount: number
} {
	const normalizedFollowup = normalizeFollowupSegments(params.followupSegments)
	const promptImages = normalizeFollowupSegments(params.promptSegments).filter(
		(segment): segment is { type: 'image'; url: string } =>
			segment.type === 'image',
	)
	if (promptImages.length === 0) {
		return {
			segments: normalizedFollowup,
			appendedCount: 0,
		}
	}

	const followupImageUrls = new Set(
		normalizedFollowup
			.filter(
				(segment): segment is { type: 'image'; url: string } =>
					segment.type === 'image',
			)
			.map((segment) => segment.url),
	)
	const missingImages = promptImages.filter(
		(segment) => !followupImageUrls.has(segment.url),
	)
	if (missingImages.length === 0) {
		return {
			segments: normalizedFollowup,
			appendedCount: 0,
		}
	}

	return {
		segments: normalizeFollowupSegments([
			...normalizedFollowup,
			...missingImages,
		]),
		appendedCount: missingImages.length,
	}
}

function enforcePromptImagePolicy(params: {
	promptSegments: FollowupMessageSegment[]
	generatedSegments: FollowupMessageSegment[]
}): FollowupMessageSegment[] {
	const promptHasImage = params.promptSegments.some(
		(segment) => segment.type === 'image',
	)
	if (promptHasImage) {
		return normalizeFollowupSegments(params.generatedSegments)
	}

	// Follow-up rules without explicit image URL should stay text-only to avoid
	// unrelated promo image injection from downstream generation logic.
	return normalizeFollowupSegments(
		params.generatedSegments.filter(
			(segment): segment is { type: 'text'; content: string } =>
				segment.type === 'text',
		),
	)
}

async function sendFollowupSegments(params: {
	conversationId: string
	segments: FollowupMessageSegment[]
	baseAttributes: Record<string, unknown>
}) {
	let sentCount = 0
	let lastMessageId: string | null = null
	const messageIds: string[] = []
	const timelineBaseTime = Date.now()
	let timelineOffsetMs = 0
	const nextTimelineCreatedAt = () =>
		new Date(timelineBaseTime + timelineOffsetMs++)

	for (let index = 0; index < params.segments.length; index += 1) {
		const segment = params.segments[index]
		let message: { id: string } | null = null
		if (segment.type === 'image') {
			message = await MessageService.sendMessage({
				conversationId: params.conversationId,
				senderType: 'bot',
				content: segment.url,
				contentType: 'image',
				createdAt: nextTimelineCreatedAt(),
				contentAttributes: {
					type: 'image',
					...params.baseAttributes,
					media_type: 'image',
					media_url: segment.url,
					media: {
						type: 'image',
						url: segment.url,
					},
				},
			})
		} else {
			message = await MessageService.sendMessage({
				conversationId: params.conversationId,
				senderType: 'bot',
				content: segment.content,
				contentType: 'text',
				createdAt: nextTimelineCreatedAt(),
				contentAttributes: {
					type: 'text',
					...params.baseAttributes,
				},
			})
		}

		if (message?.id) {
			sentCount += 1
			lastMessageId = message.id
			messageIds.push(message.id)
		}

		const isLastSegment = index >= params.segments.length - 1
		if (!isLastSegment) {
			await sleep(resolveRandomAiBubbleDelayMs())
		}
	}

	return {
		sentCount,
		lastMessageId,
		messageIds,
	}
}

function isIsoDateString(value: string | null): value is string {
	if (!value) return false
	return /^\d{4}-\d{2}-\d{2}T/.test(value)
}

async function getConversationAdditionalAttributes(conversationId: string) {
	const conversation = await prisma.conversations.findUnique({
		where: { id: conversationId },
		select: { additional_attributes: true },
	})
	return asRecord(conversation?.additional_attributes)
}

async function writeConversationAdditionalAttributes(
	conversationId: string,
	attributes: Record<string, unknown>,
) {
	await prisma.conversations.update({
		where: { id: conversationId },
		data: {
			additional_attributes: attributes as any,
			updated_at: new Date(),
		},
	})
}

async function clearFollowupState(conversationId: string) {
	const attrs = await getConversationAdditionalAttributes(conversationId)
	if (
		!Object.prototype.hasOwnProperty.call(attrs, CHATBOT_FOLLOWUP_STATE_KEY)
	) {
		return
	}
	const nextAttrs = { ...attrs }
	delete nextAttrs[CHATBOT_FOLLOWUP_STATE_KEY]
	await writeConversationAdditionalAttributes(conversationId, nextAttrs)
}

async function claimFollowupDispatch(params: {
	conversationId: string
	nextDueAt: string
}) {
	const claimToken = crypto.randomUUID()
	const claimedAt = new Date().toISOString()
	const staleBefore = new Date(
		Date.now() - FOLLOWUP_PROCESSING_STALE_MS,
	).toISOString()

		const rows = await prisma.$queryRaw<Array<{ id: string }>>`
			UPDATE conversations
			SET additional_attributes = jsonb_set(
				COALESCE(additional_attributes, '{}'::jsonb),
				ARRAY[${CHATBOT_FOLLOWUP_STATE_KEY}]::text[],
				COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}, '{}'::jsonb) || jsonb_build_object(
					'processing_token', ${claimToken}::text,
					'processing_started_at', ${claimedAt}::timestamptz,
					'updated_at', ${claimedAt}::timestamptz
				),
				true
			),
			updated_at = NOW()
		WHERE id = ${params.conversationId}
			AND deleted_at IS NULL
			AND additional_attributes ? ${CHATBOT_FOLLOWUP_STATE_KEY}
			AND COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'next_due_at', '') = ${params.nextDueAt}
				AND (
					COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'processing_token', '') = ''
					OR CASE
						WHEN pg_input_is_valid(
							COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'processing_started_at', ''),
							'timestamp with time zone'
						)
						THEN (additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'processing_started_at')::timestamptz <= ${staleBefore}::timestamptz
						ELSE true
					END
				)
		RETURNING id
	`

	if (rows.length === 0) return null
	return {
		token: claimToken,
		claimedAt,
	}
}

async function releaseFollowupDispatchClaim(params: {
	conversationId: string
	claimToken: string
}) {
	const releasedAt = new Date().toISOString()

		await prisma.$queryRaw`
			UPDATE conversations
			SET additional_attributes = jsonb_set(
				COALESCE(additional_attributes, '{}'::jsonb),
				ARRAY[${CHATBOT_FOLLOWUP_STATE_KEY}]::text[],
				(COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}, '{}'::jsonb) - 'processing_token' - 'processing_started_at') || jsonb_build_object(
					'updated_at', ${releasedAt}::timestamptz
				),
				true
			),
		updated_at = NOW()
		WHERE id = ${params.conversationId}
			AND deleted_at IS NULL
			AND additional_attributes ? ${CHATBOT_FOLLOWUP_STATE_KEY}
			AND COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'processing_token', '') = ${params.claimToken}
	`
}

async function findExistingDeliveredFollowupForRule(params: {
	conversationId: string
	ruleId: string
	anchorAt: string
}) {
	const rows = await prisma.$queryRaw<Array<{ id: string }>>`
		SELECT id
		FROM messages
		WHERE conversation_id = ${params.conversationId}
			AND deleted_at IS NULL
			AND COALESCE(is_deleted, false) = false
			AND sender_type = 'bot'
			AND COALESCE(content_attributes->>'source', '') = 'chatbot_followup'
			AND COALESCE(content_attributes->>'ai_followup_rule_id', '') = ${params.ruleId}
			AND created_at >= ${params.anchorAt}::timestamptz
		ORDER BY created_at DESC
		LIMIT 1
	`

	return rows[0]?.id || null
}

function buildNextFollowupState(params: {
	chatbotId: string
	ruleIndex: number
	rules: ChatbotFollowupRule[]
	baseTime: Date
}): ChatbotFollowupState | null {
	const nextRuleIndex = params.ruleIndex + 1
	if (nextRuleIndex >= params.rules.length) return null

	const baseTimeIso = params.baseTime.toISOString()
	return {
		chatbot_id: params.chatbotId,
		next_rule_index: nextRuleIndex,
		next_due_at: addMinutes(
			params.baseTime,
			params.rules[nextRuleIndex].timeIntervalMinutes,
		).toISOString(),
		anchor_at: baseTimeIso,
		last_sent_at: baseTimeIso,
		updated_at: baseTimeIso,
	}
}

function buildFollowupDispatchJobId(conversationId: string, nextDueAt: string) {
	const normalizedDueAt = nextDueAt.replace(/[:.]/g, '-')
	return `${FOLLOWUP_DISPATCH_JOB}:${conversationId}:${normalizedDueAt}`
}

async function queueFollowupDispatch(args: {
	conversationId: string
	nextDueAt: string | null
}) {
	if (!isUuid(args.conversationId) || !isIsoDateString(args.nextDueAt)) return

	const nextDueAtMs = new Date(args.nextDueAt).getTime()
	if (Number.isNaN(nextDueAtMs)) return

	const delayMs = Math.max(
		0,
		nextDueAtMs - Date.now() + FOLLOWUP_DISPATCH_DELAY_BUFFER_MS,
	)

	try {
		await maintenanceQueue.add(
			FOLLOWUP_DISPATCH_JOB,
			{
				conversationId: args.conversationId,
				nextDueAt: args.nextDueAt,
				source: 'chatbot_followup_schedule',
			},
			{
				jobId: buildFollowupDispatchJobId(args.conversationId, args.nextDueAt),
				delay: delayMs,
				removeOnComplete: 500,
				removeOnFail: 500,
			},
		)
	} catch (error) {
		console.error(
			`[ChatbotFollowupService] Failed queueing delayed follow-up dispatch: conversation=${args.conversationId} next_due_at=${args.nextDueAt}`,
			error,
		)
	}
}

async function getBotHistory(
	conversationId: string,
): Promise<FollowupHistoryMessage[]> {
	const rows = await prisma.messages.findMany({
		where: {
			conversation_id: conversationId,
			deleted_at: null,
			OR: [{ is_deleted: false }, { is_deleted: null }],
			sender_type: { in: ['contact', 'bot'] },
		},
		orderBy: { created_at: 'desc' },
		take: MAX_HISTORY_MESSAGES,
		select: {
			sender_type: true,
			content: true,
		},
	})

	return rows
		.reverse()
		.map((item) => {
			const content = asString(item.content)
			if (!content) return null
			return {
				role: item.sender_type === 'contact' ? 'user' : 'assistant',
				content,
			} satisfies FollowupHistoryMessage
		})
		.filter((item): item is FollowupHistoryMessage => Boolean(item))
}

async function resolveFallbackHandoffAgent(params: {
	appId: string
	conversationAssigneeId: string | null
	inboxChannelConfig: Record<string, unknown>
}) {
	const currentAssigneeId = asString(params.conversationAssigneeId)
	if (currentAssigneeId && isUuid(currentAssigneeId)) {
		return currentAssigneeId
	}

	const defaultAgentIds = asStringArray(
		params.inboxChannelConfig.default_agent_ids,
	).filter((agentId) => isUuid(agentId))
	if (defaultAgentIds.length > 0) {
		return defaultAgentIds[0]
	}

	const fallbackAgent = await prisma.users.findFirst({
		where: {
			app_id: params.appId,
			active: true,
			deleted_at: null,
			role: { in: CHAT_ASSIGNABLE_ROLES },
		},
		orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
		select: { id: true },
	})
	return fallbackAgent?.id || null
}

export abstract class ChatbotFollowupService {
	static async scheduleFromAiReply(params: {
		conversationId: string
		appId: string
		chatbotId: string
		chatbotSnapshot?: ChatbotSnapshotForFollowup | null
	}) {
		if (!isUuid(params.conversationId)) return
		if (!isUuid(params.chatbotId)) return

		let chatbot = params.chatbotSnapshot || null
		if (!chatbot) {
			const fetched = await ChatbotService.getChatbotById(
				params.chatbotId,
				params.appId,
			)
			if (!fetched) {
				await clearFollowupState(params.conversationId)
				return
			}
			chatbot = {
				id: fetched.id,
				app_id: fetched.app_id || params.appId,
				name: fetched.name,
				watcher_enabled: fetched.watcher_enabled,
				plugin_data: fetched.plugin_data,
				ai_followups: fetched.ai_followups,
			}
		}

		const rules = normalizeFollowupRules(chatbot.ai_followups)
		const pluginFlags = resolvePluginDataChatbotFlags(chatbot.plugin_data)
		const watcherEnabled =
			asBoolean(chatbot.watcher_enabled, false) || pluginFlags.watcherEnabled

		if (!watcherEnabled || rules.length === 0) {
			await clearFollowupState(params.conversationId)
			return
		}

		const now = new Date()
		const nextDueAt = addMinutes(now, rules[0].timeIntervalMinutes)
		const state: ChatbotFollowupState = {
			chatbot_id: chatbot.id,
			next_rule_index: 0,
			next_due_at: nextDueAt.toISOString(),
			anchor_at: now.toISOString(),
			last_sent_at: null,
			updated_at: now.toISOString(),
		}

		const attrs = await getConversationAdditionalAttributes(
			params.conversationId,
		)
		const nextAttrs = {
			...attrs,
			[CHATBOT_FOLLOWUP_STATE_KEY]: state,
		}
		await writeConversationAdditionalAttributes(
			params.conversationId,
			nextAttrs,
		)
		await queueFollowupDispatch({
			conversationId: params.conversationId,
			nextDueAt: state.next_due_at,
		})
	}

	static async clearOnInboundContactMessage(conversationId: string) {
		if (!isUuid(conversationId)) return
		await clearFollowupState(conversationId)
	}

	static async dispatchDueFollowupsBatch(limit = 100) {
		const safeLimit = Math.max(1, Math.min(limit, 500))
		const dueRows = await prisma.$queryRaw<Array<{ id: string }>>`
			SELECT id
			FROM conversations
			WHERE deleted_at IS NULL
				AND COALESCE(status, 'open') <> 'resolved'
				AND additional_attributes ? ${CHATBOT_FOLLOWUP_STATE_KEY}
				AND (additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'next_due_at') IS NOT NULL
				AND pg_input_is_valid(
					COALESCE(additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'next_due_at', ''),
					'timestamp with time zone'
				)
				AND ((additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'next_due_at')::timestamptz <= NOW())
			ORDER BY (additional_attributes->${CHATBOT_FOLLOWUP_STATE_KEY}->>'next_due_at')::timestamptz ASC
			LIMIT ${safeLimit}
		`

		let processed = 0
		for (const row of dueRows) {
			if (!isUuid(row.id)) continue
			const sent = await this.processDueConversation(row.id).catch((error) => {
				console.error(
					`[ChatbotFollowupService] Failed processing conversation ${row.id}:`,
					error,
				)
				return false
			})
			if (sent) processed += 1
		}
		return {
			queued: dueRows.length,
			processed,
		}
	}

	static async processDueConversation(
		conversationId: string,
	): Promise<boolean> {
		const conversation = await prisma.conversations.findUnique({
			where: { id: conversationId },
			select: {
				id: true,
				app_id: true,
				inbox_id: true,
				assignee_id: true,
				status: true,
				additional_attributes: true,
				inboxes: {
					select: {
						chatbot_id: true,
						channel_config: true,
					},
				},
				contacts: {
					select: {
						meta: true,
						metadata: true,
					},
				},
			},
		})
		if (!conversation?.id || !conversation.app_id) return false
		if (String(conversation.status || '').toLowerCase() === 'resolved') {
			await clearFollowupState(conversationId)
			return false
		}

		const attrs = asRecord(conversation.additional_attributes)
		const state = parseFollowupState(attrs[CHATBOT_FOLLOWUP_STATE_KEY])
		if (!state || !isIsoDateString(state.next_due_at)) {
			await clearFollowupState(conversationId)
			return false
		}

		const now = new Date()
		const nextDue = new Date(state.next_due_at)
		if (Number.isNaN(nextDue.getTime()) || nextDue.getTime() > now.getTime()) {
			return false
		}

		const latestContactMessage = await prisma.messages.findFirst({
			where: {
				conversation_id: conversationId,
				sender_type: 'contact',
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
			},
			orderBy: { created_at: 'desc' },
			select: { created_at: true },
		})
		const anchorAt = new Date(state.anchor_at)
		if (Number.isNaN(anchorAt.getTime())) {
			await clearFollowupState(conversationId)
			return false
		}
		if (
			latestContactMessage?.created_at &&
			latestContactMessage.created_at.getTime() > anchorAt.getTime()
		) {
			await clearFollowupState(conversationId)
			return false
		}

		const chatbotIdFromState = asString(state.chatbot_id)
		const chatbotIdFromInbox = asString(conversation.inboxes?.chatbot_id)
		const chatbotId =
			(chatbotIdFromState && isUuid(chatbotIdFromState)
				? chatbotIdFromState
				: null) ||
			(chatbotIdFromInbox && isUuid(chatbotIdFromInbox)
				? chatbotIdFromInbox
				: null)
		if (!chatbotId) {
			await clearFollowupState(conversationId)
			return false
		}

		const chatbot = await ChatbotService.getChatbotById(
			chatbotId,
			conversation.app_id,
		)
		if (!chatbot) {
			await clearFollowupState(conversationId)
			return false
		}

		const pluginFlags = resolvePluginDataChatbotFlags(chatbot.plugin_data)
		const watcherEnabled =
			asBoolean(chatbot.watcher_enabled, false) || pluginFlags.watcherEnabled
		if (!watcherEnabled) {
			await clearFollowupState(conversationId)
			return false
		}

		const rules = normalizeFollowupRules(chatbot.ai_followups)
		if (rules.length === 0) {
			await clearFollowupState(conversationId)
			return false
		}

		const ruleIndex = Math.max(0, state.next_rule_index)
		const activeRule = rules[ruleIndex]
		if (!activeRule) {
			await clearFollowupState(conversationId)
			return false
		}
		const processingClaim = await claimFollowupDispatch({
			conversationId,
			nextDueAt: state.next_due_at,
		})
		if (!processingClaim) return false

		try {
			const existingFollowupMessageId = await findExistingDeliveredFollowupForRule({
				conversationId,
				ruleId: activeRule.id,
				anchorAt: state.anchor_at,
			})
			if (existingFollowupMessageId) {
				console.warn(
					`[ChatbotFollowupService] Skipping duplicate follow-up send: conversation=${conversationId} rule=${activeRule.id} existing_message=${existingFollowupMessageId}`,
				)
				const nextState = buildNextFollowupState({
					chatbotId: chatbot.id,
					ruleIndex,
					rules,
					baseTime: now,
				})
				if (!nextState) {
					await clearFollowupState(conversationId)
					return false
				}
				await writeConversationAdditionalAttributes(conversationId, {
					...attrs,
					[CHATBOT_FOLLOWUP_STATE_KEY]: nextState,
				})
				await queueFollowupDispatch({
					conversationId,
					nextDueAt: nextState.next_due_at,
				})
				return false
			}

			const history = await getBotHistory(conversationId)
			const conversationTreatment = inferRecentConversationTreatment(history)
			const effectiveRulePrompt = resolveFollowupPromptForConversationContext({
				rulePrompt: activeRule.prompt,
				history,
				conversationTreatment,
			})
			const promptSegments = splitTextIntoFollowupSegments(effectiveRulePrompt)
			const scopedPromptSegments = alignSegmentsToTreatmentContext({
				segments: promptSegments,
				contextTreatment: conversationTreatment,
			})
			const exactRuleSegments = resolveExactRuleFollowupSegments({
				rulePrompt: effectiveRulePrompt,
				scopedPromptSegments: scopedPromptSegments.segments,
			})
			let followupSegments = exactRuleSegments
			let generatedMeta: Record<string, unknown> | null = null
			if (
				conversationTreatment &&
				scopedPromptSegments.hadTreatmentSignals &&
				scopedPromptSegments.droppedCount > 0
			) {
				console.warn(
					`[ChatbotFollowupService] Dropped ${scopedPromptSegments.droppedCount} treatment-mismatched prompt segment(s). conversation=${conversationId} rule=${activeRule.id} context_treatment=${conversationTreatment}`,
				)
			}
			if (!activeRule.options.sendExact) {
				try {
					const generated = await ChatbotService.generateAgentReply(
						chatbot.id,
						conversation.app_id,
						{
							message: [
								'You are generating a follow-up message for an inactive conversation.',
								`Rule: ${effectiveRulePrompt}`,
								`Inactivity window: ${activeRule.timeIntervalMinutes} minutes.`,
								'Write one concise follow-up in the user language, friendly and actionable.',
								'Always obey AI Agent Behavior and Agent Transfer Conditions configured for this chatbot.',
								'If the rule includes image/media URLs, keep every URL exactly the same and keep the original order.',
								'The rule can contain internal instructions. NEVER expose those instructions verbatim.',
								'Do not output text like "Jika ... maka kirimkan followup", "Rule:", "{", or "}".',
							].join('\n'),
							history,
							// Follow-up generation must not trigger external tools (for example location tool),
							// because the prompt text is synthetic and can be misread as user intent.
							runTools: false,
							// Force strict follow-up mode so deterministic location overrides stay disabled.
							strictFollowup: true,
							mode: 'live',
							entrypoint: 'followup',
							conversationId,
						},
					)
					generatedMeta =
						generated.meta && typeof generated.meta === 'object'
							? (generated.meta as Record<string, unknown>)
							: null
					const generatedSegmentsRaw = sanitizeGeneratedSegmentsForPrompt({
						prompt: effectiveRulePrompt,
						segments: extractAssistantSegmentsFromReply(generated),
					})
					const generatedSegments = enforcePromptImagePolicy({
						promptSegments: scopedPromptSegments.segments,
						generatedSegments: generatedSegmentsRaw,
					})
					const scopedGeneratedSegments = alignSegmentsToTreatmentContext({
						segments: generatedSegments,
						contextTreatment: conversationTreatment,
					})
					if (
						conversationTreatment &&
						scopedGeneratedSegments.hadTreatmentSignals &&
						scopedGeneratedSegments.droppedCount > 0
					) {
						console.warn(
							`[ChatbotFollowupService] Dropped ${scopedGeneratedSegments.droppedCount} treatment-mismatched generated segment(s). conversation=${conversationId} rule=${activeRule.id} context_treatment=${conversationTreatment}`,
						)
					}
					const generatedSegmentsContextSafe = scopedGeneratedSegments.segments
					if (
						conversationTreatment &&
						scopedGeneratedSegments.hadTreatmentSignals &&
						generatedSegmentsContextSafe.length === 0
					) {
						followupSegments = exactRuleSegments
					}
					if (
						generatedSegmentsContextSafe.length > 0 &&
						shouldRejectGeneratedFollowupSegments(generatedSegmentsContextSafe)
					) {
						console.warn(
							`[ChatbotFollowupService] Rejected generated follow-up due to prompt leakage signals. conversation=${conversationId} rule=${activeRule.id}`,
						)
						followupSegments = exactRuleSegments
					} else if (generatedSegmentsContextSafe.length > 0) {
						followupSegments = mergeMissingPromptImagesIntoGeneratedSegments({
							promptSegments: scopedPromptSegments.segments,
							generatedSegments: generatedSegmentsContextSafe,
						})
					} else {
						followupSegments = exactRuleSegments
					}
				} catch (error) {
					console.error(
						'[ChatbotFollowupService] AI follow-up generation failed, using exact AI rule content:',
						error,
					)
					followupSegments = exactRuleSegments
				}
			}

			const preservedPromptImages = preservePromptImagesInSegments({
				promptSegments: scopedPromptSegments.segments,
				followupSegments,
			})
			followupSegments = sanitizeFollowupSegmentsForDelivery(
				preservedPromptImages.segments,
			)
			if (
				ENABLE_FOLLOWUP_IMAGE_SEGMENTS &&
				preservedPromptImages.appendedCount > 0
			) {
				console.warn(
					`[ChatbotFollowupService] Restored ${preservedPromptImages.appendedCount} missing follow-up image segment(s). conversation=${conversationId} rule=${activeRule.id}`,
				)
			}

			if (followupSegments.length === 0) {
				console.warn(
					`[ChatbotFollowupService] Skipping follow-up: no valid segments from AI agent rule. conversation=${conversationId} rule=${activeRule.id}`,
				)
				await clearFollowupState(conversationId)
				return false
			}

			const telemetryFromGenerated = generatedMeta || {}
			let aiResponseLogId =
				typeof telemetryFromGenerated.ai_response_log_id === 'string'
					? telemetryFromGenerated.ai_response_log_id
					: null
			let aiTokensPrompt = Number(telemetryFromGenerated.ai_tokens_prompt || 0)
			let aiTokensCompletion = Number(
				telemetryFromGenerated.ai_tokens_completion || 0,
			)
			let aiTokensTotal = Number(telemetryFromGenerated.ai_tokens_total || 0)
			let aiCostCredits = Number(telemetryFromGenerated.ai_cost_credits || 0)
			let aiCostUsd = Number(telemetryFromGenerated.ai_cost_usd || 0)
			let aiCostIdr = Number(telemetryFromGenerated.ai_cost_idr || 0)
			let aiKnowledgeReferences = Array.isArray(
				telemetryFromGenerated.ai_knowledge_references,
			)
				? telemetryFromGenerated.ai_knowledge_references
				: []
			let aiRtkSummary =
				telemetryFromGenerated.ai_rtk_summary &&
				typeof telemetryFromGenerated.ai_rtk_summary === 'object'
					? telemetryFromGenerated.ai_rtk_summary
					: {
							before_count: 0,
							after_count: 0,
							before_chars: 0,
							after_chars: 0,
							deduped_count: 0,
							dropped_count: 0,
							dropped_items: [],
						}
			let knowledgeSnapshotAt =
				typeof telemetryFromGenerated.knowledge_snapshot_at === 'string'
					? telemetryFromGenerated.knowledge_snapshot_at
					: new Date().toISOString()
			const ragIntent =
				typeof telemetryFromGenerated.rag_intent === 'string'
					? asString(telemetryFromGenerated.rag_intent)
					: null
			const flowRuntimeState = asRecord(asRecord(attrs).flow_runtime)
			const flowRuntimeVariables = asRecord(flowRuntimeState.variables)
			const workflowId = asString(flowRuntimeState.flow_id)
			const workflowRecord =
				workflowId && isUuid(workflowId)
					? await prisma.automation_flows.findFirst({
							where: {
								id: workflowId,
								app_id: conversation.app_id,
							},
							select: {
								id: true,
								name: true,
							},
						})
					: null
			const contactIntent =
				asString(asRecord(conversation.contacts?.metadata).intent) ||
				asString(asRecord(conversation.contacts?.meta).intent)
			const aiAnalytics = buildAiAnalytics({
				confidence: flowRuntimeVariables.last_ai_confidence,
				intent: ragIntent || contactIntent,
				workflowId,
				workflowName: asString(workflowRecord?.name),
				ragIntent,
				knowledgeReferences: aiKnowledgeReferences,
				updatedAt: new Date(),
			})

			if (!aiResponseLogId) {
				const synthesizedContent = textFromSegments(followupSegments)
				const syntheticCompletion = Math.max(
					0,
					Math.ceil(String(synthesizedContent || '').trim().length / 4),
				)
				const syntheticTotal = syntheticCompletion
				const syntheticLog = await AIResponseLogService.create({
					appId: conversation.app_id,
					chatbotId: chatbot.id,
					conversationId,
					entrypoint: 'followup',
					provider: null,
					modelName: null,
					promptTokens: 0,
					completionTokens: syntheticCompletion,
					totalTokens: syntheticTotal,
					usageCredits: syntheticTotal,
					usageUsd: syntheticTotal,
					usageIdr: syntheticTotal,
					billedCredits: 0,
					knowledgeReferences: [],
					rtkSummary: aiRtkSummary as Record<string, unknown>,
					messageIds: [],
					knowledgeSnapshotAt,
					status: 'synthetic',
				})
				aiResponseLogId = syntheticLog.logId
				aiTokensPrompt = 0
				aiTokensCompletion = syntheticCompletion
				aiTokensTotal = syntheticTotal
				aiCostCredits = syntheticTotal
				aiCostUsd = syntheticTotal
				aiCostIdr = syntheticTotal
				aiKnowledgeReferences = []
				knowledgeSnapshotAt = new Date().toISOString()
			}

			const sendResult = await sendFollowupSegments({
				conversationId,
				segments: followupSegments,
				baseAttributes: {
					source: 'chatbot_followup',
					ai_generated: true,
					ai_followup: true,
					ai_followup_rule_id: activeRule.id,
					ai_followup_rule_index: ruleIndex,
					ai_agent_id: chatbot.id,
					ai_agent_name: chatbot.name,
					...(ragIntent ? { rag_intent: ragIntent } : {}),
					...(aiAnalytics ? { ai_analytics: aiAnalytics } : {}),
					ai_response_log_id: aiResponseLogId,
					ai_tokens_prompt: aiTokensPrompt,
					ai_tokens_completion: aiTokensCompletion,
					ai_tokens_total: aiTokensTotal,
					ai_cost_credits: aiCostCredits,
					ai_cost_usd: aiCostUsd,
					ai_cost_idr: aiCostIdr,
					ai_knowledge_references: aiKnowledgeReferences,
					ai_rtk_summary: aiRtkSummary,
					knowledge_snapshot_at: knowledgeSnapshotAt,
				},
			})
			void AIResponseLogService.attachMessageIds({
				logId: aiResponseLogId,
				messageIds: sendResult.messageIds,
				status: sendResult.sentCount > 0 ? 'delivered' : 'generated',
			}).catch((error) => {
				console.error(
					'[ChatbotFollowupService] Failed attaching AI response log linkage (fail-open):',
					error,
				)
			})
			await ConversationService.upsertAiAnalytics(conversationId, aiAnalytics)

			if (activeRule.options.handoff === true) {
				const inboxChannelConfig = asRecord(conversation.inboxes?.channel_config)
				const fallbackAgentId = await resolveFallbackHandoffAgent({
					appId: conversation.app_id,
					conversationAssigneeId: conversation.assignee_id,
					inboxChannelConfig,
				})
				if (fallbackAgentId && isUuid(fallbackAgentId)) {
					await ConversationService.assignAgent(conversationId, fallbackAgentId)
				}
			}

			const nextState = buildNextFollowupState({
				chatbotId: chatbot.id,
				ruleIndex,
				rules,
				baseTime: now,
			})
			if (!nextState) {
				await clearFollowupState(conversationId)
				return sendResult.sentCount > 0
			}

			await writeConversationAdditionalAttributes(conversationId, {
				...attrs,
				[CHATBOT_FOLLOWUP_STATE_KEY]: nextState,
			})
			await queueFollowupDispatch({
				conversationId,
				nextDueAt: nextState.next_due_at,
			})
			return sendResult.sentCount > 0
		} catch (error) {
			await releaseFollowupDispatchClaim({
				conversationId,
				claimToken: processingClaim.token,
			}).catch((releaseError) => {
				console.error(
					'[ChatbotFollowupService] Failed releasing follow-up processing claim (fail-open):',
					releaseError,
				)
			})
			throw error
		}
	}
}

export const __test__ = {
	normalizeFollowupRules,
	parseFollowupState,
	asBoolean,
	extractAssistantTextFromReply,
	splitTextIntoFollowupSegments,
	extractAssistantSegmentsFromReply,
	normalizeFollowupSegments,
	sanitizeFollowupSegmentsForDelivery,
	toTextOnlyFollowupContent,
	isInstructionalFollowupPrompt,
	sanitizeInstructionalTextForDelivery,
	parseInstructionalFollowupVariants,
	isLikelyLeadAdOpener,
	resolveFollowupPromptForConversationContext,
	sanitizeGeneratedSegmentsForPrompt,
	enforcePromptImagePolicy,
	shouldFallbackToPromptSegments,
	mergeMissingPromptImagesIntoGeneratedSegments,
	preservePromptImagesInSegments,
	extractTreatmentMentions,
	inferRecentConversationTreatment,
	alignSegmentsToTreatmentContext,
	textFromSegments,
	hasFollowupPromptLeakage,
	shouldRejectGeneratedFollowupSegments,
}
