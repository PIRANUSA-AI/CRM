import { createFileRoute } from '@tanstack/react-router'
import { CheckCircle2, Loader2, RefreshCw, Save, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
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

function SalesProfilesPage() {
	const [rows, setRows] = useState<SalesProfileRow[]>([])
	const [drafts, setDrafts] = useState<Record<string, Draft>>({})
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [savingId, setSavingId] = useState<string | null>(null)
	const [savedId, setSavedId] = useState<string | null>(null)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await salesProfiles.list()
			setRows(response.data)
			setDrafts(Object.fromEntries(response.data.map((row) => [row.userId, toDraft(row)])))
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal memuat profil sales.')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	const patchDraft = useCallback((userId: string, patch: Partial<Draft>) => {
		setSavedId(null)
		setDrafts((prev) => ({ ...prev, [userId]: { ...prev[userId], ...patch } }))
	}, [])

	const save = useCallback(
		async (userId: string) => {
			const draft = drafts[userId]
			if (!draft) return
			setSavingId(userId)
			setError(null)
			setSavedId(null)
			try {
				const response = await salesProfiles.update(userId, {
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
						row.userId === userId ? { ...row, profile: response.data.profile } : row,
					),
				)
				setDrafts((prev) => ({ ...prev, [userId]: toDraft(response.data) }))
				setSavedId(userId)
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : 'Gagal menyimpan profil.')
			} finally {
				setSavingId(null)
			}
		},
		[drafts],
	)

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

			{loading ? (
				<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
					<Loader2 size={16} className="animate-spin" /> Memuat profil sales...
				</div>
			) : rows.length === 0 ? (
				<div className="ocm-card p-6 text-sm text-muted-foreground">
					Belum ada sales di tim Anda. Tambahkan anggota tim dulu di Kelola Tim.
				</div>
			) : (
				<div className="space-y-4">
					{rows.map((row) => {
						const draft = drafts[row.userId]
						if (!draft) return null
						const overloaded = row.activeLoad >= (Number(draft.maxActive) || 20)
						return (
							<section key={row.userId} className="ocm-card overflow-hidden">
								<div className="flex flex-wrap items-center justify-between gap-2 border-b border-border p-4">
									<div>
										<p className="text-sm font-semibold">
											{row.name || row.email}
											<span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
												{row.role || 'sales'}
											</span>
										</p>
										<p className="text-xs text-muted-foreground">{row.email}</p>
									</div>
									<div
										className={`rounded-lg px-3 py-1.5 text-xs font-medium ${
											overloaded
												? 'bg-red-500/10 text-red-600 dark:text-red-300'
												: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
										}`}
									>
										Beban aktif: {row.activeLoad} / {Number(draft.maxActive) || 20}
									</div>
								</div>

								<div className="grid gap-4 p-4 sm:grid-cols-2">
									<Field label="Keahlian produk" hint="Pisahkan dengan koma, mis. ZWCAD Mechanical, ZW3D">
										<input
											className={inputClass}
											value={draft.productSkills}
											onChange={(event) => patchDraft(row.userId, { productSkills: event.target.value })}
											placeholder="ZWCAD Mechanical, Archicad"
										/>
									</Field>
									<Field label="Segmen andalan" hint="mis. korporat, mahasiswa, individu">
										<input
											className={inputClass}
											value={draft.segments}
											onChange={(event) => patchDraft(row.userId, { segments: event.target.value })}
											placeholder="korporat, individu"
										/>
									</Field>
									<Field label="Level / pengalaman">
										<select
											className={inputClass}
											value={draft.level}
											onChange={(event) => patchDraft(row.userId, { level: event.target.value })}
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
											onChange={(event) => patchDraft(row.userId, { maxActive: event.target.value })}
										/>
									</Field>
									<Field label="Wilayah" hint="mis. Jawa Timur, Jakarta">
										<input
											className={inputClass}
											value={draft.regions}
											onChange={(event) => patchDraft(row.userId, { regions: event.target.value })}
											placeholder="Jawa Timur"
										/>
									</Field>
									<Field label="Bahasa" hint="mis. id, en">
										<input
											className={inputClass}
											value={draft.languages}
											onChange={(event) => patchDraft(row.userId, { languages: event.target.value })}
											placeholder="id, en"
										/>
									</Field>
									<Field label="Tag" hint="opsional, mis. cocok_customer_teknis">
										<input
											className={inputClass}
											value={draft.tags}
											onChange={(event) => patchDraft(row.userId, { tags: event.target.value })}
											placeholder="cocok_customer_teknis"
										/>
									</Field>
									<Field label="Catatan">
										<input
											className={inputClass}
											value={draft.notes}
											onChange={(event) => patchDraft(row.userId, { notes: event.target.value })}
											placeholder="Catatan internal"
										/>
									</Field>
								</div>

								<div className="flex items-center justify-end gap-3 border-t border-border p-3">
									{savedId === row.userId ? (
										<span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-300">
											<CheckCircle2 size={14} /> Tersimpan
										</span>
									) : null}
									<button
										type="button"
										className="ocm-btn"
										onClick={() => void save(row.userId)}
										disabled={savingId === row.userId}
									>
										{savingId === row.userId ? (
											<Loader2 size={14} className="animate-spin" />
										) : (
											<Save size={14} />
										)}
										Simpan
									</button>
								</div>
							</section>
						)
					})}
				</div>
			)}
		</main>
	)
}
