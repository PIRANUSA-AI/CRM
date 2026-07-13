import { Outlet, createFileRoute, useMatches, useNavigate } from '@tanstack/react-router'
import { ArrowUpRight, Copy, Layers3, Plus, Settings2, Sparkles, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { CrmSectionHeader, unwrapPayload } from '@/components/crm/shared'
import { automationFlows } from '@/lib/api'

export const Route = createFileRoute('/_app/flows')({
	component: WorkflowListPage,
})

type WorkflowSummary = {
	id: string
	name: string
	status: 'active' | 'draft'
	lastRun: string
}

type FlowApiItem = {
	id?: string | number
	name?: string
	title?: string
	active?: boolean | null
	is_active?: boolean
	updated_at?: string | null
}

function formatLastRun(input: string | null | undefined) {
	if (!input) return '-'
	const timestamp = new Date(input)
	if (Number.isNaN(timestamp.getTime())) return '-'

	const diff = Date.now() - timestamp.getTime()
	const minute = 60_000
	const hour = 60 * minute
	const day = 24 * hour

	if (diff < minute) return 'baru saja'
	if (diff < hour) return `${Math.max(1, Math.floor(diff / minute))}m ago`
	if (diff < day) return `${Math.max(1, Math.floor(diff / hour))}h ago`
	return `${Math.max(1, Math.floor(diff / day))}d ago`
}

function initialsFromName(name: string) {
	const clean = name.trim()
	if (!clean) return 'WF'
	const words = clean.split(/\s+/).slice(0, 2)
	const initials = words.map((word) => word[0]?.toUpperCase() || '').join('')
	return initials || 'WF'
}

function avatarGradientFromName(name: string) {
	const palette = [
		['#334155', '#1e293b'],
		['#0f766e', '#115e59'],
		['#1d4ed8', '#1e3a8a'],
		['#7c3aed', '#581c87'],
		['#be185d', '#831843'],
		['#b45309', '#7c2d12'],
	]
	let hash = 0
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 33 + name.charCodeAt(index)) | 0
	}
	const [from, to] = palette[Math.abs(hash) % palette.length]
	return `linear-gradient(135deg, ${from}, ${to})`
}

