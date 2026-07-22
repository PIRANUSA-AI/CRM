import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { AlertTriangle, Check, LoaderCircle, LogOut, RefreshCw, ShieldCheck, Smartphone } from 'lucide-react'
import QRCodeStyling from 'qr-code-styling'
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
	if (typeof window === 'undefined' || !navigator) return false
	try {
		const ua = navigator.userAgent || ''
		return /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|iPad/i.test(ua)
			|| (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))
	} catch { return false }
}

function getConnectionIssue(connection: PersonalWhatsAppConnection | null) {
	if (!connection || connection.isConnected || connection.qrCode) return null

	if (connection.status === 'rate_limited') {
		return {
			title: 'WhatsApp perlu dihubungkan ulang',
			description: 'Perangkat CRM ini sudah dihapus dari WhatsApp. Hubungkan ulang untuk mendapatkan QR baru.',
			action: true,
		}
	}

	if (connection.status === 'not_paired' && connection.lastError) {
		return {
			title: 'QR sebelumnya sudah kedaluwarsa',
			description: 'Minta QR baru, lalu tautkan perangkat CRM dari menu Perangkat tertaut di WhatsApp.',
			action: true,
		}
	}

	if (connection.status === 'reconnecting' || connection.status === 'restarting') {
		return {
			title: 'Koneksi sedang dipulihkan',
			description: 'WhatsApp sedang mencoba menyambungkan kembali perangkat ini. Biasanya hanya perlu beberapa saat.',
			action: false,
		}
	}

	if (connection.status === 'disconnected' || connection.status === 'error') {
		return {
			title: 'WhatsApp terputus',
			description: 'Hubungkan ulang perangkat WhatsApp kamu untuk melanjutkan.',
			action: true,
		}
	}

	return null
}

