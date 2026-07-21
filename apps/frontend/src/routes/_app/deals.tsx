import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
	Columns3,
	LayoutList,
	Loader2,
	RefreshCw,
	Search,
	TriangleAlert,
	UserPlus,
	UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { DealBoard } from '@/components/crm/DealBoard'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { isSupervisorRole } from '@/lib/role-access'
import {
	opportunities as dealsApi,
	type DealBucket,
	type DealColumn,
	type DealStage,
	type Opportunity,
	type OpportunityStats,
} from '@/lib/api'

export const Route = createFileRoute('/_app/deals')({
	component: DealsPage,
	// Optional key (not `string | undefined`) so every other Link to /deals
	// can keep omitting search entirely.
	validateSearch: (search: Record<string, unknown>) => {
		const next: { bucket?: string } = {}
		if (typeof search.bucket === 'string') next.bucket = search.bucket
		return next
	},
})

type ViewMode = 'table' | 'board'

/** Rows per table page, and cards per board column — the column heading still
 *  reports the real count, so a capped column says how many it is hiding. */
const PAGE_SIZE = 25
const BOARD_PER_STAGE = 25

const BUCKET_FILTERS: Array<{ value: DealBucket | 'all'; label: string }> = [
	{ value: 'all', label: 'Semua' },
	{ value: 'prospek', label: 'Prospek' },
	{ value: 'opportunity', label: 'Opportunity' },
	{ value: 'closed', label: 'Selesai' },
]

const IDR = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0,
})

function formatValue(value: number | null) {
	if (!value) return '—'
	return IDR.format(value).replace(/ /g, ' ')
}

function bucketTone(bucket: DealBucket) {
	if (bucket === 'opportunity') return 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
	if (bucket === 'closed') return 'bg-muted text-muted-foreground'
	return 'bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function bucketLabel(bucket: DealBucket) {
	if (bucket === 'opportunity') return 'Opportunity'
	if (bucket === 'closed') return 'Selesai'
	return 'Prospek'
}

/** A slim progress bar; the threshold is drawn as a notch so the jump from
 *  prospek to opportunity is visible rather than implied. */
function ProbabilityBar({ value, threshold }: { value: number; threshold: number }) {
	return (
		<div className="relative h-1.5 w-full overflow-hidden rounded-full bg-muted">
			<div
				className={`h-full rounded-full ${value >= threshold ? 'bg-emerald-500' : 'bg-amber-500'}`}
				style={{ width: `${Math.max(2, Math.min(100, value))}%` }}
			/>
			<span
				className="absolute top-0 h-full w-px bg-foreground/40"
				style={{ left: `${Math.min(100, threshold)}%` }}
				title={`Ambang opportunity: ${threshold}%`}
			/>
		</div>
	)
}

function isBucket(value: unknown): value is DealBucket {
	return value === 'prospek' || value === 'opportunity' || value === 'closed'
}

