import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useState,
	type ReactNode,
} from 'react'
import {
	createFileRoute,
	Outlet,
	useLocation,
	useNavigate,
} from '@tanstack/react-router'
import { LoaderCircle } from 'lucide-react'
import BottomNav from '@/components/BottomNav'
import Sidebar from '@/components/Sidebar'
import TopBar from '@/components/TopBar'
import '@/components/crm/crm.css'
import { useTimezone } from '@/hooks/useTimezone'
import {
	isCrmAllowedPath,
	normalizeCrmPath,
} from '@/lib/crm-navigation'
import {
	extractNormalizedRole,
	getAllowedPrimaryPathsForRole,
	isPathAllowedForRole,
} from '@/lib/role-access'
import { syncOrganizationContextFromSession } from '@/lib/organization'
import { whatsappChannels } from '@/lib/api'
import { cn } from '@/lib/utils'

interface Agent {
	id: string
	email: string
	name: string
	role: string
	avatar_url?: string | null
}

function parseStoredAgent(raw: string): Agent | null {
	try {
		const parsed = JSON.parse(raw) as any
		const candidate =
			parsed && typeof parsed.user === 'object' && parsed.user
				? parsed.user
				: parsed

		if (!candidate || typeof candidate !== 'object') return null

		const id = String(candidate.id || '').trim()
		const email = String(candidate.email || '').trim()
		const name =
			String(candidate.name || '').trim() ||
			(email ? email.split('@')[0] : '') ||
			'User'
		const role = extractNormalizedRole(candidate)

		if (!id && !email) return null

		return {
			id: id || email,
			email: email || '',
			name,
			role,
			avatar_url: typeof candidate.avatar_url === 'string' ? candidate.avatar_url : null,
		}
	} catch {
		return null
	}
}

interface AppContextType {
	appId: string
	agent: Agent | null
	toggleSidebar: () => void
}

const AppContext = createContext<AppContextType | null>(null)

export const useAppContext = () => {
	const context = useContext(AppContext)
	if (!context) {
		return {
			appId: '',
			agent: null,
			toggleSidebar: () => {},
		}
	}
	return context
}

export const Route = createFileRoute('/_app')({
	component: AppLayout,
})

function normalizeForRoleGuard(pathname: string) {
	const normalized = normalizeCrmPath(pathname)
	if (normalized === '/customers') return '/customers'
	return normalized
}

