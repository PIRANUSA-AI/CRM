import { createFileRoute, useNavigate, Link } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { customers, contactConversations, API_BASE } from '@/lib/api'
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
} from 'lucide-react'
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
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState<string | null>(null)
	const [activeTab, setActiveTab] = useState<
		'overview' | 'conversations' | 'activity'
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
			const [customerRes, convsRes]: any = await Promise.all([
				customers.get(customerId),
				contactConversations.list(customerId),
				])

				setCustomer(customerRes.payload)
				setConversations(
					Array.isArray(convsRes?.payload)
						? convsRes.payload
						: Array.isArray(convsRes?.data)
							? convsRes.data
							: [],
				)
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
						onClick={() => setActiveTab('activity')}
						className={`px-6 py-2 rounded-lg text-sm font-bold transition-all ${
							activeTab === 'activity'
								? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
								: 'text-gray-500 hover:bg-gray-50'
						}`}
					>
						Activity Logs
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

					{activeTab === 'activity' && (
						<div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 animate-in slide-in-from-bottom-2 duration-300">
							<div className="flex flex-col items-center justify-center py-12 text-center">
								<div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mb-4">
									<Activity className="text-gray-300" size={32} />
								</div>
								<h3 className="text-lg font-bold text-gray-900 mb-1">
									No major activity yet
								</h3>
								<p className="text-sm text-gray-400 max-w-xs">
									Detailed audit logs for this contact will appear here as they
									interact with your team.
								</p>
							</div>
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
