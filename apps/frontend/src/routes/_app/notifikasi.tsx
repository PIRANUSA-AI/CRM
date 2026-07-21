import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { CheckCheck, RefreshCw } from 'lucide-react'
import { notifications as notificationsApi, type NotificationItem } from '@/lib/api'
import { CrmSectionHeader, CrmEmptyState } from '@/components/crm/shared'
import { notifNavigate, notifIcon, notifLabel } from '@/lib/notifications-meta'
import { connectSocket } from '@/lib/socket'

export const Route = createFileRoute('/_app/notifikasi')({
	component: NotificationsPage,
})

const PAGE_SIZE = 30

type NotifFilter = {
	value: string
	label: string
	unreadOnly?: boolean
	type?: string
}

const FILTERS: NotifFilter[] = [
	{ value: 'all', label: 'Semua' },
	{ value: 'unread', label: 'Belum dibaca', unreadOnly: true },
	{ value: 'lead_pending', label: 'Lead', type: 'lead_pending' },
	{ value: 'task_urgent', label: 'Mendesak', type: 'task_urgent' },
	{ value: 'task_due', label: 'Jatuh tempo', type: 'task_due' },
	{ value: 'takeover', label: 'Ambil alih', type: 'takeover' },
	{ value: 'ai_draft', label: 'Draf AI', type: 'ai_draft' },
	{ value: 'wa_disconnected', label: 'WhatsApp', type: 'wa_disconnected' },
]

function relativeTime(value: string): { relative: string; absolute: string } {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return { relative: '', absolute: '' }
	const absolute = new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
	const mins = Math.round((Date.now() - date.getTime()) / 60000)
	let relative: string
	if (mins < 1) relative = 'Baru saja'
	else if (mins < 60) relative = `${mins} mnt lalu`
	else if (mins < 1440) relative = `${Math.round(mins / 60)} jam lalu`
	else if (mins < 10080) relative = `${Math.round(mins / 1440)} hari lalu`
	else relative = absolute
	return { relative, absolute }
}

type DateBucket = 'today' | 'yesterday' | 'older'
const BUCKET_LABEL: Record<DateBucket, string> = {
	today: 'Hari ini',
	yesterday: 'Kemarin',
	older: 'Lebih lama',
}

function dateBucket(value: string): DateBucket {
	const date = new Date(value)
	const now = new Date()
	const startToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
	const startYesterday = new Date(startToday.getTime() - 86400000)
	if (date >= startToday) return 'today'
	if (date >= startYesterday) return 'yesterday'
	return 'older'
}

