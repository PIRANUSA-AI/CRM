import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Bot,
	CheckCircle2,
	MessageCircle,
	RefreshCw,
	Sparkles,
	TriangleAlert,
	UserCheck,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmAvatar, CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { isSupervisorRole } from '@/lib/role-access'
import {
	personalAi,
	type PersonalTakeoverHistoryItem,
	type PersonalTakeoverItem,
} from '@/lib/api'
import { connectSocket } from '@/lib/socket'

export const Route = createFileRoute('/_app/alih-tugas')({
	component: AlihTugasPage,
})

function formatDateTime(value: string | null) {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

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
	const [busyId, setBusyId] = useState<string | null>(null)
	const [historyById, setHistoryById] = useState<Record<string, PersonalTakeoverHistoryItem[]>>({})

	const [statusFilter, setStatusFilter] = useState<StatusFilter>('all')
	const [ownerFilter, setOwnerFilter] = useState('')
	const [selectedId, setSelectedId] = useState<string | null>(null)
	const [noteDraft, setNoteDraft] = useState('')

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

	const loadHistory = useCallback(
		async (conversationId: string) => {
			if (historyById[conversationId]) return
			try {
				const response = await personalAi.takeoverHistory(conversationId)
				setHistoryById((current) => ({ ...current, [conversationId]: response.data }))
			} catch {
				setHistoryById((current) => ({ ...current, [conversationId]: [] }))
			}
		},
		[historyById],
	)

	const select = useCallback(
		(conversationId: string) => {
			setSelectedId(conversationId)
			// Cleared per selection. One shared draft meant a note typed against
			// one chat would follow you to the next and be sent for that one.
			setNoteDraft('')
			void loadHistory(conversationId)
		},
		[loadHistory],
	)

	const releaseToAi = useCallback(
		async (conversationId: string, note?: string) => {
			setBusyId(conversationId)
			setError(null)
			try {
				await personalAi.release(conversationId, note?.trim() || undefined)
				setSelectedId(null)
				setNoteDraft('')
				await load()
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : 'Gagal mengembalikan ke AI.')
			} finally {
				setBusyId(null)
			}
		},
		[load],
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

	const selected = useMemo(
		() => visibleItems.find((item) => item.conversationId === selectedId) ?? null,
		[visibleItems, selectedId],
	)

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
						type="button"
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
						type="button"
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
							type="button"
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
							{visibleItems.map((item) => {
								const isSelected = item.conversationId === selectedId
								return (
									<div
										key={item.conversationId}
										role="button"
										tabIndex={0}
										onClick={() => select(item.conversationId)}
										onKeyDown={(event) => {
											if (event.key === 'Enter') select(item.conversationId)
										}}
										className={`grid ${COLUMNS} cursor-pointer items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 ${
											isSelected ? 'bg-primary/10' : 'hover:bg-muted/40'
										}`}
									>
										<div className="flex min-w-0 items-center gap-2.5 pr-3">
											<CrmAvatar name={item.contactName || '?'} size={28} />
											<div className="min-w-0">
												<p className="truncate font-semibold">{item.contactName}</p>
												{item.preview ? (
													<p className="truncate text-[11px] italic text-muted-foreground">
														{item.preview}
													</p>
												) : null}
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
								)
							})}
						</div>
					</div>
				)}
			</section>

			{/* Detail opens on click rather than living beside the list: it only
			    ever describes one chat, and a permanent column for it left the
			    table narrower than the rows it has to hold. */}
			<Dialog
				open={Boolean(selected)}
				onOpenChange={(open) => {
					if (!open) {
						setSelectedId(null)
						setNoteDraft('')
					}
				}}
			>
				<DialogContent className="sm:max-w-lg">
					{selected ? (
						<>
							<DialogHeader>
								<DialogTitle>{selected.contactName}</DialogTitle>
								<DialogDescription>
									{selected.contactPhone || 'Nomor tidak tersedia'}
								</DialogDescription>
							</DialogHeader>

							<div className="space-y-3">
						{/* Replying is the job; returning it to the AI is what you do
						    afterwards. The old page styled those the other way round. */}
						<button
							type="button"
							className="ocm-btn ocm-btn-primary w-full justify-center"
							onClick={() =>
								navigate({ to: '/chat', search: { c: selected.conversationId } })
							}
						>
							<MessageCircle size={15} /> Balas di Chat
						</button>

						<dl className="divide-y divide-border rounded-lg border border-border text-sm">
							{(
								[
									['Sales', selected.ownerName || '—'],
									['Diambil oleh', selected.takenByName || (selected.source === 'ai' ? 'AI' : '—')],
									['Sejak', formatDateTime(selected.takenAt)],
									[
										'Status',
										selected.awaitingResponse
											? `Menunggu dibalas ${formatWaiting(selected.waitingMinutes)}${selected.overdue ? ' · lewat SLA' : ''}`
											: `Sudah dibalas${selected.respondedAt ? ` · ${formatDateTime(selected.respondedAt)}` : ''}`,
									],
								] as Array<[string, string]>
							).map(([label, value]) => (
								<div key={label} className="flex items-baseline justify-between gap-3 px-3 py-2">
									<dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
									<dd className="min-w-0 break-words text-right text-xs">{value}</dd>
								</div>
							))}
						</dl>

						{selected.aiReason ? (
							<div>
								<p className="mb-1 text-xs font-semibold text-muted-foreground">Alasan AI</p>
								<p className="text-sm text-muted-foreground">{selected.aiReason}</p>
							</div>
						) : null}

						{selected.aiSuggestedReply ? (
							<div className="rounded-lg border border-primary/20 bg-primary/5 p-2.5">
								<p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-primary">
									<Sparkles size={12} /> Draf balasan dari AI
								</p>
								<p className="text-sm">{selected.aiSuggestedReply}</p>
							</div>
						) : null}

						{selected.note ? (
							<p className="rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
								Catatan: {selected.note}
							</p>
						) : null}

						<div className="border-t border-border pt-3">
							<label className="mb-1 block text-xs font-semibold text-muted-foreground">
								Catatan saat dikembalikan (opsional)
							</label>
							{/* Out in the open. It used to sit behind a button labelled
							    "Riwayat", so adding a note meant opening a history panel. */}
							<input
								value={noteDraft}
								onChange={(event) => setNoteDraft(event.target.value)}
								placeholder="mis. sudah dijawab, tinggal follow-up"
								className="ocm-input"
							/>
							<button
								type="button"
								className="ocm-btn mt-2 w-full justify-center"
								onClick={() => void releaseToAi(selected.conversationId, noteDraft)}
								disabled={busyId === selected.conversationId}
							>
								<Bot size={15} />
								{busyId === selected.conversationId
									? 'Mengembalikan...'
									: 'Selesai, kembalikan ke AI'}
							</button>
						</div>

						<div className="border-t border-border pt-3">
							<p className="mb-1.5 text-xs font-semibold text-muted-foreground">Riwayat</p>
							{historyById[selected.conversationId] === undefined ? (
								<p className="text-xs text-muted-foreground">Memuat...</p>
							) : historyById[selected.conversationId].length === 0 ? (
								<p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
							) : (
								<ol className="space-y-1.5">
									{historyById[selected.conversationId].map((event) => (
										<li key={event.id} className="flex items-start gap-2 text-xs">
											<span
												className={`mt-1 inline-block size-2 shrink-0 rounded-full ${
													event.action === 'personal_release' ? 'bg-sky-500' : 'bg-amber-500'
												}`}
											/>
											<span className="min-w-0">
												<span className="font-medium">
													{event.action === 'personal_release'
														? 'Dikembalikan ke AI'
														: event.source === 'ai'
															? 'Dialihkan otomatis oleh AI'
															: 'Diambil alih sales'}
												</span>
												{event.actorName ? ` · ${event.actorName}` : ''}
												{event.note ? ` · "${event.note}"` : ''}
												<span className="text-muted-foreground">
													{' '}
													· {formatDateTime(event.createdAt)}
												</span>
											</span>
										</li>
									))}
								</ol>
							)}
						</div>
							</div>
						</>
					) : null}
				</DialogContent>
			</Dialog>
		</main>
	)
}
