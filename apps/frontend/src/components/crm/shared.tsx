import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type CrmAvatarProps = {
	name: string
	imageUrl?: string | null
	size?: number
	online?: boolean
	className?: string
}

function colorFromName(name: string): [string, string] {
	const palette: [string, string][] = [
		['#d97706', '#7c2d12'],
		['#0f766e', '#164e63'],
		['#9333ea', '#4c1d95'],
		['#dc2626', '#7f1d1d'],
		['#0369a1', '#1e3a8a'],
		['#65a30d', '#3f6212'],
		['#c026d3', '#701a75'],
	]
	let hash = 0
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 31 + name.charCodeAt(index)) | 0
	}
	return palette[Math.abs(hash) % palette.length]
}

export function CrmAvatar({
	name,
	imageUrl,
	size = 30,
	online = false,
	className,
}: CrmAvatarProps) {
	const [from, to] = colorFromName(name || '?')
	const initials =
		name
			.trim()
			.split(/\s+/)
			.slice(0, 2)
			.map((part) => part[0])
			.join('')
			.toUpperCase() || '?'

	return (
		<div
			// shrink-0: an avatar sits next to a name in a flex row, and without it
			// a long name squeezes the circle into an ellipse. Fixed here so every
			// table gets it rather than each one remembering.
			className={cn(
				'relative inline-grid shrink-0 place-items-center rounded-full text-white',
				className,
			)}
			style={{
				width: size,
				height: size,
				background: `linear-gradient(135deg, ${from}, ${to})`,
				fontSize: `${Math.max(10, Math.floor(size * 0.36))}px`,
				fontWeight: 700,
			}}
			aria-label={name}
		>
			{imageUrl ? <img src={imageUrl} alt="" className="size-full rounded-full object-cover" /> : initials}
			{online && (
				<span
					className="absolute rounded-full border-2 border-card bg-emerald-500"
					style={{
						right: -1,
						bottom: -1,
						width: Math.max(8, Math.floor(size * 0.3)),
						height: Math.max(8, Math.floor(size * 0.3)),
					}}
				/>
			)}
		</div>
	)
}

type CrmSectionHeaderProps = {
	title: string
	subtitle?: string
	actions?: ReactNode
}

export function CrmSectionHeader({
	title,
	subtitle,
	actions,
}: CrmSectionHeaderProps) {
	return (
		<header className="flex flex-wrap items-start justify-between gap-3">
			<div>
				<h1 className="ocm-section-title">{title}</h1>
				{subtitle ? <p className="ocm-section-subtitle mt-1">{subtitle}</p> : null}
			</div>
			{actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
		</header>
	)
}

type CrmStatCardProps = {
	label: string
	value: string
	delta?: string
	deltaTone?: 'success' | 'warning' | 'danger' | 'neutral'
	icon?: ReactNode
	subtitle?: string
}

export function CrmStatCard({
	label,
	value,
	delta,
	deltaTone = 'neutral',
	icon,
	subtitle,
}: CrmStatCardProps) {
	const deltaClass =
		deltaTone === 'success'
			? 'text-emerald-500'
			: deltaTone === 'warning'
				? 'text-amber-500'
				: deltaTone === 'danger'
					? 'text-red-500'
					: 'text-muted-foreground'

	return (
		<div className="ocm-card p-4">
			<div className="mb-3 flex items-center justify-between gap-3">
				<p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
					{label}
				</p>
				{icon}
			</div>
			<p className="text-2xl font-bold leading-none">{value}</p>
			{delta ? (
				<p className={cn('mt-2 text-xs font-semibold', deltaClass)}>
					{delta}
					{subtitle ? <span className="ml-1 text-muted-foreground">{subtitle}</span> : null}
				</p>
			) : subtitle ? (
				<p className="mt-2 text-xs text-muted-foreground">{subtitle}</p>
			) : null}
		</div>
	)
}

type CrmEmptyStateProps = {
	title: string
	description: string
	action?: ReactNode
}

export function CrmEmptyState({
	title,
	description,
	action,
}: CrmEmptyStateProps) {
	return (
		<div className="ocm-card flex min-h-52 flex-col items-center justify-center gap-2 p-8 text-center">
			<p className="text-base font-semibold">{title}</p>
			<p className="max-w-md text-sm text-muted-foreground">{description}</p>
			{action ? <div className="mt-2">{action}</div> : null}
		</div>
	)
}

export function toArray<T = unknown>(input: unknown): T[] {
	if (Array.isArray(input)) return input as T[]
	return []
}

export function unwrapPayload<T = unknown>(input: unknown): T[] {
	if (!input || typeof input !== 'object') return []

	const data = input as Record<string, unknown>
	const firstLevel = toArray<T>(data.payload)
	if (firstLevel.length > 0) return firstLevel

	const secondLevel = toArray<T>(data.data)
	if (secondLevel.length > 0) return secondLevel

	if (data.data && typeof data.data === 'object') {
		const nested = data.data as Record<string, unknown>
		const nestedPayload = toArray<T>(nested.payload)
		if (nestedPayload.length > 0) return nestedPayload
		const nestedData = toArray<T>(nested.data)
		if (nestedData.length > 0) return nestedData
	}

	return []
}
