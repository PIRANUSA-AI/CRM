import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Activity,
	ArrowUpRight,
	Clock3,
	Inbox,
	Sparkles,
	TrendingUp,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	CrmSectionHeader,
	CrmStatCard,
	CrmAvatar,
} from '@/components/crm/shared'
import { metrics } from '@/lib/api'
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
	},
	volume: [],
	funnel: [],
	agents: [],
	alerts: [],
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
	}
}

function DashboardPage() {
	const navigate = useNavigate()
	const [data, setData] = useState<DashboardUiData>(EMPTY_DASHBOARD)
	const [loading, setLoading] = useState(true)
	const [contextReady, setContextReady] = useState(false)
	const [range, setRange] = useState<DashboardRange>('7d')
	const [error, setError] = useState<string | null>(null)

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
			const appId =
				getAppIdFromCookie() || localStorage.getItem('crm_app_id')

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

	const maxVolume = useMemo(() => {
		return Math.max(1, ...data.volume.map((row) => row.total))
	}, [data.volume])
	const hasVolume = data.volume.some((row) => row.total > 0)
	const hasFunnel = data.funnel.some((step) => step.value > 0)
	const hasAgents = data.agents.length > 0

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


			<div className="ocm-grid-4">
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
				<CrmStatCard
					label="AI resolved"
					value={
						loading
							? '...'
							: `${data.cards.aiResolvedRate.value.toFixed(1)}%`
					}
					delta={formatDeltaValue(data.cards.aiResolvedRate, 'pp')}
					deltaTone={positiveTone(data.cards.aiResolvedRate)}
					icon={<Sparkles size={16} className="text-primary" />}
					subtitle="Target 75%"
				/>
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
			</div>

			<div className="ocm-grid-2">
				<section className="ocm-card">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title">Chat Volume · {RANGE_LABEL[range]}</h2>
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
										? Math.max(0, Math.round((1 - next.value / step.value) * 100))
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
						<h2 className="ocm-card-title">CS Performance · {RANGE_LABEL[range]}</h2>
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
										<td colSpan={4} className="py-8 text-center text-muted-foreground">
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
										<td colSpan={4} className="py-8 text-center text-muted-foreground">
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
		</main>
	)
}
