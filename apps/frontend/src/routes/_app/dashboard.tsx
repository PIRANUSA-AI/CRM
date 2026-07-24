import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Activity,
	ArrowUpRight,
	Award,
	CheckSquare,
	Clock3,
	Gauge,
	Inbox,
	MessageCircle,
	Sparkles,
	Target,
	Trophy,
	TrendingUp,
	Users,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	CrmSectionHeader,
	CrmStatCard,
	CrmAvatar,
} from '@/components/crm/shared'
import {
	metrics,
	opportunities,
	personalInbox,
	salesProfiles,
	salesTargets,
	tasks,
	type OpportunityStats,
	type PersonalInboxConversation,
	type SalesProfileRow,
	type SalesTargetRow,
	type TaskSummary,
} from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import {
	getAppIdFromCookie,
	getOrgSlugFromCookie,
	syncOrganizationContextFromSession,
} from '@/lib/organization'

export const Route = createFileRoute('/_app/dashboard')({
	component: DashboardPage,
})

type DashboardRange = 'today' | '7d' | '30d'

type MetricValue = {
	value: number
	previous: number
	delta: number
	deltaPercent: number | null
}

type DashboardUiData = {
	cards: {
		incomingChats: MetricValue
		aiResolvedRate: MetricValue
		avgResponseSeconds: MetricValue
		revenue: MetricValue
		winRate: MetricValue
	}
	volume: Array<{
		date: string
		day: string
		ai: number
		cs: number
		handover: number
		total: number
	}>
	funnel: Array<{
		label: string
		value: number
		pct: number
	}>
	agents: Array<{
		id: string
		name: string
		chats: number
		csat: number
		revenue: number
		online: boolean
	}>
	alerts: Array<{
		id: string
		tone: 'success' | 'warning' | 'danger' | 'neutral'
		title: string
		description: string
	}>
	topDeals: Array<{
		id: string
		name: string
		product: string | null
		value: number
		status: string
		stage: string | null
		ownerName: string | null
		closedAt: string | null
	}>
	leaderboard: Array<{
		userId: string
		name: string
		revenue: number
		dealCount: number
	}>
}

const EMPTY_METRIC: MetricValue = {
	value: 0,
	previous: 0,
	delta: 0,
	deltaPercent: null,
}

const EMPTY_DASHBOARD: DashboardUiData = {
	cards: {
		incomingChats: EMPTY_METRIC,
		aiResolvedRate: EMPTY_METRIC,
		avgResponseSeconds: EMPTY_METRIC,
		revenue: EMPTY_METRIC,
		winRate: EMPTY_METRIC,
	},
	volume: [],
	funnel: [],
	agents: [],
	alerts: [],
	topDeals: [],
	leaderboard: [],
}

const RANGE_LABEL: Record<DashboardRange, string> = {
	today: 'Hari ini',
	'7d': '7 hari terakhir',
	'30d': '30 hari terakhir',
}

function toNumber(value: unknown, fallback = 0) {
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : fallback
}

function formatPeriodLabel(target: SalesTargetRow): string {
	const start = new Date(target.periodStart)
	if (Number.isNaN(start.getTime())) return ''
	const year = start.getUTCFullYear()
	if (target.periodType === 'annual') return String(year)
	if (target.periodType === 'quarterly') {
		return `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${year}`
	}
	return start.toLocaleDateString('id-ID', {
		month: 'long',
		year: 'numeric',
		timeZone: 'UTC',
	})
}

function metricFrom(value: unknown): MetricValue {
	if (!value || typeof value !== 'object') return EMPTY_METRIC
	const record = value as Record<string, unknown>
	return {
		value: toNumber(record.value),
		previous: toNumber(record.previous),
		delta: toNumber(record.delta),
		deltaPercent:
			record.deltaPercent === null || record.deltaPercent === undefined
				? null
				: toNumber(record.deltaPercent),
	}
}

function formatRupiah(value: number) {
	return `Rp ${Math.round(value).toLocaleString('id-ID')}`
}

function formatDeltaPercent(metric: MetricValue) {
	if (metric.deltaPercent === null) return 'Periode baru'
	const sign = metric.deltaPercent > 0 ? '+' : ''
	return `${sign}${metric.deltaPercent.toFixed(1)}%`
}

function formatDeltaValue(metric: MetricValue, suffix = '') {
	if (metric.delta === 0) return '0'
	const sign = metric.delta > 0 ? '+' : ''
	return `${sign}${metric.delta.toFixed(1)}${suffix}`
}

function formatRevenueDelta(metric: MetricValue) {
	if (metric.delta === 0) return 'Rp 0'
	const sign = metric.delta > 0 ? '+' : '-'
	return `${sign}${formatRupiah(Math.abs(metric.delta))}`
}

function positiveTone(metric: MetricValue) {
	if (metric.delta > 0) return 'success'
	if (metric.delta < 0) return 'danger'
	return 'neutral'
}

