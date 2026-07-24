import { createFileRoute } from '@tanstack/react-router'
import {
	Activity,
	AlertTriangle,
	Bot,
	HeartPulse,
	Radio,
	Webhook,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { CrmSectionHeader } from '@/components/crm/shared'
import { systemHealth, type HealthStatus, type SystemHealth } from '@/lib/api'

export const Route = createFileRoute('/_app/kesehatan-sistem')({
	component: KesehatanSistemPage,
})

const STATUS_LABEL: Record<HealthStatus, string> = {
	healthy: 'Sehat',
	warning: 'Perlu Perhatian',
	inactive: 'Tidak Aktif',
}

function StatusPill({ status }: { status: HealthStatus }) {
	const tone =
		status === 'healthy' ? 'ocm-tag-success' : status === 'warning' ? 'ocm-tag-danger' : ''
	return <span className={`ocm-tag ${tone}`}>{STATUS_LABEL[status]}</span>
}

function formatDate(value: string | null): string {
	if (!value) return '-'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '-'
	return date.toLocaleString('id-ID', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	})
}

function formatUptime(seconds: number): string {
	const hours = Math.floor(seconds / 3600)
	const minutes = Math.floor((seconds % 3600) / 60)
	return hours > 0 ? `${hours}j ${minutes}m` : `${minutes}m`
}

function KesehatanSistemPage() {
	const [data, setData] = useState<SystemHealth | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)

	const load = useCallback(() => {
		setLoading(true)
		setError(null)
		systemHealth
			.get()
			.then((response) => setData(response.data || null))
			.catch((reason) => {
				setError(
					reason instanceof Error
						? reason.message
						: 'Gagal memuat kesehatan sistem.',
				)
			})
			.finally(() => setLoading(false))
	}, [])

	useEffect(() => {
		load()
	}, [load])

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Kesehatan Sistem"
				subtitle="Status teknis: channel WhatsApp, webhook, AI response, dan antrian handover."
				actions={
					<button
						type="button"
						className="ocm-btn"
						onClick={load}
						disabled={loading}
					>
						<Activity size={14} className={loading ? 'animate-spin' : ''} />
						Refresh
					</button>
				}
			/>

			{error ? (
				<div className="rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-500">
					{error}
				</div>
			) : null}

			<div className="ocm-grid-2">
				<section className="ocm-card">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title flex items-center gap-2">
							<Radio size={16} className="text-primary" />
							Channel WhatsApp
						</h2>
						{data ? <StatusPill status={data.channels.status} /> : null}
					</div>
					<div className="ocm-card-body space-y-2 text-sm">
						{loading || !data ? (
							<p className="py-8 text-center text-muted-foreground">Memuat...</p>
						) : (
							<>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Channel aktif</span>
									<span className="font-semibold">
										{data.channels.active} / {data.channels.inboxes}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Channel error</span>
									<span
										className={
											data.channels.error > 0
												? 'font-semibold text-red-500'
												: 'font-semibold'
										}
									>
										{data.channels.error}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Sinkron terakhir</span>
									<span>{formatDate(data.channels.lastSyncedAt)}</span>
								</div>
							</>
						)}
					</div>
				</section>

				<section className="ocm-card">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title flex items-center gap-2">
							<Webhook size={16} className="text-primary" />
							Webhook · 24 jam
						</h2>
						{data ? <StatusPill status={data.webhooks.status} /> : null}
					</div>
					<div className="ocm-card-body space-y-2 text-sm">
						{loading || !data ? (
							<p className="py-8 text-center text-muted-foreground">Memuat...</p>
						) : (
							<>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Total diterima</span>
									<span className="font-semibold">
										{data.webhooks.last24h.total}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Berhasil diproses</span>
									<span className="font-semibold">
										{data.webhooks.last24h.processed}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Error</span>
									<span
										className={
											data.webhooks.last24h.error > 0
												? 'font-semibold text-red-500'
												: 'font-semibold'
										}
									>
										{data.webhooks.last24h.error}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Terakhir diterima</span>
									<span>{formatDate(data.webhooks.lastReceivedAt)}</span>
								</div>
								{data.webhooks.recentErrors.length > 0 ? (
									<div className="mt-2 space-y-1 border-t border-border pt-2">
										{data.webhooks.recentErrors.map((err) => (
											<div key={err.id} className="text-xs text-red-500">
												<AlertTriangle size={11} className="mr-1 inline" />
												{err.source} · {err.eventType}:{' '}
												{err.errorMessage || 'unknown error'}
											</div>
										))}
									</div>
								) : null}
							</>
						)}
					</div>
				</section>
			</div>

			<div className="ocm-grid-2">
				<section className="ocm-card">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title flex items-center gap-2">
							<Bot size={16} className="text-primary" />
							AI Response · 24 jam
						</h2>
						{data ? <StatusPill status={data.ai.status} /> : null}
					</div>
					<div className="ocm-card-body space-y-2 text-sm">
						{loading || !data ? (
							<p className="py-8 text-center text-muted-foreground">Memuat...</p>
						) : (
							<>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Total response</span>
									<span className="font-semibold">{data.ai.last24h.total}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Gagal</span>
									<span
										className={
											data.ai.last24h.failed > 0
												? 'font-semibold text-red-500'
												: 'font-semibold'
										}
									>
										{data.ai.last24h.failed} ({data.ai.failureRate.toFixed(1)}
										%)
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Token terpakai</span>
									<span className="font-semibold">
										{data.ai.totalTokens24h.toLocaleString('id-ID')}
									</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">
										Response terakhir
									</span>
									<span>
										{formatDate(data.ai.lastGeneratedAt)}
										{data.ai.lastProvider ? ` · ${data.ai.lastProvider}` : ''}
									</span>
								</div>
							</>
						)}
					</div>
				</section>

				<section className="ocm-card">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title flex items-center gap-2">
							<HeartPulse size={16} className="text-primary" />
							Antrian Handover
						</h2>
						{data ? <StatusPill status={data.handover.status} /> : null}
					</div>
					<div className="ocm-card-body space-y-2 text-sm">
						{loading || !data ? (
							<p className="py-8 text-center text-muted-foreground">Memuat...</p>
						) : (
							<>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Pending</span>
									<span className="font-semibold">{data.handover.pending}</span>
								</div>
								<div className="flex items-center justify-between">
									<span className="text-muted-foreground">Belum di-assign</span>
									<span
										className={
											data.handover.pendingUnassigned > 0
												? 'font-semibold text-red-500'
												: 'font-semibold'
										}
									>
										{data.handover.pendingUnassigned}
									</span>
								</div>
							</>
						)}
					</div>
				</section>
			</div>

			{data ? (
				<p className="text-center text-xs text-muted-foreground">
					Backend uptime {formatUptime(data.system.uptimeSeconds)} · diperbarui{' '}
					{formatDate(data.system.timestamp)}
				</p>
			) : null}
		</main>
	)
}
