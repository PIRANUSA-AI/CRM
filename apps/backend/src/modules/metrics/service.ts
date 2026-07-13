import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'

const DAY_MS = 24 * 60 * 60 * 1000
const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
const DASHBOARD_PERIODS = ['today', '7d', '30d'] as const
const AI_SENDER_TYPES = ['system', 'bot'] as const
const CS_SENDER_TYPES = ['agent', 'user'] as const

export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number]

type DashboardRange = {
	period: DashboardPeriod
	currentStart: Date
	currentEnd: Date
	previousStart: Date
	previousEnd: Date
	dayCount: number
	timezone: 'Asia/Jakarta'
}

type MetricValue = {
	value: number
	previous: number
	delta: number
	deltaPercent: number | null
}

type DashboardVolumeRow = {
	date: string
	day: string
	ai: number
	cs: number
	handover: number
	total: number
}

type DashboardFunnelStep = {
	label: string
	value: number
	pct: number
}

type DashboardAgentRow = {
	id: string
	name: string
	chats: number
	csat: number
	revenue: number
	online: boolean
}

type DashboardAlert = {
	id: string
	tone: 'success' | 'warning' | 'danger' | 'neutral'
	title: string
	description: string
}

type DashboardPayload = {
	cards: {
		incomingChats: MetricValue
		aiResolvedRate: MetricValue
		avgResponseSeconds: MetricValue
		revenue: MetricValue
	}
	volume: DashboardVolumeRow[]
	funnel: DashboardFunnelStep[]
	agents: DashboardAgentRow[]
	alerts: DashboardAlert[]
	range: {
		period: DashboardPeriod
		start: string
		end: string
		previousStart: string
		previousEnd: string
		timezone: 'Asia/Jakarta'
	}
}

type MessageAggregateRow = {
	total_messages?: unknown
	incoming_current?: unknown
	incoming_previous?: unknown
	ai_messages_current?: unknown
	ai_messages_previous?: unknown
	cs_messages_current?: unknown
	cs_messages_previous?: unknown
	delivered_current?: unknown
	read_current?: unknown
}

type ConversationAggregateRow = {
	active_conversations?: unknown
	total_conversations_current?: unknown
	total_conversations_previous?: unknown
	resolved_conversations_current?: unknown
	resolved_conversations_previous?: unknown
	avg_first_response_current?: unknown
	avg_first_response_previous?: unknown
}

type AiResolutionRow = {
	ai_engaged?: unknown
	ai_resolved?: unknown
}

type OrderAggregateRow = {
	revenue_current?: unknown
	revenue_previous?: unknown
	orders_current?: unknown
	orders_previous?: unknown
	quoted_orders_current?: unknown
	paid_orders_current?: unknown
}

type HandoverAggregateRow = {
	handovers_current?: unknown
	handovers_previous?: unknown
	pending_current?: unknown
	pending_unassigned_current?: unknown
}

type QualifiedAggregateRow = {
	qualified_current?: unknown
}

type CustomerAggregateRow = {
	total_customers?: unknown
	new_customers_current?: unknown
	new_customers_previous?: unknown
}

type RawVolumeRow = {
	day_key?: string | null
	ai?: unknown
	cs?: unknown
	handover?: unknown
}

type RawAgentRow = {
	id: string
	name: string | null
	chats?: unknown
	csat?: unknown
	revenue?: unknown
	status?: string | null
}

type ChannelHealthRow = {
	active_channels?: unknown
	error_channels?: unknown
	whatsapp_inboxes?: unknown
	last_synced_at?: Date | string | null
}

type SummaryPeriod = '1h' | '24h' | '7d' | '30d'

function normalizeDashboardPeriod(input?: string | null): DashboardPeriod {
	const normalized = String(input || '').trim().toLowerCase()
	if (normalized === '24h') return 'today'
	if (DASHBOARD_PERIODS.includes(normalized as DashboardPeriod)) {
		return normalized as DashboardPeriod
	}
	return '7d'
}

function normalizeSummaryPeriod(input?: string | null): SummaryPeriod {
	const normalized = String(input || '').trim().toLowerCase()
	if (['1h', '24h', '7d', '30d'].includes(normalized)) {
		return normalized as SummaryPeriod
	}
	return '24h'
}

