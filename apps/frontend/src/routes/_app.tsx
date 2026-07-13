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

interface Agent {
	id: string
	email: string
	name: string
	role: string
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
	const [appId, setAppId] = useState(() => {
		if (typeof localStorage === 'undefined') return ''
		return (
			localStorage.getItem('scalechat_app_id') ||
			localStorage.getItem('scalechat_org_slug') ||
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

		const storedAgent = localStorage.getItem('scalechat_user')
		if (storedAgent) {
			const parsedAgent = parseStoredAgent(storedAgent)
			if (parsedAgent) setAgent(parsedAgent)
		}

		const token = localStorage.getItem('scalechat_token')
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
					? localStorage.getItem('scalechat_token')
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

	if (loading || resolvingAppContext) return null

	if (!crmAllowed) return null

	const contextValue: AppContextType = {
		appId,
		agent,
		toggleSidebar: () => setIsMobileSidebarOpen((prev) => !prev),
	}

	return (
		<AppContext.Provider value={contextValue}>
			<div className="ocm-shell flex h-screen overflow-hidden bg-background text-foreground">
				<div className="hidden shrink-0 p-3 lg:flex">
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
					<div className="relative flex min-h-0 flex-1 pb-16 lg:pb-0">
						<Outlet />
					</div>
					<BottomNav
						onMenuClick={() => setIsMobileSidebarOpen((open) => !open)}
						isMenuOpen={isMobileSidebarOpen}
					/>
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
