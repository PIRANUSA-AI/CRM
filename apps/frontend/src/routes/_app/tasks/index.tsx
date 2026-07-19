import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	CheckCircle2,
	Circle,
	Clock3,
	Clock8,
	Mail,
	MessageCircle,
	RefreshCw,
	TriangleAlert,
	UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import {
	tasks,
	type Task,
	type TaskActionKind,
	type TaskListParams,
	type TaskPriority,
	type TaskStatus,
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

const STATUS_LABEL: Record<TaskStatus, string> = {
	open: 'Belum dimulai',
	in_progress: 'Sedang dikerjakan',
	done: 'Selesai',
	cancelled: 'Dibatalkan',
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

/** Tomorrow 09:00 ISO — used by the "Tunda 1 hari" quick action. */
function tomorrowMorningISO(): string {
	const d = new Date()
	d.setDate(d.getDate() + 1)
	d.setHours(9, 0, 0, 0)
	return d.toISOString()
}

function TasksPage() {
	const navigate = useNavigate()
	const [tab, setTab] = useState<TaskTab>('active')
	const [taskItems, setTaskItems] = useState<Task[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [processingId, setProcessingId] = useState<string | null>(null)

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

	const snoozeTask = useCallback(
		async (task: Task) => {
			setProcessingId(task.id)
			setError(null)
			try {
				await tasks.snooze(task.id, tomorrowMorningISO(), 'Ditunda 1 hari dari daftar tugas')
				await loadTasks()
			} catch (reason) {
				setError(
					reason instanceof Error ? reason.message : 'Tugas belum dapat ditunda.',
				)
			} finally {
				setProcessingId(null)
			}
		},
		[loadTasks],
	)

	const now = useMemo(() => new Date(), [taskItems])

	// Group active views by due bucket; the "done" view stays a flat list.
	const grouped = useMemo(() => {
		if (tab === 'done') return null
		const map = new Map<DueBucket, Task[]>()
		for (const task of taskItems) {
			const bucket = bucketFor(task, now)
			const list = map.get(bucket) || []
			list.push(task)
			map.set(bucket, list)
		}
		return BUCKET_ORDER.map((bucket) => ({ bucket, items: map.get(bucket) || [] })).filter(
			(group) => group.items.length > 0,
		)
	}, [tab, taskItems, now])

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
				<li key={task.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">
					{/* Checkbox */}
					<button
						type="button"
						disabled={done || isProcessing}
						onClick={() => void completeTask(task)}
						className="mt-0.5 shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
						title={done ? 'Selesai' : 'Tandai selesai'}
						aria-label={done ? 'Selesai' : 'Tandai selesai'}
					>
						{done ? (
							<CheckCircle2 size={20} className="text-emerald-500" />
						) : (
							<Circle
								size={20}
								className={`${isProcessing ? 'animate-pulse text-emerald-500' : 'text-muted-foreground hover:text-emerald-500'}`}
							/>
						)}
					</button>

					{/* Content */}
					<div className="min-w-0 flex-1">
						<button
							type="button"
							onClick={() => openDetail(task.id)}
							className="block w-full text-left"
						>
							<div className="flex items-center gap-2">
								<span
									className={`h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority]}`}
									title={`Prioritas: ${PRIORITY_LABEL[task.priority]}`}
								/>
								<h3
									className={`truncate text-sm font-semibold ${
										done ? 'text-muted-foreground line-through' : 'hover:underline'
									}`}
								>
									{task.title}
								</h3>
							</div>
							<div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-4 text-xs text-muted-foreground">
								<span className="rounded bg-muted px-1.5 py-0.5 font-medium">
									{ACTION_LABEL[task.actionKind]}
								</span>
								{badge ? (
									<span className={`rounded px-1.5 py-0.5 font-medium ${badge.tone}`}>
										{badge.label}
									</span>
								) : null}
								<span className="inline-flex items-center gap-1">
									<UserRound size={13} />
									{task.contactName || task.contactPhone || 'Kontak belum tersedia'}
								</span>
								<span
									className={`inline-flex items-center gap-1 ${overdue ? 'font-semibold text-red-500' : ''}`}
								>
									<Clock3 size={13} />
									{formatDateTime(task.dueAt)}
									{overdue ? ' · terlambat' : ''}
								</span>
								{!done ? (
									<span className="text-muted-foreground/80">{STATUS_LABEL[task.status]}</span>
								) : null}
							</div>
						</button>

						{/* Quick actions */}
						{!done ? (
							<div className="mt-2 flex flex-wrap items-center gap-2 pl-4">
								{waHref ? (
									<a
										href={waHref}
										target="_blank"
										rel="noreferrer"
										className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-300"
									>
										<MessageCircle size={13} /> WhatsApp
									</a>
								) : null}
								{mailHref ? (
									<a
										href={mailHref}
										className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-sky-600 hover:bg-sky-500/10 dark:text-sky-300"
									>
										<Mail size={13} /> Email
									</a>
								) : null}
								<button
									type="button"
									onClick={() => void snoozeTask(task)}
									disabled={isProcessing}
									className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
								>
									<Clock8 size={13} /> Tunda 1 hari
								</button>
							</div>
						) : null}
					</div>
				</li>
			)
		},
		[completeTask, snoozeTask, openDetail, processingId, now],
	)

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Daftar Tugas"
				subtitle="Ceklis tindak lanjut lead & percakapan yang butuh aksi sales."
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
				{/* Tabs */}
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border p-2">
					{TAB_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setTab(option.value)}
							className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
								tab === option.value
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{option.label}
						</button>
					))}
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
				) : grouped ? (
					<div className="divide-y divide-border">
						{grouped.map((group) => (
							<div key={group.bucket}>
								<div className="flex items-center justify-between bg-muted/30 px-4 py-1.5">
									<span className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
										{BUCKET_LABEL[group.bucket]}
									</span>
									<span className="text-xs text-muted-foreground">{group.items.length}</span>
								</div>
								<ul className="divide-y divide-border">{group.items.map(renderRow)}</ul>
							</div>
						))}
					</div>
				) : (
					<ul className="divide-y divide-border">{taskItems.map(renderRow)}</ul>
				)}
			</section>
		</main>
	)
}
