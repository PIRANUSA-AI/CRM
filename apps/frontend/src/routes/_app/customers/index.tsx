import { createFileRoute } from '@tanstack/react-router'
import { Filter, MoreHorizontal, Plus, Upload } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import {
	CrmAvatar,
	CrmEmptyState,
	CrmSectionHeader,
	unwrapPayload,
} from '@/components/crm/shared'
import { customers as customersApi } from '@/lib/api'

export const Route = createFileRoute('/_app/customers/')({
	component: CustomersPage,
})

type CustomerRow = {
	id: string
	name: string
	phone: string
	city: string
	stage: string
	tags: string[]
	ltv: string
	ltvAmount: number
	orders: number
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

type SegmentId =
	| 'all'
	| 'vip'
	| 'repeat_buyer'
	| 'never_buy'
	| 'cart_abandon_48h'
	| 'komplain_open'
	| 'idle_90d'
	| 'high_churn_risk'

type SegmentChip = {
	id: SegmentId
	label: string
}

const SEGMENT_CHIPS: SegmentChip[] = [
	{ id: 'all', label: 'Semua' },
	{ id: 'vip', label: 'VIP (LTV > Rp 10jt)' },
	{ id: 'repeat_buyer', label: 'Repeat buyer' },
	{ id: 'never_buy', label: 'Belum pernah beli' },
	{ id: 'cart_abandon_48h', label: 'Cart abandon 48h' },
	{ id: 'komplain_open', label: 'Komplain open' },
	{ id: 'idle_90d', label: 'Idle 90d' },
	{ id: 'high_churn_risk', label: 'High churn risk' },
]

const IDR_FORMATTER = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0,
})

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

function tagClass(tag: string) {
	const normalized = tag.toLowerCase()
	if (normalized === 'vip') return 'ocm-tag ocm-tag-warning'
	if (normalized === 'komplain') return 'ocm-tag ocm-tag-danger'
	if (normalized === 'advocate') return 'ocm-tag ocm-tag-success'
	return 'ocm-tag'
}

function formatLtv(amount: number) {
	if (!Number.isFinite(amount) || amount <= 0) return 'Rp 0'
	return IDR_FORMATTER.format(amount).replace(/\u00a0/g, ' ')
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

function matchesSegment(row: CustomerRow, segment: SegmentId) {
	const tags = row.tags.map((tag) => tag.toLowerCase())

	switch (segment) {
		case 'all':
			return true
		case 'vip':
			return row.ltvAmount >= 10_000_000
		case 'repeat_buyer':
			return row.orders >= 2
		case 'never_buy':
			return row.orders === 0
		case 'cart_abandon_48h':
			return (
				tags.some((tag) => tag.includes('cart')) ||
				(row.stage === 'inquiry' && row.orders === 0)
			)
		case 'komplain_open':
			return tags.includes('komplain') || row.stage === 'retention'
		case 'idle_90d':
			return (
				typeof row.lastSeenMinutes === 'number' &&
				row.lastSeenMinutes >= 90 * 24 * 60
			)
		case 'high_churn_risk':
			return row.stage === 'retention'
		default:
			return true
	}
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

	const ltvNumber = toNumber(input.total_spent, toNumber(input.ltv, 0))
	const orderCount = toNumber(
		input.paid_order_count,
		toNumber(
			input.order_count,
			toNumber(input.total_orders, toNumber(input.orders, 0)),
		),
	)

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
		name: toText(input.name, 'Pelanggan'),
		phone: toText(input.phone_number, toText(input.phone, '-')),
		city,
		stage,
		tags,
		ltvAmount: ltvNumber,
		ltv: formatLtv(ltvNumber),
		orders: orderCount,
		lastSeenMinutes: diffMinutes,
		lastSeen: formatLastSeen(diffMinutes),
	}
}