function toNumber(value: unknown, fallback = 0): number {
	if (typeof value === 'bigint') return Number(value)
	if (value && typeof value === 'object' && 'toString' in value) {
		const parsed = Number(value.toString())
		return Number.isFinite(parsed) ? parsed : fallback
	}
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function round(value: number, precision = 1): number {
	if (!Number.isFinite(value)) return 0
	const factor = 10 ** precision
	return Math.round(value * factor) / factor
}

function percent(numerator: number, denominator: number): number {
	if (denominator <= 0) return 0
	return round((numerator / denominator) * 100, 1)
}

function metricValue(value: number, previous: number): MetricValue {
	const delta = round(value - previous, 1)
	return {
		value: round(value, 1),
		previous: round(previous, 1),
		delta,
		deltaPercent: previous > 0 ? round((delta / previous) * 100, 1) : null,
	}
}

function startOfJakartaDay(date: Date): Date {
	const jakartaDate = new Date(date.getTime() + WIB_OFFSET_MS)
	return new Date(
		Date.UTC(
			jakartaDate.getUTCFullYear(),
			jakartaDate.getUTCMonth(),
			jakartaDate.getUTCDate(),
		) - WIB_OFFSET_MS,
	)
}

function resolveDashboardRange(
	input?: string | null,
	now = new Date(),
): DashboardRange {
	const period = normalizeDashboardPeriod(input)
	const todayStart = startOfJakartaDay(now)
	const dayCount = period === 'today' ? 1 : period === '30d' ? 30 : 7
	const currentStart =
		period === 'today'
			? todayStart
			: new Date(todayStart.getTime() - (dayCount - 1) * DAY_MS)
	const currentEnd = now
	const currentDuration = Math.max(1, currentEnd.getTime() - currentStart.getTime())
	const previousEnd = currentStart
	const previousStart = new Date(previousEnd.getTime() - currentDuration)

	return {
		period,
		currentStart,
		currentEnd,
		previousStart,
		previousEnd,
		dayCount,
		timezone: 'Asia/Jakarta',
	}
}

function resolveSummaryRange(period: SummaryPeriod, now = new Date()) {
	const durationMs =
		period === '1h'
			? 60 * 60 * 1000
			: period === '30d'
				? 30 * DAY_MS
				: period === '7d'
					? 7 * DAY_MS
					: DAY_MS
	const currentStart = new Date(now.getTime() - durationMs)
	return {
		currentStart,
		currentEnd: now,
		previousStart: new Date(currentStart.getTime() - durationMs),
		previousEnd: currentStart,
	}
}

function formatJakartaDateKey(date: Date): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(date)
	const year = parts.find((part) => part.type === 'year')?.value || '1970'
	const month = parts.find((part) => part.type === 'month')?.value || '01'
	const day = parts.find((part) => part.type === 'day')?.value || '01'
	return `${year}-${month}-${day}`
}

function formatJakartaDayLabel(date: Date): string {
	return new Intl.DateTimeFormat('id-ID', {
		timeZone: 'Asia/Jakarta',
		weekday: 'short',
	})
		.format(date)
		.replace('.', '')
}

function emptyDashboard(appId: string, period?: string | null) {
	const range = resolveDashboardRange(period)
	const volume = buildVolume(range, [])
	const dashboard = buildDashboardPayload({
		range,
		messageAggregate: {},
		conversationAggregate: {},
		aiCurrent: {},
		aiPrevious: {},
		orderAggregate: {},
		handoverAggregate: {},
		qualifiedAggregate: {},
		customerAggregate: {},
		volume,
		agents: [],
		channelHealth: {},
	})

	return {
		period: range.period,
		app_id: appId,
		total_messages: 0,
		active_conversations: 0,
		total_customers: 0,
		avg_response_time: 0,
		ai_handling_rate: 0,
		delivered_messages: 0,
		read_messages: 0,
		delivery_rate: 0,
		dashboard,
		source: {
			period: range.period,
			total_messages: 0,
			active_conversations: 0,
			avg_response_time: 0,
			ai_handling_rate: 0,
			revenue: 0,
			daily: volume,
		},
	}
}

async function queryRows<T>(sql: string, ...params: unknown[]): Promise<T[]> {
	return prisma.$queryRawUnsafe<T[]>(sql, ...params)
}

async function queryFirst<T extends object>(
	sql: string,
	...params: unknown[]
): Promise<T> {
	const rows = await queryRows<T>(sql, ...params)
	return rows[0] || ({} as T)
}

function buildVolume(
	range: DashboardRange,
	rawRows: RawVolumeRow[],
): DashboardVolumeRow[] {
	const rowsByDay = new Map<string, RawVolumeRow>()
	for (const row of rawRows) {
		if (row.day_key) rowsByDay.set(row.day_key, row)
	}

	return Array.from({ length: range.dayCount }, (_, index) => {
		const date = new Date(range.currentStart.getTime() + index * DAY_MS)
		const key = formatJakartaDateKey(date)
		const row = rowsByDay.get(key)
		const ai = toNumber(row?.ai)
		const cs = toNumber(row?.cs)
		const handover = toNumber(row?.handover)
		return {
			date: key,
			day: formatJakartaDayLabel(date),
			ai,
			cs,
			handover,
			total: ai + cs + handover,
		}
	})
}

function buildFunnel({
	incomingChats,
	aiEngaged,
	qualified,
	quoted,
	paid,
}: {
	incomingChats: number
	aiEngaged: number
	qualified: number
	quoted: number
	paid: number
}): DashboardFunnelStep[] {
	const baseline = Math.max(1, incomingChats)
	return [
		{ label: 'Chat masuk', value: incomingChats, pct: percent(incomingChats, baseline) },
		{ label: 'AI engaged', value: aiEngaged, pct: percent(aiEngaged, baseline) },
		{ label: 'Qualified', value: qualified, pct: percent(qualified, baseline) },
		{ label: 'Quoted', value: quoted, pct: percent(quoted, baseline) },
		{ label: 'Paid', value: paid, pct: percent(paid, baseline) },
	]
}

function mapAgents(rows: RawAgentRow[]): DashboardAgentRow[] {
	return rows.map((row) => {
		const status = String(row.status || '').toLowerCase()
		return {
			id: row.id,
			name: row.name || 'Agent',
			chats: toNumber(row.chats),
			csat: round(toNumber(row.csat), 1),
			revenue: toNumber(row.revenue),
			online: ['online', 'available', 'active'].includes(status),
		}
	})
}

