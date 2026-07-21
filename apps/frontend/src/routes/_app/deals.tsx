import { createFileRoute, Link } from '@tanstack/react-router'
import {
	Columns3,
	LayoutList,
	Loader2,
	RefreshCw,
	Search,
	TriangleAlert,
	Building2,
	Plus,
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
import { isMultiTeamRole, isSupervisorRole } from '@/lib/role-access'
import {
	customers as customersApi,
	leadImport,
	opportunities as dealsApi,
	prospects,
	type ProspectChannel,
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

const PROSPECT_CHANNELS: Array<{ value: ProspectChannel; label: string }> = [
	{ value: 'event', label: 'Event / Pameran' },
	{ value: 'linkedin', label: 'LinkedIn' },
	{ value: 'instagram', label: 'Instagram' },
	{ value: 'whatsapp', label: 'WhatsApp' },
	{ value: 'referral', label: 'Referral' },
	{ value: 'other', label: 'Lainnya' },
]

/** The fields the contact picker needs; the customers list carries more. */
type ContactOption = {
	id: string
	name: string | null
	email: string | null
	phone_number: string | null
	company_name: string | null
	owner_id: string | null
}

/** Rows per table page, and cards per board column. The column heading still
 *  reports the real count, so a capped column says how many it is hiding. */
const PAGE_SIZE = 25
const BOARD_PER_STAGE = 25

/**
 * The Semua / Prospek / Opportunity / Selesai chips are hidden, not removed.
 *
 * The Pipeline picker now answers "which board am I looking at", which is most
 * of what those chips were doing. Everything behind them stays wired: the state,
 * the backend filter, and the `?bucket=` search key, so /opportunity still lands
 * here pre-filtered and switching this back on is one line.
 *
 * They are also misleading on the Leads board, whose stages carry no
 * probability, so every lead there reads as "prospek" whatever it is.
 */
const SHOW_BUCKET_FILTERS: boolean = false

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
	if (!value) return '-'
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
	const search = Route.useSearch()
	const currentUser = useCurrentUser()
	const isLeader = isSupervisorRole(currentUser?.role)
	// An administrator carries no leads of their own, so createProspect refuses a
	// prospect from them that names nobody. Without this picker the "new contact"
	// branch would fail for exactly the role most likely to file one.
	const mustPickAssignee = isMultiTeamRole(currentUser?.role)

	const [stages, setStages] = useState<DealStage[]>([])
	const [deals, setDeals] = useState<Opportunity[]>([])
	const [columns, setColumns] = useState<DealColumn[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	const [pipeline, setPipeline] = useState('sales')
	const [pipelines, setPipelines] = useState<Array<{ id: string; label: string }>>([])
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
	const [loadingStage, setLoadingStage] = useState<string | null>(null)
	const [error, setError] = useState<string | null>(null)

	// Details a sales fills in as the deal firms up. The stage stays on the row
	// itself. It is the one thing changed constantly - while these three are
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
			const [stageRes, statRes] = await Promise.all([
				dealsApi.stages(pipeline),
				dealsApi.stats(),
			])
			setStages(stageRes.payload || [])
			setStats(statRes.payload || null)

			if (view === 'board') {
				const boardRes = await dealsApi.board({
					search: query.trim() || undefined,
					bucket: bucket === 'all' ? undefined : bucket,
					perStage: BOARD_PER_STAGE,
					wonYear: wonYear === 'all' ? undefined : Number(wonYear),
					pipeline,
				})
				setColumns(boardRes.payload?.columns || [])
				setWonYears(boardRes.payload?.wonYears || [])
			} else {
				const dealRes = await dealsApi.list({
					search: query.trim() || undefined,
					bucket: bucket === 'all' ? undefined : bucket,
					limit: PAGE_SIZE,
					offset: (page - 1) * PAGE_SIZE,
					pipeline,
				})
				setDeals(dealRes.payload || [])
				setTotal(Number(dealRes.meta?.total ?? 0))
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Deals belum dapat dimuat.')
		} finally {
			setLoading(false)
		}
	}, [view, query, bucket, page, wonYear, pipeline])

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

	useEffect(() => {
		void dealsApi
			.pipelines()
			.then((response) => setPipelines(response.payload || []))
			.catch(() => undefined)
	}, [])

	// Each board has its own columns and its own deals, so a page number and a
	// won-year picked on one of them means nothing on the next.
	useEffect(() => {
		setPage(1)
		setWonYear('all')
	}, [pipeline])

	/**
	 * Moving a card updates the board in place rather than reloading it.
	 *
	 * A drag should land instantly, and the four numbers a move disturbs, both
	 * columns' counts and both columns' totals, are all derivable from the card
	 * that moved, so they are adjusted here. The server's row then replaces the
	 * optimistic one, and a failure puts the board back exactly as it was.
	 */
	const moveStage = useCallback(
		async (deal: Opportunity, stageId: string) => {
			if (stageId === deal.stage) return
			const previousColumns = columns
			const previousDeals = deals
			const target = stages.find((row) => row.id === stageId)
			const amount = deal.value || 0

			const optimistic: Opportunity = {
				...deal,
				stage: stageId,
				stageLabel: target?.label ?? deal.stageLabel,
				// Pending asserts no probability, so the card keeps the one it had
				// the same rule the backend applies.
				probability: target?.probability ?? deal.probability,
				status: target?.status ?? deal.status,
				stageChangedAt: new Date().toISOString(),
			}

			setMovingId(deal.id)
			setError(null)
			setColumns((prev) =>
				prev.map((column) => {
					if (column.stage === deal.stage) {
						return {
							...column,
							count: Math.max(0, column.count - 1),
							value: column.value - amount,
							deals: column.deals.filter((row) => row.id !== deal.id),
						}
					}
					if (column.stage === stageId) {
						return {
							...column,
							count: column.count + 1,
							value: column.value + amount,
							deals: [optimistic, ...column.deals],
						}
					}
					return column
				}),
			)
			setDeals((prev) => prev.map((row) => (row.id === deal.id ? optimistic : row)))

			try {
				const response = await dealsApi.moveStage(deal.id, stageId)
				const updated = response.payload
				setColumns((prev) =>
					prev.map((column) =>
						column.stage === stageId
							? {
									...column,
									deals: column.deals.map((row) => (row.id === updated.id ? updated : row)),
								}
							: column,
					),
				)
				setDeals((prev) => prev.map((row) => (row.id === updated.id ? updated : row)))
				// The header buckets depend on the team threshold, so they are asked
				// for rather than guessed, but out of band, since nothing on screen
				// waits for them.
				void dealsApi
					.stats()
					.then((res) => setStats(res.payload))
					.catch(() => undefined)
				// A row that just left the filtered bucket must stop being listed,
				// and only the server knows what takes its place on this page.
				if (view === 'table' && bucket !== 'all') await load()
			} catch (reason) {
				setColumns(previousColumns)
				setDeals(previousDeals)
				setError(reason instanceof Error ? reason.message : 'Tahap belum dapat diubah.')
			} finally {
				setMovingId(null)
			}
		},
		[columns, deals, stages, view, bucket, load],
	)

	/** The next page of one column, appended rather than replacing what is shown. */
	const loadMoreStage = useCallback(
		async (stageId: string) => {
			const column = columns.find((row) => row.stage === stageId)
			if (!column || column.deals.length >= column.count) return
			setLoadingStage(stageId)
			try {
				const response = await dealsApi.list({
					search: query.trim() || undefined,
					bucket: bucket === 'all' ? undefined : bucket,
					stage: stageId,
					limit: BOARD_PER_STAGE,
					offset: column.deals.length,
				})
				const more = response.payload || []
				setColumns((prev) =>
					prev.map((row) =>
						row.stage === stageId
							? {
									...row,
									// Guarded against duplicates: a card moved into this column
									// since the first page was fetched would otherwise arrive
									// twice, once optimistically and once from the offset.
									deals: [
										...row.deals,
										...more.filter((item) => !row.deals.some((had) => had.id === item.id)),
									],
								}
							: row,
					),
				)
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : 'Gagal memuat sisa kolom.')
			} finally {
				setLoadingStage(null)
			}
		},
		[columns, query, bucket],
	)

	// Creating a deal by hand. Most deals open themselves when a lead is
	// assigned, but a deal that started as a phone call has no lead behind it,
	// and until now there was no way to record one.
	const [creating, setCreating] = useState(false)
	const [newDeal, setNewDeal] = useState({
		name: '',
		product: '',
		value: '',
		stage: '',
		contactId: '',
	})
	const [contactQuery, setContactQuery] = useState('')
	const [contactResults, setContactResults] = useState<ContactOption[]>([])
	const [pickedContact, setPickedContact] = useState<ContactOption | null>(null)
	const [creatingBusy, setCreatingBusy] = useState(false)

	// The "this person is new" branch. It replaces the separate Tambah Prospek
	// page: same call, same follow-up task, reached at the point the search
	// comes up empty instead of guessed before you start.
	const [makingContact, setMakingContact] = useState(false)
	const [newContact, setNewContact] = useState({
		name: '',
		phone: '',
		email: '',
		company: '',
		followUpAt: '',
		channel: 'event' as ProspectChannel,
	})
	const [assigneeId, setAssigneeId] = useState('')
	const [assignables, setAssignables] = useState<
		Array<{ userId: string; name: string | null; email: string; teamName: string | null }>
	>([])
	const [duplicate, setDuplicate] = useState<{
		name: string | null
		ownerName: string | null
		openTasks: number
		openDeals: number
	} | null>(null)

	// Searched server-side, so a sales only ever finds contacts that are theirs.
	useEffect(() => {
		if (!creating) return
		const term = contactQuery.trim()
		if (term.length < 2) {
			setContactResults([])
			return
		}
		let cancelled = false
		const timer = setTimeout(() => {
			void customersApi
				.list({ search: term, per_page: 8 })
				.then((response: any) => {
					if (cancelled) return
					setContactResults(response?.data || response?.payload || [])
				})
				.catch(() => undefined)
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [contactQuery, creating])

	// Checked while the number is typed, so re-logging someone the team already
	// has is a decision rather than a surprise. It used to attach a second
	// follow-up task to the same contact with nothing on screen saying so.
	useEffect(() => {
		if (!makingContact) return
		const phone = newContact.phone.trim()
		const email = newContact.email.trim()
		if (phone.length < 6 && !email) {
			setDuplicate(null)
			return
		}
		let cancelled = false
		const timer = setTimeout(() => {
			void leadImport
				.contactLookup({ phone: phone || undefined, email: email || undefined })
				.then((response) => {
					if (cancelled) return
					setDuplicate(response.data.found ? response.data : null)
				})
				.catch(() => undefined)
		}, 400)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [makingContact, newContact.phone, newContact.email])

	useEffect(() => {
		if (!mustPickAssignee) return
		void leadImport
			.assignables()
			.then((response) => setAssignables(response.data || []))
			.catch(() => undefined)
	}, [mustPickAssignee])

	const openCreate = useCallback(() => {
		setNewDeal({ name: '', product: '', value: '', stage: stages[0]?.id || '', contactId: '' })
		setContactQuery('')
		setContactResults([])
		setPickedContact(null)
		setMakingContact(false)
		setDuplicate(null)
		setAssigneeId('')
		// Tomorrow 09:00: a prospect with no follow-up date is one nobody chases.
		const tomorrow = new Date()
		tomorrow.setDate(tomorrow.getDate() + 1)
		tomorrow.setHours(9, 0, 0, 0)
		const pad = (n: number) => String(n).padStart(2, '0')
		setNewContact({
			name: '',
			phone: '',
			email: '',
			company: '',
			channel: 'event',
			followUpAt: `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}T09:00`,
		})
		setCreating(true)
	}, [stages])

	const submitCreate = useCallback(async () => {
		const name = newDeal.name.trim()
		if (!name) {
			setError('Nama deal wajib diisi.')
			return
		}
		if (!makingContact && !pickedContact) {
			setError('Pilih kontak untuk deal ini.')
			return
		}
		if (makingContact) {
			if (!newContact.name.trim()) {
				setError('Nama kontak wajib diisi.')
				return
			}
			if (!newContact.phone.trim() && !newContact.email.trim()) {
				setError('Isi minimal nomor WhatsApp atau email.')
				return
			}
			if (mustPickAssignee && !assigneeId) {
				setError('Pilih sales yang akan menangani kontak ini.')
				return
			}
		}
		const raw = newDeal.value.trim()
		const value = raw === '' ? null : Number(raw.replace(/[^0-9]/g, ''))
		if (value !== null && !Number.isFinite(value)) {
			setError('Nilai deal harus berupa angka.')
			return
		}
		setCreatingBusy(true)
		setError(null)
		try {
			if (makingContact) {
				// One call, not two: the prospect path already creates the contact,
				// the company, the follow-up task and the deal in one transaction,
				// so the deal fields ride along rather than being patched after.
				await prospects.create({
					name: newContact.name.trim(),
					phone: newContact.phone.trim() || undefined,
					email: newContact.email.trim() || undefined,
					company: newContact.company.trim() || undefined,
					channel: newContact.channel,
					followUpAt: newContact.followUpAt
						? new Date(newContact.followUpAt).toISOString()
						: undefined,
					dealName: name,
					dealValue: value,
					dealStage: newDeal.stage || undefined,
					productInterest: newDeal.product.trim() || undefined,
					assigneeId: mustPickAssignee ? assigneeId : undefined,
				})
			} else {
				await dealsApi.create({
					name,
					contactId: pickedContact!.id,
					product: newDeal.product.trim() || null,
					value,
					stage: newDeal.stage || undefined,
					// The deal follows whoever already works the contact, so an
					// administrator filing one does not become its owner by accident.
					ownerId: pickedContact!.owner_id || undefined,
				})
			}
			setCreating(false)
			await load()
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Deal belum dapat dibuat.')
		} finally {
			setCreatingBusy(false)
		}
	}, [newDeal, pickedContact, makingContact, newContact, mustPickAssignee, assigneeId, load])

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
						{/* One entry point. "Tambah Prospek" used to sit beside this and
						    also produced a deal, so from this page the two read as two
						    ways to do the same thing. Creating the person now happens
						    inside the dialog, at the moment the contact search comes up
						    empty. */}
						<button
							type="button"
							className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90"
							onClick={openCreate}
							disabled={loading || stages.length === 0}
						>
							<Plus size={14} /> Tambah Deal
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
						{/* Which board. Each pipeline has its own columns and its own
						    deals, so this switches the whole page rather than filtering
						    what is already on it. */}
						<label className="mr-2 flex items-center gap-1.5 text-xs text-muted-foreground">
							Pipeline
							<select
								value={pipeline}
								onChange={(event) => setPipeline(event.target.value)}
								className="rounded-md border border-border bg-background px-2 py-1 text-xs font-semibold text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
							>
								{pipelines.map((option) => (
									<option key={option.id} value={option.id}>
										{option.label}
									</option>
								))}
							</select>
						</label>
						{SHOW_BUCKET_FILTERS ? (
							BUCKET_FILTERS.map((option) => (
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
							))
						) : null}
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
											{deal.contactName || '-'}
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
												deal.companyName || '-'
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
												{deal.ownerName || '-'}
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
						onLoadMore={(stageId) => void loadMoreStage(stageId)}
						loadingStage={loadingStage}
					/>
				)}
			</div>

			<Dialog
				open={creating}
				onOpenChange={(open) => !creatingBusy && !open && setCreating(false)}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Tambah Deal</DialogTitle>
						<DialogDescription>
							Untuk deal yang tidak datang dari lead, misalnya hasil telepon atau
							pertemuan langsung.
						</DialogDescription>
					</DialogHeader>

					<div className="space-y-3">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">
								Nama deal *
							</span>
							<input
								className="ocm-input"
								value={newDeal.name}
								onChange={(event) => setNewDeal((d) => ({ ...d, name: event.target.value }))}
								placeholder="mis. ZWCAD 2026 untuk 10 seat"
							/>
						</label>

						<div className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">
								Kontak *
							</span>
							{makingContact ? (
								<div className="space-y-2 rounded-lg border border-border p-2.5">
									<div className="flex items-center justify-between gap-2">
										<span className="text-xs font-semibold">Kontak baru</span>
										<button
											type="button"
											className="text-xs text-muted-foreground hover:text-foreground"
											onClick={() => {
												setMakingContact(false)
												setDuplicate(null)
											}}
										>
											Cari yang sudah ada
										</button>
									</div>

									{/* Stated before saving, not after: a sales who cannot see
									    that the person is already someone's is exactly who
									    creates the second follow-up task. */}
									{duplicate ? (
										<div className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-xs text-amber-800 dark:text-amber-300">
											<TriangleAlert size={13} className="mt-0.5 shrink-0" />
											<span>
												<strong>{duplicate.name || 'Kontak ini'}</strong> sudah ada di CRM
												{duplicate.ownerName ? `, dipegang ${duplicate.ownerName}` : ''}.
												{duplicate.openTasks > 0
													? ` Ada ${duplicate.openTasks} tugas follow-up terbuka.`
													: ''}
												{duplicate.openDeals > 0
													? ` Ada ${duplicate.openDeals} deal berjalan.`
													: ''}{' '}
												Menyimpan akan menambah tugas follow-up baru untuk orang yang sama.
											</span>
										</div>
									) : null}

									<div className="grid gap-2 sm:grid-cols-2">
										<input
											className="ocm-input"
											value={newContact.name}
											onChange={(event) =>
												setNewContact((c) => ({ ...c, name: event.target.value }))
											}
											placeholder="Nama kontak *"
										/>
										<input
											className="ocm-input"
											value={newContact.phone}
											onChange={(event) =>
												setNewContact((c) => ({ ...c, phone: event.target.value }))
											}
											placeholder="No. WhatsApp"
										/>
										<input
											className="ocm-input"
											value={newContact.email}
											onChange={(event) =>
												setNewContact((c) => ({ ...c, email: event.target.value }))
											}
											placeholder="Email"
										/>
										<input
											className="ocm-input"
											value={newContact.company}
											onChange={(event) =>
												setNewContact((c) => ({ ...c, company: event.target.value }))
											}
											placeholder="Perusahaan"
										/>
										<select
											className="ocm-input"
											value={newContact.channel}
											onChange={(event) =>
												setNewContact((c) => ({
													...c,
													channel: event.target.value as ProspectChannel,
												}))
											}
										>
											{PROSPECT_CHANNELS.map((option) => (
												<option key={option.value} value={option.value}>
													Dari {option.label}
												</option>
											))}
										</select>
										<input
											type="datetime-local"
											className="ocm-input"
											value={newContact.followUpAt}
											onChange={(event) =>
												setNewContact((c) => ({ ...c, followUpAt: event.target.value }))
											}
											title="Tanggal follow-up"
										/>
									</div>
								{mustPickAssignee ? (
										<select
											className="ocm-input"
											value={assigneeId}
											onChange={(event) => setAssigneeId(event.target.value)}
										>
											<option value="">Tugaskan ke *</option>
											{assignables.map((option) => (
												<option key={option.userId} value={option.userId}>
													{option.name || option.email}
													{option.teamName ? ` · ${option.teamName}` : ''}
												</option>
											))}
										</select>
									) : null}
									<p className="text-[11px] text-muted-foreground">
										Kontak, perusahaan, dan tugas follow-up dibuat sekalian dengan deal ini.
									</p>
								</div>
							) : pickedContact ? (
								<div className="flex items-start justify-between gap-2 rounded-lg border border-border p-2.5">
									<div className="min-w-0">
										<p className="truncate text-sm font-semibold">
											{pickedContact.name || 'Tanpa nama'}
										</p>
										<p className="truncate text-xs text-muted-foreground">
											{pickedContact.email || pickedContact.phone_number || '-'}
										</p>
										{/* The firm is shown, not chosen: it follows the contact, which
										    is the whole reason the two are linked. */}
										{pickedContact.company_name ? (
											<p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
												<Building2 size={11} className="shrink-0" />
												{pickedContact.company_name}
											</p>
										) : (
											<p className="mt-0.5 text-xs text-muted-foreground">
												Belum terhubung ke perusahaan
											</p>
										)}
									</div>
									<button
										type="button"
										className="shrink-0 text-xs text-muted-foreground hover:text-foreground"
										onClick={() => {
											setPickedContact(null)
											setContactQuery('')
										}}
									>
										Ganti
									</button>
								</div>
							) : (
								<>
									<input
										className="ocm-input"
										value={contactQuery}
										onChange={(event) => setContactQuery(event.target.value)}
										placeholder="Cari nama, email, atau nomor..."
									/>
									{contactResults.length > 0 ? (
										<div className="mt-1 max-h-44 overflow-y-auto rounded-lg border border-border">
											{contactResults.map((contact) => (
												<button
													key={contact.id}
													type="button"
													onClick={() => setPickedContact(contact)}
													className="block w-full border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted/50"
												>
													<span className="block truncate text-sm">
														{contact.name || 'Tanpa nama'}
													</span>
													<span className="block truncate text-xs text-muted-foreground">
														{contact.company_name || contact.email || contact.phone_number || '-'}
													</span>
												</button>
											))}
										</div>
									) : contactQuery.trim().length >= 2 ? (
										<p className="mt-1 text-xs text-muted-foreground">
											Tidak ada kontak yang cocok.
										</p>
									) : null}
									{/* Offered where the dead end happens, so "orang ini belum ada
									    di CRM" does not mean starting over on another page. */}
									<button
										type="button"
										onClick={() => {
											setMakingContact(true)
											setNewContact((c) => ({ ...c, name: contactQuery.trim() }))
										}}
										className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
									>
										<Plus size={12} /> Kontak belum ada? Buat baru
									</button>
								</>
							)}
						</div>

						<div className="grid gap-3 sm:grid-cols-2">
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									Produk
								</span>
								<input
									className="ocm-input"
									value={newDeal.product}
									onChange={(event) =>
										setNewDeal((d) => ({ ...d, product: event.target.value }))
									}
									placeholder="mis. ZWCAD 2026 Professional"
								/>
							</label>
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									Nilai (Rp)
								</span>
								<input
									className="ocm-input text-right tabular-nums"
									inputMode="numeric"
									value={newDeal.value}
									onChange={(event) => setNewDeal((d) => ({ ...d, value: event.target.value }))}
									placeholder="Kosongkan bila belum tahu"
								/>
							</label>
						</div>

						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">
								Tahap
							</span>
							<select
								className="ocm-input"
								value={newDeal.stage}
								onChange={(event) => setNewDeal((d) => ({ ...d, stage: event.target.value }))}
							>
								{stages.map((stage) => (
									<option key={stage.id} value={stage.id}>
										{stage.label}
									</option>
								))}
							</select>
						</label>
					</div>

					<DialogFooter>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => setCreating(false)}
							disabled={creatingBusy}
						>
							Batal
						</button>
						<button
							type="button"
							className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90"
							onClick={() => void submitCreate()}
							disabled={
								creatingBusy ||
								!newDeal.name.trim() ||
								(makingContact ? !newContact.name.trim() : !pickedContact)
							}
						>
							{creatingBusy ? <Loader2 size={14} className="animate-spin" /> : null}
							Simpan
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>


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
