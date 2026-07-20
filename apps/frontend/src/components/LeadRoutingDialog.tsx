import {
	CheckCircle2,
	Loader2,
	Pencil,
	Sparkles,
	TriangleAlert,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import {
	leadRouting,
	personalInbox,
	type LeadNeed,
	type LeadNeedPatch,
	type RoutingSuggestion,
} from '@/lib/api'

const LEAD_NEED_FIELD_LABELS: Record<string, string> = {
	name: 'Nama',
	company: 'Perusahaan/instansi',
	product: 'Produk',
	segment: 'Segmen',
	useCase: 'Kebutuhan',
	seats: 'Seat',
	budget: 'Anggaran',
	urgency: 'Urgensi',
	source: 'Sumber',
	city: 'Kota',
	notes: 'Catatan',
}

// The fields the leader can override, in display order.
const LEAD_NEED_EDIT_FIELDS: Array<keyof LeadNeedPatch> = [
	'name',
	'company',
	'product',
	'segment',
	'useCase',
	'seats',
	'budget',
	'urgency',
	'source',
	'city',
	'notes',
]

function leadNeedToForm(need: LeadNeed): Record<string, string> {
	const form: Record<string, string> = {}
	for (const key of LEAD_NEED_EDIT_FIELDS) {
		const value = need[key]
		form[key] = value === null || value === undefined ? '' : String(value)
	}
	return form
}

type LeadNeedPanelProps = {
	conversationId: string
	open: boolean
	onGateChange: (gate: { ready: boolean; missing: string[] }) => void
}

// F1: qualified "lead need" profile with the deterministic "siap di-assign"
// gate, plus inline leader override. The gate is a soft signal — the leader can
// still assign even when it is incomplete.
function LeadNeedPanel({ conversationId, open, onGateChange }: LeadNeedPanelProps) {
	const [need, setNeed] = useState<LeadNeed | null>(null)
	const [loading, setLoading] = useState(false)
	const [editing, setEditing] = useState(false)
	const [saving, setSaving] = useState(false)
	const [form, setForm] = useState<Record<string, string>>({})
	const [error, setError] = useState<string | null>(null)

	useEffect(() => {
		if (!open || !conversationId) return
		let cancelled = false
		setLoading(true)
		setEditing(false)
		setError(null)
		personalInbox
			.getLeadNeed(conversationId)
			.then((response) => {
				if (cancelled) return
				setNeed(response.data.leadNeed)
				onGateChange({
					ready: response.data.leadNeed.ready,
					missing: response.data.leadNeed.missing,
				})
			})
			.catch(() => {
				if (!cancelled) setNeed(null)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [open, conversationId, onGateChange])

	const startEdit = useCallback(() => {
		if (!need) return
		setForm(leadNeedToForm(need))
		setEditing(true)
	}, [need])

	const save = useCallback(async () => {
		setSaving(true)
		setError(null)
		try {
			const patch: LeadNeedPatch = {}
			for (const key of LEAD_NEED_EDIT_FIELDS) {
				const raw = (form[key] ?? '').trim()
				;(patch as Record<string, unknown>)[key] = raw === '' ? null : raw
			}
			const response = await personalInbox.updateLeadNeed(conversationId, patch)
			setNeed(response.data.leadNeed)
			onGateChange({
				ready: response.data.leadNeed.ready,
				missing: response.data.leadNeed.missing,
			})
			setEditing(false)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal menyimpan kebutuhan lead.')
		} finally {
			setSaving(false)
		}
	}, [conversationId, form, onGateChange])

	if (loading) {
		return (
			<div className="flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
				<Loader2 size={14} className="animate-spin" /> Memuat kebutuhan lead...
			</div>
		)
	}
	if (!need) return null

	const missingLabels = need.missing.map((key) => LEAD_NEED_FIELD_LABELS[key] || key)
	const filled = LEAD_NEED_EDIT_FIELDS.map((key) => ({
		key,
		label: LEAD_NEED_FIELD_LABELS[key] || key,
		value: need[key],
	})).filter((row) => row.value !== null && row.value !== undefined && row.value !== '')

	return (
		<div className="rounded-lg border border-border bg-muted/20 p-3">
			<div className="flex items-center justify-between gap-2">
				<span className="text-xs font-semibold text-foreground">Kebutuhan Lead</span>
				<div className="flex items-center gap-2">
					{need.ready ? (
						<span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-200">
							<CheckCircle2 size={11} /> Siap di-assign
						</span>
					) : (
						<span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/20 px-2 py-0.5 text-[10px] font-semibold text-amber-900 dark:border-amber-400/40 dark:text-amber-200">
							<TriangleAlert size={11} /> Belum lengkap
						</span>
					)}
					{!editing ? (
						<button
							type="button"
							onClick={startEdit}
							className="flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted"
						>
							<Pencil size={11} /> Edit
						</button>
					) : null}
				</div>
			</div>

			{editing ? (
				<div className="mt-2 space-y-2">
					<div className="grid grid-cols-2 gap-2">
						{LEAD_NEED_EDIT_FIELDS.map((key) => {
							const label = LEAD_NEED_FIELD_LABELS[key] || key
							const commonClass =
								'w-full rounded-md border border-border bg-background px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-ring'
							const wide = key === 'useCase' || key === 'notes'
							return (
								<label
									key={key}
									className={`flex flex-col gap-0.5 ${wide ? 'col-span-2' : ''}`}
								>
									<span className="text-[10px] font-medium text-muted-foreground">{label}</span>
									{key === 'segment' ? (
										<select
											value={form[key] ?? ''}
											onChange={(event) =>
												setForm((prev) => ({ ...prev, [key]: event.target.value }))
											}
											className={commonClass}
										>
											<option value="">—</option>
											<option value="AEC">AEC</option>
											<option value="MFG">MFG</option>
											<option value="other">Lainnya</option>
										</select>
									) : key === 'urgency' ? (
										<select
											value={form[key] ?? ''}
											onChange={(event) =>
												setForm((prev) => ({ ...prev, [key]: event.target.value }))
											}
											className={commonClass}
										>
											<option value="">—</option>
											<option value="high">Tinggi</option>
											<option value="medium">Sedang</option>
											<option value="low">Rendah</option>
										</select>
									) : (
										<input
											type={key === 'seats' ? 'number' : 'text'}
											value={form[key] ?? ''}
											onChange={(event) =>
												setForm((prev) => ({ ...prev, [key]: event.target.value }))
											}
											className={commonClass}
										/>
									)}
								</label>
							)
						})}
					</div>
					{error ? (
						<p className="text-[11px] text-red-600 dark:text-red-300">{error}</p>
					) : null}
					<div className="flex items-center justify-end gap-2">
						<button
							type="button"
							onClick={() => setEditing(false)}
							disabled={saving}
							className="rounded-md px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted disabled:opacity-60"
						>
							Batal
						</button>
						<button
							type="button"
							onClick={() => void save()}
							disabled={saving}
							className="flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
						>
							{saving ? <Loader2 size={11} className="animate-spin" /> : null}
							Simpan
						</button>
					</div>
				</div>
			) : (
				<div className="mt-2 space-y-1.5">
					{filled.length ? (
						<div className="grid grid-cols-2 gap-x-3 gap-y-1">
							{filled.map((row) => (
								<div key={row.key} className="min-w-0 text-[11px]">
									<span className="text-muted-foreground">{row.label}: </span>
									<span className="font-medium text-foreground">{String(row.value)}</span>
								</div>
							))}
						</div>
					) : (
						<p className="text-[11px] text-muted-foreground">
							AI belum mengumpulkan detail kebutuhan lead ini.
						</p>
					)}
					{!need.ready && missingLabels.length ? (
						<p className="text-[11px] text-amber-600 dark:text-amber-300">
							Masih kurang: {missingLabels.join(', ')}
						</p>
					) : null}
				</div>
			)}
		</div>
	)
}

type Props = {
	conversationId: string | null
	open: boolean
	onOpenChange: (open: boolean) => void
	onAssigned?: (assigneeName: string | null) => void
}

export function LeadRoutingDialog({ conversationId, open, onOpenChange, onAssigned }: Props) {
	const [suggestion, setSuggestion] = useState<RoutingSuggestion | null>(null)
	const [selected, setSelected] = useState<string | null>(null)
	const [loading, setLoading] = useState(false)
	const [assigning, setAssigning] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [sendIntro, setSendIntro] = useState(true)
	const [introText, setIntroText] = useState('')
	const [introEdited, setIntroEdited] = useState(false)
	const [leadGate, setLeadGate] = useState<{ ready: boolean; missing: string[] }>({
		ready: true,
		missing: [],
	})

	const handleGateChange = useCallback(
		(gate: { ready: boolean; missing: string[] }) => setLeadGate(gate),
		[],
	)

	const selectedName =
		suggestion?.candidates.find((candidate) => candidate.userId === selected)?.name || null

	// Keep the intro template in sync with the selected sales until the leader
	// edits it manually.
	useEffect(() => {
		if (introEdited) return
		const name = selectedName || 'tim sales kami'
		setIntroText(
			`Halo kak 🙏 Kebutuhan Kakak akan dibantu oleh ${name} dari tim kami. Beliau akan menghubungi Kakak sebentar lagi ya. Terima kasih 🙏`,
		)
	}, [selectedName, introEdited])

	useEffect(() => {
		if (!open || !conversationId) return
		let cancelled = false
		setLoading(true)
		setError(null)
		setSuggestion(null)
		setSelected(null)
		setSendIntro(true)
		setIntroEdited(false)
		setLeadGate({ ready: true, missing: [] })
		leadRouting
			.suggest(conversationId)
			.then((response) => {
				if (cancelled) return
				setSuggestion(response.data)
				setSelected(response.data.candidates[0]?.userId ?? null)
			})
			.catch((reason) => {
				if (cancelled) return
				setError(reason instanceof Error ? reason.message : 'Gagal memuat rekomendasi.')
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})
		return () => {
			cancelled = true
		}
	}, [open, conversationId])

	const assign = useCallback(async () => {
		if (!conversationId || !selected) return
		setAssigning(true)
		setError(null)
		try {
			const response = await leadRouting.assign(conversationId, selected)
			// Optional handoff intro from the leader's number to the customer.
			if (sendIntro && introText.trim()) {
				try {
					await personalInbox.sendMessage(conversationId, introText.trim())
				} catch {
					/* assignment succeeded; intro delivery is best-effort */
				}
			}
			onAssigned?.(response.data.assignedTo.name)
			onOpenChange(false)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal membagikan lead.')
		} finally {
			setAssigning(false)
		}
	}, [conversationId, selected, sendIntro, introText, onAssigned, onOpenChange])

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="sm:max-w-lg">
				<DialogHeader>
					<DialogTitle>Bagikan Lead ke Sales</DialogTitle>
					<DialogDescription>
						{suggestion
							? `${suggestion.contactName}${
									suggestion.productInterest ? ` · ${suggestion.productInterest}` : ''
								}`
							: 'Rekomendasi sales berdasarkan keahlian, beban, dan pemerataan.'}
					</DialogDescription>
				</DialogHeader>

				{conversationId ? (
					<LeadNeedPanel
						conversationId={conversationId}
						open={open}
						onGateChange={handleGateChange}
					/>
				) : null}

				{loading ? (
					<div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
						<Loader2 size={16} className="animate-spin" /> Menghitung rekomendasi...
					</div>
				) : error && !suggestion ? (
					<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
						<TriangleAlert size={16} className="mt-0.5 shrink-0" />
						<span>{error}</span>
					</div>
				) : suggestion && suggestion.candidates.length === 0 ? (
					<p className="py-6 text-sm text-muted-foreground">
						Belum ada sales yang bisa menerima lead. Tambahkan sales di tim & atur profilnya
						dulu.
					</p>
				) : suggestion ? (
					// No inner max-height: the dialog itself scrolls now, and a second
					// scroll region inside it means two scrollbars fighting over the
					// same gesture.
					<div className="space-y-2">
						{suggestion.candidates.map((candidate, index) => {
							const isSelected = selected === candidate.userId
							return (
								<button
									key={candidate.userId}
									type="button"
									onClick={() => setSelected(candidate.userId)}
									// Selected stacked a border AND a ring in the same colour,
									// which read as one thick smudged outline. A single 2px
									// border with a tinted fill says "chosen" more clearly, and
									// giving the unselected rows a transparent border of the
									// same width stops the list shifting on click.
									className={`w-full rounded-lg border-2 p-3 text-left transition-colors ${
										isSelected
											? 'border-primary bg-primary/10'
											: 'border-transparent bg-muted/40 hover:bg-muted/70'
									}`}
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium">
												{candidate.name || candidate.email}
											</span>
											{index === 0 ? (
												<span className="flex items-center gap-1 rounded-full border border-primary/40 bg-primary/15 px-2 py-0.5 text-[10px] font-semibold text-primary">
													<Sparkles size={10} /> Rekomendasi
												</span>
											) : null}
											{isSelected ? (
												<CheckCircle2 size={14} className="text-primary" />
											) : null}
										</div>
										<div className="flex items-center gap-2">
											<span
												// Same 10%-tint-without-an-edge problem as the chat
												// badges: invisible against the row.
												className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${
													candidate.overloaded
														? 'border-red-500/40 bg-red-500/15 text-red-700 dark:border-red-400/40 dark:text-red-200'
														: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-800 dark:border-emerald-400/40 dark:text-emerald-200'
												}`}
											>
												{candidate.activeLoad}/{candidate.maxActive}
											</span>
											{/* The score is the number a leader compares between
											    candidates, so it should not be the faintest text. */}
											<span className="text-sm font-bold tabular-nums text-foreground">
												{candidate.score}
											</span>
										</div>
									</div>
									<p className="mt-1 text-xs text-foreground/70">
										{candidate.reasons.join(' · ')}
									</p>
								</button>
							)
						})}
						{error ? (
							<p className="rounded-md bg-red-500/10 px-3 py-2 text-xs text-red-600 dark:text-red-300">
								{error}
							</p>
						) : null}
					</div>
				) : null}

				{suggestion && suggestion.candidates.length > 0 ? (
					<div className="space-y-2 border-t border-border pt-3">
						<label className="flex items-center gap-2 text-sm font-medium">
							<input
								type="checkbox"
								checked={sendIntro}
								onChange={(event) => setSendIntro(event.target.checked)}
								className="size-4 rounded border-border"
							/>
							Kirim pesan pengantar ke customer
						</label>
						{sendIntro ? (
							<>
								<textarea
									value={introText}
									onChange={(event) => {
										setIntroText(event.target.value)
										setIntroEdited(true)
									}}
									rows={3}
									className="w-full resize-y rounded-lg border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								/>
								<p className="text-[11px] text-muted-foreground">
									Dikirim dari nomor kamu (leader) agar customer tahu akan dihubungi sales.
								</p>
							</>
						) : null}
					</div>
				) : null}

				{suggestion && suggestion.candidates.length > 0 && !leadGate.ready ? (
					<div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-700 dark:text-amber-300">
						<TriangleAlert size={13} className="mt-0.5 shrink-0" />
						<span>
							Kebutuhan lead belum lengkap
							{leadGate.missing.length
								? ` (kurang ${leadGate.missing
										.map((key) => LEAD_NEED_FIELD_LABELS[key] || key)
										.join(', ')})`
								: ''}
							. Kamu tetap bisa membagikan, tapi disarankan lengkapi dulu.
						</span>
					</div>
				) : null}

				<DialogFooter>
					<button
						type="button"
						className="ocm-btn"
						onClick={() => onOpenChange(false)}
						disabled={assigning}
					>
						Batal
					</button>
					<button
						type="button"
						className="ocm-btn bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-60"
						onClick={() => void assign()}
						disabled={assigning || !selected}
					>
						{assigning ? <Loader2 size={14} className="animate-spin" /> : null}
						Bagikan ke sales terpilih
					</button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	)
}
