import prisma from '../../lib/prisma'
import { getAllowedChannelTypesForUser } from '../../lib/agent-channel-access'
import { setContactOwner } from '../../lib/contact-ownership'
import { isUuid, resolveAppId } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'
import {
	type ConversationAiAnalytics,
	deriveAiAnalyticsFromConversation,
	normalizeAiAnalytics,
} from './ai-analytics'

interface ConversationFilter {
	status?: string
	inboxId?: string
	agentId?: string
	priority?: string
	page?: number
	limit?: number
	viewerUserId?: string | null
	viewerRole?: string
	// Advanced filters
	dateFrom?: string
	dateTo?: string
	labelIds?: string[]
	resolvedBy?: string
	aiAgentId?: string
	pipelineStageId?: string
	channelType?: string
	provider?: string
}

type ContactDetailSignalTone = 'success' | 'warning' | 'info' | 'neutral'

type ContactDetailSignal = {
	value: string
	tone: ContactDetailSignalTone
}

type CommerceJourneySignal =
	| 'add_to_cart'
	| 'checkout'
	| 'waiting_payment'
	| 'purchased'

export type ConversationContactDetail = {
	conversation: {
		id: string
		contact_id: string | null
		inbox_id: string | null
		pipeline_id: string | null
		stage_id: string | null
		status: string | null
		channel_type: string | null
	}
	customer: {
		id: string | null
		name: string | null
		email: string | null
		phone_number: string | null
		avatar_url: string | null
		is_vip: boolean
		repeat_orders: number
		lifetime_value: number
	} | null
	badges: {
		vip: boolean
		repeat_orders: number
		lifetime_value: number
	}
	ai_summary: {
		text: string
		source: 'context' | 'heuristic'
		updated_at: string
	}
	live_signals: {
		sentiment: ContactDetailSignal
		intent: ContactDetailSignal
		buying_stage: ContactDetailSignal
		churn_risk: ContactDetailSignal & {
			percent: number
		}
	}
	open_cart: unknown
	order_history: unknown[]
	tags: unknown[]
	notes: unknown[]
	payment_methods: Array<{ id: string; label: string; provider?: string }>
	backend_notes: string[]
}

const POSITIVE_SENTIMENT_KEYWORDS = [
	'terima kasih',
	'makasih',
	'ok',
	'siap',
	'bagus',
	'suka',
	'deal',
	'lanjut',
	'thanks',
	'great',
	'good',
]

const NEGATIVE_SENTIMENT_KEYWORDS = [
	'kecewa',
	'buruk',
	'jelek',
	'marah',
	'kesal',
	'komplain',
	'complain',
	'lama',
	'lambat',
	'cancel',
	'bad',
	'worst',
]

const PLAYGROUND_CONTACT_IDENTIFIER_PREFIX = 'ai-playground-'

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function normalizeWhatsappProviderFilter(
	value: unknown,
): 'whatsapp_cloud' | 'baileys' | null {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized || normalized === 'all') return null
	if (normalized === 'official') return 'whatsapp_cloud'
	if (normalized === 'baileys') return 'baileys'
	if (normalized === 'whatsapp_cloud') return 'whatsapp_cloud'
	return null
}

function resolveWhatsappProviderFromInbox(
	inbox:
		| {
				channel_type?: string | null
				channel_config?: unknown
				whatsapp_channels?: Array<{ provider?: string | null }>
		  }
		| null
		| undefined,
) {
	if (!inbox) return null
	if (String(inbox.channel_type || '').trim().toLowerCase() !== 'whatsapp') {
		return null
	}

	const providerFromChannel = String(
		inbox.whatsapp_channels?.[0]?.provider || '',
	)
		.trim()
		.toLowerCase()
	if (providerFromChannel) return providerFromChannel

	const channelConfig = asRecord(inbox.channel_config)
	const providerFromConfig = String(channelConfig.provider || '').trim().toLowerCase()
	return providerFromConfig || null
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function toNumber(value: unknown, fallback = 0): number {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
	if (!Number.isFinite(value)) return min
	if (value < min) return min
	if (value > max) return max
	return value
}

function uniqNotes(notes: string[]): string[] {
	return Array.from(new Set(notes.filter((note) => note.trim().length > 0)))
}

function normalizeText(value: string): string {
	return value.trim().toLowerCase()
}

function formatIdr(value: number): string {
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		maximumFractionDigits: 0,
	}).format(Number.isFinite(value) ? value : 0)
}

function appendAiPlaygroundConversationExclusion(where: Record<string, unknown>) {
	const existingNot = Array.isArray(where.NOT)
		? [...where.NOT]
		: where.NOT
			? [where.NOT]
			: []
	existingNot.push({
		contacts: {
			is: {
				identifier: {
					startsWith: PLAYGROUND_CONTACT_IDENTIFIER_PREFIX,
				},
			},
		},
	})
	where.NOT = existingNot
}

