import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
	customers,
	contactConversations,
	tasks as tasksApi,
	type Task,
	type TimelineEvent,
	API_BASE,
} from '@/lib/api'
import {
	User,
	Mail,
	Phone,
	Calendar,
	MessageSquare,
	Tag,
	Activity,
	ChevronRight,
	ArrowLeft,
	Clock,
	ExternalLink,
	ShieldCheck,
	MapPin,
	Info,
	ListTodo,
	CheckCircle2,
	CirclePlay,
	UserPlus,
	StickyNote,
	Share2,
	Bot,
	ArrowRightLeft,
	GitBranch,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

const TASK_PRIORITY_LABEL: Record<string, string> = {
	low: 'Rendah',
	medium: 'Sedang',
	high: 'Tinggi',
	urgent: 'Mendesak',
}
const TASK_PRIORITY_STYLE: Record<string, string> = {
	low: 'bg-slate-100 text-slate-600',
	medium: 'bg-sky-100 text-sky-700',
	high: 'bg-amber-100 text-amber-700',
	urgent: 'bg-red-100 text-red-700',
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
	manual: 'Manual',
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
	default: 'bg-gray-100 text-gray-500',
	info: 'bg-sky-100 text-sky-600',
	success: 'bg-emerald-100 text-emerald-600',
	warning: 'bg-amber-100 text-amber-600',
}
import PageHeader from '@/components/PageHeader'
import { EditCustomerModal } from '@/components/EditCustomerModal'

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
	const [activeTab, setActiveTab] = useState<
		'overview' | 'conversations' | 'tasks' | 'activity'
	>('overview')
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
			<div className="flex-1 flex items-center justify-center bg-gray-50/50">
				<div className="flex flex-col items-center gap-3">
					<div className="w-10 h-10 border-4 border-emerald-500 border-t-transparent rounded-full animate-spin"></div>
					<p className="text-gray-500 font-medium animate-pulse">
						Loading profile...
					</p>
				</div>
			</div>
		)
	}

	if (!customer) {
		return (
			<div className="flex-1 flex flex-col items-center justify-center p-8 text-center bg-gray-50/50">
				<div className="w-20 h-20 bg-gray-100 rounded-full flex items-center justify-center mb-4">
					<User className="text-gray-400" size={40} />
				</div>
				<h2 className="text-2xl font-bold text-gray-900 mb-2">
					Customer Not Found
				</h2>
				<p className="text-gray-500 mb-8 max-w-sm">
					{error ||
						"The contact you are looking for might have been removed or you don't have permission to view it."}
				</p>
				<button
					onClick={() => navigate({ to: '/customers' })}
					className="px-6 py-2.5 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
				>
					Back to List
				</button>
			</div>
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

	return (
		<main className="flex-1 flex flex-col h-full bg-gray-50/30 overflow-hidden">
			<PageHeader
				title={customer.name}
				description={`Customer from ${customer.source || 'Direct'} • Created ${new Date(customer.created_at!).toLocaleDateString()}`}
				icon={<User size={24} />}
				backButton={
					returnToConversationId
						? undefined
						: {
								to: '/customers',
								label: 'Back to Customers',
							}
				}
				actions={
					<div className="flex items-center gap-3">
						{returnToConversationId && (
							<button
								onClick={() => {
									sessionStorage.removeItem('returnToConversationId')
									navigate({
										to: '/chat',
										search: { conversation_id: returnToConversationId },
									})
								}}
								className="px-4 py-2 bg-emerald-500 text-white rounded-xl font-bold hover:bg-emerald-600 transition-all shadow-sm flex items-center gap-2"
							>
								<ArrowLeft size={16} />
								Back to Chat
							</button>
						)}
						<button
							onClick={() => setShowEditModal(true)}
							className="px-4 py-2 bg-white border border-gray-200 text-gray-700 rounded-xl font-bold hover:bg-gray-50 transition-all shadow-sm flex items-center gap-2"
						>
							Edit Profile
						</button>
					</div>
				}
			/>

			<div className="flex-1 flex flex-col px-4 lg:px-8 pb-8 overflow-hidden">
				{/* Profile Card Header */}
				<div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 mb-6">
					<div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center">
						<div className="shrink-0">
							{customer.avatar_url ? (
								<img
									src={customer.avatar_url}
									className="w-24 h-24 rounded-full object-cover border-4 border-white shadow-xl"
								/>
							) : (
								<div className="w-24 h-24 rounded-full bg-emerald-100 flex items-center justify-center text-emerald-700 text-3xl font-black border-4 border-white shadow-xl uppercase">
									{(customer.name || 'U').charAt(0)}
								</div>
							)}
						</div>

						<div className="flex-1">
							<div className="flex flex-wrap items-center gap-3 mb-2">
								<h2 className="text-2xl font-black text-gray-900">
									{customer.name}
								</h2>
								{customer.pipeline_stage_name && (
									<span
										className="px-3 py-1 rounded-full text-[10px] font-black border uppercase tracking-wider"
										style={{
											backgroundColor: `${customer.pipeline_stage_color}10`,
											color: customer.pipeline_stage_color,
											borderColor: `${customer.pipeline_stage_color}30`,
										}}
									>
										{customer.pipeline_stage_name}
									</span>
								)}
								<span
									className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-wider border ${
										customer.is_window_active
											? 'bg-emerald-50 text-emerald-600 border-emerald-100'
											: 'bg-gray-50 text-gray-400 border-gray-100'
									}`}
								>
									{customer.is_window_active
										? '● Window Active'
										: '○ Window Expired'}
								</span>
							</div>

							<div className="flex flex-wrap gap-4 text-sm text-gray-500 font-medium">
								<div className="flex items-center gap-1.5 hover:text-emerald-600 transition-colors">
									<Mail size={16} />
									{customer.email || 'No email'}
								</div>
								<div className="flex items-center gap-1.5 hover:text-emerald-600 transition-colors">
									<Phone size={16} />
									{customer.phone_number || 'No phone'}
								</div>
								<div className="flex items-center gap-1.5">
									<Calendar size={16} />
									Joined{' '}
									{new Date(customer.created_at!).toLocaleDateString('en-US', {
										month: 'short',
										day: 'numeric',
										year: 'numeric',
									})}
								</div>
							</div>
						</div>

						<div className="flex gap-2 shrink-0">
							<div className="text-center px-6 py-3 bg-gray-50 rounded-2xl border border-gray-100/50">
								<div className="text-2xl font-black text-gray-900">
									{customer.message_count || 0}
								</div>
								<div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
									Messages
								</div>
							</div>
							<div className="text-center px-6 py-3 bg-emerald-50 rounded-2xl border border-emerald-100/50">
								<div className="text-2xl font-black text-emerald-700">
									{customer.lead_score || 0}
								</div>
								<div className="text-[10px] font-bold text-emerald-600 uppercase tracking-widest">
									Lead Score
								</div>
							</div>
						</div>
					</div>
				</div>

				{/* Tabs */}
				<div className="flex items-center gap-1 bg-white p-1 rounded-xl border border-gray-200 w-fit mb-6 shadow-sm">
					<button
						onClick={() => setActiveTab('overview')}
						className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
							activeTab === 'overview'
								? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
								: 'text-gray-500 hover:bg-gray-50'
						}`}
					>
						Overview
					</button>
					<button
						onClick={() => setActiveTab('conversations')}
						className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
							activeTab === 'conversations'
								? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
								: 'text-gray-500 hover:bg-gray-50'
						}`}
					>
						Conversations
					</button>
					<button
						onClick={() => setActiveTab('tasks')}
						className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
							activeTab === 'tasks'
								? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
								: 'text-gray-500 hover:bg-gray-50'
						}`}
					>
						Tugas{contactTasks.length > 0 ? ` (${contactTasks.length})` : ''}
					</button>
					<button
						onClick={() => setActiveTab('activity')}
						className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
							activeTab === 'activity'
								? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
								: 'text-gray-500 hover:bg-gray-50'
						}`}
					>
						Aktivitas{timeline.length > 0 ? ` (${timeline.length})` : ''}
					</button>
				</div>

				{/* Tab Content */}
				<div className="flex-1 overflow-y-auto">
					{activeTab === 'overview' && (
						<div className="grid grid-cols-1 lg:grid-cols-3 gap-6 animate-in slide-in-from-bottom-2 duration-300">
							{/* Left Column: Details */}
							<div className="lg:col-span-2 space-y-6">
								<div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
									<div className="px-6 py-4 border-b border-gray-50 bg-gray-50/30">
										<h3 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
											<Info size={16} className="text-emerald-500" />
											About Customer
										</h3>
									</div>
									<div className='p-6'>
										{customer.notes ? (
											<p className="text-gray-600 leading-relaxed whitespace-pre-wrap">
												{customer.notes}
											</p>
										) : (
											<div className="text-gray-400 italic text-sm py-4">
												No internal notes added yet. Use the edit button to add
												customer background or context.
											</div>
										)}
									</div>
								</div>

								<div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
									<div className="px-6 py-4 border-b border-gray-50 bg-gray-50/30">
										<h3 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
											<ShieldCheck size={16} className="text-emerald-500" />
											Compliance & Data
										</h3>
									</div>
									<div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-8">
										<div>
											<div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
												Consent Status
											</div>
											<div className="flex items-center gap-2">
												<span
													className={`w-3 h-3 rounded-full ${customer.consent_status === 'granted' ? 'bg-emerald-500' : 'bg-gray-300'}`}
												/>
												<span className="font-bold text-gray-900 capitalize">
													{customer.consent_status || 'Unknown'}
												</span>
											</div>
										</div>
										<div>
											<div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
												Data Source
											</div>
											<div className="font-bold text-gray-900 capitalize flex items-center gap-1.5">
												<MapPin size={14} className="text-gray-400" />
												{customer.source || 'Direct Entry'}
											</div>
										</div>
									</div>
								</div>

								{additionalFields.length > 0 && (
									<div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
										<div className="px-6 py-4 border-b border-gray-50 bg-gray-50/30">
											<h3 className="text-sm font-black text-gray-900 uppercase tracking-widest flex items-center gap-2">
												<Info size={16} className="text-emerald-500" />
												Additional Fields
											</h3>
										</div>
										<div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-4">
											{additionalFields.map(([key, value]) => (
												<div key={key}>
													<div className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">
														{key.replace(/_/g, ' ')}
													</div>
													<div className="font-medium text-gray-800 break-words">
														{typeof value === 'boolean'
															? value
																? 'Yes'
																: 'No'
															: String(value)}
													</div>
												</div>
											))}
										</div>
									</div>
								)}
							</div>

							{/* Right Column: Sidebar info */}
							<div className="space-y-6">
								<div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
									<h3 className="text-sm font-black text-gray-900 uppercase tracking-widest mb-4 flex items-center gap-2">
										<Tag size={16} className="text-emerald-500" />
										Customer Tags
									</h3>
									<div className="flex flex-wrap gap-2">
										{customer.tags && customer.tags.length > 0 ? (
											customer.tags.map((tag) => (
												<div
													key={tag.id}
													className="px-3 py-1.5 rounded-lg text-xs font-bold border flex items-center gap-2 transition-all hover:scale-105"
													style={{
														borderColor: '${tag.color}30',
														backgroundColor: '${tag.color}10',
														color: tag.color,
													}}
												>
													<div
														className='w-1.5 h-1.5 rounded-full'
														style={{ backgroundColor: tag.color }}
													/>
													{tag.name}
												</div>
											))
										) : (
											<div className="text-sm text-gray-400 italic py-2">
												No tags assigned.
											</div>
										)}
									</div>
								</div>

								<div className="bg-emerald-950 rounded-2xl p-6 text-white shadow-xl shadow-emerald-950/20 relative overflow-hidden group">
									<div className="absolute -right-4 -bottom-4 opacity-10 blur-xl w-32 h-32 bg-emerald-400 rounded-full group-hover:scale-150 transition-transform duration-1000" />
									<h3 className="text-xs font-black text-emerald-400 uppercase tracking-widest mb-4">
										Quick Insights
									</h3>
									<div className="space-y-4 relative z-10">
										<div>
											<div className="text-[10px] text-emerald-500 font-black uppercase mb-1">
												Loyalty Tier
											</div>
											<div className="text-lg font-black">
												{customer.message_count! > 50
													? '💎 VIP Member'
													: '⭐ Standard Customer'}
											</div>
										</div>
										<div className="pt-4 border-t border-emerald-900">
											<p className="text-xs text-emerald-400 italic">
												"Client often asks about pricing and availability.
												Responds well to template messages."
											</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					)}

					{activeTab === 'conversations' && (
						<div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-300">
							<div className="overflow-x-auto">
								<table className="w-full text-left text-sm">
									<thead className="bg-gray-50/50 border-b border-gray-100">
										<tr>
											<th className="px-6 py-4 font-black text-gray-500 uppercase text-[10px] tracking-widest">
												Inbox / Channel
											</th>
											<th className="px-6 py-4 font-black text-gray-500 uppercase text-[10px] tracking-widest">
												Last Message
											</th>
											<th className="px-6 py-4 font-black text-gray-500 uppercase text-[10px] tracking-widest">
												Date
											</th>
											<th className="px-6 py-4 font-black text-gray-500 uppercase text-[10px] tracking-widest">
												Status
											</th>
											<th className='px-6 py-4'></th>
										</tr>
									</thead>
									<tbody className="divide-y divide-gray-50">
										{conversations.length === 0 ? (
											<tr>
												<td
													colSpan={5}
													className="px-6 py-12 text-center text-gray-400 italic"
												>
													No conversations history found.
												</td>
											</tr>
										) : (
											conversations.map((conv) => (
												<tr
													key={conv.id}
													className="hover:bg-gray-50/30 transition-colors group"
												>
													<td className='px-6 py-4'>
														<div className='flex items-center gap-3'>
															<div className="w-8 h-8 rounded-lg bg-gray-100 flex items-center justify-center shrink-0">
																<MessageSquare
																	size={16}
																	className='text-gray-500'
																/>
															</div>
															<div>
																<div className='font-bold text-gray-900'>
																	{conv.inbox_name || 'Direct Channel'}
																</div>
																<div className="text-[10px] text-gray-400 uppercase font-black">
																	{conv.channel_type}
																</div>
															</div>
														</div>
													</td>
													<td className='px-6 py-4'>
														<div className="text-gray-600 line-clamp-1 max-w-xs">
															{conv.last_message || 'No content'}
														</div>
													</td>
													<td className="px-6 py-4 text-gray-400 text-xs font-medium">
														{conv.last_message_at
															? new Date(
																	conv.last_message_at,
																).toLocaleDateString()
															: 'N/A'}
													</td>
													<td className='px-6 py-4'>
														<span
															className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase border ${
																conv.status === 'open'
																	? 'bg-blue-50 text-blue-600 border-blue-100'
																	: 'bg-gray-50 text-gray-400 border-gray-100'
															}`}
														>
															{conv.status}
														</span>
													</td>
													<td className='px-6 py-4 text-right'>
														<Link
															to="/chat"
															search={{ conversation_id: conv.id }}
															className="text-emerald-500 opacity-0 group-hover:opacity-100 transition-all font-bold text-xs flex items-center gap-1 justify-end"
														>
															Go to Chat <ChevronRight size={14} />
														</Link>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						</div>
					)}

					{activeTab === 'tasks' && (
						<div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden animate-in slide-in-from-bottom-2 duration-300">
							{contactTasks.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
										<ListTodo className="text-gray-300" size={32} />
									</div>
									<h3 className="text-lg font-bold text-gray-900 mb-1">
										Belum ada tugas
									</h3>
									<p className="text-sm text-gray-400 max-w-xs">
										Tugas follow-up untuk pelanggan ini akan muncul di sini
										setelah lead di-assign atau dianalisis.
									</p>
								</div>
							) : (
								<ul className="divide-y divide-gray-50">
									{contactTasks.map((task) => {
										const isActive =
											task.status === 'open' || task.status === 'in_progress'
										const busy = taskBusy === task.id
										return (
											<li
												key={task.id}
												className="flex flex-col gap-4 p-5 lg:flex-row lg:items-center"
											>
												<div className="min-w-0 flex-1">
													<div className="mb-1 flex flex-wrap items-center gap-2">
														<span
															className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${TASK_PRIORITY_STYLE[task.priority] || ''}`}
														>
															{TASK_PRIORITY_LABEL[task.priority] || task.priority}
														</span>
														<span className="rounded-full bg-gray-100 px-2 py-0.5 text-[11px] font-semibold text-gray-500">
															{TASK_ACTION_LABEL[task.actionKind] || task.actionKind}
														</span>
														<span className="text-[11px] text-gray-400">
															{TASK_STATUS_LABEL[task.status] || task.status}
														</span>
													</div>
													<p className="font-bold text-gray-900">{task.title}</p>
													{task.description ? (
														<p className="mt-1 text-sm text-gray-500">
															{task.description}
														</p>
													) : null}
													<div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
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
															className="flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-xs font-bold text-gray-700 transition hover:bg-gray-50 disabled:opacity-50"
														>
															<CirclePlay size={14} /> Mulai
														</button>
													) : null}
													{isActive ? (
														<button
															type="button"
															disabled={busy}
															onClick={() => runTaskAction(task.id, 'complete')}
															className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-2 text-xs font-bold text-white transition hover:bg-emerald-600 disabled:opacity-50"
														>
															<CheckCircle2 size={14} /> {busy ? '...' : 'Selesai'}
														</button>
													) : null}
												</div>
											</li>
										)
									})}
								</ul>
							)}
						</div>
					)}

					{activeTab === 'activity' && (
						<div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 lg:p-8 animate-in slide-in-from-bottom-2 duration-300">
							{timeline.length === 0 ? (
								<div className="flex flex-col items-center justify-center py-12 text-center">
									<div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
										<Activity className="text-gray-300" size={32} />
									</div>
									<h3 className="text-lg font-bold text-gray-900 mb-1">
										Belum ada aktivitas
									</h3>
									<p className="text-sm text-gray-400 max-w-xs">
										Riwayat interaksi tim dengan lead ini — tugas, catatan,
										handover, dan perubahan tahap — akan muncul di sini.
									</p>
								</div>
							) : (
								<ol className="relative">
									{timeline.map((event, index) => {
										const Icon = timelineIcon(event.type)
										const time = formatTimelineTime(event.at)
										const isLast = index === timeline.length - 1
										return (
											<li key={event.id} className="relative flex gap-4 pb-6 last:pb-0">
												{!isLast && (
													<span
														className="absolute left-[19px] top-10 bottom-0 w-px bg-gray-100"
														aria-hidden
													/>
												)}
												<span
													className={`relative z-10 grid h-10 w-10 shrink-0 place-items-center rounded-full ${
														TIMELINE_TONE[event.tone] || TIMELINE_TONE.default
													}`}
												>
													<Icon size={18} />
												</span>
												<div className="min-w-0 flex-1 pt-1">
													<div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
														<p className="font-bold text-gray-900">{event.title}</p>
														<span
															className="shrink-0 text-xs text-gray-400"
															title={time.absolute}
														>
															{time.relative}
														</span>
													</div>
													{event.description && (
														<p className="mt-0.5 text-sm text-gray-500 break-words line-clamp-3">
															{event.description}
														</p>
													)}
													{event.actorName && (
														<p className="mt-1 text-xs font-medium text-gray-400">
															oleh {event.actorName}
														</p>
													)}
												</div>
											</li>
										)
									})}
								</ol>
							)}
						</div>
					)}
				</div>
			</div>

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
