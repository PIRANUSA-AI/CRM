import { Check, LoaderCircle, Lock, Smartphone, AlertCircle, LogOut } from 'lucide-react'
import { useEffect, useState } from 'react'
import { auth } from '@/lib/api'
import { cn } from '@/lib/utils'

type WhatsAppSession = {
	phoneNumber: string | null
	status: string
	pairedSince: string | null
	durationSeconds: number
	lastConnectedAt: string | null
	lastSeenAt: string | null
}

function formatDuration(totalSeconds: number): string {
	if (totalSeconds <= 0) return '-'
	const days = Math.floor(totalSeconds / 86400)
	const hours = Math.floor((totalSeconds % 86400) / 3600)
	const minutes = Math.floor((totalSeconds % 3600) / 60)
	const parts: string[] = []
	if (days > 0) parts.push(`${days} hari`)
	if (hours > 0) parts.push(`${hours} jam`)
	if (minutes > 0) parts.push(`${minutes} menit`)
	return parts.join(' ') || 'beberapa detik'
}

function formatDate(iso: string | null): string {
	if (!iso) return '-'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric', month: 'long', year: 'numeric',
		hour: '2-digit', minute: '2-digit',
	}).format(new Date(iso))
}

function statusLabel(status: string): string {
	switch (status) {
		case 'connected': return 'Tersambung'
		case 'reconnecting': return 'Menyambung ulang…'
		case 'connecting': return 'Menyambung…'
		case 'qr_ready': return 'Menunggu scan QR'
		case 'pairing_code_ready': return 'Menunggu kode pairing'
		case 'disconnected': return 'Terputus'
		case 'logged_out': return 'Keluar'
		case 'disabled': return 'Nonaktif'
		default: return status
	}
}

function statusColor(status: string): string {
	switch (status) {
		case 'connected': return 'text-emerald-600 dark:text-emerald-400'
		case 'reconnecting': case 'connecting': return 'text-amber-600 dark:text-amber-400'
		default: return 'text-muted-foreground'
	}
}