function sentimentScoreFromText(text: string | null): number {
	const normalized = normalizeText(text || '')
	if (!normalized) return 0
	let score = 0
	for (const keyword of POSITIVE_SENTIMENT_KEYWORDS) {
		if (normalized.includes(keyword)) score += 1
	}
	for (const keyword of NEGATIVE_SENTIMENT_KEYWORDS) {
		if (normalized.includes(keyword)) score -= 1
	}
	return score
}

function sentimentLabel(score: number): {
	label: string
	tone: ContactDetailSignalTone
} {
	if (score > 0.35) return { label: 'Positif', tone: 'success' }
	if (score < -0.35) return { label: 'Negatif', tone: 'warning' }
	return { label: 'Netral', tone: 'info' }
}

function resolveSentimentSignal(
	customerMessages: Array<{ content: string | null }>,
): ContactDetailSignal {
	if (customerMessages.length === 0) {
		return { value: 'Netral', tone: 'neutral' }
	}

	const scores = customerMessages.map((message) =>
		sentimentScoreFromText(message.content),
	)
	const half = Math.max(1, Math.floor(scores.length / 2))
	const early = scores.slice(0, half)
	const recent = scores.slice(half)
	const earlyAverage =
		early.reduce((sum, score) => sum + score, 0) / Math.max(early.length, 1)
	const recentAverage =
		recent.reduce((sum, score) => sum + score, 0) / Math.max(recent.length, 1)

	const from = sentimentLabel(earlyAverage)
	const to = sentimentLabel(recentAverage)

	return {
		value:
			from.label === to.label ? to.label : `${from.label} \u2192 ${to.label}`,
		tone: to.tone,
	}
}

function normalizeCommerceJourneySignal(value: unknown): CommerceJourneySignal | null {
	const normalized = normalizeText(String(value || ''))
	if (!normalized) return null
	if (normalized === 'cart' || normalized === 'add_to_cart') return 'add_to_cart'
	if (normalized === 'checkout') return 'checkout'
	if (
		normalized === 'payment_pending' ||
		normalized === 'pending_payment' ||
		normalized === 'waiting_payment'
	) {
		return 'waiting_payment'
	}
	if (normalized === 'paid' || normalized === 'completed' || normalized === 'purchased') {
		return 'purchased'
	}
	return null
}

function resolveCommerceJourneySignal(source: unknown): CommerceJourneySignal | null {
	const record = asRecord(source)
	if (Object.keys(record).length === 0) return null
	return (
		normalizeCommerceJourneySignal(record.journey_phase) ||
		normalizeCommerceJourneySignal(record.order_status) ||
		normalizeCommerceJourneySignal(record.status) ||
		(asString(record.paid_at) ? 'purchased' : null)
	)
}

function resolveCommerceJourneyFromSummary(args: {
	openCart: unknown
	orderHistory: unknown[]
}): CommerceJourneySignal | null {
	const openCartStage = resolveCommerceJourneySignal(args.openCart)
	if (openCartStage) return openCartStage
	for (const order of args.orderHistory) {
		const stage = resolveCommerceJourneySignal(order)
		if (stage) return stage
	}
	return null
}

function commerceJourneySignalLabel(
	stage: CommerceJourneySignal,
): ContactDetailSignal {
	switch (stage) {
		case 'add_to_cart':
			return { value: 'Add to Cart', tone: 'success' }
		case 'checkout':
			return { value: 'Checkout', tone: 'success' }
		case 'waiting_payment':
			return { value: 'Waiting Payment', tone: 'warning' }
		case 'purchased':
			return { value: 'Purchased', tone: 'success' }
	}
}

function resolveCommerceSentimentSignal(
	baseSignal: ContactDetailSignal,
	stage: CommerceJourneySignal | null,
): ContactDetailSignal {
	if (!stage) return baseSignal
	if (baseSignal.tone === 'warning' && normalizeText(baseSignal.value).includes('negatif')) {
		return baseSignal
	}
	return { value: 'Positif', tone: 'success' }
}

