import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Building2, Loader2, Search } from 'lucide-react'
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

const PAGE_SIZE = 20

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
			.list({ page, per_page: PAGE_SIZE, search: appliedSearch || undefined })
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

	const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE))
	const pageStart = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1
	const pageEnd = Math.min(page * PAGE_SIZE, total)

	const summary = useMemo(() => {
		const contacts = rows.reduce((sum, row) => sum + row.contact_count, 0)
		const value = rows.reduce((sum, row) => sum + row.deal_value, 0)
		return { contacts, value }
	}, [rows])

	return (
		<div className="space-y-4">
			<CrmSectionHeader
				title="Perusahaan"
				subtitle="Firma yang jadi tempat kontak kamu bekerja. Satu perusahaan bisa punya beberapa PIC."
			/>

			<section className="ocm-card">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3">
					<div className="relative min-w-56 flex-1 max-w-sm">
						<Search
							size={14}
							className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							type="search"
							value={search}
							onChange={(event) => setSearch(event.target.value)}
							placeholder="Cari nama perusahaan..."
							className="ocm-input h-9 w-full pl-9 text-sm"
						/>
					</div>
					{loading ? (
						<Loader2 size={16} className="animate-spin text-muted-foreground" />
					) : null}
				</div>

				{loadError && rows.length === 0 ? (
					<CrmEmptyState
						title="Gagal memuat perusahaan"
						description="Coba refresh halaman. Kalau masih gagal, cek koneksi ke server."
					/>
				) : !loading && rows.length === 0 ? (
					<CrmEmptyState
						title={appliedSearch ? 'Tidak ada yang cocok' : 'Belum ada perusahaan'}
						description={
							appliedSearch
								? `Tidak ada perusahaan dengan nama "${appliedSearch}".`
								: 'Perusahaan dibuat otomatis saat kamu mengisi kolom perusahaan di kontak, prospek, atau import.'
						}
					/>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[820px]">
							<div className="grid grid-cols-[2fr_120px_90px_80px_150px_160px] items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
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
									onClick={() =>
										navigate({ to: '/companies/$companyId', params: { companyId: row.id } })
									}
									onKeyDown={(event) => {
										if (event.key === 'Enter') {
											navigate({
												to: '/companies/$companyId',
												params: { companyId: row.id },
											})
										}
									}}
									className="grid cursor-pointer grid-cols-[2fr_120px_90px_80px_150px_160px] items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40"
								>
									<div className="flex min-w-0 items-center gap-2.5">
										<span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
											<Building2 size={14} />
										</span>
										<p className="truncate font-semibold">{row.name}</p>
									</div>
									<div className="truncate text-sm text-muted-foreground">
										{row.city || '-'}
									</div>
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

				{rows.length > 0 ? (
					<div className="border-t border-border px-4 py-3">
						<div className="flex flex-wrap items-center justify-between gap-3 text-xs text-muted-foreground">
							<div>
								Menampilkan {pageStart.toLocaleString('id-ID')}-
								{pageEnd.toLocaleString('id-ID')} dari {total.toLocaleString('id-ID')}{' '}
								perusahaan
								{summary.contacts > 0
									? ` · ${summary.contacts.toLocaleString('id-ID')} kontak di halaman ini`
									: ''}
							</div>
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
					</div>
				) : null}
			</section>
		</div>
	)
}
