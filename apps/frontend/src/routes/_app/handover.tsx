import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Clock3, Handshake, ShieldCheck, RefreshCw } from 'lucide-react'
import { type ReactNode, useMemo, useState, useEffect, useCallback } from 'react'
import { CrmAvatar, CrmSectionHeader } from '@/components/crm/shared'
import { handover, type HandoverQueueItem, type HandoverRuleItem, type AgentRosterItem, type HandoverAnalytics, type HandoverLogItem } from '@/lib/api'
import { syncOrganizationContextFromSession } from '@/lib/organization'
import { connectSocket } from '@/lib/socket'
import { extractNormalizedRole } from '@/lib/role-access'

async function loadInitialHandoverData() {
	try {
		await syncOrganizationContextFromSession()
	} catch {
		// Let layout/session guard continue resolving auth state.
	}

	try {
		const [queue, rules, roster, analytics] = await Promise.all([
			handover.getQueue(),
			handover.getRules(),
			handover.getRoster(),
			handover.getAnalytics('24h'),
		])

		return {
			queue,
			rules,
			roster,
			analytics,
		}
	} catch (error) {
		console.error('Failed to preload handover data:', error)
		return {
			queue: { success: true, payload: [] as HandoverQueueItem[] },
			rules: { success: true, payload: [] as HandoverRuleItem[] },
			roster: { success: true, payload: [] as AgentRosterItem[] },
			analytics: { success: true, payload: null as HandoverAnalytics | null },
		}
	}
}

export const Route = createFileRoute('/_app/handover')({
	component: HandoverPage,
	loader: loadInitialHandoverData,
	ssr: false,
})

type HandoverTab = 'queue' | 'rules' | 'roster' | 'logs'

function formatWaitTime(seconds: number): string {
	const mins = Math.floor(seconds / 60)
	const secs = seconds % 60
	if (mins > 0) {
		return `${mins}m ${secs}s`
	}
	return `${secs}s`
}

function formatSlaCountdown(slaDueAt: string | undefined): { text: string; isOverdue: boolean } {
	if (!slaDueAt) return { text: 'N/A', isOverdue: false }
	const due = new Date(slaDueAt).getTime()
	const now = Date.now()
	const diff = due - now
	const isOverdue = diff < 0
	const absDiff = Math.abs(diff)
	const mins = Math.floor(absDiff / (1000 * 60))
	const secs = Math.floor((absDiff % (1000 * 60)) / 1000)
	const text = isOverdue ? `+${mins}m ${secs}s` : `${mins}m ${secs}s`
	return { text, isOverdue }
}

function statusTagClass(status: AgentRosterItem['status']) {
	if (status === 'online') return 'ocm-tag ocm-tag-success'
	if (status === 'break') return 'ocm-tag ocm-tag-warning'
	return 'ocm-tag'
}

function priorityAccentClass(priority: HandoverQueueItem['priority']) {
	if (priority === 'urgent') return 'bg-red-500/80'
	if (priority === 'high') return 'bg-cyan-500/80'
	return 'bg-zinc-400/70'
}

function waitToneClass(priority: HandoverQueueItem['priority'], isOverdue: boolean) {
	if (isOverdue) return 'text-red-500'
	if (priority === 'urgent') return 'text-red-500'
	if (priority === 'high') return 'text-cyan-500'
	return 'text-foreground'
}

function MetricCard({
	label,
	value,
	delta,
	subtitle,
	icon,
	deltaTone,
}: {
	label: string
	value: string
	delta?: string
	subtitle?: string
	icon: ReactNode
	deltaTone?: 'success' | 'neutral'
}) {
	return (
		<div className="ocm-card p-4">
			<div className="mb-2 flex items-center justify-between gap-2">
				<p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
				{icon}
			</div>
			<p className="text-3xl font-semibold leading-none tracking-tight">{value}</p>
			{delta && (
				<div className="mt-2 flex items-center justify-between gap-2">
					<p
						className={`text-xs font-semibold ${
							deltaTone === 'success' ? 'text-emerald-500' : 'text-muted-foreground'
						}`}
					>
						{delta}
					</p>
					{subtitle && <p className="text-[11px] text-muted-foreground">{subtitle}</p>}
				</div>
			)}
		</div>
	)
}