function DealsPage() {
	const navigate = useNavigate()
	const search = Route.useSearch()
	const currentUser = useCurrentUser()
	const isLeader = isSupervisorRole(currentUser?.role)

	const [stages, setStages] = useState<DealStage[]>([])
	const [deals, setDeals] = useState<Opportunity[]>([])
	const [columns, setColumns] = useState<DealColumn[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	const [wonYear, setWonYear] = useState('all')
	const [wonYears, setWonYears] = useState<string[]>([])
	const [stats, setStats] = useState<OpportunityStats | null>(null)
	const [view, setView] = useState<ViewMode>('table')
	// /opportunity redirects here pre-filtered, so the initial bucket comes from
	// the URL when it names one.
	const [bucket, setBucket] = useState<DealBucket | 'all'>(
		isBucket(search.bucket) ? search.bucket : 'all',
	)
	const [queryInput, setQueryInput] = useState('')
	const [query, setQuery] = useState('')
	const [loading, setLoading] = useState(true)
	const [movingId, setMovingId] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	// Details a sales fills in as the deal firms up. The stage stays on the row
	// itself — it is the one thing changed constantly — while these three are
	// edited occasionally, so they live behind a click instead of cluttering
	// every row with inputs.
	const [editing, setEditing] = useState<Opportunity | null>(null)
	const [draft, setDraft] = useState({ name: '', product: '', value: '', notes: '' })
	const [saving, setSaving] = useState(false)

	const openEditor = useCallback((deal: Opportunity) => {
		setEditing(deal)
		setDraft({
			name: deal.name,
			product: deal.product || '',
			value: deal.value != null ? String(deal.value) : '',
			notes: deal.notes || '',
		})
	}, [])

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			// The two views ask for different shapes: the table wants one page of
			// rows with a true total, the board wants per-column totals plus only
			// the first cards of each. Neither can be derived from the other.
			const [stageRes, statRes] = await Promise.all([dealsApi.stages(), dealsApi.stats()])
			setStages(stageRes.payload || [])
			setStats(statRes.payload || null)

			if (view === 'board') {
				const boardRes = await dealsApi.board({
					search: query.trim() || undefined,
					bucket: bucket === 'all' ? undefined : bucket,
					perStage: BOARD_PER_STAGE,
					wonYear: wonYear === 'all' ? undefined : Number(wonYear),
				})
				setColumns(boardRes.payload?.columns || [])
				setWonYears(boardRes.payload?.wonYears || [])
			} else {
				const dealRes = await dealsApi.list({
					search: query.trim() || undefined,
					bucket: bucket === 'all' ? undefined : bucket,
					limit: PAGE_SIZE,
					offset: (page - 1) * PAGE_SIZE,
				})
				setDeals(dealRes.payload || [])
				setTotal(Number(dealRes.meta?.total ?? 0))
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Deals belum dapat dimuat.')
		} finally {
			setLoading(false)
		}
	}, [view, query, bucket, page, wonYear])

	const saveDetails = useCallback(async () => {
		if (!editing) return
		const name = draft.name.trim()
		if (!name) {
			setError('Nama deal wajib diisi.')
			return
		}
		const rawValue = draft.value.trim()
		// An empty box means "not known yet", which is different from zero.
		const value = rawValue === '' ? null : Number(rawValue.replace(/[^0-9]/g, ''))
		if (value !== null && !Number.isFinite(value)) {
			setError('Nilai deal harus berupa angka.')
			return
		}
		setSaving(true)
		setError(null)
		try {
			await dealsApi.update(editing.id, {
				name,
				product: draft.product.trim() || null,
				value,
				notes: draft.notes.trim() || null,
			})
			setEditing(null)
			// Totals are money sums, so they shift the moment a value is entered.
			await load()
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Deal belum dapat disimpan.')
		} finally {
			setSaving(false)
		}
	}, [editing, draft, load])

	useEffect(() => {
		void load()
	}, [load])

	// Debounced so typing a deal name does not fire a request per keystroke, and
	// page 1 again because page 4 of the old result set means nothing in the new.
	useEffect(() => {
		const timer = setTimeout(() => {
			setQuery(queryInput.trim())
			setPage(1)
		}, 300)
		return () => clearTimeout(timer)
	}, [queryInput])

	useEffect(() => {
		setPage(1)
	}, [bucket, view])

	const moveStage = useCallback(async (deal: Opportunity, stageId: string) => {
		if (stageId === deal.stage) return
		setMovingId(deal.id)
		setError(null)
		try {
			await dealsApi.moveStage(deal.id, stageId)
			// Column counts, column totals and the header buckets all live on the
			// server now, so the move is followed by a reload rather than by
			// patching one row and leaving four numbers stale.
			await load()
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Tahap belum dapat diubah.')
		} finally {
			setMovingId(null)
		}
	}, [])

	// Search and the bucket filter are applied by the server now, so what came
	// back is already what should be shown — narrowing it again here would shrink
	// the page while the total went on describing something wider.
	const visible = deals
	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Deals"
				subtitle={
					isLeader
						? 'Semua deal tim, dari prospek sampai closing. Prospek naik jadi opportunity saat melewati ambang tim.'
						: 'Deal kamu, dari prospek sampai closing. Geser kartunya seiring perkembangan.'
				}
				actions={
					<>
						<button
							type='button'
							className='ocm-btn'
							onClick={() => navigate({ to: '/prospek' })}
						>
							<UserPlus size={14} /> Tambah Prospek
						</button>
						<button type="button" className="ocm-btn" onClick={() => void load()} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Muat ulang
						</button>
					</>
				}
			/>

			{stats ? (
				<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
					{(
						[
							['Prospek', stats.prospek, 'text-amber-600 dark:text-amber-300'],
							['Opportunity', stats.opportunity, 'text-emerald-600 dark:text-emerald-300'],
							['Menang', stats.won, 'text-sky-600 dark:text-sky-300'],
							['Kalah', stats.lost, 'text-muted-foreground'],
						] as const
					).map(([label, entry, tone]) => (
						<div key={label} className="ocm-card p-4">
							<p className="text-xs font-medium text-muted-foreground">{label}</p>
							<p className={`mt-1 text-2xl font-semibold ${tone}`}>{entry.count}</p>
							<p className="text-xs text-muted-foreground">{formatValue(entry.value)}</p>
						</div>
					))}
				</div>
			) : null}

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			<div className="ocm-card overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
					<div className="flex flex-wrap items-center gap-1">
						{BUCKET_FILTERS.map((option) => (
							<button
								key={option.value}
								type='button'
								onClick={() => setBucket(option.value)}
								className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
									bucket === option.value
										? 'bg-primary/15 text-primary'
										: 'text-muted-foreground hover:text-foreground'
								}`}
							>
								{option.label}
							</button>
						))}
					</div>
					<div className="flex flex-wrap items-center gap-2">
						<div className="relative">
							<Search
								size={15}
								className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
							/>
							<input
								value={queryInput}
								onChange={(event) => setQueryInput(event.target.value)}
								placeholder="Cari deal, kontak, produk..."
								className="w-56 rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
							/>
						</div>
						<div className="flex items-center gap-1 rounded-lg border border-border p-0.5">
							<button
								type='button'
								onClick={() => setView('table')}
								className={`rounded px-2 py-1 ${view === 'table' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
								title='Tampilan tabel'
							>
								<LayoutList size={15} />
							</button>
							<button
								type='button'
								onClick={() => setView('board')}
								className={`rounded px-2 py-1 ${view === 'board' ? 'bg-primary/15 text-primary' : 'text-muted-foreground'}`}
								title='Tampilan papan'
							>
								<Columns3 size={15} />
							</button>
						</div>
					</div>
				</div>

				{loading ? (
					<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
						<Loader2 size={16} className="animate-spin" /> Memuat pipeline...
					</div>
				) : visible.length === 0 ? (
					<div className="p-4">
						<CrmEmptyState
							title="Belum ada deal"
							description="Deal terbuka sendiri saat lead di-assign atau prospek ditambahkan. Tidak perlu diinput manual."
						/>
					</div>
				) : view === 'table' ? (
					<>
						<div className="overflow-x-auto">
						<table className="w-full min-w-[860px] text-sm">
							<thead>
								<tr className="border-b border-border text-left text-[11px] uppercase tracking-wide text-muted-foreground">
									<th className="px-4 py-2 font-medium">Deal</th>
									<th className="px-4 py-2 font-medium">Kontak</th>
									<th className="px-4 py-2 font-medium">Perusahaan</th>
									<th className="px-4 py-2 font-medium">Tahap</th>
									<th className="px-4 py-2 font-medium">Progres</th>
									<th className="px-4 py-2 font-medium">Pemilik</th>
									<th className="px-4 py-2 font-medium">Nilai</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-border">
								{visible.map((deal) => (
									<tr key={deal.id} className="hover:bg-muted/30">
										<td className='px-4 py-3'>
											<button
												type='button'
												onClick={() => openEditor(deal)}
												className="text-left font-medium hover:underline"
											>
												{deal.name}
											</button>
											<span
												className={`mt-1 block w-fit rounded-full px-2 py-0.5 text-[11px] font-semibold ${bucketTone(deal.bucket)}`}
											>
												{bucketLabel(deal.bucket)}
											</span>
										</td>
											<td className="px-4 py-3 text-muted-foreground">
											{deal.contactName || '—'}
											{deal.product ? (
												<span className="block text-xs">{deal.product}</span>
											) : null}
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											{deal.companyId && deal.companyName ? (
												<Link
													to="/companies/$companyId"
													params={{ companyId: deal.companyId }}
													className="hover:underline"
												>
													{deal.companyName}
												</Link>
											) : (
												deal.companyName || '—'
											)}
										</td>
										<td className='px-4 py-3'>
											<select
												value={deal.stage}
												disabled={movingId === deal.id}
												onChange={(event) => void moveStage(deal, event.target.value)}
												className="rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
											>
												{stages.map((stage) => (
													<option key={stage.id} value={stage.id}>
														{stage.label}
													</option>
												))}
											</select>
										</td>
										<td className="w-40 px-4 py-3">
											<div className="flex items-center gap-2">
												<ProbabilityBar value={deal.probability} threshold={deal.threshold} />
												<span className="w-9 shrink-0 text-right text-xs tabular-nums text-muted-foreground">
													{deal.probability}%
												</span>
											</div>
										</td>
										<td className="px-4 py-3 text-muted-foreground">
											<span className="inline-flex items-center gap-1">
												<UserRound size={13} />
												{deal.ownerName || '—'}
											</span>
											{deal.teamName ? (
												<span className="ml-1 rounded bg-muted px-1.5 py-0.5 text-[11px]">
													{deal.teamName}
												</span>
											) : null}
										</td>
										<td className="px-4 py-3 tabular-nums">{formatValue(deal.value)}</td>
									</tr>
								))}
							</tbody>
						</table>
						</div>
						<div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-xs text-muted-foreground">
							<span>
								Menampilkan {total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1}-
								{Math.min(page * PAGE_SIZE, total)} dari {total.toLocaleString('id-ID')} deal
							</span>
							<div className="flex items-center gap-1">
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => setPage((current) => Math.max(1, current - 1))}
									disabled={loading || page <= 1}
								>
									Sebelumnya
								</button>
								<span className="px-2 font-mono">
									{page} / {totalPages}
								</span>
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
									disabled={loading || page >= totalPages}
								>
									Berikutnya
								</button>
							</div>
						</div>
					</>
				) : (
					<DealBoard
						stages={stages}
						columns={columns}
						wonYear={wonYear}
						wonYears={wonYears}
						onWonYearChange={setWonYear}
						onMove={(deal, stageId) => void moveStage(deal, stageId)}
						onOpen={openEditor}
					/>
				)}
			</div>

			<Dialog open={Boolean(editing)} onOpenChange={(open) => !saving && !open && setEditing(null)}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Detail Deal</DialogTitle>
						<DialogDescription>
							{editing
								? `${editing.contactName || 'Tanpa kontak'} · ${editing.stageLabel} ${editing.probability}%`
								: ''}
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">
								Nama deal *
							</span>
							<input
								className='ocm-input'
								value={draft.name}
								onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
							/>
						</label>
						<div className="grid gap-3 sm:grid-cols-2">
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									Produk
								</span>
								<input
									className='ocm-input'
									value={draft.product}
									onChange={(event) =>
										setDraft((d) => ({ ...d, product: event.target.value }))
									}
									placeholder="mis. ZWCAD 2025 Professional"
								/>
							</label>
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									Nilai (Rp)
								</span>
								<input
									className="ocm-input text-right tabular-nums"
									inputMode='numeric'
									value={draft.value}
									onChange={(event) => setDraft((d) => ({ ...d, value: event.target.value }))}
									placeholder="Kosongkan bila belum tahu"
								/>
							</label>
						</div>
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">
								Catatan
							</span>
							<textarea
								rows={3}
								className="ocm-input resize-y"
								value={draft.notes}
								onChange={(event) => setDraft((d) => ({ ...d, notes: event.target.value }))}
								placeholder="Konteks negosiasi, kebutuhan khusus, dsb."
							/>
						</label>
					</div>

					<DialogFooter>
						<button
							type='button'
							className='ocm-btn'
							onClick={() => setEditing(null)}
							disabled={saving}
						>
							Batal
						</button>
						<button
							type='button'
							className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90"
							onClick={() => void saveDetails()}
							disabled={saving || !draft.name.trim()}
						>
							{saving ? <Loader2 size={14} className="animate-spin" /> : null}
							Simpan
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</main>
	)
}
