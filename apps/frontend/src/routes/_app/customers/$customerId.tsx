import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
	customers,
	contactConversations,
	opportunities as opportunitiesApi,
	sakti as saktiApi,
	tasks as tasksApi,
	type Task,
	type TimelineEvent,
} from '@/lib/api'
import { toast } from 'sonner'
import {
	Mail,
	Phone,
	Calendar,
	MessageSquare,
	Tag,
	Activity,
	ChevronRight,
	ArrowLeft,
	Clock,
	ShieldCheck,
	MapPin,
	Info,
	ListTodo,
	CheckCircle2,
	CirclePlay,
	Target,
	UserRound,
	UserPlus,
	StickyNote,
	Share2,
	Bot,
	ArrowRightLeft,
	GitBranch,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { CrmAvatar, CrmSectionHeader, CrmEmptyState } from '@/components/crm/shared'
import { EditCustomerModal } from '@/components/EditCustomerModal'

const TASK_PRIORITY_LABEL: Record<string, string> = {
	low: 'Rendah',
	medium: 'Sedang',
	high: 'Tinggi',
	urgent: 'Mendesak',
}
const TASK_PRIORITY_STYLE: Record<string, string> = {
	low: 'ocm-tag',
	medium: 'ocm-tag',
	high: 'ocm-tag ocm-tag-warning',
	urgent: 'ocm-tag ocm-tag-danger',
}
const TASK_STATUS_LABEL: Record<string, string> = {
	open: 'Belum dimulai',
	in_progress: 'Sedang dikerjakan',
	done: 'Selesai',
	cancelled: 'Dibatalkan',
}
const TASK_ACTION_LABEL: Record<string, string> = {
	reply_now: 'Balas sekarang',
	follow_up: 'Tindak lanjut',
	qualify_lead: 'Kualifikasi lead',
	handover_review: 'Tinjau handover',
	prospect_followup: 'Prospek',
	manual: 'Manual',
}

function formatDate(value?: string | null) {
	if (!value) return '—'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return '—'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
	}).format(date)
}

function formatTaskDue(value: string | null) {
	if (!value) return 'Tanpa tenggat'
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return 'Tanpa tenggat'
	return new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)
}

// Absolute + short relative time for the activity timeline.
function formatTimelineTime(value: string): { absolute: string; relative: string } {
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) return { absolute: '', relative: '' }
	const absolute = new Intl.DateTimeFormat('id-ID', {
		day: 'numeric',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
	}).format(date)

	const diffMs = Date.now() - date.getTime()
	const mins = Math.round(diffMs / 60000)
	let relative: string
	if (mins < 1) relative = 'Baru saja'
	else if (mins < 60) relative = `${mins} mnt lalu`
	else if (mins < 1440) relative = `${Math.round(mins / 60)} jam lalu`
	else if (mins < 10080) relative = `${Math.round(mins / 1440)} hari lalu`
	else relative = absolute
	return { absolute, relative }
}

// Icon + accent color per timeline event type (prefix-matched).
const TIMELINE_ICON: Array<{ match: (type: string) => boolean; icon: LucideIcon }> = [
	{ match: (t) => t === 'lead_created', icon: UserPlus },
	{ match: (t) => t === 'note_added', icon: StickyNote },
	{ match: (t) => t.startsWith('handover'), icon: Share2 },
	{ match: (t) => t === 'assignment', icon: ArrowRightLeft },
	{ match: (t) => t === 'stage_change', icon: GitBranch },
	{ match: (t) => t === 'task_replied_whatsapp', icon: MessageSquare },
	{ match: (t) => t === 'task_ai_analyzed', icon: Bot },
	{ match: (t) => t === 'task_completed', icon: CheckCircle2 },
	{ match: (t) => t.startsWith('task_'), icon: ListTodo },
]

function timelineIcon(type: string): LucideIcon {
	return TIMELINE_ICON.find((entry) => entry.match(type))?.icon || Activity
}

const TIMELINE_TONE: Record<string, string> = {
	default: 'bg-muted text-muted-foreground',
	info: 'bg-sky-500/15 text-sky-600 dark:text-sky-400',
	success: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
	warning: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
}

