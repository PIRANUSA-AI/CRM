import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CheckCircle2, FileSpreadsheet, TriangleAlert, Upload, UserPlus } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useRef, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
import {
	leadImport,
	type ImportCommitResult,
	type ImportJobRow,
	type ImportJobView,
} from '@/lib/api'

export const Route = createFileRoute('/_app/import')({
	component: ImportPage,
})

type AssignOption = { email: string; name: string | null }

const STATUS_STYLE: Record<string, string> = {
	ok: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
	imported: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300',
	warning: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
	error: 'bg-red-500/10 text-red-600 dark:text-red-300',
	skipped: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
}

const STATUS_LABEL: Record<string, string> = {
	ok: 'Siap',
	imported: 'Terimpor',
	warning: 'Perlu cek',
	error: 'Error',
	skipped: 'Dilewati',
}

function str(value: unknown): string {
	return value === null || value === undefined ? '' : String(value)
}

function ImportPage() {
	const navigate = useNavigate()
	const fileInputRef = useRef<HTMLInputElement | null>(null)
	const [job, setJob] = useState<ImportJobView | null>(null)
	const [assignOptions, setAssignOptions] = useState<AssignOption[]>([])
	const [loading, setLoading] = useState(false)
	const [committing, setCommitting] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [result, setResult] = useState<ImportCommitResult | null>(null)
	const [rowBusy, setRowBusy] = useState<string | null>(null)

	// Manual single-lead entry
	const emptyLead = {
		name: '', phone: '', email: '', company: '', city: '',
		productInterest: '', pipelineStage: '', notes: '', assignedTo: '',
	}
	const [salesOptions, setSalesOptions] = useState<Array<{ userId: string; name: string | null; email: string }>>([])
	const [manualOpen, setManualOpen] = useState(false)
	const [savingLead, setSavingLead] = useState(false)
	const [leadMsg, setLeadMsg] = useState<{ ok: boolean; text: string } | null>(null)
	const [lead, setLead] = useState(emptyLead)

	useEffect(() => {
		leadImport
			.assignables()
			.then((r) => setSalesOptions(r.data))
			.catch(() => undefined)
	}, [])

	const submitManualLead = useCallback(async () => {
		if (!lead.name.trim() || !lead.assignedTo) {
			setLeadMsg({ ok: false, text: 'Nama lead dan sales tujuan wajib diisi.' })
			return
		}
		if (!lead.phone.trim() && !lead.email.trim()) {
			setLeadMsg({ ok: false, text: 'Isi minimal nomor WhatsApp atau email.' })
			return
		}
		setSavingLead(true)
		setLeadMsg(null)
		try {
			const res = await leadImport.createManualLead({
				name: lead.name.trim(),
				phone: lead.phone.trim() || undefined,
				email: lead.email.trim() || undefined,
				company: lead.company.trim() || undefined,
				city: lead.city.trim() || undefined,
				productInterest: lead.productInterest.trim() || undefined,
				pipelineStage: lead.pipelineStage.trim() || undefined,
				notes: lead.notes.trim() || undefined,
				assignedTo: lead.assignedTo,
			})
			const d = res.data
			setLeadMsg({
				ok: true,
				text: `Lead "${lead.name.trim()}" ${d.updated ? 'diperbarui' : 'ditambahkan'}${d.taskId ? ' + task follow-up dibuat' : ''} untuk ${d.assigneeName || 'sales'}.`,
			})
			setLead({ ...emptyLead, assignedTo: lead.assignedTo })
		} catch (reason) {
			setLeadMsg({ ok: false, text: reason instanceof Error ? reason.message : 'Gagal menambahkan lead' })
		} finally {
			setSavingLead(false)
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [lead])

	const handleFile = useCallback(async (file: File) => {
		setLoading(true)
		setError(null)
		setResult(null)
		try {
			const content = await file.text()
			const response = await leadImport.preview(file.name, content)
			setJob(response.data)
			if (response.data.assignableOptions) setAssignOptions(response.data.assignableOptions)
		} catch (reason) {
			setJob(null)
			setError(reason instanceof Error ? reason.message : 'Gagal membaca CSV')
		} finally {
			setLoading(false)
		}
	}, [])

	const changeAssignee = useCallback(
		async (row: ImportJobRow, email: string) => {
			if (!job) return
			setRowBusy(row.id)
			setError(null)
			try {
				const response = await leadImport.updateRowAssignee(
					job.job.id,
					row.id,
					email || null,
				)
				setJob((current) =>
					current ? { ...response.data, assignableOptions: current.assignableOptions } : response.data,
				)
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : 'Gagal mengubah assignee')
			} finally {
				setRowBusy(null)
			}
		},
		[job],
	)

	const commit = useCallback(async () => {
		if (!job) return
		setCommitting(true)
		setError(null)
		try {
			const response = await leadImport.commit(job.job.id)
			setResult(response.data)
			setJob(null)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal memproses import')
		} finally {
			setCommitting(false)
		}
	}, [job])

	const reset = useCallback(() => {
		setJob(null)
		setResult(null)
		setError(null)
		setAssignOptions([])
		if (fileInputRef.current) fileInputRef.current.value = ''
	}, [])

	const errorRows = job?.rows.filter((r) => r.status === 'error').length ?? 0
	const warningRows = job?.rows.filter((r) => r.status === 'warning').length ?? 0
	const readyRows = job ? job.rows.length - errorRows : 0

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Import Data Lead"
				subtitle="Unggah CSV, tinjau, atur assignee, lalu proses. Hanya untuk leader."
				actions={
					job || result ? (
						<button type="button" className="ocm-btn" onClick={reset}>
							<Upload size={14} /> Unggah file lain
						</button>
					) : null
				}
			/>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={18} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			{/* Hasil commit */}
			{result ? (
				<section className="ocm-card p-5">
					<div className="mb-3 flex items-center gap-2">
						<CheckCircle2 className="text-emerald-500" size={22} />
						<h2 className="text-lg font-semibold">Import selesai</h2>
					</div>
					<div className="ocm-grid-4">
						<Stat label="Kontak baru" value={result.imported} />
						<Stat label="Diperbarui" value={result.updated} />
						<Stat label="Task dibuat" value={result.tasksCreated} />
						<Stat label="Dilewati/Error" value={result.skipped + result.errors} />
					</div>
					{result.errorLog.length > 0 ? (
						<div className="mt-4">
							<p className="mb-1 text-sm font-semibold text-muted-foreground">Log error</p>
							<ul className="space-y-1 text-sm">
								{result.errorLog.map((entry) => (
									<li key={entry.row} className="text-red-600 dark:text-red-300">
										Baris {entry.row}: {entry.reason}
									</li>
								))}
							</ul>
						</div>
					) : null}
					<div className="mt-4 flex gap-2">
						<button type="button" className="ocm-btn" onClick={() => navigate({ to: '/customers' })}>
							Lihat Kontak
						</button>
						<button type="button" className="ocm-btn" onClick={reset}>
							Import lagi
						</button>
					</div>
				</section>
			) : null}

			{/* Uploader */}
			{!job && !result ? (
				<section className="ocm-card p-8">
					<button
						type="button"
						onClick={() => fileInputRef.current?.click()}
						disabled={loading}
						className="flex w-full flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border py-12 text-center transition-colors hover:border-primary/50 hover:bg-muted/40"
					>
						<FileSpreadsheet size={40} className="text-primary" />
						<div>
							<p className="font-semibold">{loading ? 'Membaca CSV...' : 'Klik untuk pilih file CSV'}</p>
							{/* The picker filters to .csv, so an .xlsx simply appears greyed out
							    with no explanation. Saying it here is the difference between a
							    one-step Save As and assuming the import is broken. */}
							<p className="text-sm text-muted-foreground">
								<strong>Format CSV saja.</strong> Kalau datamu masih Excel (.xlsx),
								buka di Excel/Sheets lalu <em>Save As / Download</em> sebagai CSV dulu.
							</p>
							<p className="mt-1 text-sm text-muted-foreground">
								Kolom wajib: name, phone. Assignee memakai email sales di tim Anda.
							</p>
						</div>
					</button>
					<input
						ref={fileInputRef}
						type="file"
						accept=".csv,text/csv"
						className="hidden"
						onChange={(event) => {
							const file = event.target.files?.[0]
							if (file) void handleFile(file)
						}}
					/>
				</section>
			) : null}

			{/* Tambah lead manual (tanpa CSV) */}
			{!job && !result ? (
				<section className="ocm-card p-5">
					<div className="flex items-center justify-between gap-3">
						<div>
							<h2 className="text-base font-semibold">Tambah Lead Manual</h2>
							<p className="text-sm text-muted-foreground">
								Input satu lead dan assign ke sales, otomatis membuat task follow-up.
							</p>
						</div>
						<button type="button" className="ocm-btn" onClick={() => setManualOpen((o) => !o)}>
							<UserPlus size={14} /> {manualOpen ? 'Tutup' : 'Tambah lead'}
						</button>
					</div>

					{manualOpen ? (
						<div className="mt-4 space-y-3">
							{leadMsg ? (
								<div
									className={`rounded-md px-3 py-2 text-sm ${
										leadMsg.ok
											? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
											: 'bg-red-500/10 text-red-600 dark:text-red-300'
									}`}
								>
									{leadMsg.text}
								</div>
							) : null}
							<div className="grid gap-3 sm:grid-cols-2">
								<LeadField label="Nama *">
									<input
										value={lead.name}
										onChange={(e) => setLead((l) => ({ ...l, name: e.target.value }))}
										placeholder="Nama kontak"
										className="ocm-input"
									/>
								</LeadField>
								<LeadField label="Sales tujuan *">
									<select
										value={lead.assignedTo}
										onChange={(e) => setLead((l) => ({ ...l, assignedTo: e.target.value }))}
										className="ocm-input"
									>
										<option value="">pilih sales</option>
										{salesOptions.map((opt) => (
											<option key={opt.userId} value={opt.userId}>
												{opt.name || opt.email}
											</option>
										))}
									</select>
								</LeadField>
								<LeadField label="No. WhatsApp">
									<input
										value={lead.phone}
										onChange={(e) => setLead((l) => ({ ...l, phone: e.target.value }))}
										placeholder="08xx / 62xx"
										className="ocm-input"
									/>
								</LeadField>
								<LeadField label="Email">
									<input
										value={lead.email}
										onChange={(e) => setLead((l) => ({ ...l, email: e.target.value }))}
										placeholder="email@perusahaan.com"
										className="ocm-input"
									/>
								</LeadField>
								<LeadField label="Perusahaan">
									<input
										value={lead.company}
										onChange={(e) => setLead((l) => ({ ...l, company: e.target.value }))}
										className="ocm-input"
									/>
								</LeadField>
								<LeadField label="Kota">
									<input
										value={lead.city}
										onChange={(e) => setLead((l) => ({ ...l, city: e.target.value }))}
										className="ocm-input"
									/>
								</LeadField>
								<LeadField label="Produk diminati">
									<input
										value={lead.productInterest}
										onChange={(e) => setLead((l) => ({ ...l, productInterest: e.target.value }))}
										placeholder="mis. ZWCAD 2025 Professional"
										className="ocm-input"
									/>
								</LeadField>
								<LeadField label="Tahap pipeline">
									<input
										value={lead.pipelineStage}
										onChange={(e) => setLead((l) => ({ ...l, pipelineStage: e.target.value }))}
										placeholder="mis. Kualifikasi / Penawaran"
										className="ocm-input"
									/>
								</LeadField>
							</div>
							<LeadField label="Catatan">
								<textarea
									value={lead.notes}
									onChange={(e) => setLead((l) => ({ ...l, notes: e.target.value }))}
									rows={2}
									placeholder="Konteks singkat lead"
									className="ocm-input resize-y"
								/>
							</LeadField>
							<div className="flex justify-end">
								<button
									type="button"
									className="ocm-btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
									onClick={() => void submitManualLead()}
									disabled={savingLead}
								>
									<CheckCircle2 size={15} />
									{savingLead ? 'Menyimpan...' : 'Simpan Lead & Assign'}
								</button>
							</div>
						</div>
					) : null}
				</section>
			) : null}

			{/* Preview */}
			{job ? (
				<section className="ocm-card overflow-hidden">
					<div className="flex flex-col gap-3 border-b border-border p-4 sm:flex-row sm:items-center sm:justify-between">
						<div>
							<h2 className="text-base font-semibold">{job.job.filename}</h2>
							<p className="text-sm text-muted-foreground">
								{job.job.totalRows} baris · {readyRows} siap · {warningRows} perlu cek ·{' '}
								<span className={errorRows ? 'text-red-500' : ''}>{errorRows} error</span>
							</p>
						</div>
						<button
							type="button"
							className="ocm-btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
							onClick={() => void commit()}
							disabled={committing || readyRows === 0}
						>
							<CheckCircle2 size={15} />
							{committing ? 'Memproses...' : `Proses ${readyRows} baris`}
						</button>
					</div>

					{job.unmappedHeaders && job.unmappedHeaders.length > 0 ? (
						<div className="border-b border-border bg-amber-500/5 px-4 py-2 text-xs text-amber-700 dark:text-amber-300">
							Kolom tidak dikenali (diabaikan): {job.unmappedHeaders.join(', ')}
						</div>
					) : null}

					<div className="overflow-x-auto">
						<table className="w-full min-w-[820px] text-sm">
							<thead>
								<tr className="border-b border-border text-left text-xs uppercase text-muted-foreground">
									<th className="p-3">#</th>
									<th className="p-3">Status</th>
									<th className="p-3">Nama</th>
									<th className="p-3">Telepon</th>
									<th className="p-3">Perusahaan</th>
									<th className="p-3">Tahap</th>
									<th className="p-3">Assign ke</th>
								</tr>
							</thead>
							<tbody>
								{job.rows.map((row) => {
									const mapped = row.mapped as Record<string, unknown>
									const messages = Array.isArray(row.messages) ? row.messages : []
									return (
										<tr key={row.id} className="border-b border-border/60 align-top">
											<td className="p-3 text-muted-foreground">{row.rowNumber}</td>
											<td className="p-3">
												<span
													className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${STATUS_STYLE[row.status] || ''}`}
												>
													{STATUS_LABEL[row.status] || row.status}
												</span>
												{messages.length > 0 ? (
													<p className="mt-1 max-w-[220px] text-[11px] text-muted-foreground">
														{messages.join('; ')}
													</p>
												) : null}
											</td>
											<td className="p-3 font-medium">{str(mapped.name)}</td>
											<td className="p-3 text-muted-foreground">{str(mapped.phone)}</td>
											<td className="p-3 text-muted-foreground">{str(mapped.company)}</td>
											<td className="p-3 text-muted-foreground">{str(mapped.pipeline_stage)}</td>
											<td className="p-3">
												<select
													value={str(mapped.assigned_to)}
													disabled={rowBusy === row.id || row.status === 'error'}
													onChange={(event) => void changeAssignee(row, event.target.value)}
													className="w-full min-w-[160px] rounded-md border border-border bg-background px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
												>
													<option value="">pilih sales</option>
													{assignOptions.map((opt) => (
														<option key={opt.email} value={opt.email}>
															{opt.name || opt.email}
														</option>
													))}
												</select>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
				</section>
			) : null}
		</main>
	)
}

function LeadField({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="block">
			<span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
			{children}
		</label>
	)
}

function Stat({ label, value }: { label: string; value: number }) {
	return (
		<div className="rounded-lg border border-border bg-muted/30 p-3">
			<p className="text-xs text-muted-foreground">{label}</p>
			<p className="text-2xl font-bold">{value.toLocaleString('id-ID')}</p>
		</div>
	)
}
