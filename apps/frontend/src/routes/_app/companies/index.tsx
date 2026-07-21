import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Building2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import { companies as companiesApi, type CompanyRow } from '@/lib/api'

export const Route = createFileRoute('/_app/companies/')({
	component: CompaniesPage,
})

const IDR_FORMATTER = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0,
})

/** Same page size as the Kontak list, so the two read as one product. */
const COMPANY_PAGE_SIZE = 10

function formatValue(amount: number): string {
	if (!amount) return '-'
	return IDR_FORMATTER.format(amount)
}

function formatLastActivity(value: string | null): string {
	if (!value) return 'Belum ada aktivitas'
	const then = new Date(value).getTime()
	if (Number.isNaN(then)) return '-'

	const minutes = Math.floor((Date.now() - then) / 60000)
	if (minutes < 1) return 'Baru saja'
	if (minutes < 60) return `${minutes} menit lalu`
	const hours = Math.floor(minutes / 60)
	if (hours < 24) return `${hours} jam lalu`
	const days = Math.floor(hours / 24)
	if (days < 30) return `${days} hari lalu`
	const months = Math.floor(days / 30)
	return `${months} bulan lalu`
}

const COLUMNS = 'grid-cols-[30px_1.8fr_150px_90px_90px_160px_170px]'

