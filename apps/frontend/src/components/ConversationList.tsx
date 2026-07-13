import { useState } from 'react'
import { Input } from './ui/input'
import { Badge } from './ui/badge'
import { Search, MessageCircle, Instagram, Music2, Globe } from 'lucide-react'
import AdvancedFilter from './AdvancedFilter'
import OrderBy from './OrderBy'

interface FilterRule {
	id: string
	field: string
	operator: string
	value: string
}

interface Conversation {
	id: string
	inbox_id: string
	meta: {
		sender: {
			id?: string
			name: string
			email?: string
			phone_number?: string
			thumbnail?: string
		}
		assignee?: {
			id?: string
			name: string
			email?: string
		}
	}
	status: 'open' | 'resolved' | 'pending'
	channel_type: 'whatsapp' | 'instagram' | 'tiktok' | 'web'
	unread_count: number
	timestamp: number
	contact_last_seen_at?: number
	agent_last_seen_at?: number
	additional_attributes?: any
}

interface Props {
	conversations: Conversation[]
	selectedConversation: Conversation | null
	onSelectConversation: (convo: Conversation | null) => void
	loading: boolean
	assigneeType: 'all' | 'unassigned' | 'assigned' | 'resolved'
	onAssigneeTypeChange: (
		type: 'all' | 'unassigned' | 'assigned' | 'resolved',
	) => void
	title?: string
}

