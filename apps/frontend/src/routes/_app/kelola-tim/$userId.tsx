import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Info, Loader2, Save, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { salesProfiles, type SalesProfileRow } from '@/lib/api'

export const Route = createFileRoute('/_app/kelola-tim/$userId')({
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
	persona: string
	experienceYears: string
	phone: string
	position: string
	joinedAt: string
}

const LEVELS = [
	{ value: '', label: '-' },
	{ value: 'junior', label: 'Junior' },
	{ value: 'menengah', label: 'Menengah' },
	{ value: 'senior', label: 'Senior' },
	{ value: 'lead', label: 'Lead' },
]

function formatDate(value: string | null): string {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' })
}

/** How long ago, in the words a leader would use. */
function sinceLabel(value: string | null): string {
	if (!value) return 'Belum ada aktivitas'
	const then = new Date(value).getTime()
	if (Number.isNaN(then)) return '-'
	const days = Math.floor((Date.now() - then) / 86_400_000)
	if (days <= 0) return 'Hari ini'
	if (days === 1) return 'Kemarin'
	if (days < 30) return `${days} hari lalu`
	const months = Math.floor(days / 30)
	return months < 12 ? `${months} bulan lalu` : `${Math.floor(months / 12)} tahun lalu`
}

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
		persona: p.persona || '',
		experienceYears: p.experienceYears == null ? '' : String(p.experienceYears),
		phone: p.phone || '',
		position: p.position || '',
		// The column is date-only; <input type="date"> wants exactly that slice.
		joinedAt: p.joinedAt ? String(p.joinedAt).slice(0, 10) : '',
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
	const [products, setProducts] = useState<string[]>([])

	// There is no GET for a single profile. The list endpoint returns every
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
		void salesProfiles
			.products()
			.then((response) => setProducts(response.data || []))
			.catch(() => undefined)
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const patch = useCallback((next: Partial<Draft>) => {
		setDraft((prev) => (prev ? { ...prev, ...next } : prev))
		setSaved(false)
	}, [])

	// The draft still stores skills as a comma string, so a value saved before
	// the picker existed keeps working and still shows as a chip.
	const selectedSkills = useMemo(() => splitList(draft?.productSkills || ''), [draft])

	// Catalogue first, then anything already stored that is not on it. Dropping
	// unknown values would silently delete a skill on the next save.
	const productOptions = useMemo(() => {
		const extra = selectedSkills.filter((skill) => !products.includes(skill))
		return [...products, ...extra]
	}, [products, selectedSkills])

	const toggleSkill = useCallback(
		(product: string) => {
			const next = selectedSkills.includes(product)
				? selectedSkills.filter((skill) => skill !== product)
				: [...selectedSkills, product]
			patch({ productSkills: next.join(', ') })
		},
		[selectedSkills, patch],
	)

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
				persona: draft.persona.trim() || null,
				experienceYears: draft.experienceYears.trim() === '' ? null : Number(draft.experienceYears),
				phone: draft.phone.trim() || null,
				position: draft.position.trim() || null,
				joinedAt: draft.joinedAt || null,
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
				<Link to="/kelola-tim" className="ocm-btn w-fit">
					<ArrowLeft size={14} /> Kembali ke Kelola Tim
				</Link>
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error || 'Profil sales tidak tersedia, atau anggota ini di luar tim kamu.'}</span>
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
						type='button'
						className="ocm-btn"
						onClick={() => void navigate({ to: '/kelola-tim' })}
					>
						<ArrowLeft size={14} /> Kembali ke Kelola Tim
					</button>
					<div>
						<h1 className="text-lg font-semibold">{row.name || row.email}</h1>
						<p className="text-sm text-muted-foreground">
							{row.email}
							{row.teamName ? ` · ${row.teamName}` : ''}
						</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					{/* Derived, not stored: the newest of a task touched, a deal moved,
					    or a contact they own going active. */}
					<span
						className="inline-flex items-center rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-muted-foreground"
						title={row.lastActivityAt ? formatDate(row.lastActivityAt) : undefined}
					>
						Aktivitas terakhir: {sinceLabel(row.lastActivityAt)}
					</span>
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
			</div>

			{!row.profile.configured ? (
				<div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>
						Profil ini belum pernah diisi, jadi angka di bawah masih nilai bawaan.
						Lengkapi supaya pembagian lead memakai data yang benar.
					</span>
				</div>
			) : null}

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			{/* Who they are on the left, how leads reach them on the right. The
			    same two-column shape as the Kontak and Perusahaan detail pages. */}
			<div className="grid items-start gap-5 lg:grid-cols-2">
				<div className="space-y-5">
				<section className="ocm-card space-y-4 p-5">
					<div>
						<h2 className="text-sm font-semibold">Persona</h2>
						<p className="text-xs text-muted-foreground">
							Cara orang ini menjual, ditulis untuk dibaca leader sebelum menyerahkan
							lead. Bukan tag, karena bagian yang bergunanya justru yang tidak muat
							jadi tag.
						</p>
					</div>
					<textarea
						rows={4}
						className={`${inputClass} resize-y`}
						value={draft.persona}
						onChange={(event) => patch({ persona: event.target.value })}
						placeholder="mis. Kuat di akun konsultan besar, sabar menghadapi tender panjang, lambat membalas di luar jam kerja."
					/>
				</section>

				<section className="ocm-card space-y-4 p-5">
					<div>
						<h2 className="text-sm font-semibold">Data diri</h2>
						<p className="text-xs text-muted-foreground">
							Disimpan di profil sales, bukan di akun login, karena ini menggambarkan
							perannya sebagai sales.
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<Field label="Posisi">
							<input
								className={inputClass}
								value={draft.position}
								onChange={(event) => patch({ position: event.target.value })}
								placeholder="mis. Account Executive AEC"
							/>
						</Field>
						<Field label="Nomor telepon">
							<input
								className={inputClass}
								value={draft.phone}
								onChange={(event) => patch({ phone: event.target.value })}
								placeholder="628xx"
							/>
						</Field>
						<Field label="Bergabung sejak">
							<input
								type="date"
								className={inputClass}
								value={draft.joinedAt}
								onChange={(event) => patch({ joinedAt: event.target.value })}
							/>
						</Field>
						<Field
							label="Pengalaman (tahun)"
							hint="Lama menjual. Berbeda dari level, yang menggambarkan kepercayaan."
						>
							<input
								type="number"
								min={0}
								max={60}
								className={inputClass}
								value={draft.experienceYears}
								onChange={(event) => patch({ experienceYears: event.target.value })}
							/>
						</Field>
					</div>
				</section>
				</div>

				<div className="space-y-5">
				{/* Only these two fields change how leads are shared out. */}
				<section className="ocm-card space-y-4 p-5">
					<div>
						<h2 className="text-sm font-semibold">Dipakai untuk bagi lead</h2>
						<p className="text-xs text-muted-foreground">
							Hanya dua hal di bawah ini yang memengaruhi ke siapa lead dibagikan.
						</p>
					</div>
					<div className="grid gap-4 sm:grid-cols-2">
						<div className="sm:col-span-2">
							<span className="text-xs font-medium text-muted-foreground">
								Keahlian produk
							</span>
							{/* Toggles, not a comma string: routing matches a skill against the
							    lead's product interest by token overlap, so one person typing
							    "ZWCAD 2026" quietly stops matching leads that say "ZWCAD". */}
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{productOptions.map((product) => {
									const on = selectedSkills.includes(product)
									return (
										<button
											key={product}
											type="button"
											onClick={() => toggleSkill(product)}
											className={`rounded-full border px-2.5 py-1 text-xs font-semibold transition ${
												on
													? 'border-primary/40 bg-primary/15 text-primary'
													: 'border-border bg-card text-muted-foreground hover:border-primary/30 hover:text-foreground'
											}`}
										>
											{product}
										</button>
									)
								})}
							</div>
							<p className="mt-1.5 text-[11px] text-muted-foreground">
								Pilih satu atau beberapa. Lead yang produknya cocok diarahkan ke sini.
								{selectedSkills.length === 0
									? ' Tanpa keahlian, orang ini tidak pernah menang pencocokan produk.'
									: ''}
							</p>
						</div>
						<Field
							label="Kapasitas maks (lead aktif)"
							hint="Makin penuh bebannya, makin kecil peluang dapat lead baru."
						>
							<input
								type='number'
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
								placeholder='id, en'
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
				</div>
			</div>

			<div className="flex items-center justify-end gap-3">
				{saved ? <span className="text-xs text-emerald-600 dark:text-emerald-300">Tersimpan.</span> : null}
				<button
					type='button'
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
