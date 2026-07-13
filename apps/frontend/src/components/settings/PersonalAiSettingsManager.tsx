import { Bot, Check, LoaderCircle, RotateCcw } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { personalAi, type PersonalAiSettings } from '@/lib/api'

type AiSettingsForm = {
	replyDelaySeconds: number
	minConfidencePercent: number
	personaPrompt: string
}

const DEFAULT_FORM: AiSettingsForm = {
	replyDelaySeconds: 15,
	minConfidencePercent: 65,
	personaPrompt: '',
}

export default function PersonalAiSettingsManager() {
	const [settings, setSettings] = useState<PersonalAiSettings | null>(null)
	const [form, setForm] = useState<AiSettingsForm>(DEFAULT_FORM)
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)
	const dirtyRef = useRef(false)

	const loadSettings = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const response = await personalAi.getSettings()
			setSettings(response.data)
			if (!dirtyRef.current) {
				setForm({
					replyDelaySeconds: response.data.replyDelaySeconds,
					minConfidencePercent: Math.round(response.data.minConfidence * 100),
					personaPrompt: response.data.personaPrompt || '',
				})
			}
		} catch (currentError) {
			console.error('Failed to load personal AI settings:', currentError)
			setError('Pengaturan tersimpan belum bisa dimuat. Nilai default tetap bisa diedit.')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void loadSettings()
	}, [loadSettings])

	const toggleAutoReply = useCallback(async () => {
		if (!settings || saving) return
		const previous = settings
		const autoReplyEnabled = !settings.autoReplyEnabled
		setSaving(true)
		setError(null)
		setNotice(null)
		setSettings({ ...settings, autoReplyEnabled })
		try {
			const response = await personalAi.updateSettings({ autoReplyEnabled })
			setSettings(response.data)
			setNotice(autoReplyEnabled ? 'Auto reply diaktifkan.' : 'AI akan menyiapkan draft untuk sales.')
		} catch (currentError) {
			console.error('Failed to update auto reply:', currentError)
			setSettings(previous)
			setError('Mode balasan gagal disimpan.')
		} finally {
			setSaving(false)
		}
	}, [saving, settings])

	const saveSettings = useCallback(async () => {
		if (saving) return
		setSaving(true)
		setError(null)
		setNotice(null)
		try {
			const response = await personalAi.updateSettings({
				replyDelaySeconds: Math.max(1, Math.min(300, Math.round(form.replyDelaySeconds))),
				minConfidence: Math.max(0.5, Math.min(0.95, form.minConfidencePercent / 100)),
				personaPrompt: form.personaPrompt.trim() || null,
			})
			setSettings(response.data)
			setForm({
				replyDelaySeconds: response.data.replyDelaySeconds,
				minConfidencePercent: Math.round(response.data.minConfidence * 100),
				personaPrompt: response.data.personaPrompt || '',
			})
			dirtyRef.current = false
			setNotice('Pengaturan AI sudah disimpan.')
		} catch (currentError) {
			console.error('Failed to save personal AI settings:', currentError)
			setError(currentError instanceof Error ? currentError.message : 'Pengaturan AI gagal disimpan.')
		} finally {
			setSaving(false)
		}
	}, [form, saving])

	return (
		<section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
			<header className="flex flex-col gap-4 border-b border-border px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
				<div className="flex min-w-0 items-center gap-3">
					<div className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary/12 text-primary">
						<Bot size={20} />
					</div>
					<div className="min-w-0">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-base font-bold">AI balasan WhatsApp</h2>
							<span className="rounded-full border border-border bg-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">
								{settings?.model || 'qwen3.5:4b'}
							</span>
						</div>
						<p className="mt-1 text-sm text-muted-foreground">Atur kapan dan bagaimana AI membantu membalas customer.</p>
					</div>
				</div>

				<div className="flex items-center justify-between gap-3 sm:justify-end">
					<div className="text-right">
						<p className="text-sm font-semibold">{settings?.autoReplyEnabled ? 'Auto reply aktif' : 'Mode draft'}</p>
						<p className="text-xs text-muted-foreground">Review keamanan selalu aktif</p>
					</div>
					<button
						type="button"
						role="switch"
						aria-checked={Boolean(settings?.autoReplyEnabled)}
						aria-label="Aktifkan auto reply AI"
						disabled={!settings || saving}
						onClick={() => void toggleAutoReply()}
						className={`relative h-7 w-12 shrink-0 rounded-full transition-colors duration-300 disabled:opacity-50 ${settings?.autoReplyEnabled ? 'bg-primary' : 'bg-muted-foreground/30'}`}
					>
						<span className={`absolute left-1 top-1 size-5 rounded-full bg-white shadow-sm transition-transform duration-300 ${settings?.autoReplyEnabled ? 'translate-x-5' : 'translate-x-0'}`} />
					</button>
				</div>
			</header>

			<div className="grid gap-6 px-5 py-5 lg:grid-cols-2">
				<div>
					<label htmlFor="personal-ai-delay" className="text-sm font-semibold">Jeda sebelum membalas</label>
					<div className="mt-2 flex items-center gap-2">
						<input
							id="personal-ai-delay"
							type="number"
							min={1}
							max={300}
							value={form.replyDelaySeconds}
							onChange={(event) => {
								dirtyRef.current = true
								setForm((current) => ({ ...current, replyDelaySeconds: Number(event.target.value) }))
							}}
							className="h-10 w-24 rounded-lg border border-input bg-background px-3 text-sm font-semibold outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
						/>
						<span className="text-sm text-muted-foreground">detik</span>
					</div>
					<p className="mt-2 text-xs leading-5 text-muted-foreground">AI menunggu pesan lanjutan supaya respons terasa lebih natural.</p>
				</div>

				<div>
					<div className="flex items-center justify-between gap-3">
						<label htmlFor="personal-ai-confidence" className="text-sm font-semibold">Ambang keyakinan</label>
						<span className="text-sm font-bold text-primary">{form.minConfidencePercent}%</span>
					</div>
					<input
						id="personal-ai-confidence"
						type="range"
						min={50}
						max={95}
						step={5}
						value={form.minConfidencePercent}
						onChange={(event) => {
							dirtyRef.current = true
							setForm((current) => ({ ...current, minConfidencePercent: Number(event.target.value) }))
						}}
						className="mt-4 h-2 w-full cursor-pointer accent-primary"
					/>
					<div className="mt-2 flex justify-between text-[11px] text-muted-foreground"><span>Lebih aktif</span><span>Lebih hati-hati</span></div>
				</div>

				<div className="lg:col-span-2">
					<label htmlFor="personal-ai-persona" className="text-sm font-semibold">Gaya balasan</label>
					<textarea
						id="personal-ai-persona"
						rows={4}
						maxLength={2000}
						value={form.personaPrompt}
						onChange={(event) => {
							dirtyRef.current = true
							setForm((current) => ({ ...current, personaPrompt: event.target.value }))
						}}
						placeholder="Contoh: Ramah, ringkas, gunakan bahasa Indonesia santai tetapi tetap sopan."
						className="mt-2 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm leading-6 outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
					/>
					<p className="mt-1 text-right text-[11px] text-muted-foreground">{form.personaPrompt.length}/2000</p>
				</div>
			</div>

			<footer className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
				<div className="min-h-5 text-xs">
					{loading ? <span className="inline-flex items-center gap-2 text-muted-foreground"><LoaderCircle size={13} className="animate-spin" /> Memuat pengaturan tersimpan...</span> : null}
					{error ? <span className="text-destructive">{error}</span> : null}
					{notice ? <span className="text-emerald-600 dark:text-emerald-400">{notice}</span> : null}
				</div>
				<div className="flex items-center justify-end gap-2">
					<button
						type="button"
						disabled={saving}
						onClick={() => {
							dirtyRef.current = true
							setForm(DEFAULT_FORM)
						}}
						className="inline-flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-4 text-sm font-semibold transition hover:bg-muted disabled:opacity-50"
					>
						<RotateCcw size={14} /> Default
					</button>
					<button
						type="button"
						disabled={saving || !Number.isFinite(form.replyDelaySeconds)}
						onClick={() => void saveSettings()}
						className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50"
					>
						{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Check size={14} />} Simpan pengaturan
					</button>
				</div>
			</footer>
		</section>
	)
}
