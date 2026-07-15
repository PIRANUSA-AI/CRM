import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	CheckCircle2,
	CirclePlay,
	Clock3,
	ListTodo,
	MessageCircle,
	RefreshCw,
	SendHorizontal,
	Sparkles,
	TimerReset,
	TriangleAlert,
	UserRound,
	X,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
	CrmEmptyState,
	CrmSectionHeader,
	CrmStatCard,
} from '@/components/crm/shared'
import {
	tasks,
	type Task,
	type TaskActionKind,
	type TaskPriority,
	type TaskStatus,
} from '@/lib/api'

export const Route = createFileRoute('/_app/tasks')({
	component: TasksPage,
})

type TaskView = 'today' | 'overdue' | 'done' | 'all'

const VIEW_OPTIONS: Array<{ value: TaskView; label: string }> = [
	{ value: 'today', label: 'Hari ini' },
	{ value: 'overdue', label: 'Terlambat' },
	{ value: 'done', label: 'Selesai' },
	{ value: 'all', label: 'Semua' },
]

const PRIORITY_STYLE: Record<TaskPriority, string> = {
	low: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
	medium: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
	high: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
	urgent: 'bg-red-500/10 text-red-700 dark:text-red-300',
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
	manual: 'Tugas manual',
}

type AiSnapshot = {
	suggestedReply?: string | null
	summary?: string | null
	evidence?: string[]
	leadSignal?: string | null
}

