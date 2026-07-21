import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Building2, Calendar, Globe, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CrmAvatar, CrmEmptyState, CrmSectionHeader } from '@/components/crm/shared'
import { companies as companiesApi, type CompanyDetail } from '@/lib/api'

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

const CONTACT_COLUMNS = 'grid-cols-[1.6fr_150px_1fr_140px]'
const DEAL_COLUMNS = 'grid-cols-[1.6fr_1fr_150px_80px_150px]'

function CompanyDetailPage() {
	const { companyId } = Route.useParams()
	const navigate = useNavigate()
	const [company, setCompany] = useState<CompanyDetail | null>(null)
	const [loading, setLoading] = useState(true)
	const [notFound, setNotFound] = useState(false)

	useEffect(() => {
		let cancelled = false
		setLoading(true)
		setNotFound(false)

		companiesApi
			.get(companyId)
			.then((response) => {
				if (cancelled) return
				if (response?.payload) setCompany(response.payload)
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
	}, [companyId])

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
				subtitle={`${company.city || 'Tanpa kota'} • Terdaftar ${formatDate(company.created_at)}`}
				actions={
					<Link to="/companies" className="ocm-btn">
						<ArrowLeft size={14} /> Perusahaan
					</Link>
				}
			/>

			{/* Profile header card — same shape as the contact profile card. */}
			<section className="ocm-card p-5">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-center">
					<span className="flex size-[72px] shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
						<Building2 size={32} />
					</span>

					<div className="min-w-0 flex-1">
						<h2 className="text-xl font-bold">{company.name}</h2>
						<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
							<span className="inline-flex items-center gap-1.5">
								<MapPin size={14} /> {company.city || 'Tanpa kota'}
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Globe size={14} />
								{company.website ? (
									<a
										href={company.website}
										target="_blank"
										rel="noreferrer noopener"
										className="underline underline-offset-2 hover:text-foreground"
									>
										{company.website.replace(/^https?:\/\//, '')}
									</a>
								) : (
									'Tanpa website'
								)}
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Calendar size={14} /> Terdaftar {formatDate(company.created_at)}
							</span>
						</div>
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

			<section className="ocm-card overflow-hidden">
				<div className="ocm-card-header">
					<span className="ocm-card-title">Kontak</span>
					<div className="text-xs text-muted-foreground">
						{company.contacts.length} orang di perusahaan ini
					</div>
				</div>
				<div className="overflow-x-auto">
					<div className="min-w-[640px]">
						<div
							className={`grid ${CONTACT_COLUMNS} items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground`}
						>
							<div>Nama</div>
							<div>Nomor WA</div>
							<div>Email</div>
							<div>Sales</div>
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

			{company.notes ? (
				<section className="ocm-card overflow-hidden">
					<div className="ocm-card-header">
						<span className="ocm-card-title">Catatan</span>
					</div>
					<p className="whitespace-pre-wrap p-4 text-sm text-muted-foreground">{company.notes}</p>
				</section>
			) : null}
		</main>
	)
}
