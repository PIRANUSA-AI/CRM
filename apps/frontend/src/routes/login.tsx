import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import {
	ArrowRight,
	CheckCircle2,
	Clock3,
	Eye,
	EyeOff,
	Inbox,
	TrendingUp,
	Users,
} from 'lucide-react'
import { useState } from 'react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { syncOrganizationContextFromSession } from '@/lib/organization'

export const Route = createFileRoute('/login')({ component: LoginPage })

const AUTH_BASE = import.meta.env.VITE_API_URL
	? `${import.meta.env.VITE_API_URL}/auth`
	: 'http://localhost:3010/auth'

const conversations = [
	{ name: 'Nadia Putri', text: 'Pesanan sudah saya terima, terima kasih.', time: '09.42', active: true },
	{ name: 'Rizky Ananda', text: 'Boleh dibantu cek status pengiriman?', time: '09.35' },
	{ name: 'Sari Utami', text: 'Saya tertarik dengan paket bisnis.', time: '09.18' },
]

function WorkspacePreview() {
	return (
		<div className="relative mx-auto w-full max-w-[620px]" aria-hidden="true">
			<div className="overflow-hidden rounded-2xl bg-[#f8f5ed] shadow-[0_8px_24px_rgba(4,17,38,0.28)]">
				<div className="flex h-11 items-center justify-between bg-white px-4">
					<div className="flex items-center gap-2">
						<span className="h-2 w-2 rounded-full bg-[#18365f]" />
						<span className="text-[10px] font-semibold text-[#18365f]">Ruang kerja hari ini</span>
					</div>
					<span className="rounded-full bg-[#edf2f8] px-2 py-1 text-[9px] font-medium text-[#4d627d]">12 anggota aktif</span>
				</div>

				<div className="grid grid-cols-[1.25fr_0.75fr] gap-3 p-3">
					<div className="rounded-xl bg-white p-3">
						<div className="mb-3 flex items-center justify-between">
							<div className="flex items-center gap-2">
								<Inbox className="h-3.5 w-3.5 text-[#234f86]" />
								<span className="text-[10px] font-semibold text-[#142942]">Kotak masuk</span>
							</div>
							<span className="text-[9px] text-[#6a7888]">24 belum dibaca</span>
						</div>
						<div className="space-y-1.5">
							{conversations.map((conversation) => (
								<div key={conversation.name} className="flex items-center gap-2 rounded-lg bg-[#faf9f5] px-2.5 py-2">
									<div className={`h-6 w-6 shrink-0 rounded-full ${conversation.active ? 'bg-[#d7e4f3]' : 'bg-[#ebe8df]'}`} />
									<div className="min-w-0 flex-1">
										<div className="flex justify-between gap-2">
											<span className="truncate text-[9px] font-semibold text-[#142942]">{conversation.name}</span>
											<span className="text-[8px] text-[#7b8794]">{conversation.time}</span>
										</div>
										<p className="truncate text-[8px] text-[#667586]">{conversation.text}</p>
									</div>
								</div>
							))}
						</div>
					</div>

					<div className="space-y-3">
						<div className="rounded-xl bg-[#17365f] p-3 text-white">
							<div className="flex items-center justify-between">
								<span className="text-[9px] text-[#c7d5e7]">Peluang bulan ini</span>
								<TrendingUp className="h-3.5 w-3.5 text-[#a9c9ee]" />
							</div>
							<p className="mt-2 text-xl font-semibold tracking-[-0.02em]">Rp184 jt</p>
							<p className="mt-1 text-[8px] text-[#b8c9dc]">Naik 18% dari bulan lalu</p>
						</div>
						<div className="rounded-xl bg-white p-3">
							<div className="mb-2 flex items-center gap-2">
								<Users className="h-3.5 w-3.5 text-[#234f86]" />
								<span className="text-[9px] font-semibold text-[#142942]">Aktivitas tim</span>
							</div>
							<div className="space-y-2 text-[8px] text-[#657486]">
								<p className="flex items-center gap-1.5"><CheckCircle2 className="h-3 w-3 text-emerald-600" /> 18 percakapan selesai</p>
								<p className="flex items-center gap-1.5"><Clock3 className="h-3 w-3 text-amber-600" /> Respons rata-rata 3 menit</p>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}

function LoginPage() {
	const navigate = useNavigate()
	const [email, setEmail] = useState('')
	const [password, setPassword] = useState('')
	const [showPassword, setShowPassword] = useState(false)
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const handleLogin = async (event: React.FormEvent) => {
		event.preventDefault()
		setLoading(true)
		setError('')

		try {
			const response = await fetch(`${AUTH_BASE}/sign-in/email`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				credentials: 'include',
				body: JSON.stringify({ email, password }),
			})

			if (!response.ok) {
				const errorData = await response.json().catch(() => ({}))
				throw new Error(errorData.error || errorData.message || 'Email atau kata sandi tidak sesuai.')
			}

			const data = await response.json()
			if (data?.token) localStorage.setItem('scalechat_token', data.token)
			localStorage.setItem('scalechat_user', JSON.stringify(data.user))

			try {
				const context = await syncOrganizationContextFromSession()
				await navigate({
					to: context.onboardingRequired || !context.organization ? '/onboarding' : '/whatsapp/connect',
					replace: true,
				})
			} catch {
			await navigate({ to: '/whatsapp/connect', replace: true })
			}
		} catch (loginError) {
			setError(loginError instanceof Error ? loginError.message : 'Tidak dapat masuk. Silakan coba lagi.')
		} finally {
			setLoading(false)
		}
	}

	return (
		<main className="min-h-svh bg-[#f7f3e9] text-[#142942] lg:grid lg:grid-cols-[minmax(0,1.08fr)_minmax(460px,0.92fr)]">
			<section className="relative hidden min-h-svh overflow-hidden bg-[#102a4c] px-12 py-10 text-white lg:flex lg:flex-col xl:px-16 xl:py-12">
				<div className="absolute left-[8%] top-[14%] h-48 w-48 rounded-full bg-[#315d91]/30 blur-3xl" />
				<div className="relative z-10 text-[15px] font-semibold tracking-[-0.01em]">CRM</div>

				<div className="relative z-10 my-auto py-12">
					<div className="mb-9 max-w-xl">
						<h1 className="text-balance font-[family-name:var(--font-display)] text-5xl font-medium leading-[1.04] tracking-[-0.03em] xl:text-[58px]">
							Satu ruang kerja untuk seluruh percakapan pelanggan.
						</h1>
						<p className="mt-5 max-w-lg text-[15px] leading-7 text-[#c8d5e5]">
							Pantau percakapan, koordinasikan tim, dan gerakkan setiap peluang tanpa kehilangan konteks.
						</p>
					</div>
					<WorkspacePreview />
				</div>

				<p className="relative z-10 text-xs text-[#91a7c1]">© {new Date().getFullYear()} CRM. Ruang kerja pelanggan untuk tim Anda.</p>
			</section>

			<section className="flex min-h-svh items-center justify-center px-6 py-10 sm:px-10 lg:px-14">
				<div className="w-full max-w-[410px]">
					<div className="mb-14 text-sm font-semibold tracking-[-0.01em] text-[#17365f] lg:hidden">CRM</div>
					<div className="mb-9">
						<p className="mb-3 text-sm font-semibold text-[#315d91]">Selamat datang kembali</p>
						<h2 className="text-balance font-[family-name:var(--font-display)] text-[42px] font-medium leading-[1.04] tracking-[-0.03em] text-[#102a4c]">Masuk ke ruang kerja Anda</h2>
						<p className="mt-4 text-[15px] leading-6 text-[#58697c]">Gunakan email kerja dan kata sandi untuk melanjutkan.</p>
					</div>

					<form onSubmit={handleLogin} className="space-y-5" data-auth-content="true">
						<div className="space-y-2">
							<label htmlFor="email" className="text-sm font-medium text-[#283d55]">Alamat email</label>
							<Input id="email" type="email" autoComplete="email" placeholder="nama@perusahaan.com" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus className="h-12 rounded-xl border-[#d8d3c8] bg-white px-4 text-[15px] text-[#142942] placeholder:text-[#697789] focus-visible:border-[#315d91] focus-visible:ring-4 focus-visible:ring-[#315d91]/10" />
						</div>

						<div className="space-y-2">
							<div className="flex items-center justify-between gap-4">
								<label htmlFor="password" className="text-sm font-medium text-[#283d55]">Kata sandi</label>
								<span className="text-xs text-[#637387]">Hubungi admin untuk mengatur ulang</span>
							</div>
							<div className="relative">
								<Input id="password" type={showPassword ? 'text' : 'password'} autoComplete="current-password" placeholder="Masukkan kata sandi" value={password} onChange={(event) => setPassword(event.target.value)} required className="h-12 rounded-xl border-[#d8d3c8] bg-white px-4 pr-12 text-[15px] text-[#142942] placeholder:text-[#697789] focus-visible:border-[#315d91] focus-visible:ring-4 focus-visible:ring-[#315d91]/10" />
								<button type="button" onClick={() => setShowPassword((visible) => !visible)} className="absolute inset-y-0 right-0 flex w-12 items-center justify-center text-[#637387] transition-colors duration-200 hover:text-[#17365f] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#315d91]" aria-label={showPassword ? 'Sembunyikan kata sandi' : 'Tampilkan kata sandi'}>
									{showPassword ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
								</button>
							</div>
						</div>

						{error && <Alert variant="destructive" className="rounded-xl"><AlertDescription>{error}</AlertDescription></Alert>}

						<Button type="submit" disabled={loading} size="lg" className="group h-12 w-full rounded-xl bg-[#17365f] text-[15px] font-semibold text-white transition-colors duration-200 hover:bg-[#102a4c] focus-visible:ring-[#315d91]">
							{loading ? 'Sedang masuk…' : 'Masuk ke ruang kerja'}
							{!loading && <ArrowRight className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />}
						</Button>
					</form>

					<p className="mt-10 text-center text-xs leading-5 text-[#657487]">
						Dengan melanjutkan, Anda menyetujui <Link to="/terms" className="font-medium text-[#314b68] underline-offset-4 hover:underline">Ketentuan Layanan</Link> dan <Link to="/privacy" className="font-medium text-[#314b68] underline-offset-4 hover:underline">Kebijakan Privasi</Link>.
					</p>
				</div>
			</section>
		</main>
	)
}