export const Route = createFileRoute('/_app/customers/$customerId')({
	component: CustomerDetail,
})

interface Customer {
	id: string
	name: string
	email?: string
	phone_number?: string
	avatar_url?: string
	source?: string
	created_at?: string
	pipeline_stage_id?: string
	pipeline_stage_name?: string
	pipeline_stage_color?: string
	is_window_active?: boolean
	message_count?: number
	notes?: string
	lead_score?: number
	consent_status?: string
	custom_attributes?: Record<string, any>
	tags?: Array<{ id: string; name: string; color: string }>
}

interface Conversation {
	id: string
	status: string
	channel_type: string
	last_message?: string
	last_message_at?: string
	inbox_name?: string
}

type CustomerTab = 'overview' | 'conversations' | 'tasks' | 'activity'

function CustomerDetail() {
	const { customerId } = Route.useParams()
	const navigate = useNavigate()
	const [customer, setCustomer] = useState<Customer | null>(null)
	const [conversations, setConversations] = useState<Conversation[]>([])
	const [contactTasks, setContactTasks] = useState<Task[]>([])
	const [timeline, setTimeline] = useState<TimelineEvent[]>([])
	const [taskBusy, setTaskBusy] = useState<string | null>(null)
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<CustomerTab>('overview')
	const [showEditModal, setShowEditModal] = useState(false)
	const [returnToConversationId, setReturnToConversationId] = useState<
		string | null
	>(null)

	useEffect(() => {
		loadData()
		// Check if we came from a conversation
		const storedConvId = sessionStorage.getItem('returnToConversationId')
		if (storedConvId) {
			setReturnToConversationId(storedConvId)
		}
	}, [customerId])

	const loadData = async () => {
		setLoading(true)
		try {
			const [customerRes, convsRes, tasksRes, timelineRes]: any = await Promise.all([
				customers.get(customerId),
				contactConversations.list(customerId),
				tasksApi.list({ contactId: customerId, limit: 50 }).catch(() => ({ data: [] })),
				customers.timeline(customerId).catch(() => ({ payload: [] })),
			])

			setCustomer(customerRes.payload)
			setConversations(
				Array.isArray(convsRes?.payload)
					? convsRes.payload
					: Array.isArray(convsRes?.data)
						? convsRes.data
						: [],
			)
			setContactTasks(Array.isArray(tasksRes?.data) ? tasksRes.data : [])
			setTimeline(Array.isArray(timelineRes?.payload) ? timelineRes.payload : [])
		} catch (error: any) {
			console.error('Failed to load customer details:', error)
			setError(error.message || 'Failed to load data')
		} finally {
			setLoading(false)
		}
	}

	const handleUpdate = async (data: Partial<Customer>) => {
		try {
			await customers.update(customerId, data)
			loadData()
		} catch (error) {
			console.error('Update failed:', error)
			throw error
		}
	}

	const [promoting, setPromoting] = useState(false)
	const promoteToOpportunity = async () => {
		if (!customer) return
		setPromoting(true)
		try {
			await opportunitiesApi.create({
				contactId: customer.id,
				name: customer.name,
				product:
					(customer.custom_attributes?.product_interest as string) || undefined,
			})
			toast.success('Lead dijadikan opportunity')
			navigate({ to: '/opportunity' })
		} catch (err: any) {
			toast.error(err?.message || 'Gagal membuat opportunity')
		} finally {
			setPromoting(false)
		}
	}

	const [checkingSakti, setCheckingSakti] = useState(false)
	const checkSakti = async () => {
		if (!customer) return
		setCheckingSakti(true)
		try {
			const company =
				(customer.custom_attributes?.company as string) ||
				(customer.custom_attributes?.instansi as string) ||
				undefined
			const res = await saktiApi.check({ name: customer.name, company })
			const result = res.payload
			if (!result.matched) {
				toast.success(result.message)
				return
			}
			toast.warning(result.message)
			if (window.confirm('Lisensi ditemukan di vendor lain. Buat Surat Sakti sekarang?')) {
				await saktiApi.letters.create({
					customerName: customer.name,
					company,
					contactId: customer.id,
					fromVendor: result.records[0]?.vendor || undefined,
					product: result.records[0]?.product || undefined,
					saktiRecordId: result.records[0]?.id || undefined,
				})
				toast.success('Surat Sakti dibuat — buka menu Database Sakti › Surat Sakti')
			}
		} catch (err: any) {
			toast.error(err?.message || 'Gagal cek Sakti')
		} finally {
			setCheckingSakti(false)
		}
	}

	const runTaskAction = async (taskId: string, action: 'start' | 'complete') => {
		setTaskBusy(taskId)
		try {
			if (action === 'start') await tasksApi.start(taskId)
			else await tasksApi.complete(taskId)
			await loadData()
		} catch (error) {
			console.error('Task action failed:', error)
		} finally {
			setTaskBusy(null)
		}
	}

	if (loading) {
		return (
			<main className="ocm-page items-center justify-center">
				<div className="flex flex-col items-center gap-3">
					<div className="size-9 animate-spin rounded-full border-4 border-primary border-t-transparent" />
					<p className="text-sm font-medium text-muted-foreground">
						Memuat profil…
					</p>
				</div>
			</main>
		)
	}

	if (!customer) {
		return (
			<main className="ocm-page">
				<CrmEmptyState
					title="Customer tidak ditemukan"
					description={
						error ||
						'Kontak yang kamu cari mungkin sudah dihapus atau kamu tidak punya akses.'
					}
					action={
						<button
							type="button"
							className="ocm-btn ocm-btn-primary"
							onClick={() => navigate({ to: '/customers' })}
						>
							Kembali ke daftar
						</button>
					}
				/>
			</main>
		)
	}

	const reservedAttributeKeys = new Set([
		'notes',
		'lead_score',
		'pipeline_stage_id',
		'pipeline_stage_name',
		'pipeline_stage_color',
		'consent_purpose',
		'consent_source',
	])

	const additionalFields = Object.entries(customer.custom_attributes || {}).filter(
		([key, value]) => !reservedAttributeKeys.has(key) && value !== null && value !== '',
	)

	const TAB_OPTIONS: Array<{ value: CustomerTab; label: string }> = [
		{ value: 'overview', label: 'Ringkasan' },
		{ value: 'conversations', label: 'Percakapan' },
		{
			value: 'tasks',
			label: `Tugas${contactTasks.length > 0 ? ` (${contactTasks.length})` : ''}`,
		},
		{
			value: 'activity',
			label: `Aktivitas${timeline.length > 0 ? ` (${timeline.length})` : ''}`,
		},
	]

	return (
		<main className="ocm-page space-y-5">
			<CrmSectionHeader
				title={customer.name}
				subtitle={`Dari ${customer.source || 'Direct'} • Bergabung ${formatDate(customer.created_at)}`}
				actions={
					<>
						{returnToConversationId ? (
							<button
								type="button"
								className="ocm-btn ocm-btn-primary"
								onClick={() => {
									sessionStorage.removeItem('returnToConversationId')
									navigate({
										to: '/chat',
										search: { conversation_id: returnToConversationId },
									})
								}}
							>
								<ArrowLeft size={14} /> Kembali ke Chat
							</button>
						) : (
							<Link to="/customers" className="ocm-btn">
								<ArrowLeft size={14} /> Pelanggan
							</Link>
						)}
						<button
							type="button"
							className="ocm-btn"
							onClick={() => void checkSakti()}
							disabled={checkingSakti}
						>
							<ShieldCheck size={14} /> Cek Sakti
						</button>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => void promoteToOpportunity()}
							disabled={promoting}
						>
							<Target size={14} /> Jadikan Opportunity
						</button>
						<button
							type="button"
							className="ocm-btn"
							onClick={() => setShowEditModal(true)}
						>
							Edit Profil
						</button>
					</>
				}
			/>

			{/* Profile header card */}
			<section className="ocm-card p-5">
				<div className="flex flex-col gap-5 lg:flex-row lg:items-center">
					<CrmAvatar
						name={customer.name}
						imageUrl={customer.avatar_url}
						size={72}
						online={customer.is_window_active}
					/>

					<div className="min-w-0 flex-1">
						<div className="flex flex-wrap items-center gap-2">
							<h2 className="text-xl font-bold">{customer.name}</h2>
							{customer.pipeline_stage_name ? (
								<span
									className="rounded-full border px-2.5 py-0.5 text-[11px] font-semibold"
									style={{
										backgroundColor: `${customer.pipeline_stage_color}1a`,
										color: customer.pipeline_stage_color || undefined,
										borderColor: `${customer.pipeline_stage_color}40`,
									}}
								>
									{customer.pipeline_stage_name}
								</span>
							) : null}
							<span
								className={`ocm-tag ${customer.is_window_active ? 'ocm-tag-success' : ''}`}
							>
								{customer.is_window_active
									? '● Window aktif'
									: '○ Window tertutup'}
							</span>
						</div>

						<div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
							<span className="inline-flex items-center gap-1.5">
								<Mail size={14} /> {customer.email || 'Tanpa email'}
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Phone size={14} /> {customer.phone_number || 'Tanpa telepon'}
							</span>
							<span className="inline-flex items-center gap-1.5">
								<Calendar size={14} /> Bergabung {formatDate(customer.created_at)}
							</span>
						</div>
					</div>

					<div className="flex gap-2">
						<div className="rounded-xl border border-border bg-muted/40 px-5 py-3 text-center">
							<div className="text-2xl font-bold leading-none">
								{customer.message_count || 0}
							</div>
							<div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
								Pesan
							</div>
						</div>
						<div className="rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-5 py-3 text-center">
							<div className="text-2xl font-bold leading-none text-emerald-600 dark:text-emerald-400">
								{customer.lead_score || 0}
							</div>
							<div className="mt-1 text-[10px] font-semibold uppercase tracking-widest text-emerald-600/80 dark:text-emerald-400/80">
								Lead Score
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* Tabs */}
			<section className="ocm-card overflow-hidden">
				<div className="flex items-center gap-1 overflow-x-auto border-b border-border p-2">
					{TAB_OPTIONS.map((option) => (
						<button
							key={option.value}
							type="button"
							onClick={() => setActiveTab(option.value)}
							className={`whitespace-nowrap rounded-md px-3 py-1.5 text-xs font-semibold transition-colors ${
								activeTab === option.value
									? 'bg-primary/15 text-primary'
									: 'text-muted-foreground hover:text-foreground'
							}`}
						>
							{option.label}
						</button>
					))}
				</div>

				<div className="p-4">
					{activeTab === 'overview' && (
						<div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
							<div className="space-y-4 lg:col-span-2">
								<div className="ocm-card">
									<div className="ocm-card-header">
										<span className="ocm-card-title inline-flex items-center gap-2">
											<Info size={14} className="text-primary" /> Tentang Customer
										</span>
									</div>
									<div className="ocm-card-body">
										{customer.notes ? (
											<p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
												{customer.notes}
											</p>
										) : (
											<p className="text-sm italic text-muted-foreground">
												Belum ada catatan internal. Gunakan tombol Edit Profil
												untuk menambah konteks customer.
											</p>
										)}
									</div>
								</div>

								<div className="ocm-card">
									<div className="ocm-card-header">
										<span className="ocm-card-title inline-flex items-center gap-2">
											<ShieldCheck size={14} className="text-primary" /> Kepatuhan
											& Data
										</span>
									</div>
									<div className="ocm-card-body grid grid-cols-1 gap-6 md:grid-cols-2">
										<div>
											<div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
												Status Consent
											</div>
											<div className="flex items-center gap-2">
												<span
													className={`size-2.5 rounded-full ${customer.consent_status === 'granted' ? 'bg-emerald-500' : 'bg-muted-foreground/40'}`}
												/>
												<span className="font-semibold capitalize">
													{customer.consent_status || 'Tidak diketahui'}
												</span>
											</div>
										</div>
										<div>
											<div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
												Sumber Data
											</div>
											<div className="inline-flex items-center gap-1.5 font-semibold capitalize">
												<MapPin size={14} className="text-muted-foreground" />
												{customer.source || 'Direct Entry'}
											</div>
										</div>
									</div>
								</div>

								{additionalFields.length > 0 && (
									<div className="ocm-card">
										<div className="ocm-card-header">
											<span className="ocm-card-title inline-flex items-center gap-2">
												<Info size={14} className="text-primary" /> Field
												Tambahan
											</span>
										</div>
										<div className="ocm-card-body grid grid-cols-1 gap-4 md:grid-cols-2">
											{additionalFields.map(([key, value]) => (
												<div key={key}>
													<div className="mb-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
														{key.replace(/_/g, ' ')}
													</div>
													<div className="break-words text-sm font-medium">
														{typeof value === 'boolean'
															? value
																? 'Ya'
																: 'Tidak'
															: String(value)}
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</div>

							<div className="space-y-4">
								<div className="ocm-card">
									<div className="ocm-card-header">
										<span className="ocm-card-title inline-flex items-center gap-2">
											<Tag size={14} className="text-primary" /> Tag Customer
										</span>
									</div>
									<div className="ocm-card-body flex flex-wrap gap-2">
										{customer.tags && customer.tags.length > 0 ? (
											customer.tags.map((tag) => (
												<span
													key={tag.id}
													className="inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold"
													style={{
														borderColor: `${tag.color}40`,
														backgroundColor: `${tag.color}1a`,
														color: tag.color,
													}}
												>
													<span
														className="size-1.5 rounded-full"
														style={{ backgroundColor: tag.color }}
													/>
													{tag.name}
												</span>
											))
										) : (
											<span className="text-sm italic text-muted-foreground">
												Belum ada tag.
											</span>
										)}
									</div>
								</div>
							</div>
						</div>
					)}

					{activeTab === 'conversations' && (
						<>
							{conversations.length === 0 ? (
								<CrmEmptyState
									title="Belum ada percakapan"
									description="Riwayat percakapan customer ini akan muncul di sini."
								/>
							) : (
								<div className="ocm-card overflow-hidden">
									<div className="overflow-x-auto">
										<table className="ocm-table">
											<thead>
												<tr>
													<th>Inbox / Channel</th>
													<th>Pesan Terakhir</th>
													<th>Tanggal</th>
													<th>Status</th>
													<th />
												</tr>
											</thead>
											<tbody>
												{conversations.map((conv) => (
													<tr key={conv.id} className="group">
														<td>
															<div className="flex items-center gap-3">
																<span className="grid size-8 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
																	<MessageSquare size={15} />
																</span>
																<div>
																	<div className="font-semibold">
																		{conv.inbox_name || 'Direct Channel'}
																	</div>
																	<div className="text-[10px] font-semibold uppercase text-muted-foreground">
																		{conv.channel_type}
																	</div>
																</div>
															</div>
														</td>
														<td>
															<div className="line-clamp-1 max-w-xs text-muted-foreground">
																{conv.last_message || 'Tanpa isi'}
															</div>
														</td>
														<td className="text-muted-foreground">
															{conv.last_message_at
																? formatDate(conv.last_message_at)
																: '—'}
														</td>
														<td>
															<span
																className={`ocm-tag ${conv.status === 'open' ? 'ocm-tag-success' : ''}`}
															>
																{conv.status}
															</span>
														</td>
														<td className="text-right">
															<Link
																to="/chat"
																search={{ conversation_id: conv.id }}
																className="inline-flex items-center gap-1 text-xs font-semibold text-primary opacity-0 transition-opacity group-hover:opacity-100"
															>
																Buka Chat <ChevronRight size={13} />
															</Link>
														</td>
													</tr>
												))}
											</tbody>
										</table>
									</div>
								</div>
							)}
						</>
					)}

					{activeTab === 'tasks' && (
						<>
							{contactTasks.length === 0 ? (
								<CrmEmptyState
									title="Belum ada tugas"
									description="Tugas follow-up untuk customer ini akan muncul di sini setelah lead di-assign atau dianalisis."
								/>
							) : (
								<ul className="ocm-card divide-y divide-border overflow-hidden">
									{contactTasks.map((task) => {
										const isActive =
											task.status === 'open' || task.status === 'in_progress'
										const busy = taskBusy === task.id
										return (
											<li
												key={task.id}
												className="flex flex-col gap-3 p-4 lg:flex-row lg:items-center"
											>
												<div className="min-w-0 flex-1">
													<div className="mb-1 flex flex-wrap items-center gap-2">
														<span
															className={TASK_PRIORITY_STYLE[task.priority] || 'ocm-tag'}
														>
															{TASK_PRIORITY_LABEL[task.priority] || task.priority}
														</span>
														<span className="ocm-tag">
															{TASK_ACTION_LABEL[task.actionKind] || task.actionKind}
														</span>
														{task.teamName ? (
															<span className="rounded-full bg-primary/15 px-2 py-0.5 text-[11px] font-semibold text-primary">
																{task.teamName}
															</span>
														) : null}
														<span className="text-[11px] text-muted-foreground">
															{TASK_STATUS_LABEL[task.status] || task.status}
														</span>
													</div>
													<p className="font-semibold">{task.title}</p>
													{task.description ? (
														<p className="mt-1 text-sm text-muted-foreground">
															{task.description}
														</p>
													) : null}
													<div className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
														<Clock size={13} />
														{formatTaskDue(task.dueAt)}
													</div>
												</div>
												<div className="flex shrink-0 gap-2">
													{task.status === 'open' ? (
														<button
															type="button"
															disabled={busy}
															onClick={() => runTaskAction(task.id, 'start')}
															className="ocm-btn disabled:opacity-50"
														>
															<CirclePlay size={14} /> Mulai
														</button>
													) : null}
													{isActive ? (
														<button
															type="button"
															disabled={busy}
															onClick={() => runTaskAction(task.id, 'complete')}
															className="ocm-btn ocm-btn-primary disabled:opacity-50"
														>
															<CheckCircle2 size={14} /> {busy ? '…' : 'Selesai'}
														</button>
													) : null}
												</div>
											</li>
										)
									})}
								</ul>
							)}
						</>
					)}

					{activeTab === 'activity' && (
						<>
							{timeline.length === 0 ? (
								<CrmEmptyState
									title="Belum ada aktivitas"
									description="Riwayat interaksi tim dengan lead ini — tugas, catatan, handover, dan perubahan tahap — akan muncul di sini."
								/>
							) : (
								<ol className="relative px-1 py-1">
									{timeline.map((event, index) => {
										const Icon = timelineIcon(event.type)
										const time = formatTimelineTime(event.at)
										const isLast = index === timeline.length - 1
										return (
											<li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
												{!isLast && (
													<span
														className="absolute bottom-0 left-[19px] top-10 w-px bg-border"
														aria-hidden
													/>
												)}
												<span
													className={`relative z-10 grid size-10 shrink-0 place-items-center rounded-full ${
														TIMELINE_TONE[event.tone] || TIMELINE_TONE.default
													}`}
												>
													<Icon size={18} />
												</span>
												<div className="min-w-0 flex-1 pt-1">
													<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
														<p className="font-semibold">{event.title}</p>
														<span
															className="shrink-0 text-xs text-muted-foreground"
															title={time.absolute}
														>
															{time.relative}
														</span>
													</div>
													{event.description && (
														<p className="mt-0.5 line-clamp-3 break-words text-sm text-muted-foreground">
															{event.description}
														</p>
													)}
													{event.actorName && (
														<p className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-muted-foreground">
															<UserRound size={12} /> {event.actorName}
														</p>
													)}
												</div>
											</li>
										)
									})}
								</ol>
							)}
						</>
					)}
				</div>
			</section>

			{showEditModal && (
				<EditCustomerModal
					customer={customer}
					onSave={handleUpdate}
					onClose={() => setShowEditModal(false)}
				/>
			)}
		</main>
	)
}
