import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useEffect, useState } from 'react'
import {
	CheckCircle2,
	Plus,
	RefreshCw,
	RotateCcw,
	Target,
	Trash2,
	XCircle,
} from 'lucide-react'
import {
	opportunities as opportunitiesApi,
	type Opportunity,
	type OpportunityStats,
} from '@/lib/api'
import {
	CrmEmptyState,
	CrmSectionHeader,
	CrmStatCard,
} from '@/components/crm/shared'
import { toast } from 'sonner'

export const Route = createFileRoute('/_app/opportunity')({
	component: OpportunityPage,
})

const STATUS_TABS: Array<{ value: string; label: string }> = [
	{ value: 'all', label: 'Semua' },
	{ value: 'open', label: 'Berjalan' },
	{ value: 'won', label: 'Menang' },
	{ value: 'lost', label: 'Kalah' },
]

const STATUS_META: Record<string, { label: string; tone: string }> = {
	open: { label: 'Berjalan', tone: 'ocm-tag' },
	won: { label: 'Menang', tone: 'ocm-tag ocm-tag-success' },
	lost: { label: 'Kalah', tone: 'ocm-tag ocm-tag-danger' },
}

function formatIDR(value: number | null): string {
	if (value == null) return '—'
	return new Intl.NumberFormat('id-ID', {
		style: 'currency',
		currency: 'IDR',
		maximumFractionDigits: 0,
	}).format(value)
}

