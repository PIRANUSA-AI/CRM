import { CheckCircle2, Loader2, Sparkles, TriangleAlert } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { leadRouting, personalInbox, type RoutingSuggestion } from '@/lib/api'

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
					<div className="max-h-[55vh] space-y-2 overflow-y-auto pr-1">
						{suggestion.candidates.map((candidate, index) => {
							const isSelected = selected === candidate.userId
							return (
								<button
									key={candidate.userId}
									type="button"
									onClick={() => setSelected(candidate.userId)}
									className={`w-full rounded-lg border p-3 text-left transition-colors ${
										isSelected
											? 'border-primary bg-primary/5 ring-1 ring-primary'
											: 'border-border hover:bg-muted/50'
									}`}
								>
									<div className="flex items-center justify-between gap-2">
										<div className="flex items-center gap-2">
											<span className="text-sm font-medium">
												{candidate.name || candidate.email}
											</span>
											{index === 0 ? (
												<span className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
													<Sparkles size={10} /> Rekomendasi
												</span>
											) : null}
											{isSelected ? (
												<CheckCircle2 size={14} className="text-primary" />
											) : null}
										</div>
										<div className="flex items-center gap-2">
											<span
												className={`rounded-full px-2 py-0.5 text-[11px] font-medium ${
													candidate.overloaded
														? 'bg-red-500/10 text-red-600 dark:text-red-300'
														: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-300'
												}`}
											>
												{candidate.activeLoad}/{candidate.maxActive}
											</span>
											<span className="text-xs font-semibold text-muted-foreground">
												{candidate.score}
											</span>
										</div>
									</div>
									<p className="mt-1 text-xs text-muted-foreground">
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