function buildAlerts({
	pendingHandovers,
	pendingUnassigned,
	channelHealth,
	incomingChats,
	aiResolvedRate,
	paidOrders,
}: {
	pendingHandovers: number
	pendingUnassigned: number
	channelHealth: ChannelHealthRow
	incomingChats: number
	aiResolvedRate: number
	paidOrders: number
}): DashboardAlert[] {
	const activeChannels =
		toNumber(channelHealth.active_channels) + toNumber(channelHealth.whatsapp_inboxes)
	const errorChannels = toNumber(channelHealth.error_channels)

	const handoverAlert: DashboardAlert =
		pendingUnassigned > 0
			? {
					id: 'handover-unassigned',
					tone: 'warning',
					title: `${pendingUnassigned.toLocaleString('id-ID')} handover belum diassign`,
					description: 'Prioritaskan queue pending agar lead tidak menunggu terlalu lama.',
				}
			: pendingHandovers > 0
				? {
						id: 'handover-pending',
						tone: 'warning',
						title: `${pendingHandovers.toLocaleString('id-ID')} handover pending`,
						description: 'Pantau request handover yang masih menunggu approval.',
					}
				: {
						id: 'handover-clear',
						tone: 'success',
						title: 'Handover queue aman',
						description: 'Tidak ada handover pending pada periode ini.',
					}

	const channelAlert: DashboardAlert =
		activeChannels <= 0
			? {
					id: 'wa-channel-missing',
					tone: 'neutral',
					title: 'WA channel belum aktif',
					description: 'Hubungkan WhatsApp channel agar pesan masuk dapat dipantau.',
				}
			: errorChannels > 0
				? {
						id: 'wa-channel-warning',
						tone: 'danger',
						title: `${errorChannels.toLocaleString('id-ID')} WA channel perlu dicek`,
						description: 'Ada sync error pada channel WhatsApp aktif.',
					}
				: {
						id: 'wa-channel-healthy',
						tone: 'success',
						title: 'WA channel sehat',
						description: 'Channel WhatsApp aktif tanpa sync error tercatat.',
					}

	const recommendation: DashboardAlert =
		incomingChats > 0 && paidOrders <= 0
			? {
					id: 'recommend-followup',
					tone: 'neutral',
					title: 'Rekomendasi periode ini',
					description: 'Follow-up lead aktif yang belum menghasilkan order paid.',
				}
			: aiResolvedRate > 0 && aiResolvedRate < 75
				? {
						id: 'recommend-ai-handover',
						tone: 'warning',
						title: 'Rekomendasi periode ini',
						description: 'Review alur AI karena resolved tanpa handover masih di bawah target.',
					}
				: {
						id: 'recommend-stable',
						tone: 'success',
						title: 'Rekomendasi periode ini',
						description: 'Operasional stabil; lanjutkan monitoring volume dan kualitas respons.',
					}

	return [handoverAlert, channelAlert, recommendation]
}

function buildDashboardPayload(input: {
	range: DashboardRange
	messageAggregate: MessageAggregateRow
	conversationAggregate: ConversationAggregateRow
	aiCurrent: AiResolutionRow
	aiPrevious: AiResolutionRow
	orderAggregate: OrderAggregateRow
	handoverAggregate: HandoverAggregateRow
	qualifiedAggregate: QualifiedAggregateRow
	customerAggregate: CustomerAggregateRow
	volume: DashboardVolumeRow[]
	agents: DashboardAgentRow[]
	channelHealth: ChannelHealthRow
}): DashboardPayload {
	const incomingCurrent = toNumber(input.messageAggregate.incoming_current)
	const incomingPrevious = toNumber(input.messageAggregate.incoming_previous)
	const aiEngagedCurrent = toNumber(input.aiCurrent.ai_engaged)
	const aiEngagedPrevious = toNumber(input.aiPrevious.ai_engaged)
	const aiResolvedCurrent = toNumber(input.aiCurrent.ai_resolved)
	const aiResolvedPrevious = toNumber(input.aiPrevious.ai_resolved)
	const aiResolvedRateCurrent = percent(aiResolvedCurrent, aiEngagedCurrent)
	const aiResolvedRatePrevious = percent(aiResolvedPrevious, aiEngagedPrevious)
	const avgResponseCurrent = toNumber(
		input.conversationAggregate.avg_first_response_current,
	)
	const avgResponsePrevious = toNumber(
		input.conversationAggregate.avg_first_response_previous,
	)
	const revenueCurrent = toNumber(input.orderAggregate.revenue_current)
	const revenuePrevious = toNumber(input.orderAggregate.revenue_previous)
	const quotedOrders = toNumber(input.orderAggregate.quoted_orders_current)
	const paidOrders = toNumber(input.orderAggregate.paid_orders_current)
	const qualified = toNumber(input.qualifiedAggregate.qualified_current)
	const pendingHandovers = toNumber(input.handoverAggregate.pending_current)
	const pendingUnassigned = toNumber(
		input.handoverAggregate.pending_unassigned_current,
	)

	return {
		cards: {
			incomingChats: metricValue(incomingCurrent, incomingPrevious),
			aiResolvedRate: metricValue(aiResolvedRateCurrent, aiResolvedRatePrevious),
			avgResponseSeconds: metricValue(avgResponseCurrent, avgResponsePrevious),
			revenue: metricValue(revenueCurrent, revenuePrevious),
		},
		volume: input.volume,
		funnel: buildFunnel({
			incomingChats: incomingCurrent,
			aiEngaged: aiEngagedCurrent,
			qualified,
			quoted: quotedOrders,
			paid: paidOrders,
		}),
		agents: input.agents,
		alerts: buildAlerts({
			pendingHandovers,
			pendingUnassigned,
			channelHealth: input.channelHealth,
			incomingChats: incomingCurrent,
			aiResolvedRate: aiResolvedRateCurrent,
			paidOrders,
		}),
		range: {
			period: input.range.period,
			start: input.range.currentStart.toISOString(),
			end: input.range.currentEnd.toISOString(),
			previousStart: input.range.previousStart.toISOString(),
			previousEnd: input.range.previousEnd.toISOString(),
			timezone: input.range.timezone,
		},
	}
}

