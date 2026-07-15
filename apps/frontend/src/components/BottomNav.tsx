import { useLocation, useNavigate } from '@tanstack/react-router'
import { Menu } from 'lucide-react'
import { useMemo } from 'react'
import { useAppContext } from '@/routes/_app'
import { CRM_NAV_ITEMS } from '@/lib/crm-navigation'
import { getAllowedPrimaryPathsForRole } from '@/lib/role-access'

export default function BottomNav({
	onMenuClick,
	isMenuOpen = false,
}: {
	onMenuClick?: () => void
	isMenuOpen?: boolean
}) {
	const location = useLocation()
	const navigate = useNavigate()
	const { agent } = useAppContext()
	const allowedPaths = getAllowedPrimaryPathsForRole(agent?.role)

	const mobileItems = useMemo(() => {
		const preferredByRole: Record<string, string[]> = {
			sales: ['/dashboard', '/chat', '/tasks', '/customers'],
			leader: ['/dashboard', '/chat', '/customers', '/flows'],
			ceo: ['/dashboard', '/kelola-tim', '/analytics', '/metrics'],
			superadmin: ['/kelola-tim', '/developers', '/settings', '/help'],
		}
		const preferred = preferredByRole[agent?.role || ''] || preferredByRole.sales
		return preferred
			.map((path) => CRM_NAV_ITEMS.find((item) => item.path === path))
			.filter((item): item is (typeof CRM_NAV_ITEMS)[number] => item !== undefined)
			.filter((item) => !allowedPaths || allowedPaths.includes(item.path))
	}, [agent?.role, allowedPaths])

	return (
		<nav aria-label="Navigasi utama" className="fixed bottom-3 left-3 right-3 z-50 flex h-14 items-center justify-around rounded-2xl bg-card px-2 shadow-[0_4px_8px_rgba(15,23,42,0.12)] lg:hidden">
			{mobileItems.map((item) => {
				const Icon = item.icon
				const isActive =
					location.pathname === item.path ||
					location.pathname.startsWith(`${item.path}/`)
				return (
					<button
						type="button"
						key={item.path}
						onClick={() => navigate({ to: item.path as any })}
						className="relative flex h-12 min-w-0 flex-1 touch-manipulation items-center justify-center text-muted-foreground transition-[color,transform] duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						aria-label={item.label}
						aria-current={isActive ? 'page' : undefined}
						title={item.label}
					>
						<Icon className={isActive ? 'text-primary' : 'text-muted-foreground'} size={21} strokeWidth={isActive ? 2.7 : 2} />
						{isActive && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-primary" />}
					</button>
				)
			})}
			<button
				type="button"
				onClick={onMenuClick}
				className="relative flex h-12 min-w-0 flex-1 touch-manipulation items-center justify-center text-muted-foreground transition-[color,transform] duration-150 active:scale-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
				aria-label="Buka semua navigasi"
				aria-expanded={isMenuOpen}
				title="Semua navigasi"
			>
				<Menu className={isMenuOpen ? 'text-primary' : undefined} size={21} strokeWidth={isMenuOpen ? 2.7 : 2} />
				{isMenuOpen && <span className="absolute bottom-0 h-1 w-1 rounded-full bg-primary" />}
			</button>
		</nav>
	)
}