function QueueRow({
	item,
	onAmbil,
	onReassign,
	onApprove,
	onReject,
	canApprove,
}: {
	item: HandoverQueueItem
	onAmbil: () => void
	onReassign: () => void
	onApprove?: () => void
	onReject?: () => void
	canApprove: boolean
}) {
	const [now, setNow] = useState(Date.now())
	const waitingSeconds = Math.floor((now - new Date(item.createdAt).getTime()) / 1000)
	const sla = formatSlaCountdown(item.slaDueAt)

	useEffect(() => {
		const interval = setInterval(() => setNow(Date.now()), 1000)
		return () => clearInterval(interval)
	}, [])

	const currentWaiting = item.waitingSeconds + waitingSeconds
	const waitDisplay = formatWaitTime(currentWaiting)
	const isOverdue = sla.isOverdue

	return (
		<div
			className={`grid grid-cols-[minmax(0,1fr)_220px_88px_130px_176px] items-center border-b border-border px-4 py-3 text-sm last:border-b-0 ${
				item.priority === 'urgent' ? 'bg-red-500/[0.04]' : ''
			}`}
		>
			<div className="flex min-w-0 items-center gap-2.5">
				<div className={`h-10 w-1 rounded-full ${priorityAccentClass(item.priority)}`} />
				<CrmAvatar name={item.contactName} size={34} />
				<div className="min-w-0">
					<div className="truncate text-[13px] font-semibold">{item.contactName}</div>
					<div className="text-[11px] text-muted-foreground">{item.contactPhone}</div>
					<div className="truncate text-[11px] italic text-muted-foreground">
						&quot;{item.preview}&quot;
					</div>
				</div>
			</div>

			<div>
				<div className="text-[11px] leading-4">{item.reason}</div>
				<div className="mt-1 text-[10px] text-muted-foreground">
					intent: {item.intent} · conf {item.aiConfidence.toFixed(2)}
				</div>
			</div>

			<div className={`text-xs font-semibold ${waitToneClass(item.priority, isOverdue)}`}>
				{waitDisplay}
			</div>

			<div className="flex items-center gap-2">
				{item.suggestedAgentName && (
					<>
						<CrmAvatar name={item.suggestedAgentName} size={20} online={item.priority !== 'urgent'} />
						<span className="truncate text-[11px]">{item.suggestedAgentName}</span>
					</>
				)}
			</div>

			<div className="flex justify-end gap-2">
				{item.approvalState === 'pending' ? (
					canApprove ? (
						<>
							<button
								type="button"
								className="ocm-btn h-8 px-3 text-[11px]"
								onClick={onReject}
							>
								Reject
							</button>
							<button
								type="button"
								className="ocm-btn ocm-btn-primary h-8 px-3 text-[11px]"
								onClick={onApprove}
							>
								Approve
							</button>
						</>
					) : (
						<>
							<button type="button" className="ocm-btn h-8 px-3 text-[11px]" onClick={onReassign}>
								Reassign
							</button>
							<button
								type="button"
								className="ocm-btn ocm-btn-primary h-8 px-3 text-[11px]"
								onClick={onAmbil}
							>
								Ambil
							</button>
						</>
					)
				) : (
					<span className={`ocm-tag ${item.approvalState === 'approved' ? 'ocm-tag-success' : 'ocm-tag-danger'}`}>
						{item.approvalState}
					</span>
				)}
			</div>
		</div>
	)
}

function QueueTab({ queue, onRefresh, onAction }: { queue: HandoverQueueItem[]; onRefresh: () => void; onAction: (id: string, action: 'ambil' | 'reassign' | 'approve' | 'reject') => void }) {
	const urgentCount = useMemo(() => queue.filter((i) => i.priority === 'urgent').length, [queue])

	return (
		<section className="ocm-card overflow-hidden">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<span className="text-xs font-semibold text-muted-foreground">
					{queue.length} tickets · {urgentCount} urgent
				</span>
				<button
					type="button"
					className="ocm-btn ocm-btn-secondary h-7 px-2 text-[11px]"
					onClick={onRefresh}
				>
					<RefreshCw size={12} className="mr-1" />
					Refresh
				</button>
			</div>
			<div className="overflow-x-auto">
				<div className="min-w-[1100px]">
					<div className="grid grid-cols-[minmax(0,1fr)_220px_88px_130px_176px] border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
						<div>Customer</div>
						<div>Reason</div>
						<div>Wait</div>
						<div>Suggested</div>
						<div className="text-right">Action</div>
					</div>
					{queue.map((item) => (
						<QueueRow
							key={item.id}
							item={item}
							onAmbil={() => onAction(item.id, 'ambil')}
							onReassign={() => onAction(item.id, 'reassign')}
							onApprove={() => onAction(item.id, 'approve')}
							onReject={() => onAction(item.id, 'reject')}
							canApprove={true}
						/>
					))}
					{queue.length === 0 && (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							No tickets in handover queue
						</div>
					)}
				</div>
			</div>
		</section>
	)
}