function CompaniesPage() {
	const navigate = useNavigate()
	const [rows, setRows] = useState<CompanyRow[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState(false)

	// Debounced so typing a firm name does not fire a request per keystroke.
	const [appliedSearch, setAppliedSearch] = useState('')
	useEffect(() => {
		const timer = setTimeout(() => {
			setAppliedSearch(search.trim())
			setPage(1)
		}, 300)
		return () => clearTimeout(timer)
	}, [search])

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setLoadError(false)

		companiesApi
			.list({ page, per_page: COMPANY_PAGE_SIZE, search: appliedSearch || undefined })
			.then((response) => {
				if (cancelled) return
				setRows(Array.isArray(response?.payload) ? response.payload : [])
				setTotal(Number(response?.meta?.total ?? 0))
			})
			.catch(() => {
				if (cancelled) return
				setRows([])
				setLoadError(true)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [page, appliedSearch])

	const totalPages = Math.max(1, Math.ceil(total / COMPANY_PAGE_SIZE))
	const clampedPage = Math.min(page, totalPages)
	const pageStart = total === 0 ? 0 : (clampedPage - 1) * COMPANY_PAGE_SIZE + 1
	const pageEnd = Math.min(clampedPage * COMPANY_PAGE_SIZE, total)

	// A five-wide window that slides with the current page, same as the Kontak
	// list: enough to jump a few pages without printing every page number.
	const pageNumbers = useMemo(() => {
		const start = Math.max(1, clampedPage - 2)
		const end = Math.min(totalPages, start + 4)
		const adjustedStart = Math.max(1, end - 4)
		return Array.from({ length: end - adjustedStart + 1 }, (_, index) => adjustedStart + index)
	}, [clampedPage, totalPages])

	const goToPage = (target: number) => {
		const next = Math.min(Math.max(1, target), totalPages)
		if (next === page && rows.length > 0) return
		setPage(next)
	}

	const listStatusLabel = loading
		? 'Memuat...'
		: appliedSearch
			? `${total.toLocaleString('id-ID')} cocok dengan "${appliedSearch}"`
			: `${total.toLocaleString('id-ID')} perusahaan`

	// Computed from the rows on screen rather than the whole set, so each panel
	// says "Dari halaman ini" instead of implying it describes every company.
	const cityDistribution = useMemo(() => {
		if (rows.length === 0) return []
		const counts = new Map<string, number>()
		for (const row of rows) {
			const city = row.city?.trim() || 'Tanpa kota'
			counts.set(city, (counts.get(city) || 0) + 1)
		}
		return [...counts.entries()]
			.map(([city, count]) => ({ city, count, share: Math.round((count / rows.length) * 100) }))
			.sort((a, b) => b.count - a.count)
			.slice(0, 5)
	}, [rows])

	const topByValue = useMemo(
		() =>
			[...rows]
				.filter((row) => row.deal_value > 0)
				.sort((a, b) => b.deal_value - a.deal_value)
				.slice(0, 5),
		[rows],
	)

	const topByContacts = useMemo(
		() =>
			[...rows]
				.filter((row) => row.contact_count > 1)
				.sort((a, b) => b.contact_count - a.contact_count)
				.slice(0, 5),
		[rows],
	)

	const openDetail = (companyId: string) =>
		navigate({ to: '/companies/$companyId', params: { companyId } })

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Perusahaan"
				subtitle={`${total.toLocaleString('id-ID')} perusahaan · firma tempat kontak bekerja, satu bisa punya beberapa PIC`}
			/>

			<div className="flex flex-wrap items-center gap-2">
				<div className="relative">
					<Search
						size={14}
						className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
					/>
					<input
						type="search"
						value={search}
						onChange={(event) => setSearch(event.target.value)}
						placeholder="Cari nama perusahaan..."
						className="w-64 rounded-full border border-border bg-card py-1.5 pl-9 pr-3 text-[11px] font-semibold placeholder:font-normal placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					/>
				</div>
				{appliedSearch ? (
					<button
						type="button"
						onClick={() => setSearch('')}
						className="rounded-full px-2 py-1.5 text-[11px] font-semibold text-muted-foreground underline hover:text-foreground"
					>
						Reset
					</button>
				) : null}
			</div>

			<section className="ocm-card overflow-hidden">
				<div className="ocm-card-header">
					<h2 className="ocm-card-title">Daftar Perusahaan</h2>
					<div className="text-xs text-muted-foreground">{listStatusLabel}</div>
				</div>

				{loading && rows.length === 0 ? (
					<div className="p-4 text-sm text-muted-foreground">Memuat perusahaan...</div>
				) : loadError && rows.length === 0 ? (
					<div className="p-3">
						<CrmEmptyState
							title="Gagal memuat perusahaan"
							description="Coba refresh halaman. Kalau masih gagal, cek koneksi ke server."
							action={
								<button type="button" className="ocm-btn" onClick={() => goToPage(1)}>
									Coba lagi
								</button>
							}
						/>
					</div>
				) : rows.length === 0 ? (
					<div className="p-3">
						<CrmEmptyState
							title={appliedSearch ? 'Tidak ada yang cocok' : 'Belum ada perusahaan'}
							description={
								appliedSearch
									? `Tidak ada perusahaan dengan nama "${appliedSearch}".`
									: 'Perusahaan dibuat otomatis saat kolom perusahaan diisi di kontak, prospek, atau import.'
							}
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[880px]">
							<div
								className={`grid ${COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
							>
								<div />
								<div>Perusahaan</div>
								<div>Kota</div>
								<div className="text-right">Kontak</div>
								<div className="text-right">Deal</div>
								<div className="text-right">Nilai Deal</div>
								<div>Aktivitas Terakhir</div>
							</div>
							{rows.map((row) => (
								<div
									key={row.id}
									role="button"
									tabIndex={0}
									onClick={() => openDetail(row.id)}
									onKeyDown={(event) => {
										if (event.key === 'Enter') openDetail(row.id)
									}}
									className={`grid ${COLUMNS} cursor-pointer items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40`}
								>
									<div>
										<span className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-muted-foreground">
											<Building2 size={14} />
										</span>
									</div>
									<div className="min-w-0 pr-3">
										<p className="truncate font-semibold">{row.name}</p>
										{row.website ? (
											<p className="truncate text-[11px] text-muted-foreground">
												{row.website.replace(/^https?:\/\//, '')}
											</p>
										) : null}
									</div>
									<div className="truncate text-sm text-muted-foreground">{row.city || '-'}</div>
									<div className="text-right font-mono text-sm">{row.contact_count}</div>
									<div className="text-right font-mono text-sm">{row.deal_count}</div>
									<div
										className={`text-right font-mono text-sm ${
											row.deal_value > 0 ? 'text-foreground' : 'text-muted-foreground'
										}`}
									>
										{formatValue(row.deal_value)}
									</div>
									<div className="text-xs text-muted-foreground">
										{formatLastActivity(row.last_activity_at)}
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
										? 'Memuat halaman perusahaan...'
										: total === 0
											? 'Tidak ada perusahaan'
											: `Menampilkan ${pageStart.toLocaleString('id-ID')}-${pageEnd.toLocaleString('id-ID')} dari ${total.toLocaleString('id-ID')} perusahaan`}
							</div>
							<div className="flex flex-wrap items-center gap-1">
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(1)}
									disabled={loading || clampedPage <= 1}
								>
									Awal
								</button>
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(clampedPage - 1)}
									disabled={loading || clampedPage <= 1}
								>
									Sebelumnya
								</button>
								{pageNumbers.map((pageNumber) => (
									<button
										type="button"
										key={pageNumber}
										onClick={() => goToPage(pageNumber)}
										disabled={loading || pageNumber === clampedPage}
										className={`h-8 min-w-8 rounded-lg border px-2 text-xs font-semibold transition disabled:cursor-not-allowed disabled:opacity-70 ${
											pageNumber === clampedPage
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
									onClick={() => goToPage(clampedPage + 1)}
									disabled={loading || clampedPage >= totalPages}
								>
									Berikutnya
								</button>
								<button
									type="button"
									className="ocm-btn h-8 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-50"
									onClick={() => goToPage(totalPages)}
									disabled={loading || clampedPage >= totalPages}
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
					<p className="mt-0.5 text-[11px] text-muted-foreground">Dari halaman ini</p>
					{cityDistribution.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">Belum ada data kota.</p>
					) : (
						<div className="mt-3 space-y-2.5">
							{cityDistribution.map((item) => (
								<div key={item.city}>
									<div className="mb-1 flex items-center justify-between text-xs">
										<span className="truncate">{item.city}</span>
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
					<h2 className="text-sm font-semibold">Nilai Deal Teratas</h2>
					<p className="mt-0.5 text-[11px] text-muted-foreground">Dari halaman ini</p>
					{topByValue.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">
							Belum ada deal bernilai di halaman ini.
						</p>
					) : (
						<div className="mt-3 space-y-2">
							{topByValue.map((row) => (
								<div key={row.id} className="flex items-center justify-between gap-2 text-xs">
									<span className="truncate">{row.name}</span>
									<span className="shrink-0 font-mono text-[11px]">
										{formatValue(row.deal_value)}
									</span>
								</div>
							))}
						</div>
					)}
				</section>

				<section className="ocm-card p-4">
					<h2 className="text-sm font-semibold">PIC Terbanyak</h2>
					<p className="mt-0.5 text-[11px] text-muted-foreground">
						Perusahaan dengan lebih dari satu kontak
					</p>
					{topByContacts.length === 0 ? (
						<p className="mt-3 text-sm text-muted-foreground">
							Belum ada perusahaan dengan lebih dari satu PIC di halaman ini.
						</p>
					) : (
						<div className="mt-3 space-y-2">
							{topByContacts.map((row) => (
								<div key={row.id} className="flex items-center justify-between gap-2 text-xs">
									<span className="truncate">{row.name}</span>
									<span className="shrink-0 font-mono text-[11px] text-muted-foreground">
										{row.contact_count} PIC
									</span>
								</div>
							))}
						</div>
					)}
				</section>
			</div>
		</main>
	)
}
