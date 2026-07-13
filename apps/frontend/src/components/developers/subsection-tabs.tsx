import { Link, useLocation } from '@tanstack/react-router'

import { cn } from '@/lib/utils'
import { developersSubmenuItems } from '@/routes/_app/developers/-model'

type SubsectionTab = {
	label: string
	href: string
}

const webhooksItem = developersSubmenuItems.find(
	(item) => item.href === '/developers/webhooks',
)

const apiToolsItem = developersSubmenuItems.find(
	(item) => item.href === '/developers/api-tools',
)

const messagesItem = developersSubmenuItems.find(
	(item) => item.href === '/developers/messages-sent-by-api',
)

const subsectionTabs: SubsectionTab[] = [
	{ label: 'Overview', href: '/developers' },
	...(webhooksItem
		? [{ label: webhooksItem.title, href: webhooksItem.href }]
		: []),
	...(apiToolsItem
		? [{ label: apiToolsItem.title, href: apiToolsItem.href }]
		: []),
	...(messagesItem
		? [{ label: messagesItem.title, href: messagesItem.href }]
		: []),
]

function isTabActive(href: string, currentPath: string) {
	const normalizedHref = href.replace(/\/+$/, '')
	const normalizedPath = currentPath.replace(/\/+$/, '')

	if (normalizedHref === '/developers') {
		return normalizedPath === '/developers'
	}

	if (normalizedPath === normalizedHref) {
		return true
	}

	return normalizedPath.startsWith(`${normalizedHref}/`)
}

type DevelopersSubsectionTabsProps = {
	className?: string
}

export function DevelopersSubsectionTabs({
	className,
}: DevelopersSubsectionTabsProps) {
	const { pathname } = useLocation()

	return (
		<nav
			aria-label="Developers subsections"
			className={cn('flex flex-wrap gap-2', className)}
		>
			<div className="flex flex-wrap gap-2" role="tablist">
				{subsectionTabs.map((tab) => {
					const active = isTabActive(tab.href, pathname)

					return (
						<Link
							key={tab.href}
							to={tab.href}
							role="tab"
							aria-current={active ? 'page' : undefined}
							className={cn(
								'inline-flex items-center justify-center rounded-full border px-3 py-1.5 text-xs font-semibold outline-none transition focus-visible:ring-2 focus-visible:ring-emerald-400',
								active
									? 'border-emerald-600 bg-emerald-50 text-emerald-700'
									: 'border-transparent text-gray-500 hover:border-gray-200 hover:bg-gray-50',
							)}
						>
							{tab.label}
						</Link>
					)
				})}
			</div>
		</nav>
	)
}