function readSnapshot(task: Task): AiSnapshot {
	const snapshot = task.aiSnapshot
	if (!snapshot || typeof snapshot !== 'object') return {}
	return snapshot as AiSnapshot
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

function snoozePresets(): Array<{ label: string; iso: string }> {
	const now = new Date()
	const inHours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString()
	const tomorrow9 = new Date(now)
	tomorrow9.setDate(tomorrow9.getDate() + 1)
	tomorrow9.setHours(9, 0, 0, 0)
	return [
		{ label: '+1 jam', iso: inHours(1) },
		{ label: '+3 jam', iso: inHours(3) },
		{ label: 'Besok 09:00', iso: tomorrow9.toISOString() },
	]
}

function TasksPage() {
	const navigate = useNavigate()
	const [view, setView] = useState<TaskView>('today')
	const [taskItems, setTaskItems] = useState<Task[]>([])
	const [summary, setSummary] = useState({ today: 0, overdue: 0, completedToday: 0 })
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [processingId, setProcessingId] = useState<string | null>(null)

	// Detail panel
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [replyDraft, setReplyDraft] = useState('')
	const [detailBusy, setDetailBusy] = useState<null | 'reply' | 'snooze' | 'start' | 'complete'>(null)
	const [detailError, setDetailError] = useState<string | null>(null)

	const selected = useMemo(
		() => taskItems.find((task) => task.id === selectedId) || null,
		[taskItems, selectedId],
	)

	const loadTasks = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const [list, nextSummary] = await Promise.all([
				tasks.list({ view, limit: 100 }),
				tasks.summary(),
			])
			setTaskItems(list.data)
			setSummary(nextSummary.data)
		} catch (reason) {
			setTaskItems([])
			setError(
				reason instanceof Error ? reason.message : 'Daftar tugas belum dapat dimuat.',
			)
		} finally {
			setLoading(false)
		}
	}, [view])

	useEffect(() => {
		void loadTasks()
	}, [loadTasks])

	const openDetail = useCallback((task: Task) => {
		setSelectedId(task.id)
		setDetailError(null)
		setReplyDraft(readSnapshot(task).suggestedReply || '')
	}, [])

	const closeDetail = useCallback(() => {
		setSelectedId(null)
		setReplyDraft('')
		setDetailError(null)
		setDetailBusy(null)
	}, [])

	const quickStatus = useCallback(
		async (task: Task, action: 'start' | 'complete') => {
			setProcessingId(task.id)
			setError(null)
			try {
				if (action === 'start') await tasks.start(task.id)
				else await tasks.complete(task.id)
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

	const runDetailAction = useCallback(
		async (kind: 'reply' | 'snooze' | 'start' | 'complete', arg?: string) => {
			if (!selected) return
			setDetailBusy(kind)
			setDetailError(null)
			try {
				if (kind === 'reply') {
					if (!replyDraft.trim()) throw new Error('Balasan tidak boleh kosong')
					await tasks.replyWhatsapp(selected.id, replyDraft.trim())
				} else if (kind === 'snooze') {
					await tasks.snooze(selected.id, arg as string)
				} else if (kind === 'start') {
					await tasks.start(selected.id)
				} else if (kind === 'complete') {
					await tasks.complete(selected.id)
				}
				await loadTasks()
				if (kind !== 'start') closeDetail()
			} catch (reason) {
				setDetailError(
					reason instanceof Error ? reason.message : 'Aksi tugas gagal diproses.',
				)
			} finally {
				setDetailBusy(null)
			}
		},
		[selected, replyDraft, loadTasks, closeDetail],
	)

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Daftar Tugas"
				subtitle="Tindak lanjuti percakapan WhatsApp yang membutuhkan aksi sales."
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

			<div className="ocm-grid-3">
				<CrmStatCard
					label="Tugas hari ini"
					value={loading ? '...' : summary.today.toLocaleString('id-ID')}
					icon={<ListTodo size={16} className="text-primary" />}
				/>
				<CrmStatCard
					label="Terlambat"
					value={loading ? '...' : summary.overdue.toLocaleString('id-ID')}
					icon={<TriangleAlert size={16} className="text-amber-500" />}
				/>
				<CrmStatCard
					label="Selesai hari ini"
					value={loading ? '...' : summary.completedToday.toLocaleString('id-ID')}
					icon={<CheckCircle2 size={16} className="text-emerald-500" />}
				/>
			</div>

			<section className="ocm-card overflow-hidden">
				<div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
					<div>
						<h2 className="text-base font-semibold">Tugas sales</h2>
						<p className="text-sm text-muted-foreground">
							Klik tugas untuk melihat detail dan membalas via WhatsApp.
						</p>
					</div>
					<div className="flex w-full items-center gap-1 overflow-x-auto rounded-lg border border-border bg-muted/30 p-1 sm:w-auto">
						{VIEW_OPTIONS.map((option) => (
							<button
								key={option.value}
								type="button"
								onClick={() => setView(option.value)}
								className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
									view === option.value
										? 'bg-primary/15 text-primary'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								{option.label}
							</button>
						))}
					</div>
				</div>

				{loading ? (
					<div className="space-y-3 p-4">
						{Array.from({ length: 3 }).map((_, index) => (
							<div key={index} className="h-28 animate-pulse rounded-lg bg-muted/60" />
						))}
					</div>
				) : taskItems.length === 0 ? (
					<div className="p-4">
						<CrmEmptyState
							title="Belum ada tugas"
							description="Tidak ada tugas yang sesuai dengan tampilan ini. Tugas dari WhatsApp akan muncul setelah lead terkonfirmasi dan dianalisis."
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{taskItems.map((task) => {
							const isProcessing = processingId === task.id
							return (
								<li key={task.id} className="p-4">
									<div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
										<button
											type="button"
											onClick={() => openDetail(task)}
											className="min-w-0 flex-1 text-left"
										>
											<div className="mb-2 flex flex-wrap items-center gap-2">
												<span
													className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[task.priority]}`}
												>
													{PRIORITY_LABEL[task.priority]}
												</span>
												<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
													{ACTION_LABEL[task.actionKind]}
												</span>
												<span className="text-xs text-muted-foreground">
													{STATUS_LABEL[task.status]}
												</span>
											</div>
											<h3 className="text-base font-semibold hover:underline">{task.title}</h3>
											{task.description ? (
												<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
													{task.description}
												</p>
											) : null}
											<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
												<span className="inline-flex items-center gap-1">
													<UserRound size={14} />
													{task.contactName || task.contactPhone || 'Kontak belum tersedia'}
												</span>
												<span className="inline-flex items-center gap-1">
													<Clock3 size={14} />
													{formatDateTime(task.dueAt)}
												</span>
											</div>
										</button>

										<div className="flex shrink-0 flex-wrap gap-2">
											{task.conversationId ? (
												<button
													type="button"
													className="ocm-btn"
													onClick={() => openDetail(task)}
												>
													<Sparkles size={15} />
													Balas
												</button>
											) : null}
											{task.status === 'open' ? (
												<button
													type="button"
													className="ocm-btn"
													onClick={() => void quickStatus(task, 'start')}
													disabled={isProcessing}
												>
													<CirclePlay size={15} />
													Mulai
												</button>
											) : null}
											{task.status === 'open' || task.status === 'in_progress' ? (
												<button
													type="button"
													className="ocm-btn bg-emerald-600 text-white hover:bg-emerald-700"
													onClick={() => void quickStatus(task, 'complete')}
													disabled={isProcessing}
												>
													<CheckCircle2 size={15} />
													{isProcessing ? '...' : 'Selesai'}
												</button>
											) : null}
										</div>
									</div>
								</li>
							)
						})}
					</ul>
				)}
			</section>

			{selected ? (
				<TaskDetailModal
					task={selected}
					replyDraft={replyDraft}
					setReplyDraft={setReplyDraft}
					busy={detailBusy}
					error={detailError}
					onClose={closeDetail}
					onReply={() => void runDetailAction('reply')}
					onSnooze={(iso) => void runDetailAction('snooze', iso)}
					onStart={() => void runDetailAction('start')}
					onComplete={() => void runDetailAction('complete')}
					onOpenChat={() => {
						closeDetail()
						navigate({ to: '/chat' })
					}}
				/>
			) : null}
		</main>
	)
}

function TaskDetailModal({
	task,
	replyDraft,
	setReplyDraft,
	busy,
	error,
	onClose,
	onReply,
	onSnooze,
	onStart,
	onComplete,
	onOpenChat,
}: {
	task: Task
	replyDraft: string
	setReplyDraft: (value: string) => void
	busy: null | 'reply' | 'snooze' | 'start' | 'complete'
	error: string | null
	onClose: () => void
	onReply: () => void
	onSnooze: (iso: string) => void
	onStart: () => void
	onComplete: () => void
	onOpenChat: () => void
}) {
	const snapshot = readSnapshot(task)
	const isActive = task.status === 'open' || task.status === 'in_progress'
	const canReply = Boolean(task.conversationId) && isActive

	return (
		<div className="fixed inset-0 z-[130] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4">
			<div className="flex max-h-[92vh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-card text-card-foreground shadow-xl sm:rounded-2xl">
				<div className="flex items-start justify-between gap-3 border-b border-border p-4">
					<div className="min-w-0">
						<div className="mb-1 flex flex-wrap items-center gap-2">
							<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[task.priority]}`}>
								{PRIORITY_LABEL[task.priority]}
							</span>
							<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
								{ACTION_LABEL[task.actionKind]}
							</span>
							<span className="text-xs text-muted-foreground">{STATUS_LABEL[task.status]}</span>
						</div>
						<h3 className="text-base font-semibold">{task.title}</h3>
					</div>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1.5 text-muted-foreground hover:bg-muted"
						aria-label="Tutup"
					>
						<X size={18} />
					</button>
				</div>

				<div className="flex-1 space-y-4 overflow-y-auto p-4">
					<div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
						<span className="inline-flex items-center gap-1">
							<UserRound size={14} />
							{task.contactName || task.contactPhone || 'Kontak belum tersedia'}
						</span>
						<span className="inline-flex items-center gap-1">
							<Clock3 size={14} />
							{formatDateTime(task.dueAt)}
						</span>
					</div>

					{snapshot.summary ? (
						<div className="rounded-lg border border-border bg-muted/30 p-3">
							<p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
								Ringkasan AI
							</p>
							<p className="text-sm">{snapshot.summary}</p>
						</div>
					) : task.description ? (
						<div className="rounded-lg border border-border bg-muted/30 p-3">
							<p className="text-sm">{task.description}</p>
						</div>
					) : null}

					{Array.isArray(snapshot.evidence) && snapshot.evidence.length > 0 ? (
						<div>
							<p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
								Kutipan pesan customer
							</p>
							<ul className="space-y-1">
								{snapshot.evidence.map((item, index) => (
									<li
										key={index}
										className="rounded-md bg-muted/50 px-2 py-1 text-sm italic text-muted-foreground"
									>
										“{item}”
									</li>
								))}
							</ul>
						</div>
					) : null}

					{task.conversationId ? (
						<div>
							<p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-muted-foreground">
								<Sparkles size={13} /> Draf balasan (bisa diedit)
							</p>
							<textarea
								value={replyDraft}
								onChange={(event) => setReplyDraft(event.target.value)}
								rows={5}
								placeholder="Tulis balasan untuk customer..."
								className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
					) : (
						<p className="text-sm text-muted-foreground">
							Task ini tidak terhubung ke percakapan WhatsApp, jadi tidak bisa dibalas langsung.
						</p>
					)}

					{error ? (
						<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
							<TriangleAlert size={16} className="mt-0.5 shrink-0" />
							<span>{error}</span>
						</div>
					) : null}
				</div>

				<div className="space-y-3 border-t border-border p-4">
					{canReply ? (
						<button
							type="button"
							onClick={onReply}
							disabled={busy !== null}
							className="ocm-btn w-full justify-center bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
						>
							<SendHorizontal size={16} />
							{busy === 'reply' ? 'Mengirim...' : 'Balas via WhatsApp & Selesaikan'}
						</button>
					) : null}

					<div className="flex flex-wrap items-center gap-2">
						{task.status === 'open' ? (
							<button type="button" onClick={onStart} disabled={busy !== null} className="ocm-btn">
								<CirclePlay size={15} /> Mulai
							</button>
						) : null}
						{isActive ? (
							<button type="button" onClick={onComplete} disabled={busy !== null} className="ocm-btn">
								<CheckCircle2 size={15} />
								{busy === 'complete' ? '...' : 'Selesaikan'}
							</button>
						) : null}
						{task.conversationId ? (
							<button type="button" onClick={onOpenChat} className="ocm-btn">
								<MessageCircle size={15} /> Buka chat
							</button>
						) : null}
					</div>

					{isActive ? (
						<div className="flex flex-wrap items-center gap-2">
							<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
								<TimerReset size={14} /> Tunda:
							</span>
							{snoozePresets().map((preset) => (
								<button
									key={preset.label}
									type="button"
									onClick={() => onSnooze(preset.iso)}
									disabled={busy !== null}
									className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
								>
									{preset.label}
								</button>
							))}
						</div>
					) : null}
				</div>
			</div>
		</div>
	)
}
