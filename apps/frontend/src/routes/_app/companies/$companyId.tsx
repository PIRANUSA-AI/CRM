import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Building2, Loader2, MapPin } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CrmAvatar, CrmEmptyState, CrmStatCard } from '@/components/crm/shared'
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
			<div className="flex min-h-64 items-center justify-center">
				<Loader2 size={20} className="animate-spin text-muted-foreground" />
			</div>
		)
	}

	if (notFound || !company) {
		return (
			<div className="space-y-4">
				<button
					type="button"
					onClick={() => navigate({ to: '/companies' })}
					className="ocm-btn h-8 gap-1.5 px-3 text-xs"
				>
					<ArrowLeft size={14} />
					Kembali
				</button>
				<CrmEmptyState
					title="Perusahaan tidak ditemukan"
					description="Perusahaan ini tidak ada, atau tidak ada kontaknya yang jadi tanggung jawab kamu."
				/>
			</div>
		)
	}

	return (
		<div className="space-y-4">
			<button
				type="button"
				onClick={() => navigate({ to: '/companies' })}
				className="ocm-btn h-8 gap-1.5 px-3 text-xs"
			>
				<ArrowLeft size={14} />
				Kembali
			</button>

			<header className="flex flex-wrap items-start gap-3">
				<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
					<Building2 size={20} />
				</span>
				<div className="min-w-0">
					<h1 className="ocm-section-title">{company.name}</h1>
					<div className="mt-1 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
						{company.city ? (
							<span className="flex items-center gap-1">
								<MapPin size={13} />
								{company.city}
							</span>
						) : null}
						{company.website ? (
							<a
								href={company.website}
								target="_blank"
								rel="noreferrer noopener"
								className="underline underline-offset-2 hover:text-foreground"
							>
								{company.website}
							</a>
						) : null}
						<span>Terdaftar {formatDate(company.created_at)}</span>
					</div>
				</div>
			</header>

			<div className="ocm-grid-3">
				<CrmStatCard label="Kontak" value={String(company.contacts.length)} />
				<CrmStatCard label="Deal" value={String(company.deals.length)} />
				<CrmStatCard
					label="Total Nilai Deal"
					value={formatValue(company.deal_value)}
					subtitle="Gabungan semua PIC di perusahaan ini"
				/>
			</div>

			<section className="ocm-card">
				<div className="border-b border-border px-4 py-3">
					<h2 className="text-sm font-semibold">Kontak</h2>
					<p className="mt-0.5 text-xs text-muted-foreground">
						Orang yang kamu ajak bicara di perusahaan ini.
					</p>
				</div>
				<div className="overflow-x-auto">
					<div className="min-w-[640px]">
						<div className="grid grid-cols-[1.6fr_150px_1fr_140px] items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
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
								className="grid cursor-pointer grid-cols-[1.6fr_150px_1fr_140px] items-center border-b border-border px-4 py-2.5 text-sm transition-colors last:border-0 hover:bg-muted/40"
							>
								<div className="flex min-w-0 items-center gap-2.5">
									<CrmAvatar name={contact.name || '?'} size={26} />
									<p className="truncate font-semibold">
										{contact.name || 'Tanpa nama'}
									</p>
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

			<section className="ocm-card">
				<div className="border-b border-border px-4 py-3">
					<h2 className="text-sm font-semibold">Deal</h2>
				</div>
				{company.deals.length === 0 ? (
					<p className="px-4 py-6 text-center text-sm text-muted-foreground">
						Belum ada deal untuk perusahaan ini.
					</p>
				) : (
					<div className="overflow-x-auto">
						<div className="min-w-[640px]">
							<div className="grid grid-cols-[1.6fr_1fr_140px_90px_140px] items-center border-b border-border px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
								<div>Deal</div>
								<div>Kontak</div>
								<div>Stage</div>
								<div className="text-right">Prob.</div>
								<div className="text-right">Nilai</div>
							</div>
							{company.deals.map((deal) => (
								<div
									key={deal.id}
									className="grid grid-cols-[1.6fr_1fr_140px_90px_140px] items-center border-b border-border px-4 py-2.5 text-sm last:border-0"
								>
									<div className="truncate font-semibold">{deal.name}</div>
									<div className="truncate text-sm text-muted-foreground">
										{deal.contact_name || '-'}
									</div>
									<div className="text-sm text-muted-foreground">
										{deal.stage_label}
									</div>
									<div className="text-right font-mono text-sm text-muted-foreground">
										{deal.probability ?? 0}%
									</div>
									<div className="text-right font-mono text-sm">
										{formatValue(deal.value)}
									</div>
								</div>
							))}
						</div>
					</div>
				)}
			</section>

			{company.notes ? (
				<section className="ocm-card p-4">
					<h2 className="text-sm font-semibold">Catatan</h2>
					<p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
						{company.notes}
					</p>
				</section>
			) : null}
		</div>
	)
}
