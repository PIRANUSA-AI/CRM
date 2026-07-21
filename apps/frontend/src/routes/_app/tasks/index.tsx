import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	CheckCircle2,
	Circle,
	Mail,
	MessageCircle,
	RefreshCw,
	TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { isSupervisorRole } from '@/lib/role-access'
import {
	tasks,
	type Task,
	type TaskActionKind,
	type TaskListParams,
	type TaskPriority,
} from '@/lib/api'

export const Route = createFileRoute('/_app/tasks/')({
	component: TasksPage,
})

type TaskTab = 'active' | 'today' | 'overdue' | 'done'

const TAB_OPTIONS: Array<{ value: TaskTab; label: string }> = [
	{ value: 'active', label: 'Semua aktif' },
	{ value: 'today', label: 'Hari ini' },
	{ value: 'overdue', label: 'Terlambat' },
	{ value: 'done', label: 'Selesai' },
]

// Checkbox · Tugas · Kontak · Tenggat · Prioritas · Sales — the same table
// language as Kontak, Perusahaan and Alih Tugas.
const COLUMNS = 'grid-cols-[32px_minmax(0,1.8fr)_minmax(0,1fr)_150px_110px_130px]'

function listParamsFor(tab: TaskTab): TaskListParams {
	if (tab === 'active') return { view: 'all', limit: 100 }
	return { view: tab, limit: 100 }
}

const PRIORITY_DOT: Record<TaskPriority, string> = {
	low: 'bg-slate-400',
	medium: 'bg-sky-500',
	high: 'bg-amber-500',
	urgent: 'bg-red-500',
}

const PRIORITY_LABEL: Record<TaskPriority, string> = {
	low: 'Rendah',
	medium: 'Sedang',
	high: 'Tinggi',
	urgent: 'Mendesak',
}

const ACTION_LABEL: Record<TaskActionKind, string> = {
	reply_now: 'Balas sekarang',
	follow_up: 'Tindak lanjut',
	qualify_lead: 'Kualifikasi lead',
	handover_review: 'Tinjau handover',
	prospect_followup: 'Prospek',
	manual: 'Tugas manual',
}

const PROSPECT_CHANNEL_LABEL: Record<string, string> = {
	event: 'Event',
	linkedin: 'LinkedIn',
	instagram: 'Instagram',
	whatsapp: 'WhatsApp',
	referral: 'Referral',
	other: 'Lainnya',
}

