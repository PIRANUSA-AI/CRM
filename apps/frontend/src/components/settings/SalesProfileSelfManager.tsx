import { Check, LoaderCircle, UserCircle2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { salesProfiles, type SalesProfileData } from '@/lib/api'
import { useCurrentUser } from '@/hooks/useCurrentUser'

type Draft = {
	productSkills: string[]
	experienceYears: string
	phone: string
	position: string
	joinedAt: string
}

function toDraft(profile: SalesProfileData): Draft {
	return {
		productSkills: profile.productSkills,
		experienceYears: profile.experienceYears == null ? '' : String(profile.experienceYears),
		phone: profile.phone || '',
		position: profile.position || '',
		joinedAt: profile.joinedAt ? String(profile.joinedAt).slice(0, 10) : '',
	}
}

const EMPTY_DRAFT: Draft = {
	productSkills: [],
	experienceYears: '',
	phone: '',
	position: '',
	joinedAt: '',
}

export default function SalesProfileSelfManager() {
	const currentUser = useCurrentUser()
	const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
	const [products, setProducts] = useState<string[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await salesProfiles.getSelf()
			setDraft(toDraft(response.data.profile))
		} catch (currentError) {
			console.error('Failed to load sales profile:', currentError)
			setError('Data diri belum bisa dimuat.')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	useEffect(() => {
		void salesProfiles
			.products()
			.then((response) => setProducts(response.data || []))
			.catch(() => undefined)
	}, [])

	const productOptions = useMemo(() => {
		const extra = draft.productSkills.filter((skill) => !products.includes(skill))
		return [...products, ...extra]
	}, [products, draft.productSkills])

	const toggleSkill = useCallback((product: string) => {
		setDraft((current) => ({
			...current,
			productSkills: current.productSkills.includes(product)
				? current.productSkills.filter((skill) => skill !== product)
				: [...current.productSkills, product],
		}))
	}, [])

	const save = useCallback(async () => {
		if (!currentUser?.id || saving) return
		setSaving(true)
		setError(null)
		setNotice(null)
		try {
			const response = await salesProfiles.updateSelf(currentUser.id, {
				productSkills: draft.productSkills,
				experienceYears: draft.experienceYears.trim() === '' ? null : Number(draft.experienceYears),
				phone: draft.phone.trim() || null,
				position: draft.position.trim() || null,
				joinedAt: draft.joinedAt || null,
			})
			setDraft(toDraft(response.data.profile))
			setNotice('Data diri kamu sudah disimpan.')
		} catch (currentError) {
			console.error('Failed to save sales profile:', currentError)
			setError(
				currentError instanceof Error ? currentError.message : 'Data diri gagal disimpan.',
			)
		} finally {
			setSaving(false)
		}
	}, [currentUser?.id, draft, saving])

	return (
		<section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
			<header className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					<div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
						<UserCircle2 size={20} />
					</div>
					<div className="min-w-0">
						<h2 className="text-base font-bold">Data diri sales</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							Posisi, kontak, dan produk yang kamu kuasai. Administrator bisa lihat,
							tapi cuma kamu yang bisa mengubahnya.
						</p>
					</div>
				</div>
			</header>

			<div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
				<div>
					<label htmlFor="self-position" className="text-sm font-semibold">
						Posisi
					</label>
					<input
						id="self-position"
						type="text"
						value={draft.position}
						onChange={(event) => setDraft((current) => ({ ...current, position: event.target.value }))}
						placeholder="mis. Account Executive AEC"
						className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
					/>
				</div>

				<div>
					<label htmlFor="self-phone" className="text-sm font-semibold">
						Nomor telepon
					</label>
					<input
						id="self-phone"
						type="text"
						value={draft.phone}
						onChange={(event) => setDraft((current) => ({ ...current, phone: event.target.value }))}
						placeholder="628xx"
						className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
					/>
				</div>

				<div>
					<label htmlFor="self-joined-at" className="text-sm font-semibold">
						Bergabung sejak
					</label>
					<input
						id="self-joined-at"
						type="date"
						value={draft.joinedAt}
						onChange={(event) => setDraft((current) => ({ ...current, joinedAt: event.target.value }))}
						className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
					/>
				</div>

				<div>
					<label htmlFor="self-experience-years" className="text-sm font-semibold">
						Pengalaman (tahun)
					</label>
					<input
						id="self-experience-years"
						type="number"
						min={0}
						max={60}
						value={draft.experienceYears}
						onChange={(event) =>
							setDraft((current) => ({ ...current, experienceYears: event.target.value }))
						}
						className="mt-2 h-10 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
					/>
				</div>

				<div className="lg:col-span-2">
					<span className="text-sm font-semibold">Keahlian produk</span>
					<p className="mt-1 text-[11px] text-muted-foreground">
						Dipakai buat mencocokkan lead ke kamu - lead yang produknya cocok
						diarahkan ke sini.
					</p>
					<div className="mt-2 flex flex-wrap gap-1.5">
						{productOptions.map((product) => {
							const on = draft.productSkills.includes(product)
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
				</div>
			</div>

			<footer className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-h-5 text-xs">
					{loading ? (
						<span className="inline-flex items-center gap-2 text-muted-foreground">
							<LoaderCircle size={13} className="animate-spin" /> Memuat data diri...
						</span>
					) : null}
					{error ? <span className="text-destructive">{error}</span> : null}
					{notice ? <span className="text-emerald-600 dark:text-emerald-400">{notice}</span> : null}
				</div>
				<button
					type="button"
					disabled={saving || !currentUser?.id}
					onClick={() => void save()}
					className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
				>
					{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />}
					Simpan data diri
				</button>
			</footer>
		</section>
	)
}