function RulesTab({ rules, onRefresh }: { rules: HandoverRuleItem[]; onRefresh: () => void }) {
	return (
		<section className="ocm-card overflow-hidden">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<span className="text-xs font-semibold text-muted-foreground">
					{rules.length} escalation rules
				</span>
				<button
					type="button"
					className="ocm-btn ocm-btn-secondary h-7 px-2 text-[11px]"
					onClick={onRefresh}
				>
					<RefreshCw size={12} className="mr-1" />
					Refresh
				</button>
			</div>
			{rules.map((rule) => (
				<div
					key={rule.id}
					className="grid items-center gap-3 border-b border-border px-4 py-3 text-xs last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_90px_70px]"
				>
					<div>
						<span className="font-semibold text-primary">IF</span> {JSON.stringify(rule.conditions)}
					</div>
					<div>
						<span className="font-semibold text-emerald-500">THEN</span> {rule.action}
					</div>
					<div className="text-muted-foreground">{rule.triggered7d} × 7d</div>
					<div className="flex justify-end">
						<div
							className={`relative h-4 w-8 rounded-full ${
								rule.isActive ? 'bg-emerald-500' : 'bg-muted'
							}`}
						>
							<div
								className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${
									rule.isActive ? 'left-[17px]' : 'left-0.5'
								}`}
							/>
						</div>
					</div>
				</div>
			))}
			{rules.length === 0 && (
				<div className="px-4 py-8 text-center text-sm text-muted-foreground">
					No escalation rules configured
				</div>
			)}
		</section>
	)
}

function RosterTab({ roster, onRefresh }: { roster: AgentRosterItem[]; onRefresh: () => void }) {
	const onlineCount = useMemo(() => roster.filter((a) => a.status === 'online').length, [roster])

	return (
		<div>
			<div className="mb-4 flex items-center justify-between">
				<span className="text-xs font-semibold text-muted-foreground">
					{roster.length} agents · {onlineCount} online
				</span>
				<button
					type="button"
					className="ocm-btn ocm-btn-secondary h-7 px-2 text-[11px]"
					onClick={onRefresh}
				>
					<RefreshCw size={12} className="mr-1" />
					Refresh
				</button>
			</div>
			<div className="ocm-grid-4">
				{roster.map((agent) => {
					const loadPct = Math.min(100, Math.round((agent.activeChats / agent.capacity) * 100))
					return (
						<section key={agent.id} className="ocm-card p-3">
							<div className="mb-3 flex items-start gap-2">
								<CrmAvatar name={agent.name} size={34} online={agent.status === 'online'} />
								<div className="min-w-0 flex-1">
									<div className="truncate text-[13px] font-semibold">{agent.name}</div>
									<div className="text-[11px] text-muted-foreground">{agent.role}</div>
								</div>
								<span className={statusTagClass(agent.status)}>{agent.status}</span>
							</div>

							<div className="mb-1 flex items-center justify-between text-[11px]">
								<span className="text-muted-foreground">
									Load {agent.activeChats}/{agent.capacity}
								</span>
								<span className="font-medium">{loadPct}%</span>
							</div>
							<div className="ocm-progress-track">
								<div
									className="ocm-progress-bar"
									style={{
										width: `${loadPct}%`,
										background: loadPct > 80 ? 'var(--ocm-danger)' : 'var(--ocm-success)',
									}}
								/>
							</div>

							<div className="mt-3 flex flex-wrap gap-1">
								{agent.skills.map((skill) => (
									<span key={`${agent.id}-${skill}`} className="ocm-tag">
										{skill}
									</span>
								))}
							</div>
						</section>
					)
				})}
			</div>
		</div>
	)
}

function LogsTab({ logs, onRefresh }: { logs: HandoverLogItem[]; onRefresh: () => void }) {
	return (
		<section className="ocm-card overflow-hidden">
			<div className="flex items-center justify-between border-b border-border px-4 py-3">
				<span className="text-xs font-semibold text-muted-foreground">
					{logs.length} log entries
				</span>
				<button
					type="button"
					className="ocm-btn ocm-btn-secondary h-7 px-2 text-[11px]"
					onClick={onRefresh}
				>
					<RefreshCw size={12} className="mr-1" />
					Refresh
				</button>
			</div>
			<div className="max-h-[600px] overflow-y-auto">
				{logs.map((log) => (
					<div key={log.id} className="border-b border-border px-4 py-2 text-xs last:border-b-0">
						<div className="flex items-center gap-2">
							<span className="font-semibold">{log.action}</span>
							<span className="text-muted-foreground">by {log.actorName || log.actorId}</span>
							{log.targetName && <span className="text-muted-foreground">→ {log.targetName}</span>}
						</div>
						<div className="text-[10px] text-muted-foreground">
							{new Date(log.createdAt).toLocaleString()}
						</div>
					</div>
				))}
				{logs.length === 0 && (
					<div className="px-4 py-8 text-center text-sm text-muted-foreground">
						No handover activity logs
					</div>
				)}
			</div>
		</section>
	)
}

function HandoverPage() {
	const initialData = Route.useLoaderData()

	const [tab, setTab] = useState<HandoverTab>('queue')

	const [currentRole, setCurrentRole] = useState('')

	useEffect(() => {
		if (typeof localStorage === 'undefined') return
		const stored = localStorage.getItem('crm_user')
		if (!stored) return
		try {
			const parsed = JSON.parse(stored) as any
			const candidate =
				parsed && typeof parsed.user === 'object' && parsed.user
					? parsed.user
					: parsed
			if (!candidate || typeof candidate !== 'object') return
			setCurrentRole(extractNormalizedRole(candidate))
		} catch {
			// ignore invalid local storage
		}
	}, [])

	const [queue, setQueue] = useState<HandoverQueueItem[]>(initialData.queue?.payload || [])
	const [rules, setRules] = useState<HandoverRuleItem[]>(initialData.rules?.payload || [])
	const [roster, setRoster] = useState<AgentRosterItem[]>(initialData.roster?.payload || [])
	const [analytics, setAnalytics] = useState<HandoverAnalytics | null>(initialData.analytics?.payload || null)
	const [logs, setLogs] = useState<HandoverLogItem[]>([])
	const [loading, setLoading] = useState(false)
	const [isConnected, setIsConnected] = useState(false)

	const fetchData = useCallback(async () => {
		setLoading(true)
		try {
			const [queueRes, rulesRes, rosterRes, analyticsRes, logsRes] = await Promise.all([
				handover.getQueue(),
				handover.getRules(),
				handover.getRoster(),
				handover.getAnalytics('24h'),
				handover.getLogs({ limit: 50 }),
			])

			if (queueRes.success) setQueue(queueRes.payload)
			if (rulesRes.success) setRules(rulesRes.payload)
			if (rosterRes.success) setRoster(rosterRes.payload)
			if (analyticsRes.success) setAnalytics(analyticsRes.payload)
			if (logsRes.success) setLogs(logsRes.payload)
		} catch (error) {
			console.error('Failed to fetch handover data:', error)
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		fetchData()
	}, [fetchData])

	useEffect(() => {
		const socket = connectSocket()

		const handleConnect = () => setIsConnected(true)
		const handleDisconnect = () => setIsConnected(false)

		socket.on('connect', handleConnect)
		socket.on('disconnect', handleDisconnect)

		if (socket.connected) {
			setIsConnected(true)
		}

		const handleHandoverEvent = () => {
			fetchData()
		}

		socket.on('handover:request_created', handleHandoverEvent)
		socket.on('handover:request_approved', handleHandoverEvent)
		socket.on('handover:request_rejected', handleHandoverEvent)
		socket.on('handover:queue_updated', handleHandoverEvent)

		return () => {
			socket.off('connect', handleConnect)
			socket.off('disconnect', handleDisconnect)
			socket.off('handover:request_created', handleHandoverEvent)
			socket.off('handover:request_approved', handleHandoverEvent)
			socket.off('handover:request_rejected', handleHandoverEvent)
			socket.off('handover:queue_updated', handleHandoverEvent)
		}
	}, [fetchData])

	useEffect(() => {
		const pollInterval = setInterval(() => {
			if (!isConnected) {
				fetchData()
			}
		}, 15000)

		return () => clearInterval(pollInterval)
	}, [isConnected, fetchData])

	const handleAction = async (id: string, action: 'ambil' | 'reassign' | 'approve' | 'reject') => {
		try {
			switch (action) {
				case 'approve':
					await handover.approveRequest(id)
					break
				case 'reject':
					await handover.rejectRequest(id)
					break
				case 'ambil':
					await handover.createRequest({ conversationId: id, requestType: 'take' })
					break
				case 'reassign':
					await handover.createRequest({ conversationId: id, requestType: 'reassign' })
					break
			}
			await fetchData()
		} catch (error) {
			console.error(`Failed to ${action} request:`, error)
		}
	}

	const urgentCount = useMemo(() => queue.filter((i) => i.priority === 'urgent').length, [queue])
	const onlineCount = useMemo(() => roster.filter((a) => a.status === 'online').length, [roster])

	const tabs = useMemo(
		() =>
			[
				{ id: 'queue' as const, label: `Active Queue · ${queue.length}` },
				{ id: 'rules' as const, label: `Escalation Rules · ${rules.length}` },
				{ id: 'roster' as const, label: `CS Roster · ${onlineCount} online` },
				{ id: 'logs' as const, label: `Handover Logs` },
			],
		[queue.length, rules.length, onlineCount],
	)

	const visibleTabs = currentRole === 'sales' ? tabs.filter((item) => item.id === 'queue') : tabs

	const formatAvgWaitTime = (seconds: number): string => {
		const mins = Math.floor(seconds / 60)
		const secs = seconds % 60
		if (mins > 0) return `${mins}m ${secs}s`
		return `${secs}s`
	}

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Handover Queue"
				subtitle="AI → Manusia · SLA 5 menit"
				actions={
					<>
						{loading && <RefreshCw size={14} className="animate-spin text-muted-foreground" />}
						<span className="ocm-tag ocm-tag-danger">{urgentCount} urgent</span>
						<span className="ocm-tag">{queue.length} waiting</span>
						<span className="ocm-tag ocm-tag-success">{onlineCount} CS online</span>
					</>
				}
			/>

			{analytics && (
				<div className="ocm-grid-4">
					<MetricCard
						label="Handover rate (24h)"
						value={`${analytics.handoverRate}%`}
						delta={analytics.handoverRate < 20 ? '-2.4pp' : '+2.4pp'}
						subtitle="Target < 20%"
						icon={<Handshake size={14} className="text-primary" />}
						deltaTone="success"
					/>
					<MetricCard
						label="Avg wait time"
						value={formatAvgWaitTime(analytics.avgWaitTimeSeconds)}
						delta="-32s"
						icon={<Clock3 size={14} className="text-primary" />}
						deltaTone="success"
					/>
					<MetricCard
						label="SLA compliance"
						value={`${analytics.slaCompliance}%`}
						delta="+1.8pp"
						icon={<ShieldCheck size={14} className="text-primary" />}
						deltaTone="success"
					/>
					<MetricCard
						label="CSAT post-handover"
						value={analytics.csatPostHandover.toFixed(1)}
						delta="+0.2"
						subtitle="dari 5"
						icon={<CheckCircle2 size={14} className="text-primary" />}
						deltaTone="success"
					/>
				</div>
			)}

			<div className="flex w-fit items-center rounded-lg border border-border bg-card p-1">
				{visibleTabs.map((item) => (
					<button
						type="button"
						key={item.id}
						onClick={() => setTab(item.id)}
						className={`rounded-md px-3 py-1.5 text-xs font-semibold transition ${
							tab === item.id ? 'bg-primary/15 text-primary' : 'text-muted-foreground'
						}`}
					>
						{item.label}
					</button>
				))}
			</div>

			{tab === 'queue' && (
				<QueueTab queue={queue} onRefresh={fetchData} onAction={handleAction} />
			)}
			{tab === 'rules' && <RulesTab rules={rules} onRefresh={fetchData} />}
			{tab === 'roster' && <RosterTab roster={roster} onRefresh={fetchData} />}
			{tab === 'logs' && <LogsTab logs={logs} onRefresh={fetchData} />}
		</main>
	)
}