/** A small tag describing where the task came from. */
function sourceBadge(task: Task): { label: string; tone: string } | null {
	if (task.source === 'prospect') {
		const snap = task.aiSnapshot as { prospect?: { channel?: string } } | null
		const channel = snap?.prospect?.channel
		const label = channel ? PROSPECT_CHANNEL_LABEL[channel] || 'Prospek' : 'Prospek'
		return { label: `Prospek · ${label}`, tone: 'bg-violet-500/10 text-violet-600 dark:text-violet-300' }
	}
	if (task.source === 'routing') {
		return { label: 'Handoff', tone: 'bg-amber-500/10 text-amber-700 dark:text-amber-300' }
	}
	if (task.source === 'manual') {
		return { label: 'Manual', tone: 'bg-slate-500/10 text-slate-600 dark:text-slate-300' }
	}
	if (task.source === 'ai_whatsapp') {
		return { label: 'WhatsApp', tone: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300' }
	}
	return null
}

type DueBucket = 'overdue' | 'today' | 'tomorrow' | 'week' | 'later' | 'none'

const BUCKET_ORDER: DueBucket[] = ['overdue', 'today', 'tomorrow', 'week', 'later', 'none']

const BUCKET_LABEL: Record<DueBucket, string> = {
	overdue: 'Terlambat',
	today: 'Hari ini',
	tomorrow: 'Besok',
	week: 'Minggu ini',
	later: 'Nanti',
	none: 'Tanpa tenggat',
}

function bucketFor(task: Task, now: Date): DueBucket {
	if (!task.dueAt) return 'none'
	const due = new Date(task.dueAt).getTime()
	if (Number.isNaN(due)) return 'none'
	const startToday = new Date(now)
	startToday.setHours(0, 0, 0, 0)
	const startTomorrow = new Date(startToday)
	startTomorrow.setDate(startTomorrow.getDate() + 1)
	const startDayAfter = new Date(startTomorrow)
	startDayAfter.setDate(startDayAfter.getDate() + 1)
	const startNextWeek = new Date(startToday)
	startNextWeek.setDate(startNextWeek.getDate() + 7)

	if (due < startToday.getTime()) return 'overdue'
	if (due < startTomorrow.getTime()) return 'today'
	if (due < startDayAfter.getTime()) return 'tomorrow'
	if (due < startNextWeek.getTime()) return 'week'
	return 'later'
}

function formatDateTime(value: string | null) {
	if (!value) return 'Tanpa tenggat'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return 'Tanpa tenggat'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

function TasksPage() {
	const navigate = useNavigate()
	const currentUser = useCurrentUser()
	const isLeader = isSupervisorRole(currentUser?.role)
	const [tab, setTab] = useState<TaskTab>('active')
	const [taskItems, setTaskItems] = useState<Task[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [processingId, setProcessingId] = useState<string | null>(null)
	const [assigneeFilter, setAssigneeFilter] = useState('')

	const openDetail = useCallback(
		(id: string) => navigate({ to: '/tasks/$taskId', params: { taskId: id } }),
		[navigate],
	)

	const loadTasks = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const list = await tasks.list(listParamsFor(tab))
			setTaskItems(list.data)
		} catch (reason) {
			setTaskItems([])
			setError(
				reason instanceof Error ? reason.message : 'Daftar tugas belum dapat dimuat.',
			)
		} finally {
			setLoading(false)
		}
	}, [tab])

	useEffect(() => {
		void loadTasks()
	}, [loadTasks])

	// Completion is manual: the sales ticks the checkbox when a task is done.
	// Start happens automatically (on open / on reply), so there is no start button.
	const completeTask = useCallback(
		async (task: Task) => {
			setProcessingId(task.id)
			setError(null)
			try {
				await tasks.complete(task.id)
				await loadTasks()
			} catch (reason) {
				setError(
					reason instanceof Error ? reason.message : 'Status tugas belum dapat diperbarui.',
				)
			} finally {
				setProcessingId(null)
			}
		},
		[loadTasks],
	)

	const now = useMemo(() => new Date(), [taskItems])

	const assigneeOptions = useMemo(() => {
		const map = new Map<string, { name: string; total: number; overdue: number }>()
		for (const task of taskItems) {
			const key = task.assigneeId || 'unassigned'
			const entry = map.get(key) || {
				name: task.assigneeName || 'Belum ditugaskan',
				total: 0,
				overdue: 0,
			}
			entry.total += 1
			if (
				task.status !== 'done' &&
				task.status !== 'cancelled' &&
				task.dueAt != null &&
				new Date(task.dueAt).getTime() < now.getTime()
			) {
				entry.overdue += 1
			}
			map.set(key, entry)
		}
		return [...map.entries()]
			.map(([id, value]) => ({ id, ...value }))
			.sort((a, b) => b.overdue - a.overdue || b.total - a.total)
	}, [taskItems, now])

	// A leader's list spans the whole team, so it is narrowed with a picker
	// instead of the per-sales headings it used to grow. Headings only labelled
	// the rows; a leader chasing one person's backlog wants the others gone.
	const visibleTasks = useMemo(
		() =>
			assigneeFilter
				? taskItems.filter((task) => (task.assigneeId || 'unassigned') === assigneeFilter)
				: taskItems,
		[taskItems, assigneeFilter],
	)

	const overdueCount = useMemo(
		() =>
			visibleTasks.filter(
				(task) =>
					task.status !== 'done' &&
					task.status !== 'cancelled' &&
					task.dueAt != null &&
					new Date(task.dueAt).getTime() < now.getTime(),
			).length,
		[visibleTasks, now],
	)

	// Group active views by due bucket; the "done" view stays a flat list.
	const grouped = useMemo(() => {
		if (tab === 'done') return null
		const map = new Map<DueBucket, Task[]>()
		for (const task of visibleTasks) {
			const bucket = bucketFor(task, now)
			const list = map.get(bucket) || []
			list.push(task)
			map.set(bucket, list)
		}
		return BUCKET_ORDER.map((bucket) => ({ bucket, items: map.get(bucket) || [] })).filter(
			(group) => group.items.length > 0,
		)
	}, [tab, visibleTasks, now])

	const renderRow = useCallback(
		(task: Task) => {
			const done = task.status === 'done' || task.status === 'cancelled'
			const isProcessing = processingId === task.id
			const overdue = !done && task.dueAt != null && new Date(task.dueAt).getTime() < now.getTime()
			const badge = sourceBadge(task)
			const waHref = task.contactPhone
				? `https://wa.me/${task.contactPhone.replace(/[^0-9]/g, '')}`
				: null
			const mailHref = task.contactEmail ? `mailto:${task.contactEmail}` : null
			return (
				<div
					key={task.id}
					role="button"
					tabIndex={0}
					onClick={() => openDetail(task.id)}
					onKeyDown={(event) => {
						if (event.key === 'Enter') openDetail(task.id)
					}}
					className={`grid ${COLUMNS} cursor-pointer items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40`}
				>
					{/* The tick completes the task; it must not also open the detail. */}
					<div onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
						<button
							type="button"
							disabled={done || isProcessing}
							onClick={() => void completeTask(task)}
							className="rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
							title={done ? 'Selesai' : 'Tandai selesai'}
							aria-label={done ? 'Selesai' : 'Tandai selesai'}
						>
							{done ? (
								<CheckCircle2 size={18} className="text-emerald-500" />
							) : (
								<Circle
									size={18}
									className={
										isProcessing
											? 'animate-pulse text-emerald-500'
											: 'text-muted-foreground hover:text-emerald-500'
									}
								/>
							)}
						</button>
					</div>

					<div className="min-w-0 pr-3">
						<p
							className={`truncate text-sm font-semibold ${
								done ? 'text-muted-foreground line-through' : ''
							}`}
						>
							{task.title}
						</p>
						<p className="truncate text-[11px] text-muted-foreground">
							{[ACTION_LABEL[task.actionKind], badge?.label, task.teamName]
								.filter(Boolean)
								.join(' · ')}
						</p>
					</div>

					<div className="min-w-0 text-xs text-muted-foreground">
						<p className="truncate">{task.contactName || task.contactPhone || '—'}</p>
						{!done && (waHref || mailHref) ? (
							<span
								className="mt-0.5 flex items-center gap-1.5"
								onClick={(event) => event.stopPropagation()}
								onKeyDown={(event) => event.stopPropagation()}
							>
								{waHref ? (
									<a
										href={waHref}
										target="_blank"
										rel="noreferrer"
										title="Buka WhatsApp"
										className="text-emerald-600 hover:text-emerald-500 dark:text-emerald-300"
									>
										<MessageCircle size={13} />
									</a>
								) : null}
								{mailHref ? (
									<a
										href={mailHref}
										title="Kirim email"
										className="text-sky-600 hover:text-sky-500 dark:text-sky-300"
									>
										<Mail size={13} />
									</a>
								) : null}
							</span>
						) : null}
					</div>

					<div
						className={`text-xs ${overdue ? 'font-semibold text-red-600 dark:text-red-300' : 'text-muted-foreground'}`}
					>
						{formatDateTime(task.dueAt)}
						{overdue ? ' · terlambat' : ''}
					</div>

					<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
						<span className={`size-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`} />
						{PRIORITY_LABEL[task.priority]}
					</div>

					<div className="truncate text-xs text-muted-foreground">
						{task.assigneeName || 'Belum ditugaskan'}
					</div>
				</div>
			)
		},
		[completeTask, openDetail, processingId, now],
	)


	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Daftar Tugas"
				subtitle={
					isLeader
						? 'Pantau tugas tiap sales di timmu — siapa mengerjakan apa dan mana yang terlambat.'
						: 'Ceklis tindak lanjut lead & percakapan yang butuh aksi sales.'
				}
				actions={
					<button
						type="button"
						className="ocm-btn"
						onClick={() => void loadTasks()}
						disabled={loading}
					>
						<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
						Refresh
					</button>
				}
			/>

			<div className="ocm-grid-3">
				<section className="ocm-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Tugas di tampilan ini</p>
					<p className="mt-1 text-2xl font-semibold">{visibleTasks.length}</p>
				</section>
				<section className="ocm-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Terlambat</p>
					<p
						className={`mt-1 text-2xl font-semibold ${
							overdueCount > 0 ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground'
						}`}
					>
						{overdueCount}
					</p>
				</section>
				<section className="ocm-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Mendesak</p>
					<p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-300">
						{visibleTasks.filter((task) => task.priority === 'urgent').length}
					</p>
				</section>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{TAB_OPTIONS.map((option) => (
					<button
						key={option.value}
						type="button"
						onClick={() => setTab(option.value)}
						className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
							tab === option.value
								? 'border-primary/40 bg-primary/15 text-primary'
								: 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
						}`}
					>
						{option.label}
					</button>
				))}

				{isLeader && assigneeOptions.length > 1 ? (
					<select
						value={assigneeFilter}
						onChange={(event) => setAssigneeFilter(event.target.value)}
						className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					>
						<option value="">Semua sales</option>
						{assigneeOptions.map((option) => (
							<option key={option.id} value={option.id}>
								{option.name} ({option.total}
								{option.overdue > 0 ? `, ${option.overdue} terlambat` : ''})
							</option>
						))}
					</select>
				) : null}

				{tab !== 'active' || assigneeFilter ? (
					<button
						type="button"
						onClick={() => {
							setTab('active')
							setAssigneeFilter('')
						}}
						className="rounded-full px-2 py-1.5 text-[11px] font-semibold text-muted-foreground underline hover:text-foreground"
					>
						Reset
					</button>
				) : null}
			</div>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={18} className="mt-0.5 shrink-0" />
					<div>
						<p>{error}</p>
						<button
							type="button"
							className="mt-1 font-semibold underline"
							onClick={() => void loadTasks()}
						>
							Coba lagi
						</button>
					</div>
				</div>
			) : null}

			<section className="ocm-card overflow-hidden">
				<div className="ocm-card-header">
					<span className="ocm-card-title">Daftar Tugas</span>
					<span className="text-xs text-muted-foreground">
						{loading ? 'Memuat...' : `${visibleTasks.length} tugas`}
					</span>
				</div>

				{loading ? (
					<div className="space-y-2 p-3">
						{Array.from({ length: 4 }).map((_, index) => (
							<div key={index} className="h-14 animate-pulse rounded-lg bg-muted/60" />
						))}
					</div>
				) : taskItems.length === 0 ? (
					<div className="p-4">
						<CrmEmptyState
							title="Belum ada tugas"
							description="Tidak ada tugas pada tampilan ini. Tugas muncul dari lead yang diimpor/di-assign, prospek yang kamu tambahkan, dan percakapan WhatsApp yang butuh aksi."
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[900px]">
							<div
								className={`grid ${COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
							>
								<div />
								<div>Tugas</div>
								<div>Kontak</div>
								<div>Tenggat</div>
								<div>Prioritas</div>
								<div>Sales</div>
							</div>
							{/* Grouped by due bucket while a deadline view is active; the
							    "Selesai" tab is a flat list because a finished task's bucket
							    describes when it was due, not anything you can act on. */}
							{grouped
								? grouped.map((group) => (
										<div key={group.bucket}>
											<div className="flex items-center justify-between border-b border-border bg-muted/30 px-4 py-1.5">
												<span className="text-[10px] font-bold uppercase tracking-[0.1em] text-muted-foreground">
													{BUCKET_LABEL[group.bucket]}
												</span>
												<span className="text-xs text-muted-foreground">
													{group.items.length}
												</span>
											</div>
											{group.items.map(renderRow)}
										</div>
									))
								: visibleTasks.map(renderRow)}
						</div>
					</div>
				)}
			</section>
		</main>
	)
}