function responseTone(metric: MetricValue) {
	if (metric.delta < 0) return 'success'
	if (metric.delta > 0) return 'warning'
	return 'neutral'
}

function alertToneClass(tone: DashboardUiData['alerts'][number]['tone']) {
	if (tone === 'success') {
		return 'border-emerald-500/25 bg-emerald-500/10 text-emerald-500'
	}
	if (tone === 'warning') {
		return 'border-amber-500/25 bg-amber-500/10 text-amber-500'
	}
	if (tone === 'danger') {
		return 'border-red-500/25 bg-red-500/10 text-red-500'
	}
	return 'border-border bg-muted/40 text-foreground'
}

function normalizeDashboard(raw: any): DashboardUiData {
	const source = raw?.data || raw
	const dashboard = source?.source?.dashboard || source?.dashboard || {}
	const cards = dashboard?.cards || {}
	const volumeSource = Array.isArray(dashboard?.volume)
		? dashboard.volume
		: Array.isArray(source?.source?.daily)
			? source.source.daily
			: []

	return {
		cards: {
			incomingChats: metricFrom(cards.incomingChats),
			aiResolvedRate: metricFrom(cards.aiResolvedRate),
			avgResponseSeconds: metricFrom(cards.avgResponseSeconds),
			revenue: metricFrom(cards.revenue),
			winRate: metricFrom(cards.winRate),
		},
		volume: volumeSource.map((entry: any) => {
			const ai = toNumber(entry.ai)
			const cs = toNumber(entry.cs)
			const handover = toNumber(entry.handover)
			return {
				date: String(entry.date || entry.day || ''),
				day: String(entry.day || entry.date || ''),
				ai,
				cs,
				handover,
				total: toNumber(entry.total, ai + cs + handover),
			}
		}),
		funnel: Array.isArray(dashboard?.funnel)
			? dashboard.funnel.map((step: any) => ({
					label: String(step.label || ''),
					value: toNumber(step.value),
					pct: toNumber(step.pct),
				}))
			: [],
		agents: Array.isArray(dashboard?.agents)
			? dashboard.agents.map((agent: any) => ({
					id: String(agent.id || agent.name || ''),
					name: String(agent.name || 'Agent'),
					chats: toNumber(agent.chats),
					csat: toNumber(agent.csat),
					revenue: toNumber(agent.revenue),
					online: Boolean(agent.online),
				}))
			: [],
		alerts: Array.isArray(dashboard?.alerts)
			? dashboard.alerts.map((alert: any) => ({
					id: String(alert.id || alert.title || ''),
					tone: ['success', 'warning', 'danger', 'neutral'].includes(alert.tone)
						? alert.tone
						: 'neutral',
					title: String(alert.title || ''),
					description: String(alert.description || ''),
				}))
			: [],
		topDeals: Array.isArray(dashboard?.topDeals)
			? dashboard.topDeals.map((deal: any) => ({
					id: String(deal.id || ''),
					name: String(deal.name || 'Deal'),
					product: deal.product ? String(deal.product) : null,
					value: toNumber(deal.value),
					status: String(deal.status || 'open'),
					stage: deal.stage ? String(deal.stage) : null,
					ownerName: deal.ownerName ? String(deal.ownerName) : null,
					closedAt: deal.closedAt ? String(deal.closedAt) : null,
				}))
			: [],
		leaderboard: Array.isArray(dashboard?.leaderboard)
			? dashboard.leaderboard.map((row: any) => ({
					userId: String(row.userId || ''),
					name: String(row.name || 'Sales'),
					revenue: toNumber(row.revenue),
					dealCount: toNumber(row.dealCount),
				}))
			: [],
	}
}

