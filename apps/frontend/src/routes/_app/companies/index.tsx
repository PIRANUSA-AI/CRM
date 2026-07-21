import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Building2, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { isSupervisorRole } from '@/lib/role-access'
import {
	companies as companiesApi,
	leadImport,
	teams as teamsApi,
	type CompanyRow,
} from '@/lib/api'

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

// Company name · Associations · Type · Last updated · Sales, following the
// Qontak layout the team already reads. "Added by" is replaced by the sales
// working the firm: we never recorded who first typed a company in, and who
// owns it now is the more useful answer anyway.
const COLUMNS = 'grid-cols-[30px_1.7fr_160px_120px_150px_1fr]'

const TYPE_FILTERS = [
	{ id: '', label: 'Semua' },
	{ id: 'perusahaan', label: 'Perusahaan' },
	{ id: 'perorangan', label: 'Perorangan' },
]

function formatUpdated(value: string | null): string {
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

function initials(name: string): string {
	const parts = name.trim().split(/\s+/).filter(Boolean)
	if (!parts.length) return '?'
	if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
	return (parts[0][0] + parts[1][0]).toUpperCase()
}

/** Avatar stack for the PIC at a firm, Qontak's "Associations" column. */
function ContactStack({ names, total }: { names: string[]; total: number }) {
	if (total === 0) return <span className="text-xs text-muted-foreground">-</span>
	const hidden = total - names.length
	return (
		<div className="flex items-center">
			{names.map((name, index) => (
				<span
					key={name}
					title={name}
					className="-ml-1.5 flex h-6 w-6 items-center justify-center rounded-full border border-background bg-primary/15 text-[9px] font-bold text-primary first:ml-0"
					style={{ zIndex: names.length - index }}
				>
					{initials(name)}
				</span>
			))}
			{hidden > 0 ? (
				<span className="-ml-1.5 flex h-6 items-center justify-center rounded-full border border-background bg-muted px-1.5 text-[9px] font-bold text-muted-foreground">
					+{hidden}
				</span>
			) : null}
		</div>
	)
}

function CompaniesPage() {
	const navigate = useNavigate()
	const [rows, setRows] = useState<CompanyRow[]>([])
	const [total, setTotal] = useState(0)
	const [page, setPage] = useState(1)
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(true)
	const [loadError, setLoadError] = useState(false)
	const [typeFilter, setTypeFilter] = useState('')
	const [cityFilter, setCityFilter] = useState('')
	const [hasDeals, setHasDeals] = useState(false)
	const [teamFilter, setTeamFilter] = useState('')
	const [ownerFilter, setOwnerFilter] = useState('')
	const [cities, setCities] = useState<string[]>([])
	const [teamOptions, setTeamOptions] = useState<Array<{ id: string; name: string }>>([])
	const [salesOptions, setSalesOptions] = useState<
		Array<{ userId: string; name: string | null; email: string }>
	>([])

	const currentUser = useCurrentUser()
	const isLeader = isSupervisorRole(currentUser?.role)

	// Team and sales pickers only mean something to someone who oversees more
	// than themselves; a sales already sees exactly their own companies.
	useEffect(() => {
		if (!isLeader) return
		void teamsApi
			.list()
			.then((response: any) => setTeamOptions(response?.data || response?.payload || []))
			.catch(() => undefined)
		void leadImport
			.assignables()
			.then((response) => setSalesOptions(response.data || []))
			.catch(() => undefined)
	}, [isLeader])

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
			.list({
				page,
				per_page: COMPANY_PAGE_SIZE,
				search: appliedSearch || undefined,
				type: typeFilter || undefined,
				city: cityFilter || undefined,
				has_deals: hasDeals || undefined,
				team_id: teamFilter || undefined,
				owner_id: ownerFilter || undefined,
			})
			.then((response) => {
				if (cancelled) return
				setRows(Array.isArray(response?.payload) ? response.payload : [])
				setTotal(Number(response?.meta?.total ?? 0))
				setCities(response?.meta?.cities || [])
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
	}, [page, appliedSearch, typeFilter, cityFilter, hasDeals, teamFilter, ownerFilter])

	// Page 4 of the unfiltered list means nothing once a filter narrows it.
	useEffect(() => {
		setPage(1)
	}, [typeFilter, cityFilter, hasDeals, teamFilter, ownerFilter])

	const hasActiveFilter =
		Boolean(typeFilter || cityFilter || teamFilter || ownerFilter || appliedSearch) || hasDeals

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
				{TYPE_FILTERS.map((chip) => (
					<button
						type="button"
						key={chip.id || 'all'}
						onClick={() => setTypeFilter(chip.id)}
						className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
							typeFilter === chip.id
								? 'border-primary/40 bg-primary/15 text-primary'
								: 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
						}`}
					>
						{chip.label}
					</button>
				))}

				<button
					type="button"
					onClick={() => setHasDeals((current) => !current)}
					className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition ${
						hasDeals
							? 'border-primary/40 bg-primary/15 text-primary'
							: 'border-border bg-card text-muted-foreground hover:border-primary/20 hover:text-foreground'
					}`}
				>
					Punya deal
				</button>

				{cities.length > 0 ? (
					<select
						value={cityFilter}
						onChange={(event) => setCityFilter(event.target.value)}
						className="rounded-full border border-border bg-card px-3 py-1.5 text-[11px] font-semibold text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
					>
						<option value="">Semua kota</option>
						{cities.map((city) => (
							<option key={city} value={city}>
								{city}
							</option>
						))}
					</select>
				) : null}

				{isLeader ? (
					<>
						<select
							value={teamFilter}
							onChange={(event) => setTeamFilter(event.target.value)}
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
							onChange={(event) => setOwnerFilter(event.target.value)}
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

				{hasActiveFilter ? (
					<button
						type="button"
						onClick={() => {
							setSearch('')
							setTypeFilter('')
							setCityFilter('')
							setHasDeals(false)
							setTeamFilter('')
							setOwnerFilter('')
						}}
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
						<div className="min-w-[940px]">
							<div
								className={`grid ${COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
							>
								<div />
								<div>Perusahaan</div>
								<div>PIC</div>
								<div>Tipe</div>
								<div>Terakhir Diperbarui</div>
								<div>Sales</div>
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
										<p className="truncate text-[11px] text-muted-foreground">
											{[
												row.city,
												row.deal_count > 0
													? `${row.deal_count} deal · ${formatValue(row.deal_value)}`
													: null,
											]
												.filter(Boolean)
												.join(' · ') || 'Belum ada deal'}
										</p>
									</div>
									<div>
										<ContactStack names={row.contact_preview} total={row.contact_count} />
									</div>
									<div>
										<span
											className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
												row.type === 'perorangan'
													? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
													: 'bg-muted text-muted-foreground'
											}`}
										>
											{row.type === 'perorangan' ? 'Perorangan' : 'Perusahaan'}
										</span>
									</div>
									<div className="text-[11px] text-muted-foreground">
										{formatUpdated(row.updated_at)}
										<span className="block">{formatLastActivity(row.last_activity_at)}</span>
									</div>
									<div className="min-w-0 text-xs text-muted-foreground">
										{row.owners.length === 0
											? 'Belum ada'
											: row.owners.map((owner) => (
													<span key={`${owner.name}-${owner.team}`} className="block truncate">
														{owner.name}
														{owner.team ? (
															<span className="ml-1 rounded bg-muted px-1 py-0.5 text-[9px] font-semibold">
																{owner.team}
															</span>
														) : null}
													</span>
												))}
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