function CustomersPage() {
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState<string | null>(null)
	const [rows, setRows] = useState<CustomerRow[]>([])
	const [stats, setStats] = useState<CustomerStats>({ total: 0 })
	const [activeSegment, setActiveSegment] = useState<SegmentId>('all')
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
		options?: { includeStats?: boolean },
	) => {
		const includeStats = options?.includeStats === true
		const nextPage = Math.max(1, page)

		setLoading(true)
		setLoadError(null)

		try {
			const [listResult, statsResult] = await Promise.allSettled([
				customersApi.list({ page: nextPage, per_page: CUSTOMER_PAGE_SIZE }),
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
					: 'Data pelanggan gagal dimuat.'
			setLoadError(message)
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		void loadPage(1, { includeStats: true })
	}, [])

	const chips = useMemo(
		() =>
			SEGMENT_CHIPS.map((chip) => ({
				...chip,
				count:
					chip.id === 'all'
						? stats.total
						: rows.filter((row) => matchesSegment(row, chip.id)).length,
				isPartial: false,
			})),
		[rows, stats.total],
	)

	const filteredRows = useMemo(() => {
		return rows.filter((row) => matchesSegment(row, activeSegment))
	}, [activeSegment, rows])

	const listStatusLabel = useMemo(() => {
		if (loading) return 'Sinkronisasi data...'

		const visibleCount = filteredRows.length.toLocaleString('id-ID')
		const loadedCount = rows.length.toLocaleString('id-ID')
		const totalCount = stats.total.toLocaleString('id-ID')

		if (activeSegment === 'all') return `${visibleCount} dari ${totalCount} kontak`

		return `${visibleCount} kontak cocok di halaman ini · ${loadedCount} data dimuat`
	}, [activeSegment, filteredRows.length, loading, rows.length, stats.total])

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
				title="Pelanggan 360"
				subtitle={`${stats.total.toLocaleString('id-ID')} kontak · unified dari WA Meta + Baileys + marketplace`}
				actions={
					<>
						<button type="button" className="ocm-btn">
							<Filter size={14} />
							Segmentasi
						</button>
						<button type="button" className="ocm-btn">
							<Upload size={14} />
							Import CSV
						</button>
						<button type="button" className="ocm-btn ocm-btn-primary">
							<Plus size={14} />
							Tambah
						</button>
					</>
				}
			/>

			<div className="flex flex-wrap gap-2">
				{chips.map((chip) => (
					<button
						type="button"
						key={chip.id}
						onClick={() => setActiveSegment(chip.id)}
						className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
							activeSegment === chip.id
								? 'border-primary/40 bg-primary/15 text-primary'
								: 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
						}`}
						>
							<span>{chip.label}</span>
							<span className="font-mono text-[10px] opacity-70">
								· {chip.count.toLocaleString('id-ID')}
								{chip.isPartial ? '+' : ''}
							</span>
						</button>
				))}
			</div>

			<section className="ocm-card overflow-hidden">
				<div className="ocm-card-header">
					<h2 className="ocm-card-title">Daftar Pelanggan</h2>
					<div className="text-xs text-muted-foreground">{listStatusLabel}</div>
				</div>

				{loading && rows.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">
						Memuat pelanggan...
					</div>
				) : loadError && rows.length === 0 ? (
					<div className="p-3">
						<CrmEmptyState
							title="Gagal memuat pelanggan"
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
							title="Tidak ada pelanggan"
							description="Data pelanggan belum tersedia untuk filter ini."
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[1160px]">
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
									className="grid grid-cols-[30px_1.8fr_170px_80px_140px_110px_140px_170px_34px] items-center border-b border-border px-4 py-2.5 text-sm last:border-0"
								>
									<div>
										<input
											type="checkbox"
											aria-label={`select-${row.id}`}
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
									<div className="font-mono text-xs text-muted-foreground">
										{row.phone}
									</div>
									<div className="font-mono text-sm">{row.orders}</div>
									<div
										className={`font-mono text-sm ${
											row.ltvAmount > 0
												? 'text-foreground'
												: 'text-muted-foreground'
										}`}
									>
										{row.ltv}
									</div>
									<div className="text-sm text-muted-foreground">
										{row.city}
									</div>
									<div>
										<span className={stageTagClass(row.stage)}>
											{formatStageLabel(row.stage)}
										</span>
									</div>
									<div className="flex flex-wrap gap-1">
										{row.tags.length > 0 ? (
											row.tags.map((tag) => (
												<span
													key={`${row.id}-${tag}`}
													className={tagClass(tag)}
												>
													{tag}
												</span>
											))
										) : (
											<span className="text-xs text-muted-foreground">-</span>
										)}
									</div>
									<div className="flex justify-end text-muted-foreground">
										<MoreHorizontal size={14} />
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
										? 'Memuat halaman pelanggan...'
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
		</main>
	)
}
