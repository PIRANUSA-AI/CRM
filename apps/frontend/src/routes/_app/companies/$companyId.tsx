import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Building2, Loader2, Plus, TriangleAlert, X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrmAvatar, CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import {
	companies as companiesApi,
	customers as customersApi,
	type CompanyDetail,
	type Industry,
	type TimelineEvent,
	type TimelineTone,
} from '@/lib/api'

const TONE_DOT: Record<TimelineTone, string> = {
	default: 'bg-muted-foreground/40',
	info: 'bg-sky-500',
	success: 'bg-emerald-500',
	warning: 'bg-amber-500',
}

function formatMoment(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleString('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

/** The fields the contact picker needs; the customers list carries more. */
type ContactOption = {
	id: string
	name: string | null
	email: string | null
	phone_number: string | null
	company_name: string | null
}

export const Route = createFileRoute('/_app/companies/$companyId')({
	component: CompanyDetailPage,
})

const IDR_FORMATTER = new Intl.NumberFormat('id-ID', {
	style: 'currency',
	currency: 'IDR',
	maximumFractionDigits: 0,
})

function formatValue(amount: number): string {
	if (!amount) return 'Rp 0'
	return IDR_FORMATTER.format(amount)
}

function formatDate(value: string | null): string {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleDateString('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	})
}

const CONTACT_COLUMNS = 'grid-cols-[1.6fr_150px_1fr_140px_36px]'
const DEAL_COLUMNS = 'grid-cols-[1.6fr_1fr_150px_80px_150px]'

function CompanyDetailPage() {
	const { companyId } = Route.useParams()
	const navigate = useNavigate()
	const [company, setCompany] = useState<CompanyDetail | null>(null)
	const [loading, setLoading] = useState(true)
	const [notFound, setNotFound] = useState(false)
	const [industries, setIndustries] = useState<Industry[]>([])
	const [error, setError] = useState<string | null>(null)
	const [saving, setSaving] = useState(false)
	const [busyContactId, setBusyContactId] = useState<string | null>(null)
	const [timeline, setTimeline] = useState<TimelineEvent[]>([])

	// The About panel edits in place: the fields are always inputs, and Simpan
	// only appears once something differs. A separate edit mode would be a extra
	// click on a form of five fields.
	const [draft, setDraft] = useState({
		name: '',
		website: '',
		city: '',
		type: 'perusahaan',
		industry: '',
		notes: '',
	})

	const [linking, setLinking] = useState(false)
	const [contactQuery, setContactQuery] = useState('')
	const [contactResults, setContactResults] = useState<ContactOption[]>([])

	const loadTimeline = useCallback((id: string) => {
		void companiesApi
			.timeline(id)
			.then((response) => setTimeline(response.payload || []))
			.catch(() => undefined)
	}, [])

	const applyCompany = useCallback((next: CompanyDetail) => {
		setCompany(next)
		// Refetched rather than appended to: an edit can produce one entry, none
		// (when nothing actually differed) or several, and only the server knows.
		loadTimeline(next.id)
		setDraft({
			name: next.name,
			website: next.website || '',
			city: next.city || '',
			type: next.type || 'perusahaan',
			industry: next.industry || '',
			notes: next.notes || '',
		})
	}, [loadTimeline])

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setNotFound(false)

		companiesApi
			.get(companyId)
			.then((response) => {
				if (cancelled) return
				if (response?.payload) applyCompany(response.payload)
				else setNotFound(true)
			})
			.catch(() => {
				// The backend returns 404 both when the company does not exist and
				// when none of its contacts are the viewer's, so this is the only
				// message that is true in every case.
				if (!cancelled) setNotFound(true)
			})
			.finally(() => {
				if (!cancelled) setLoading(false)
			})

		return () => {
			cancelled = true
		}
	}, [companyId, applyCompany])

	useEffect(() => {
		void companiesApi
			.industries()
			.then((response) => setIndustries(response.payload || []))
			.catch(() => undefined)
	}, [])

	// Searched server-side, so a sales can only ever attach a contact that is
	// already theirs — the same list the deal picker uses.
	useEffect(() => {
		if (!linking) return
		const term = contactQuery.trim()
		if (term.length < 2) {
			setContactResults([])
			return
		}
		let cancelled = false
		const timer = setTimeout(() => {
			void customersApi
				.list({ search: term, per_page: 8 })
				.then((response: any) => {
					if (cancelled) return
					setContactResults(response?.data || response?.payload || [])
				})
				.catch(() => undefined)
		}, 250)
		return () => {
			cancelled = true
			clearTimeout(timer)
		}
	}, [contactQuery, linking])

	const dirty =
		Boolean(company) &&
		(draft.name !== company!.name ||
			draft.website !== (company!.website || '') ||
			draft.city !== (company!.city || '') ||
			draft.type !== (company!.type || 'perusahaan') ||
			draft.industry !== (company!.industry || '') ||
			draft.notes !== (company!.notes || ''))

	const save = useCallback(async () => {
		if (!company) return
		if (!draft.name.trim()) {
			setError('Nama perusahaan wajib diisi.')
			return
		}
		setSaving(true)
		setError(null)
		try {
			const response = await companiesApi.update(company.id, {
				name: draft.name.trim(),
				website: draft.website.trim() || null,
				city: draft.city.trim() || null,
				type: draft.type,
				industry: draft.industry || null,
				notes: draft.notes.trim() || null,
			})
			applyCompany(response.payload)
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : 'Perusahaan belum dapat disimpan.')
		} finally {
			setSaving(false)
		}
	}, [company, draft, applyCompany])

	const setContact = useCallback(
		async (contactId: string, attach: boolean) => {
			if (!company) return
			setBusyContactId(contactId)
			setError(null)
			try {
				const response = await companiesApi.setContact(company.id, contactId, attach)
				applyCompany(response.payload)
				if (attach) {
					setLinking(false)
					setContactQuery('')
					setContactResults([])
				}
			} catch (reason) {
				setError(reason instanceof Error ? reason.message : 'Kontak belum dapat diubah.')
			} finally {
				setBusyContactId(null)
			}
		},
		[company, applyCompany],
	)

	if (loading) {
		return (
			<main className="ocm-page items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="size-9 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<p className="text-sm font-medium text-muted-foreground">Memuat perusahaan…</p>
				</div>
			</main>
		)
	}

	if (notFound || !company) {
		return (
			<main className="ocm-page">
				<CrmEmptyState
					title="Perusahaan tidak ditemukan"
					description="Perusahaan ini tidak ada, atau tidak ada kontaknya yang jadi tanggung jawab kamu."
					action={
						<button
							type="button"
							className="ocm-btn ocm-btn-primary"
							onClick={() => navigate({ to: '/companies' })}
						>
							Kembali ke daftar
						</button>
					}
				/>
			</main>
		)
	}

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title={company.name}
				subtitle={`${company.industry_label || 'Tanpa industri'} • ${company.city || 'Tanpa kota'} • Terdaftar ${formatDate(company.created_at)}`}
				actions={
					<>
						<Link to="/companies" className="ocm-btn">
							<ArrowLeft size={14} /> Perusahaan
						</Link>
						{dirty ? (
							<button
								type="button"
								className="ocm-btn ocm-btn-primary"
								onClick={() => void save()}
								disabled={saving || !draft.name.trim()}
							>
								{saving ? <Loader2 size={14} className="animate-spin" /> : null}
								Simpan
							</button>
						) : null}
					</>
				}
			/>

			{error ? (
				<div className="flex items-start gap-2 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
					<TriangleAlert size={16} className="mt-0.5 shrink-0" />
					<span>{error}</span>
				</div>
			) : null}

			<section className="ocm-card p-5">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-center">
					<span className="flex size-[72px] shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
						<Building2 size={32} />
					</span>

					<div className="min-w-0 flex-1">
						<h2 className="text-xl font-bold">{company.name}</h2>
						<p className="mt-1 text-sm text-muted-foreground">
							{[company.industry_label, company.city].filter(Boolean).join(' · ') ||
								'Belum ada industri atau kota'}
						</p>
					</div>

					<div className="flex gap-2">
						<div className="rounded-xl border border-border bg-muted/40 px-5 py-3 text-center">
							<div className="text-2xl font-bold leading-none">{company.contacts.length}</div>
							<div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
								PIC
							</div>
						</div>
						<div className="rounded-xl border border-border bg-muted/40 px-5 py-3 text-center">
							<div className="text-2xl font-bold leading-none">{company.deals.length}</div>
							<div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
								Deal
							</div>
						</div>
						<div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-3 text-center">
							<div className="text-xl font-bold leading-none text-emerald-600 dark:text-emerald-400">
								{formatValue(company.deal_value)}
							</div>
							<div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-600/80 dark:text-emerald-400/80">
								Total Nilai
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Narrow form on the left, the wide tables and the feed on the right —
			    the shape of the page the team already reads. Stacks on small
			    screens, where two columns would leave both too narrow to use. */}
			<div className="grid items-start gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
				<div className="space-y-5 lg:sticky lg:top-4">
					{/* Edits in place; Simpan appears in the header once something
					    differs from what was loaded. */}
					<section className="ocm-card overflow-hidden">
						<div className="ocm-card-header">
							<span className="ocm-card-title">Tentang Perusahaan</span>
							<div className="font-mono text-[11px] text-muted-foreground">
								ID {company.id.slice(0, 8).toUpperCase()}
							</div>
						</div>
						<div className="grid gap-3 p-4">
							<label className="block sm:col-span-2">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">
									Nama perusahaan *
								</span>
								<input
									className="ocm-input"
									value={draft.name}
									onChange={(event) => setDraft((d) => ({ ...d, name: event.target.value }))}
								/>
							</label>
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">Website</span>
								<input
									className="ocm-input"
									value={draft.website}
									onChange={(event) => setDraft((d) => ({ ...d, website: event.target.value }))}
									placeholder="https://..."
								/>
							</label>
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">Kota</span>
								<input
									className="ocm-input"
									value={draft.city}
									onChange={(event) => setDraft((d) => ({ ...d, city: event.target.value }))}
									placeholder="mis. Jakarta Selatan"
								/>
							</label>
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">Tipe</span>
								<select
									className="ocm-input"
									value={draft.type}
									onChange={(event) => setDraft((d) => ({ ...d, type: event.target.value }))}
								>
									<option value="perusahaan">Perusahaan</option>
									<option value="perorangan">Perorangan</option>
								</select>
							</label>
							<label className="block">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">Industri</span>
								<select
									className="ocm-input"
									value={draft.industry}
									onChange={(event) => setDraft((d) => ({ ...d, industry: event.target.value }))}
								>
									<option value="">Belum ditentukan</option>
									{industries.map((industry) => (
										<option key={industry.id} value={industry.id}>
											{industry.label}
										</option>
									))}
								</select>
							</label>
							<label className="block sm:col-span-2">
								<span className="mb-1 block text-xs font-medium text-muted-foreground">Catatan</span>
								<textarea
									rows={3}
									className="ocm-input resize-y"
									value={draft.notes}
									onChange={(event) => setDraft((d) => ({ ...d, notes: event.target.value }))}
									placeholder="Konteks akun, sejarah pembelian, dsb."
								/>
							</label>
							{/* Owner is deliberately absent. A company belongs to whoever works
							    its contacts; giving it an owner of its own would create a second
							    answer that can disagree with the first. */}
							<p className="border-t border-border pt-3 text-[11px] text-muted-foreground">
								Pemilik perusahaan mengikuti sales yang memegang kontaknya — lihat kolom Sales di
								tabel Kontak. Tidak diatur terpisah supaya tidak ada dua jawaban yang bisa berbeda.
							</p>
						</div>
					</section>

				</div>

				<div className="min-w-0 space-y-5">
					<section className="ocm-card overflow-hidden">
						<div className="ocm-card-header">
							<span className="ocm-card-title">Kontak</span>
							<div className="flex items-center gap-3">
								<span className="text-xs text-muted-foreground">
									{company.contacts.length} orang di perusahaan ini
								</span>
								<button
									type="button"
									className="ocm-btn h-8 gap-1 px-2.5 text-xs"
									onClick={() => setLinking((current) => !current)}
								>
									<Plus size={13} /> Tautkan kontak
								</button>
							</div>
						</div>

						{linking ? (
							<div className="border-b border-border bg-muted/30 p-3">
								<input
									className="ocm-input"
									value={contactQuery}
									onChange={(event) => setContactQuery(event.target.value)}
									placeholder="Cari kontak berdasarkan nama, email, atau nomor..."
								/>
								{contactResults.length > 0 ? (
									<div className="mt-2 max-h-52 overflow-y-auto rounded-lg border border-border bg-background">
										{contactResults.map((contact) => {
											const already = company.contacts.some((row) => row.id === contact.id)
											return (
												<button
													key={contact.id}
													type="button"
													disabled={already || busyContactId === contact.id}
													onClick={() => void setContact(contact.id, true)}
													className="flex w-full items-center justify-between gap-3 border-b border-border px-3 py-2 text-left last:border-0 hover:bg-muted/50 disabled:cursor-not-allowed disabled:opacity-50"
												>
													<span className="min-w-0">
														<span className="block truncate text-sm">
															{contact.name || 'Tanpa nama'}
														</span>
														<span className="block truncate text-xs text-muted-foreground">
															{contact.email || contact.phone_number || '—'}
														</span>
													</span>
													{/* Moving a contact between firms is a real edit, not an
													    error, so the current employer is stated rather than
													    the row being hidden. */}
													<span className="shrink-0 text-[11px] text-muted-foreground">
														{already
															? 'Sudah di sini'
															: contact.company_name
																? `Kini di ${contact.company_name}`
																: 'Belum ada perusahaan'}
													</span>
												</button>
											)
										})}
									</div>
								) : contactQuery.trim().length >= 2 ? (
									<p className="mt-2 text-xs text-muted-foreground">Tidak ada kontak yang cocok.</p>
								) : (
									<p className="mt-2 text-xs text-muted-foreground">
										Ketik minimal 2 huruf. Hanya kontak yang jadi tanggung jawab kamu yang muncul.
									</p>
								)}
							</div>
						) : null}
						<div className="overflow-x-auto">
							<div className="min-w-[640px]">
								<div
									className={`grid ${CONTACT_COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
								>
									<div>Nama</div>
									<div>Nomor WA</div>
									<div>Email</div>
									<div>Sales</div>
									<div />
								</div>
								{company.contacts.map((contact) => (
									<div
										key={contact.id}
										role="button"
										tabIndex={0}
										onClick={() =>
											navigate({
												to: '/customers/$customerId',
												params: { customerId: contact.id },
											})
										}
										onKeyDown={(event) => {
											if (event.key === 'Enter') {
												navigate({
													to: '/customers/$customerId',
													params: { customerId: contact.id },
												})
											}
										}}
										className={`grid ${CONTACT_COLUMNS} cursor-pointer items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40`}
									>
										<div className="flex min-w-0 items-center gap-2.5">
											<CrmAvatar name={contact.name || '?'} size={26} />
											<p className="truncate font-semibold">{contact.name || 'Tanpa nama'}</p>
										</div>
										<div className="font-mono text-xs text-muted-foreground">
											{contact.phone_number || '-'}
										</div>
										<div className="truncate text-sm text-muted-foreground">
											{contact.email || '-'}
										</div>
										<div className="truncate text-sm text-muted-foreground">
											{contact.owner_name || 'Belum ada'}
										</div>
										<button
											type="button"
											title="Lepas dari perusahaan ini"
											disabled={busyContactId === contact.id}
											onClick={(event) => {
												// The row navigates to the contact; detaching must not.
												event.stopPropagation()
												void setContact(contact.id, false)
											}}
											className="flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-red-500/10 hover:text-red-600 disabled:opacity-40"
										>
											<X size={14} />
										</button>
									</div>
								))}
							</div>
						</div>
					</section>

					<section className="ocm-card overflow-hidden">
						<div className="ocm-card-header">
							<span className="ocm-card-title">Deal</span>
							<div className="text-xs text-muted-foreground">
								{company.deals.length} deal · {formatValue(company.deal_value)}
							</div>
						</div>
						{company.deals.length === 0 ? (
							<div className="p-3">
								<CrmEmptyState
									title="Belum ada deal"
									description="Deal muncul di sini begitu salah satu PIC perusahaan ini punya deal berjalan."
								/>
							</div>
						) : (
							<div className="overflow-x-auto">
								<div className="min-w-[680px]">
									<div
										className={`grid ${DEAL_COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
									>
										<div>Deal</div>
										<div>Kontak</div>
										<div>Stage</div>
										<div className="text-right">Prob.</div>
										<div className="text-right">Nilai</div>
									</div>
									{company.deals.map((deal) => (
										<div
											key={deal.id}
											className={`grid ${DEAL_COLUMNS} items-center border-b border-border px-4 py-2.5 text-sm last:border-0`}
										>
											<div className="truncate font-semibold">{deal.name}</div>
											<div className="truncate text-sm text-muted-foreground">
												{deal.contact_name || '-'}
											</div>
											<div className="text-sm text-muted-foreground">{deal.stage_label}</div>
											<div className="text-right font-mono text-sm text-muted-foreground">
												{deal.probability ?? 0}%
											</div>
											<div className="text-right font-mono text-sm">{formatValue(deal.value)}</div>
										</div>
									))}
								</div>
							</div>
						)}
					</section>

					<section className="ocm-card overflow-hidden">
						<div className="ocm-card-header">
							<span className="ocm-card-title">Aktivitas</span>
							<div className="text-xs text-muted-foreground">
								{timeline.length} kejadian terakhir
							</div>
						</div>
						{timeline.length === 0 ? (
							<div className="p-3">
								<CrmEmptyState
									title="Belum ada aktivitas"
									description="Perubahan data, kontak yang ditautkan, dan pergerakan deal akan muncul di sini."
								/>
							</div>
						) : (
							<ol className="p-4">
								{timeline.map((event, index) => (
									<li key={event.id} className="relative flex gap-3 pb-4 last:pb-0">
										{/* The rail stops at the last item so the feed does not look
										    like it continues past what was loaded. */}
										{index < timeline.length - 1 ? (
											<span className="absolute left-[5px] top-4 h-full w-px bg-border" />
										) : null}
										<span
											className={`relative mt-1.5 size-2.5 shrink-0 rounded-full ${TONE_DOT[event.tone]}`}
										/>
										<div className="min-w-0 flex-1">
											<div className="flex flex-wrap items-baseline justify-between gap-x-3">
												<p className="text-sm font-semibold">{event.title}</p>
												<time className="shrink-0 text-[11px] text-muted-foreground">
													{formatMoment(event.at)}
												</time>
											</div>
											{event.description ? (
												<p className="mt-0.5 break-words text-xs text-muted-foreground">
													{event.description}
												</p>
											) : null}
											{event.actorName ? (
												<p className="mt-0.5 text-[11px] text-muted-foreground">
													oleh {event.actorName}
												</p>
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
