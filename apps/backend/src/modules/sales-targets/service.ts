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
	periodKey?: string
	userId?: string
}

export type SalesTargetInput = {
	periodType: string
	periodKey: string
	revenueTarget: number
	dealCountTarget?: number
}

const WIB_OFFSET_MS = 7 * 60 * 60 * 1000
const PERIOD_TYPES = ['year', 'month', 'day'] as const

function round(value: number, precision = 1): number {
	if (!Number.isFinite(value)) return 0
	const factor = 10 ** precision
	return Math.round(value * factor) / factor
}

function currentPeriodKeys(now = new Date()): {
	year: string
	month: string
	day: string
} {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: 'Asia/Jakarta',
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	}).formatToParts(now)
	const year = parts.find((p) => p.type === 'year')?.value || '1970'
	const month = parts.find((p) => p.type === 'month')?.value || '01'
	const day = parts.find((p) => p.type === 'day')?.value || '01'
	return { year, month: `${year}-${month}`, day: `${year}-${month}-${day}` }
}

/**
 * "2026" / "2026-07" / "2026-07-23" -> a [start, end) range in Asia/Jakarta,
 * expressed as UTC Dates for Prisma. Mirrors the WIB day-boundary convention
 * metrics/service.ts uses for dashboard periods, so a target period and a
 * dashboard period never disagree about where a day starts.
 */
function resolveTargetPeriodRange(
	periodType: string,
	periodKey: string,
): { start: Date; end: Date } | null {
	if (periodType === 'year') {
		if (!/^\d{4}$/.test(periodKey)) return null
		const year = Number(periodKey)
		return {
			start: new Date(Date.UTC(year, 0, 1) - WIB_OFFSET_MS),
			end: new Date(Date.UTC(year + 1, 0, 1) - WIB_OFFSET_MS),
		}
	}
	if (periodType === 'month') {
		const match = /^(\d{4})-(\d{2})$/.exec(periodKey)
		if (!match) return null
		const year = Number(match[1])
		const month = Number(match[2])
		if (month < 1 || month > 12) return null
		return {
			start: new Date(Date.UTC(year, month - 1, 1) - WIB_OFFSET_MS),
			end: new Date(Date.UTC(year, month, 1) - WIB_OFFSET_MS),
		}
	}
	if (periodType === 'day') {
		const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(periodKey)
		if (!match) return null
		const year = Number(match[1])
		const month = Number(match[2])
		const day = Number(match[3])
		if (month < 1 || month > 12 || day < 1 || day > 31) return null
		// Date.UTC silently rolls a day that doesn't exist in this month (e.g.
		// Feb 31) into the next one; reject rather than silently target the
		// wrong day.
		const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
		if (day > daysInMonth) return null
		const start = new Date(Date.UTC(year, month - 1, day) - WIB_OFFSET_MS)
		return { start, end: new Date(start.getTime() + 24 * 60 * 60 * 1000) }
	}
	return null
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
	range: { start: Date; end: Date } | null,
): Promise<{ revenue: number; dealCount: number }> {
	if (!range) return { revenue: 0, dealCount: 0 }
	const result = await prisma.opportunities.aggregate({
		where: {
			app_id: appId,
			owner_id: userId,
			status: 'won',
			closed_at: { gte: range.start, lt: range.end },
		},
		_sum: { value: true },
		_count: { _all: true },
	})
	return {
		revenue: Number(result._sum.value || 0),
		dealCount: result._count._all,
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

		const periodFilter =
			query.periodType && query.periodKey
				? [{ period_type: query.periodType, period_key: query.periodKey }]
				: (() => {
						const current = currentPeriodKeys()
						return [
							{ period_type: 'year', period_key: current.year },
							{ period_type: 'month', period_key: current.month },
							{ period_type: 'day', period_key: current.day },
						]
					})()

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
				const range = resolveTargetPeriodRange(row.period_type, row.period_key)
				const achievement = await computeAchievement(
					actor.appId,
					row.user_id,
					range,
				)
				const revenueTarget = Number(row.revenue_target)
				const dealCountTarget = row.deal_count_target
				return {
					userId: row.user_id,
					userName:
						userById.get(row.user_id)?.name ||
						userById.get(row.user_id)?.email ||
						null,
					periodType: row.period_type,
					periodKey: row.period_key,
					revenueTarget,
					dealCountTarget,
					achievement: {
						revenue: achievement.revenue,
						dealCount: achievement.dealCount,
						revenueProgressPercent:
							revenueTarget > 0
								? round((achievement.revenue / revenueTarget) * 100, 1)
								: 0,
						dealProgressPercent:
							dealCountTarget > 0
								? round((achievement.dealCount / dealCountTarget) * 100, 1)
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
			throw new SalesTargetError('periodType harus year, month, atau day')
		}
		const range = resolveTargetPeriodRange(input.periodType, input.periodKey)
		if (!range)
			throw new SalesTargetError('periodKey tidak sesuai format periodType')

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

		const revenueTarget = Math.max(0, Number(input.revenueTarget) || 0)
		const dealCountTarget = Math.max(
			0,
			Math.floor(Number(input.dealCountTarget) || 0),
		)

		const compoundKey = {
			app_id: actor.appId,
			user_id: targetUserId,
			period_type: input.periodType,
			period_key: input.periodKey,
		}
		const previous = await prisma.sales_targets.findUnique({
			where: { app_id_user_id_period_type_period_key: compoundKey },
			select: { revenue_target: true, deal_count_target: true },
		})

		const row = await prisma.sales_targets.upsert({
			where: { app_id_user_id_period_type_period_key: compoundKey },
			create: {
				...compoundKey,
				revenue_target: revenueTarget,
				deal_count_target: dealCountTarget,
				set_by: actor.userId,
			},
			update: {
				revenue_target: revenueTarget,
				deal_count_target: dealCountTarget,
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
				periodKey: input.periodKey,
				previousRevenueTarget: previous
					? Number(previous.revenue_target)
					: null,
				revenueTarget,
				previousDealCountTarget: previous ? previous.deal_count_target : null,
				dealCountTarget,
			},
		})

		return {
			userId: row.user_id,
			periodType: row.period_type,
			periodKey: row.period_key,
			revenueTarget: Number(row.revenue_target),
			dealCountTarget: row.deal_count_target,
		}
	}
}
