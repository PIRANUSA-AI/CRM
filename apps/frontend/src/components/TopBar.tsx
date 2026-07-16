import { useLocation, useNavigate } from '@tanstack/react-router'
import { Bell, Bot, Search, UserCheck } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import CommandPalette from '@/components/CommandPalette'
import { CrmAvatar } from '@/components/crm/shared'
import ThemeToggle from '@/components/ThemeToggle'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { personalAi, type PersonalTakeoverItem } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import { CRM_NAV_ITEMS } from '@/lib/crm-navigation'
import { useAppContext } from '@/routes/_app'

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
	const [takeovers, setTakeovers] = useState<PersonalTakeoverItem[]>([])

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

	// Notifications: leads currently handed over / taken over that need a human.
	useEffect(() => {
		let active = true
		const refresh = () => {
			personalAi
				.listTakeovers()
				.then((response) => {
					if (active) setTakeovers(response.data)
				})
				.catch(() => {
					/* non-blocking: notifications are best-effort */
				})
		}
		refresh()
		const socket = connectSocket()
		socket.on('personal-takeover:updated', refresh)
		const interval = setInterval(refresh, 60_000)
		return () => {
			active = false
			socket.off('personal-takeover:updated', refresh)
			clearInterval(interval)
		}
	}, [])

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
						aria-label="Notifikasi alih tugas"
					>
						<Bell size={18} />
						{takeovers.length > 0 ? (
							<span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-semibold leading-4 text-white">
								{Math.min(takeovers.length, 99)}
							</span>
						) : null}
					</PopoverTrigger>
					<PopoverContent align="end" sideOffset={8} className="w-[min(22rem,calc(100vw-2rem))] p-0">
						<div className="flex items-center justify-between border-b border-border px-3 py-2.5">
							<p className="text-sm font-semibold">Alih Tugas</p>
							<span className="text-xs text-muted-foreground">{takeovers.length} menunggu</span>
						</div>
						{takeovers.length === 0 ? (
							<div className="px-3 py-6 text-center text-sm text-muted-foreground">
								Tidak ada lead yang perlu ditangani manusia.
							</div>
						) : (
							<ul className="max-h-80 divide-y divide-border overflow-y-auto">
								{takeovers.slice(0, 8).map((item) => {
									const isAi = item.source === 'ai'
									return (
										<li key={item.conversationId}>
											<button
												type="button"
												onClick={() => {
													setNotifOpen(false)
													navigate({ to: '/alih-tugas' })
												}}
												className="flex w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-muted/60"
											>
												<span
													className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${
														isAi
															? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
															: 'bg-sky-500/10 text-sky-700 dark:text-sky-300'
													}`}
												>
													{isAi ? <Bot size={13} /> : <UserCheck size={13} />}
												</span>
												<span className="min-w-0 flex-1">
													<span className="flex items-center justify-between gap-2">
														<span className="truncate text-sm font-medium">{item.contactName}</span>
														{item.overdue ? (
															<span className="shrink-0 text-[10px] font-semibold text-rose-500">lewat SLA</span>
														) : null}
													</span>
													<span className="line-clamp-1 text-xs text-muted-foreground">
														{isAi ? 'Dialihkan AI' : 'Diambil sales'}
														{item.aiReason ? ` · ${item.aiReason}` : ''}
													</span>
												</span>
											</button>
										</li>
									)
								})}
							</ul>
						)}
						<button
							type="button"
							onClick={() => {
								setNotifOpen(false)
								navigate({ to: '/alih-tugas' })
							}}
							className="w-full border-t border-border px-3 py-2.5 text-center text-sm font-semibold text-primary hover:bg-muted/60"
						>
							Buka Alih Tugas
						</button>
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