function DashboardPage() {
	const navigate = useNavigate()
	const currentUser = useCurrentUser()
	const [data, setData] = useState<DashboardUiData>(EMPTY_DASHBOARD)
	const [loading, setLoading] = useState(true)
	const [contextReady, setContextReady] = useState(false)
	const [range, setRange] = useState<DashboardRange>('7d')
	const [error, setError] = useState<string | null>(null)
	const [targets, setTargets] = useState<SalesTargetRow[]>([])
	const [taskSummary, setTaskSummary] = useState<TaskSummary | null>(null)
	const [pipelineStats, setPipelineStats] = useState<OpportunityStats | null>(
		null,
	)
	const [needsReplyCount, setNeedsReplyCount] = useState(0)
	const [recentConversations, setRecentConversations] = useState<
		PersonalInboxConversation[]
	>([])
	const [salesCapacity, setSalesCapacity] = useState<SalesProfileRow[]>([])

	useEffect(() => {
		let mounted = true

		const ensureDashboardContext = async () => {
			if (typeof localStorage === 'undefined') {
				if (mounted) setContextReady(true)
				return
			}

			const orgName = localStorage.getItem('crm_org_name')
			const orgSlug =
				getOrgSlugFromCookie() || localStorage.getItem('crm_org_slug')
			const appId = getAppIdFromCookie() || localStorage.getItem('crm_app_id')

			if (orgName && orgSlug && appId) {
				if (mounted) setContextReady(true)
				return
			}

			try {
				const context = await syncOrganizationContextFromSession()
				if (!mounted) return

				if (!context.authenticated) {
					navigate({ to: '/login', replace: true })
					return
				}

				const syncedOrgName = localStorage.getItem('crm_org_name')
				const syncedOrgSlug =
					getOrgSlugFromCookie() || localStorage.getItem('crm_org_slug')
				const syncedAppId =
					getAppIdFromCookie() || localStorage.getItem('crm_app_id')

				if (
					context.organization &&
					syncedOrgName &&
					syncedOrgSlug &&
					syncedAppId
				) {
					setContextReady(true)
					return
				}
			} catch {
				// Redirect below keeps the existing onboarding recovery path.
			}

			navigate({ to: '/onboarding', replace: true })
		}

		ensureDashboardContext()
		return () => {
			mounted = false
		}
	}, [navigate])

	const loadDashboard = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const result = await metrics.getDashboard(range)
			if (!result?.success) {
				throw new Error('Failed to load dashboard')
			}
			setData(normalizeDashboard(result))
		} catch (currentError) {
			console.error('Failed to load dashboard:', currentError)
			setData(EMPTY_DASHBOARD)
			setError('Dashboard belum bisa memuat data dari API.')
		} finally {
			setLoading(false)
		}
	}, [range])

	useEffect(() => {
		if (!contextReady) return
		loadDashboard()
	}, [contextReady, loadDashboard])

	// Independent of `range`: yearly/monthly targets don't follow the
	// today/7d/30d activity filter above.
	useEffect(() => {
		if (!contextReady) return
		let mounted = true
		salesTargets
			.list()
			.then((result) => {
				if (mounted) setTargets(result?.data || [])
			})
			.catch((currentError) => {
				console.error('Failed to load sales targets:', currentError)
			})
		return () => {
			mounted = false
		}
	}, [contextReady])

	const isSales = currentUser?.role === 'sales'

	// Sales-only widgets (task/pipeline/inbox summaries) - not fetched for
	// other roles, which keep the operational widgets below instead.
	useEffect(() => {
		if (!contextReady || !isSales) return
		let mounted = true
		Promise.all([
			tasks.summary(),
			opportunities.stats(),
			personalInbox.needsReplyCount(),
			personalInbox.recentConversations(),
		])
			.then(([taskResult, pipelineResult, replyResult, recentResult]) => {
				if (!mounted) return
				setTaskSummary(taskResult?.data || null)
				setPipelineStats(pipelineResult?.payload || null)
				setNeedsReplyCount(replyResult?.count || 0)
				setRecentConversations((recentResult?.data || []).slice(0, 5))
			})
			.catch((currentError) => {
				console.error('Failed to load sales dashboard widgets:', currentError)
			})
		return () => {
			mounted = false
		}
	}, [contextReady, isSales])

	const isAdmin = currentUser?.role === 'administrator'
	const isCeo = currentUser?.role === 'ceo'

	// Administrator + CEO: capacity/team mapping for the team-comparison widget
	// (both roles) and the sales-capacity widget (administrator only). Reuses
	// GET /sales-profiles, which already carries activeLoad/maxActive/teamId/
	// teamName in one row per sales.
	useEffect(() => {
		if (!contextReady || !(isAdmin || isCeo)) return
		let mounted = true
		salesProfiles
			.list()
			.then((result) => {
				if (mounted) setSalesCapacity(result?.data || [])
			})
			.catch((currentError) => {
				console.error('Failed to load sales capacity:', currentError)
			})
		return () => {
			mounted = false
		}
	}, [contextReady, isAdmin, isCeo])

	const maxVolume = useMemo(() => {
		return Math.max(1, ...data.volume.map((row) => row.total))
	}, [data.volume])
	const hasVolume = data.volume.some((row) => row.total > 0)
	const hasFunnel = data.funnel.some((step) => step.value > 0)
	const hasAgents = data.agents.length > 0
	const yearTarget = targets.find(
		(t) => t.userId === currentUser?.id && t.periodType === 'annual',
	)
	const monthTarget = targets.find(
		(t) => t.userId === currentUser?.id && t.periodType === 'monthly',
	)

	const isLeader = currentUser?.role === 'leader'
	// `targets` already holds every visible row (self + team, for a leader) -
	// no separate fetch needed, just sum what's already been fetched for the
	// "Target Penjualan" widget above.
	const teamYearTargets = targets.filter((t) => t.periodType === 'annual')
	const teamMonthTargets = targets.filter((t) => t.periodType === 'monthly')
	const teamRollup = (rows: SalesTargetRow[]) =>
		rows.reduce(
			(acc, row) => ({
				targetRevenue: acc.targetRevenue + row.targetRevenue,
				revenueActual: acc.revenueActual + row.achievement.revenue,
				targetDeals: acc.targetDeals + row.targetDeals,
				dealCountActual: acc.dealCountActual + row.achievement.dealCount,
			}),
			{
				targetRevenue: 0,
				revenueActual: 0,
				targetDeals: 0,
				dealCountActual: 0,
			},
		)
	const teamYearRollup = teamRollup(teamYearTargets)
	const teamMonthRollup = teamRollup(teamMonthTargets)
	const teamMemberRows = [...teamMonthTargets].sort(
		(a, b) =>
			a.achievement.revenueProgressPercent -
			b.achievement.revenueProgressPercent,
	)

	// Team-name lookup per sales, reused for both the team-comparison rollup
	// and (implicitly) capacity grouping. A sales in more than one team only
	// shows up under the first one salesProfiles.list() reports.
	const teamNameByUserId = new Map(
		salesCapacity.map((row) => [row.userId, row.teamName || 'Tanpa Tim']),
	)
	const teamComparisonRows = (() => {
		const byTeam = new Map<
			string,
			{ teamName: string; targetRevenue: number; revenueActual: number }
		>()
		for (const row of teamMonthTargets) {
			const teamName = teamNameByUserId.get(row.userId) || 'Tanpa Tim'
			const entry = byTeam.get(teamName) || {
				teamName,
				targetRevenue: 0,
				revenueActual: 0,
			}
			entry.targetRevenue += row.targetRevenue
			entry.revenueActual += row.achievement.revenue
			byTeam.set(teamName, entry)
		}
		return [...byTeam.values()].sort((a, b) => {
			const pctA = a.targetRevenue > 0 ? a.revenueActual / a.targetRevenue : 0
			const pctB = b.targetRevenue > 0 ? b.revenueActual / b.targetRevenue : 0
			return pctB - pctA
		})
	})()
	const capacityRows = [...salesCapacity].sort((a, b) => {
		const capA = a.profile.maxActive || 20
		const capB = b.profile.maxActive || 20
		return b.activeLoad / capB - a.activeLoad / capA
	})

	if (!contextReady) return null

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Dashboard"
				subtitle={`${new Date().toLocaleDateString('id-ID', {
					weekday: 'long',
					day: '2-digit',
					month: 'long',
					year: 'numeric',
				})} · WIB · ${RANGE_LABEL[range]}`}
				actions={
					<>
						<div className="flex items-center rounded-lg border border-border bg-card p-1">
							{(['today', '7d', '30d'] as const).map((option) => (
								<button
									type="button"
									key={option}
									onClick={() => setRange(option)}
									className={`rounded-md px-3 py-1.5 text-xs font-semibold ${
										range === option
											? 'bg-primary/15 text-primary'
											: 'text-muted-foreground'
									}`}
								>
									{option.toUpperCase()}
								</button>
							))}
						</div>
						<button
							type="button"
							className="ocm-btn"
							onClick={loadDashboard}
							disabled={loading}
						>
							<Activity size={14} className={loading ? 'animate-spin' : ''} />
							Refresh
						</button>
					</>
				}
			/>

			{error ? (
				<div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-500">
					{error}
				</div>
			) : null}

			<div className={isSales ? 'ocm-grid-4' : 'ocm-grid-5'}>
				<CrmStatCard
					label="Chat masuk"
					value={
						loading
							? '...'
							: data.cards.incomingChats.value.toLocaleString('id-ID')
					}
					delta={formatDeltaPercent(data.cards.incomingChats)}
					deltaTone={positiveTone(data.cards.incomingChats)}
					icon={<Inbox size={16} className="text-primary" />}
				/>
				{isSales ? null : (
					<CrmStatCard
						label="AI resolved"
						value={
							loading ? '...' : `${data.cards.aiResolvedRate.value.toFixed(1)}%`
						}
						delta={formatDeltaValue(data.cards.aiResolvedRate, 'pp')}
						deltaTone={positiveTone(data.cards.aiResolvedRate)}
						icon={<Sparkles size={16} className="text-primary" />}
						subtitle="Target 75%"
					/>
				)}
				<CrmStatCard
					label="Avg response"
					value={
						loading
							? '...'
							: `${data.cards.avgResponseSeconds.value.toFixed(1)}s`
					}
					delta={formatDeltaValue(data.cards.avgResponseSeconds, 's')}
					deltaTone={responseTone(data.cards.avgResponseSeconds)}
					icon={<Clock3 size={16} className="text-primary" />}
				/>
				<CrmStatCard
					label={`Revenue ${range.toUpperCase()}`}
					value={loading ? '...' : formatRupiah(data.cards.revenue.value)}
					delta={formatRevenueDelta(data.cards.revenue)}
					deltaTone={positiveTone(data.cards.revenue)}
					icon={<TrendingUp size={16} className="text-primary" />}
				/>
				<CrmStatCard
					label="Win rate"
					value={loading ? '...' : `${data.cards.winRate.value.toFixed(1)}%`}
					delta={formatDeltaValue(data.cards.winRate, 'pp')}
					deltaTone={positiveTone(data.cards.winRate)}
					icon={<Award size={16} className="text-primary" />}
					subtitle="Deal won vs. closed"
				/>
			</div>

			{yearTarget || monthTarget ? (
				<section className="ocm-card">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title flex items-center gap-2">
							<Target size={16} className="text-primary" />
							Target Penjualan
						</h2>
					</div>
					<div className="ocm-card-body space-y-4">
						{[
							{ label: 'Tahunan', target: yearTarget },
							{ label: 'Bulanan', target: monthTarget },
						]
							.filter((row): row is { label: string; target: SalesTargetRow } =>
								Boolean(row.target),
							)
							.map(({ label, target }) => (
								<div key={target.periodType}>
									<div className="mb-1 flex items-center justify-between text-xs">
										<span className="font-semibold">
											Target {label} · {formatPeriodLabel(target)}
										</span>
										<span className="text-muted-foreground">
											{formatRupiah(target.achievement.revenue)} /{' '}
											{formatRupiah(target.targetRevenue)}
										</span>
									</div>
									<div className="ocm-progress-track">
										<div
											className="ocm-progress-bar"
											style={{
												width: `${Math.min(100, target.achievement.revenueProgressPercent)}%`,
											}}
										/>
									</div>
									<p className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
										<span>
											{target.achievement.dealCount} / {target.targetDeals}{' '}
											deal
										</span>
										<span>
											{target.achievement.revenueProgressPercent.toFixed(1)}%
										</span>
									</p>
								</div>
							))}
					</div>
				</section>
			) : null}

			{isLeader &&
			(teamYearTargets.length > 0 || teamMonthTargets.length > 0) ? (
				<div className="ocm-grid-2">
					<section className="ocm-card">
						<div className="ocm-card-header">
							<h2 className="ocm-card-title flex items-center gap-2">
								<Target size={16} className="text-primary" />
								Target Tim
							</h2>
						</div>
						<div className="ocm-card-body space-y-4">
							{[
								{
									label: 'Tahunan',
									rollup: teamYearRollup,
									count: teamYearTargets.length,
								},
								{
									label: 'Bulanan',
									rollup: teamMonthRollup,
									count: teamMonthTargets.length,
								},
							]
								.filter((row) => row.count > 0)
								.map(({ label, rollup }) => {
									const pct =
										rollup.targetRevenue > 0
											? Math.min(
													100,
													(rollup.revenueActual / rollup.targetRevenue) * 100,
												)
											: 0
									return (
										<div key={label}>
											<div className="mb-1 flex items-center justify-between text-xs">
												<span className="font-semibold">
													Target {label} Tim
												</span>
												<span className="text-muted-foreground">
													{formatRupiah(rollup.revenueActual)} /{' '}
													{formatRupiah(rollup.targetRevenue)}
												</span>
											</div>
											<div className="ocm-progress-track">
												<div
													className="ocm-progress-bar"
													style={{ width: `${pct}%` }}
												/>
											</div>
											<p className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
												<span>
													{rollup.dealCountActual} / {rollup.targetDeals}{' '}
													deal
												</span>
												<span>{pct.toFixed(1)}%</span>
											</p>
										</div>
									)
								})}
						</div>
					</section>

					<section className="ocm-card">
						<div className="ocm-card-header">
							<h2 className="ocm-card-title">Progress Anggota · Bulanan</h2>
						</div>
						<div className="ocm-card-body space-y-1">
							{teamMemberRows.length > 0 ? (
								teamMemberRows.map((row) => (
									<div key={row.userId} className="py-1.5">
										<div className="mb-1 flex items-center justify-between text-xs">
											<span className="font-semibold">
												{row.userName || 'Sales'}
											</span>
											<span className="text-muted-foreground">
												{row.achievement.revenueProgressPercent.toFixed(1)}%
											</span>
										</div>
										<div className="ocm-progress-track">
											<div
												className="ocm-progress-bar"
												style={{
													width: `${Math.min(100, row.achievement.revenueProgressPercent)}%`,
												}}
											/>
										</div>
									</div>
								))
							) : (
								<p className="py-8 text-center text-sm text-muted-foreground">
									Belum ada target bulanan yang di-set utk tim ini.
								</p>
							)}
						</div>
					</section>
				</div>
			) : null}

			{(isAdmin || isCeo) &&
			(teamComparisonRows.length > 0 || capacityRows.length > 0) ? (
				<div className="ocm-grid-2">
					<section className="ocm-card">
						<div className="ocm-card-header">
							<h2 className="ocm-card-title flex items-center gap-2">
								<Users size={16} className="text-primary" />
								Perbandingan Tim · Bulanan
							</h2>
						</div>
						<div className="ocm-card-body space-y-4">
							{teamComparisonRows.length > 0 ? (
								teamComparisonRows.map((team) => {
									const pct =
										team.targetRevenue > 0
											? Math.min(
													100,
													(team.revenueActual / team.targetRevenue) * 100,
												)
											: 0
									return (
										<div key={team.teamName}>
											<div className="mb-1 flex items-center justify-between text-xs">
												<span className="font-semibold">{team.teamName}</span>
												<span className="text-muted-foreground">
													{formatRupiah(team.revenueActual)} /{' '}
													{formatRupiah(team.targetRevenue)}
												</span>
											</div>
											<div className="ocm-progress-track">
												<div
													className="ocm-progress-bar"
													style={{ width: `${pct}%` }}
												/>
											</div>
											<p className="mt-1 text-right text-[11px] text-muted-foreground">
												{pct.toFixed(1)}%
											</p>
										</div>
									)
								})
							) : (
								<p className="py-8 text-center text-sm text-muted-foreground">
									Belum ada target bulanan yang di-set.
								</p>
							)}
						</div>
					</section>

					{isAdmin ? (
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title flex items-center gap-2">
									<Gauge size={16} className="text-primary" />
									Kapasitas Sales
								</h2>
								<a href="/kelola-tim" className="ocm-btn">
									<ArrowUpRight size={13} />
									Kelola Tim
								</a>
							</div>
							<div className="ocm-card-body space-y-1">
								{capacityRows.length > 0 ? (
									capacityRows.map((row) => {
										const cap = row.profile.maxActive || 20
										const overloaded = row.activeLoad >= cap
										const pct = Math.min(100, (row.activeLoad / cap) * 100)
										return (
											<div key={row.userId} className="py-1.5">
												<div className="mb-1 flex items-center justify-between text-xs">
													<span className="font-semibold">
														{row.name || row.email}
														{row.teamName ? (
															<span className="ml-1 font-normal text-muted-foreground">
																· {row.teamName}
															</span>
														) : null}
													</span>
													<span
														className={
															overloaded
																? 'font-semibold text-red-500'
																: 'text-muted-foreground'
														}
													>
														{row.activeLoad} / {cap}
													</span>
												</div>
												<div className="ocm-progress-track">
													<div
														className="ocm-progress-bar"
														style={{
															width: `${pct}%`,
															...(overloaded ? { background: '#ef4444' } : {}),
														}}
													/>
												</div>
											</div>
										)
									})
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Belum ada data kapasitas sales.
									</p>
								)}
							</div>
						</section>
					) : (
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title flex items-center gap-2">
									<Target size={16} className="text-primary" />
									Target Perusahaan
								</h2>
							</div>
							<div className="ocm-card-body space-y-4">
								{[
									{
										label: 'Tahunan',
										rollup: teamYearRollup,
										count: teamYearTargets.length,
									},
									{
										label: 'Bulanan',
										rollup: teamMonthRollup,
										count: teamMonthTargets.length,
									},
								]
									.filter((row) => row.count > 0)
									.map(({ label, rollup }) => {
										const pct =
											rollup.targetRevenue > 0
												? Math.min(
														100,
														(rollup.revenueActual / rollup.targetRevenue) * 100,
													)
												: 0
										return (
											<div key={label}>
												<div className="mb-1 flex items-center justify-between text-xs">
													<span className="font-semibold">
														Target {label} Perusahaan
													</span>
													<span className="text-muted-foreground">
														{formatRupiah(rollup.revenueActual)} /{' '}
														{formatRupiah(rollup.targetRevenue)}
													</span>
												</div>
												<div className="ocm-progress-track">
													<div
														className="ocm-progress-bar"
														style={{ width: `${pct}%` }}
													/>
												</div>
												<p className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
													<span>
														{rollup.dealCountActual} / {rollup.targetDeals}{' '}
														deal
													</span>
													<span>{pct.toFixed(1)}%</span>
												</p>
											</div>
										)
									})}
							</div>
						</section>
					)}
				</div>
			) : null}

			{data.topDeals.length > 0 || (!isSales && data.leaderboard.length > 0) ? (
				<div className="ocm-grid-2">
					<section className="ocm-card">
						<div className="ocm-card-header">
							<h2 className="ocm-card-title flex items-center gap-2">
								<Award size={16} className="text-primary" />
								Deal Terbesar · {RANGE_LABEL[range]}
							</h2>
						</div>
						<div className="ocm-card-body space-y-1">
							{data.topDeals.length > 0 ? (
								data.topDeals.map((deal) => (
									<div
										key={deal.id}
										className="flex items-center justify-between gap-2 py-1.5"
									>
										<div className="min-w-0 flex-1">
											<p className="truncate text-sm font-semibold">
												{deal.name}
											</p>
											<p className="truncate text-xs text-muted-foreground">
												{deal.product || '-'}
												{!isSales && deal.ownerName
													? ` · ${deal.ownerName}`
													: ''}
											</p>
										</div>
										<div className="shrink-0 text-right">
											<p className="text-sm font-semibold">
												{formatRupiah(deal.value)}
											</p>
											<span
												className={`ocm-tag ${deal.status === 'won' ? 'ocm-tag-success' : ''}`}
											>
												{deal.status === 'won' ? 'Won' : 'Open'}
											</span>
										</div>
									</div>
								))
							) : (
								<p className="py-8 text-center text-sm text-muted-foreground">
									Belum ada deal besar pada periode ini.
								</p>
							)}
						</div>
					</section>

					{isSales ? null : (
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title flex items-center gap-2">
									<Trophy size={16} className="text-primary" />
									Leaderboard Sales · {RANGE_LABEL[range]}
								</h2>
							</div>
							<div className="ocm-card-body overflow-x-auto">
								<table className="ocm-table">
									<thead>
										<tr>
											<th>Sales</th>
											<th>Deal Won</th>
											<th>Revenue</th>
										</tr>
									</thead>
									<tbody>
										{data.leaderboard.length > 0 ? (
											data.leaderboard.map((row, index) => (
												<tr key={row.userId}>
													<td>
														<div className="flex items-center gap-2">
															<span className="text-muted-foreground">
																#{index + 1}
															</span>
															<CrmAvatar name={row.name} size={22} />
															<span>{row.name}</span>
														</div>
													</td>
													<td>{row.dealCount}</td>
													<td>{formatRupiah(row.revenue)}</td>
												</tr>
											))
										) : (
											<tr>
												<td
													colSpan={3}
													className="py-8 text-center text-muted-foreground"
												>
													Belum ada deal won pada periode ini.
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</section>
					)}
				</div>
			) : null}

			{isSales ? (
				<>
					<div className="ocm-grid-2">
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title flex items-center gap-2">
									<CheckSquare size={16} className="text-primary" />
									Task Hari Ini
								</h2>
								<a href="/tasks" className="ocm-btn">
									<ArrowUpRight size={13} />
									Daftar Tugas
								</a>
							</div>
							<div className="ocm-card-body">
								{taskSummary ? (
									<div className="grid grid-cols-3 gap-3 text-center">
										<div>
											<p className="text-2xl font-bold text-red-500">
												{taskSummary.overdue}
											</p>
											<p className="text-xs text-muted-foreground">Overdue</p>
										</div>
										<div>
											<p className="text-2xl font-bold">{taskSummary.today}</p>
											<p className="text-xs text-muted-foreground">Hari ini</p>
										</div>
										<div>
											<p className="text-2xl font-bold text-emerald-500">
												{taskSummary.completedToday}
											</p>
											<p className="text-xs text-muted-foreground">Selesai</p>
										</div>
									</div>
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Memuat ringkasan task...
									</p>
								)}
							</div>
						</section>

						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title flex items-center gap-2">
									<TrendingUp size={16} className="text-primary" />
									Pipeline Saya
								</h2>
								<a href="/deals" className="ocm-btn">
									<ArrowUpRight size={13} />
									Deals
								</a>
							</div>
							<div className="ocm-card-body space-y-2">
								{pipelineStats ? (
									(
										[
											['prospek', 'Prospek'],
											['opportunity', 'Opportunity'],
											['won', 'Won'],
											['lost', 'Lost'],
										] as const
									).map(([key, label]) => (
										<div
											key={key}
											className="flex items-center justify-between text-xs"
										>
											<span className="font-semibold">{label}</span>
											<span className="text-muted-foreground">
												{pipelineStats[key].count} deal ·{' '}
												{formatRupiah(pipelineStats[key].value)}
											</span>
										</div>
									))
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Memuat pipeline...
									</p>
								)}
							</div>
						</section>
					</div>

					<div className="ocm-grid-2">
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title flex items-center gap-2">
									<MessageCircle size={16} className="text-primary" />
									Chat Butuh Respons
								</h2>
								<a href="/chat" className="ocm-btn">
									<ArrowUpRight size={13} />
									Kotak Masuk
								</a>
							</div>
							<div className="ocm-card-body flex flex-col items-center justify-center py-6">
								<p className="text-4xl font-bold text-primary">
									{needsReplyCount}
								</p>
								<p className="mt-1 text-xs text-muted-foreground">
									percakapan menunggu balasan Anda
								</p>
							</div>
						</section>

						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title">Aktivitas Terakhir</h2>
							</div>
							<div className="ocm-card-body space-y-1">
								{recentConversations.length > 0 ? (
									recentConversations.map((item) => (
										<a
											key={item.id}
											href="/chat"
											className="flex items-center gap-2 rounded-lg p-2 text-sm hover:bg-muted/40"
										>
											<CrmAvatar name={item.name} size={24} />
											<div className="min-w-0 flex-1">
												<p className="truncate font-semibold">{item.name}</p>
												<p className="truncate text-xs text-muted-foreground">
													{item.preview}
												</p>
											</div>
											{item.unread > 0 ? (
												<span className="ocm-tag">{item.unread}</span>
											) : null}
										</a>
									))
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Belum ada aktivitas percakapan.
									</p>
								)}
							</div>
						</section>
					</div>
				</>
			) : isCeo ? null : (
				<>
					<div className="ocm-grid-2">
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title">
									Chat Volume · {RANGE_LABEL[range]}
								</h2>
								<div className="flex items-center gap-1 text-[11px]">
									<span className="ocm-tag">AI</span>
									<span className="ocm-tag">CS</span>
									<span className="ocm-tag">Handover</span>
								</div>
							</div>
							<div className="ocm-card-body space-y-3">
								{loading ? (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Memuat volume chat...
									</p>
								) : hasVolume ? (
									data.volume.map((row) => {
										const pct = (row.total / maxVolume) * 100
										return (
											<div key={row.date || row.day}>
												<div className="mb-1 flex items-center justify-between text-xs">
													<span className="font-semibold">{row.day}</span>
													<span className="text-muted-foreground">
														{row.total.toLocaleString('id-ID')}
													</span>
												</div>
												<div className="ocm-progress-track">
													<div
														className="ocm-progress-bar"
														style={{ width: `${pct}%` }}
													/>
												</div>
											</div>
										)
									})
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Belum ada volume chat pada periode ini.
									</p>
								)}
							</div>
						</section>

						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title">Funnel Penjualan</h2>
								<span className="ocm-tag">{RANGE_LABEL[range]}</span>
							</div>
							<div className="ocm-card-body space-y-2">
								{loading ? (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Memuat funnel...
									</p>
								) : hasFunnel ? (
									data.funnel.map((step, index) => {
										const next = data.funnel[index + 1]
										const drop =
											next && step.value > 0
												? Math.max(
														0,
														Math.round((1 - next.value / step.value) * 100),
													)
												: 0
										return (
											<div key={step.label}>
												<div className="mb-1 flex items-center justify-between text-xs">
													<span>{step.label}</span>
													<span className="text-muted-foreground">
														{step.value.toLocaleString('id-ID')} ·{' '}
														{step.pct.toFixed(1)}%
													</span>
												</div>
												<div className="ocm-progress-track">
													<div
														className="ocm-progress-bar"
														style={{ width: `${Math.min(100, step.pct)}%` }}
													/>
												</div>
												{next ? (
													<p className="mt-1 text-right text-[11px] text-muted-foreground">
														Drop {drop}%
													</p>
												) : null}
											</div>
										)
									})
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Belum ada data funnel pada periode ini.
									</p>
								)}
							</div>
						</section>
					</div>

					<div className="ocm-grid-2">
						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title">
									CS Performance · {RANGE_LABEL[range]}
								</h2>
								<button type="button" className="ocm-btn">
									<ArrowUpRight size={13} />
									Detail
								</button>
							</div>
							<div className="ocm-card-body overflow-x-auto">
								<table className="ocm-table">
									<thead>
										<tr>
											<th>Agent</th>
											<th>Chats</th>
											<th>CSAT</th>
											<th>Revenue</th>
										</tr>
									</thead>
									<tbody>
										{loading ? (
											<tr>
												<td
													colSpan={4}
													className="py-8 text-center text-muted-foreground"
												>
													Memuat performa agent...
												</td>
											</tr>
										) : hasAgents ? (
											data.agents.map((row) => (
												<tr key={row.id || row.name}>
													<td>
														<div className="flex items-center gap-2">
															<CrmAvatar
																name={row.name}
																online={row.online}
																size={24}
															/>
															<span>{row.name}</span>
														</div>
													</td>
													<td>{row.chats.toLocaleString('id-ID')}</td>
													<td>{row.csat > 0 ? row.csat.toFixed(1) : '-'}</td>
													<td>{formatRupiah(row.revenue)}</td>
												</tr>
											))
										) : (
											<tr>
												<td
													colSpan={4}
													className="py-8 text-center text-muted-foreground"
												>
													Belum ada performa agent pada periode ini.
												</td>
											</tr>
										)}
									</tbody>
								</table>
							</div>
						</section>

						<section className="ocm-card">
							<div className="ocm-card-header">
								<h2 className="ocm-card-title">Operational Alerts</h2>
							</div>
							<div className="ocm-card-body space-y-3 text-sm">
								{loading ? (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Memuat alert operasional...
									</p>
								) : data.alerts.length > 0 ? (
									data.alerts.map((alert) => (
										<div
											key={alert.id || alert.title}
											className={`rounded-lg border p-3 ${alertToneClass(alert.tone)}`}
										>
											<p className="font-semibold">{alert.title}</p>
											<p className="text-xs text-muted-foreground">
												{alert.description}
											</p>
										</div>
									))
								) : (
									<p className="py-8 text-center text-sm text-muted-foreground">
										Belum ada alert untuk periode ini.
									</p>
								)}
							</div>
						</section>
					</div>
				</>
			)}
		</main>
	)
}
