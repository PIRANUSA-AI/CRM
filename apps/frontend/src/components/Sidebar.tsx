import { Link, useLocation, useNavigate } from '@tanstack/react-router'
import {
	LogOut,
	PanelLeftClose,
	PanelLeftOpen,
	X,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CrmAvatar } from '@/components/crm/shared'
import { API_BASE, personalAi } from '@/lib/api'
import { connectSocket } from '@/lib/socket'
import {
	CRM_GROUP_LABELS,
	CRM_NAV_ITEMS,
	type CrmNavItem,
} from '@/lib/crm-navigation'
import {
	extractNormalizedRole,
	getAllowedPrimaryPathsForRole,
} from '@/lib/role-access'

interface Agent {
	id: string
	email: string
	name: string
	role: string
	avatar_url?: string | null
}

interface Props {
	agent?: Agent | null
	onLogout?: () => Promise<void>
	isCollapsed?: boolean
	onCollapseToggle?: () => void
	onClose?: () => void
}

function isItemVisibleForRole(item: CrmNavItem, role: string | null | undefined) {
	const allowed = getAllowedPrimaryPathsForRole(role)
	if (!allowed) return true
	return allowed.includes(item.path)
}

export default function Sidebar({
	agent: agentProp,
	onLogout,
	isCollapsed = false,
	onCollapseToggle,
	onClose,
}: Props = {}) {
	const navigate = useNavigate()
	const location = useLocation()
	const [currentAgent, setCurrentAgent] = useState<Agent | null>(
		agentProp || null,
	)
	const [alihTugasCount, setAlihTugasCount] = useState(0)

	useEffect(() => {
		if (!agentProp) {
			const stored = localStorage.getItem('crm_user')
			if (!stored) return
			try {
				const parsed = JSON.parse(stored) as any
				const candidate =
					parsed && typeof parsed.user === 'object' && parsed.user
						? parsed.user
						: parsed
				if (!candidate || typeof candidate !== 'object') return

				setCurrentAgent({
					id: String(candidate.id || ''),
					email: String(candidate.email || ''),
					name: String(candidate.name || candidate.email || 'User'),
					role: extractNormalizedRole(candidate),
					avatar_url: typeof candidate.avatar_url === 'string' ? candidate.avatar_url : null,
				})
			} catch {
				// ignore invalid local storage
			}
			return
		}

		setCurrentAgent({
			...agentProp,
			role: extractNormalizedRole(agentProp as unknown as Record<string, unknown>),
		})
	}, [agentProp])

	useEffect(() => {
		const handleUserUpdated = (event: Event) => {
			const profile = (event as CustomEvent<Partial<Agent>>).detail
			setCurrentAgent((current) => current ? { ...current, ...profile } : current)
		}
		window.addEventListener('crm:user-updated', handleUserUpdated)
		return () => window.removeEventListener('crm:user-updated', handleUserUpdated)
	}, [])

	// Live count of leads waiting on a human, shown as a badge on "Alih Tugas".
	useEffect(() => {
		let active = true
		const refresh = () => {
			personalAi
				.takeoverCount()
				.then((response) => {
					if (active) setAlihTugasCount(response.count || 0)
				})
				.catch(() => {
					/* non-blocking: badge is best-effort */
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

	const menuGroups = useMemo(() => {
		const visibleItems = CRM_NAV_ITEMS.filter((item) =>
			isItemVisibleForRole(item, currentAgent?.role),
		)

		return (Object.keys(CRM_GROUP_LABELS) as Array<
			keyof typeof CRM_GROUP_LABELS
		>).map((group) => ({
			group,
			label: CRM_GROUP_LABELS[group],
			items: visibleItems.filter((item) => item.group === group),
		}))
	}, [currentAgent?.role])

	const handleLogout = async () => {
		if (onLogout) {
			await onLogout()
			return
		}

		const token = localStorage.getItem('crm_token')
		if (token) {
			try {
				await fetch(`${API_BASE}/auth/logout`, {
					method: 'POST',
					credentials: 'include',
					headers: { Authorization: `Bearer ${token}` },
				})
			} catch {
				// noop
			}
		}

		localStorage.clear()
		document.cookie.split(';').forEach((cookiePart) => {
			document.cookie = cookiePart
				.replace(/^ +/, '')
				.replace(/=.*/, '=;expires=' + new Date().toUTCString() + ';path=/')
		})
		navigate({ to: '/login', replace: true })
	}

	const displayName =
		String(currentAgent?.name || '').trim() ||
		String(currentAgent?.email || '')
			.split('@')[0]
			.trim() ||
		'User'

	return (
		<aside
			className={`flex h-full flex-col overflow-hidden rounded-2xl bg-card text-card-foreground ring-1 ring-border transition-[width] duration-200 ease-out ${
				isCollapsed ? 'w-[72px]' : 'w-72'
			}`}
		>
			<div className={`flex h-16 shrink-0 items-center border-b border-border ${isCollapsed ? 'justify-center px-2' : 'justify-between px-4'}`}>
				{!isCollapsed && (
					<div className="min-w-0">
						<p className="truncate text-sm font-semibold">CRM</p>
						<p className="truncate text-[11px] text-muted-foreground">
							Ruang kerja pelanggan
						</p>
					</div>
				)}
				<button
					type="button"
					onClick={onCollapseToggle}
					className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring lg:flex"
					aria-label={isCollapsed ? 'Perluas bilah samping' : 'Ciutkan bilah samping'}
					title={isCollapsed ? 'Perluas bilah samping' : 'Ciutkan bilah samping'}
				>
					{isCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
				</button>
				<button
					type="button"
					onClick={onClose}
					className="rounded-md p-2 text-muted-foreground hover:bg-muted lg:hidden"
					aria-label="Tutup bilah samping"
				>
					<X size={18} />
				</button>
			</div>

			<nav className={`flex-1 overflow-y-auto py-4 ${isCollapsed ? 'space-y-2 px-2' : 'space-y-5 px-3'}`}>
				{menuGroups.map((group) => {
					if (group.items.length === 0) return null
					return (
						<div key={group.group}>
							<p className={`px-3 pb-2 text-[10px] font-medium text-muted-foreground ${isCollapsed ? 'sr-only' : ''}`}>
								{group.label}
							</p>
							<div className={isCollapsed ? 'space-y-1.5' : 'space-y-1'}>
								{group.items.map((item) => {
									const isActive =
										location.pathname === item.path ||
										location.pathname.startsWith(`${item.path}/`)
									const Icon = item.icon
									return (
						<Link
											key={item.path}
							to={item.path}
							onClick={() => onClose?.()}
											aria-label={item.label}
											title={isCollapsed ? item.label : undefined}
											className={`group relative flex h-9 items-center rounded-lg text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
												isCollapsed ? 'justify-center px-0' : 'gap-3 px-3'
											} ${isActive ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
										>
											<Icon className={`shrink-0 transition-colors ${isActive ? 'text-primary' : 'text-muted-foreground group-hover:text-foreground'}`} size={17} strokeWidth={isActive ? 2.5 : 2} />
											<span className={isCollapsed ? 'sr-only' : ''}>{item.label}</span>
											{item.id === 'alih-tugas' && alihTugasCount > 0 ? (
												<span
													className={
														isCollapsed
															? 'absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] font-semibold leading-4 text-white'
															: 'ml-auto grid min-w-5 place-items-center rounded-full bg-destructive px-1.5 py-0.5 text-[10px] font-semibold text-white'
													}
												>
													{Math.min(alihTugasCount, 99)}
												</span>
											) : item.badge ? (
												<span className={isCollapsed ? 'sr-only' : 'ml-auto rounded bg-muted px-1.5 py-0.5 font-mono text-[10px]'}>
													{item.badge}
												</span>
											) : null}
										</Link>
									)
								})}
							</div>
						</div>
					)
				})}
			</nav>

			<div className={`border-t border-border ${isCollapsed ? 'p-2' : 'p-3'}`}>
				<button type="button" onClick={() => { navigate({ to: '/settings' }); onClose?.() }} className={`mb-2 flex w-full items-center rounded-lg text-left transition-colors hover:bg-muted ${isCollapsed ? 'justify-center py-2' : 'gap-3 px-2 py-2'}`} title={isCollapsed ? `${displayName} · ${currentAgent?.role || 'Admin'}` : undefined}>
					<CrmAvatar name={displayName} imageUrl={currentAgent?.avatar_url} online size={30} />
					<div className={isCollapsed ? 'sr-only' : 'min-w-0 flex-1'}>
						<p className="truncate text-sm font-semibold">{displayName}</p>
						<p className="truncate text-xs text-muted-foreground">
							{currentAgent?.role || 'Admin'}
						</p>
					</div>
				</button>
				<button
					type="button"
					onClick={handleLogout}
					className="flex h-9 w-full items-center justify-center gap-2 rounded-lg text-sm font-medium text-muted-foreground transition-colors hover:text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					aria-label="Keluar"
					title={isCollapsed ? 'Keluar' : undefined}
				>
					<LogOut size={16} />
					<span className={isCollapsed ? 'sr-only' : ''}>Keluar</span>
				</button>
			</div>
		</aside>
	)
}
