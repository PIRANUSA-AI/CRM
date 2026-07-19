import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	ArrowLeft,
	CheckCircle2,
	Clock3,
	History,
	MessageCircle,
	MessagesSquare,
	RefreshCw,
	SendHorizontal,
	Sparkles,
	TimerReset,
	TriangleAlert,
	UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { tasks, type TaskDetail } from '@/lib/api'

export const Route = createFileRoute('/_app/tasks/$taskId')({
	component: TaskDetailPage,
})

const PRIORITY_STYLE: Record<string, string> = {
	low: 'bg-slate-500/10 text-slate-600 dark:text-slate-300',
	medium: 'bg-sky-500/10 text-sky-700 dark:text-sky-300',
	high: 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
	urgent: 'bg-red-500/10 text-red-700 dark:text-red-300',
}
const PRIORITY_LABEL: Record<string, string> = {
	low: 'Rendah',
	medium: 'Sedang',
	high: 'Tinggi',
	urgent: 'Mendesak',
}
const STATUS_LABEL: Record<string, string> = {
	open: 'Belum dimulai',
	in_progress: 'Sedang dikerjakan',
	done: 'Selesai',
	cancelled: 'Dibatalkan',
}
const ACTION_LABEL: Record<string, string> = {
	reply_now: 'Balas sekarang',
	follow_up: 'Tindak lanjut',
	qualify_lead: 'Kualifikasi lead',
	handover_review: 'Tinjau handover',
	prospect_followup: 'Prospek',
	manual: 'Tugas manual',
}
const EVENT_LABEL: Record<string, string> = {
	created: 'Tugas dibuat',
	ai_analyzed: 'Dianalisis AI',
	started: 'Mulai dikerjakan',
	completed: 'Diselesaikan',
	cancelled: 'Dibatalkan',
	snoozed: 'Ditunda',
	updated: 'Diperbarui',
	replied_whatsapp: 'Dibalas via WhatsApp',
}

type LeadNeedSnapshot = {
	product?: string | null
	segment?: string | null
	useCase?: string | null
	seats?: number | null
	budget?: string | null
	urgency?: string | null
	source?: string | null
	city?: string | null
	notes?: string | null
}

type Snapshot = {
	suggestedReply?: string | null
	summary?: string | null
	evidence?: string[]
	lead_need?: LeadNeedSnapshot | null
}

// F4: which lead-need fields to surface in the handoff briefing, in order.
const LEAD_NEED_ROWS: Array<{ key: keyof LeadNeedSnapshot; label: string }> = [
	{ key: 'product', label: 'Produk' },
	{ key: 'segment', label: 'Segmen' },
	{ key: 'seats', label: 'Seat' },
	{ key: 'useCase', label: 'Kebutuhan' },
	{ key: 'budget', label: 'Anggaran' },
	{ key: 'urgency', label: 'Urgensi' },
	{ key: 'source', label: 'Sumber' },
	{ key: 'city', label: 'Kota' },
	{ key: 'notes', label: 'Catatan' },
]

function readSnapshot(value: unknown): Snapshot {
	if (!value || typeof value !== 'object') return {}
	return value as Snapshot
}

