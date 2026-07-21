import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { CheckCircle2, Sparkles, TriangleAlert, UserPlus } from 'lucide-react'
import { type ReactNode, useCallback, useEffect, useMemo, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
import { useCurrentUser } from '@/hooks/useCurrentUser'
import { isMultiTeamRole } from '@/lib/role-access'
import { leadImport, prospects, type ProspectChannel } from '@/lib/api'

export const Route = createFileRoute('/_app/prospek')({
	component: ProspekPage,
})

const CHANNEL_OPTIONS: Array<{ value: ProspectChannel; label: string }> = [
	{ value: 'event', label: 'Event / Pameran' },
	{ value: 'linkedin', label: 'LinkedIn' },
	{ value: 'instagram', label: 'Instagram' },
	{ value: 'whatsapp', label: 'WhatsApp' },
	{ value: 'referral', label: 'Referral' },
	{ value: 'other', label: 'Lainnya' },
]

/** Tomorrow 09:00 in the local timezone, formatted for <input type="datetime-local">. */
function defaultFollowUp(): string {
	const d = new Date()
	d.setDate(d.getDate() + 1)
	d.setHours(9, 0, 0, 0)
	const pad = (n: number) => String(n).padStart(2, '0')
	return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function ProspekPage() {
	const navigate = useNavigate()
	const emptyForm = useMemo(
		() => ({
			name: '',
			channel: 'event' as ProspectChannel,
			phone: '',
			email: '',
			company: '',
			city: '',
			productInterest: '',
			followUpAt: defaultFollowUp(),
			notes: '',
		}),
		[],
	)
	const [form, setForm] = useState(emptyForm)
	const [saving, setSaving] = useState(false)
	const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

	// Only the administrator tier picks an assignee. A lead entered here is one
	// the person sourced themselves, and a leader sells alongside their team, so
	// a leader keeps their own prospect exactly as a sales does. An administrator
	// oversees every team and carries no leads, so theirs must name an owner.
	//
	// isMultiTeamRole rather than a hand-written role list: spelling the roles
	// out here is how the administrator tier got missed when it was added, which
	// left the backend demanding an assignee this form never offered.
	const currentUser = useCurrentUser()
	const isMultiTeam = isMultiTeamRole(currentUser?.role)
	const [salesOptions, setSalesOptions] = useState<
		Array<{
			userId: string
			name: string | null
			email: string
			role: string
			teamName: string | null
		}>
	>([])
	const [assigneeId, setAssigneeId] = useState('')

	useEffect(() => {
		if (!isMultiTeam) return
		let active = true
		void leadImport
			.assignables()
			.then((response) => {
				if (!active) return
				// No self-filter needed: the backend lists only who can carry a
				// lead (sales and leaders), so the administrator asking is absent
				// from their own list by construction.
				const options = response.data
				setSalesOptions(options)
				if (options.length === 1) setAssigneeId(options[0].userId)
			})
			.catch(() => undefined)
		return () => {
			active = false
		}
	}, [isMultiTeam])

	const set = useCallback(
		<K extends keyof typeof emptyForm>(key: K, value: (typeof emptyForm)[K]) =>
			setForm((f) => ({ ...f, [key]: value })),
		[],
	)

	const submit = useCallback(async () => {
		if (!form.name.trim()) {
			setMsg({ ok: false, text: 'Nama prospek wajib diisi.' })
			return
		}
		if (!form.phone.trim() && !form.email.trim()) {
			setMsg({ ok: false, text: 'Isi minimal nomor WhatsApp atau email.' })
			return
		}
		if (isMultiTeam && !assigneeId) {
			setMsg({ ok: false, text: 'Pilih siapa yang akan menangani prospek ini.' })
			return
		}
		setSaving(true)
		setMsg(null)
		try {
			const res = await prospects.create({
				name: form.name.trim(),
				channel: form.channel,
				phone: form.phone.trim() || undefined,
				email: form.email.trim() || undefined,
				company: form.company.trim() || undefined,
				city: form.city.trim() || undefined,
				productInterest: form.productInterest.trim() || undefined,
				followUpAt: form.followUpAt ? new Date(form.followUpAt).toISOString() : undefined,
				notes: form.notes.trim() || undefined,
				assigneeId: isMultiTeam ? assigneeId : undefined,
			})
			const due = new Date(res.data.dueAt)
			const dueLabel = new Intl.DateTimeFormat('id-ID', {
				day: 'numeric',
				month: 'short',
				hour: '2-digit',
				minute: '2-digit',
			}).format(due)
			const owner = isMultiTeam
				? salesOptions.find((item) => item.userId === assigneeId)
				: null
			setMsg({
				ok: true,
				text: owner
					? `Prospek "${form.name.trim()}" tersimpan dan ditugaskan ke ${owner.name || owner.email}. Follow-up ${dueLabel}.`
					: `Prospek "${form.name.trim()}" tersimpan. Task follow-up dibuat untuk ${dueLabel}.`,
			})
			setForm({ ...emptyForm, channel: form.channel, followUpAt: defaultFollowUp() })
		} catch (reason) {
			setMsg({ ok: false, text: reason instanceof Error ? reason.message : 'Gagal menyimpan prospek' })
		} finally {
			setSaving(false)
		}
	}, [form, emptyForm, isMultiTeam, assigneeId, salesOptions])

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Tambah Prospek"
				subtitle={
					isMultiTeam
						? 'Catat lead yang kamu temukan sendiri (event, LinkedIn, sosmed). Jadi tugas follow-up untuk orang yang kamu tunjuk.'
						: 'Catat lead yang kamu temukan sendiri (event, LinkedIn, sosmed). Otomatis jadi tugas follow-up milikmu.'
				}
				actions={
					<button type="button" className="ocm-btn" onClick={() => navigate({ to: '/tasks' })}>
						Lihat Daftar Tugas
					</button>
				}
			/>

			<section className="ocm-card max-w-2xl p-5">
				<div className="mb-4 flex items-start gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-sm text-muted-foreground">
					<Sparkles size={16} className="mt-0.5 shrink-0 text-primary" />
					<span>
						{isMultiTeam ? (
							<>
								Prospek ini ditugaskan ke orang yang kamu pilih dan muncul di{' '}
								<strong>Daftar Tugas</strong> mereka pada tanggal follow-up.
							</>
						) : (
							<>
								Prospek yang kamu simpan langsung ditugaskan ke kamu dan muncul di{' '}
								<strong>Daftar Tugas</strong> pada tanggal follow-up yang dipilih.
							</>
						)}
					</span>
				</div>

				{msg ? (
					<div
						className={`mb-4 flex items-start gap-2 rounded-md px-3 py-2 text-sm ${
							msg.ok
								? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
								: 'bg-red-500/10 text-red-600 dark:text-red-300'
						}`}
					>
						{msg.ok ? (
							<CheckCircle2 size={16} className="mt-0.5 shrink-0" />
						) : (
							<TriangleAlert size={16} className="mt-0.5 shrink-0" />
						)}
						<span>{msg.text}</span>
					</div>
				) : null}

				<div className="grid gap-3 sm:grid-cols-2">
					{isMultiTeam ? (
						<Field label="Tugaskan ke *">
							<select
								value={assigneeId}
								onChange={(e) => setAssigneeId(e.target.value)}
								className="ocm-input"
							>
								<option value="">— Pilih penanggung jawab —</option>
								{salesOptions.map((option) => (
									<option key={option.userId} value={option.userId}>
										{option.name || option.email}
										{option.teamName ? ` · ${option.teamName}` : ''}
										{option.role === 'leader' ? ' (leader)' : ''}
									</option>
								))}
							</select>
						</Field>
					) : null}
					<Field label="Nama prospek *">
						<input
							value={form.name}
							onChange={(e) => set('name', e.target.value)}
							placeholder="Nama kontak"
							className="ocm-input"
						/>
					</Field>
					<Field label="Sumber prospek *">
						<select
							value={form.channel}
							onChange={(e) => set('channel', e.target.value as ProspectChannel)}
							className="ocm-input"
						>
							{CHANNEL_OPTIONS.map((opt) => (
								<option key={opt.value} value={opt.value}>
									{opt.label}
								</option>
							))}
						</select>
					</Field>
					<Field label="No. WhatsApp">
						<input
							value={form.phone}
							onChange={(e) => set('phone', e.target.value)}
							placeholder="08xx / 62xx"
							className="ocm-input"
						/>
					</Field>
					<Field label="Email">
						<input
							value={form.email}
							onChange={(e) => set('email', e.target.value)}
							placeholder="email@perusahaan.com"
							className="ocm-input"
						/>
					</Field>
					<Field label="Perusahaan / Instansi">
						<input
							value={form.company}
							onChange={(e) => set('company', e.target.value)}
							className="ocm-input"
						/>
					</Field>
					<Field label="Kota">
						<input
							value={form.city}
							onChange={(e) => set('city', e.target.value)}
							className="ocm-input"
						/>
					</Field>
					<Field label="Produk diminati">
						<input
							value={form.productInterest}
							onChange={(e) => set('productInterest', e.target.value)}
							placeholder="mis. ZWCAD 2025 Professional"
							className="ocm-input"
						/>
					</Field>
					<Field label="Follow-up pada">
						<input
							type="datetime-local"
							value={form.followUpAt}
							onChange={(e) => set('followUpAt', e.target.value)}
							className="ocm-input"
						/>
					</Field>
				</div>
				<div className="mt-3">
					<Field label="Catatan">
						<textarea
							value={form.notes}
							onChange={(e) => set('notes', e.target.value)}
							rows={2}
							placeholder="Konteks singkat: kebutuhan, obrolan awal, dsb."
							className="ocm-input resize-y"
						/>
					</Field>
				</div>

				<div className="mt-4 flex justify-end">
					<button
						type="button"
						className="ocm-btn bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-60"
						onClick={() => void submit()}
						disabled={saving}
					>
						<UserPlus size={15} />
						{saving ? 'Menyimpan...' : 'Simpan Prospek & Buat Tugas'}
					</button>
				</div>
			</section>
		</main>
	)
}

function Field({ label, children }: { label: string; children: ReactNode }) {
	return (
		<label className="block">
			<span className="mb-1 block text-xs font-medium text-muted-foreground">{label}</span>
			{children}
		</label>
	)
}
