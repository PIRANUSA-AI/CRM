import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Building2, Filter, Loader2, MoreHorizontal, Plus, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
	CrmAvatar,
	CrmEmptyState,
	CrmSectionHeader,
	unwrapPayload,
} from '@/components/crm/shared'
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
	customers as customersApi,
	leadImport,
	teams as teamsApi,
} from '@/lib/api'

export const Route = createFileRoute('/_app/customers/')({
	component: CustomersPage,
})

type CustomerRow = {
	id: string
	name: string
	phone: string
	email: string
	city: string
	stage: string
	tags: string[]
	companyName: string | null
	companyId: string | null
	ownerName: string | null
	dealCount: number
	createdAt: string | null
	updatedAt: string | null
	lastSeen: string
	lastSeenMinutes: number | null
}

type CustomerStats = {
	total: number
}

type CustomerListMeta = {
	page: number
	perPage: number
	total: number
}

// Segments the business actually asks for. The previous set (VIP by LTV, cart
// abandon, komplain, churn risk) came from an e-commerce template and had no
// meaning for a CAD reseller — and none of it was filtered server-side, so the
// chip counts only ever described the ten rows on screen.
type SegmentId = 'all' | 'belum_beli' | 'sering_beli' | 'idle_90d' | 'prospek'

type SegmentChip = {
	id: SegmentId
	label: string
}

const SEGMENT_CHIPS: SegmentChip[] = [
	{ id: 'all', label: 'Semua' },
	{ id: 'prospek', label: 'Masih prospek' },
	{ id: 'belum_beli', label: 'Belum pernah beli' },
	{ id: 'sering_beli', label: 'Sering beli' },
	{ id: 'idle_90d', label: 'Idle 90 hari' },
]

const CUSTOMER_PAGE_SIZE = 10

function asRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

function toNumber(value: unknown, fallback = 0) {
	if (typeof value === 'number' && Number.isFinite(value)) return value
	if (typeof value === 'string') {
		const parsed = Number(value)
		if (Number.isFinite(parsed)) return parsed
	}
	return fallback
}

function toText(value: unknown, fallback = '-') {
	if (typeof value === 'string') {
		const trimmed = value.trim()
		return trimmed.length > 0 ? trimmed : fallback
	}
	if (typeof value === 'number' && Number.isFinite(value)) {
		return String(value)
	}
	return fallback
}

function extractStatsPayload(input: unknown): Record<string, unknown> | null {
	const base = asRecord(input)
	if (!base) return null

	const firstLevel = asRecord(base.payload)
	if (firstLevel) return firstLevel

	const secondLevel = asRecord(base.data)
	if (secondLevel) return secondLevel

	return null
}

function extractListMeta(input: unknown): CustomerListMeta | null {
	const base = asRecord(input)
	if (!base) return null

	const nestedData = asRecord(base.data)
	const nestedPayload = asRecord(base.payload)
	const meta =
		asRecord(base.meta) ||
		asRecord(nestedData?.meta) ||
		asRecord(nestedPayload?.meta)
	if (!meta) return null

	const total = toNumber(meta.total, Number.NaN)
	if (!Number.isFinite(total) || total < 0) return null

	return {
		page: Math.max(1, toNumber(meta.page ?? meta.current_page, 1)),
		perPage: Math.max(
			1,
			toNumber(meta.per_page ?? meta.perPage ?? meta.limit, CUSTOMER_PAGE_SIZE),
		),
		total,
	}
}

function stageTagClass(stage: string) {
	if (stage === 'advocate' || stage === 'closed')
		return 'ocm-tag ocm-tag-success'
	if (stage === 'quoted') return 'ocm-tag ocm-tag-warning'
	if (stage === 'retention') return 'ocm-tag ocm-tag-danger'
	return 'ocm-tag'
}

