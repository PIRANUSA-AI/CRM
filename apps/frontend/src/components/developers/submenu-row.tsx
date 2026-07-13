import { useMemo, useState, type ReactNode } from 'react'
import { Link } from '@tanstack/react-router'
import { ChevronRightIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

type DevelopersSubmenuRowBaseProps = {
	icon: ReactNode
	title: string
	description: string
	rightAction?: ReactNode
	className?: string
	'data-testid'?: string
}

type DevelopersSubmenuRowLinkProps = DevelopersSubmenuRowBaseProps & {
	mode: 'link'
	href: string
}

type DevelopersSubmenuRowExpandableProps = DevelopersSubmenuRowBaseProps & {
	mode: 'expandable'
	content:
		| ReactNode
		| ((context: { expanded: boolean }) => ReactNode)
	defaultExpanded?: boolean
	value?: string
}

export type DevelopersSubmenuRowProps =
	| DevelopersSubmenuRowLinkProps
	| DevelopersSubmenuRowExpandableProps

function RowIcon({ icon }: { icon: ReactNode }) {
	return (
		<div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-700">
			{icon}
		</div>
	)
}

function RowText({
	title,
	description,
}: {
	title: string
	description: string
}) {
	return (
		<>
			<h3 className="text-lg font-semibold text-gray-900">{title}</h3>
			<p className="mt-1 text-sm text-gray-500">{description}</p>
		</>
	)
}

function RowAction({ children }: { children?: ReactNode }) {
	if (!children) return null

	return <div className="shrink-0">{children}</div>
}

export function DevelopersSubmenuRow(props: DevelopersSubmenuRowProps) {
	if (props.mode === 'link') {
		return (
			<Link
				to={props.href}
				data-testid={props['data-testid']}
				className={cn(
					'block overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm outline-none transition-all focus-visible:ring-2 focus-visible:ring-blue-500/40',
					props.className,
				)}
			>
				<div className="w-full p-6 transition-colors hover:bg-gray-50">
					<div className="flex items-center justify-between gap-4">
						<div className="flex min-w-0 items-center gap-4">
							<RowIcon icon={props.icon} />
							<div className="min-w-0 text-left">
								<RowText title={props.title} description={props.description} />
							</div>
						</div>
						<div className="flex shrink-0 items-center gap-3">
							<RowAction>{props.rightAction}</RowAction>
							<ChevronRightIcon className="size-5 text-gray-400" />
						</div>
					</div>
				</div>
			</Link>
		)
	}

	const itemValue =
		props.value ?? props.title.toLowerCase().replace(/\s+/g, '-')
	const [expandedValues, setExpandedValues] = useState<string[]>(
		props.defaultExpanded ? [itemValue] : [],
	)
	const isExpanded = expandedValues.includes(itemValue)

	const resolvedContent = useMemo(() => {
		if (typeof props.content === 'function') {
			return props.content({ expanded: isExpanded })
		}

		return props.content
	}, [isExpanded, props.content])

	return (
		<div
			data-testid={props['data-testid']}
			className={cn(
				'overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm',
				props.className,
			)}
		>
			<button
				type="button"
				onClick={() =>
					setExpandedValues((current) =>
						current.includes(itemValue) ? [] : [itemValue],
					)
				}
				className="w-full p-6 text-left transition-colors hover:bg-gray-50"
			>
				<div className="flex items-center justify-between gap-4">
					<div className="flex min-w-0 items-center gap-4">
						<RowIcon icon={props.icon} />
						<div className="min-w-0 text-left">
							<RowText title={props.title} description={props.description} />
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-3">
						<div onClick={(event) => event.stopPropagation()}>
							<RowAction>{props.rightAction}</RowAction>
						</div>
						<ChevronRightIcon
							className={cn(
								'size-5 text-gray-400 transition-transform',
								isExpanded ? 'rotate-90' : '',
							)}
						/>
					</div>
				</div>
			</button>

			{isExpanded ? (
				<div className="border-t border-gray-200 bg-gray-50 p-6">
					{resolvedContent}
				</div>
			) : null}
		</div>
	)
}
