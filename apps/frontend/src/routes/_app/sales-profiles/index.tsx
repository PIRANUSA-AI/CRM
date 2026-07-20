import { Link, createFileRoute } from '@tanstack/react-router'
import { ChevronRight, Loader2, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
import { salesProfiles, type SalesProfileRow } from '@/lib/api'

export const Route = createFileRoute('/_app/sales-profiles/')({
	component: SalesProfilesPage,
})

function initials(name: string | null, email: string) {
	const base = (name || email || '?').trim()
	const parts = base.split(/\s+/).slice(0, 2)
	return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

function Chips({ items, max = 3 }: { items: string[]; max?: number }) {
	if (!items.length)
		return <span className="text-xs text-muted-foreground/70">Belum diatur</span>
	const shown = items.slice(0, max)
	const rest = items.length - shown.length
	return (
		<span className="flex flex-wrap gap-1">
			{shown.map((item) => (
				<span
					key={item}
					className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary"
				>
					{item}
				</span>
			))}
			{rest > 0 ? (
				<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
					+{rest}
				</span>
			) : null}
		</span>
	)
}

// Columns are limited to what actually drives lead routing — product skills
// (weight 0.4) and capacity, the denominator of the load score (0.3) — plus the
// team, because that is how the leader thinks about their sales. Level used to
// occupy a column but is decorative: routing never reads it.
const COLUMNS = 'md:grid-cols-[1.6fr_0.6fr_1.4fr_0.8fr_auto]'

function SalesProfilesPage() {
	const [rows, setRows] = useState<SalesProfileRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [query, setQuery] = useState('')

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await salesProfiles.list()
			setRows(response.data)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal memuat profil sales.')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return rows
		return rows.filter((row) => {
			const haystack = [
				row.name || '',
				row.email,
				row.teamName || '',
				...row.profile.productSkills,
			]
				.join(' ')
				.toLowerCase()
			return haystack.includes(q)
		})
	}, [rows, query])

	const configuredCount = rows.filter((r) => r.profile.productSkills.length > 0).length

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Profil Sales"
				subtitle="Atur keahlian dan kapasitas tiap sales. Dipakai untuk membagi lead otomatis ke sales yang paling cocok."
				actions={
					<button type="button" className="ocm-btn" onClick={() => void load()} disabled={loading}>
						<RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Muat ulang
					</button>
				}
			/>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			<div className="ocm-card overflow-hidden">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
					<div className="relative w-full max-w-xs">
						<Search
							size={15}
							className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Cari nama, tim, keahlian..."
							className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						{configuredCount}/{rows.length} sales sudah punya keahlian
					</p>
				</div>

				<div
					className={`hidden gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid ${COLUMNS}`}
				>
					<span>Sales</span>
					<span>Tim</span>
					<span>Keahlian produk</span>
					<span>Beban aktif</span>
					<span className="sr-only">Buka</span>
				</div>

				{loading ? (
					<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
						<Loader2 size={16} className="animate-spin" /> Memuat profil sales...
					</div>
				) : filtered.length === 0 ? (
					<div className="p-6 text-sm text-muted-foreground">
						{rows.length === 0
							? 'Belum ada sales di tim Anda. Tambahkan anggota tim dulu di Kelola Tim.'
							: 'Tidak ada sales yang cocok dengan pencarian.'}
					</div>
				) : (
					<ul className="divide-y divide-border">
						{filtered.map((row) => {
							const cap = row.profile.maxActive || 20
							const overloaded = row.activeLoad >= cap
							return (
								<li key={row.userId}>
									<Link
										to="/sales-profiles/$userId"
										params={{ userId: row.userId }}
										className={`grid grid-cols-1 items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40 md:gap-3 ${COLUMNS}`}
									>
										<div className="flex min-w-0 items-center gap-3">
											<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
												{initials(row.name, row.email)}
											</span>
											<div className="min-w-0">
												<p className="truncate text-sm font-medium">{row.name || row.email}</p>
												<p className="truncate text-xs text-muted-foreground">{row.email}</p>
											</div>
										</div>

										<div className="text-xs">
											<span className="text-muted-foreground md:hidden">Tim: </span>
											{row.teamName ? (
												<span className="rounded-full bg-muted px-2 py-0.5 font-medium">
													{row.teamName}
												</span>
											) : (
												<span className="text-muted-foreground/70">—</span>
											)}
										</div>

										<div>
											<Chips items={row.profile.productSkills} />
										</div>

										<div>
											<span className="text-xs text-muted-foreground md:hidden">Beban: </span>
											<span
												className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${
													overloaded
														? 'bg-red-500/10 text-red-600 dark:text-red-300'
														: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
												}`}
											>
												{row.activeLoad} / {cap}
											</span>
										</div>

										<ChevronRight
											size={16}
											className="hidden shrink-0 text-muted-foreground md:block md:justify-self-end"
										/>
									</Link>
								</li>
							)
						})}
					</ul>
				)}
			</div>
		</main>
	)
}
