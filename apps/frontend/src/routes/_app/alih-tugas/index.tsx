import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Bot, CheckCircle2, RefreshCw, TriangleAlert, UserCheck } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmAvatar, CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { isSupervisorRole } from '@/lib/role-access'
import { personalAi, type PersonalTakeoverItem } from '@/lib/api'
import { connectSocket } from '@/lib/socket'

export const Route = createFileRoute('/_app/alih-tugas/')({
	component: AlihTugasPage,
})

function formatWaiting(minutes: number) {
	if (minutes < 1) return 'baru saja'
	if (minutes < 60) return `${minutes} mnt`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	if (hours < 24) return rest ? `${hours}j ${rest}m` : `${hours} jam`
	const days = Math.floor(hours / 24)
	return `${days} hari`
}

type StatusFilter = 'all' | 'waiting' | 'answered' | 'overdue'

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string }> = [
	{ id: 'all', label: 'Semua' },
	{ id: 'waiting', label: 'Perlu dibalas' },
	{ id: 'overdue', label: 'Lewat SLA' },
	{ id: 'answered', label: 'Sudah dibalas' },
]

const COLUMNS = 'grid-cols-[minmax(0,1.7fr)_130px_110px_120px_90px]'

function AlihTugasPage() {
	const navigate = useNavigate()
	const currentUser = useCurrentUser()
	const isLeader = isSupervisorRole(currentUser?.role)
	const [items, setItems] = useState<PersonalTakeoverItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
	const [ownerFilter, setOwnerFilter] = useState('')

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await personalAi.listTakeovers()
			setItems(response.data)
		} catch (reason) {
			setItems([])
			setError(reason instanceof Error ? reason.message : 'Daftar alih tugas belum dapat dimuat.')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	// Live-refresh on takeover changes and on new messages, so the waiting time
	// and "sudah dibalas" follow what is actually happening in the chat.
	useEffect(() => {
		const socket = connectSocket()
		let debounce: ReturnType<typeof setTimeout> | null = null
		const handler = () => void load()
		const debounced = () => {
			if (debounce) clearTimeout(debounce)
			debounce = setTimeout(() => void load(), 1500)
		}
		socket.on('personal-takeover:updated', handler)
		socket.on('message:created', debounced)
		return () => {
			if (debounce) clearTimeout(debounce)
			socket.off('personal-takeover:updated', handler)
			socket.off('message:created', debounced)
		}
	}, [load])

	// The record lives on its own page now, the way a task does. Keeping it in
	// a panel here meant every row carried state that only one of them used.
	const openDetail = useCallback(
		(conversationId: string) =>
			navigate({ to: '/alih-tugas/$conversationId', params: { conversationId } }),
		[navigate],
	)

	const overdueCount = items.filter((item) => item.overdue).length
	const waitingCount = items.filter((item) => item.awaitingResponse).length

	const owners = useMemo(() => {
		const map = new Map<string, { name: string; total: number; overdue: number }>()
		for (const item of items) {
			const entry = map.get(item.ownerUserId) || {
				name: item.ownerName || 'Tanpa pemilik',
				total: 0,
				overdue: 0,
			}
			entry.total += 1
			if (item.overdue) entry.overdue += 1
			map.set(item.ownerUserId, entry)
		}
		return [...map.entries()]
			.map(([id, value]) => ({ id, ...value }))
			.sort((a, b) => b.overdue - a.overdue || a.name.localeCompare(b.name))
	}, [items])

	const visibleItems = useMemo(() => {
		const filtered = items.filter((item) => {
			if (ownerFilter && item.ownerUserId !== ownerFilter) return false
			if (statusFilter === 'waiting') return item.awaitingResponse
			if (statusFilter === 'overdue') return item.overdue
			if (statusFilter === 'answered') return !item.awaitingResponse
			return true
		})
		// Whoever has waited longest comes first, and anything past SLA above
		// that — the order the work should actually be done in.
		return filtered.sort((a, b) => {
			if (a.overdue !== b.overdue) return a.overdue ? -1 : 1
			if (a.awaitingResponse !== b.awaitingResponse) return a.awaitingResponse ? -1 : 1
			return b.waitingMinutes - a.waitingMinutes
		})
	}, [items, statusFilter, ownerFilter])

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Alih Tugas"
				subtitle={
					isLeader
						? 'Chat seluruh tim yang sedang dipegang manusia — AI berhenti membalas sampai dikembalikan.'
						: 'Chat yang sedang kamu pegang. AI berhenti membalas sampai kamu kembalikan.'
				}
				actions={
					<>
						<button type="button" className="ocm-btn" onClick={() => void load()} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
							Refresh
						</button>
					</>
				}
			/>

			<div className="ocm-grid-3">
				<section className="ocm-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Sedang dipegang</p>
					<p className="mt-1 text-2xl font-semibold">{items.length}</p>
				</section>
				<section className="ocm-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Perlu dibalas</p>
					<p className="mt-1 text-2xl font-semibold text-amber-600 dark:text-amber-300">
						{waitingCount}
					</p>
				</section>
				<section className="ocm-card p-4">
					<p className="text-xs font-medium text-muted-foreground">Lewat SLA</p>
					<p
						className={`mt-1 text-2xl font-semibold ${
							overdueCount > 0 ? 'text-red-600 dark:text-red-300' : 'text-muted-foreground'
						}`}
					>
						{overdueCount}
					</p>
				</section>
			</div>

			<div className="flex flex-wrap items-center gap-2">
				{STATUS_FILTERS.map((chip) => (
					<button
						type='button'
						key={chip.id}
						onClick={() => setStatusFilter(chip.id)}
						className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
							statusFilter === chip.id
								? 'border-primary/40 bg-primary/15 text-primary'
								: 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
						}`}
					>
						{chip.label}
					</button>
				))}

				{/* Replaces the per-sales group headings the list used to emit. A
				    picker filters instead of merely labelling, which is what a leader
				    chasing one person's backlog actually needs. */}
				{isLeader && owners.length > 1 ? (
					<select
						value={ownerFilter}
						onChange={(event) => setOwnerFilter(event.target.value)}
						className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					>
						<option value="">Semua sales</option>
						{owners.map((owner) => (
							<option key={owner.id} value={owner.id}>
								{owner.name} ({owner.total}
								{owner.overdue > 0 ? `, ${owner.overdue} lewat SLA` : ''})
							</option>
						))}
					</select>
				) : null}

				{statusFilter !== 'all' || ownerFilter ? (
					<button
						type='button'
						onClick={() => {
							setStatusFilter('all')
							setOwnerFilter('')
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
							type='button'
							className="mt-1 font-semibold underline"
							onClick={() => void load()}
						>
							Coba lagi
						</button>
					</div>
				</div>
			) : null}

			<section className="ocm-card overflow-hidden">
				<div className="ocm-card-header">
					<span className="ocm-card-title">Daftar Chat</span>
					<span className="text-xs text-muted-foreground">
						{loading ? 'Memuat...' : `${visibleItems.length} chat`}
					</span>
				</div>

				{loading && items.length === 0 ? (
					<div className="space-y-2 p-4">
						{Array.from({ length: 4 }).map((_, index) => (
							<div key={index} className="h-12 animate-pulse rounded-lg bg-muted/60" />
						))}
					</div>
				) : visibleItems.length === 0 ? (
					<div className="p-3">
						<CrmEmptyState
							title={items.length === 0 ? 'Belum ada alih tugas' : 'Tidak ada yang cocok'}
							description={
								items.length === 0
									? 'Saat AI menyerahkan lead atau kamu klik Ambil Alih di chat, lead-nya muncul di sini.'
									: 'Coba longgarkan filternya.'
							}
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[720px]">
							<div
								className={`grid ${COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
							>
								<div>Kontak</div>
								<div>Status</div>
								<div>Menunggu</div>
								<div>Sales</div>
								<div>Sumber</div>
							</div>
							{visibleItems.map((item) => (
								<div
									key={item.conversationId}
									role="button"
									tabIndex={0}
									onClick={() => openDetail(item.conversationId)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') openDetail(item.conversationId)
									}}
									className={`grid ${COLUMNS} cursor-pointer items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40`}
								>
									<div className="flex min-w-0 items-center gap-2.5 pr-3">
										<CrmAvatar name={item.contactName || '?'} size={28} />
										{/* The second line is always rendered, with a fallback when
										    there is no preview: letting it collapse gave rows two
										    different heights down the same table. */}
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold">{item.contactName}</p>
											<p className="truncate text-[11px] italic text-muted-foreground">
												{item.preview || 'Belum ada isi pesan'}
											</p>
										</div>
									</div>
										<div>
											{item.awaitingResponse ? (
												<span className="inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300">
													<span className="size-1.5 rounded-full bg-amber-500" /> Belum dibalas
												</span>
											) : (
												<span className="inline-flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-300">
													<CheckCircle2 size={12} /> Sudah dibalas
												</span>
											)}
										</div>
										<div
											className={`text-xs tabular-nums ${
												item.overdue
													? 'font-semibold text-red-600 dark:text-red-300'
													: 'text-muted-foreground'
											}`}
										>
											{item.awaitingResponse ? formatWaiting(item.waitingMinutes) : '—'}
											{item.overdue ? ' ⚠' : ''}
										</div>
										<div className="truncate text-xs text-muted-foreground">
											{item.ownerName || '—'}
										</div>
										<div>
											<span
												className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${
													item.source === 'ai'
														? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
														: 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
												}`}
											>
												{item.source === 'ai' ? <Bot size={11} /> : <UserCheck size={11} />}
												{item.source === 'ai' ? 'AI' : 'Sales'}
											</span>
										</div>
									</div>
								))}
						</div>
					</div>
				)}
			</section>

		</main>
	)
}
