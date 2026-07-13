import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { ChevronRight, Search, X } from 'lucide-react'
import { CRM_NAV_ITEMS } from '@/lib/crm-navigation'
import { getAllowedPrimaryPathsForRole } from '@/lib/role-access'
import { useAppContext } from '@/routes/_app'

interface CommandPaletteProps {
	isOpen: boolean
	onClose: () => void
}

export default function CommandPalette({
	isOpen,
	onClose,
}: CommandPaletteProps) {
	const navigate = useNavigate()
	const { agent } = useAppContext()
	const allowedPaths = getAllowedPrimaryPathsForRole(agent?.role)
	const [search, setSearch] = useState('')
	const [selectedIndex, setSelectedIndex] = useState(0)

	const items = useMemo(() => {
		const roleScoped = allowedPaths
			? CRM_NAV_ITEMS.filter((item) => allowedPaths.includes(item.path))
			: CRM_NAV_ITEMS
		return roleScoped.filter((item) =>
			`${item.label} ${item.group}`.toLowerCase().includes(search.toLowerCase()),
		)
	}, [allowedPaths, search])

	useEffect(() => {
		setSelectedIndex(0)
	}, [search, isOpen])

	useEffect(() => {
		if (!isOpen) return
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'ArrowDown') {
				event.preventDefault()
				setSelectedIndex((prev) => (items.length === 0 ? 0 : (prev + 1) % items.length))
			}
			if (event.key === 'ArrowUp') {
				event.preventDefault()
				setSelectedIndex((prev) =>
					items.length === 0 ? 0 : (prev - 1 + items.length) % items.length,
				)
			}
			if (event.key === 'Enter') {
				event.preventDefault()
				const target = items[selectedIndex]
				if (!target) return
				navigate({ to: target.path })
				onClose()
				setSearch('')
			}
			if (event.key === 'Escape') {
				event.preventDefault()
				onClose()
			}
		}

		window.addEventListener('keydown', onKeyDown)
		return () => window.removeEventListener('keydown', onKeyDown)
	}, [isOpen, items, selectedIndex, navigate, onClose])

	if (!isOpen) return null

	return (
		<div className="fixed inset-0 z-[200] flex items-start justify-center pt-[13vh]">
			<button
				type="button"
				className="absolute inset-0 bg-black/60"
				onClick={onClose}
				aria-label="Close command palette"
			/>
			<div className="relative z-10 w-full max-w-xl rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl">
				<div className="flex items-center gap-3 border-b border-border px-4 py-3">
					<Search className="h-4 w-4 text-muted-foreground" />
					<input
						autoFocus
						className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
						placeholder="Cari halaman CRM..."
						value={search}
						onChange={(event) => setSearch(event.target.value)}
					/>
					<button
						type="button"
						onClick={onClose}
						className="rounded-md p-1 text-muted-foreground hover:bg-muted"
					>
						<X className="h-4 w-4" />
					</button>
				</div>
				<div className="max-h-[60vh] overflow-y-auto py-2">
					{items.length === 0 ? (
						<div className="px-4 py-8 text-center text-sm text-muted-foreground">
							Tidak ada hasil.
						</div>
					) : (
						items.map((item, index) => {
							const Icon = item.icon
							const active = index === selectedIndex
							return (
								<button
									type="button"
									key={item.path}
									onMouseEnter={() => setSelectedIndex(index)}
									onClick={() => {
										navigate({ to: item.path })
										onClose()
										setSearch('')
									}}
									className={`flex w-full items-center justify-between px-4 py-3 text-left text-sm ${
										active
											? 'bg-primary/12 text-primary'
											: 'text-foreground/80 hover:bg-muted'
									}`}
								>
									<div className="flex items-center gap-3">
										<div
											className={`grid h-8 w-8 place-items-center rounded-md ${
												active ? 'bg-background text-primary' : 'bg-muted text-muted-foreground'
											}`}
										>
											<Icon size={17} />
										</div>
										<div>
											<div className="font-medium">{item.label}</div>
											<div className="text-xs text-muted-foreground capitalize">
												{item.group}
											</div>
										</div>
									</div>
									{active ? <ChevronRight className="h-4 w-4 opacity-50" /> : null}
								</button>
							)
						})
					)}
				</div>
				<div className="flex items-center justify-between border-t border-border px-4 py-2 text-[11px] text-muted-foreground">
					<span>↑ ↓ untuk navigasi</span>
					<span>Enter untuk buka</span>
				</div>
			</div>
		</div>
	)
}
