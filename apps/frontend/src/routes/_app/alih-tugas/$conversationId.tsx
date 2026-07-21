import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	ArrowLeft,
	Bot,
	CheckCircle2,
	Clock3,
	MessageCircle,
	Sparkles,
	TriangleAlert,
	UserCheck,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrmEmptyState } from '@/components/crm/shared'
import {
	personalAi,
	type PersonalTakeoverHistoryItem,
	type PersonalTakeoverItem,
} from '@/lib/api'

export const Route = createFileRoute('/_app/alih-tugas/$conversationId')({
	component: AlihTugasDetailPage,
})

function formatDateTime(value: string | null) {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

function formatWaiting(minutes: number) {
	if (minutes < 1) return 'baru saja'
	if (minutes < 60) return `${minutes} mnt`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	if (hours < 24) return rest ? `${hours}j ${rest}m` : `${hours} jam`
	const days = Math.floor(hours / 24)
	return `${days} hari`
}

function AlihTugasDetailPage() {
	const { conversationId } = Route.useParams()
	const navigate = useNavigate()
	const [item, setItem] = useState<PersonalTakeoverItem | null>(null)
	const [history, setHistory] = useState<PersonalTakeoverHistoryItem[] | null>(null)
	const [loading, setLoading] = useState(true)
	const [notFound, setNotFound] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [busy, setBusy] = useState(false)
	const [noteDraft, setNoteDraft] = useState('')

	const load = useCallback(async () => {
		setLoading(true)
		setNotFound(false)
		try {
			const response = await personalAi.getTakeover(conversationId)
			setItem(response.data)
		} catch {
			// A takeover that has been returned to the AI leaves the list, so a
			// 404 here usually means "already finished" rather than "never was".
			setNotFound(true)
		} finally {
			setLoading(false)
		}
	}, [conversationId])

	useEffect(() => {
		void load()
		void personalAi
			.takeoverHistory(conversationId)
			.then((response) => setHistory(response.data))
			.catch(() => setHistory([]))
	}, [load, conversationId])

	const releaseToAi = useCallback(async () => {
		setBusy(true)
		setError(null)
		try {
			await personalAi.release(conversationId, noteDraft.trim() || undefined)
			navigate({ to: '/alih-tugas' })
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Gagal mengembalikan ke AI.')
			setBusy(false)
		}
	}, [conversationId, noteDraft, navigate])

	if (loading) {
		return (
			<main className="ocm-page items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="size-9 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<p className="text-sm font-medium text-muted-foreground">Memuat alih tugas…</p>
				</div>
			</main>
		)
	}

	if (notFound || !item) {
		return (
			<main className="ocm-page">
				<CrmEmptyState
					title="Alih tugas tidak ditemukan"
					description="Chat ini mungkin sudah dikembalikan ke AI, atau bukan tanggung jawab kamu."
					action={
						<button
							type="button"
							className="ocm-btn ocm-btn-primary"
							onClick={() => navigate({ to: '/alih-tugas' })}
						>
							Kembali ke daftar
						</button>
					}
				/>
			</main>
		)
	}

	const isAi = item.source === 'ai'

	return (
		<main className="ocm-page space-y-5">
			<div className="flex flex-col gap-3">
				<button
					type="button"
					className="ocm-btn w-fit"
					onClick={() => navigate({ to: '/alih-tugas' })}
				>
					<ArrowLeft size={15} /> Kembali ke Alih Tugas
				</button>
				<div className="flex flex-wrap items-center gap-2">
					<span
						className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${
							isAi
								? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
								: 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
						}`}
					>
						{isAi ? <Bot size={12} /> : <UserCheck size={12} />}
						{isAi ? 'Dialihkan AI' : 'Diambil sales'}
					</span>
					{item.awaitingResponse ? (
						<span
							className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
								item.overdue
									? 'bg-red-500/15 text-red-700 dark:text-red-300'
									: 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
							}`}
						>
							<Clock3 size={11} /> Menunggu {formatWaiting(item.waitingMinutes)}
							{item.overdue ? ' · lewat SLA' : ''}
						</span>
					) : (
						<span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
							<CheckCircle2 size={11} /> Sudah dibalas
						</span>
					)}
					<span className="text-xs text-muted-foreground">
						{item.contactPhone || 'Nomor tidak tersedia'}
					</span>
				</div>
				<h1 className="text-xl font-bold">{item.contactName}</h1>
			</div>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			<div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
				<div className="space-y-5 lg:col-span-2">
					<section className="ocm-card p-4">
						<h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
							<Sparkles size={16} className="text-primary" /> Konteks dari AI
						</h2>
						{item.aiReason ? (
							<div className="mb-3">
								<p className="mb-1 text-xs font-semibold text-muted-foreground">
									Alasan dialihkan
								</p>
								<p className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
									{item.aiReason}
								</p>
							</div>
						) : null}
						{item.aiSuggestedReply ? (
							<div className="mb-3">
								<p className="mb-1 text-xs font-semibold text-muted-foreground">Draf balasan</p>
								<p className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm">
									{item.aiSuggestedReply}
								</p>
							</div>
						) : null}
						{item.preview ? (
							<div>
								<p className="mb-1 text-xs font-semibold text-muted-foreground">
									Pesan terakhir
								</p>
								<p className="rounded-lg border border-border bg-muted/30 p-3 text-sm italic">
									&ldquo;{item.preview}&rdquo;
								</p>
							</div>
						) : null}
						{!item.aiReason && !item.aiSuggestedReply && !item.preview ? (
							<p className="text-sm text-muted-foreground">
								Tidak ada konteks tambahan. Buka chat untuk membaca percakapannya.
							</p>
						) : null}
					</section>

					<section className="ocm-card p-4">
						<h2 className="mb-3 text-sm font-semibold">Selesaikan</h2>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								className="ocm-btn ocm-btn-primary"
								onClick={() => navigate({ to: '/chat', search: { c: item.conversationId } })}
							>
								<MessageCircle size={15} /> Balas di Chat
							</button>
						</div>
						<div className="mt-4">
							<label className="mb-1 block text-xs font-semibold text-muted-foreground">
								Catatan saat dikembalikan (opsional)
							</label>
							<input
								value={noteDraft}
								onChange={(event) => setNoteDraft(event.target.value)}
								placeholder="mis. sudah dijawab, tinggal follow-up"
								className="ocm-input"
							/>
							<button
								type="button"
								className="ocm-btn mt-2"
								onClick={() => void releaseToAi()}
								disabled={busy}
							>
								<Bot size={15} />
								{busy ? 'Mengembalikan...' : 'Selesai, kembalikan ke AI'}
							</button>
						</div>
					</section>
				</div>

				<div className="space-y-5">
					<section className="ocm-card p-4">
						<h2 className="mb-3 text-sm font-semibold">Detail</h2>
						<dl className="space-y-2 text-sm">
							{(
								[
									['Sales', item.ownerName || '—'],
									['Diambil oleh', item.takenByName || (isAi ? 'AI' : '—')],
									['Sejak', formatDateTime(item.takenAt)],
									[
										'Status',
										item.awaitingResponse
											? `Menunggu ${formatWaiting(item.waitingMinutes)}`
											: `Dibalas ${formatDateTime(item.respondedAt)}`,
									],
									['Batas SLA', `${item.slaMinutes} menit`],
								] as Array<[string, string]>
							).map(([label, value]) => (
								<div key={label} className="flex items-baseline justify-between gap-3">
									<dt className="shrink-0 text-xs text-muted-foreground">{label}</dt>
									<dd className="min-w-0 break-words text-right text-xs">{value}</dd>
								</div>
							))}
						</dl>
						{item.note ? (
							<p className="mt-3 rounded-md bg-muted/40 px-2 py-1.5 text-xs text-muted-foreground">
								Catatan: {item.note}
							</p>
						) : null}
					</section>

					<section className="ocm-card p-4">
						<h2 className="mb-3 text-sm font-semibold">Riwayat</h2>
						{history === null ? (
							<p className="text-xs text-muted-foreground">Memuat...</p>
						) : history.length === 0 ? (
							<p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
						) : (
							<ol className="space-y-3">
								{history.map((event) => (
									<li key={event.id} className="flex items-start gap-2 text-xs">
										<span
											className={`mt-1 inline-block size-2 shrink-0 rounded-full ${
												event.action === 'personal_release' ? 'bg-sky-500' : 'bg-amber-500'
											}`}
										/>
										<span className="min-w-0">
											<span className="block font-medium">
												{event.action === 'personal_release'
													? 'Dikembalikan ke AI'
													: event.source === 'ai'
														? 'Dialihkan otomatis oleh AI'
														: 'Diambil alih sales'}
											</span>
											{event.actorName ? (
												<span className="block text-muted-foreground">{event.actorName}</span>
											) : null}
											{event.note ? (
												<span className="block text-muted-foreground">&ldquo;{event.note}&rdquo;</span>
											) : null}
											<span className="block text-muted-foreground">
												{formatDateTime(event.createdAt)}
											</span>
										</span>
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