function formatDateTime(value: string | null) {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

function formatTime(value: string | null) {
	if (!value) return ''
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	return new Intl.DateTimeFormat('id-ID', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

// Normalize an Indonesian phone to wa.me format (digits, with 62 country code).
function normalizeWaPhone(raw?: string | null) {
	let d = String(raw || '').replace(/\D/g, '')
	if (!d) return ''
	if (d.startsWith('0')) d = `62${d.slice(1)}`
	else if (d.startsWith('8')) d = `62${d}`
	return d
}

// wa.me link that opens WhatsApp directly to the lead's number, optionally
// prefilled with an opener message.
function waLink(phone?: string | null, text?: string | null) {
	const digits = normalizeWaPhone(phone)
	if (!digits) return null
	const q = text?.trim() ? `?text=${encodeURIComponent(text.trim())}` : ''
	return `https://wa.me/${digits}${q}`
}

function snoozePresets(): Array<{ label: string; iso: string }> {
	const now = new Date()
	const inHours = (h: number) => new Date(now.getTime() + h * 3600_000).toISOString()
	const tomorrow9 = new Date(now)
	tomorrow9.setDate(tomorrow9.getDate() + 1)
	tomorrow9.setHours(9, 0, 0, 0)
	return [
		{ label: '+1 jam', iso: inHours(1) },
		{ label: '+3 jam', iso: inHours(3) },
		{ label: 'Besok 09:00', iso: tomorrow9.toISOString() },
	]
}

function TaskDetailPage() {
	const { taskId } = Route.useParams()
	const navigate = useNavigate()
	const [detail, setDetail] = useState<TaskDetail | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [replyDraft, setReplyDraft] = useState('')
	const [busy, setBusy] = useState<null | 'reply' | 'complete' | 'snooze' | 'openChat'>(null)
	const [actionError, setActionError] = useState<string | null>(null)
	const [draftDirty, setDraftDirty] = useState(false)
	const [autoStarted, setAutoStarted] = useState(false)

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await tasks.detail(taskId)
			setDetail(response.data)
			if (!draftDirty) {
				setReplyDraft(readSnapshot(response.data.task.aiSnapshot).suggestedReply || '')
			}
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Detail tugas gagal dimuat.')
		} finally {
			setLoading(false)
		}
	}, [taskId, draftDirty])

	useEffect(() => {
		void load()
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [taskId])

	const runAction = useCallback(
		async (kind: 'reply' | 'complete' | 'snooze', arg?: string) => {
			if (!detail) return
			setBusy(kind)
			setActionError(null)
			try {
				if (kind === 'reply') {
					if (!replyDraft.trim()) throw new Error('Balasan tidak boleh kosong')
					await tasks.replyWhatsapp(detail.task.id, replyDraft.trim())
				} else if (kind === 'complete') {
					await tasks.complete(detail.task.id)
				} else if (kind === 'snooze') {
					await tasks.snooze(detail.task.id, arg as string)
				}
				setDraftDirty(false)
				await load()
			} catch (reason) {
				setActionError(reason instanceof Error ? reason.message : 'Aksi gagal diproses.')
			} finally {
				setBusy(null)
			}
		},
		[detail, replyDraft, load],
	)

	// Take the lead over in-CRM: create/find its WhatsApp conversation in the
	// sales' personal inbox, stop the AI, link it to this task, and jump into the
	// chat with the AI opener pre-typed.
	const openChatInCrm = useCallback(async () => {
		if (!detail) return
		setBusy('openChat')
		setActionError(null)
		try {
			const response = await tasks.openChat(detail.task.id)
			const search: { c: string; draft?: string } = { c: response.data.conversationId }
			if (replyDraft.trim()) search.draft = replyDraft.trim()
			navigate({ to: '/chat', search })
		} catch (reason) {
			setActionError(
				reason instanceof Error ? reason.message : 'Gagal membuka chat di CRM.',
			)
			setBusy(null)
		}
	}, [detail, replyDraft, navigate])

	// Opening a task is the "start" signal: silently move it to in_progress the
	// first time it is viewed while still open. No manual "Mulai" button needed.
	useEffect(() => {
		if (!detail || autoStarted) return
		if (detail.task.status !== 'open') return
		setAutoStarted(true)
		void tasks
			.start(detail.task.id)
			.then(() => load())
			.catch(() => {
				/* non-blocking: viewing should still work if auto-start fails */
			})
	}, [detail, autoStarted, load])

	const snapshot = useMemo(
		() => (detail ? readSnapshot(detail.task.aiSnapshot) : {}),
		[detail],
	)

	if (loading && !detail) {
		return (
			<main className="ocm-page">
				<div className="flex items-center gap-3 text-sm text-muted-foreground">
					<RefreshCw size={16} className="animate-spin" /> Memuat detail tugas...
				</div>
			</main>
		)
	}

	if (error && !detail) {
		return (
			<main className="ocm-page space-y-4">
				<button type="button" className="ocm-btn w-fit" onClick={() => navigate({ to: '/tasks' })}>
					<ArrowLeft size={15} /> Kembali
				</button>
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={18} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			</main>
		)
	}

	if (!detail) return null

	const { task, contact, messages, events } = detail
	const isActive = task.status === 'open' || task.status === 'in_progress'
	const canReply = Boolean(task.conversationId) && isActive
	const customAttrs = (contact?.custom_attributes || {}) as Record<string, unknown>
	const contactPhone = contact?.phone_number || task.contactPhone || null
	const contactEmail = contact?.email || null
	const waHref = waLink(contactPhone, replyDraft)

	return (
		<main className="ocm-page space-y-5">
			{/* Header */}
			<div className="flex flex-col gap-3">
				<button
					type="button"
					className="ocm-btn w-fit"
					onClick={() => navigate({ to: '/tasks' })}
				>
					<ArrowLeft size={15} /> Kembali ke Daftar Tugas
				</button>
				<div className="flex flex-wrap items-center gap-2">
					<span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${PRIORITY_STYLE[task.priority] || ''}`}>
						{PRIORITY_LABEL[task.priority] || task.priority}
					</span>
					<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
						{ACTION_LABEL[task.actionKind] || task.actionKind}
					</span>
					<span className="text-xs text-muted-foreground">{STATUS_LABEL[task.status] || task.status}</span>
				</div>
				<h1 className="text-xl font-bold">{task.title}</h1>
			</div>

			{actionError ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{actionError}</span>
				</div>
			) : null}

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				{/* Main column */}
				<div className="space-y-5 lg:col-span-2">
					{/* AI summary + reply */}
					<section className="ocm-card p-4">
						<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<Sparkles size={16} className="text-primary" /> Ringkasan & Tindak Lanjut
						</h2>
						{snapshot.summary ? (
							<p className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
								{snapshot.summary}
							</p>
						) : task.description ? (
							<p className="mb-3 rounded-lg border border-border bg-muted/30 p-3 text-sm">
								{task.description}
							</p>
						) : null}

						{snapshot.lead_need &&
						LEAD_NEED_ROWS.some((row) => {
							const value = snapshot.lead_need?.[row.key]
							return value !== null && value !== undefined && value !== ''
						}) ? (
							<div className="mb-3 rounded-lg border border-border bg-background p-3">
								<p className="mb-1.5 text-[11px] font-semibold uppercase text-muted-foreground">
									Kebutuhan lead (dikumpulkan leader)
								</p>
								<div className="grid grid-cols-2 gap-x-3 gap-y-1">
									{LEAD_NEED_ROWS.map((row) => {
										const value = snapshot.lead_need?.[row.key]
										if (value === null || value === undefined || value === '') return null
										return (
											<div key={row.key} className="min-w-0 text-xs">
												<span className="text-muted-foreground">{row.label}: </span>
												<span className="font-medium text-foreground">{String(value)}</span>
											</div>
										)
									})}
								</div>
							</div>
						) : null}

						{Array.isArray(snapshot.evidence) && snapshot.evidence.length > 0 ? (
							<div className="mb-3">
								<p className="mb-1 text-[11px] font-semibold uppercase text-muted-foreground">
									Kutipan pesan customer
								</p>
								<ul className="space-y-1">
									{snapshot.evidence.map((item, index) => (
										<li key={index} className="rounded-md bg-muted/50 px-2 py-1 text-sm italic text-muted-foreground">
											“{item}”
										</li>
									))}
								</ul>
							</div>
						) : null}

						{task.conversationId ? (
							<>
								<textarea
									value={replyDraft}
									onChange={(event) => {
										setReplyDraft(event.target.value)
										setDraftDirty(true)
									}}
									rows={4}
									placeholder="Tulis balasan untuk customer..."
									className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
								/>
								<button
									type="button"
									onClick={() => void runAction('reply')}
									disabled={!canReply || busy !== null}
									className="ocm-btn mt-3 w-full justify-center bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
								>
									<SendHorizontal size={16} />
									{busy === 'reply' ? 'Mengirim...' : 'Balas via WhatsApp'}
								</button>
								{!isActive ? (
									<p className="mt-2 text-xs text-muted-foreground">
										Tugas sudah {STATUS_LABEL[task.status]?.toLowerCase()}, balasan dinonaktifkan.
									</p>
								) : null}
							</>
						) : (
							<div className="space-y-3">
								<p className="text-sm text-muted-foreground">
									Lead ini belum punya percakapan WhatsApp. Mulai follow-up dengan
									pesan pembuka di bawah.
								</p>
								{contactPhone || contactEmail ? (
									<>
										<textarea
											value={replyDraft}
											onChange={(event) => {
												setReplyDraft(event.target.value)
												setDraftDirty(true)
											}}
											rows={4}
											placeholder="Tulis pesan pembuka follow-up..."
											className="w-full resize-y rounded-lg border border-border bg-background p-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
										/>
										{contactPhone ? (
											<button
												type="button"
												onClick={() => void openChatInCrm()}
												disabled={busy !== null}
												className="ocm-btn w-full justify-center bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
											>
												<MessageCircle size={16} />
												{busy === 'openChat'
													? 'Menyiapkan chat...'
													: task.source === 'routing'
														? 'Buka Chat (AI bantu)'
														: 'Ambil Alih & Chat di CRM'}
											</button>
										) : null}
										<div className="flex flex-wrap gap-2">
											{waHref ? (
												<a
													href={waHref}
													target="_blank"
													rel="noreferrer"
													className="ocm-btn justify-center"
												>
													<SendHorizontal size={16} /> Buka WhatsApp langsung
												</a>
											) : null}
											{contactEmail ? (
												<a
													href={`mailto:${contactEmail}${
														replyDraft.trim()
															? `?subject=${encodeURIComponent(
																	task.title,
																)}&body=${encodeURIComponent(replyDraft.trim())}`
															: ''
													}`}
													className="ocm-btn justify-center"
												>
													<SendHorizontal size={16} /> Kirim Email
												</a>
											) : null}
										</div>
										<p className="text-xs text-muted-foreground">
											{task.source === 'routing' ? (
												<>
													<b>Buka Chat (AI bantu)</b> mengirim pesan pembuka dari nomor
													WhatsApp-mu, lalu <b>AI-mu yang membalas</b> customer sampai
													kamu menekan <b>Ambil Alih</b> di header chat untuk menangani
													sendiri.
												</>
											) : (
												<>
													<b>Ambil Alih & Chat di CRM</b> membuka percakapan lead di inbox
													WhatsApp-mu, menghentikan balasan otomatis AI, dan kamu yang
													menangani — pesan pembuka sudah terisi otomatis. Alternatif:
													buka WhatsApp langsung di HP/desktop.
												</>
											)}
										</p>
									</>
								) : (
									<p className="rounded-md bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
										Kontak belum punya nomor WhatsApp maupun email. Lengkapi data kontak
										dulu untuk bisa follow-up.
									</p>
								)}
							</div>
						)}
					</section>

					{/* Chat history — only relevant when a WhatsApp conversation exists */}
					{task.conversationId ? (
					<section className="ocm-card overflow-hidden">
						<div className="flex items-center justify-between border-b border-border p-4">
							<h2 className="flex items-center gap-2 text-sm font-semibold">
								<MessagesSquare size={16} className="text-primary" /> Riwayat Chat WhatsApp
							</h2>
							<button
								type="button"
								className="ocm-btn"
								onClick={() =>
									navigate({ to: '/chat', search: { c: task.conversationId as string } })
								}
							>
								<MessageCircle size={14} /> Buka chat
							</button>
						</div>
						{messages.length === 0 ? (
							<div className="p-6 text-center text-sm text-muted-foreground">
								Belum ada riwayat chat untuk tugas ini.
							</div>
						) : (
							<div className="max-h-[420px] space-y-3 overflow-y-auto p-4">
								{messages.map((message) => {
									const isIn = message.direction === 'in'
									return (
										<div
											key={message.id}
											className={`flex ${isIn ? 'justify-start' : 'justify-end'}`}
										>
											<div
												className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${
													isIn
														? 'rounded-tl-sm bg-muted text-foreground'
														: 'rounded-tr-sm bg-primary/10 text-foreground'
												}`}
											>
												<p className="whitespace-pre-wrap break-words">
													{message.content ||
														(message.contentType && message.contentType !== 'text'
															? `[${message.contentType}]`
															: '')}
												</p>
												<p className="mt-1 text-right text-[10px] text-muted-foreground">
													{isIn ? 'Customer' : 'Sales'} · {formatTime(message.createdAt)}
												</p>
											</div>
										</div>
									)
								})}
							</div>
						)}
					</section>
					) : null}
				</div>

				{/* Sidebar */}
				<div className="space-y-5">
					{/* Contact */}
					<section className="ocm-card p-4">
						<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<UserRound size={16} className="text-primary" /> Kontak
						</h2>
						<dl className="space-y-2 text-sm">
							<Field label="Nama" value={contact?.name || task.contactName} />
							<Field label="Telepon" value={contact?.phone_number || task.contactPhone} />
							<Field label="Email" value={contact?.email} />
							<Field label="Perusahaan" value={contact?.company} />
							<Field label="Kota" value={contact?.city} />
							<Field label="Produk diminati" value={customAttrs.product_interest as string} />
							<Field label="Tahap" value={customAttrs.pipeline_stage as string} />
							<Field label="Sumber" value={contact?.source} />
						</dl>
					</section>

					{/* Task meta + actions */}
					<section className="ocm-card p-4">
						<h2 className="mb-3 text-sm font-semibold">Info Tugas</h2>
						<dl className="mb-4 space-y-2 text-sm">
							<Field label="Tenggat" value={formatDateTime(task.dueAt)} />
							<Field label="Sumber" value={task.source} />
							<Field
								label="Keyakinan AI"
								value={task.confidence != null ? `${Math.round(task.confidence * 100)}%` : null}
							/>
						</dl>
						<p className="rounded-md bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
							Tugas otomatis berstatus <b>Sedang dikerjakan</b> saat kamu buka
							atau mulai membalas. Membalas tidak menutup tugas — tandai
							<b> Selesai</b> sendiri kalau percakapan sudah tuntas.
						</p>
						{isActive ? (
							<button
								type="button"
								className="ocm-btn mt-3 w-full justify-center bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
								disabled={busy !== null}
								onClick={() => void runAction('complete')}
							>
								<CheckCircle2 size={15} />
								{busy === 'complete' ? 'Menyimpan...' : 'Tandai Selesai'}
							</button>
						) : null}
						{isActive ? (
							<div className="mt-3 flex flex-wrap items-center gap-2">
								<span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
									<TimerReset size={14} /> Ingatkan lagi:
								</span>
								{snoozePresets().map((preset) => (
									<button
										key={preset.label}
										type="button"
										disabled={busy !== null}
										onClick={() => void runAction('snooze', preset.iso)}
										className="rounded-md border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted disabled:opacity-60"
									>
										{preset.label}
									</button>
								))}
							</div>
						) : null}
					</section>

					{/* Activity / audit history */}
					<section className="ocm-card p-4">
						<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<History size={16} className="text-primary" /> Riwayat Aktivitas
						</h2>
						{events.length === 0 ? (
							<p className="text-sm text-muted-foreground">Belum ada aktivitas.</p>
						) : (
							<ol className="space-y-3">
								{events.map((event) => (
									<li key={event.id} className="flex gap-3">
										<div className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary/60" />
										<div className="min-w-0">
											<p className="text-sm font-medium">
												{EVENT_LABEL[event.eventType] || event.eventType}
											</p>
											<p className="text-xs text-muted-foreground">
												{event.actorName || (event.actorType === 'system' ? 'Sistem' : '—')}
												{' · '}
												<span className="inline-flex items-center gap-1">
													<Clock3 size={11} /> {formatTime(event.createdAt)}
												</span>
											</p>
											{event.reason ? (
												<p className="mt-0.5 text-xs italic text-muted-foreground">{event.reason}</p>
											) : null}
										</div>
									</li>
								))}
							</ol>
						)}
					</section>
				</div>
			</div>
		</main>
	)
}

function Field({ label, value }: { label: string; value?: string | null }) {
	return (
		<div className="flex items-start justify-between gap-3">
			<dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
			<dd className="min-w-0 break-words text-right text-sm font-medium">{value || '-'}</dd>
		</div>
	)
}