function resolveIntentSignal(
	intent: string | null,
	commerceStage?: CommerceJourneySignal | null,
): ContactDetailSignal {
	if (commerceStage) return commerceJourneySignalLabel(commerceStage)

	const normalized = normalizeText(intent || '')
	if (!normalized) return { value: 'Belum terdeteksi', tone: 'neutral' }
	if (normalized.includes('payment') || normalized.includes('pembayaran')) {
		return { value: 'Waiting Payment', tone: 'warning' }
	}
	if (
		normalized.includes('closing') ||
		normalized.includes('checkout')
	) {
		return { value: 'Checkout', tone: 'success' }
	}
	if (normalized.includes('komplain') || normalized.includes('complain')) {
		return { value: 'Komplain', tone: 'warning' }
	}
	if (
		normalized.includes('handover') ||
		normalized.includes('admin') ||
		normalized.includes('cs')
	) {
		return { value: 'Minta CS', tone: 'warning' }
	}
	if (normalized.includes('stock_check') || normalized.includes('stok')) {
		return { value: 'Tanya Stok', tone: 'info' }
	}
	if (
		normalized.includes('pricing_request') ||
		normalized.includes('harga') ||
		normalized.includes('price')
	) {
		return { value: 'Tanya Harga', tone: 'info' }
	}
	if (
		normalized.includes('variant_match') ||
		normalized.includes('varian') ||
		normalized.includes('variant')
	) {
		return { value: 'Tanya Varian', tone: 'info' }
	}
	if (
		normalized.includes('product_lookup') ||
		normalized.includes('produk') ||
		normalized.includes('product')
	) {
		return { value: 'Tanya Produk', tone: 'info' }
	}
	if (
		normalized.includes('order_intent') ||
		normalized.includes('add_to_cart') ||
		normalized.includes('cart') ||
		normalized.includes('keranjang') ||
		normalized.includes('beli') ||
		normalized.includes('pesan')
	) {
		return { value: 'Add to Cart', tone: 'success' }
	}
	if (
		normalized.includes('inquiry_general') ||
		normalized.includes('tanya') ||
		normalized.includes('informasi') ||
		normalized.includes('info')
	) {
		return { value: 'Tanya Informasi', tone: 'info' }
	}
	return { value: intent || 'Belum terdeteksi', tone: 'info' }
}

function resolveBuyingStageSignal(
	openCart: unknown,
	intent?: string | null,
): ContactDetailSignal {
	const commerceStage = resolveCommerceJourneySignal(openCart)
	if (commerceStage) return commerceJourneySignalLabel(commerceStage)

	const intentSignal = resolveIntentSignal(intent || null)
	if (
		intentSignal.value === 'Tanya Produk' ||
		intentSignal.value === 'Tanya Informasi' ||
		intentSignal.value === 'Tanya Harga' ||
		intentSignal.value === 'Tanya Stok' ||
		intentSignal.value === 'Tanya Varian' ||
		intentSignal.value === 'Add to Cart' ||
		intentSignal.value === 'Checkout' ||
		intentSignal.value === 'Waiting Payment' ||
		intentSignal.value === 'Purchased'
	) {
		return intentSignal
	}
	return { value: 'Awareness', tone: 'neutral' }
}

function resolveChurnRiskSignal(args: {
	lastCustomerMessageAt: Date | null
	hasOpenCart: boolean
	repeatOrders: number
	lifetimeValue: number
	conversationStatus: string | null
}) {
	let risk = 42

	if (!args.lastCustomerMessageAt) {
		risk += 18
	} else {
		const ageHours =
			(Date.now() - args.lastCustomerMessageAt.getTime()) / (1000 * 60 * 60)
		if (ageHours <= 24) risk -= 14
		else if (ageHours <= 72) risk -= 6
		else if (ageHours <= 168) risk += 8
		else risk += 16
	}

	if (args.hasOpenCart) risk -= 12
	if (args.repeatOrders >= 3) risk -= 8
	else if (args.repeatOrders === 0) risk += 6
	if (args.lifetimeValue >= 10_000_000) risk -= 10
	if (normalizeText(args.conversationStatus || '') === 'resolved') risk += 8

	const percent = Math.round(clamp(risk, 5, 95))
	if (percent <= 25) {
		return {
			value: `Rendah \u00b7 ${percent}%`,
			tone: 'success' as const,
			percent,
		}
	}
	if (percent <= 60) {
		return {
			value: `Sedang \u00b7 ${percent}%`,
			tone: 'warning' as const,
			percent,
		}
	}
	return {
		value: `Tinggi \u00b7 ${percent}%`,
		tone: 'warning' as const,
		percent,
	}
}