function AppLayout() {
	const location = useLocation()
	const navigate = useNavigate()
	const [agent, setAgent] = useState<Agent | null>(null)
	const [loading, setLoading] = useState(true)
	const [resolvingAppContext, setResolvingAppContext] = useState(false)
	const [connectionGateResolved, setConnectionGateResolved] = useState(false)
	const [appId, setAppId] = useState(() => {
		if (typeof localStorage === 'undefined') return ''
		return (
			localStorage.getItem('crm_app_id') ||
			localStorage.getItem('crm_org_slug') ||
			''
		)
	})
	const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false)
	const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(() => {
		if (typeof localStorage === 'undefined') return false
		return localStorage.getItem('crm:sidebar-collapsed') === 'true'
	})

	const toggleDesktopSidebar = () => {
		setIsSidebarCollapsed((current) => {
			const next = !current
			localStorage.setItem('crm:sidebar-collapsed', String(next))
			return next
		})
	}

	useTimezone()

	useEffect(() => {
		if (typeof localStorage === 'undefined') {
			setLoading(false)
			return
		}

		const storedAgent = localStorage.getItem('crm_user')
		if (storedAgent) {
			const parsedAgent = parseStoredAgent(storedAgent)
			if (parsedAgent) setAgent(parsedAgent)
		}

		const token = localStorage.getItem('crm_token')
		if (token) {
			setLoading(false)
			return
		}

		let mounted = true
		const resolveSessionWithoutToken = async () => {
			try {
				const context = await syncOrganizationContextFromSession()
				if (!mounted) return

				if (!context.authenticated) {
					navigate({ to: '/login', replace: true })
					setLoading(false)
					return
				}

				if (context.user) {
					setAgent({
						id: String(context.user.id || ''),
						email: String(context.user.email || ''),
						name: String(context.user.name || context.user.email?.split('@')[0] || 'User'),
						role: context.user.role || 'agent',
						avatar_url: context.user.avatar_url || null,
					})
				}

				if (context.onboardingRequired) {
					navigate({ to: '/onboarding', replace: true })
				}
			} catch {
				if (!mounted) return
				navigate({ to: '/login', replace: true })
			} finally {
				if (mounted) setLoading(false)
			}
		}

		resolveSessionWithoutToken()
		return () => {
			mounted = false
		}
	}, [navigate])

	useEffect(() => {
		if (loading || appId) return

		let mounted = true
		setResolvingAppContext(true)

			const resolveContext = async () => {
				try {
					const context = await syncOrganizationContextFromSession()
					if (!mounted) return

					if (!context.authenticated) {
						navigate({ to: '/login', replace: true })
						return
					}

					const resolvedAppId =
						context.organization?.appId || context.organization?.slug || ''
					if (resolvedAppId) {
						setAppId(resolvedAppId)
						return
				}

				if (context.onboardingRequired) {
					navigate({ to: '/onboarding', replace: true })
				}
			} catch {
				// Keep current behavior when context check fails.
			} finally {
				if (mounted) setResolvingAppContext(false)
			}
		}

		resolveContext()
		return () => {
			mounted = false
		}
	}, [appId, loading, navigate])

	const crmAllowed = useMemo(() => {
		return isCrmAllowedPath(location.pathname)
	}, [location.pathname])

	useEffect(() => {
		if (loading) return
		if (!crmAllowed) {
			const token =
				typeof localStorage !== 'undefined'
					? localStorage.getItem('crm_token')
					: null
			navigate({ to: token ? '/dashboard' : '/login', replace: true })
		}
	}, [loading, crmAllowed, navigate])

	useEffect(() => {
		if (loading || !agent) return
		if (!isCrmAllowedPath(location.pathname)) {
			return
		}

		const roleGuardPath = normalizeForRoleGuard(location.pathname)
		if (!isPathAllowedForRole(roleGuardPath, agent.role)) {
			const allowedPaths = getAllowedPrimaryPathsForRole(agent.role)
			navigate({
				to: (allowedPaths?.[0] || '/dashboard') as any,
				replace: true,
			})
		}
	}, [agent, loading, location.pathname, navigate])

	useEffect(() => {
		if (loading || !agent) return
		if (!['sales', 'agent'].includes(agent.role)) {
			setConnectionGateResolved(true)
			return
		}
		let active = true
		void whatsappChannels.getMyConnection()
			.then((response) => {
				if (!active) return
				if (!response.data.isConnected) {
					setConnectionGateResolved(false)
					void navigate({ to: '/whatsapp/connect', replace: true })
					return
				}
				setConnectionGateResolved(true)
			})
			.catch(() => {
				if (!active) return
				setConnectionGateResolved(false)
				void navigate({ to: '/whatsapp/connect', replace: true })
			})
		return () => { active = false }
	}, [agent, loading, navigate])

	if (loading || resolvingAppContext || !connectionGateResolved) {
		return (
			<div className="flex h-screen items-center justify-center bg-background">
				<LoaderCircle className="h-8 w-8 animate-spin text-muted-foreground motion-reduce:animate-none" />
			</div>
		)
	}

	if (!crmAllowed) return null

	const contextValue: AppContextType = {
		appId,
		agent,
		toggleSidebar: () => setIsMobileSidebarOpen((prev) => !prev),
	}
	const isChatWorkspace = location.pathname === '/chat'

	return (
		<AppContext.Provider value={contextValue}>
			<div className="ocm-shell flex h-screen overflow-hidden bg-background text-foreground">
				<div className={cn('hidden shrink-0 p-3 lg:flex', isChatWorkspace && 'lg:hidden')}>
					<Sidebar agent={agent} isCollapsed={isSidebarCollapsed} onCollapseToggle={toggleDesktopSidebar} />
				</div>

				{isMobileSidebarOpen ? (
					<div className="fixed inset-0 z-[120] p-3 lg:hidden">
						<button
							type="button"
							aria-label="Tutup bilah samping"
							className="absolute inset-0 bg-black/60"
							onClick={() => setIsMobileSidebarOpen(false)}
						/>
						<div className="relative h-full w-72">
							<Sidebar
								agent={agent}
								isCollapsed={false}
								onClose={() => setIsMobileSidebarOpen(false)}
							/>
						</div>
					</div>
				) : null}

				<div className="flex min-w-0 flex-1 flex-col bg-background lg:pt-3">
					<TopBar />
				<div className={cn('relative flex min-h-0 flex-1 lg:pb-0', isChatWorkspace ? 'pb-0' : 'pb-16')}>
						<Outlet />
					</div>
					{!isChatWorkspace && (
						<BottomNav
							onMenuClick={() => setIsMobileSidebarOpen((open) => !open)}
							isMenuOpen={isMobileSidebarOpen}
						/>
					)}
				</div>
			</div>
		</AppContext.Provider>
	)
}

export { AppContext }

export function AppProvider({
	children,
	value,
}: {
	children: ReactNode
	value: AppContextType
}) {
	return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}
