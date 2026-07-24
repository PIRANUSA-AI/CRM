import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'
import type { CanonicalRole } from '../../lib/require-role'

export type SystemHealthActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export type HealthStatus = 'healthy' | 'warning' | 'inactive'

const DAY_MS = 24 * 60 * 60 * 1000

function channelStatus(active: number, error: number, inboxes: number): HealthStatus {
	if (active === 0 && inboxes === 0) return 'inactive'
	if (error > 0) return 'warning'
	return 'healthy'
}

function webhookStatus(total: number, errorCount: number): HealthStatus {
	if (total === 0) return 'inactive'
	if (errorCount > 0) return 'warning'
	return 'healthy'
}

function aiStatus(total: number, failed: number): HealthStatus {
	if (total === 0) return 'inactive'
	if (failed / total > 0.1) return 'warning'
	return 'healthy'
}

function handoverStatus(pendingUnassigned: number): HealthStatus {
	return pendingUnassigned > 0 ? 'warning' : 'healthy'
}

const EMPTY_HEALTH = {
	channels: {
		active: 0,
		error: 0,
		inboxes: 0,
		lastSyncedAt: null as string | null,
		status: 'inactive' as HealthStatus,
	},
	webhooks: {
		last24h: { total: 0, processed: 0, pending: 0, error: 0 },
		lastReceivedAt: null as string | null,
		recentErrors: [] as Array<{
			id: string
			source: string
			eventType: string
			errorMessage: string | null
			retryCount: number
			createdAt: string
		}>,
		status: 'inactive' as HealthStatus,
	},
	ai: {
		last24h: { total: 0, delivered: 0, failed: 0, retryPending: 0, synthetic: 0, generated: 0 },
		failureRate: 0,
		totalTokens24h: 0,
		totalUsageUsd24h: 0,
		lastGeneratedAt: null as string | null,
		lastProvider: null as string | null,
		status: 'inactive' as HealthStatus,
	},
	handover: {
		pending: 0,
		pendingUnassigned: 0,
		status: 'healthy' as HealthStatus,
	},
	system: {
		uptimeSeconds: Math.round(process.uptime()),
		timestamp: new Date().toISOString(),
	},
}

export abstract class SystemHealthService {
	static async get(actor: SystemHealthActor) {
		const targetAppId = await resolveAppId(actor.appId)
		if (!targetAppId) return EMPTY_HEALTH

		const now = new Date()
		const since24h = new Date(now.getTime() - DAY_MS)

		const [
			channelRows,
			webhookGroups24h,
			lastWebhook,
			recentWebhookErrors,
			aiGroups24h,
			aiUsage24h,
			lastAiLog,
			handoverPending,
			handoverPendingUnassigned,
		] = await Promise.all([
			prisma.whatsapp_channels.findMany({
				where: { app_id: targetAppId, deleted_at: null },
				select: { is_active: true, sync_error: true, last_synced_at: true },
			}),
			prisma.webhook_events.groupBy({
				by: ['status'],
				where: { app_id: targetAppId, created_at: { gte: since24h } },
				_count: { _all: true },
			}),
			prisma.webhook_events.findFirst({
				where: { app_id: targetAppId },
				orderBy: { created_at: 'desc' },
				select: { created_at: true },
			}),
			prisma.webhook_events.findMany({
				where: {
					app_id: targetAppId,
					OR: [
						{ status: 'error' },
						{ status: 'failed' },
						{ error_message: { not: null } },
					],
				},
				orderBy: { created_at: 'desc' },
				take: 5,
				select: {
					id: true,
					source: true,
					event_type: true,
					error_message: true,
					retry_count: true,
					created_at: true,
				},
			}),
			prisma.ai_response_logs.groupBy({
				by: ['status'],
				where: { app_id: targetAppId, created_at: { gte: since24h } },
				_count: { _all: true },
			}),
			prisma.ai_response_logs.aggregate({
				where: { app_id: targetAppId, created_at: { gte: since24h } },
				_sum: { total_tokens: true, usage_usd: true },
			}),
			prisma.ai_response_logs.findFirst({
				where: { app_id: targetAppId },
				orderBy: { created_at: 'desc' },
				select: { created_at: true, provider: true },
			}),
			prisma.handover_requests.count({
				where: { app_id: targetAppId, status: 'pending' },
			}),
			prisma.handover_requests.count({
				where: { app_id: targetAppId, status: 'pending', target_agent_id: null },
			}),
		])

		const activeChannels = channelRows.filter((row) => row.is_active).length
		const errorChannels = channelRows.filter(
			(row) => row.sync_error && row.sync_error.trim(),
		).length
		const lastSyncedAt = channelRows.reduce<Date | null>((latest, row) => {
			if (!row.last_synced_at) return latest
			if (!latest || row.last_synced_at > latest) return row.last_synced_at
			return latest
		}, null)

		const webhookByStatus = new Map(
			webhookGroups24h.map((row) => [row.status || 'pending', row._count._all]),
		)
		const webhookTotal24h = webhookGroups24h.reduce(
			(sum, row) => sum + row._count._all,
			0,
		)
		const webhookErrors24h =
			(webhookByStatus.get('error') || 0) + (webhookByStatus.get('failed') || 0)

		const aiByStatus = new Map(
			aiGroups24h.map((row) => [row.status || 'generated', row._count._all]),
		)
		const aiTotal24h = aiGroups24h.reduce((sum, row) => sum + row._count._all, 0)
		const aiFailed24h = aiByStatus.get('failed') || 0

		return {
			channels: {
				active: activeChannels,
				error: errorChannels,
				inboxes: channelRows.length,
				lastSyncedAt: lastSyncedAt ? lastSyncedAt.toISOString() : null,
				status: channelStatus(activeChannels, errorChannels, channelRows.length),
			},
			webhooks: {
				last24h: {
					total: webhookTotal24h,
					processed: webhookByStatus.get('processed') || 0,
					pending: webhookByStatus.get('pending') || 0,
					error: webhookErrors24h,
				},
				lastReceivedAt: lastWebhook?.created_at
					? lastWebhook.created_at.toISOString()
					: null,
				recentErrors: recentWebhookErrors.map((row) => ({
					id: row.id,
					source: row.source,
					eventType: row.event_type,
					errorMessage: row.error_message,
					retryCount: row.retry_count || 0,
					createdAt: row.created_at ? row.created_at.toISOString() : '',
				})),
				status: webhookStatus(webhookTotal24h, webhookErrors24h),
			},
			ai: {
				last24h: {
					total: aiTotal24h,
					delivered: aiByStatus.get('delivered') || 0,
					failed: aiFailed24h,
					retryPending: aiByStatus.get('retry_pending') || 0,
					synthetic: aiByStatus.get('synthetic') || 0,
					generated: aiByStatus.get('generated') || 0,
				},
				failureRate:
					aiTotal24h > 0 ? Math.round((aiFailed24h / aiTotal24h) * 1000) / 10 : 0,
				totalTokens24h: aiUsage24h._sum.total_tokens || 0,
				totalUsageUsd24h: Number(aiUsage24h._sum.usage_usd || 0),
				lastGeneratedAt: lastAiLog?.created_at
					? lastAiLog.created_at.toISOString()
					: null,
				lastProvider: lastAiLog?.provider || null,
				status: aiStatus(aiTotal24h, aiFailed24h),
			},
			handover: {
				pending: handoverPending,
				pendingUnassigned: handoverPendingUnassigned,
				status: handoverStatus(handoverPendingUnassigned),
			},
			system: {
				uptimeSeconds: Math.round(process.uptime()),
				timestamp: now.toISOString(),
			},
		}
	}
}