function buildHeuristicSummary(args: {
	intent: string | null
	latestCustomerMessage: string | null
	repeatOrders: number
	lifetimeValue: number
	openCart: unknown
}) {
	const openCartRecord = asRecord(args.openCart)
	const firstItem = Array.isArray(openCartRecord.items)
		? asRecord(openCartRecord.items[0])
		: {}
	const productName =
		asString(firstItem.product_name) ||
		asString(firstItem.variant_name) ||
		'produk aktif'
	const quantity = Math.max(1, Math.trunc(toNumber(firstItem.quantity, 1)))
	const total = toNumber(openCartRecord.grand_total, 0)

	const chunks: string[] = []

	if (args.repeatOrders > 0) {
		chunks.push(`Pelanggan repeat dengan ${args.repeatOrders} order berbayar.`)
	}
	if (args.intent) {
		chunks.push(`Intent terbaru mengarah ke ${args.intent}.`)
	}
	if (args.latestCustomerMessage) {
		chunks.push(`Pesan customer terakhir: "${args.latestCustomerMessage}".`)
	}
	if (Object.keys(openCartRecord).length > 0) {
		chunks.push(
			`Open cart aktif pada ${productName} x${quantity} dengan nilai ${formatIdr(total)}.`,
		)
	}
	if (args.lifetimeValue > 0) {
		chunks.push(`Lifetime value saat ini ${formatIdr(args.lifetimeValue)}.`)
	}
	chunks.push(
		Object.keys(openCartRecord).length > 0
			? 'Rekomendasi: dorong checkout dan kirim link pembayaran.'
			: 'Rekomendasi: gali kebutuhan customer dan dorong ke tahap cart.',
	)

	return chunks.join(' ')
}

export const __contactDetailInternals = {
	resolveSentimentSignal,
	resolveCommerceSentimentSignal,
	resolveCommerceJourneySignal,
	resolveCommerceJourneyFromSummary,
	resolveIntentSignal,
	resolveBuyingStageSignal,
	resolveChurnRiskSignal,
	buildHeuristicSummary,
}

export abstract class ConversationService {
	private static async getWorkflowNameMap(
		workflowIds: string[],
		appId?: string | null,
	) {
		const uniqueWorkflowIds = Array.from(
			new Set(workflowIds.filter((workflowId) => isUuid(workflowId))),
		)
		if (uniqueWorkflowIds.length === 0) return new Map<string, string>()

		const rows = await prisma.automation_flows.findMany({
			where: {
				id: { in: uniqueWorkflowIds },
				...(appId ? { app_id: appId } : {}),
			},
			select: {
				id: true,
				name: true,
			},
		})

		return new Map<string, string>(
			rows
				.map((row) => [
					row.id,
					typeof row.name === 'string' ? row.name.trim() : '',
				])
				.filter(
					(entry): entry is [string, string] =>
						entry[0].length > 0 && entry[1].length > 0,
				),
		)
	}

