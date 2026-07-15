import { TanStackDevtools } from '@tanstack/react-devtools'
import {
	createRootRoute,
	HeadContent,
	Outlet,
	Scripts,
} from '@tanstack/react-router'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'
import { Wifi, WifiOff } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ThemeProvider } from '@/components/theme-provider'
import { Toaster } from '@/components/ui/sonner'

import '../styles.css'

export const Route = createRootRoute({
	head: () => ({
		meta: [
			{
				charSet: 'utf-8',
			},
			{
				name: 'viewport',
				content: 'width=device-width, initial-scale=1',
			},
			{
				title: 'Internal CRM',
			},
			{
				name: 'description',
				content: 'Internal CRM',
			},
			{
				property: 'og:type',
				content: 'website',
			},
			{
				property: 'og:url',
				content: 'https://app.crm.chat/',
			},
			{
				property: 'og:title',
				content: 'Internal CRM',
			},
			{
				property: 'og:description',
				content: 'Internal CRM',
			},
		],
		links: [{ rel: 'icon', href: '/favicon.svg', type: 'image/svg+xml' }],
	}),
	component: RootComponent,
	notFoundComponent: NotFoundPage,
	shellComponent: RootDocument,
})

function NotFoundPage() {
	return (
		<main className="grid min-h-svh place-items-center bg-background px-6 text-center text-foreground">
			<div>
				<p className="text-sm font-medium text-muted-foreground">Halaman tidak ditemukan</p>
				<h1 className="mt-2 text-3xl font-semibold tracking-tight">Sepertinya kamu tersesat.</h1>
				<a href="/" className="mt-6 inline-flex rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Kembali ke CRM</a>
			</div>
		</main>
	)
}

function RootComponent() {
	return <Outlet />
}

type ConnectionState = 'online' | 'offline' | 'restored'

function ConnectionNotice() {
	const [connection, setConnection] = useState<ConnectionState>('online')

	useEffect(() => {
		let lastOnline = navigator.onLine
		let restoredTimer: number | undefined

		const applyConnection = (online: boolean) => {
			window.clearTimeout(restoredTimer)
			if (!online) {
				lastOnline = false
				setConnection('offline')
				return
			}

			if (!lastOnline) {
				lastOnline = true
				setConnection('restored')
				restoredTimer = window.setTimeout(() => setConnection('online'), 3000)
				return
			}

			setConnection('online')
		}

		const verifyConnection = async () => {
			if (!navigator.onLine) {
				applyConnection(false)
				return
			}

			const controller = new AbortController()
			const timeout = window.setTimeout(() => controller.abort(), 5000)
			try {
				const response = await fetch(`/favicon.svg?connectivity-check=${Date.now()}`, {
					cache: 'no-store',
					signal: controller.signal,
				})
				applyConnection(response.ok)
			} catch {
				applyConnection(false)
			} finally {
				window.clearTimeout(timeout)
			}
		}

		const handleOffline = () => applyConnection(false)
		const handleOnline = () => void verifyConnection()
		const handleVisibility = () => {
			if (document.visibilityState === 'visible') void verifyConnection()
		}

		void verifyConnection()
		const interval = window.setInterval(() => void verifyConnection(), 60_000)
		window.addEventListener('offline', handleOffline)
		window.addEventListener('online', handleOnline)
		document.addEventListener('visibilitychange', handleVisibility)

		return () => {
			window.clearInterval(interval)
			window.clearTimeout(restoredTimer)
			window.removeEventListener('offline', handleOffline)
			window.removeEventListener('online', handleOnline)
			document.removeEventListener('visibilitychange', handleVisibility)
		}
	}, [])

	if (connection === 'online') return null

	const restored = connection === 'restored'
	return (
		<output
			aria-live="polite"
			className={`fixed left-3 right-3 top-3 z-50 mx-auto flex min-h-11 max-w-md items-center gap-3 rounded-xl px-4 py-2.5 text-sm text-white shadow-sm transition duration-300 motion-reduce:transition-none sm:left-1/2 sm:right-auto sm:-translate-x-1/2 ${
				restored ? 'bg-emerald-700' : 'bg-[#142942]'
			}`}
		>
			{restored ? <Wifi className="size-4 shrink-0" /> : <WifiOff className="size-4 shrink-0 text-amber-300" />}
			<div className="min-w-0">
				<p className="font-semibold">{restored ? 'Koneksi kembali' : 'Kamu sedang offline'}</p>
				<p className={`text-xs ${restored ? 'text-emerald-50' : 'text-slate-200'}`}>
					{restored ? 'Data terbaru bisa dimuat lagi.' : 'CRM tetap bisa dibuka, tetapi data baru belum tersedia.'}
				</p>
			</div>
		</output>
	)
}