export abstract class MetricsService {
	static async getSummary(appId: string, period: string = '24h') {
		const targetAppId = await resolveAppId(appId)
		const summaryPeriod = normalizeSummaryPeriod(period)
		const range = resolveSummaryRange(summaryPeriod)

		if (!targetAppId) {
			return {
				period: summaryPeriod,
				total_messages: 0,
				active_conversations: 0,
				avg_response_time: 0,
				ai_handling_rate: 0,
				ai: {
					totalAnalyses: 0,
					averageConfidence: 0,
					sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
					intentDistribution: {},
					escalationRate: 0,
					averageResponseTime: 0,
				},
				routing: {
					totalRouted: 0,
					successRate: 0,
					ruleDistribution: {},
					averageRoutingTime: 0,
				},
				conversations: {
					totalMessages: 0,
					totalResolved: 0,
					averageMessagesPerConversation: 0,
				},
			}
		}

		const target = targetAppId
		const [messageAggregate, conversationAggregate, aiCurrent, handoverAggregate] =
			await Promise.all([
				this.getMessageAggregate(target, {
					...range,
					period: 'today',
					dayCount: 1,
					timezone: 'Asia/Jakarta',
				}),
				this.getConversationAggregate(target, {
					...range,
					period: 'today',
					dayCount: 1,
					timezone: 'Asia/Jakarta',
				}),
				this.getAiResolutionAggregate(
					target,
					range.currentStart,
					range.currentEnd,
				),
				this.getHandoverAggregate(target, {
					...range,
					period: 'today',
					dayCount: 1,
					timezone: 'Asia/Jakarta',
				}),
			])

		const totalMessages = toNumber(messageAggregate.total_messages)
		const totalConversations = toNumber(
			conversationAggregate.total_conversations_current,
		)
		const resolvedConversations = toNumber(
			conversationAggregate.resolved_conversations_current,
		)
		const aiEngaged = toNumber(aiCurrent.ai_engaged)
		const aiResolved = toNumber(aiCurrent.ai_resolved)

		return {
			period: summaryPeriod,
			total_messages: totalMessages,
			active_conversations: toNumber(conversationAggregate.active_conversations),
			avg_response_time: toNumber(
				conversationAggregate.avg_first_response_current,
			),
			ai_handling_rate: percent(aiResolved, aiEngaged),
			ai: {
				totalAnalyses: aiEngaged,
				averageConfidence: aiEngaged > 0 ? percent(aiResolved, aiEngaged) : 0,
				sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
				intentDistribution: {},
				escalationRate: percent(
					toNumber(handoverAggregate.handovers_current),
					Math.max(1, totalConversations),
				),
				averageResponseTime: toNumber(
					conversationAggregate.avg_first_response_current,
				),
			},
			routing: {
				totalRouted: toNumber(handoverAggregate.handovers_current),
				successRate: percent(
					toNumber(handoverAggregate.handovers_current) -
						toNumber(handoverAggregate.pending_current),
					Math.max(1, toNumber(handoverAggregate.handovers_current)),
				),
				ruleDistribution: {},
				averageRoutingTime: 0,
			},
			conversations: {
				totalMessages,
				totalResolved: resolvedConversations,
				averageMessagesPerConversation:
					totalConversations > 0
						? round(totalMessages / totalConversations, 1)
						: 0,
			},
		}
	}

	static async getDashboard(appId: string, period: string = '7d') {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return emptyDashboard(appId, period)

		const target = targetAppId
		const range = resolveDashboardRange(period)

		const [
			messageAggregate,
			conversationAggregateBase,
			aiCurrent,
			aiPrevious,
			orderAggregate,
			handoverAggregate,
			qualifiedAggregate,
			customerAggregate,
			rawVolume,
			rawAgents,
			channelHealth,
		] = await Promise.all([
			this.getMessageAggregate(target, range),
			this.getConversationAggregate(target, range),
			this.getAiResolutionAggregate(
				target,
				range.currentStart,
				range.currentEnd,
			),
			this.getAiResolutionAggregate(
				target,
				range.previousStart,
				range.previousEnd,
			),
			this.getOrderAggregate(target, range),
			this.getHandoverAggregate(target, range),
			this.getQualifiedAggregate(target, range),
			this.getCustomerAggregate(target, range),
			this.getVolume(target, range),
			this.getAgents(target, range),
			this.getChannelHealth(target),
		])

		const conversationAggregate = {
			...conversationAggregateBase,
			avg_first_response_current:
				toNumber(conversationAggregateBase.avg_first_response_current) ||
				(await this.getDerivedAverageResponseSeconds(
					target,
					range.currentStart,
					range.currentEnd,
				)),
			avg_first_response_previous:
				toNumber(conversationAggregateBase.avg_first_response_previous) ||
				(await this.getDerivedAverageResponseSeconds(
					target,
					range.previousStart,
					range.previousEnd,
				)),
		}
		const volume = buildVolume(range, rawVolume)
		const agents = mapAgents(rawAgents)
		const dashboard = buildDashboardPayload({
			range,
			messageAggregate,
			conversationAggregate,
			aiCurrent,
			aiPrevious,
			orderAggregate,
			handoverAggregate,
			qualifiedAggregate,
			customerAggregate,
			volume,
			agents,
			channelHealth,
		})

		const totalMessages = toNumber(messageAggregate.total_messages)
		const deliveredMessages = toNumber(messageAggregate.delivered_current)
		const readMessages = toNumber(messageAggregate.read_current)

		return {
			period: range.period,
			total_messages: totalMessages,
			active_conversations: toNumber(conversationAggregate.active_conversations),
			total_customers: toNumber(customerAggregate.total_customers),
			avg_response_time: dashboard.cards.avgResponseSeconds.value,
			ai_handling_rate: dashboard.cards.aiResolvedRate.value,
			delivered_messages: deliveredMessages,
			read_messages: readMessages,
			delivery_rate: percent(deliveredMessages, totalMessages),
			dashboard,
			source: {
				period: range.period,
				total_messages: totalMessages,
				active_conversations: toNumber(
					conversationAggregate.active_conversations,
				),
				avg_response_time: dashboard.cards.avgResponseSeconds.value,
				ai_handling_rate: dashboard.cards.aiResolvedRate.value,
				revenue: dashboard.cards.revenue.value,
				revenue_7d: dashboard.cards.revenue.value,
				closing_rate: percent(
					toNumber(orderAggregate.paid_orders_current),
					Math.max(1, toNumber(orderAggregate.quoted_orders_current)),
				),
				daily: volume,
			},
		}
	}