	static async getConversations(
		accountId: string,
		filter: ConversationFilter = {},
	) {
		const targetAppId = await resolveAppId(accountId)
		const allowedChannelTypes = await getAllowedChannelTypesForUser({
			appId: targetAppId,
			userId: filter.viewerUserId,
		})

		const { status, inboxId, agentId, priority, page = 1, limit = 10 } = filter
		const normalizedWhatsappProvider = normalizeWhatsappProviderFilter(
			filter.provider,
		)

		const where: any = {}
		if (targetAppId) {
			where.app_id = targetAppId
		}
		appendAiPlaygroundConversationExclusion(where)

		if (status) where.status = status
		if (inboxId && isUuid(inboxId)) where.inbox_id = inboxId
		if (agentId && isUuid(agentId)) where.assignee_id = agentId
		if (priority) where.priority = priority

		// Advanced filters
		if (filter.dateFrom || filter.dateTo) {
			where.created_at = {}
			if (filter.dateFrom) where.created_at.gte = new Date(filter.dateFrom)
			if (filter.dateTo) where.created_at.lte = new Date(filter.dateTo)
		}
		if (filter.labelIds?.length) {
			where.conversation_labels = {
				some: { label_id: { in: filter.labelIds } },
			}
		}
		if (filter.resolvedBy && isUuid(filter.resolvedBy)) {
			where.assignee_id = filter.resolvedBy
			where.status = 'resolved'
		}
		if (filter.aiAgentId && isUuid(filter.aiAgentId)) {
			where.inboxes = { chatbot_id: filter.aiAgentId }
		}
		if (filter.pipelineStageId && isUuid(filter.pipelineStageId)) {
			where.stage_id = filter.pipelineStageId
		}
		if (normalizedWhatsappProvider && filter.channelType && filter.channelType !== 'whatsapp') {
			return { data: [], total: 0, page, limit }
		}
		const requestedChannelType =
			filter.channelType || (normalizedWhatsappProvider ? 'whatsapp' : undefined)
		if (allowedChannelTypes?.length) {
			if (requestedChannelType) {
				if (!allowedChannelTypes.includes(requestedChannelType)) {
					return { data: [], total: 0, page, limit }
				}
				where.channel_type = requestedChannelType
			} else {
				where.channel_type = { in: allowedChannelTypes }
			}
		} else if (requestedChannelType) {
			where.channel_type = requestedChannelType
		}
		if (normalizedWhatsappProvider) {
			where.inboxes = {
				...asRecord(where.inboxes),
				whatsapp_channels: {
					some: {
						deleted_at: null,
						provider: normalizedWhatsappProvider,
					},
				},
			}
		}

		// Row-level scoping: a sales-role viewer may only ever see conversations
		// assigned to them. This must run last, after every other filter that can
		// touch `where.assignee_id` (agentId, resolvedBy, ...), so no query param
		// can widen a sales viewer's access.
		if (filter.viewerRole === 'sales') {
			// Nil UUID sentinel when viewerUserId is missing: keeps the column type
			// valid while guaranteeing zero matches, so a sales viewer we can't
			// identify sees nothing rather than everything.
			where.assignee_id =
				filter.viewerUserId && isUuid(filter.viewerUserId)
					? filter.viewerUserId
					: '00000000-0000-0000-0000-000000000000'
		}

		const [conversations, total] = await Promise.all([
			prisma.conversations.findMany({
				where,
				include: {
					contacts: {
						select: {
							id: true,
							name: true,
							phone_number: true,
							whatsapp_id: true,
							email: true,
							avatar_url: true,
							identifier: true,
							window_expires_at: true,
							meta: true,
							metadata: true,
							instagram_igsid: true,
						},
					},
					inboxes: {
						select: {
							id: true,
							name: true,
							channel_type: true,
							channel_config: true,
							whatsapp_channels: {
								where: { deleted_at: null },
								orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
								take: 1,
								select: { provider: true },
							},
						},
					},
					messages: {
						orderBy: { created_at: 'desc' },
						take: 1,
						select: {
							id: true,
							content: true,
							message_type: true,
							content_type: true,
							sender_type: true,
							sender_id: true,
							status: true,
							metadata: true,
							content_attributes: true,
							additional_attributes: true,
							extras: true,
							created_at: true,
						},
					},
				},
				orderBy: { last_message_at: 'desc' },
				skip: (page - 1) * limit,
				take: limit,
			}),
			prisma.conversations.count({ where }),
		])

		const derivedAnalyticsByConversationId = new Map<
			string,
			ConversationAiAnalytics | null
		>()
		const workflowIds = new Set<string>()

		for (const conversation of conversations) {
			const analytics = deriveAiAnalyticsFromConversation({
				conversation: conversation as unknown as Record<string, unknown>,
			})
			derivedAnalyticsByConversationId.set(conversation.id, analytics)
			if (analytics?.workflow_id) workflowIds.add(analytics.workflow_id)
		}

		const workflowNameById = await this.getWorkflowNameMap(
			[...workflowIds],
			targetAppId,
		)
		const enrichedConversations = conversations.map((conversation) => {
			const whatsappProvider = resolveWhatsappProviderFromInbox(
				conversation.inboxes,
			)
			const analytics = normalizeAiAnalytics(
				derivedAnalyticsByConversationId.get(conversation.id),
				{ workflowNameById },
			)
			return {
				...conversation,
				provider: whatsappProvider,
				whatsapp_provider: whatsappProvider,
				ai_analytics: analytics,
			}
		})

		return { data: enrichedConversations, total, page, limit }
	}

	static async getConversationById(
		id: string,
		accountId?: string | null,
		viewerUserId?: string | null,
	) {
		if (!isUuid(id)) return null
		const targetAppId = accountId ? await resolveAppId(accountId) : null
		const allowedChannelTypes = await getAllowedChannelTypesForUser({
			appId: targetAppId,
			userId: viewerUserId,
		})

		const conversation = await prisma.conversations.findFirst({
			where: {
				id,
				...(targetAppId ? { app_id: targetAppId } : {}),
				...(allowedChannelTypes?.length
					? { channel_type: { in: allowedChannelTypes } }
					: {}),
			},
			include: {
					contacts: {
						select: {
							id: true,
							name: true,
							phone_number: true,
							whatsapp_id: true,
							email: true,
							avatar_url: true,
							identifier: true,
							window_expires_at: true,
							meta: true,
							metadata: true,
							instagram_igsid: true,
						},
					},
				inboxes: {
					select: {
						id: true,
						name: true,
						channel_type: true,
						channel_config: true,
						whatsapp_channels: {
							where: { deleted_at: null },
							orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
							take: 1,
							select: { provider: true },
						},
					},
				},
				conversation_labels: {
					include: {
						labels: true,
					},
				},
				messages: {
					orderBy: { created_at: 'desc' },
					take: 1,
					select: {
						id: true,
						content: true,
						message_type: true,
						content_type: true,
						sender_type: true,
						sender_id: true,
						status: true,
						metadata: true,
						content_attributes: true,
						additional_attributes: true,
						extras: true,
						created_at: true,
					},
				},
			},
		})
		if (!conversation) return null

		const derivedAnalytics = deriveAiAnalyticsFromConversation({
			conversation: conversation as unknown as Record<string, unknown>,
		})
		const workflowNameById = await this.getWorkflowNameMap(
			derivedAnalytics?.workflow_id ? [derivedAnalytics.workflow_id] : [],
			targetAppId,
		)
		const aiAnalytics = normalizeAiAnalytics(derivedAnalytics, { workflowNameById })
		const whatsappProvider = resolveWhatsappProviderFromInbox(conversation.inboxes)

		return {
			...conversation,
			provider: whatsappProvider,
			whatsapp_provider: whatsappProvider,
			ai_analytics: aiAnalytics,
		}
	}

