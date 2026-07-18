import { createFileRoute } from '@tanstack/react-router'
import {
	CheckCircle2,
	Loader2,
	Pencil,
	RefreshCw,
	Save,
	Search,
	TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { salesProfiles, type SalesProfileRow } from '@/lib/api'

export const Route = createFileRoute('/_app/sales-profiles')({
	component: SalesProfilesPage,
})

// The editable form uses comma-separated text for the list fields; they are
// split back into arrays on save.
type Draft = {
	productSkills: string
	segments: string
	level: string
	maxActive: string
	regions: string
	languages: string
	tags: string
	notes: string
}

const LEVELS = [
	{ value: '', label: '—' },
	{ value: 'junior', label: 'Junior' },
	{ value: 'mid', label: 'Menengah' },
	{ value: 'senior', label: 'Senior' },
]

const LEVEL_LABEL: Record<string, string> = {
	junior: 'Junior',
	mid: 'Menengah',
	senior: 'Senior',
}

function toDraft(row: SalesProfileRow): Draft {
	const p = row.profile
	return {
		productSkills: p.productSkills.join(', '),
		segments: p.segments.join(', '),
		level: p.level || '',
		maxActive: String(p.maxActive ?? 20),
		regions: p.regions.join(', '),
		languages: p.languages.join(', '),
		tags: p.tags.join(', '),
		notes: p.notes || '',
	}
}

function splitList(value: string): string[] {
	return value
		.split(',')
		.map((item) => item.trim())
		.filter(Boolean)
}

function initials(name: string | null, email: string) {
	const base = (name || email || '?').trim()
	const parts = base.split(/\s+/).slice(0, 2)
	return parts.map((p) => p[0]?.toUpperCase() || '').join('') || '?'
}

const inputClass =
	'w-full rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring'

function Field({
	label,
	hint,
	children,
}: {
	label: string
	hint?: string
	children: React.ReactNode
}) {
	return (
		<label className="block space-y-1">
			<span className="text-xs font-medium text-muted-foreground">{label}</span>
			{children}
			{hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
		</label>
	)
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

function SalesProfilesPage() {
	const [rows, setRows] = useState<SalesProfileRow[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [query, setQuery] = useState('')
	const [savedId, setSavedId] = useState<string | null>(null)

	// Edit modal state
	const [editing, setEditing] = useState<SalesProfileRow | null>(null)
	const [draft, setDraft] = useState<Draft | null>(null)
	const [saving, setSaving] = useState(false)
	const [modalError, setModalError] = useState<string | null>(null)

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

	const openEditor = useCallback((row: SalesProfileRow) => {
		setEditing(row)
		setDraft(toDraft(row))
		setModalError(null)
		setSavedId(null)
	}, [])

	const closeEditor = useCallback(() => {
		setEditing(null)
		setDraft(null)
		setModalError(null)
	}, [])

	const patchDraft = useCallback((patch: Partial<Draft>) => {
		setDraft((prev) => (prev ? { ...prev, ...patch } : prev))
	}, [])

	const save = useCallback(async () => {
		if (!editing || !draft) return
		setSaving(true)
		setModalError(null)
		try {
			const response = await salesProfiles.update(editing.userId, {
				productSkills: splitList(draft.productSkills),
				segments: splitList(draft.segments),
				level: draft.level || null,
				maxActive: Number(draft.maxActive) || 20,
				regions: splitList(draft.regions),
				languages: splitList(draft.languages),
				tags: splitList(draft.tags),
				notes: draft.notes.trim() || null,
			})
			setRows((prev) =>
				prev.map((row) =>
					row.userId === editing.userId ? { ...row, profile: response.data.profile } : row,
				),
			)
			setSavedId(editing.userId)
			closeEditor()
		} catch (reason) {
			setModalError(reason instanceof Error ? reason.message : 'Gagal menyimpan profil.')
		} finally {
			setSaving(false)
		}
	}, [editing, draft, closeEditor])

	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase()
		if (!q) return rows
		return rows.filter((row) => {
			const haystack = [
				row.name || '',
				row.email,
				row.profile.level || '',
				...row.profile.productSkills,
				...row.profile.segments,
				...row.profile.regions,
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
				subtitle="Atur keahlian, kapasitas, dan karakteristik tiap sales. Dipakai untuk membagi lead otomatis ke sales yang paling cocok."
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
				{/* Toolbar */}
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-border p-3">
					<div className="relative w-full max-w-xs">
						<Search
							size={15}
							className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
						/>
						<input
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder="Cari nama, email, keahlian..."
							className="w-full rounded-lg border border-border bg-background py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
						/>
					</div>
					<p className="text-xs text-muted-foreground">
						{configuredCount}/{rows.length} sales sudah punya keahlian
					</p>
				</div>

				{/* Column header (md+) */}
				<div className="hidden grid-cols-[1.6fr_0.7fr_1.4fr_0.8fr_auto] gap-3 border-b border-border px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground md:grid">
					<span>Sales</span>
					<span>Level</span>
					<span>Keahlian produk</span>
					<span>Beban aktif</span>
					<span className="sr-only">Aksi</span>
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
								<li
									key={row.userId}
									className="grid grid-cols-1 items-center gap-2 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[1.6fr_0.7fr_1.4fr_0.8fr_auto] md:gap-3"
								>
									{/* Sales identity */}
									<div className="flex min-w-0 items-center gap-3">
										<span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
											{initials(row.name, row.email)}
										</span>
										<div className="min-w-0">
											<p className="flex items-center gap-2 truncate text-sm font-medium">
												{row.name || row.email}
												{savedId === row.userId ? (
													<CheckCircle2 size={14} className="text-emerald-500" />
												) : null}
											</p>
											<p className="truncate text-xs text-muted-foreground">{row.email}</p>
										</div>
									</div>

									{/* Level */}
									<div className="text-xs text-muted-foreground">
										<span className="md:hidden">Level: </span>
										{row.profile.level ? LEVEL_LABEL[row.profile.level] || row.profile.level : '—'}
									</div>

									{/* Skills */}
									<div>
										<Chips items={row.profile.productSkills} />
									</div>

									{/* Load */}
									<div>
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

									{/* Action */}
									<div className="md:justify-self-end">
										<button
											type="button"
											className="ocm-btn"
											onClick={() => openEditor(row)}
										>
											<Pencil size={14} /> Edit
										</button>
									</div>
								</li>
							)
						})}
					</ul>
				)}
			</div>

			{/* Edit modal */}
			<Dialog
				open={Boolean(editing)}
				onOpenChange={(open) => {
					if (!open) closeEditor()
				}}
			>
				<DialogContent className="sm:max-w-lg">
					<DialogHeader>
						<DialogTitle>Edit Profil Sales</DialogTitle>
						<DialogDescription>
							{editing ? `${editing.name || editing.email} · ${editing.email}` : ''}
						</DialogDescription>
					</DialogHeader>

					{draft ? (
						<div className="max-h-[60vh] space-y-4 overflow-y-auto pr-1">
							<div className="grid gap-4 sm:grid-cols-2">
								<Field label="Keahlian produk" hint="Pisahkan dengan koma">
									<input
										className={inputClass}
										value={draft.productSkills}
										onChange={(event) => patchDraft({ productSkills: event.target.value })}
										placeholder="ZWCAD Mechanical, Archicad"
									/>
								</Field>
								<Field label="Segmen andalan" hint="mis. korporat, mahasiswa">
									<input
										className={inputClass}
										value={draft.segments}
										onChange={(event) => patchDraft({ segments: event.target.value })}
										placeholder="korporat, individu"
									/>
								</Field>
								<Field label="Level / pengalaman">
									<select
										className={inputClass}
										value={draft.level}
										onChange={(event) => patchDraft({ level: event.target.value })}
									>
										{LEVELS.map((level) => (
											<option key={level.value} value={level.value}>
												{level.label}
											</option>
										))}
									</select>
								</Field>
								<Field label="Kapasitas maks (lead aktif)">
									<input
										type="number"
										min={1}
										max={1000}
										className={inputClass}
										value={draft.maxActive}
										onChange={(event) => patchDraft({ maxActive: event.target.value })}
									/>
								</Field>
								<Field label="Wilayah" hint="mis. Jawa Timur">
									<input
										className={inputClass}
										value={draft.regions}
										onChange={(event) => patchDraft({ regions: event.target.value })}
										placeholder="Jawa Timur"
									/>
								</Field>
								<Field label="Bahasa" hint="mis. id, en">
									<input
										className={inputClass}
										value={draft.languages}
										onChange={(event) => patchDraft({ languages: event.target.value })}
										placeholder="id, en"
									/>
								</Field>
							</div>
							<Field label="Tag" hint="opsional, mis. cocok_customer_teknis">
								<input
									className={inputClass}
									value={draft.tags}
									onChange={(event) => patchDraft({ tags: event.target.value })}
									placeholder="cocok_customer_teknis"
								/>
							</Field>
							<Field label="Catatan">
								<textarea
									rows={3}
									className={`${inputClass} resize-y`}
									value={draft.notes}
									onChange={(event) => patchDraft({ notes: event.target.value })}
									placeholder="Catatan internal"
								/>
							</Field>

							{modalError ? (
								<p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
									{modalError}
								</p>
							) : null}
						</div>
					) : null}

					<DialogFooter>
						<button type="button" className="ocm-btn" onClick={closeEditor} disabled={saving}>
							Batal
						</button>
						<button
							type="button"
							className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90"
							onClick={() => void save()}
							disabled={saving}
						>
							{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
							Simpan
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</main>
	)
}
