import { recordAuditLog } from '../../lib/audit-log'
import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'

export type SalesTargetActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export class SalesTargetError extends Error {}
export class SalesTargetNotFoundError extends Error {}

export type SalesTargetListQuery = {
	periodType?: string
	periodStart?: string
	userId?: string
}

export type SalesTargetInput = {
	periodType: string
	periodStart: string
	targetRevenue: number
	targetDeals?: number
	targetLeads?: number
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000
const PERIOD_TYPES = ['annual', 'quarterly', 'monthly'] as const

function round(value: number, precision = 1): number {
	if (!Number.isFinite(value)) return 0
	const factor = 10 ** precision
	return Math.round(value * factor) / factor
}

function todayReferenceDate(now = new Date()): string {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now)
	const year = parts.find((p) => p.type === 'year')?.value || '1970'
	const month = parts.find((p) => p.type === 'month')?.value || '01'
	const day = parts.find((p) => p.type === 'day')?.value || '01'
	return `${year}-${month}-${day}`
}

type PeriodRange = {
	// Calendar dates (no time-of-day) for the period_start/period_end columns.
	periodStart: Date
	periodEnd: Date
	// WIB-aware [start, end) timestamps for querying opportunities.closed_at,
	// same day-boundary convention as metrics/service.ts.
	queryStart: Date
	queryEnd: Date
}

/**
 * A reference date ("2026-07-15") snapped to the calendar boundaries of the
 * annual/quarterly/monthly period it falls in. The caller does not need to
 * compute period_end themselves - any date inside the target period resolves
 * to the same canonical period_start/period_end, which is what the unique
 * constraint (app_id, user_id, period_type, period_start) upserts against.
 */
function resolvePeriodRange(
	periodType: string,
	referenceDate: string,
): PeriodRange | null {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(referenceDate)
	if (!match) return null
	const year = Number(match[1])
	const month = Number(match[2])
	if (month < 1 || month > 12) return null

	let startMonthIndex: number
	let endMonthIndex: number
	if (periodType === 'annual') {
		startMonthIndex = 0
		endMonthIndex = 11
	} else if (periodType === 'quarterly') {
		startMonthIndex = Math.floor((month - 1) / 3) * 3
		endMonthIndex = startMonthIndex + 2
	} else if (periodType === 'monthly') {
		startMonthIndex = month - 1
		endMonthIndex = month - 1
	} else {
		return null
	}

	const periodStart = new Date(Date.UTC(year, startMonthIndex, 1))
	const lastDay = new Date(Date.UTC(year, endMonthIndex + 1, 0)).getUTCDate()
	const periodEnd = new Date(Date.UTC(year, endMonthIndex, lastDay))

	return {
		periodStart,
		periodEnd,
		queryStart: new Date(periodStart.getTime() - WIB_OFFSET_MS),
		queryEnd: new Date(periodEnd.getTime() + DAY_MS - WIB_OFFSET_MS),
	}
}

/**
 * Whose targets the actor may see. Mirrors dealVisibilityScope: sales sees
 * their own, leader sees their team's plus their own, everyone above sees
 * all. `null` means "no filter" (administrator/ceo).
 */
async function resolveTargetVisibleUserIds(
	actor: SalesTargetActor,
): Promise<string[] | null> {
	if (actor.role === 'sales') return [actor.userId]
	if (actor.role === 'leader') {
		const memberships = await prisma.team_members.findMany({
			where: { user_id: actor.userId },
			select: { team_id: true },
		})
		const teamIds = memberships.map((m) => m.team_id)
		if (!teamIds.length) return [actor.userId]
		const teamMembers = await prisma.team_members.findMany({
			where: { team_id: { in: teamIds } },
			select: { user_id: true },
		})
		return [...new Set([actor.userId, ...teamMembers.map((m) => m.user_id)])]
	}
	return null
}

async function computeAchievement(
	appId: string,
	userId: string,
	range: PeriodRange | null,
): Promise<{ revenue: number; dealCount: number; leadCount: number }> {
	if (!range) return { revenue: 0, dealCount: 0, leadCount: 0 }
	const [dealAgg, leadCount] = await Promise.all([
		prisma.opportunities.aggregate({
			where: {
				app_id: appId,
				owner_id: userId,
				status: 'won',
				closed_at: { gte: range.queryStart, lt: range.queryEnd },
			},
			_sum: { value: true },
			_count: { _all: true },
		}),
		prisma.contacts.count({
			where: {
				app_id: appId,
				owner_id: userId,
				deleted_at: null,
				created_at: { gte: range.queryStart, lt: range.queryEnd },
			},
		}),
	])
	return {
		revenue: Number(dealAgg._sum.value || 0),
		dealCount: dealAgg._count._all,
		leadCount,
	}
}

