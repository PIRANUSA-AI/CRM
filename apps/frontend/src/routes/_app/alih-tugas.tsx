import { createFileRoute, useNavigate } from '@tanstack/react-router'
import {
	Bot,
	Clock3,
	History,
	MessageCircle,
	RefreshCw,
	Sparkles,
	TriangleAlert,
	UserCheck,
	UserRound,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import {
	personalAi,
	type PersonalTakeoverHistoryItem,
	type PersonalTakeoverItem,
} from '@/lib/api'
import { connectSocket } from '@/lib/socket'

export const Route = createFileRoute('/_app/alih-tugas')({
	component: AlihTugasPage,
})

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

function formatWaiting(minutes: number) {
	if (minutes < 1) return 'baru saja'
	if (minutes < 60) return `${minutes} mnt`
	const hours = Math.floor(minutes / 60)
	const rest = minutes % 60
	if (hours < 24) return rest ? `${hours} jam ${rest} mnt` : `${hours} jam`
	const days = Math.floor(hours / 24)
	return `${days} hari`
}

function AlihTugasPage() {
	const navigate = useNavigate()
	const [items, setItems] = useState<PersonalTakeoverItem[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [busyId, setBusyId] = useState<string | null>(null)
	const [expandedId, setExpandedId] = useState<string | null>(null)
	const [historyById, setHistoryById] = useState<Record<string, PersonalTakeoverHistoryItem[]>>({})
	const [noteDraft, setNoteDraft] = useState('')

	const load = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await personalAi.listTakeovers()
			setItems(response.data)
		} catch (reason) {
			setItems([])
			setError(reason instanceof Error ? reason.message : 'Daftar alih tugas belum dapat dimuat.')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void load()
	}, [load])

	// Live-refresh when a takeover changes anywhere in the app.
	useEffect(() => {
		const socket = connectSocket()
		const handler = () => void load()
		socket.on('personal-takeover:updated', handler)
		return () => {
			socket.off('personal-takeover:updated', handler)
		}
	}, [load])

	const toggleHistory = useCallback(
		async (conversationId: string) => {
			if (expandedId === conversationId) {
				setExpandedId(null)
				return
			}
			setExpandedId(conversationId)
			setNoteDraft('')
			if (!historyById[conversationId]) {
				try {
					const response = await personalAi.takeoverHistory(conversationId)
					setHistoryById((current) => ({ ...current, [conversationId]: response.data }))
				} catch {
					setHistoryById((current) => ({ ...current, [conversationId]: [] }))
				}
			}
		},
		[expandedId, historyById],
	)

	const releaseToAi = useCallback(
		async (conversationId: string, note?: string) => {
			setBusyId(conversationId)
			setError(null)
			try {
				await personalAi.release(conversationId, note?.trim() || undefined)
				await load()
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : 'Gagal mengembalikan ke AI.')
			} finally {
				setBusyId(null)
			}
		},
		[load],
	)

	const overdueCount = items.filter((item) => item.overdue).length

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Alih Tugas"
				subtitle="Lead yang sedang ditangani manusia (AI berhenti membalas). Dialihkan otomatis oleh AI atau diambil manual oleh sales."
				actions={
					<div className="flex items-center gap-2">
						{overdueCount > 0 ? (
							<span className="ocm-tag ocm-tag-danger">{overdueCount} lewat SLA</span>
						) : null}
						<span className="ocm-tag">{items.length} aktif</span>
						<button type="button" className="ocm-btn" onClick={() => void load()} disabled={loading}>
							<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
							Refresh
						</button>
					</div>
				}
			/>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={18} className="mt-0.5 shrink-0" />
					<div>
						<p>{error}</p>
						<button type="button" className="mt-1 font-semibold underline" onClick={() => void load()}>
							Coba lagi
						</button>
					</div>
				</div>
			) : null}

			<section className="ocm-card overflow-hidden">
				{loading ? (
					<div className="space-y-3 p-4">
						{Array.from({ length: 3 }).map((_, index) => (
							<div key={index} className="h-24 animate-pulse rounded-lg bg-muted/60" />
						))}
					</div>
				) : items.length === 0 ? (
					<div className="p-4">
						<CrmEmptyState
							title="Belum ada alih tugas"
							description="Saat AI menyerahkan lead atau kamu klik Ambil Alih di chat, lead-nya akan muncul di sini."
						/>
					</div>
				) : (
					<ul className="divide-y divide-border">
						{items.map((item) => {
							const isBusy = busyId === item.conversationId
							const isAi = item.source === 'ai'
							const isExpanded = expandedId === item.conversationId
							const history = historyById[item.conversationId]
							return (
								<li key={item.conversationId} className="p-4">
									<div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
										<div className="min-w-0 flex-1">
											<div className="mb-2 flex flex-wrap items-center gap-2">
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
												<span
													className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ${
														item.overdue
															? 'bg-red-500/15 text-red-700 dark:text-red-300'
															: 'bg-muted text-muted-foreground'
													}`}
												>
													<Clock3 size={11} /> menunggu {formatWaiting(item.waitingMinutes)}
													{item.overdue ? ' · lewat SLA' : ''}
												</span>
												{item.takenByName ? (
													<span className="text-xs text-muted-foreground">oleh {item.takenByName}</span>
												) : item.ownerName ? (
													<span className="text-xs text-muted-foreground">pemilik {item.ownerName}</span>
												) : null}
											</div>
											<h3 className="text-base font-semibold">{item.contactName}</h3>
											{item.aiReason ? (
												<p className="mt-1 line-clamp-2 text-sm text-muted-foreground">
													Alasan: {item.aiReason}
												</p>
											) : null}
											{item.aiSuggestedReply ? (
												<div className="mt-2 rounded-lg border border-primary/20 bg-primary/5 p-2.5">
													<p className="mb-1 flex items-center gap-1 text-[11px] font-semibold uppercase text-primary">
														<Sparkles size={12} /> Draf balasan dari AI
													</p>
													<p className="text-sm text-foreground">{item.aiSuggestedReply}</p>
												</div>
											) : null}
											{item.note ? (
												<p className="mt-2 rounded-md bg-muted/40 px-2 py-1 text-xs text-muted-foreground">
													Catatan: {item.note}
												</p>
											) : null}
											{item.preview ? (
												<p className="mt-1 line-clamp-1 text-sm italic text-muted-foreground/80">
													&ldquo;{item.preview}&rdquo;
												</p>
											) : null}
											<div className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs text-muted-foreground">
												<span className="inline-flex items-center gap-1">
													<UserRound size={14} />
													{item.contactPhone || 'Nomor tidak tersedia'}
												</span>
												<span className="inline-flex items-center gap-1">
													<Clock3 size={14} />
													{formatDateTime(item.takenAt)}
												</span>
												<button
													type="button"
													className="inline-flex items-center gap-1 font-medium hover:text-foreground"
													onClick={() => void toggleHistory(item.conversationId)}
												>
													<History size={14} /> {isExpanded ? 'Tutup riwayat' : 'Riwayat'}
												</button>
											</div>
										</div>

										<div className="flex shrink-0 flex-wrap gap-2">
											<button
												type="button"
												className="ocm-btn"
												onClick={() => navigate({ to: '/chat' })}
											>
												<MessageCircle size={15} />
												Buka Chat
											</button>
											<button
												type="button"
												className="ocm-btn bg-sky-600 text-white hover:bg-sky-700"
												onClick={() => void releaseToAi(item.conversationId)}
												disabled={isBusy}
											>
												<Bot size={15} />
												{isBusy ? '...' : 'Kembalikan ke AI'}
											</button>
										</div>
									</div>

									{isExpanded ? (
										<div className="mt-4 space-y-3 rounded-lg border border-border bg-muted/20 p-3">
											<div>
												<label className="mb-1 block text-xs font-semibold text-muted-foreground">
													Catatan saat kembalikan ke AI (opsional)
												</label>
												<div className="flex gap-2">
													<input
														value={noteDraft}
														onChange={(event) => setNoteDraft(event.target.value)}
														placeholder="mis. sudah dijawab, tinggal follow-up"
														className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
													/>
													<button
														type="button"
														className="ocm-btn shrink-0"
														onClick={() => void releaseToAi(item.conversationId, noteDraft)}
														disabled={isBusy}
													>
														Kembalikan + catatan
													</button>
												</div>
											</div>
											<div>
												<p className="mb-1 text-xs font-semibold text-muted-foreground">Riwayat alih tugas</p>
												{history === undefined ? (
													<p className="text-xs text-muted-foreground">Memuat...</p>
												) : history.length === 0 ? (
													<p className="text-xs text-muted-foreground">Belum ada riwayat.</p>
												) : (
													<ol className="space-y-1.5">
														{history.map((event) => (
															<li key={event.id} className="flex items-start gap-2 text-xs">
																<span
																	className={`mt-0.5 inline-block h-2 w-2 shrink-0 rounded-full ${
																		event.action === 'personal_release' ? 'bg-sky-500' : 'bg-amber-500'
																	}`}
																/>
																<span className="min-w-0">
																	<span className="font-medium">
																		{event.action === 'personal_release'
																			? 'Dikembalikan ke AI'
																			: event.source === 'ai'
																				? 'Dialihkan otomatis oleh AI'
																				: 'Diambil alih sales'}
																	</span>
																	{event.actorName ? ` · ${event.actorName}` : ''}
																	{event.note ? ` · "${event.note}"` : ''}
																	<span className="text-muted-foreground"> · {formatDateTime(event.createdAt)}</span>
																</span>
															</li>
														))}
													</ol>
												)}
											</div>
										</div>
									) : null}
								</li>
							)
						})}
					</ul>
				)}
			</section>
		</main>
	)
}
