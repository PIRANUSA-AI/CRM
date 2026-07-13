import {
	createFileRoute,
	Outlet,
	useMatches,
	useNavigate,
} from '@tanstack/react-router'
import {
	ArrowUpRight,
	Bot,
	Copy,
	MessageCircle,
	Plus,
	Settings2,
	Sparkles,
	Trash2,
} from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import {
	CrmSectionHeader,
	unwrapPayload,
} from '@/components/crm/shared'
import { chatbots } from '@/lib/api'

export const Route = createFileRoute('/_app/ai-agents')({
	component: AIAgentListPage,
})

type AIAgentSummary = {
	id: string
	name: string
	description: string
	model: string
	status: 'active' | 'draft'
	updatedAt: string
	watcherEnabled: boolean
}

type ChatbotApiItem = {
	id?: string | number
	name?: string
	description?: string | null
	model?: string | null
	is_active?: boolean | null
	watcher_enabled?: boolean | null
	updated_at?: string | null
	created_at?: string | null
}

function formatUpdatedAt(input: string | null | undefined) {
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
	if (!clean) return 'AI'
	const words = clean.split(/\s+/).slice(0, 2)
	const initials = words.map((word) => word[0]?.toUpperCase() || '').join('')
	return initials || 'AI'
}

function avatarGradientFromName(name: string) {
	const palette = [
		['#0f766e', '#115e59'],
		['#1d4ed8', '#1e3a8a'],
		['#7c3aed', '#581c87'],
		['#be185d', '#831843'],
		['#b45309', '#7c2d12'],
		['#334155', '#1e293b'],
	]
	let hash = 0
	for (let index = 0; index < name.length; index += 1) {
		hash = (hash * 33 + name.charCodeAt(index)) | 0
	}
	const [from, to] = palette[Math.abs(hash) % palette.length]
	return `linear-gradient(135deg, ${from}, ${to})`
}

function extractRows(response: unknown): ChatbotApiItem[] {
	const wrapped = response as { data?: unknown }
	if (Array.isArray(wrapped?.data)) return wrapped.data as ChatbotApiItem[]
	return unwrapPayload<ChatbotApiItem>(response)
}

function toAgentSummary(row: ChatbotApiItem): AIAgentSummary | null {
	const id = row?.id ? String(row.id) : ''
	if (!id) return null

	return {
		id,
		name: String(row.name || id),
		description: String(row.description || '').trim(),
		model: String(row.model || 'standard_plus_b'),
		status: row.is_active === false ? 'draft' : 'active',
		updatedAt: formatUpdatedAt(row.updated_at || row.created_at),
		watcherEnabled: Boolean(row.watcher_enabled),
	}
}

