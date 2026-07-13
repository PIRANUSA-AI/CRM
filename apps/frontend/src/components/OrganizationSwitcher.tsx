import { Building2, Check, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import type { Organization } from '@/lib/organization'

interface OrganizationSwitcherProps {
	organizations: Organization[]
	currentOrgSlug: string
	isCollapsed: boolean
	loading?: boolean
	dropdownDirection?: 'up' | 'down'
	onSelectOrganization: (org: Organization) => Promise<void> | void
	onCreateOrganization: () => void
}

export default function OrganizationSwitcher({
	organizations,
	currentOrgSlug,
	isCollapsed,
	loading = false,
	dropdownDirection = 'down',
	onSelectOrganization,
	onCreateOrganization: _onCreateOrganization,
}: OrganizationSwitcherProps) {
	const [open, setOpen] = useState(false)
	const [switchingSlug, setSwitchingSlug] = useState<string | null>(null)
	const wrapperRef = useRef<HTMLDivElement>(null)

	const activeOrg = useMemo(
		() =>
			organizations.find((org) => org.slug === currentOrgSlug) ??
			organizations[0],
		[organizations, currentOrgSlug],
	)

	useEffect(() => {
		const onClickOutside = (event: MouseEvent) => {
			if (
				wrapperRef.current &&
				!wrapperRef.current.contains(event.target as Node)
			) {
				setOpen(false)
			}
		}

		document.addEventListener('mousedown', onClickOutside)
		return () => document.removeEventListener('mousedown', onClickOutside)
	}, [])

	const handleSelect = async (org: Organization) => {
		if (switchingSlug || org.slug === currentOrgSlug) {
			setOpen(false)
			return
		}

		setSwitchingSlug(org.slug)
		try {
			await onSelectOrganization(org)
		} finally {
			setSwitchingSlug(null)
			setOpen(false)
		}
	}

	if (!activeOrg && !loading) {
		return (
			<div
				className={`flex items-center gap-2 ${isCollapsed ? 'justify-center' : ''}`}
			>
				<div className="flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
					<Building2 size={16} />
				</div>
				{!isCollapsed && (
					<div className="text-sm text-muted-foreground">No organization</div>
				)}
			</div>
		)
	}

	const initials = activeOrg?.name?.slice(0, 1).toUpperCase() || 'O'

	return (
		<div className="relative" ref={wrapperRef}>
			<button
				type="button"
				onClick={() => setOpen((v) => !v)}
				disabled={loading}
				className={`flex w-full items-center gap-3 rounded-lg border border-border bg-background/80 px-2.5 py-2 transition-colors hover:bg-muted ${isCollapsed ? 'justify-center px-2' : ''}`}
				title={activeOrg?.name || 'Organization'}
			>
				<div className="h-8 w-8 rounded-md bg-gradient-to-br from-blue-600 to-cyan-500 text-white flex items-center justify-center text-xs font-semibold">
					{initials}
				</div>
				{!isCollapsed && (
					<>
						<div className="min-w-0 flex-1 text-left">
							<div className="text-sm font-semibold text-foreground truncate">
								{activeOrg?.name || 'Organization'}
							</div>
							<div className="text-xs text-muted-foreground truncate">
								/{activeOrg?.slug || 'workspace'}
							</div>
						</div>
						<ChevronDown size={16} className={open ? 'rotate-180' : ''} />
					</>
				)}
			</button>

			{open && (
				<div
					className={`absolute z-[120] rounded-xl border border-border bg-popover p-2 text-popover-foreground shadow-xl ${
						isCollapsed
							? 'left-full top-0 ml-2 w-64'
							: dropdownDirection === 'up'
								? 'bottom-full left-0 right-0 mb-2'
								: 'left-0 right-0 top-full mt-2'
					}`}
				>
					<div className="max-h-64 overflow-auto space-y-1">
						{organizations.map((org) => {
							const active = org.slug === currentOrgSlug
							const switching = switchingSlug === org.slug
							return (
								<button
									key={org.id}
									type="button"
									onClick={() => handleSelect(org)}
									disabled={switching}
									className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted"
								>
									<div className="flex h-7 w-7 items-center justify-center rounded-md bg-gradient-to-br from-primary to-orange-400 text-xs font-semibold text-primary-foreground">
										{org.name.slice(0, 1).toUpperCase()}
									</div>
									<div className="min-w-0 flex-1">
										<div className="truncate text-sm font-medium text-foreground">
											{org.name}
										</div>
										<div className="truncate text-xs text-muted-foreground">
											/{org.slug}
										</div>
									</div>
									{active && !switching && (
										<Check size={14} className="text-emerald-600" />
									)}
									{switching && (
										<div className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-border border-t-foreground" />
									)}
								</button>
							)
						})}
					</div>
				</div>
			)}
		</div>
	)
}