function WorkflowListPage() {
	const navigate = useNavigate()
	const matches = useMatches()
	const isDetailMode = matches.some((match) => match.routeId.endsWith('$flowId'))
	const [flows, setFlows] = useState<WorkflowSummary[]>([])
	const [loading, setLoading] = useState<boolean>(true)
	const [deletingId, setDeletingId] = useState<string | null>(null)

	useEffect(() => {
		if (isDetailMode) return
		let active = true

		const load = async () => {
			try {
				const response = await automationFlows.list()
				if (!active) return

				const mapped: WorkflowSummary[] = unwrapPayload<FlowApiItem>(response)
					.map((row) => {
						const id = row?.id ? String(row.id) : ''
						if (!id) return null
						const isActive = Boolean(row?.active ?? row?.is_active)
						return {
							id,
							name: String(row?.name || row?.title || id),
							status: isActive ? 'active' : 'draft',
							lastRun: formatLastRun(row?.updated_at),
						}
					})
					.filter((row): row is WorkflowSummary => row !== null)

				setFlows(mapped)
			} catch {
				setFlows([])
			} finally {
				if (active) setLoading(false)
			}
		}

		void load()
		return () => {
			active = false
		}
	}, [isDetailMode])

	const cards = useMemo(() => flows, [flows])

	const handleOpenDetail = (flowId: string) => {
		navigate({
			to: '/flows/$flowId',
			params: { flowId },
			search: { execution_id: undefined },
		})
	}

	const handleCreate = () => {
		navigate({
			to: '/flows/$flowId',
			params: { flowId: 'new' },
			search: { execution_id: undefined },
		})
	}

	const handleDelete = async (flowId: string) => {
		const confirmed = window.confirm('Hapus workflow ini?')
		if (!confirmed) return

		setDeletingId(flowId)
		setFlows((previous) => previous.filter((flow) => flow.id !== flowId))

		try {
			await automationFlows.delete(flowId)
		} catch {
			setFlows((previous) => {
				if (previous.some((flow) => flow.id === flowId)) return previous
				const removed = cards.find((flow) => flow.id === flowId)
				if (!removed) return previous
				return [...previous, removed]
			})
		} finally {
			setDeletingId(null)
		}
	}

	const handleCopyLink = (flowId: string, flowName: string) => {
		if (typeof window === 'undefined' || !navigator.clipboard) return
		const url = `${window.location.origin}/flows/${flowId}`
		void navigator.clipboard.writeText(url || flowName)
	}

	if (isDetailMode) {
		return <Outlet />
	}

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="Workflow"
				subtitle="Pilih workflow untuk buka detail editor"
			/>

			<div className="grid auto-rows-fr gap-5 md:grid-cols-2 xl:grid-cols-3">
				{cards.map((flow) => {
					const initials = initialsFromName(flow.name)
					const deleting = deletingId === flow.id
					const badgeClass =
						flow.status === 'active'
							? 'ocm-tag ocm-tag-success'
							: 'ocm-tag ocm-tag-warning'

					return (
						<div
							key={flow.id}
							role="button"
							tabIndex={0}
							onClick={() => handleOpenDetail(flow.id)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' || event.key === ' ') {
									event.preventDefault()
									handleOpenDetail(flow.id)
								}
							}}
							className="ocm-card group relative flex min-h-[320px] cursor-pointer flex-col overflow-hidden rounded-[26px] p-6 transition duration-200 hover:-translate-y-1 hover:shadow-xl"
							style={{
								background:
									'linear-gradient(165deg, color-mix(in oklab, var(--ocm-surface) 92%, white 8%) 0%, color-mix(in oklab, var(--ocm-surface-soft) 88%, white 12%) 100%)',
							}}
						>
							<div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/15" />

							<div className="relative z-10 flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="line-clamp-2 text-[1.6rem] font-bold leading-tight tracking-tight text-foreground md:text-[1.9rem]">
										{flow.name}
									</p>
									<p className="mt-1 text-sm text-muted-foreground">Last run {flow.lastRun}</p>
								</div>
								<span className={badgeClass}>
									{flow.status === 'active' ? 'Active' : 'Draft'}
								</span>
							</div>

							<div className="relative z-10 my-7 flex items-center gap-4">
								<div
									className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl border border-white/20 text-3xl font-semibold text-white shadow-sm"
									style={{ background: avatarGradientFromName(flow.name) }}
								>
									{initials}
								</div>
								<div className="min-w-0 flex-1 space-y-2">
									<div className="flex items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
										<Layers3 size={14} />
										<span className="truncate">WhatsApp Automation Flow</span>
									</div>
									<div className="flex items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
										<Sparkles size={14} />
										<span className="truncate">Ready to edit and deploy</span>
									</div>
								</div>
							</div>

							<div className="relative z-10 mt-auto flex items-center gap-2">
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										handleOpenDetail(flow.id)
									}}
									className="ocm-btn h-10 flex-1 rounded-xl"
								>
									<Settings2 size={16} />
									Open Editor
								</button>
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										handleCopyLink(flow.id, flow.name)
									}}
									className="ocm-btn h-10 rounded-xl px-3"
									aria-label={`Copy ${flow.name} link`}
								>
									<Copy size={16} />
								</button>
								<button
									type="button"
									disabled={deleting}
									onClick={(event) => {
										event.stopPropagation()
										void handleDelete(flow.id)
									}}
									className="ocm-btn h-10 rounded-xl border-red-300/60 px-3 text-red-500 hover:bg-red-500/10"
									aria-label={`Delete ${flow.name}`}
								>
									<Trash2 size={16} />
								</button>
							</div>
						</div>
					)
				})}

				<button
					type="button"
					onClick={handleCreate}
					className="ocm-card group relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden rounded-[26px] border border-emerald-400/70 px-6 text-white transition duration-200 hover:-translate-y-1 hover:shadow-xl"
					style={{
						background:
							'radial-gradient(circle at 20% 20%, rgba(255,255,255,.22) 0, rgba(255,255,255,0) 36%), linear-gradient(135deg, color-mix(in oklab, var(--ocm-success) 84%, #34d399 16%), color-mix(in oklab, var(--ocm-success) 96%, #047857 4%))',
					}}
				>
					<div className="pointer-events-none absolute -left-12 top-8 h-36 w-36 rounded-full border border-white/20 bg-white/10 blur-sm" />
					<div className="pointer-events-none absolute -right-16 bottom-6 h-44 w-44 rounded-full border border-white/20 bg-white/10 blur-sm" />

					<span className="relative z-10 grid h-24 w-24 place-items-center rounded-full bg-white/95 text-emerald-500 shadow-lg">
						<Plus size={38} />
					</span>
					<p className="relative z-10 mt-8 text-3xl font-bold tracking-tight md:text-5xl">Create New</p>
					<p className="relative z-10 mt-2 text-sm text-emerald-50/90 md:text-base">
						Start a fresh workflow and design the flow
					</p>
					<span className="relative z-10 mt-6 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/20 px-4 py-1.5 text-sm font-semibold">
						Create Workflow
						<ArrowUpRight size={16} />
					</span>
				</button>
			</div>

			{loading ? <p className="text-xs text-muted-foreground">Memuat workflow...</p> : null}
		</main>
	)
}