	static async getAIMetrics(appId: string) {
		const targetAppId = await resolveAppId(appId)

		if (!targetAppId) {
			return {
				total_evaluations: 0,
				avg_score: 0,
				ai_response_count: 0,
			}
		}

		const [totalEvaluations, aiResponseCount] = await Promise.all([
			prisma.ai_evaluations.count({
				where: { app_id: targetAppId, deleted_at: null },
			}),
			prisma.ai_response_logs.count({
				where: { app_id: targetAppId },
			}),
		])

		return {
			total_evaluations: totalEvaluations,
			avg_score: 0,
			ai_response_count: aiResponseCount,
		}
	}

	private static getMessageAggregate(appId: string, range: DashboardRange) {
		return queryFirst<MessageAggregateRow>(
			`/* metrics:message-aggregate */
			SELECT
				COUNT(*) FILTER (
					WHERE m.created_at >= $2 AND m.created_at < $3
				)::bigint AS total_messages,
				COUNT(*) FILTER (
					WHERE m.created_at >= $2 AND m.created_at < $3
					  AND (LOWER(m.message_type) = 'incoming' OR LOWER(COALESCE(m.sender_type, '')) = 'contact')
				)::bigint AS incoming_current,
				COUNT(*) FILTER (
					WHERE m.created_at >= $4 AND m.created_at < $5
					  AND (LOWER(m.message_type) = 'incoming' OR LOWER(COALESCE(m.sender_type, '')) = 'contact')
				)::bigint AS incoming_previous,
				COUNT(*) FILTER (
					WHERE m.created_at >= $2 AND m.created_at < $3
					  AND LOWER(m.message_type) = 'outgoing'
					  AND LOWER(COALESCE(m.sender_type, '')) IN ('${AI_SENDER_TYPES.join("','")}')
				)::bigint AS ai_messages_current,
				COUNT(*) FILTER (
					WHERE m.created_at >= $4 AND m.created_at < $5
					  AND LOWER(m.message_type) = 'outgoing'
					  AND LOWER(COALESCE(m.sender_type, '')) IN ('${AI_SENDER_TYPES.join("','")}')
				)::bigint AS ai_messages_previous,
				COUNT(*) FILTER (
					WHERE m.created_at >= $2 AND m.created_at < $3
					  AND LOWER(m.message_type) = 'outgoing'
					  AND LOWER(COALESCE(m.sender_type, '')) IN ('${CS_SENDER_TYPES.join("','")}')
				)::bigint AS cs_messages_current,
				COUNT(*) FILTER (
					WHERE m.created_at >= $4 AND m.created_at < $5
					  AND LOWER(m.message_type) = 'outgoing'
					  AND LOWER(COALESCE(m.sender_type, '')) IN ('${CS_SENDER_TYPES.join("','")}')
				)::bigint AS cs_messages_previous,
				COUNT(*) FILTER (
					WHERE m.created_at >= $2 AND m.created_at < $3
					  AND LOWER(COALESCE(m.status, '')) IN ('delivered', 'read')
				)::bigint AS delivered_current,
				COUNT(*) FILTER (
					WHERE m.created_at >= $2 AND m.created_at < $3
					  AND LOWER(COALESCE(m.status, '')) = 'read'
				)::bigint AS read_current
			FROM messages m
			LEFT JOIN conversations c ON c.id = m.conversation_id
			WHERE COALESCE(m.app_id, c.app_id) = $1::uuid
			  AND m.created_at >= $4
			  AND m.created_at < $3
			  AND m.deleted_at IS NULL
			  AND COALESCE(m.is_deleted, false) = false`,
			appId,
			range.currentStart,
			range.currentEnd,
			range.previousStart,
			range.previousEnd,
		)
	}

