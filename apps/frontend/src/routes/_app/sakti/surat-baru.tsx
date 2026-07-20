import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Loader2, Save, TriangleAlert } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { sakti as saktiApi, type LetterTemplate } from '@/lib/api'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/sakti/surat-baru')({
	component: SuratBaruPage,
	validateSearch: (search: Record<string, unknown>) => {
		const next: { template?: string } = {}
		if (typeof search.template === 'string') next.template = search.template
		return next
	},
})

/**
 * Fill a template's placeholders in the browser.
 *
 * The template body arrives with the catalogue, so there is nothing to ask the
 * server for. Rendering here also removes a whole failure mode: the previous
 * version round-tripped on every keystroke and swallowed errors, so a failed
 * request left the preview showing the empty-form version while the fields
 * were plainly filled in — it looked like the data was being ignored.
 *
 * Mirrors renderLetter() in modules/sakti/letter-templates.ts. Blanks render as
 * "-" rather than leaving `{{field}}` visible, because these get printed.
 */
function renderBody(template: LetterTemplate, values: Record<string, string>): string {
	return template.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
		return (values[key] || '').trim() || '-'
	})
}

function SuratBaruPage() {
	const navigate = useNavigate()
	const search = Route.useSearch()

	const [templates, setTemplates] = useState<LetterTemplate[]>([])
	const [templateId, setTemplateId] = useState(search.template || '')
	const [values, setValues] = useState<Record<string, string>>({})
	const [saving, setSaving] = useState(false)
	const [loading, setLoading] = useState(true)

	useEffect(() => {
		void saktiApi
			.templates()
			.then((res) => setTemplates(res.payload || []))
			.catch(() => toast.error('Gagal memuat template'))
			.finally(() => setLoading(false))
	}, [])

	const template = templates.find((item) => item.id === templateId) || null

	const body = useMemo(
		() => (template ? renderBody(template, values) : ''),
		[template, values],
	)

	const missing = useMemo(() => {
		if (!template) return []
		return template.fields
			.filter((field) => field.required && !(values[field.key] || '').trim())
			.map((field) => field.label)
	}, [template, values])

	async function save() {
		if (!template) return
		const penerima = (values.penerima || '').trim()
		if (!penerima) {
			toast.error('Isi dulu "Ditujukan kepada"')
			return
		}
		setSaving(true)
		try {
			await saktiApi.letters.create({
				customerName: penerima,
				company: penerima,
				product: (values.produk || '').trim() || null,
				template: template.id,
				templateValues: values,
			})
			toast.success(`${template.name} tersimpan sebagai draf`)
			void navigate({ to: '/sakti' })
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menyimpan surat')
		} finally {
			setSaving(false)
		}
	}

	return (
		<main className="ocm-page space-y-4">
			<div className="flex flex-wrap items-center justify-between gap-3">
				<div className="flex items-center gap-3">
					<button
						type="button"
						className="ocm-btn"
						onClick={() => void navigate({ to: '/sakti' })}
					>
						<ArrowLeft size={14} /> Kembali
					</button>
					<div>
						<h1 className="text-lg font-semibold">Susun Surat</h1>
						<p className="text-sm text-muted-foreground">
							{template ? template.description : 'Pilih template untuk mulai.'}
						</p>
					</div>
				</div>
				<button
					type="button"
					className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90"
					onClick={() => void save()}
					disabled={saving || !template}
				>
					{saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
					Simpan draf
				</button>
			</div>

			{loading ? (
				<div className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
					<Loader2 size={16} className="animate-spin" /> Memuat template…
				</div>
			) : (
				<div className="grid gap-4 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)] lg:items-start">
					{/* Form */}
					<section className="ocm-card space-y-4 p-5">
						<label className="block">
							<span className="mb-1 block text-xs font-medium text-muted-foreground">
								Template
							</span>
							<select
								className="ocm-input"
								value={templateId}
								onChange={(event) => {
									setTemplateId(event.target.value)
									setValues({})
								}}
							>
								<option value="">— Pilih template —</option>
								{templates.map((item) => (
									<option key={item.id} value={item.id}>
										{item.name}
									</option>
								))}
							</select>
						</label>

						{template ? (
							<div className="space-y-3">
								{template.fields.map((field) => (
									<label key={field.key} className="block">
										<span className="mb-1 block text-xs font-medium text-muted-foreground">
											{field.label}
											{field.required ? ' *' : ''}
										</span>
										<input
											className="ocm-input"
											placeholder={field.example}
											value={values[field.key] || ''}
											onChange={(event) =>
												setValues((prev) => ({
													...prev,
													[field.key]: event.target.value,
												}))
											}
										/>
									</label>
								))}
							</div>
						) : null}

						{template && missing.length > 0 ? (
							<div className="flex items-start gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
								<TriangleAlert size={14} className="mt-0.5 shrink-0" />
								<span>Belum diisi: {missing.join(', ')}</span>
							</div>
						) : null}
					</section>

					{/* Preview, laid out like the printed page rather than a code block —
					    this is what gets attached to a tender, so it should read like a
					    letter while it is being written. */}
					<section className="lg:sticky lg:top-4">
						<p className="mb-2 text-xs font-medium text-muted-foreground">Pratinjau</p>
						{template ? (
							<div className="overflow-hidden rounded-lg border border-border bg-white shadow-sm dark:bg-zinc-900">
								<div className="max-h-[calc(100vh-13rem)] overflow-y-auto px-8 py-10 sm:px-12">
									<pre className="whitespace-pre-wrap font-serif text-[13px] leading-7 text-zinc-900 dark:text-zinc-100">
										{body}
									</pre>
								</div>
							</div>
						) : (
							<div className="rounded-lg border border-dashed border-border p-10 text-center text-sm text-muted-foreground">
								Pilih template dulu untuk melihat suratnya.
							</div>
						)}
						<p className="mt-2 text-[11px] text-muted-foreground">
							Isi surat masih contoh — ganti dengan redaksi resmi sebelum dikirim.
						</p>
					</section>
				</div>
			)}
		</main>
	)
}
