import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Info, Loader2, Save, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { salesProfiles, type SalesProfileRow } from '@/lib/api'

export const Route = createFileRoute('/_app/sales-profiles/$userId')({
	component: SalesProfileDetailPage,
})

// The editable form uses comma-separated text for the list fields; they are
// split back into arrays on save.
type Draft = {
	productSkills: string
	maxActive: string
	level: string
	segments: string
	regions: string
	languages: string
	tags: string
	notes: string
}

const LEVELS = [
	{ value: '', label: '-' },
	{ value: 'junior', label: 'Junior' },
	{ value: 'mid', label: 'Menengah' },
	{ value: 'senior', label: 'Senior' },
]

function toDraft(row: SalesProfileRow): Draft {
	const p = row.profile
	return {
		productSkills: p.productSkills.join(', '),
		maxActive: String(p.maxActive ?? 20),
		level: p.level || '',
		segments: p.segments.join(', '),
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

function SalesProfileDetailPage() {
	const { userId } = Route.useParams()
	const navigate = useNavigate()
	const [row, setRow] = useState<SalesProfileRow | null>(null)
	const [draft, setDraft] = useState<Draft | null>(null)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [saved, setSaved] = useState(false)

	// There is no GET /sales-profiles/:userId. The list endpoint returns every
	// sales the leader manages, which is a team-sized list, so picking the row
	// out of it costs less than adding an endpoint for one record.
	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await salesProfiles.list()
			const found = response.data.find((item) => item.userId === userId) || null
			if (!found) {
				setError('Sales tidak ditemukan atau di luar tim Anda.')
				return
			}
			setRow(found)
			setDraft(toDraft(found))
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal memuat profil sales.')
		} finally {
			setLoading(false)
		}
	}, [userId])

	useEffect(() => {
		void load()
	}, [load])

	const patch = useCallback((next: Partial<Draft>) => {
		setDraft((prev) => (prev ? { ...prev, ...next } : prev))
		setSaved(false)
	}, [])

	const save = useCallback(async () => {
		if (!row || !draft) return
		setSaving(true)
		setError(null)
		try {
			const response = await salesProfiles.update(row.userId, {
				productSkills: splitList(draft.productSkills),
				maxActive: Number(draft.maxActive) || 20,
				level: draft.level || null,
				segments: splitList(draft.segments),
				regions: splitList(draft.regions),
				languages: splitList(draft.languages),
				tags: splitList(draft.tags),
				notes: draft.notes.trim() || null,
			})
			setRow((prev) => (prev ? { ...prev, profile: response.data.profile } : prev))
			setSaved(true)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal menyimpan profil.')
		} finally {
			setSaving(false)
		}
	}, [row, draft])

	if (loading) {
		return (
			<main className="ocm-page">
				<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
					<Loader2 size={16} className="animate-spin" /> Memuat profil sales...
				</div>
			</main>
		)
	}

	if (!row || !draft) {
		return (
			<main className="ocm-page space-y-4">
				<Link to="/sales-profiles" className="ocm-btn w-fit">
					<ArrowLeft size={14} /> Kembali
				</Link>
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error || 'Profil sales tidak tersedia.'}</span>
				</div>
			</main>
		)
	}

	const cap = row.profile.maxActive || 20
	const overloaded = row.activeLoad >= cap

	return (
		<main className="ocm-page space-y-5">
			<div className="flex flex-wrap items-start justify-between gap-3">
				<div className="flex items-start gap-3">
					<button
						type="button"
						className="ocm-btn"
						onClick={() => void navigate({ to: '/sales-profiles' })}
					>
						<ArrowLeft size={14} /> Kembali
					</button>
					<div>
						<h1 className="text-lg font-semibold">{row.name || row.email}</h1>
						<p className="text-sm text-muted-foreground">
							{row.email}
							{row.teamName ? ` · ${row.teamName}` : ''}
						</p>
					</div>
				</div>
				<span
					className={`inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium ${
						overloaded
							? 'bg-red-500/10 text-red-600 dark:text-red-300'
							: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
					}`}
				>
					Beban aktif {row.activeLoad} / {cap}
				</span>
			</div>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			{/* Only these two fields change how leads are shared out. */}
			<section className="ocm-card space-y-4 p-5">
				<div>
					<h2 className="text-sm font-semibold">Dipakai untuk bagi lead</h2>
					<p className="text-xs text-muted-foreground">
						Hanya dua hal di bawah ini yang memengaruhi ke siapa lead dibagikan.
					</p>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field
						label="Keahlian produk"
						hint="Pisahkan dengan koma. Lead yang produknya cocok diarahkan ke sini."
					>
						<input
							className={inputClass}
							value={draft.productSkills}
							onChange={(event) => patch({ productSkills: event.target.value })}
							placeholder="ZWCAD, Archicad"
						/>
					</Field>
					<Field
						label="Kapasitas maks (lead aktif)"
						hint="Makin penuh bebannya, makin kecil peluang dapat lead baru."
					>
						<input
							type="number"
							min={1}
							max={1000}
							className={inputClass}
							value={draft.maxActive}
							onChange={(event) => patch({ maxActive: event.target.value })}
						/>
					</Field>
				</div>
			</section>

			{/* Kept because the Sales Character DB plan wants them, but they are
			    inert today, routing reads productSkills and maxActive only. Saying
			    so beats letting a leader tune fields that change nothing. */}
			<section className="ocm-card space-y-4 p-5">
				<div>
					<h2 className="text-sm font-semibold">Catatan tim</h2>
					<div className="mt-1 flex items-start gap-2 rounded-lg border border-border bg-muted/40 p-2.5 text-xs text-muted-foreground">
						<Info size={14} className="mt-0.5 shrink-0" />
						<span>
							Belum memengaruhi pembagian lead. Disimpan sebagai catatan karakter sales
							untuk dipakai nanti.
						</span>
					</div>
				</div>
				<div className="grid gap-4 sm:grid-cols-2">
					<Field label="Level / pengalaman">
						<select
							className={inputClass}
							value={draft.level}
							onChange={(event) => patch({ level: event.target.value })}
						>
							{LEVELS.map((level) => (
								<option key={level.value} value={level.value}>
									{level.label}
								</option>
							))}
						</select>
					</Field>
					<Field label="Segmen andalan" hint="mis. korporat, mahasiswa">
						<input
							className={inputClass}
							value={draft.segments}
							onChange={(event) => patch({ segments: event.target.value })}
							placeholder="korporat, individu"
						/>
					</Field>
					<Field label="Wilayah" hint="mis. Jawa Timur">
						<input
							className={inputClass}
							value={draft.regions}
							onChange={(event) => patch({ regions: event.target.value })}
							placeholder="Jawa Timur"
						/>
					</Field>
					<Field label="Bahasa" hint="mis. id, en">
						<input
							className={inputClass}
							value={draft.languages}
							onChange={(event) => patch({ languages: event.target.value })}
							placeholder="id, en"
						/>
					</Field>
				</div>
				<Field label="Tag" hint="opsional, mis. cocok_customer_teknis">
					<input
						className={inputClass}
						value={draft.tags}
						onChange={(event) => patch({ tags: event.target.value })}
						placeholder="cocok_customer_teknis"
					/>
				</Field>
				<Field label="Catatan">
					<textarea
						rows={3}
						className={`${inputClass} resize-y`}
						value={draft.notes}
						onChange={(event) => patch({ notes: event.target.value })}
						placeholder="Catatan internal"
					/>
				</Field>
			</section>

			<div className="flex items-center justify-end gap-3">
				{saved ? <span className="text-xs text-emerald-600 dark:text-emerald-300">Tersimpan.</span> : null}
				<button
					type="button"
					className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90"
					onClick={() => void save()}
					disabled={saving}
				>
					{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
					Simpan
				</button>
			</div>
		</main>
	)
}