	private static getConversationAggregate(appId: string, range: DashboardRange) {
		return queryFirst<ConversationAggregateRow>(
			`/* metrics:conversation-aggregate */
			SELECT
				COUNT(*) FILTER (
					WHERE LOWER(COALESCE(c.status, '')) = 'open'
				)::bigint AS active_conversations,
				COUNT(*) FILTER (
					WHERE c.created_at >= $2 AND c.created_at < $3
				)::bigint AS total_conversations_current,
				COUNT(*) FILTER (
					WHERE c.created_at >= $4 AND c.created_at < $5
				)::bigint AS total_conversations_previous,
				COUNT(*) FILTER (
					WHERE LOWER(COALESCE(c.status, '')) = 'resolved'
					  AND COALESCE(c.resolved_at, c.updated_at, c.created_at) >= $2
					  AND COALESCE(c.resolved_at, c.updated_at, c.created_at) < $3
				)::bigint AS resolved_conversations_current,
				COUNT(*) FILTER (
					WHERE LOWER(COALESCE(c.status, '')) = 'resolved'
					  AND COALESCE(c.resolved_at, c.updated_at, c.created_at) >= $4
					  AND COALESCE(c.resolved_at, c.updated_at, c.created_at) < $5
				)::bigint AS resolved_conversations_previous,
				AVG(c.first_response_time_seconds) FILTER (
					WHERE c.created_at >= $2 AND c.created_at < $3
					  AND COALESCE(c.first_response_time_seconds, 0) > 0
				)::double precision AS avg_first_response_current,
				AVG(c.first_response_time_seconds) FILTER (
					WHERE c.created_at >= $4 AND c.created_at < $5
					  AND COALESCE(c.first_response_time_seconds, 0) > 0
				)::double precision AS avg_first_response_previous
			FROM conversations c
			WHERE c.app_id = $1::uuid
			  AND c.deleted_at IS NULL`,
			appId,
			range.currentStart,
			range.currentEnd,
			range.previousStart,
			range.previousEnd,
		)
	}

	private static getAiResolutionAggregate(
		appId: string,
		startDate: Date,
		endDate: Date,
	) {
		return queryFirst<AiResolutionRow>(
			`/* metrics:ai-resolution */
			WITH ai_conversations AS (
				SELECT DISTINCT m.conversation_id
				FROM messages m
				LEFT JOIN conversations c ON c.id = m.conversation_id
				WHERE COALESCE(m.app_id, c.app_id) = $1::uuid
				  AND m.conversation_id IS NOT NULL
				  AND m.created_at >= $2
				  AND m.created_at < $3
				  AND m.deleted_at IS NULL
				  AND COALESCE(m.is_deleted, false) = false
				  AND LOWER(m.message_type) = 'outgoing'
				  AND LOWER(COALESCE(m.sender_type, '')) IN ('${AI_SENDER_TYPES.join("','")}')
			)
			SELECT
				COUNT(*)::bigint AS ai_engaged,
				COUNT(*) FILTER (
					WHERE NOT EXISTS (
						SELECT 1
						FROM handover_requests hr
						WHERE hr.app_id = $1::uuid
						  AND hr.conversation_id = ai_conversations.conversation_id
						  AND LOWER(COALESCE(hr.status, '')) IN ('pending', 'approved')
					)
				)::bigint AS ai_resolved
			FROM ai_conversations`,
			appId,
			startDate,
			endDate,
		)
	}

	private static getOrderAggregate(appId: string, range: DashboardRange) {
		return queryFirst<OrderAggregateRow>(
			`/* metrics:order-aggregate */
			SELECT
				COALESCE(SUM(o.grand_total) FILTER (
					WHERE o.created_at >= $2 AND o.created_at < $3
					  AND (LOWER(COALESCE(o.order_status, '')) IN ('completed', 'paid') OR o.paid_at IS NOT NULL)
				), 0)::double precision AS revenue_current,
				COALESCE(SUM(o.grand_total) FILTER (
					WHERE o.created_at >= $4 AND o.created_at < $5
					  AND (LOWER(COALESCE(o.order_status, '')) IN ('completed', 'paid') OR o.paid_at IS NOT NULL)
				), 0)::double precision AS revenue_previous,
				COUNT(*) FILTER (
					WHERE o.created_at >= $2 AND o.created_at < $3
				)::bigint AS orders_current,
				COUNT(*) FILTER (
					WHERE o.created_at >= $4 AND o.created_at < $5
				)::bigint AS orders_previous,
				COUNT(*) FILTER (
					WHERE o.created_at >= $2 AND o.created_at < $3
					  AND COALESCE(o.grand_total, 0) > 0
				)::bigint AS quoted_orders_current,
				COUNT(*) FILTER (
					WHERE o.created_at >= $2 AND o.created_at < $3
					  AND (LOWER(COALESCE(o.order_status, '')) IN ('completed', 'paid') OR o.paid_at IS NOT NULL)
				)::bigint AS paid_orders_current
			FROM orders o
			LEFT JOIN conversations c ON c.id = o.conversation_id
			WHERE COALESCE(o.app_id, c.app_id) = $1::uuid
			  AND o.created_at >= $4
			  AND o.created_at < $3`,
			appId,
			range.currentStart,
			range.currentEnd,
			range.previousStart,
			range.previousEnd,
		)
	}

