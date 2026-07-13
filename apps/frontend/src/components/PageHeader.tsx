import { Link } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'

interface PageHeaderProps {
	title: string
	description?: string
	icon?: React.ReactNode
	actions?: React.ReactNode
	tabs?: React.ReactNode
	className?: string
	backButton?: {
		to: string
		params?: any
		label: string
	}
}

export default function PageHeader({
	title,
	description,
	icon,
	actions,
	tabs,
	className,
	backButton,
}: PageHeaderProps) {
	return (
	<div
		className={`bg-card p-4 lg:p-8 border-b border-border mb-6 lg:mb-8 ${className || ''}`}
	>
		{backButton && (
			<Link
				to={backButton.to}
				params={backButton.params}
				className="inline-flex items-center text-sm font-medium text-primary hover:text-primary/80 mb-4 transition-colors"
			>
					<ArrowLeft className="w-4 h-4 mr-2" />
					{backButton.label}
				</Link>
			)}
			<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
				<div className="flex items-start gap-4">
					{icon && (
						<div className="w-10 h-10 lg:w-12 lg:h-12 bg-muted rounded-xl flex items-center justify-center shrink-0 text-primary shadow-sm border border-border">
							{icon}
						</div>
					)}
					<div>
						<h1 className="text-2xl lg:text-3xl font-bold text-foreground tracking-tight">
							{title}
						</h1>
						{description && (
							<p className="text-sm lg:text-base text-muted-foreground mt-1 max-w-2xl leading-relaxed">
								{description}
							</p>
						)}
					</div>
				</div>
				{actions && (
					<div className="flex items-center gap-3 shrink-0">{actions}</div>
				)}
			</div>
			{tabs && <div className="mt-4 -mb-4 lg:-mb-8 -mx-4 lg:-mx-8 px-4 lg:px-8">{tabs}</div>}
		</div>
	)
}