function AIAgentListPage() {
	const navigate = useNavigate()
	const matches = useMatches()
	const isDetailMode = matches.some((match) =>
		match.routeId.endsWith('$agentId'),
	)
	const [agents, setAgents] = useState<AIAgentSummary[]>([])
	const [loading, setLoading] = useState(true)
	const [creating, setCreating] = useState(false)
	const [deletingId, setDeletingId] = useState<string | null>(null)

	useEffect(() => {
		if (isDetailMode) return
		let active = true

		const load = async () => {
			setLoading(true)
			try {
				const response = await chatbots.list()
				if (!active) return

				const mapped = extractRows(response)
					.map(toAgentSummary)
					.filter((row): row is AIAgentSummary => row !== null)
				setAgents(mapped)
			} catch (error) {
				if (!active) return
				setAgents([])
				toast.error(
					`Failed to load AI agents: ${
						(error as Error | null)?.message || 'Unknown error'
					}`,
				)
			} finally {
				if (active) setLoading(false)
			}
		}

		void load()
		return () => {
			active = false
		}
	}, [isDetailMode])

	const cards = useMemo(() => agents, [agents])

	const handleOpenDetail = (agentId: string) => {
		navigate({
			to: '/ai-agents/$agentId',
			params: { agentId },
		})
	}

	const handleCreate = async () => {
		if (creating) return
		setCreating(true)
		try {
			const response = await chatbots.create({
				name: `AI Agent ${cards.length + 1}`,
				description: 'Ready to configure for WhatsApp automation.',
				model: 'standard_plus_b',
				is_active: true,
			})
			const created =
				(response as { data?: { id?: string }; id?: string }) || {}
			const nextId = String(created.data?.id || created.id || '').trim()
			if (!nextId)
				throw new Error('Created agent response did not include an id')
			toast.success('AI agent created')
			handleOpenDetail(nextId)
		} catch (error) {
			toast.error(
				`Failed to create AI agent: ${
					(error as Error | null)?.message || 'Unknown error'
				}`,
			)
		} finally {
			setCreating(false)
		}
	}

	const handleDelete = async (agentId: string) => {
		const confirmed = window.confirm('Hapus AI agent ini?')
		if (!confirmed) return

		setDeletingId(agentId)
		setAgents((previous) => previous.filter((agent) => agent.id !== agentId))

		try {
			await chatbots.delete(agentId)
			toast.success('AI agent deleted')
		} catch (error) {
			setAgents((previous) => {
				if (previous.some((agent) => agent.id === agentId)) return previous
				const removed = cards.find((agent) => agent.id === agentId)
				if (!removed) return previous
				return [...previous, removed]
			})
			toast.error(
				`Failed to delete AI agent: ${
					(error as Error | null)?.message || 'Unknown error'
				}`,
			)
		} finally {
			setDeletingId(null)
		}
	}

	const handleCopyLink = (agentId: string) => {
		if (typeof window === 'undefined' || !navigator.clipboard) return
		void navigator.clipboard.writeText(
			`${window.location.origin}/ai-agents/${agentId}`,
		)
		toast.success('AI agent link copied')
	}

	if (isDetailMode) {
		return <Outlet />
	}

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="AI Agents"
				subtitle="Pilih AI agent untuk buka detail editor"
			/>

			<div className="grid auto-rows-fr gap-5 md:grid-cols-2 xl:grid-cols-3">
				{cards.map((agent) => {
					const initials = initialsFromName(agent.name)
					const deleting = deletingId === agent.id
					const badgeClass =
						agent.status === 'active'
							? 'ocm-tag ocm-tag-success'
							: 'ocm-tag ocm-tag-warning'

					return (
						<article
							key={agent.id}
							className="ocm-card group relative flex min-h-[320px] flex-col overflow-hidden rounded-[26px] p-6 transition duration-200 hover:-translate-y-1 hover:shadow-xl"
							style={{
								background:
									'linear-gradient(165deg, color-mix(in oklab, var(--ocm-surface) 92%, white 8%) 0%, color-mix(in oklab, var(--ocm-surface-soft) 88%, white 12%) 100%)',
							}}
						>
							<div className="pointer-events-none absolute -right-12 -top-12 h-44 w-44 rounded-full bg-primary/10 blur-2xl transition group-hover:bg-primary/15" />

							<div className="relative z-10 flex items-start justify-between gap-3">
								<div className="min-w-0">
									<p className="line-clamp-2 text-[1.6rem] font-bold leading-tight tracking-tight text-foreground md:text-[1.9rem]">
										{agent.name}
									</p>
									<p className="mt-1 text-sm text-muted-foreground">
										Updated {agent.updatedAt}
									</p>
								</div>
								<span className={badgeClass}>
									{agent.status === 'active' ? 'Active' : 'Draft'}
								</span>
							</div>

							<div className="relative z-10 my-7 flex items-center gap-4">
								<div
									className="grid h-20 w-20 shrink-0 place-items-center rounded-3xl border border-white/20 text-3xl font-semibold text-white shadow-sm"
									style={{ background: avatarGradientFromName(agent.name) }}
								>
									{initials}
								</div>
								<div className="min-w-0 flex-1 space-y-2">
									<div className="flex items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
										<MessageCircle size={14} />
										<span className="truncate">
											{agent.description || 'WhatsApp Conversation Agent'}
										</span>
									</div>
									<div className="flex items-center gap-2 rounded-xl border border-border/80 bg-background/70 px-3 py-2 text-xs text-muted-foreground">
										<Sparkles size={14} />
										<span className="truncate">
											{agent.watcherEnabled
												? 'Auto-reply watcher enabled'
												: `Model ${agent.model}`}
										</span>
									</div>
								</div>
							</div>

							<div className="relative z-10 mt-auto flex items-center gap-2">
								<button
									type="button"
									onClick={(event) => {
										event.stopPropagation()
										handleOpenDetail(agent.id)
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
										handleCopyLink(agent.id)
									}}
									className="ocm-btn h-10 rounded-xl px-3"
									aria-label={`Copy ${agent.name} link`}
								>
									<Copy size={16} />
								</button>
								<button
									type="button"
									disabled={deleting}
									onClick={(event) => {
										event.stopPropagation()
										void handleDelete(agent.id)
									}}
									className="ocm-btn h-10 rounded-xl border-red-300/60 px-3 text-red-500 hover:bg-red-500/10"
									aria-label={`Delete ${agent.name}`}
								>
									<Trash2 size={16} />
								</button>
							</div>
						</article>
					)
				})}

				<button
					type="button"
					onClick={() => void handleCreate()}
					disabled={creating}
					className="ocm-card group relative flex min-h-[320px] flex-col items-center justify-center overflow-hidden rounded-[26px] border border-emerald-400/70 px-6 text-white transition duration-200 hover:-translate-y-1 hover:shadow-xl disabled:cursor-wait disabled:opacity-80"
					style={{
						background:
							'radial-gradient(circle at 20% 20%, rgba(255,255,255,.22) 0, rgba(255,255,255,0) 36%), linear-gradient(135deg, color-mix(in oklab, var(--ocm-success) 84%, #34d399 16%), color-mix(in oklab, var(--ocm-success) 96%, #047857 4%))',
					}}
				>
					<div className="pointer-events-none absolute -left-12 top-8 h-36 w-36 rounded-full border border-white/20 bg-white/10 blur-sm" />
					<div className="pointer-events-none absolute -right-16 bottom-6 h-44 w-44 rounded-full border border-white/20 bg-white/10 blur-sm" />

					<span className="relative z-10 grid h-24 w-24 place-items-center rounded-full bg-white/95 text-emerald-500 shadow-lg">
						{creating ? (
							<Bot className="animate-bounce" size={38} />
						) : (
							<Plus size={38} />
						)}
					</span>
					<p className="relative z-10 mt-8 text-3xl font-bold tracking-tight md:text-5xl">
						Create New
					</p>
					<p className="relative z-10 mt-2 text-sm text-emerald-50/90 md:text-base">
						Start a fresh AI agent and configure behavior
					</p>
					<span className="relative z-10 mt-6 inline-flex items-center gap-2 rounded-full border border-white/35 bg-white/20 px-4 py-1.5 text-sm font-semibold">
						Create AI Agent
						<ArrowUpRight size={16} />
					</span>
				</button>
			</div>

			{loading ? (
				<p className="text-xs text-muted-foreground">Memuat AI agents...</p>
			) : null}
		</main>
	)
}
