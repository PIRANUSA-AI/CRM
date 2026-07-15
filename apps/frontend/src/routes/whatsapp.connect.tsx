import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { Check, Copy, LoaderCircle, LogOut, Phone, ShieldCheck, Smartphone } from 'lucide-react'
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
	if (typeof window === 'undefined' || !navigator) return false
	try {
		const ua = navigator.userAgent || ''
		return /Android|iPhone|iPod|webOS|BlackBerry|IEMobile|Opera Mini|iPad/i.test(ua)
			|| (navigator.maxTouchPoints > 1 && /Macintosh/i.test(ua))
	} catch { return false }
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
	const [mobile, setMobile] = useState(false)
	useEffect(() => {
		const check = () => { try { setMobile(isMobile()) } catch {} }
		check()
		window.addEventListener('resize', check)
		return () => window.removeEventListener('resize', check)
	}, [])
	const [phoneInput, setPhoneInput] = useState('')
	const [savingPhone, setSavingPhone] = useState(false)
	const [phoneSubmitted, setPhoneSubmitted] = useState(false)
	useEffect(() => { if (connection?.pairingCode) setPhoneSubmitted(false) }, [connection?.pairingCode])

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
		if (!connection || connection.isConnected || waitingForPresence) return
		const timer = window.setInterval(() => {
			void refresh().then((value) => {
				if (!value?.channelId) {
					void refresh(true)
				}
			})
		}, 15_000)
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

	const submitPhone = async () => {
		const digits = phoneInput.replace(/\D/g, '')
		if (digits.length < 10) return
		setSavingPhone(true)
		setPhoneSubmitted(true)
		try {
			await whatsappChannels.startMyConnection(digits)
			setPhoneInput('')
			await refresh()
		} catch (e: any) {
			setError(e?.message || 'Gagal menyimpan nomor')
		}
		setSavingPhone(false)
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
							{connection?.pairingCode
								? 'Masukkan kode ini di WhatsApp kamu.'
								: mobile
									? 'Masukkan nomor WhatsApp kamu untuk mendapat kode pairing.'
									: 'Scan QR ini dengan WhatsApp kamu.'}
						</p>

						<div className="mx-auto mt-6 w-full max-w-[340px] rounded-2xl bg-white px-5 py-8 shadow-[0_4px_16px_rgba(16,42,76,0.08)] md:mt-8 md:min-h-[320px] md:px-6 md:py-10">
							{waitingForPresence ? (
								<div className="mx-auto max-w-[240px]">
									<p className="text-lg font-semibold text-[#102a4c] md:text-xl">Hei, masih di sana?</p>
									<p className="mt-2 text-xs leading-5 text-[#5b6b7d] md:text-sm">Kami berhenti membuat kode pairing supaya halaman ini tidak terus bekerja saat kamu sedang pergi.</p>
									<Button onClick={confirmPresence} className="mt-5 h-10 rounded-xl bg-[#17365f] px-5 hover:bg-[#102a4c]">Ya, buat kode baru</Button>
								</div>
							) : connection?.pairingCode ? (
								<div className="w-full text-center">
									<div className="flex items-center justify-center gap-1.5 text-xs font-medium text-[#52657b] md:gap-2 md:text-sm">
										<Smartphone className="h-3.5 w-3.5 md:h-4 md:w-4" />
										Kode pairing
									</div>
									<div className="mx-auto mt-3 max-w-[280px] select-all rounded-xl bg-[#f0f4fa] px-4 py-4 text-center font-mono text-2xl font-bold tracking-[0.12em] text-[#102a4c] md:mt-4 md:py-5 md:text-3xl md:tracking-[0.15em]">
										{formatPairingCode(connection.pairingCode)}
									</div>
									<button
										type="button"
										onClick={copyCode}
										className="mt-2 inline-flex items-center gap-1.5 text-xs text-[#315d91] hover:text-[#102a4c] md:mt-3 md:text-sm"
									>
										<Copy className="h-3 w-3 md:h-3.5 md:w-3.5" />
										{copied ? 'Tersalin!' : 'Salin kode'}
									</button>
									<div className="mt-4 space-y-1 text-left text-xs leading-5 text-[#657487] md:mt-5">
										<p>1. Buka WhatsApp di HP</p>
										<p>2. Titik tiga → Perangkat tertaut</p>
										<p>3. Tautkan perangkat → Tautkan dengan nomor telepon</p>
										<p>4. Masukkan kode di atas</p>
									</div>
								</div>
							) : mobile && !phoneSubmitted ? (
								<div className="w-full text-center">
									<div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-[#eef2f7] text-[#315d91] md:h-14 md:w-14">
										<Phone className="h-6 w-6 md:h-7 md:w-7" />
									</div>
									<p className="mt-4 text-sm font-medium text-[#102a4c] md:text-base">Nomor WhatsApp kamu</p>
									<div className="mx-auto mt-4 flex max-w-full gap-2">
										<input
											type="tel"
											inputMode="numeric"
											placeholder="6281234567890"
											value={phoneInput}
											onChange={e => setPhoneInput(e.target.value)}
											onKeyDown={e => e.key === 'Enter' && !savingPhone && submitPhone()}
											className="min-w-0 flex-1 rounded-xl border border-[#d0d7e2] px-3 py-2.5 text-center text-sm text-[#102a4c] outline-none transition-colors placeholder:text-[#b0b9c7] focus:border-[#315d91]"
										/>
										<Button onClick={submitPhone} disabled={savingPhone || phoneInput.replace(/\D/g, '').length < 10} className="h-10 shrink-0 rounded-xl bg-[#17365f] px-4 hover:bg-[#102a4c] disabled:opacity-50">
											{savingPhone ? <LoaderCircle className="h-4 w-4 animate-spin" /> : 'Simpan'}
										</Button>
									</div>
									<p className="mt-3 text-xs text-[#657487]">Pakai format internasional, tanpa + atau 0 di depan</p>
								</div>
							) : qrImage ? (
								<img src={qrImage} alt="QR untuk menghubungkan WhatsApp" className="h-auto w-full max-w-[260px] md:max-w-[288px]" />
							) : (
								<div className="flex flex-col items-center gap-3">
									<LoaderCircle className="h-7 w-7 animate-spin text-[#315d91] motion-reduce:animate-none md:h-8 md:w-8" />
									<p className="text-xs text-[#657487]">Menyiapkan koneksi...</p>
								</div>
							)}
						</div>

						{!connection?.pairingCode && !mobile && !phoneSubmitted ? (
							<p className="mt-4 text-xs text-[#52657b] md:mt-5 md:text-sm">WhatsApp → Perangkat tertaut → Tautkan perangkat</p>
						) : null}
						{error ? <p className="mx-auto mt-4 max-w-xs rounded-xl bg-red-50 px-4 py-3 text-xs text-red-700 md:max-w-sm md:text-sm">{error}</p> : null}
						{!waitingForPresence && !connection?.pairingCode && !mobile ? <p className="mt-4 text-xs text-[#657487] md:mt-5">Sesi pairing aktif {Math.floor(pairingRemaining / 60)}:{String(pairingRemaining % 60).padStart(2, '0')}</p> : null}
						<p className="mt-6 inline-flex items-center gap-1.5 text-xs text-[#657487] md:mt-8"><ShieldCheck className="h-3.5 w-3.5" /> Hanya untuk akun CRM kamu</p>
					</>
				)}
			</section>
		</main>
	)
}