	static async upsertAiAnalytics(
		conversationId: string,
		analytics: ConversationAiAnalytics | null,
	) {
		if (!isUuid(conversationId) || !analytics) return null

		const targetConversation = await prisma.conversations.findUnique({
			where: { id: conversationId },
			select: {
				id: true,
				additional_attributes: true,
			},
		})
		if (!targetConversation?.id) return null

		const additionalAttributes =
			targetConversation.additional_attributes &&
			typeof targetConversation.additional_attributes === 'object' &&
			!Array.isArray(targetConversation.additional_attributes)
				? (targetConversation.additional_attributes as Record<string, unknown>)
				: {}

		const nextAdditionalAttributes = {
			...additionalAttributes,
			ai_analytics_last: analytics,
		}

		await prisma.conversations.update({
			where: { id: conversationId },
			data: {
				additional_attributes: nextAdditionalAttributes as any,
				updated_at: new Date(),
			},
		})

		return analytics
	}

	static async updateStatus(id: string, status: string) {
		if (!isUuid(id)) return null

		const conv = await prisma.conversations.update({
			where: { id },
			data: {
				status,
				resolved_at: status === 'resolved' ? new Date() : null,
				updated_at: new Date(),
			},
		})

		const { app } = await import('../../index')
		const io = (app as any).io as any
		if (io) {
			const event =
				status === 'resolved'
					? 'conversation:resolved'
					: 'conversation:status_changed'
			io.to(`app:${conv.app_id}`).emit(event, { conversationId: id, status })
			io.to(`conversation:${id}`).emit(event, { conversationId: id, status })
		}

		return conv
	}

	static async assignAgent(
		id: string,
		agentId: string,
		assignmentType: 'manual' | 'takeover' = 'manual',
	) {
		if (!isUuid(id) || !isUuid(agentId)) return null

		const conversation = await prisma.conversations.findUnique({
			where: { id },
			select: { assignee_id: true, app_id: true },
		})

		if (conversation?.assignee_id !== agentId) {
			await prisma.assignment_history.create({
				data: {
					conversation_id: id,
					assigned_from: conversation?.assignee_id,
					assigned_to: agentId,
					assignment_type: assignmentType,
				},
			})

			await prisma.conversation_activity_log.create({
				data: {
					conversation_id: id,
					action: 'assigned',
					metadata: {
						assigned_from: conversation?.assignee_id,
						assigned_to: agentId,
					},
				},
			})
		}

		await prisma.conversation_agents.updateMany({
			where: {
				conversation_id: id,
				is_primary: true,
				agent_id: { not: agentId },
			},
			data: { is_primary: false },
		})

		const existingAgent = await prisma.conversation_agents.findFirst({
			where: {
				conversation_id: id,
				agent_id: agentId,
			},
		})

		if (existingAgent) {
			await prisma.conversation_agents.update({
				where: { id: existingAgent.id },
				data: {
					status: 'active',
					is_primary: true,
					removed_at: null,
				},
			})
		} else {
			await prisma.conversation_agents.create({
				data: {
					conversation_id: id,
					agent_id: agentId,
					is_primary: true,
					status: 'active',
					assigned_at: new Date(),
				},
			})
		}

		const updatedConv = await prisma.conversations.update({
			where: { id },
			data: {
				assignee_id: agentId,
				updated_at: new Date(),
			},
		})

		// Handing the conversation over hands the contact over with it. No team is
		// passed, so it follows the new assignee's own team — unlike lead routing,
		// this is a person-to-person move, not a team decision.
		await setContactOwner(prisma, { contactId: updatedConv.contact_id, ownerId: agentId })

		const { app } = await import('../../index')
		const io = (app as any).io as any
		if (io && conversation) {
			io.to(`app:${conversation.app_id}`).emit('conversation:assigned', {
				conversationId: id,
				agentId: agentId,
			})
			io.to(`conversation:${id}`).emit('conversation:assigned', {
				conversationId: id,
				agentId: agentId,
			})
		}

		if (conversation?.app_id && conversation.assignee_id !== agentId) {
			void BusinessWebhookDispatchService.dispatch({
				event: 'conversation.handled_by_updated',
				appId: conversation.app_id,
				inboxId: updatedConv.inbox_id,
				payload: {
					conversation_id: id,
					previous_assignee_id: conversation.assignee_id || null,
					current_assignee_id: agentId,
					assignment_type: assignmentType,
				},
			})
		}

		return updatedConv
	}