	private static getHandoverAggregate(appId: string, range: DashboardRange) {
		return queryFirst<HandoverAggregateRow>(
			`/* metrics:handover-aggregate */
			SELECT
				COUNT(*) FILTER (
					WHERE hr.created_at >= $2 AND hr.created_at < $3
				)::bigint AS handovers_current,
				COUNT(*) FILTER (
					WHERE hr.created_at >= $4 AND hr.created_at < $5
				)::bigint AS handovers_previous,
				COUNT(*) FILTER (
					WHERE hr.created_at >= $2 AND hr.created_at < $3
					  AND LOWER(COALESCE(hr.status, '')) = 'pending'
				)::bigint AS pending_current,
				COUNT(*) FILTER (
					WHERE hr.created_at >= $2 AND hr.created_at < $3
					  AND LOWER(COALESCE(hr.status, '')) = 'pending'
					  AND hr.target_agent_id IS NULL
				)::bigint AS pending_unassigned_current
			FROM handover_requests hr
			WHERE hr.app_id = $1::uuid
			  AND hr.created_at >= $4
			  AND hr.created_at < $3`,
			appId,
			range.currentStart,
			range.currentEnd,
			range.previousStart,
			range.previousEnd,
		)
	}

	private static getQualifiedAggregate(appId: string, range: DashboardRange) {
		return queryFirst<QualifiedAggregateRow>(
			`/* metrics:qualified-aggregate */
			SELECT
				COUNT(DISTINCT c.id) FILTER (
					WHERE (
						c.pipeline_id IS NOT NULL
						OR c.stage_id IS NOT NULL
						OR cs.stage_id IS NOT NULL
						OR COALESCE(cs.probability_snapshot, 0) > 0
						OR o.id IS NOT NULL
					)
				)::bigint AS qualified_current
			FROM conversations c
			LEFT JOIN conversation_sales cs ON cs.conversation_id = c.id
			LEFT JOIN orders o
				ON o.conversation_id = c.id
			   AND o.created_at >= $2
			   AND o.created_at < $3
			WHERE c.app_id = $1::uuid
			  AND c.deleted_at IS NULL
			  AND (
				(c.created_at >= $2 AND c.created_at < $3)
				OR (c.updated_at >= $2 AND c.updated_at < $3)
				OR o.id IS NOT NULL
			  )`,
			appId,
			range.currentStart,
			range.currentEnd,
		)
	}

	private static getCustomerAggregate(appId: string, range: DashboardRange) {
		return queryFirst<CustomerAggregateRow>(
			`/* metrics:customer-aggregate */
			SELECT
				COUNT(*)::bigint AS total_customers,
				COUNT(*) FILTER (
					WHERE created_at >= $2 AND created_at < $3
				)::bigint AS new_customers_current,
				COUNT(*) FILTER (
					WHERE created_at >= $4 AND created_at < $5
				)::bigint AS new_customers_previous
			FROM contacts
			WHERE app_id = $1::uuid
			  AND deleted_at IS NULL`,
			appId,
			range.currentStart,
			range.currentEnd,
			range.previousStart,
			range.previousEnd,
		)
	}

	private static getVolume(appId: string, range: DashboardRange) {
		return queryRows<RawVolumeRow>(
			`/* metrics:volume */
			SELECT
				day_key,
				SUM(ai)::bigint AS ai,
				SUM(cs)::bigint AS cs,
				SUM(handover)::bigint AS handover
			FROM (
				SELECT
					TO_CHAR((m.created_at + INTERVAL '7 hours')::date, 'YYYY-MM-DD') AS day_key,
					COUNT(*) FILTER (
						WHERE LOWER(m.message_type) = 'outgoing'
						  AND LOWER(COALESCE(m.sender_type, '')) IN ('${AI_SENDER_TYPES.join("','")}')
					)::bigint AS ai,
					COUNT(*) FILTER (
						WHERE LOWER(m.message_type) = 'outgoing'
						  AND LOWER(COALESCE(m.sender_type, '')) IN ('${CS_SENDER_TYPES.join("','")}')
					)::bigint AS cs,
					0::bigint AS handover
				FROM messages m
				LEFT JOIN conversations c ON c.id = m.conversation_id
				WHERE COALESCE(m.app_id, c.app_id) = $1::uuid
				  AND m.created_at >= $2
				  AND m.created_at < $3
				  AND m.deleted_at IS NULL
				  AND COALESCE(m.is_deleted, false) = false
				GROUP BY day_key

				UNION ALL

				SELECT
					TO_CHAR((hr.created_at + INTERVAL '7 hours')::date, 'YYYY-MM-DD') AS day_key,
					0::bigint AS ai,
					0::bigint AS cs,
					COUNT(*)::bigint AS handover
				FROM handover_requests hr
				WHERE hr.app_id = $1::uuid
				  AND hr.created_at >= $2
				  AND hr.created_at < $3
				GROUP BY day_key
			) daily
			GROUP BY day_key
			ORDER BY day_key ASC`,
			appId,
			range.currentStart,
			range.currentEnd,
		)
	}