export default function ConversationList({
	conversations,
	selectedConversation,
	onSelectConversation,
	loading,
	assigneeType,
	onAssigneeTypeChange,
	title = 'Conversations',
}: Props) {
	const [searchQuery, setSearchQuery] = useState('')
	const [advancedFilters, setAdvancedFilters] = useState<FilterRule[]>([])
	const [orderBy, setOrderBy] = useState('last_activity')
	const [orderDirection, setOrderDirection] = useState<'asc' | 'desc'>('desc')

	const sortConversations = (convos: Conversation[]) => {
		const sorted = [...convos]
		sorted.sort((a, b) => {
			let aVal: any = a
			let bVal: any = b

			switch (orderBy) {
				case 'last_activity':
					aVal = a.timestamp
					bVal = b.timestamp
					break
				case 'created_at':
					aVal = a.timestamp
					bVal = b.timestamp
					break
				case 'unread_count':
					aVal = a.unread_count
					bVal = b.unread_count
					break
				case 'sender_name':
					aVal = a.meta.sender.name.toLowerCase()
					bVal = b.meta.sender.name.toLowerCase()
					break
				default:
					aVal = a.timestamp
					bVal = b.timestamp
			}

			if (typeof aVal === 'string' && typeof bVal === 'string') {
				return orderDirection === 'desc'
					? bVal.localeCompare(aVal)
					: aVal.localeCompare(bVal)
			}
			return orderDirection === 'desc' ? bVal - aVal : aVal - bVal
		})
		return sorted
	}

	const applyAdvancedFilters = (convos: Conversation[]) => {
		if (advancedFilters.length === 0) return convos

		return convos.filter((convo) => {
			return advancedFilters.every((filter) => {
				switch (filter.field) {
					case 'status':
						return filter.operator === 'equal'
							? convo.status === filter.value
							: convo.status !== filter.value
					case 'assignee': {
						const isAssigned = !!convo.meta.assignee
						return filter.operator === 'equal'
							? filter.value === 'assigned'
								? isAssigned
								: !isAssigned
							: filter.value === 'assigned'
								? !isAssigned
								: isAssigned
					}
					case 'unread': {
						const hasUnread = convo.unread_count > 0
						return filter.operator === 'equal'
							? filter.value === 'true'
								? hasUnread
								: !hasUnread
							: filter.value === 'true'
								? !hasUnread
								: hasUnread
					}
					default:
						return true
				}
			})
		})
	}

	const filtered = sortConversations(
		applyAdvancedFilters(
			conversations.filter(
				(c) =>
					c.meta.sender.name
						.toLowerCase()
						.includes(searchQuery.toLowerCase()) ||
					c.meta.sender.email
						?.toLowerCase()
						.includes(searchQuery.toLowerCase()),
			),
		),
	)

	const getStatusVariant = (status: string) => {
		switch (status) {
			case 'open':
				return 'default'
			case 'resolved':
				return 'secondary'
			case 'pending':
				return 'outline'
			default:
				return 'default'
		}
	}

	const getChannelIcon = (type?: string) => {
		switch (type) {
			case 'whatsapp':
				return <MessageCircle size={14} className="text-green-500" />
			case 'instagram':
				return <Instagram size={14} className="text-pink-600" />
			case 'tiktok':
				return <Music2 size={14} className="text-black" />
			default:
				return <Globe size={14} className="text-gray-500" />
		}
	}

	const tabs = [
		{ id: 'all', label: 'All', icon: '💬' },
		{ id: 'unassigned', label: 'Unserved', icon: '👤' },
		{ id: 'assigned', label: 'Served', icon: '👥' },
		{ id: 'resolved', label: 'Resolved', icon: '✓' },
	]

	return (
		<div className="w-96 glass flex flex-col">
			{/* Header */}
			<div className="p-4 border-b border-white/20">
				<div className="flex items-center justify-between mb-3">
					<h3 className="text-lg font-semibold text-foreground">{title}</h3>
					<div className="flex items-center gap-2">
						<OrderBy
							orderBy={orderBy}
							orderDirection={orderDirection}
							onOrderByChange={(field, direction) => {
								setOrderBy(field)
								setOrderDirection(direction)
							}}
						/>
						<AdvancedFilter onApplyFilters={setAdvancedFilters} />
					</div>
				</div>

				{/* Tabs - Hidden for My Inbox */}
				{title !== 'My Inbox' && (
					<div className="flex gap-2 mb-3 border-b border-white/10">
						{tabs.map((tab) => (
							<button
								key={tab.id}
								onClick={() => onAssigneeTypeChange(tab.id as any)}
								className={`px-3 py-2 text-sm font-medium transition-colors border-b-2 ${
									assigneeType === tab.id
										? 'border-emerald-600 text-emerald-700'
										: 'border-transparent text-muted-foreground hover:text-foreground'
								}`}
							>
								<span className="mr-1">{tab.icon}</span>
								{tab.label}
							</button>
						))}
					</div>
				)}

				{/* Search */}
				<div className="relative">
					<Search
						className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground"
						size={18}
					/>
					<Input
						type="text"
						placeholder="Search conversations..."
						value={searchQuery}
						onChange={(e) => setSearchQuery(e.target.value)}
						className="pl-10"
					/>
				</div>
			</div>

			{/* Conversations */}
			<div className="flex-1 overflow-y-auto">
				{loading ? (
					<div className="p-8 text-center text-muted-foreground">
						<div className="animate-spin text-2xl mb-2">⏳</div>
						Loading conversations...
					</div>
				) : filtered.length === 0 ? (
					<div className="p-8 text-center text-muted-foreground">
						<div className="text-3xl mb-2">💬</div>
						No conversations found
					</div>
				) : (
					filtered.map((convo) => (
						<div
							key={convo.id}
							onClick={() => onSelectConversation(convo)}
							className={`p-4 border-b border-white/10 cursor-pointer transition-colors ${
								selectedConversation?.id === convo.id
									? 'bg-emerald-100/20'
									: 'hover:bg-white/30'
							}`}
						>
							<div className="flex gap-3 mb-2">
								<div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white flex items-center justify-center font-semibold flex-shrink-0">
									{convo.meta.sender.name?.[0]?.toUpperCase() || '?'}
								</div>
								<div className="flex-1 min-w-0">
									<div className="flex items-center gap-1 mb-0.5">
										{getChannelIcon(convo.channel_type)}
										<div className="font-semibold text-sm text-foreground truncate">
											{convo.meta.sender.name}
										</div>
									</div>
									<div className="text-xs text-muted-foreground truncate">
										{convo.meta.sender.email ||
											convo.meta.sender.phone_number ||
											'No contact'}
									</div>
								</div>
							</div>
							<div className="flex justify-between items-center gap-2">
								<Badge
									variant={getStatusVariant(convo.status)}
									className="text-xs"
								>
									{convo.status}
								</Badge>
								{convo.unread_count > 0 && (
									<span className="text-xs font-semibold bg-red-500 text-white px-2 py-1 rounded-full">
										{convo.unread_count}
									</span>
								)}
							</div>
						</div>
					))
				)}
			</div>
		</div>
	)
}