function NotificationsPage() {
	const navigate = useNavigate()
	const [filter, setFilter] = useState('all')
	const [items, setItems] = useState<NotificationItem[]>([])
	const [loading, setLoading] = useState(true)
	const [loadingMore, setLoadingMore] = useState(false)
	const [hasMore, setHasMore] = useState(false)
	const [error, setError] = useState<string | null>(null)

	const activeFilter = FILTERS.find((f) => f.value === filter) || FILTERS[0]

	const fetchPage = useCallback(
		(offset: number) =>
			notificationsApi.list({
				limit: PAGE_SIZE,
				offset,
				unreadOnly: activeFilter.unreadOnly,
				type: activeFilter.type,
			}),
		[activeFilter.unreadOnly, activeFilter.type],
	)

	const reload = useCallback(async () => {
		setLoading(true)
		setError(null)
		try {
			const res = await fetchPage(0)
			const data = res.data || []
			setItems(data)
			setHasMore(data.length === PAGE_SIZE)
		} catch (err: any) {
			setError(err?.message || 'Gagal memuat notifikasi')
		} finally {
			setLoading(false)
		}
	}, [fetchPage])

	useEffect(() => {
		void reload()
	}, [reload])

	// Refresh the current view when a new notification pings in.
	useEffect(() => {
		const socket = connectSocket()
		const onNew = () => void reload()
		socket.on('notification:new', onNew)
		return () => {
			socket.off('notification:new', onNew)
		}
	}, [reload])

	const loadMore = async () => {
		setLoadingMore(true)
		try {
			const res = await fetchPage(items.length)
			const data = res.data || []
			setItems((prev) => [...prev, ...data])
			setHasMore(data.length === PAGE_SIZE)
		} catch {
			/* best-effort */
		} finally {
			setLoadingMore(false)
		}
	}

	const openNotification = (item: NotificationItem) => {
		if (!item.read) {
			setItems((prev) =>
				prev.map((n) => (n.id === item.id ? { ...n, read: true } : n)),
			)
			void notificationsApi.markRead(item.id).catch(() => undefined)
		}
		notifNavigate(navigate, item)
	}

	const markAllRead = async () => {
		setItems((prev) => prev.map((n) => ({ ...n, read: true })))
		await notificationsApi.markAllRead().catch(() => undefined)
		if (activeFilter.unreadOnly) void reload()
	}

	const hasUnread = items.some((n) => !n.read)

	const groups = useMemo(() => {
		const map = new Map<DateBucket, NotificationItem[]>()
		for (const item of items) {
			const bucket = dateBucket(item.createdAt)
			const list = map.get(bucket) || []
			list.push(item)
			map.set(bucket, list)
		}
		return (['today', 'yesterday', 'older'] as DateBucket[])
			.filter((bucket) => map.has(bucket))
			.map((bucket) => ({ bucket, items: map.get(bucket)! }))
	}, [items])

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title="Notifikasi"
				subtitle="Semua pemberitahuan untuk kamu, lead baru, tugas, ambil alih, dan status WhatsApp."
				actions={
					<>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => void reload()}
							disabled={loading}
						>
							<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
							Refresh
						</button>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => void markAllRead()}
							disabled={!hasUnread}
						>
							<CheckCheck size={14} /> Tandai semua dibaca
						</button>
					</>
				}
			/>

			<section className="ocm-card overflow-hidden">
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border p-2">
					{FILTERS.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setFilter(option.value)}
							className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
								filter === option.value
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>

				{error ? (
					<div className="p-4">
						<div className="flex items-start justify-between gap-3 rounded-lg border border-red-500/25 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-300">
							<span>{error}</span>
							<button
								type="button"
								className="shrink-0 font-semibold underline"
								onClick={() => void reload()}
							>
								Coba lagi
							</button>
						</div>
					</div>
				) : loading ? (
					<div className="space-y-2 p-3">
						{Array.from({ length: 5 }).map((_, index) => (
							<div key={index} className="h-16 animate-pulse rounded-lg bg-muted/60" />
						))}
					</div>
				) : items.length === 0 ? (
					<div className="p-4">
						<CrmEmptyState
							title="Belum ada notifikasi"
							description="Notifikasi baru akan muncul di sini begitu ada lead, tugas, atau aktivitas yang butuh perhatianmu."
						/>
					</div>
				) : (
					<>
						{groups.map((group) => (
							<div key={group.bucket}>
								<div className="bg-muted/30 px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
									{BUCKET_LABEL[group.bucket]}
								</div>
								<ul className="divide-y divide-border">
									{group.items.map((item) => {
										const Icon = notifIcon(item.type)
										const time = relativeTime(item.createdAt)
										return (
											<li key={item.id}>
												<button
													type="button"
													onClick={() => openNotification(item)}
													className={`flex w-full items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 ${
														item.read ? '' : 'bg-primary/5'
													}`}
												>
													<span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground">
														<Icon size={16} />
													</span>
													<span className="min-w-0 flex-1">
														<span className="flex flex-wrap items-center gap-2">
															{item.read ? null : (
																<span className="size-1.5 shrink-0 rounded-full bg-primary" />
															)}
															<span
																className={`truncate ${item.read ? 'font-medium' : 'font-semibold'}`}
															>
																{item.title}
															</span>
															<span className="ocm-tag shrink-0">
																{notifLabel(item.type)}
															</span>
														</span>
														{item.body ? (
															<span className="mt-0.5 line-clamp-2 block text-sm text-muted-foreground">
																{item.body}
															</span>
														) : null}
														<span
															className="mt-1 block text-[11px] text-muted-foreground/70"
															title={time.absolute}
														>
															{time.relative}
														</span>
													</span>
												</button>
											</li>
										)
									})}
								</ul>
							</div>
						))}

						{hasMore ? (
							<div className="border-t border-border p-3 text-center">
								<button
									type="button"
									className="ocm-btn"
									onClick={() => void loadMore()}
									disabled={loadingMore}
								>
									{loadingMore ? 'Memuat…' : 'Muat lebih banyak'}
								</button>
							</div>
						) : null}
					</>
				)}
			</section>
		</main>
	)
}