function WhatsAppConnectPage() {
	const navigate = useNavigate()
	const [connection, setConnection] = useState<PersonalWhatsAppConnection | null>(null)
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
	const firstName = useMemo(storedFirstName, [])
	const [mobile, setMobile] = useState(false)
	const [starting, setStarting] = useState(false)
	useEffect(() => {
		const check = () => { try { setMobile(isMobile()) } catch {} }
		check()
		window.addEventListener('resize', check)
		return () => window.removeEventListener('resize', check)
	}, [])
	const [forceQr, setForceQr] = useState(false)

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

	useEffect(() => { void refresh().then((value) => { if (!value?.channelId) void refresh(true) }) }, [refresh])

	useEffect(() => {
		if (!connection || connection.isConnected) return
		const timer = window.setInterval(() => {
			void refresh().then((value) => {
				if (!value?.channelId) {
					void refresh(true)
				}
			})
		}, 15_000)
		return () => window.clearInterval(timer)
	}, [connection?.isConnected, connection?.status, refresh])

	useEffect(() => {
		if (!connection?.qrCode) { setQrImage(null); return }
		let active = true
		const qr = new QRCodeStyling({
			width: 340,
			height: 340,
			data: connection.qrCode,
			margin: 8,
			image: '/favicon.svg',
			dotsOptions: {
				type: 'rounded',
				color: '#102a4c',
				roundSize: true,
			},
			cornersSquareOptions: {
				type: 'extra-rounded',
				color: '#17365f',
			},
			cornersDotOptions: {
				type: 'dot',
				color: '#315d91',
			},
			backgroundOptions: {
				color: 'transparent',
			},
		})
		void qr.getRawData('png').then((blob) => {
			if (!active || !blob) return
			const url = URL.createObjectURL(blob)
			setQrImage(url)
		})
		return () => { active = false }
	}, [connection?.qrCode])



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

	const connectionIssue = getConnectionIssue(connection)

	const confirmPresence = async () => {
		setStarting(true)
		try {
			await refresh(true)
		} finally {
			setStarting(false)
		}
	}

	return (
		<main className="flex min-h-dvh items-center justify-center bg-[#f7f3e9] px-4 py-8 text-[#142942] md:px-5 md:py-10">
			<button type="button" onClick={() => void logout()} className="absolute right-3 top-3 inline-flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-sm font-medium text-[#52657b] hover:bg-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#315d91] md:right-5 md:top-5">
				<LogOut className="h-4 w-4" /> Keluar
			</button>
			<section className="w-full max-w-[420px] px-0 text-center md:px-4" aria-live="polite">
				{connection?.isConnected ? (
					<>
						<div className="mx-auto mb-5 grid h-24 w-24 place-items-center rounded-full bg-emerald-100 text-emerald-700 md:h-28 md:w-28"><Check className="h-10 w-10 md:h-12 md:w-12" strokeWidth={2.4} /></div>
						<h1 className="text-balance font-[family-name:var(--font-display)] text-2xl font-medium tracking-[-0.02em] text-[#102a4c] md:text-4xl md:tracking-[-0.03em]">
							{previouslyConnected.current ? `Hai lagi${firstName ? `, ${firstName}` : ''}!` : `Halo${firstName ? `, ${firstName}` : ''}! Selamat bekerja.`}
						</h1>
						<p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#5b6b7d] md:mt-3 md:text-[15px]">WhatsApp kamu sudah siap. Kita ke kotak masuk dalam {countdown} detik.</p>
						<Button onClick={() => void navigate({ to: '/chat', replace: true })} className="mt-6 h-11 rounded-xl bg-[#17365f] px-6 hover:bg-[#102a4c] md:mt-7">Buka kotak masuk</Button>
					</>
				) : (
					<>
						<h1 className="text-balance px-2 font-[family-name:var(--font-display)] text-[28px] font-medium leading-tight tracking-[-0.02em] text-[#102a4c] md:px-0 md:text-[40px] md:tracking-[-0.03em]">Hubungkan WhatsApp kamu</h1>
						<p className="mx-auto mt-2 max-w-xs text-sm leading-6 text-[#5b6b7d] md:mt-3 md:max-w-sm md:text-[15px]">
							Scan QR ini dengan WhatsApp kamu.
						</p>

						<div className="mx-auto mt-6 w-full max-w-[340px] rounded-2xl bg-white px-5 py-8 shadow-[0_4px_16px_rgba(16,42,76,0.08)] md:mt-8 md:min-h-[320px] md:px-6 md:py-10">
							{connectionIssue ? (
								<div className="flex min-h-[240px] flex-col items-center justify-center text-center">
									<div className="grid h-12 w-12 place-items-center rounded-full bg-amber-50 text-amber-700 md:h-14 md:w-14">
										<AlertTriangle className="h-6 w-6 md:h-7 md:w-7" />
									</div>
									<p className="mt-4 text-sm font-semibold text-[#102a4c] md:text-base">{connectionIssue.title}</p>
									<p className="mt-2 max-w-[270px] text-xs leading-5 text-[#657487] md:text-sm">{connectionIssue.description}</p>
									{connectionIssue.action ? (
										<Button onClick={() => void confirmPresence()} disabled={starting} className="mt-5 h-10 rounded-xl bg-[#17365f] px-5 hover:bg-[#102a4c]">
											{starting ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin motion-reduce:animate-none" /> : <RefreshCw className="mr-2 h-4 w-4" />}
											{starting ? 'Menyiapkan QR...' : 'Hubungkan ulang'}
										</Button>
									) : null}
								</div>
							) : qrImage ? (
								<img src={qrImage} alt="QR untuk menghubungkan WhatsApp" className="mx-auto h-auto w-full max-w-[300px] md:max-w-[340px]" />
							) : mobile && !forceQr ? (
								<div className="w-full text-center">
									<div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef2f7] text-[#315d91] md:h-14 md:w-14">
										<Smartphone className="h-6 w-6 md:h-7 md:w-7" />
									</div>
									<p className="mt-4 text-sm font-medium text-[#102a4c] md:text-base">Gunakan laptop untuk scan QR</p>
									<p className="mt-2 text-xs leading-5 text-[#657487]">Scan QR ini hanya bisa dilakukan dari laptop atau komputer desktop.</p>
									<Button onClick={() => setForceQr(true)} className="mt-5 h-10 rounded-xl bg-[#17365f] px-5 hover:bg-[#102a4c]">Paksa Login (Tampilkan QR)</Button>
								</div>
							) : (
								<div className="flex flex-col items-center gap-3">
									<LoaderCircle className="h-7 w-7 animate-spin text-[#315d91] motion-reduce:animate-none md:h-8 md:w-8" />
									<p className="text-xs text-[#657487]">Menyiapkan koneksi...</p>
								</div>
							)}
						</div>

						{!mobile || forceQr ? (
							<p className="mt-4 text-xs text-[#52657b] md:mt-5 md:text-sm">WhatsApp - Perangkat tertaut - Tautkan perangkat</p>
						) : null}
						{error ? <p className="mx-auto mt-4 max-w-xs rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700 md:max-w-sm md:text-sm">{error}</p> : null}
						<p className="mt-6 inline-flex items-center gap-1.5 text-xs text-[#657487] md:mt-8"><ShieldCheck className="h-3.5 w-3.5" /> Hanya untuk akun CRM kamu</p>
					</>
				)}
			</section>
		</main>
	)
}
