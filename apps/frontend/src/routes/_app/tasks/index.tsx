import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	CheckCircle2,
	Clock3,
	ListTodo,
	RefreshCw,
	Sparkles,
	TriangleAlert,
	UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
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

export const Route = createFileRoute('/_app/tasks/')({
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
	const [view, setView] = useState<TaskView>('today')
	const [taskItems, setTaskItems] = useState<Task[]>([])
	const [summary, setSummary] = useState({ today: 0, overdue: 0, completedToday: 0 })
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

	// Completion is manual: the sales decides when a conversation is truly done.
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
							Klik tugas untuk membuka halaman detail lengkap beserta riwayatnya.
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
											onClick={() => openDetail(task.id)}
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
											<button
												type="button"
												className="ocm-btn"
												onClick={() => openDetail(task.id)}
											>
												<Sparkles size={15} />
												Detail
											</button>
											{task.status === 'open' || task.status === 'in_progress' ? (
												<button
													type="button"
													className="ocm-btn bg-emerald-600 text-white hover:bg-emerald-700"
													onClick={() => void completeTask(task)}
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
		</main>
	)
}