	static async markAsRead(id: string) {
		if (!isUuid(id)) return null

		const conv = await prisma.conversations.update({
			where: { id },
			data: {
				unread_count: 0,
				updated_at: new Date(),
			},
		})

		const { app } = await import('../../index')
		const io = (app as any).io as any
		if (io) {
			io.to(`app:${conv.app_id}`).emit('conversation:read', {
				conversationId: id,
			})
			io.to(`conversation:${id}`).emit('conversation:read', {
				conversationId: id,
			})
		}

		return conv
	}

	static async getStatusCounts(accountId: string, viewerUserId?: string | null) {
		const targetAppId = await resolveAppId(accountId)
		const allowedChannelTypes = await getAllowedChannelTypesForUser({
			appId: targetAppId,
			userId: viewerUserId,
		})
		const where: any = {}
		if (targetAppId) where.app_id = targetAppId
		appendAiPlaygroundConversationExclusion(where)
		if (allowedChannelTypes?.length) {
			where.channel_type = { in: allowedChannelTypes }
		}

		const all = await prisma.conversations.count({ where })
		const resolved = await prisma.conversations.count({
			where: { ...where, status: 'resolved' },
		})
		const served = await prisma.conversations.count({
			where: {
				...where,
				status: { not: 'resolved' },
				assignee_id: { not: null },
			},
		})
		const unserved = await prisma.conversations.count({
			where: {
				...where,
				status: { not: 'resolved' },
				assignee_id: null,
			},
		})

		return { all, unserved, served, resolved }
	}

	static async getConversationMessages(
		conversationId: string,
		limit = 50,
		before?: string,
		accountId?: string | null,
		viewerUserId?: string | null,
	) {
		if (!isUuid(conversationId)) return []
		const targetAppId = accountId ? await resolveAppId(accountId) : null
		const allowedChannelTypes = await getAllowedChannelTypesForUser({
			appId: targetAppId,
			userId: viewerUserId,
		})

		if (targetAppId || allowedChannelTypes?.length) {
			const conversation = await prisma.conversations.findFirst({
				where: {
					id: conversationId,
					...(targetAppId ? { app_id: targetAppId } : {}),
					...(allowedChannelTypes?.length
						? { channel_type: { in: allowedChannelTypes } }
						: {}),
				},
				select: { id: true },
			})

			if (!conversation) return []
		}

		const where: any = {
			conversation_id: conversationId,
			deleted_at: null,
			OR: [{ is_deleted: false }, { is_deleted: null }],
		}
		if (before) {
			where.created_at = { lt: new Date(before) }
		}

		return prisma.messages.findMany({
			where,
			orderBy: { created_at: 'desc' },
			take: limit,
		})
	}

	static async getContactDetail(
		conversationId: string,
		accountId: string,
		viewerUserId?: string | null,
	): Promise<ConversationContactDetail | null> {
		if (!isUuid(conversationId)) return null

		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) return null

		const conversation = await this.getConversationById(
			conversationId,
			targetAppId,
			viewerUserId,
		)
		if (!conversation) return null

		const backendNotes: string[] = []
		const [summaryContext, recentMessages] = await Promise.all([
			prisma.ai_conversation_contexts.findUnique({
				where: { conversation_id: conversationId },
				select: {
					context_summary: true,
					updated_at: true,
				},
			}),
			prisma.messages.findMany({
				where: {
					conversation_id: conversationId,
					deleted_at: null,
					OR: [{ is_deleted: false }, { is_deleted: null }],
				},
				orderBy: { created_at: 'desc' },
				take: 12,
				select: {
					content: true,
					message_type: true,
					sender_type: true,
					created_at: true,
				},
			}),
		])

		const conversationRecord = conversation as Record<string, unknown>
		const contactRecord = asRecord(conversationRecord.contacts)
		const contactMetadata = asRecord(contactRecord.metadata)
		const contactMeta = asRecord(contactRecord.meta)
		const aiAnalytics = normalizeAiAnalytics(conversationRecord.ai_analytics)
		const intent =
			asString(aiAnalytics?.intent) ||
			asString(contactMetadata.intent) ||
			asString(contactMetadata.last_intent) ||
			asString(contactMetadata.rag_intent) ||
			asString(contactMeta.intent) ||
			asString(contactMeta.last_intent)
		if (!intent) {
			backendNotes.push('Intent belum tersedia lengkap, fallback ke label default.')
		}