export default function SecuritySettingsManager() {
	const [waSession, setWaSession] = useState<WhatsAppSession | null | undefined>(undefined)
	const [waLoading, setWaLoading] = useState(true)
	const [waDisconnecting, setWaDisconnecting] = useState(false)
	const [waError, setWaError] = useState<string | null>(null)
	const [waNotice, setWaNotice] = useState<string | null>(null)
	const [currentPassword, setCurrentPassword] = useState('')
	const [newPassword, setNewPassword] = useState('')
	const [confirmPassword, setConfirmPassword] = useState('')
	const [saving, setSaving] = useState(false)
	const [error, setError] = useState<string | null>(null)
	const [notice, setNotice] = useState<string | null>(null)

	useEffect(() => {
		auth.getWhatsAppSession()
			.then((response) => setWaSession(response.data))
			.catch(() => setWaError('Sesi WhatsApp belum bisa dimuat.'))
			.finally(() => setWaLoading(false))
	}, [])

	const changePassword = async () => {
		setError(null)
		setNotice(null)
		if (newPassword !== confirmPassword) {
			setError('Konfirmasi password baru tidak sama.')
			return
		}
		if (!/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,128}$/.test(newPassword)) {
			setError('Gunakan minimal 8 karakter dengan huruf besar, huruf kecil, dan angka.')
			return
		}

		setSaving(true)
		try {
			await auth.changePassword({ currentPassword, newPassword })
			setCurrentPassword('')
			setNewPassword('')
			setConfirmPassword('')
			setNotice('Password berhasil diganti.')
		} catch (currentError) {
			console.error('Failed to change password:', currentError)
			setError(currentError instanceof Error ? currentError.message : 'Password gagal diganti.')
		} finally {
			setSaving(false)
		}
	}

	const disconnectWa = async () => {
		if (waDisconnecting) return
		setWaError(null)
		setWaNotice(null)
		setWaDisconnecting(true)
		try {
			await auth.disconnectWhatsAppSession()
			window.location.href = '/whatsapp/connect'
		} catch (currentError) {
			setWaError(currentError instanceof Error ? currentError.message : 'Sesi WhatsApp gagal diputuskan.')
			setWaDisconnecting(false)
		}
	}

	return (
		<div className="space-y-6">
			<section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
				<header className="flex items-center gap-3 border-b border-border px-5 py-5">
					<div className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary"><Lock size={20} /></div>
					<div>
						<h2 className="font-bold">Ganti password</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">Masukkan password saat ini untuk menjaga keamanan akun.</p>
					</div>
				</header>

				<div className="grid gap-5 px-5 py-5 sm:grid-cols-2">
					<div className="sm:col-span-2">
						<label htmlFor="current-password" className="text-sm font-semibold">Password saat ini</label>
						<input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
					</div>
					<div>
						<label htmlFor="new-password" className="text-sm font-semibold">Password baru</label>
						<input id="new-password" type="password" autoComplete="new-password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
					</div>
					<div>
						<label htmlFor="confirm-password" className="text-sm font-semibold">Ulangi password baru</label>
						<input id="confirm-password" type="password" autoComplete="new-password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="mt-2 h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15" />
					</div>
					<p className="text-xs text-muted-foreground sm:col-span-2">Minimal 8 karakter, mengandung huruf besar, huruf kecil, dan angka.</p>
				</div>

				<footer className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-h-5 text-xs">
						{error ? <span className="text-destructive">{error}</span> : null}
						{notice ? <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check size={13} /> {notice}</span> : null}
					</div>
					<button type="button" disabled={saving || !currentPassword || !newPassword || !confirmPassword} onClick={() => void changePassword()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition hover:bg-primary/90 disabled:opacity-50">
						{saving ? <LoaderCircle size={14} className="animate-spin" /> : <Lock size={14} />} Ganti password
					</button>
				</footer>
			</section>

			<section className="overflow-hidden rounded-xl border border-border bg-card text-card-foreground shadow-sm">
				<header className="flex items-center gap-3 border-b border-border px-5 py-5">
					<div className="grid size-10 place-items-center rounded-xl bg-primary/12 text-primary"><Smartphone size={20} /></div>
					<div>
						<h2 className="font-bold">Sesi WhatsApp</h2>
						<p className="mt-0.5 text-sm text-muted-foreground">Nomor WhatsApp yang terhubung ke akun kamu.</p>
					</div>
				</header>

				{waLoading ? (
					<div className="flex items-center gap-3 px-5 py-6 text-sm text-muted-foreground">
						<LoaderCircle size={16} className="animate-spin" /> Memuat sesi…
					</div>
				) : waError ? (
					<div className="flex items-center gap-2 px-5 py-6 text-sm text-destructive">
						<AlertCircle size={16} /> {waError}
					</div>
				) : !waSession ? (
					<div className="px-5 py-6 text-sm text-muted-foreground">
						Belum ada nomor WhatsApp yang dipasangkan ke akun ini.
					</div>
				) : (
					<div className="divide-y divide-border/70 px-5 py-4">
						<div className="flex items-center justify-between py-3">
							<span className="text-sm text-muted-foreground">Nomor</span>
							<span className="text-sm font-semibold">{waSession.phoneNumber || '-'}</span>
						</div>
						<div className="flex items-center justify-between py-3">
							<span className="text-sm text-muted-foreground">Status</span>
							<span className={cn('text-sm font-semibold', statusColor(waSession.status))}>{statusLabel(waSession.status)}</span>
						</div>
						<div className="flex items-center justify-between py-3">
							<span className="text-sm text-muted-foreground">Dipasangkan sejak</span>
							<span className="text-sm font-semibold">{formatDate(waSession.pairedSince)}</span>
						</div>
						<div className="flex items-center justify-between py-3">
							<span className="text-sm text-muted-foreground">Durasi</span>
							<span className="text-sm font-semibold">{formatDuration(waSession.durationSeconds)}</span>
						</div>
						<div className="flex items-center justify-between py-3">
							<span className="text-sm text-muted-foreground">Terakhir tersambung</span>
							<span className="text-sm font-semibold">{formatDate(waSession.lastConnectedAt)}</span>
						</div>
					</div>
				)}

				<footer className="flex flex-col gap-3 border-t border-border bg-muted/20 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
					<div className="min-h-5 text-xs">
						{waError ? <span className="text-destructive">{waError}</span> : null}
						{waNotice ? <span className="inline-flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400"><Check size={13} /> {waNotice}</span> : null}
					</div>
					{waSession && (
						<button type="button" disabled={waDisconnecting} onClick={() => void disconnectWa()} className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-destructive bg-destructive/10 px-4 text-sm font-semibold text-destructive transition hover:bg-destructive/20 disabled:opacity-50">
							{waDisconnecting ? <LoaderCircle size={14} className="animate-spin" /> : <LogOut size={14} />} Putuskan sesi
						</button>
					)}
				</footer>
			</section>
		</div>
	)
}
