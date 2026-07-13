import { useLocation } from '@tanstack/react-router'
import { Bell, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import CommandPalette from '@/components/CommandPalette'
import { CrmAvatar } from '@/components/crm/shared'
import ThemeToggle from '@/components/ThemeToggle'
import { CRM_NAV_ITEMS } from '@/lib/crm-navigation'
import { useAppContext } from '@/routes/_app'

type TopBarUser = {
	id?: string
	name?: string | null
	email?: string | null
	role?: string | null
	user?: TopBarUser
}

function readStoredTopBarUser(): TopBarUser | null {
	if (typeof localStorage === 'undefined') return null
	const raw = localStorage.getItem('scalechat_user')
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
	const { agent } = useAppContext()
	const [isPaletteOpen, setIsPaletteOpen] = useState(false)
	const [displayAgent, setDisplayAgent] = useState<TopBarUser | null>(agent || null)

	useEffect(() => {
		if (agent) {
			setDisplayAgent(agent)
			return
		}
		const local = readStoredTopBarUser()
		if (local) setDisplayAgent(local)
	}, [agent])

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

				<button
					type="button"
					className="relative rounded-md p-2 text-muted-foreground hover:bg-muted"
					aria-label="Notifikasi"
				>
					<Bell size={18} />
					<span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-rose-500" />
				</button>

				<div className="hidden items-center gap-2 rounded-lg border border-border bg-muted/40 px-2 py-1 sm:flex">
					<CrmAvatar name={displayName} size={26} online />
					<p className="max-w-24 truncate text-xs font-semibold">{displayName}</p>
				</div>
			</header>

			<CommandPalette
				isOpen={isPaletteOpen}
				onClose={() => setIsPaletteOpen(false)}
			/>
		</>
	)
}