		const customerMessagesDesc = recentMessages.filter((message) => {
			const messageType = normalizeText(String(message.message_type || ''))
			const senderType = normalizeText(String(message.sender_type || ''))
			return messageType === 'incoming' || senderType === 'contact'
		})
		const customerMessagesChronological = [...customerMessagesDesc].reverse()
		const latestCustomerMessage = asString(customerMessagesDesc[0]?.content)
		const latestCustomerMessageAt =
			customerMessagesDesc[0]?.created_at instanceof Date
				? customerMessagesDesc[0].created_at
				: null

		if (customerMessagesChronological.length === 0) {
			backendNotes.push(
				'Sinyal sentiment belum optimal karena pesan customer masih minim.',
			)
		}

		const commerceCustomer: Record<string, unknown> = {}
		const badgesRecord: Record<string, unknown> = {}
		const openCart = null
		const orderHistory: unknown[] = []
		const latestOrder = asRecord(orderHistory[0])
		const buyingStageSource =
			openCart ||
			(Object.keys(latestOrder).length > 0 ? latestOrder : null)
		const commerceStage = resolveCommerceJourneyFromSummary({
			openCart,
			orderHistory,
		})
		const repeatOrders = Math.max(0, Math.trunc(toNumber(badgesRecord.repeat_orders)))
		const lifetimeValue = Math.max(0, toNumber(badgesRecord.lifetime_value))
		const vip = Boolean(badgesRecord.vip)

		const contextSummary = asString(summaryContext?.context_summary)
		const aiSummaryText =
			contextSummary ||
			buildHeuristicSummary({
				intent,
				latestCustomerMessage,
				repeatOrders,
				lifetimeValue,
				openCart,
			})
		const aiSummarySource: 'context' | 'heuristic' = contextSummary
			? 'context'
			: 'heuristic'
		if (!contextSummary) {
			backendNotes.push(
				'AI summary menggunakan fallback heuristic karena context summary belum tersedia.',
			)
		}

		const sentimentSignal = resolveCommerceSentimentSignal(
			resolveSentimentSignal(
				customerMessagesChronological
					.slice(-6)
					.map((item) => ({ content: asString(item.content) })),
			),
			commerceStage,
		)
		const intentSignal = resolveIntentSignal(intent, commerceStage)
		const buyingStageSignal = resolveBuyingStageSignal(buyingStageSource, intent)
		const churnRiskSignal = resolveChurnRiskSignal({
			lastCustomerMessageAt: latestCustomerMessageAt,
			hasOpenCart: Boolean(openCart && typeof openCart === 'object'),
			repeatOrders,
			lifetimeValue,
			conversationStatus: asString(conversationRecord.status),
		})

		const paymentMethods: Array<{ id: string; label: string; provider?: string }> = []

		return {
			conversation: {
				id: asString(conversationRecord.id) || conversationId,
				contact_id: asString(conversationRecord.contact_id),
				inbox_id: asString(conversationRecord.inbox_id),
				pipeline_id: asString(conversationRecord.pipeline_id),
				stage_id: asString(conversationRecord.stage_id),
				status: asString(conversationRecord.status),
				channel_type: asString(conversationRecord.channel_type),
			},
			customer: {
				id: asString(commerceCustomer.id) || asString(contactRecord.id),
				name:
					asString(commerceCustomer.name) ||
					asString(contactRecord.name) ||
					'Pelanggan',
				email: asString(commerceCustomer.email) || asString(contactRecord.email),
				phone_number:
					asString(commerceCustomer.phone_number) ||
					asString(contactRecord.phone_number) ||
					asString(contactRecord.whatsapp_id),
				avatar_url:
					asString(commerceCustomer.avatar_url) || asString(contactRecord.avatar_url),
				is_vip: vip,
				repeat_orders: repeatOrders,
				lifetime_value: lifetimeValue,
			},
			badges: {
				vip,
				repeat_orders: repeatOrders,
				lifetime_value: lifetimeValue,
			},
			ai_summary: {
				text: aiSummaryText,
				source: aiSummarySource,
				updated_at: (
					summaryContext?.updated_at instanceof Date
						? summaryContext.updated_at
						: latestCustomerMessageAt || new Date()
				).toISOString(),
			},
			live_signals: {
				sentiment: sentimentSignal,
				intent: intentSignal,
				buying_stage: buyingStageSignal,
				churn_risk: churnRiskSignal,
			},
			open_cart: null,
			order_history: orderHistory,
			tags: [],
			notes: [],
			payment_methods: paymentMethods,
			backend_notes: uniqNotes(backendNotes),
		}
	}
}
