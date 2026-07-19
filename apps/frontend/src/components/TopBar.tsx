import { useLocation, useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import CommandPalette from '@/components/CommandPalette'
import { CrmAvatar } from '@/components/crm/shared'
import ThemeToggle from '@/components/ThemeToggle'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { notifications as notificationsApi, type NotificationItem } from '@/lib/api'
import { notifDestination, notifIcon } from '@/lib/notifications-meta'
import { connectSocket } from '@/lib/socket'
import { CRM_NAV_ITEMS } from '@/lib/crm-navigation'
import { useAppContext } from '@/routes/_app'

function formatNotifTime(value: string) {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return ''
	return new Intl.DateTimeFormat('id-ID', {
		day: '2-digit',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

type TopBarUser = {
	id?: string
	name?: string | null
	email?: string | null
	role?: string | null
	avatar_url?: string | null
	user?: TopBarUser
}

function readStoredTopBarUser(): TopBarUser | null {
	if (typeof localStorage === 'undefined') return null
	const raw = localStorage.getItem('crm_user')
	if (!raw) return null
	try {
		const parsed = JSON.parse(raw) as TopBarUser
		if (parsed.user && typeof parsed.user === 'object') return parsed.user
		return parsed
	} catch {
		return null
	}
}

export default function TopBar() {
	const location = useLocation()
	const navigate = useNavigate()
	const { agent } = useAppContext()
	const [isPaletteOpen, setIsPaletteOpen] = useState(false)
	const [displayAgent, setDisplayAgent] = useState<TopBarUser | null>(agent || null)
	const [notifOpen, setNotifOpen] = useState(false)
	const [notifItems, setNotifItems] = useState<NotificationItem[]>([])
	const [unreadCount, setUnreadCount] = useState(0)

	useEffect(() => {
		if (agent) {
			setDisplayAgent(agent)
			return
		}
		const local = readStoredTopBarUser()
		if (local) setDisplayAgent(local)
	}, [agent])

	useEffect(() => {
		const handleUserUpdated = (event: Event) => {
			const profile = (event as CustomEvent<TopBarUser>).detail
			setDisplayAgent((current) => ({ ...current, ...profile }))
		}
		window.addEventListener('crm:user-updated', handleUserUpdated)
		return () => window.removeEventListener('crm:user-updated', handleUserUpdated)
	}, [])

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
				event.preventDefault()
				setIsPaletteOpen((prev) => !prev)
			}
		}
		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [])

	// In-app notifications (takeover, pending leads, urgent tasks, AI drafts,
	// WhatsApp disconnect). The socket only pings; content is fetched via API,
	// which is scoped to the authenticated user server-side.
	useEffect(() => {
		let active = true
		const refresh = () => {
			notificationsApi
				.list({ limit: 20 })
				.then((response) => {
					if (active) setNotifItems(response.data)
				})
				.catch(() => {
					/* non-blocking: notifications are best-effort */
				})
			// Badge uses the accurate server-side unread count (not just the
			// first page of the list), so it stays correct beyond 20 items.
			notificationsApi
				.count()
				.then((response) => {
					if (active) setUnreadCount(response.count || 0)
				})
				.catch(() => {
					/* non-blocking */
				})
		}
		refresh()
		const socket = connectSocket()
		socket.on('notification:new', refresh)
		const interval = setInterval(refresh, 60_000)
		return () => {
			active = false
			socket.off('notification:new', refresh)
			clearInterval(interval)
		}
	}, [])

	const openNotification = (item: NotificationItem) => {
		setNotifOpen(false)
		if (!item.read) {
			setUnreadCount((current) => Math.max(0, current - 1))
			setNotifItems((current) =>
				current.map((entry) => (entry.id === item.id ? { ...entry, read: true } : entry)),
			)
			void notificationsApi.markRead(item.id).catch(() => undefined)
		}
		navigate({ to: notifDestination(item) })
	}

	const markAllRead = () => {
		setUnreadCount(0)
		setNotifItems((current) => current.map((entry) => ({ ...entry, read: true })))
		void notificationsApi.markAllRead().catch(() => undefined)
	}

	const activeItem = useMemo(() => {
		const byExact = CRM_NAV_ITEMS.find((item) => item.path === location.pathname)
		if (byExact) return byExact
		return CRM_NAV_ITEMS.find((item) =>
			location.pathname.startsWith(`${item.path}/`),
		)
	}, [location.pathname])

	const displayName =
		String(displayAgent?.name || '').trim() ||
		String(displayAgent?.email || '')
			.split('@')[0]
			.trim() ||
		'User'

	return (
		<>
			<header className="sticky top-0 z-30 flex h-16 shrink-0 items-center gap-3 border-b border-border bg-background/95 px-4 backdrop-blur lg:px-6">
				<div className="flex min-w-0 items-center gap-2 text-sm">
					<span className="truncate text-muted-foreground">CRM</span>
					<span className="text-muted-foreground">/</span>
					<span className="truncate font-semibold">
						{activeItem?.label || 'Dasbor'}
					</span>
				</div>

				<div className="flex-1" />

				<button
					type="button"
					onClick={() => setIsPaletteOpen(true)}
					className="hidden items-center gap-2 rounded-lg border border-border bg-muted/60 px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted sm:flex"
				>
					<Search size={14} />
					<span>Cari menu...</span>
					<span className="ocm-kbd">⌘K</span>
				</button>

				<button
					type="button"
					onClick={() => setIsPaletteOpen(true)}
					className="rounded-md p-2 text-muted-foreground hover:bg-muted sm:hidden"
					aria-label="Buka pencarian"
				>
					<Search size={18} />
				</button>

				<ThemeToggle />

				<Popover open={notifOpen} onOpenChange={setNotifOpen}>
					<PopoverTrigger
						className="relative rounded-md p-2 text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label="Notifikasi"
					>
						<Bell size={18} />
						{unreadCount > 0 ? (
							<span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
								{Math.min(unreadCount, 99)}
							</span>
						) : null}
					</PopoverTrigger>
					<PopoverContent align="end" sideOffset={8} className="w-[min(23rem,calc(100vw-2rem))] p-0">
						<div className="flex items-center justify-between border-b border-border px-3 py-2.5">
							<p className="text-sm font-semibold">Notifikasi</p>
							{unreadCount > 0 ? (
								<button
									type="button"
									onClick={markAllRead}
									className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
								>
									<CheckCheck size={13} /> Tandai semua dibaca
								</button>
							) : (
								<span className="text-xs text-muted-foreground">{notifItems.length} item</span>
							)}
						</div>
						{notifItems.length === 0 ? (
							<div className="px-3 py-6 text-center text-sm text-muted-foreground">
								Belum ada notifikasi.
							</div>
						) : (
							<ul className="max-h-96 divide-y divide-border overflow-y-auto">
								{notifItems.map((item) => {
									const Icon = notifIcon(item.type)
									return (
										<li key={item.id}>
											<button
												type="button"
												onClick={() => openNotification(item)}
												className={`flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60 ${
													item.read ? '' : 'bg-primary/5'
												}`}
											>
												<span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
													<Icon size={13} />
												</span>
												<span className="min-w-0 flex-1">
													<span className="flex items-center gap-2">
														{item.read ? null : (
															<span className="size-1.5 shrink-0 rounded-full bg-primary" />
														)}
														<span className={`truncate text-sm ${item.read ? 'font-medium' : 'font-semibold'}`}>
															{item.title}
														</span>
													</span>
													{item.body ? (
														<span className="line-clamp-2 text-xs text-muted-foreground">{item.body}</span>
													) : null}
													<span className="text-[11px] text-muted-foreground/70">
														{formatNotifTime(item.createdAt)}
													</span>
												</span>
											</button>
										</li>
									)
								})}
							</ul>
						)}
						<div className="border-t border-border p-2">
							<button
								type="button"
								onClick={() => {
									setNotifOpen(false)
									navigate({ to: '/notifikasi' })
								}}
								className="w-full rounded-md px-3 py-2 text-center text-xs font-semibold text-primary transition-colors hover:bg-muted/60"
							>
								Lihat semua notifikasi
							</button>
						</div>
					</PopoverContent>
				</Popover>

				<button type="button" onClick={() => navigate({ to: '/settings' })} className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-1.5 py-1 transition-colors hover:bg-muted sm:px-2" aria-label="Buka pengaturan profil">
					<CrmAvatar name={displayName} imageUrl={displayAgent?.avatar_url} size={26} online />
					<p className="hidden max-w-24 truncate text-xs font-semibold sm:block">{displayName}</p>
				</button>
			</header>

			<CommandPalette
				isOpen={isPaletteOpen}
				onClose={() => setIsPaletteOpen(false)}
			/>
		</>
	)
}
