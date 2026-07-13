import { useState, useEffect } from 'react'
import {
	X,
	History,
	MessageSquare,
	Calendar,
	Clock,
	Loader2,
	ChevronRight,
} from 'lucide-react'
import { formatChatTime } from '@/lib/timezone'
import { contactConversations } from '@/lib/api'

interface ConversationHistoryItem {
	id: string
	created_at: string
	status: string
	messages_count: number
	channel_type: string
	source?: string
	last_message_at?: string
}

interface ViewHistoryModalProps {
	contactId: string
	contactName: string
	currentConversationId: string
	onSelectConversation?: (conversationId: string) => void
	onClose: () => void
}

export function ViewHistoryModal({
	contactId,
	contactName,
	currentConversationId,
	onSelectConversation,
	onClose,
}: ViewHistoryModalProps) {
	const [conversations, setConversations] = useState<ConversationHistoryItem[]>(
		[],
	)
	const [isLoading, setIsLoading] = useState(true)

	useEffect(() => {
		loadHistory()
	}, [contactId])

	const loadHistory = async () => {
		setIsLoading(true)
		try {
			const data: any = await contactConversations.list(contactId)
			const payload = Array.isArray(data?.payload)
				? data.payload
				: Array.isArray(data?.data)
					? data.data
					: []
			setConversations(payload)
		} catch (error) {
			console.error('Failed to load conversation history:', error)
		} finally {
			setIsLoading(false)
		}
	}

	const getStatusBadge = (status: string) => {
		const badges = {
			open: { label: 'Open', color: 'bg-blue-100 text-blue-700' },
			resolved: { label: 'Resolved', color: 'bg-green-100 text-green-700' },
			pending: { label: 'Pending', color: 'bg-yellow-100 text-yellow-700' },
		}
		return badges[status as keyof typeof badges] || badges.open
	}

	const getChannelIcon = (channel: string) => {
		switch (channel) {
			case 'whatsapp':
				return '💬'
			case 'instagram':
				return '📷'
			case 'telegram':
				return '✈️'
			default:
				return '💬'
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-purple-100 flex items-center justify-center">
							<History className="w-5 h-5 text-purple-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">
								Conversation History
							</h3>
							<p className="text-xs text-gray-500">
								All conversations with {contactName}
							</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
					>
						<X className="w-5 h-5 text-gray-400" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					{isLoading ? (
						<div className="flex flex-col items-center justify-center py-12">
							<Loader2 className="w-8 h-8 text-purple-600 animate-spin mb-3" />
							<p className="text-sm text-gray-500">
								Loading conversation history...
							</p>
						</div>
					) : conversations.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12">
							<div className="w-16 h-16 bg-gray-100 rounded-full flex items-center justify-center mb-4">
								<History className="w-8 h-8 text-gray-400" />
							</div>
							<p className="text-sm text-gray-600 font-medium mb-1">
								No conversation history
							</p>
							<p className="text-xs text-gray-500">
								This is the first conversation with this customer
							</p>
						</div>
					) : (
						<div className="space-y-3">
							{/* Summary Card */}
							<div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-4 border border-purple-200">
								<div className="grid grid-cols-3 gap-4 text-center">
									<div>
										<p className="text-2xl font-bold text-purple-600">
											{conversations.length}
										</p>
										<p className="text-xs text-gray-600 mt-1">Total Chats</p>
									</div>
									<div>
										<p className="text-2xl font-bold text-green-600">
											{
												conversations.filter((c) => c.status === 'resolved')
													.length
											}
										</p>
										<p className="text-xs text-gray-600 mt-1">Resolved</p>
									</div>
									<div>
										<p className="text-2xl font-bold text-blue-600">
											{conversations.reduce(
												(sum, c) => sum + (c.messages_count || 0),
												0,
											)}
										</p>
										<p className="text-xs text-gray-600 mt-1">Messages</p>
									</div>
								</div>
							</div>

							{/* Timeline */}
							<div className="relative">
								<div className="absolute left-5 top-0 bottom-0 w-0.5 bg-gray-200"></div>

								<div className="space-y-4">
									{conversations.map((conv, index) => {
										const isCurrent = conv.id === currentConversationId
										const badge = getStatusBadge(conv.status)

										return (
											<div key={conv.id} className="relative pl-12">
												{/* Timeline Dot */}
												<div
													className={`absolute left-3 w-4 h-4 rounded-full border-2 border-white ${
														isCurrent ? 'bg-purple-500' : 'bg-gray-300'
													}`}
												/>

												{/* Card */}
												<button
													onClick={() => {
														if (!isCurrent && onSelectConversation) {
															onSelectConversation(conv.id)
															onClose()
														}
													}}
													disabled={isCurrent}
													className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
														isCurrent
															? 'border-purple-500 bg-purple-50'
															: 'border-gray-200 bg-white hover:border-purple-300 hover:shadow-md'
													}`}
												>
													<div className="flex items-start justify-between">
														<div className="flex-1">
															<div className="flex items-center gap-2 mb-2">
																<span className="text-lg">
																	{getChannelIcon(conv.channel_type)}
																</span>
																<span
																	className={`text-xs px-2 py-0.5 rounded-full font-medium ${badge.color}`}
																>
																	{badge.label}
																</span>
																{isCurrent && (
																	<span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-500 text-white">
																		Current
																	</span>
																)}
															</div>

															<div className="flex items-center gap-4 text-xs text-gray-600 mb-2">
																<div className="flex items-center gap-1">
																	<Calendar className="w-3 h-3" />
																	<span>
																		{new Date(
																			conv.created_at,
																		).toLocaleDateString()}
																	</span>
																</div>
																<div className="flex items-center gap-1">
																	<Clock className="w-3 h-3" />
																	<span>
																		{formatChatTime(new Date(conv.created_at))}
																	</span>
																</div>
																<div className="flex items-center gap-1">
																	<MessageSquare className="w-3 h-3" />
																	<span>
																		{conv.messages_count || 0} messages
																	</span>
																</div>
															</div>

															{conv.source && (
																<p className="text-xs text-gray-500">
																	Source:{' '}
																	<span className="font-mono">
																		{conv.source}
																	</span>
																</p>
															)}
														</div>

														{!isCurrent && (
															<ChevronRight className="w-5 h-5 text-gray-400" />
														)}
													</div>
												</button>
											</div>
										)
									})}
								</div>
							</div>
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
					<button
						onClick={onClose}
						className="w-full px-4 py-2.5 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors font-medium"
					>
						Close
					</button>
				</div>
			</div>
		</div>
	)
}