function formatLastSeen(minutes: number | null) {
	if (minutes === null || !Number.isFinite(minutes)) return '-'
	if (minutes < 60) return `${Math.max(Math.round(minutes), 1)}m`
	if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h`
	return `${Math.floor(minutes / (24 * 60))}d`
}

function formatStageLabel(stage: string) {
	return stage.replaceAll('_', ' ')
}

/** Matches the Perusahaan list, so a date reads the same on both pages. */
function formatMoment(value: string | null): string {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleString('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function mapCustomer(input: Record<string, unknown>): CustomerRow | null {
	const id = toText(input.id, '')
	if (!id) return null

	const customAttributes = asRecord(input.custom_attributes)

	const tags = (Array.isArray(input.tags) ? input.tags : [])
		.map((tag) => {
			if (typeof tag === 'string') return tag.trim()
			if (typeof tag === 'number') return String(tag)
			const tagRecord = asRecord(tag)
			return tagRecord ? toText(tagRecord.name, '') : ''
		})
		.filter(Boolean)


	const dateRaw = input.last_contact_at || input.updated_at || input.created_at
	const date =
		dateRaw instanceof Date ||
		typeof dateRaw === 'string' ||
		typeof dateRaw === 'number'
			? new Date(dateRaw)
			: null
	let diffMinutes: number | null = null
	if (date && !Number.isNaN(date.getTime())) {
		diffMinutes = Math.max(
			1,
			Math.floor((Date.now() - date.getTime()) / (1000 * 60)),
		)
	}

	const city =
		toText(input.city, '') ||
		toText(customAttributes?.city, '') ||
		toText(customAttributes?.kota, '') ||
		'-'
	const stage = (
		toText(input.pipeline_stage_name, '') ||
		toText(customAttributes?.pipeline_stage_name, '') ||
		'inquiry'
	).toLowerCase()

	return {
		id,
		name: toText(input.name, 'Kontak'),
		phone: toText(input.phone_number, toText(input.phone, '')),
		email: toText(input.email, ''),
		city,
		stage,
		tags,
		companyName: toText(input.company_name, '') || null,
		companyId: toText(input.company_id, '') || null,
		ownerName: toText(input.owner_name, '') || null,
		dealCount: Number(input.deal_count ?? 0),
		createdAt: toText(input.created_at, '') || null,
		updatedAt: toText(input.updated_at, '') || null,
		lastSeenMinutes: diffMinutes,
		lastSeen: formatLastSeen(diffMinutes),
	}
}

const EMPTY_NEW_CUSTOMER = {
	name: '',
	phone_number: '',
	email: '',
	company: '',
	city: '',
	notes: '',
}

function CustomersPage() {
	const navigate = useNavigate()
	const currentUser = useCurrentUser()
	const isLeader = isSupervisorRole(currentUser?.role)
	const openDetail = (id: string) =>
		navigate({ to: '/customers/$customerId', params: { customerId: id } })
	const [addOpen, setAddOpen] = useState(false)
	const [newCustomer, setNewCustomer] = useState(EMPTY_NEW_CUSTOMER)
	const [addSaving, setAddSaving] = useState(false)
	const [addError, setAddError] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [rows, setRows] = useState<CustomerRow[]>([])
	const [stats, setStats] = useState<CustomerStats>({ total: 0 })
	const [activeSegment, setActiveSegment] = useState<SegmentId>('all')
	const [teamFilter, setTeamFilter] = useState('')
	const [ownerFilter, setOwnerFilter] = useState('')
	const [teamOptions, setTeamOptions] = useState<Array<{ id: string; name: string }>>([])
	const [salesOptions, setSalesOptions] = useState<
		Array<{ userId: string; name: string | null; email: string }>
	>([])
	const [currentPage, setCurrentPage] = useState(1)
	const [paginationMeta, setPaginationMeta] = useState<CustomerListMeta>({
		page: 1,
		perPage: CUSTOMER_PAGE_SIZE,
		total: 0,
	})

	const syncRows = (nextRows: CustomerRow[]) => {
		setRows(nextRows)
	}

	const syncCurrentPage = (nextPage: number) => {
		setCurrentPage(nextPage)
	}

	const loadPage = async (
		page: number,
		options?: {
			includeStats?: boolean
			segment?: SegmentId
			teamId?: string
			ownerId?: string
		},
	) => {
		const includeStats = options?.includeStats === true
		const nextPage = Math.max(1, page)
		// Filters are read from the arguments rather than state so a chip click
		// can load with its own value immediately, instead of one render late.
		const segment = options?.segment ?? activeSegment
		const teamId = options?.teamId ?? teamFilter
		const ownerId = options?.ownerId ?? ownerFilter

		setLoading(true)
		setLoadError(null)

		try {
			const [listResult, statsResult] = await Promise.allSettled([
				customersApi.list({
					page: nextPage,
					per_page: CUSTOMER_PAGE_SIZE,
					segment: segment === 'all' ? undefined : segment,
					team_id: teamId || undefined,
					owner_id: ownerId || undefined,
				}),
				includeStats ? customersApi.stats() : Promise.resolve(null),
			])

			if (listResult.status !== 'fulfilled') throw listResult.reason

			const mappedRows = unwrapPayload<Record<string, unknown>>(listResult.value)
				.map(mapCustomer)
				.filter((row): row is CustomerRow => row !== null)
			const listMeta = extractListMeta(listResult.value)
			const fallbackTotal =
				mappedRows.length >= CUSTOMER_PAGE_SIZE
					? nextPage * CUSTOMER_PAGE_SIZE + 1
					: (nextPage - 1) * CUSTOMER_PAGE_SIZE + mappedRows.length
			const totalFromListMeta = listMeta?.total ?? fallbackTotal
			const perPageFromListMeta = listMeta?.perPage ?? CUSTOMER_PAGE_SIZE

			syncRows(mappedRows)
			syncCurrentPage(listMeta?.page ?? nextPage)
			setPaginationMeta({
				page: listMeta?.page ?? nextPage,
				perPage: perPageFromListMeta,
				total: totalFromListMeta,
			})

			let total = totalFromListMeta
			if (includeStats) {
				if (statsResult.status === 'fulfilled' && statsResult.value) {
					const statsPayload = extractStatsPayload(statsResult.value)
					if (statsPayload) {
						total = toNumber(
							statsPayload.total ||
								statsPayload.contacts_total ||
								statsPayload.total_contacts,
							total,
						)
					}
				}
			}
			setStats({ total })
		} catch (error) {
			const message =
				error instanceof Error && error.message
					? error.message
					: 'Data kontak gagal dimuat.'
			setLoadError(message)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		void loadPage(1, { includeStats: true })
	}, [])

	// Team and sales pickers are a leader's tool — a sales only ever sees their
	// own contacts, so the dropdowns would filter a list of one person's rows by
	// that same person.
	useEffect(() => {
		if (!isLeader) return
		let active = true
		void teamsApi
			.list()
			.then((response) => {
				if (!active) return
				setTeamOptions(
					(response.payload || []).map((team: { id: string; name: string }) => ({
						id: team.id,
						name: team.name,
					})),
				)
			})
			.catch(() => undefined)
		void leadImport
			.assignables()
			.then((response) => {
				if (active) setSalesOptions(response.data || [])
			})
			.catch(() => undefined)
		return () => {
			active = false
		}
	}, [isLeader])

	const submitNewCustomer = async () => {
		setAddSaving(true)
		setAddError(null)
		try {
			await customersApi.create({
				name: newCustomer.name.trim(),
				phone_number: newCustomer.phone_number.trim() || undefined,
				email: newCustomer.email.trim() || undefined,
				company: newCustomer.company.trim() || undefined,
				city: newCustomer.city.trim() || undefined,
				notes: newCustomer.notes.trim() || undefined,
			})
			setAddOpen(false)
			setNewCustomer(EMPTY_NEW_CUSTOMER)
			// Back to page 1 with fresh stats — the new contact is the newest row.
			await loadPage(1, { includeStats: true })
		} catch (error) {
			setAddError(
				error instanceof Error ? error.message : 'Kontak gagal ditambahkan.',
			)
		} finally {
			setAddSaving(false)
		}
	}

	// Filtering happens on the server now, so what came back is what matches.
	const filteredRows = rows

	const applyFilters = (next: {
		segment?: SegmentId
		teamId?: string
		ownerId?: string
	}) => {
		if (next.segment !== undefined) setActiveSegment(next.segment)
		if (next.teamId !== undefined) setTeamFilter(next.teamId)
		if (next.ownerId !== undefined) setOwnerFilter(next.ownerId)
		void loadPage(1, next)
	}

	const listStatusLabel = useMemo(() => {
		if (loading) return 'Sinkronisasi data...'
		const matching = paginationMeta.total.toLocaleString('id-ID')
		const totalCount = stats.total.toLocaleString('id-ID')
		const filtered =
			activeSegment !== 'all' || teamFilter !== '' || ownerFilter !== ''
		return filtered
			? `${matching} kontak cocok · dari ${totalCount} total`
			: `${totalCount} kontak`
	}, [activeSegment, teamFilter, ownerFilter, loading, paginationMeta.total, stats.total])

	const totalPages = Math.max(
		1,
		Math.ceil(paginationMeta.total / Math.max(paginationMeta.perPage, 1)),
	)
	const clampedCurrentPage = Math.min(currentPage, totalPages)
	const pageStart =
		paginationMeta.total === 0
			? 0
			: (clampedCurrentPage - 1) * paginationMeta.perPage + 1
	const pageEnd = Math.min(
		clampedCurrentPage * paginationMeta.perPage,
		paginationMeta.total,
	)
	const pageNumbers = useMemo(() => {
		const start = Math.max(1, clampedCurrentPage - 2)
		const end = Math.min(totalPages, start + 4)
		const adjustedStart = Math.max(1, end - 4)
		return Array.from(
			{ length: end - adjustedStart + 1 },
			(_, index) => adjustedStart + index,
		)
	}, [clampedCurrentPage, totalPages])

	const goToPage = (page: number) => {
		const targetPage = Math.min(Math.max(1, page), totalPages)
		if (targetPage === currentPage && rows.length > 0) return
		void loadPage(targetPage)
	}

	const cityDistribution = useMemo(() => {
		if (rows.length === 0) return []
		const counts = new Map<string, number>()
		for (const row of rows) {
			const city = row.city && row.city !== '-' ? row.city : 'Tidak diketahui'
			counts.set(city, (counts.get(city) || 0) + 1)
		}
		return Array.from(counts.entries())
			.map(([city, count]) => ({
				city,
				share: rows.length > 0 ? Math.round((count / rows.length) * 100) : 0,
			}))
			.sort((a, b) => b.share - a.share)
			.slice(0, 6)
	}, [rows])

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Kontak 360"
				subtitle={`${stats.total.toLocaleString('id-ID')} kontak · unified dari WA Meta + Baileys + marketplace`}
				actions={
					<>
						<button type="button" className="ocm-btn">
							<Filter size={14} />
							Segmentasi
						</button>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => navigate({ to: '/import' })}
						>
							<Upload size={14} />
							Import CSV
						</button>
						<button
							type="button"
							className="ocm-btn ocm-btn-primary"
							onClick={() => {
								setAddError(null)
								setAddOpen(true)
							}}
						>
							<Plus size={14} />
							Tambah
						</button>
					</>
				}
			/>

			<div className="flex flex-wrap items-center gap-2">
				{SEGMENT_CHIPS.map((chip) => (
					<button
						type="button"
						key={chip.id}
						onClick={() => applyFilters({ segment: chip.id })}
						className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
							activeSegment === chip.id
								? 'border-primary/40 bg-primary/15 text-primary'
								: 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
						}`}
						>
							<span>{chip.label}</span>
						</button>
				))}

				{isLeader ? (
					<>
						<select
							value={teamFilter}
							onChange={(event) => applyFilters({ teamId: event.target.value })}
							className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						>
							<option value="">Semua tim</option>
							{teamOptions.map((team) => (
								<option key={team.id} value={team.id}>
									{team.name}
								</option>
							))}
						</select>
						<select
							value={ownerFilter}
							onChange={(event) => applyFilters({ ownerId: event.target.value })}
							className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
						>
							<option value="">Semua sales</option>
							{salesOptions.map((option) => (
								<option key={option.userId} value={option.userId}>
									{option.name || option.email}
								</option>
							))}
						</select>
					</>
				) : null}

				{activeSegment !== 'all' || teamFilter || ownerFilter ? (
					<button
						type="button"
						onClick={() => applyFilters({ segment: 'all', teamId: '', ownerId: '' })}
						className="rounded-full px-2 py-1.5 text-[11px] font-semibold text-muted-foreground underline hover:text-foreground"
					>
						Reset
					</button>
				) : null}
			</div>

			<section className="ocm-card overflow-hidden">
				<div className="ocm-card-header">
					<h2 className="ocm-card-title">Daftar Kontak</h2>
					<div className="text-xs text-muted-foreground">{listStatusLabel}</div>
				</div>

				{loading && rows.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">
						Memuat kontak...
					</div>
				) : loadError && rows.length === 0 ? (
					<div className="p-3">
						<CrmEmptyState
							title="Gagal memuat kontak"
							description={loadError}
							action={
								<button
									type="button"
									className="ocm-btn"
									onClick={() =>
										void loadPage(1, { includeStats: true })
									}
								>
									Coba lagi
								</button>
							}
						/>
					</div>
				) : filteredRows.length === 0 ? (
					<div className="p-3">
						<CrmEmptyState
							title="Tidak ada kontak"
							description="Data kontak belum tersedia untuk filter ini."
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[1180px]">
							<div className="grid grid-cols-[30px_1.8fr_170px_80px_140px_110px_140px_170px_34px] items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
								<div></div>
								<div>Nama</div>
								<div>Nomor WA</div>
								<div>Orders</div>
								<div>LTV</div>
								<div>Kota</div>
								<div>Stage</div>
								<div>Tags</div>
								<div></div>
							</div>
							{filteredRows.map((row) => (
								<div
									key={row.id}
									role="button"
									tabIndex={0}
									onClick={() => openDetail(row.id)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') openDetail(row.id)
									}}
									className="grid cursor-pointer grid-cols-[30px_1.6fr_1.3fr_150px_130px_150px_130px_34px] items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40"
								>
									<div>
										<input
											type="checkbox"
											aria-label={`select-${row.id}`}
											onClick={(event) => event.stopPropagation()}
											className="h-3.5 w-3.5 rounded border-border accent-primary"
										/>
									</div>
									<div className="flex min-w-0 items-center gap-2.5">
										<CrmAvatar name={row.name} size={28} />
										<div className="min-w-0">
											<p className="truncate text-sm font-semibold">
												{row.name}
											</p>
											<p className="text-[10px] text-muted-foreground">
												last seen {row.lastSeen} ago
											</p>
										</div>
									</div>
									{/* Email and phone in one column, as the team's own tool shows
									    them: a contact usually has one or the other, so two columns
									    left one of them empty on most rows. */}
									<div className="min-w-0 text-xs text-muted-foreground">
										{row.email ? <p className="truncate">{row.email}</p> : null}
										{row.phone ? <p className="truncate font-mono">{row.phone}</p> : null}
										{!row.email && !row.phone ? <span>-</span> : null}
									</div>
									<div className="min-w-0 text-xs text-muted-foreground">
										{row.companyName ? (
											<span className="flex items-center gap-1">
												<Building2 size={11} className="shrink-0" />
												<span className="truncate">{row.companyName}</span>
											</span>
										) : null}
										{row.dealCount > 0 ? (
											<span className="mt-0.5 block">{row.dealCount} deal</span>
										) : null}
										{!row.companyName && row.dealCount === 0 ? <span>-</span> : null}
									</div>
									<div>
										<span className={stageTagClass(row.stage)}>
											{formatStageLabel(row.stage)}
										</span>
									</div>
									<div className="text-[11px] text-muted-foreground">
										<span className="block">{formatMoment(row.createdAt)}</span>
										<span className="block">{formatMoment(row.updatedAt)}</span>
									</div>
									<div className="truncate text-xs text-muted-foreground">
										{row.ownerName || 'Belum ada'}
									</div>
									<div className="flex justify-end">
										<button
											type="button"
											aria-label="Buka detail kontak"
											title="Buka detail"
											onClick={(event) => {
												event.stopPropagation()
												openDetail(row.id)
											}}
											className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
										>
											<MoreHorizontal size={14} />
										</button>
									</div>
								</div>
							))}
						</div>
					</div>
				)}

				{!(loading && rows.length === 0) && !(loadError && rows.length === 0) ? (
					<div className="border-t border-border px-4 py-3">
						<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
							<div>
								{loadError
									? 'Gagal memuat halaman. Coba pindah halaman atau refresh.'
									: loading
										? 'Memuat halaman kontak...'
										: paginationMeta.total === 0
											? 'Tidak ada kontak'
											: `Menampilkan ${pageStart.toLocaleString('id-ID')}-${pageEnd.toLocaleString('id-ID')} dari ${paginationMeta.total.toLocaleString('id-ID')} kontak`}
							</div>
							<div className="flex flex-wrap items-center gap-1">
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(1)}
									disabled={loading || clampedCurrentPage <= 1}
								>
									Awal
								</button>
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(clampedCurrentPage - 1)}
									disabled={loading || clampedCurrentPage <= 1}
								>
									Sebelumnya
								</button>
								{pageNumbers.map((pageNumber) => (
									<button
										type="button"
										key={pageNumber}
										onClick={() => goToPage(pageNumber)}
										disabled={loading || pageNumber === clampedCurrentPage}
										className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
											pageNumber === clampedCurrentPage
												? 'border-primary bg-primary text-primary-foreground'
												: 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground'
										}`}
									>
										{pageNumber.toLocaleString('id-ID')}
									</button>
								))}
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(clampedCurrentPage + 1)}
									disabled={loading || clampedCurrentPage >= totalPages}
								>
									Berikutnya
								</button>
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(totalPages)}
									disabled={loading || clampedCurrentPage >= totalPages}
								>
									Akhir
								</button>
							</div>
						</div>
					</div>
				) : null}
			</section>

			<div className="ocm-grid-3">
				<section className="ocm-card p-4">
					<h2 className="text-sm font-semibold">Distribusi Kota</h2>
					{cityDistribution.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">
							Data kota belum tersedia dari API.
						</p>
					) : (
						<div className="mt-3 space-y-2.5">
							{cityDistribution.map((item) => (
								<div key={item.city}>
									<div className="mb-1 flex items-center justify-between text-xs">
										<span>{item.city}</span>
										<span className="font-mono text-[11px] text-muted-foreground">
											{item.share}%
										</span>
									</div>
									<div className="ocm-progress-track">
										<div
											className="ocm-progress-bar"
											style={{ width: `${Math.min(item.share, 100)}%` }}
										/>
									</div>
								</div>
							))}
						</div>
					)}
				</section>

				<section className="ocm-card p-4">
					<h2 className="text-sm font-semibold">Sumber Akuisisi</h2>
					<p className="mt-3 text-sm text-muted-foreground">
						Data sumber akuisisi belum tersedia dari API.
					</p>
				</section>

				<section className="ocm-card p-4">
					<h2 className="text-sm font-semibold">Sapaan yang dipakai (auto)</h2>
					<p className="mt-3 text-sm text-muted-foreground">
						Data sapaan otomatis belum tersedia dari API.
					</p>
				</section>
			</div>

			<Dialog open={addOpen} onOpenChange={(open) => !addSaving && setAddOpen(open)}>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Tambah Kontak</DialogTitle>
						<DialogDescription>
							Catat kontak yang belum pernah masuk lewat WhatsApp atau import.
						</DialogDescription>
					</DialogHeader>

					<div className="grid gap-3 sm:grid-cols-2">
						<NewCustomerField label="Nama *">
							<input
								className="ocm-input"
								value={newCustomer.name}
								onChange={(event) =>
									setNewCustomer((prev) => ({ ...prev, name: event.target.value }))
								}
								placeholder="Nama kontak"
							/>
						</NewCustomerField>
						<NewCustomerField label="No. WhatsApp">
							<input
								className="ocm-input"
								value={newCustomer.phone_number}
								onChange={(event) =>
									setNewCustomer((prev) => ({ ...prev, phone_number: event.target.value }))
								}
								placeholder="08xx / 62xx"
							/>
						</NewCustomerField>
						<NewCustomerField label="Email">
							<input
								className="ocm-input"
								value={newCustomer.email}
								onChange={(event) =>
									setNewCustomer((prev) => ({ ...prev, email: event.target.value }))
								}
								placeholder="email@perusahaan.com"
							/>
						</NewCustomerField>
						<NewCustomerField label="Perusahaan">
							<input
								className="ocm-input"
								value={newCustomer.company}
								onChange={(event) =>
									setNewCustomer((prev) => ({ ...prev, company: event.target.value }))
								}
							/>
						</NewCustomerField>
						<NewCustomerField label="Kota">
							<input
								className="ocm-input"
								value={newCustomer.city}
								onChange={(event) =>
									setNewCustomer((prev) => ({ ...prev, city: event.target.value }))
								}
							/>
						</NewCustomerField>
					</div>
					<div className="mt-3">
						<NewCustomerField label="Catatan">
							<textarea
								rows={2}
								className="ocm-input resize-y"
								value={newCustomer.notes}
								onChange={(event) =>
									setNewCustomer((prev) => ({ ...prev, notes: event.target.value }))
								}
							/>
						</NewCustomerField>
					</div>

					<p className="mt-2 text-[11px] text-muted-foreground">
						Isi minimal nomor WhatsApp atau email.
					</p>

					{addError ? (
						<p className="mt-2 rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
							{addError}
						</p>
					) : null}

					<DialogFooter>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => setAddOpen(false)}
							disabled={addSaving}
						>
							Batal
						</button>
						<button
							type="button"
							className="ocm-btn ocm-btn-primary"
							onClick={() => void submitNewCustomer()}
							disabled={addSaving || !newCustomer.name.trim()}
						>
							{addSaving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
							Simpan
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</main>
	)
}

function NewCustomerField({
	label,
	children,
}: {
	label: string
	children: React.ReactNode
}) {
	return (
		<label className="block">
			<span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
			{children}
		</label>
	)
}