function OpportunityPage() {
	const [items, setItems] = useState<Opportunity[]>([])
	const [stats, setStats] = useState<OpportunityStats | null>(null)
	const [filter, setFilter] = useState('all')
	const [loading, setLoading] = useState(true)
	const [busy, setBusy] = useState<string | null>(null)
	const [showForm, setShowForm] = useState(false)

	// Create form fields.
	const [name, setName] = useState('')
	const [product, setProduct] = useState('')
	const [value, setValue] = useState('')
	const [stage, setStage] = useState('')
	const [notes, setNotes] = useState('')
	const [creating, setCreating] = useState(false)

	const load = useCallback(async () => {
		setLoading(true)
		try {
			const [listRes, statsRes] = await Promise.all([
				opportunitiesApi.list(filter === 'all' ? {} : { status: filter }),
				opportunitiesApi.stats(),
			])
			setItems(listRes.payload || [])
			setStats(statsRes.payload || null)
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memuat opportunity')
		} finally {
			setLoading(false)
		}
	}, [filter])

	useEffect(() => {
		void load()
	}, [load])

	async function handleCreate(e: React.FormEvent) {
		e.preventDefault()
		if (!name.trim()) return
		setCreating(true)
		try {
			await opportunitiesApi.create({
				name: name.trim(),
				product: product.trim() || undefined,
				value: value ? Number(value.replace(/[^\d]/g, '')) : undefined,
				stage: stage.trim() || undefined,
				notes: notes.trim() || undefined,
			})
			setName('')
			setProduct('')
			setValue('')
			setStage('')
			setNotes('')
			setShowForm(false)
			await load()
			toast.success('Opportunity dibuat')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membuat opportunity')
		} finally {
			setCreating(false)
		}
	}

	async function setStatus(item: Opportunity, status: string) {
		setBusy(item.id)
		try {
			await opportunitiesApi.update(item.id, { status })
			await load()
		} catch (err: any) {
			toast.error(err?.message || 'Gagal memperbarui status')
		} finally {
			setBusy(null)
		}
	}

	async function handleDelete(item: Opportunity) {
		if (!window.confirm(`Hapus opportunity "${item.name}"?`)) return
		setBusy(item.id)
		try {
			await opportunitiesApi.remove(item.id)
			await load()
			toast.success('Opportunity dihapus')
		} catch (err: any) {
			toast.error(err?.message || 'Gagal menghapus')
		} finally {
			setBusy(null)
		}
	}

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Opportunity"
				subtitle="Deal serius yang sedang digarap — berbeda dari Leads (kontak mentah di menu Pelanggan)."
				actions={
					<>
						<button type="button" className="ocm-btn" onClick={() => void load()} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
						</button>
						<button
							type="button"
							className="ocm-btn ocm-btn-primary"
							onClick={() => setShowForm((v) => !v)}
						>
							<Plus size={14} /> Opportunity Baru
						</button>
					</>
				}
			/>

			{/* Stats */}
			<div className="ocm-grid-3">
				<CrmStatCard
					label="Berjalan"
					value={String(stats?.open.count ?? 0)}
					subtitle={formatIDR(stats?.open.value ?? 0)}
					icon={<Target size={16} className="text-sky-500" />}
				/>
				<CrmStatCard
					label="Menang"
					value={String(stats?.won.count ?? 0)}
					subtitle={formatIDR(stats?.won.value ?? 0)}
					icon={<CheckCircle2 size={16} className="text-emerald-500" />}
				/>
				<CrmStatCard
					label="Kalah"
					value={String(stats?.lost.count ?? 0)}
					subtitle={formatIDR(stats?.lost.value ?? 0)}
					icon={<XCircle size={16} className="text-red-500" />}
				/>
			</div>

			{/* Create form */}
			{showForm ? (
				<form onSubmit={handleCreate} className="ocm-card space-y-3 p-4">
					<p className="text-sm font-semibold">Opportunity baru</p>
					<div className="grid grid-cols-1 gap-3 md:grid-cols-2">
						<input
							className="ocm-input"
							placeholder="Nama deal / perusahaan *"
							value={name}
							onChange={(e) => setName(e.target.value)}
							required
						/>
						<input
							className="ocm-input"
							placeholder="Produk (mis. Archicad, ZWCAD)"
							value={product}
							onChange={(e) => setProduct(e.target.value)}
						/>
						<input
							className="ocm-input"
							placeholder="Nilai (Rp)"
							inputMode="numeric"
							value={value}
							onChange={(e) => setValue(e.target.value)}
						/>
						<input
							className="ocm-input"
							placeholder="Tahap (mis. Penawaran, Negosiasi)"
							value={stage}
							onChange={(e) => setStage(e.target.value)}
						/>
					</div>
					<textarea
						className="ocm-textarea"
						placeholder="Catatan (opsional)"
						value={notes}
						onChange={(e) => setNotes(e.target.value)}
					/>
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

			{/* Filter + list */}
			<section className="ocm-card overflow-hidden">
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border p-2">
					{STATUS_TABS.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setFilter(option.value)}
							className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
								filter === option.value
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>

				{loading ? (
					<div className="space-y-2 p-3">
						{Array.from({ length: 4 }).map((_, index) => (
							<div key={index} className="h-14 animate-pulse rounded-lg bg-muted/60" />
						))}
					</div>
				) : items.length === 0 ? (
					<div className="p-4">
						<CrmEmptyState
							title="Belum ada opportunity"
							description="Buat opportunity baru, atau promosikan sebuah lead dari halaman detail customer (tombol 'Jadikan Opportunity')."
						/>
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="ocm-table">
							<thead>
								<tr>
									<th>Nama</th>
									<th>Produk</th>
									<th>Nilai</th>
									<th>Owner</th>
									<th>Status</th>
									<th className="text-right">Aksi</th>
								</tr>
							</thead>
							<tbody>
								{items.map((item) => {
									const meta = STATUS_META[item.status] || STATUS_META.open
									const rowBusy = busy === item.id
									return (
										<tr key={item.id}>
											<td>
												<div className="font-semibold">{item.name}</div>
												{item.contactName ? (
													<div className="text-[11px] text-muted-foreground">
														Lead: {item.contactName}
													</div>
												) : null}
											</td>
											<td>
												<div className="flex items-center gap-1.5">
													{item.teamName ? (
														<span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-semibold text-primary">
															{item.teamName}
														</span>
													) : null}
													<span className="text-muted-foreground">{item.product || '—'}</span>
												</div>
											</td>
											<td className="font-medium">{formatIDR(item.value)}</td>
											<td className="text-muted-foreground">{item.ownerName || '—'}</td>
											<td>
												<span className={meta.tone}>{meta.label}</span>
											</td>
											<td>
												<div className="flex items-center justify-end gap-1.5">
													{item.status !== 'won' ? (
														<button
															type="button"
															className="ocm-btn h-8 px-2"
															title="Tandai menang"
															disabled={rowBusy}
															onClick={() => void setStatus(item, 'won')}
														>
															<CheckCircle2 size={14} className="text-emerald-500" />
														</button>
													) : null}
													{item.status !== 'lost' ? (
														<button
															type="button"
															className="ocm-btn h-8 px-2"
															title="Tandai kalah"
															disabled={rowBusy}
															onClick={() => void setStatus(item, 'lost')}
														>
															<XCircle size={14} className="text-red-500" />
														</button>
													) : null}
													{item.status !== 'open' ? (
														<button
															type="button"
															className="ocm-btn h-8 px-2"
															title="Buka kembali"
															disabled={rowBusy}
															onClick={() => void setStatus(item, 'open')}
														>
															<RotateCcw size={14} />
														</button>
													) : null}
													<button
														type="button"
														className="ocm-btn h-8 px-2"
														title="Hapus"
														disabled={rowBusy}
														onClick={() => void handleDelete(item)}
													>
														<Trash2 size={14} className="text-muted-foreground" />
													</button>
												</div>
											</td>
										</tr>
									)
								})}
							</tbody>
						</table>
					</div>
				)}
			</section>
		</main>
	)
}