	private static getAgents(appId: string, range: DashboardRange) {
		return queryRows<RawAgentRow>(
			`/* metrics:agents */
			WITH chats AS (
				SELECT assignee_id, COUNT(*)::bigint AS chats
				FROM conversations
				WHERE app_id = $1::uuid
				  AND assignee_id IS NOT NULL
				  AND deleted_at IS NULL
				  AND created_at >= $2
				  AND created_at < $3
				GROUP BY assignee_id
			),
			csat AS (
				SELECT c.assignee_id, AVG(cr.rating)::double precision AS csat
				FROM conversation_ratings cr
				JOIN conversations c ON c.id = cr.conversation_id
				WHERE c.app_id = $1::uuid
				  AND c.assignee_id IS NOT NULL
				  AND cr.created_at >= $2
				  AND cr.created_at < $3
				GROUP BY c.assignee_id
			),
			revenue AS (
				SELECT c.assignee_id, COALESCE(SUM(o.grand_total), 0)::double precision AS revenue
				FROM orders o
				JOIN conversations c ON c.id = o.conversation_id
				WHERE COALESCE(o.app_id, c.app_id) = $1::uuid
				  AND c.assignee_id IS NOT NULL
				  AND o.created_at >= $2
				  AND o.created_at < $3
				  AND (LOWER(COALESCE(o.order_status, '')) IN ('completed', 'paid') OR o.paid_at IS NOT NULL)
				GROUP BY c.assignee_id
			)
			SELECT
				u.id,
				u.name,
				COALESCE(ap.status, u.status, 'offline') AS status,
				COALESCE(chats.chats, 0)::bigint AS chats,
				COALESCE(csat.csat, 0)::double precision AS csat,
				COALESCE(revenue.revenue, 0)::double precision AS revenue
			FROM users u
			LEFT JOIN agent_presence ap ON ap.user_id = u.id
			LEFT JOIN chats ON chats.assignee_id = u.id
			LEFT JOIN csat ON csat.assignee_id = u.id
			LEFT JOIN revenue ON revenue.assignee_id = u.id
			WHERE u.app_id = $1::uuid
			  AND u.deleted_at IS NULL
			  AND LOWER(COALESCE(u.role, 'sales')) IN ('sales', 'leader', 'ceo')
			ORDER BY chats DESC, revenue DESC, u.name ASC
			LIMIT 8`,
			appId,
			range.currentStart,
			range.currentEnd,
		)
	}

	private static getChannelHealth(appId: string) {
		return queryFirst<ChannelHealthRow>(
			`/* metrics:channel-health */
			SELECT
				(
					SELECT COUNT(*)::bigint
					FROM whatsapp_channels wc
					LEFT JOIN inboxes i ON i.id = wc.inbox_id
					WHERE COALESCE(wc.app_id, i.app_id) = $1::uuid
					  AND wc.deleted_at IS NULL
					  AND COALESCE(wc.is_active, true) = true
				) AS active_channels,
				(
					SELECT COUNT(*)::bigint
					FROM whatsapp_channels wc
					LEFT JOIN inboxes i ON i.id = wc.inbox_id
					WHERE COALESCE(wc.app_id, i.app_id) = $1::uuid
					  AND wc.deleted_at IS NULL
					  AND COALESCE(wc.is_active, true) = true
					  AND NULLIF(TRIM(COALESCE(wc.sync_error, '')), '') IS NOT NULL
				) AS error_channels,
				(
					SELECT COUNT(*)::bigint
					FROM inboxes i
					WHERE i.app_id = $1::uuid
					  AND i.deleted_at IS NULL
					  AND COALESCE(i.is_active, true) = true
					  AND LOWER(COALESCE(i.channel_type, '')) = 'whatsapp'
				) AS whatsapp_inboxes,
				(
					SELECT MAX(wc.last_synced_at)
					FROM whatsapp_channels wc
					LEFT JOIN inboxes i ON i.id = wc.inbox_id
					WHERE COALESCE(wc.app_id, i.app_id) = $1::uuid
					  AND wc.deleted_at IS NULL
				) AS last_synced_at`,
			appId,
		)
	}

	private static async getDerivedAverageResponseSeconds(
		appId: string,
		startDate: Date,
		endDate: Date,
	) {
		const row = await queryFirst<{ avg_response_seconds?: unknown }>(
			`/* metrics:derived-response-time */
			WITH first_incoming AS (
				SELECT
					m.conversation_id,
					MIN(m.created_at) AS first_incoming_at
				FROM messages m
				LEFT JOIN conversations c ON c.id = m.conversation_id
				WHERE COALESCE(m.app_id, c.app_id) = $1::uuid
				  AND m.conversation_id IS NOT NULL
				  AND m.created_at >= $2
				  AND m.created_at < $3
				  AND m.deleted_at IS NULL
				  AND COALESCE(m.is_deleted, false) = false
				  AND (LOWER(m.message_type) = 'incoming' OR LOWER(COALESCE(m.sender_type, '')) = 'contact')
				GROUP BY m.conversation_id
			),
			first_response AS (
				SELECT
					fi.conversation_id,
					MIN(m.created_at) AS first_response_at
				FROM first_incoming fi
				JOIN messages m
					ON m.conversation_id = fi.conversation_id
				   AND m.created_at > fi.first_incoming_at
				WHERE m.deleted_at IS NULL
				  AND COALESCE(m.is_deleted, false) = false
				  AND LOWER(m.message_type) = 'outgoing'
				  AND LOWER(COALESCE(m.sender_type, '')) IN ('${[...AI_SENDER_TYPES, ...CS_SENDER_TYPES].join("','")}')
				GROUP BY fi.conversation_id
			)
			SELECT
				AVG(EXTRACT(EPOCH FROM (fr.first_response_at - fi.first_incoming_at)))::double precision AS avg_response_seconds
			FROM first_incoming fi
			JOIN first_response fr ON fr.conversation_id = fi.conversation_id`,
			appId,
			startDate,
			endDate,
		)
		return round(toNumber(row.avg_response_seconds), 1)
	}
}

export const __test__ = {
	buildDashboardPayload,
	buildFunnel,
	buildVolume,
	metricValue,
	normalizeDashboardPeriod,
	resolveDashboardRange,
	toNumber,
}
