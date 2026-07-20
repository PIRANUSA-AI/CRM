import { Link, createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
	AlertTriangle,
	CheckCircle2,
	FileText,
	Loader2,
	Plus,
	Search,
	ShieldCheck,
	Trash2,
	Upload,
} from 'lucide-react'
import {
	sakti as saktiApi,
	type SaktiCheckResult,
	type SaktiImportResult,
	type SaktiRecord,
	type SuratSakti,
} from '@/lib/api'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/sakti/')({
	component: SaktiPage,
})

type MainTab = 'database' | 'surat'

function SaktiPage() {
	const [tab, setTab] = useState<MainTab>('database')

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Database Sakti"
				subtitle="Cek apakah lead sudah punya lisensi di vendor lain, dan kelola Surat Sakti (alih lisensi)."
			/>

			<section className="ocm-card overflow-hidden">
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border p-2">
					{(
						[
							{ value: 'database', label: 'Database Sakti' },
							{ value: 'surat', label: 'Surat Sakti' },
						] as Array<{ value: MainTab; label: string }>
					).map((option) => (
						<button
							key={option.value}
							type='button'
							onClick={() => setTab(option.value)}
							className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
								tab === option.value
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>
				<div className="p-4">
					{tab === 'database' ? <DatabaseTab /> : <SuratTab />}
				</div>
			</section>
		</main>
	)
}

// ---------------------------------------------------------------------------
// Database Sakti — license records + the check tool.
// ---------------------------------------------------------------------------

const RECORDS_PAGE_SIZE = 25

function DatabaseTab() {
	const [records, setRecords] = useState<SaktiRecord[]>([])
	const [search, setSearch] = useState('')
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState<string | null>(null)
	// The licence database grows into thousands of rows from vendor sheets, so
	// the table pages against a real total instead of loading everything.
	const [total, setTotal] = useState(0)
	const [offset, setOffset] = useState(0)

	const [importOpen, setImportOpen] = useState(false)
	const [importBusy, setImportBusy] = useState(false)
	const [importContent, setImportContent] = useState('')
	const [importPreview, setImportPreview] = useState<SaktiImportResult | null>(null)

	// Check tool.
	const [checkName, setCheckName] = useState('')
	const [checkCompany, setCheckCompany] = useState('')
	const [checking, setChecking] = useState(false)
	const [result, setResult] = useState<SaktiCheckResult | null>(null)

	// Add record.
	const [showForm, setShowForm] = useState(false)
	const [form, setForm] = useState({
		customerName: '',
		company: '',
		product: '',
		vendor: '',
		licenseNo: '',
	})
	const [creating, setCreating] = useState(false)

	const load = useCallback(async (q?: string, nextOffset = 0) => {
		setLoading(true)
		try {
			const res = await saktiApi.records.list({
				...(q ? { search: q } : {}),
				limit: RECORDS_PAGE_SIZE,
				offset: nextOffset,
			})
			setRecords(res.payload || [])
			setTotal(res.meta?.total ?? (res.payload || []).length)
			setOffset(nextOffset)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memuat data')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	// Import is CSV: every sheet tool exports it, and these records arrive as
	// vendor exports. A dry run first so the operator sees what will be skipped.
	async function readFile(file: File) {
		setImportBusy(true)
		try {
			const content = await file.text()
			setImportContent(content)
			const res = await saktiApi.records.importCsv(content, true)
			setImportPreview(res.payload)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membaca file')
			setImportPreview(null)
		} finally {
			setImportBusy(false)
		}
	}

	async function commitImport() {
		if (!importContent) return
		setImportBusy(true)
		try {
			const res = await saktiApi.records.importCsv(importContent, false)
			toast.success(`${res.payload.imported} data lisensi diimpor`)
			setImportOpen(false)
			setImportPreview(null)
			setImportContent('')
			await load(search, 0)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal mengimpor')
		} finally {
			setImportBusy(false)
		}
	}

	async function runCheck(e: React.FormEvent) {
		e.preventDefault()
		if (!checkName.trim() && !checkCompany.trim()) return
		setChecking(true)
		setResult(null)
		try {
			const res = await saktiApi.check({
				name: checkName.trim(),
				company: checkCompany.trim() || undefined,
			})
			setResult(res.payload)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal cek')
		} finally {
			setChecking(false)
		}
	}

	async function createLetterFromCheck() {
		try {
			await saktiApi.letters.create({
				customerName: checkName.trim() || 'Tanpa nama',
				company: checkCompany.trim() || undefined,
				fromVendor: result?.records[0]?.vendor || undefined,
				product: result?.records[0]?.product || undefined,
				saktiRecordId: result?.records[0]?.id || undefined,
			})
			toast.success('Surat Sakti dibuat — buka tab "Surat Sakti"')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membuat surat')
		}
	}

	async function handleCreate(e: React.FormEvent) {
		e.preventDefault()
		if (!form.customerName.trim()) return
		setCreating(true)
		try {
			await saktiApi.records.create({
				customerName: form.customerName.trim(),
				company: form.company.trim() || undefined,
				product: form.product.trim() || undefined,
				vendor: form.vendor.trim() || undefined,
				licenseNo: form.licenseNo.trim() || undefined,
			})
			setForm({ customerName: '', company: '', product: '', vendor: '', licenseNo: '' })
			setShowForm(false)
			await load(search)
			toast.success('Data lisensi ditambahkan')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menyimpan')
		} finally {
			setCreating(false)
		}
	}

	async function handleDelete(record: SaktiRecord) {
		if (!window.confirm(`Hapus data lisensi "${record.customerName}"?`)) return
		setBusy(record.id)
		try {
			await saktiApi.records.remove(record.id)
			await load(search)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menghapus')
		} finally {
			setBusy(null)
		}
	}

	return (
		<div className="space-y-5">
			{/* Check tool */}
			<form onSubmit={runCheck} className="ocm-card space-y-3 p-4">
				<p className="inline-flex items-center gap-2 text-sm font-semibold">
					<ShieldCheck size={15} className="text-primary" /> Cek lisensi lead
				</p>
				<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
					<input
						className="ocm-input"
						placeholder="Nama lead"
						value={checkName}
						onChange={(e) => setCheckName(e.target.value)}
					/>
					<input
						className="ocm-input"
						placeholder="Instansi / perusahaan"
						value={checkCompany}
						onChange={(e) => setCheckCompany(e.target.value)}
					/>
				</div>
				<button type="submit" className="ocm-btn ocm-btn-primary" disabled={checking}>
					<Search size={14} /> {checking ? 'Mengecek…' : 'Cek Sakti'}
				</button>

				{result ? (
					<div
						className={`rounded-lg border p-3 text-sm ${
							result.matched
								? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
								: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
						}`}
					>
						<div className="flex items-start gap-2">
							{result.matched ? (
								<AlertTriangle size={16} className="mt-0.5 shrink-0" />
							) : (
								<CheckCircle2 size={16} className="mt-0.5 shrink-0" />
							)}
							<div className="min-w-0 flex-1">
								<p className="font-semibold">{result.message}</p>
								{result.records.length > 0 ? (
									<ul className="mt-1.5 space-y-1 text-xs">
										{result.records.map((r) => (
											<li key={r.id}>
												• {r.customerName}
												{r.company ? ' — ${r.company}' : ''}
												{r.vendor ? ` (vendor: ${r.vendor})` : ''}
												{r.product ? ' · ${r.product}' : ''}
											</li>
										))}
									</ul>
								) : null}
								{result.matched ? (
									<button
										type='button'
										className='ocm-btn mt-2'
										onClick={() => void createLetterFromCheck()}
									>
										<FileText size={14} /> Buat Surat Sakti
									</button>
								) : null}
							</div>
						</div>
					</div>
				) : null}
			</form>

			{/* Records: search + add + list */}
			<div className="flex flex-wrap items-center justify-between gap-2">
				<form
					onSubmit={(e) => {
						e.preventDefault()
						void load(search)
					}}
					className="flex items-center gap-2"
				>
					<input
						className="ocm-input max-w-xs"
						placeholder="Cari nama / instansi / no. lisensi…"
						value={search}
						onChange={(e) => setSearch(e.target.value)}
					/>
					<button type="submit" className="ocm-btn">
						<Search size={14} /> Cari
					</button>
				</form>
				<div className="flex items-center gap-2">
					<button
						type='button'
						className="ocm-btn"
						onClick={() => {
							setImportPreview(null)
							setImportContent('')
							setImportOpen(true)
						}}
					>
						<Upload size={14} /> Impor CSV
					</button>
					<button
						type='button'
						className="ocm-btn ocm-btn-primary"
						onClick={() => setShowForm((v) => !v)}
					>
						<Plus size={14} /> Tambah Data
					</button>
				</div>
			</div>

			{showForm ? (
				<form onSubmit={handleCreate} className="ocm-card space-y-3 p-4">
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<input
							className='ocm-input'
							placeholder="Nama customer *"
							value={form.customerName}
							onChange={(e) => setForm({ ...form, customerName: e.target.value })}
							required
						/>
						<input
							className='ocm-input'
							placeholder="Instansi / perusahaan"
							value={form.company}
							onChange={(e) => setForm({ ...form, company: e.target.value })}
						/>
						<input
							className='ocm-input'
							placeholder="Produk (mis. Archicad)"
							value={form.product}
							onChange={(e) => setForm({ ...form, product: e.target.value })}
						/>
						<input
							className='ocm-input'
							placeholder="Vendor asal (beli di mana)"
							value={form.vendor}
							onChange={(e) => setForm({ ...form, vendor: e.target.value })}
						/>
						<input
							className='ocm-input'
							placeholder="No. lisensi (opsional)"
							value={form.licenseNo}
							onChange={(e) => setForm({ ...form, licenseNo: e.target.value })}
						/>
					</div>
					<div className="flex justify-end gap-2">
						<button type="button" className="ocm-btn" onClick={() => setShowForm(false)}>
							Batal
						</button>
						<button type="submit" className="ocm-btn ocm-btn-primary" disabled={creating}>
							{creating ? 'Menyimpan…' : 'Simpan'}
						</button>
					</div>
				</form>
			) : null}

			{loading ? (
				<div className="space-y-2">
					{Array.from({ length: 3 }).map((_, i) => (
						<div key={i} className="h-12 animate-pulse rounded-lg bg-muted/60" />
					))}
				</div>
			) : records.length === 0 ? (
				<CrmEmptyState
					title="Belum ada data lisensi"
					description="Tambahkan data lisensi lintas-vendor, atau impor nanti. Data ini dipakai untuk cek lead."
				/>
			) : (
				<div className="ocm-card overflow-hidden">
					<div className="overflow-x-auto">
						<table className="ocm-table">
							<thead>
								<tr>
									<th>Customer</th>
									<th>Instansi</th>
									<th>Produk</th>
									<th>Vendor asal</th>
									<th>No. Lisensi</th>
									<th />
								</tr>
							</thead>
							<tbody>
								{records.map((r) => (
									<tr key={r.id}>
										<td className="font-medium">{r.customerName}</td>
										<td className="text-muted-foreground">{r.company || '—'}</td>
										<td className="text-muted-foreground">{r.product || '—'}</td>
										<td className="text-muted-foreground">{r.vendor || '—'}</td>
										<td className="text-muted-foreground">{r.licenseNo || '—'}</td>
										<td className='text-right'>
											<button
												type='button'
												className='ocm-btn h-8 px-2'
												disabled={busy === r.id}
												onClick={() => void handleDelete(r)}
												aria-label='Hapus'
											>
												<Trash2 size={14} className="text-muted-foreground" />
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>

					{total > RECORDS_PAGE_SIZE ? (
						<div className="flex items-center justify-between gap-3 border-t border-border p-3 text-xs text-muted-foreground">
							<span>
								{offset + 1}–{Math.min(offset + RECORDS_PAGE_SIZE, total)} dari{' '}
								{total.toLocaleString('id-ID')}
							</span>
							<div className="flex items-center gap-2">
								<button
									type='button'
									className="ocm-btn h-8 px-3"
									disabled={loading || offset === 0}
									onClick={() => void load(search, Math.max(0, offset - RECORDS_PAGE_SIZE))}
								>
									Sebelumnya
								</button>
								<button
									type='button'
									className="ocm-btn h-8 px-3"
									disabled={loading || offset + RECORDS_PAGE_SIZE >= total}
									onClick={() => void load(search, offset + RECORDS_PAGE_SIZE)}
								>
									Berikutnya
								</button>
							</div>
						</div>
					) : null}
				</div>
			)}

			<Dialog open={importOpen} onOpenChange={(open) => !importBusy && setImportOpen(open)}>
				<DialogContent className="sm:max-w-2xl">
					<DialogHeader>
						<DialogTitle>Impor Data Lisensi</DialogTitle>
						<DialogDescription>
							Unggah file CSV. Kalau sheet-mu masih Excel, simpan sebagai CSV dulu.
						</DialogDescription>
					</DialogHeader>

					<input
						type='file'
						accept=".csv,text/csv"
						disabled={importBusy}
						onChange={(event) => {
							const file = event.target.files?.[0]
							if (file) void readFile(file)
						}}
						className="ocm-input"
					/>

					<p className="text-[11px] text-muted-foreground">
						Kolom yang dikenali: Nama Customer, Perusahaan, Produk, Vendor Asal, No
						Lisensi, Tanggal Beli, Keterangan. Kolom lain diabaikan.
					</p>

					{importBusy && !importPreview ? (
						<div className="flex items-center gap-2 p-3 text-sm text-muted-foreground">
							<Loader2 size={16} className="animate-spin" /> Membaca file…
						</div>
					) : null}

					{importPreview ? (
						<div className="space-y-3">
							<div className="flex flex-wrap gap-2 text-xs">
								<span className="rounded-full bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-600 dark:text-emerald-300">
									{importPreview.summary.ok} akan diimpor
								</span>
								<span className="rounded-full bg-amber-500/10 px-2 py-1 font-semibold text-amber-700 dark:text-amber-300">
									{importPreview.summary.skipped} dilewati (sudah ada)
								</span>
								<span className="rounded-full bg-red-500/10 px-2 py-1 font-semibold text-red-600 dark:text-red-300">
									{importPreview.summary.error} bermasalah
								</span>
							</div>

							{importPreview.unmapped.length > 0 ? (
								<p className="text-[11px] text-muted-foreground">
									Kolom tidak dikenali dan diabaikan: {importPreview.unmapped.join(', ')}
								</p>
							) : null}

							<div className="max-h-64 overflow-y-auto rounded-lg border border-border">
								<table className="w-full text-xs">
									<tbody className="divide-y divide-border">
										{importPreview.rows.map((row) => (
											<tr key={row.line}>
												<td className="w-10 px-2 py-1.5 text-muted-foreground">{row.line}</td>
												<td className='px-2 py-1.5'>
													{row.customerName || (
														<span className="text-muted-foreground">(kosong)</span>
													)}
													{row.licenseNo ? (
														<span className="ml-1 text-muted-foreground">
															· {row.licenseNo}
														</span>
													) : null}
												</td>
												<td className="px-2 py-1.5 text-right">
													<span
														className={
															row.status === 'ok'
																? 'text-emerald-600 dark:text-emerald-300'
																: row.status === 'skipped'
																	? 'text-amber-700 dark:text-amber-300'
																	: 'text-red-600 dark:text-red-300'
														}
													>
														{row.status === 'ok'
															? 'siap'
															: row.status === 'skipped'
																? 'dilewati'
																: 'error'}
													</span>
													{row.messages.length > 0 ? (
														<span className="ml-1 text-muted-foreground">
															· {row.messages[0]}
														</span>
													) : null}
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					) : null}

					<DialogFooter>
						<button
							type='button'
							className='ocm-btn'
							onClick={() => setImportOpen(false)}
							disabled={importBusy}
						>
							Batal
						</button>
						<button
							type='button'
							className="ocm-btn ocm-btn-primary"
							onClick={() => void commitImport()}
							disabled={importBusy || !importPreview || importPreview.summary.ok === 0}
						>
							{importBusy ? <Loader2 size={14} className="animate-spin" /> : null}
							Impor {importPreview?.summary.ok ?? 0} data
						</button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}

// ---------------------------------------------------------------------------
// Surat Sakti — transfer letters + dual approval.
// ---------------------------------------------------------------------------

const LETTER_STATUS: Record<string, { label: string; tone: string }> = {
	draft: { label: 'Draf', tone: 'ocm-tag' },
	pending: { label: 'Menunggu', tone: 'ocm-tag ocm-tag-warning' },
	approved: { label: 'Disetujui', tone: 'ocm-tag ocm-tag-success' },
	rejected: { label: 'Ditolak', tone: 'ocm-tag ocm-tag-danger' },
}

function SuratTab() {
	const [letters, setLetters] = useState<SuratSakti[]>([])
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState<string | null>(null)

	// Only the count is needed here; composing happens on its own page, where the
	// letter has room to be read while it is written.
	const [templateCount, setTemplateCount] = useState(0)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			const res = await saktiApi.letters.list()
			setLetters(res.payload || [])
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memuat surat')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	useEffect(() => {
		void saktiApi
			.templates()
			.then((res) => setTemplateCount((res.payload || []).length))
			.catch(() => undefined)
	}, [])

	async function toggle(letter: SuratSakti, field: 'ourApproved' | 'theirApproved') {
		setBusy(letter.id)
		try {
			await saktiApi.letters.update(letter.id, { [field]: !letter[field] })
			await load()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memperbarui')
		} finally {
			setBusy(null)
		}
	}

	async function reject(letter: SuratSakti) {
		setBusy(letter.id)
		try {
			await saktiApi.letters.update(letter.id, { status: 'rejected' })
			await load()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal')
		} finally {
			setBusy(null)
		}
	}

	async function handleDelete(letter: SuratSakti) {
		if (!window.confirm(`Hapus Surat Sakti "${letter.customerName}"?`)) return
		setBusy(letter.id)
		try {
			await saktiApi.letters.remove(letter.id)
			await load()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menghapus')
		} finally {
			setBusy(null)
		}
	}

	if (loading) {
		return (
			<div className="space-y-2">
				{Array.from({ length: 3 }).map((_, i) => (
					<div key={i} className="h-24 animate-pulse rounded-lg bg-muted/60" />
				))}
			</div>
		)
	}

	// Composing happens on its own page: the letter needs room to be read while
	// it is written, which a dialog could not give it. The button sits above the
	// list so it is reachable when there are no letters yet.
	const composeBar = (
		<div className="flex flex-wrap items-center justify-between gap-2">
			<p className="text-xs text-muted-foreground">
				{templateCount} template tersedia · isi surat masih contoh, ganti dengan
				redaksi resmi sebelum dikirim
			</p>
			<Link to="/sakti/surat-baru" className="ocm-btn ocm-btn-primary">
				<FileText size={14} /> Susun Surat
			</Link>
		</div>
	)

	if (letters.length === 0) {
		return (
			<div className="space-y-4">
				{composeBar}
				<CrmEmptyState
					title="Belum ada Surat Sakti"
					description="Susun surat dari template, atau buka tab Database Sakti untuk cek lead yang lisensinya ada di vendor lain."
				/>
				</div>
		)
	}

	return (
		<div className="space-y-4">
			{composeBar}
			{letters.map((letter) => {
				const meta = LETTER_STATUS[letter.status] || LETTER_STATUS.draft
				const rowBusy = busy === letter.id
				return (
					<div key={letter.id} className="ocm-card">
						<div className="ocm-card-header">
							<div className="flex min-w-0 items-center gap-2">
								<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
									<FileText size={15} />
								</span>
								<div className="min-w-0">
									<div className="truncate font-semibold">{letter.customerName}</div>
									<div className="truncate text-xs text-muted-foreground">
										{[letter.company, letter.product, letter.fromVendor && `dari ${letter.fromVendor}`]
											.filter(Boolean)
											.join(' · ') || 'Tanpa detail'}
									</div>
								</div>
							</div>
							<div className="flex shrink-0 items-center gap-2">
								<span className={meta.tone}>{meta.label}</span>
								<button
									type='button'
									className="text-muted-foreground hover:text-red-500"
									disabled={rowBusy}
									onClick={() => void handleDelete(letter)}
									aria-label='Hapus'
								>
									<Trash2 size={15} />
								</button>
							</div>
						</div>
						<div className="ocm-card-body flex flex-wrap items-center gap-2">
							<button
								type='button'
								disabled={rowBusy}
								onClick={() => void toggle(letter, 'ourApproved')}
								className={`ocm-tag ${letter.ourApproved ? 'ocm-tag-success' : ''}`}
							>
								{letter.ourApproved ? '● ' : '○ '}Persetujuan kami (PIRANUSA)
							</button>
							<button
								type='button'
								disabled={rowBusy}
								onClick={() => void toggle(letter, 'theirApproved')}
								className={`ocm-tag ${letter.theirApproved ? 'ocm-tag-success' : ''}`}
							>
								{letter.theirApproved ? '● ' : '○ '}Persetujuan vendor asal
							</button>
							{letter.status !== 'rejected' && letter.status !== 'approved' ? (
								<button
									type='button'
									disabled={rowBusy}
									onClick={() => void reject(letter)}
									className="ocm-tag ocm-tag-danger"
								>
									Tolak
								</button>
							) : null}
						</div>
					</div>
				)
			})}
		</div>
	)
}
