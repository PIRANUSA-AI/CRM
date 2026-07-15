import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Copy, LoaderCircle, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import QRCode from 'qrcode'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { whatsappChannels, type PersonalWhatsAppConnection } from '@/lib/api'
import {
	extractNormalizedRole,
	getAllowedPrimaryPathsForRole,
} from '@/lib/role-access'

export const Route = createFileRoute('/whatsapp/connect')({ component: WhatsAppConnectPage })

function storedFirstName() {
	try {
		const raw = localStorage.getItem('crm_user')
		const parsed = raw ? JSON.parse(raw) : null
		const name = String(parsed?.name || parsed?.user?.name || '').trim()
		return name.split(/\s+/)[0] || ''
	} catch { return '' }
}

function isMobile() {
	if (typeof window === 'undefined') return false
	return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

function formatPairingCode(code: string) {
	return code?.match(/.{1,4}/g)?.join('-') ?? code
}

function WhatsAppConnectPage() {
	const navigate = useNavigate()
	const [connection, setConnection] = useState<PersonalWhatsAppConnection | null>(null)
	const [copied, setCopied] = useState(false)

	useEffect(() => {
		try {
			const raw = localStorage.getItem('crm_user')
			if (!raw) return
			const role = extractNormalizedRole(JSON.parse(raw))
			if (!['sales', 'agent'].includes(role)) {
				const allowedPaths = getAllowedPrimaryPathsForRole(role)
				void navigate({ to: allowedPaths?.[0] || '/dashboard', replace: true })
			}
		} catch {}
	}, [navigate])
	const [qrImage, setQrImage] = useState<string | null>(null)
	const [error, setError] = useState('')
	const [countdown, setCountdown] = useState(10)
	const previouslyConnected = useRef<boolean | null>(null)
	const [pairingRemaining, setPairingRemaining] = useState(300)
	const [waitingForPresence, setWaitingForPresence] = useState(false)
	const firstName = useMemo(storedFirstName, [])
	const mobile = useMemo(isMobile, [])

	const refresh = useCallback(async (start = false) => {
		try {
			setError('')
			const response = start
				? await whatsappChannels.startMyConnection()
				: await whatsappChannels.getMyConnection()
			if (!start && previouslyConnected.current === null) previouslyConnected.current = response.data.hasConnectedBefore
			setConnection(response.data)
			return response.data
		} catch (requestError) {
			setError(requestError instanceof Error ? requestError.message : 'WhatsApp belum bisa dihubungkan. Coba lagi sebentar, ya.')
			return null
		}
	}, [])

	useEffect(() => { void refresh().then((value) => { if (value?.requiresPairing && value.status === 'not_paired') void refresh(true) }) }, [refresh])

	useEffect(() => {
		if (!connection || connection.isConnected || waitingForPresence) return
		const timer = window.setInterval(() => {
			void refresh().then((value) => {
				if (value?.requiresPairing && value.status === 'not_paired') {
					void refresh(true)
				}
			})
		}, 2500)
		return () => window.clearInterval(timer)
	}, [connection?.isConnected, connection?.status, refresh, waitingForPresence])

	useEffect(() => {
		if (!connection?.qrCode) { setQrImage(null); return }
		let active = true
		void QRCode.toDataURL(connection.qrCode, { width: 288, margin: 2, color: { dark: '#102a4c', light: '#ffffff' } })
			.then((url: string) => { if (active) setQrImage(url) })
		return () => { active = false }
	}, [connection?.qrCode])

	useEffect(() => {
		if (connection?.isConnected || waitingForPresence) return
		const timer = window.setInterval(() => {
			setPairingRemaining((current) => {
				if (current > 1) return current - 1
				window.clearInterval(timer)
				setWaitingForPresence(true)
				setQrImage(null)
				return 0
			})
		}, 1000)
		return () => window.clearInterval(timer)
	}, [connection?.isConnected, waitingForPresence])

	useEffect(() => {
		if (!connection?.isConnected) { setCountdown(10); return }
		const timer = window.setInterval(() => setCountdown((value) => {
			if (value <= 1) { window.clearInterval(timer); void navigate({ to: '/chat', replace: true }); return 0 }
			return value - 1
		}), 1000)
		return () => window.clearInterval(timer)
	}, [connection?.isConnected, navigate])

	const logout = async () => {
		await fetch(`${import.meta.env.VITE_API_URL || 'http://localhost:3010'}/auth/sign-out`, { method: 'POST', credentials: 'include' }).catch(() => null)
		localStorage.removeItem('crm_token'); localStorage.removeItem('crm_user')
		void navigate({ to: '/login', replace: true })
	}

	const confirmPresence = () => {
		setWaitingForPresence(false)
		setPairingRemaining(300)
		void refresh(true)
	}

	const copyCode = async () => {
		if (!connection?.pairingCode) return
		try {
			await navigator.clipboard.writeText(connection.pairingCode)
			setCopied(true)
			setTimeout(() => setCopied(false), 2000)
		} catch {}
	}

	return (
		<main className="flex min-h-svh items-center justify-center bg-[#f7f3e9] px-5 py-10 text-[#142942]">
			<button type="button" onClick={() => void logout()} className="absolute right-5 top-5 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-[#52657b] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315d91]">
				<LogOut className="h-4 w-4" /> Keluar
			</button>
			<section className="w-full max-w-[460px] text-center" aria-live="polite">
				{connection?.isConnected ? (
					<>
						<div className="mx-auto mb-6 grid h-28 w-28 place-items-center rounded-full bg-emerald-100 text-emerald-700"><Check className="h-12 w-12" strokeWidth={2.4} /></div>
						<h1 className="text-balance font-[family-name:var(--font-display)] text-4xl font-medium tracking-[-0.03em] text-[#102a4c]">
							{previouslyConnected.current ? `Hai lagi${firstName ? `, ${firstName}` : ''}!` : `Halo${firstName ? `, ${firstName}` : ''}! Selamat bekerja.`}
						</h1>
						<p className="mt-3 text-[15px] leading-6 text-[#5b6b7d]">WhatsApp kamu sudah siap. Kita ke kotak masuk dalam {countdown} detik.</p>
						<Button onClick={() => void navigate({ to: '/chat', replace: true })} className="mt-7 h-11 rounded-xl bg-[#17365f] px-6 hover:bg-[#102a4c]">Buka kotak masuk</Button>
					</>
				) : (
					<>
						<h1 className="text-balance font-[family-name:var(--font-display)] text-[40px] font-medium leading-tight tracking-[-0.03em] text-[#102a4c]">Hubungkan WhatsApp kamu</h1>
						<p className="mx-auto mt-3 max-w-sm text-[15px] leading-6 text-[#5b6b7d]">
							{connection?.pairingCode
								? 'Masukkan kode ini di WhatsApp kamu.'
								: 'Scan QR ini dengan WhatsApp kamu.'}
						</p>

						{/* Pairing code */}
						{connection?.pairingCode ? (
							<div className="mx-auto mt-8 w-full max-w-[340px] rounded-2xl bg-white p-6 shadow-[0_8px_24px_rgba(16,42,76,0.10)]">
								<div className="flex items-center justify-center gap-2 text-sm font-medium text-[#52657b]">
									<Smartphone className="h-4 w-4" />
									Kode pairing
								</div>
								<div className="mt-4 select-all rounded-xl bg-[#f0f4fa] px-4 py-5 text-center font-mono text-3xl font-bold tracking-[0.15em] text-[#102a4c]">
									{formatPairingCode(connection.pairingCode)}
								</div>
								<button
									type="button"
									onClick={copyCode}
									className="mt-3 inline-flex items-center gap-1.5 text-sm text-[#315d91] hover:text-[#102a4c]"
								>
									<Copy className="h-3.5 w-3.5" />
									{copied ? 'Tersalin!' : 'Salin kode'}
								</button>
								<p className="mt-3 text-xs leading-5 text-[#657487]">
									Buka WhatsApp di HP → titik tiga → Perangkat tertaut → Tautkan perangkat → Tautkan dengan nomor telepon → masukkan kode ini
								</p>
							</div>
						) : null}

						{/* QR code - hidden di mobile */}
						{!mobile && !connection?.pairingCode ? (
							<div className="mx-auto mt-8 flex min-h-[320px] w-full max-w-[340px] items-center justify-center rounded-2xl bg-white p-6 shadow-[0_8px_24px_rgba(16,42,76,0.10)]">
								{waitingForPresence ? (
									<div className="max-w-[250px]">
										<p className="text-xl font-semibold text-[#102a4c]">Hei, masih di sana?</p>
										<p className="mt-2 text-sm leading-6 text-[#5b6b7d]">Kami berhenti membuat QR baru supaya halaman ini tidak terus bekerja saat kamu sedang pergi.</p>
										<Button onClick={confirmPresence} className="mt-5 h-10 rounded-xl bg-[#17365f] px-5 hover:bg-[#102a4c]">Ya, buat QR baru</Button>
									</div>
								) : qrImage ? <img src={qrImage} alt="QR untuk menghubungkan WhatsApp" className="h-auto w-full max-w-[288px]" /> : <LoaderCircle className="h-8 w-8 animate-spin text-[#315d91] motion-reduce:animate-none" aria-label="Menyiapkan QR WhatsApp" />}
							</div>
						) : null}

						{!mobile && !connection?.pairingCode ? (
							<p className="mt-5 text-sm text-[#52657b]">WhatsApp → Perangkat tertaut → Tautkan perangkat</p>
						) : null}
						{error ? <p className="mx-auto mt-4 max-w-sm rounded-xl bg-red-50 px-4 py-3 text-sm text-red-700">{error}</p> : null}
						{!waitingForPresence && !connection?.pairingCode ? <p className="mt-5 text-xs text-[#657487]">Sesi pairing aktif selama {Math.floor(pairingRemaining / 60)}:{String(pairingRemaining % 60).padStart(2, '0')}. QR akan mengikuti pembaruan aman dari WhatsApp.</p> : null}
						<p className="mt-8 inline-flex items-center gap-2 text-xs text-[#657487]"><ShieldCheck className="h-4 w-4" /> Session ini hanya untuk akun CRM kamu.</p>
					</>
				)}
			</section>
		</main>
	)
}
