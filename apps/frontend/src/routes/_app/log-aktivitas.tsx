import { createFileRoute } from '@tanstack/react-router'
import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
import { auditLog, type AuditLogEntry } from '@/lib/api'

export const Route = createFileRoute('/_app/log-aktivitas')({
	component: LogAktivitasPage,
})

const ENTITY_LABELS: Record<string, string> = {
	lead_assignment: 'Assign Lead',
	sales_target: 'Target Penjualan',
	contact: 'Kontak',
}

function formatDate(value: string): string {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleString('id-ID', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function formatRupiah(value: unknown): string {
	const num = Number(value)
	return `Rp ${Number.isFinite(num) ? Math.round(num).toLocaleString('id-ID') : '0'}`
}

/** One-line summary for the 3 action types instrumented so far; anything else
 * (future instrumentation) falls back to raw metadata so nothing is hidden. */
function summarize(entry: AuditLogEntry): string {
	const m = entry.metadata
	if (entry.entityType === 'lead_assignment' && entry.action === 'assigned') {
		return `Lead di-assign ke sales ${String(m.assigneeId || '-').slice(0, 8)}...`
	}
	if (entry.entityType === 'sales_target' && entry.action === 'target_set') {
		const prev = m.previousRevenueTarget
		const from = prev != null ? `${formatRupiah(prev)} -> ` : ''
		return `Target ${m.periodType} ${m.periodKey}: ${from}${formatRupiah(m.revenueTarget)}`
	}
	if (entry.entityType === 'contact' && entry.action === 'deleted') {
		return `Hapus kontak "${m.name || m.email || m.phone_number || entry.entityId}"`
	}
	return JSON.stringify(m)
}

function LogAktivitasPage() {
	const [entries, setEntries] = useState<AuditLogEntry[]>([])
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [entityType, setEntityType] = useState('')

	useEffect(() => {
		let mounted = true
		setLoading(true)
		setError(null)
		auditLog
			.list(entityType ? { entityType } : undefined)
			.then((response) => {
				if (mounted) setEntries(response.data || [])
			})
			.catch((reason) => {
				if (mounted) {
					setError(
						reason instanceof Error
							? reason.message
							: 'Gagal memuat log aktivitas.',
					)
				}
			})
			.finally(() => {
				if (mounted) setLoading(false)
			})
		return () => {
			mounted = false
		}
	}, [entityType])

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Log Aktivitas"
				subtitle="Jejak aksi penting di sistem: assign lead, ubah target, hapus kontak."
				actions={
					<select
						className="ocm-btn"
						value={entityType}
						onChange={(event) => setEntityType(event.target.value)}
					>
						<option value="">Semua jenis</option>
						{Object.entries(ENTITY_LABELS).map(([value, label]) => (
							<option key={value} value={value}>
								{label}
							</option>
						))}
					</select>
				}
			/>

			{error ? (
				<div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-500">
					{error}
				</div>
			) : null}

			<section className="ocm-card">
				<div className="ocm-card-header">
					<h2 className="ocm-card-title flex items-center gap-2">
						<History size={16} className="text-primary" />
						Aktivitas Terbaru
					</h2>
				</div>
				<div className="ocm-card-body overflow-x-auto">
					<table className="ocm-table">
						<thead>
							<tr>
								<th>Waktu</th>
								<th>Actor</th>
								<th>Jenis</th>
								<th>Ringkasan</th>
							</tr>
						</thead>
						<tbody>
							{loading ? (
								<tr>
									<td
										colSpan={4}
										className="py-8 text-center text-muted-foreground"
									>
										Memuat log aktivitas...
									</td>
								</tr>
							) : entries.length > 0 ? (
								entries.map((entry) => (
									<tr key={entry.id}>
										<td className="whitespace-nowrap text-xs text-muted-foreground">
											{formatDate(entry.createdAt)}
										</td>
										<td>{entry.actorName || 'Sistem'}</td>
										<td>
											<span className="ocm-tag">
												{ENTITY_LABELS[entry.entityType] || entry.entityType}
											</span>
										</td>
										<td className="text-sm">{summarize(entry)}</td>
									</tr>
								))
							) : (
								<tr>
									<td
										colSpan={4}
										className="py-8 text-center text-muted-foreground"
									>
										Belum ada aktivitas tercatat.
									</td>
								</tr>
							)}
						</tbody>
					</table>
				</div>
			</section>
		</main>
	)
}