function RootDocument({ children }: { children: React.ReactNode }) {
	const [mounted, setMounted] = useState(false)
	const shouldShowTanStackDevtools =
		mounted &&
		import.meta.env.DEV &&
		import.meta.env.VITE_SHOW_TANSTACK_DEVTOOLS === 'true'

	useEffect(() => {
		setMounted(true)
	}, [])

	useEffect(() => {
		if (!('serviceWorker' in navigator)) return

		void (async () => {
			const registrations = await navigator.serviceWorker.getRegistrations()
			await Promise.all(
				registrations
					.filter((registration) => new URL(registration.scope).origin === window.location.origin)
					.map((registration) => registration.unregister()),
			)

			if (!('caches' in window)) return
			const cacheNames = await caches.keys()
			await Promise.all(
				cacheNames
					.filter((cacheName) => cacheName.startsWith('crm-shell-'))
					.map((cacheName) => caches.delete(cacheName)),
			)
		})().catch((error) => {
			console.warn('[LegacyCache] Cleanup failed:', error)
		})
	}, [])

	useEffect(() => {
		if (!import.meta.env.DEV || typeof window === 'undefined') return

		const shouldRecoverFromModuleLoadError = (message: string) => {
			return (
				message.includes('Failed to fetch dynamically imported module') ||
				message.includes('Importing a module script failed') ||
				message.includes('Outdated Optimize Dep')
			)
		}

		const tryRecoverByReloading = () => {
			const reloadGuardKey = `crm:vite-reload-recovery:${window.location.pathname}`
			if (sessionStorage.getItem(reloadGuardKey) === '1') return
			sessionStorage.setItem(reloadGuardKey, '1')
			window.location.reload()
		}

		const handleWindowError = (event: ErrorEvent) => {
			const message = String(event.message || '')
			if (!shouldRecoverFromModuleLoadError(message)) return
			event.preventDefault()
			tryRecoverByReloading()
		}

		const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
			const reason = event.reason
			const message =
				typeof reason === 'string'
					? reason
					: reason instanceof Error
						? reason.message
						: String(reason ?? '')

			if (!shouldRecoverFromModuleLoadError(message)) return
			event.preventDefault()
			tryRecoverByReloading()
		}

		window.addEventListener('error', handleWindowError)
		window.addEventListener('unhandledrejection', handleUnhandledRejection)

		return () => {
			window.removeEventListener('error', handleWindowError)
			window.removeEventListener('unhandledrejection', handleUnhandledRejection)
		}
	}, [])

	return (
		<html lang="id" suppressHydrationWarning>
			<head>
				<script dangerouslySetInnerHTML={{__html:"try{document.documentElement.className=localStorage.getItem('crm-theme')||''}catch(e){}"}} />
				<HeadContent />
			</head>
			<body className="min-h-screen bg-background text-foreground antialiased">
				<ThemeProvider
					attribute="class"
					defaultTheme="light"
					enableSystem={false}
					storageKey="crm-theme"
				>
					{children}
					<ConnectionNotice />
					<Toaster closeButton position="top-right" richColors />
					{shouldShowTanStackDevtools && (
						<TanStackDevtools
							config={{
								position: 'bottom-right',
							}}
							plugins={[
								{
									name: 'Tanstack Router',
									render: <TanStackRouterDevtoolsPanel />,
								},
							]}
						/>
					)}
				</ThemeProvider>
				<Scripts />
			</body>
		</html>
	)
}