export abstract class SalesTargetsService {
	static async list(actor: SalesTargetActor, query: SalesTargetListQuery) {
		const visibleUserIds = await resolveTargetVisibleUserIds(actor)
		let userIds = visibleUserIds
		if (query.userId) {
			if (visibleUserIds && !visibleUserIds.includes(query.userId)) {
				throw new SalesTargetError('User di luar scope Anda')
			}
			userIds = [query.userId]
		}

		const today = todayReferenceDate()
		const periodFilter =
			query.periodType && query.periodStart
				? (() => {
						const range = resolvePeriodRange(query.periodType!, query.periodStart!)
						if (!range) throw new SalesTargetError('periodStart tidak valid')
						return [{ period_type: query.periodType!, period_start: range.periodStart }]
					})()
				: PERIOD_TYPES.map((periodType) => {
						const range = resolvePeriodRange(periodType, today)!
						return { period_type: periodType, period_start: range.periodStart }
					})

		const rows = await prisma.sales_targets.findMany({
			where: {
				app_id: actor.appId,
				...(userIds ? { user_id: { in: userIds } } : {}),
				OR: periodFilter,
			},
			orderBy: [{ user_id: 'asc' }, { period_type: 'asc' }],
		})

		const userIdsInRows = [...new Set(rows.map((r) => r.user_id))]
		const users = userIdsInRows.length
			? await prisma.users.findMany({
					where: { id: { in: userIdsInRows } },
					select: { id: true, name: true, email: true },
				})
			: []
		const userById = new Map(users.map((u) => [u.id, u]))

		return Promise.all(
			rows.map(async (row) => {
				const range = resolvePeriodRange(
					row.period_type,
					row.period_start.toISOString().slice(0, 10),
				)
				const achievement = await computeAchievement(actor.appId, row.user_id, range)
				const targetRevenue = Number(row.target_revenue)
				const targetDeals = row.target_deals
				const targetLeads = row.target_leads
				return {
					userId: row.user_id,
					userName:
						userById.get(row.user_id)?.name ||
						userById.get(row.user_id)?.email ||
						null,
					periodType: row.period_type,
					periodStart: row.period_start,
					periodEnd: row.period_end,
					targetRevenue,
					targetDeals,
					targetLeads,
					achievement: {
						revenue: achievement.revenue,
						dealCount: achievement.dealCount,
						leadCount: achievement.leadCount,
						revenueProgressPercent:
							targetRevenue > 0
								? round((achievement.revenue / targetRevenue) * 100, 1)
								: 0,
						dealProgressPercent:
							targetDeals > 0
								? round((achievement.dealCount / targetDeals) * 100, 1)
								: 0,
						leadProgressPercent:
							targetLeads > 0
								? round((achievement.leadCount / targetLeads) * 100, 1)
								: 0,
					},
				}
			}),
		)
	}

	static async upsert(
		actor: SalesTargetActor,
		targetUserId: string,
		input: SalesTargetInput,
	) {
		if (
			!PERIOD_TYPES.includes(input.periodType as (typeof PERIOD_TYPES)[number])
		) {
			throw new SalesTargetError('periodType harus annual, quarterly, atau monthly')
		}
		const range = resolvePeriodRange(input.periodType, input.periodStart)
		if (!range) throw new SalesTargetError('periodStart tidak valid')

		const targetUser = await prisma.users.findFirst({
			where: {
				id: targetUserId,
				app_id: actor.appId,
				deleted_at: null,
				role: { in: ['sales', 'leader'] },
			},
			select: { id: true },
		})
		if (!targetUser) {
			throw new SalesTargetNotFoundError(
				'Target tidak ditemukan atau bukan sales/leader di app ini',
			)
		}

		const targetRevenue = Math.max(0, Number(input.targetRevenue) || 0)
		const targetDeals = Math.max(0, Math.floor(Number(input.targetDeals) || 0))
		const targetLeads = Math.max(0, Math.floor(Number(input.targetLeads) || 0))

		const compoundKey = {
			app_id: actor.appId,
			user_id: targetUserId,
			period_type: input.periodType,
			period_start: range.periodStart,
		}
		const previous = await prisma.sales_targets.findUnique({
			where: { app_id_user_id_period_type_period_start: compoundKey },
			select: { target_revenue: true, target_deals: true, target_leads: true },
		})

		const row = await prisma.sales_targets.upsert({
			where: { app_id_user_id_period_type_period_start: compoundKey },
			create: {
				...compoundKey,
				period_end: range.periodEnd,
				target_revenue: targetRevenue,
				target_deals: targetDeals,
				target_leads: targetLeads,
				set_by: actor.userId,
			},
			update: {
				period_end: range.periodEnd,
				target_revenue: targetRevenue,
				target_deals: targetDeals,
				target_leads: targetLeads,
				set_by: actor.userId,
			},
		})

		await recordAuditLog({
			appId: actor.appId,
			entityType: 'sales_target',
			entityId: targetUserId,
			action: 'target_set',
			actorId: actor.userId,
			metadata: {
				periodType: input.periodType,
				periodStart: range.periodStart.toISOString().slice(0, 10),
				previousTargetRevenue: previous ? Number(previous.target_revenue) : null,
				targetRevenue,
				previousTargetDeals: previous ? previous.target_deals : null,
				targetDeals,
				previousTargetLeads: previous ? previous.target_leads : null,
				targetLeads,
			},
		})

		return {
			userId: row.user_id,
			periodType: row.period_type,
			periodStart: row.period_start,
			periodEnd: row.period_end,
			targetRevenue: Number(row.target_revenue),
			targetDeals: row.target_deals,
			targetLeads: row.target_leads,
		}
	}
}
