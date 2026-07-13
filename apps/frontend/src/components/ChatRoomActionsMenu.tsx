import { useState } from 'react'
import {
	UserPlus,
	UserMinus,
	UserCheck,
	CheckCircle2,
	StickyNote,
	Merge,
	Edit2,
	Pin,
	PinOff,
	BellOff,
	Ban,
	PhoneOff,
	Tag,
	History,
	Download,
	AlertCircle,
	X,
} from 'lucide-react'

interface Agent {
	id: string
	name: string
	email: string
	avatar_url?: string
}

interface ChatRoomActionsMenuProps {
	conversationId: string
	assignedAgents: Agent[]
	availableAgents: Agent[]
	currentUserId: string
	currentUserRole: 'sales' | 'leader' | 'ceo' | 'superadmin'
	conversationStatus: 'open' | 'resolved' | 'pending'
	isAssignedToMe: boolean
	isPinned: boolean
	onAddAgent: (agentId: string) => Promise<void>
	onRemoveAgent: (agentId: string) => Promise<void>
	onTakeover: () => Promise<void>
	onResolve: () => void
	onAddNote: () => void
	onEditCustomer: () => void
	onBlockChat: () => void
	onBlockCall: () => void
	onPinChat: () => void
	onUnpinChat: () => void
	onMuteNotifications: () => void
	onViewHistory: () => void
	onManageLabels: () => void
	onMergeCustomer: () => void
	onExportChat: () => void
	onReportIssue: () => void
	onClose: () => void
}

export function ChatRoomActionsMenu({
	conversationId,
	assignedAgents,
	availableAgents,
	currentUserId,
	currentUserRole,
	conversationStatus,
	isAssignedToMe,
	isPinned,
	onAddAgent,
	onRemoveAgent,
	onTakeover,
	onResolve,
	onAddNote,
	onEditCustomer,
	onBlockChat,
	onBlockCall,
	onPinChat,
	onUnpinChat,
	onMuteNotifications,
	onViewHistory,
	onManageLabels,
	onMergeCustomer,
	onExportChat,
	onReportIssue,
	onClose,
}: ChatRoomActionsMenuProps) {
	const [showAgentSelector, setShowAgentSelector] = useState(false)
	const [showRemoveAgent, setShowRemoveAgent] = useState(false)
	const [isLoading, setIsLoading] = useState(false)

	const canManageAgents =
		currentUserRole === 'leader' || currentUserRole === 'ceo' || currentUserRole === 'superadmin'
	const canResolve = isAssignedToMe || canManageAgents

	// Filter unassigned agents
	const unassignedAgents = availableAgents.filter(
		(agent) => !assignedAgents.some((a) => a.id === agent.id),
	)

	const handleAddAgent = async (agentId: string) => {
		setIsLoading(true)
		try {
			await onAddAgent(agentId)
			setShowAgentSelector(false)
		} catch (error) {
			console.error('Failed to add agent:', error)
			alert('Failed to add agent')
		} finally {
			setIsLoading(false)
		}
	}

	const handleRemoveAgent = async (agentId: string) => {
		if (assignedAgents.length === 1) {
			alert('Cannot remove the last agent')
			return
		}

		if (!confirm('Remove this agent from the conversation?')) return

		setIsLoading(true)
		try {
			await onRemoveAgent(agentId)
			setShowRemoveAgent(false)
		} catch (error) {
			console.error('Failed to remove agent:', error)
			alert('Failed to remove agent')
		} finally {
			setIsLoading(false)
		}
	}

	const handleTakeover = async () => {
		if (!confirm('Assign this conversation to yourself?')) return

		setIsLoading(true)
		try {
			await onTakeover()
			onClose()
		} catch (error) {
			console.error('Failed to takeover:', error)
			alert('Failed to takeover conversation')
		} finally {
			setIsLoading(false)
		}
	}

	return (
		<div className="absolute right-0 top-12 z-50 w-72 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
			{/* Overlay to close menu */}
			<div className="fixed inset-0 -z-10" onClick={onClose} />

			<div className="max-h-[85vh] overflow-y-auto p-2">
				{/* Agent Section */}
				<div className="mb-2">
					<div className="px-3 py-2">
						<h6 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
							Agent
						</h6>
					</div>

					{canManageAgents && (
						<>
							{/* Add Agent */}
							<div>
								<button
									onClick={() => setShowAgentSelector(!showAgentSelector)}
									className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
								>
									<UserPlus className="w-4 h-4 text-gray-500" />
									<span>Add Agent</span>
								</button>

								{/* Agent Selector Dropdown */}
								{showAgentSelector && (
									<div className="ml-3 mr-3 mb-2 mt-1 p-2 bg-gray-50 rounded-lg border border-gray-200">
										<p className="text-xs text-gray-500 mb-2">Select agent:</p>
										<div className="max-h-48 overflow-y-auto space-y-1">
											{unassignedAgents.map((agent) => (
												<button
													key={agent.id}
													onClick={() => handleAddAgent(agent.id)}
													disabled={isLoading}
													className="w-full flex items-center gap-2 p-2 hover:bg-white rounded-md text-left transition-colors disabled:opacity-50"
												>
													<div className="w-6 h-6 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xs font-semibold flex items-center justify-center">
														{agent.name.substring(0, 2).toUpperCase()}
													</div>
													<div className="flex-1 min-w-0">
														<p className="text-xs font-medium text-gray-900 truncate">
															{agent.name}
														</p>
														<p className="text-[10px] text-gray-500 truncate">
															{agent.email}
														</p>
													</div>
												</button>
											))}
											{unassignedAgents.length === 0 && (
												<p className="text-xs text-gray-400 text-center py-2">
													No more agents available
												</p>
											)}
										</div>
									</div>
								)}
							</div>

							{/* Remove Agent */}
							<div>
								<button
									onClick={() => setShowRemoveAgent(!showRemoveAgent)}
									disabled={assignedAgents.length === 0}
									className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
								>
									<UserMinus className="w-4 h-4 text-gray-500" />
									<span>Remove Agent</span>
								</button>

								{/* Remove Agent Dropdown */}
								{showRemoveAgent && (
									<div className="ml-3 mr-3 mb-2 mt-1 p-2 bg-gray-50 rounded-lg border border-gray-200">
										<p className="text-xs text-gray-500 mb-2">Remove agent:</p>
										<div className="max-h-48 overflow-y-auto space-y-1">
											{assignedAgents.map((agent) => (
												<button
													key={agent.id}
													onClick={() => handleRemoveAgent(agent.id)}
													disabled={isLoading}
													className="w-full flex items-center gap-2 p-2 hover:bg-red-50 rounded-md text-left transition-colors disabled:opacity-50"
												>
													<div className="w-6 h-6 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white text-xs font-semibold flex items-center justify-center">
														{agent.name.substring(0, 2).toUpperCase()}
													</div>
													<div className="flex-1 min-w-0">
														<p className="text-xs font-medium text-gray-900 truncate">
															{agent.name}
														</p>
														<p className="text-[10px] text-gray-500 truncate">
															{agent.email}
														</p>
													</div>
													<X className="w-3 h-3 text-red-500" />
												</button>
											))}
										</div>
									</div>
								)}
							</div>
						</>
					)}

					{/* Reassign to Me */}
					{!isAssignedToMe && (
						<button
							onClick={handleTakeover}
							disabled={isLoading}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors disabled:opacity-50"
						>
							<UserCheck className="w-4 h-4 text-gray-500" />
							<span>Reassign to Me</span>
						</button>
					)}
				</div>

				{/* Divider */}
				<div className="h-px bg-gray-200 my-2" />

				{/* Customer Section */}
				<div className="mb-2">
					<div className="px-3 py-2">
						<h6 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
							Customer
						</h6>
					</div>

					<button
						onClick={() => {
							onMergeCustomer()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<Merge className="w-4 h-4 text-gray-500" />
						<span>Merge to Existing</span>
					</button>

					<button
						onClick={() => {
							onEditCustomer()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<Edit2 className="w-4 h-4 text-gray-500" />
						<span>Edit Customer Info</span>
					</button>

					<button
						onClick={() => {
							onAddNote()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<StickyNote className="w-4 h-4 text-gray-500" />
						<span>Add Note</span>
					</button>
				</div>

				{/* Divider */}
				<div className="h-px bg-gray-200 my-2" />

				{/* Chat Section */}
				<div className="mb-2">
					<div className="px-3 py-2">
						<h6 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
							Chat
						</h6>
					</div>

					{isPinned ? (
						<button
							onClick={() => {
								onUnpinChat()
								onClose()
							}}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
						>
							<PinOff className="w-4 h-4 text-gray-500" />
							<span>Unpin Chat Room</span>
						</button>
					) : (
						<button
							onClick={() => {
								onPinChat()
								onClose()
							}}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
						>
							<Pin className="w-4 h-4 text-gray-500" />
							<span>Pin Chat Room</span>
						</button>
					)}

					<button
						onClick={() => {
							onMuteNotifications()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<BellOff className="w-4 h-4 text-gray-500" />
						<span>Mute Notifications</span>
					</button>

					{canManageAgents && (
						<>
							<button
								onClick={() => {
									onBlockChat()
									onClose()
								}}
								className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
							>
								<Ban className="w-4 h-4" />
								<span>Block Customer Chat</span>
							</button>

							<button
								onClick={() => {
									onBlockCall()
									onClose()
								}}
								className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
							>
								<PhoneOff className="w-4 h-4" />
								<span>Block Customer Call</span>
							</button>
						</>
					)}

					{canResolve && conversationStatus !== 'resolved' && (
						<button
							onClick={() => {
								onResolve()
								onClose()
							}}
							className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-emerald-700 hover:bg-emerald-50 rounded-lg transition-colors font-medium"
						>
							<CheckCircle2 className="w-4 h-4" />
							<span>Mark as Resolved</span>
						</button>
					)}
				</div>

				{/* Divider */}
				<div className="h-px bg-gray-200 my-2" />

				{/* Advanced Section */}
				<div>
					<div className="px-3 py-2">
						<h6 className="text-[11px] font-semibold text-gray-500 uppercase tracking-wider">
							Advanced
						</h6>
					</div>

					<button
						onClick={() => {
							onManageLabels()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<Tag className="w-4 h-4 text-gray-500" />
						<span>Manage Labels</span>
					</button>

					<button
						onClick={() => {
							onViewHistory()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<History className="w-4 h-4 text-gray-500" />
						<span>View Full History</span>
					</button>

					<button
						onClick={() => {
							onExportChat()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 rounded-lg transition-colors"
					>
						<Download className="w-4 h-4 text-gray-500" />
						<span>Export Chat</span>
					</button>

					<button
						onClick={() => {
							onReportIssue()
							onClose()
						}}
						className="w-full flex items-center gap-2.5 px-3 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
					>
						<AlertCircle className="w-4 h-4" />
						<span>Report Issue</span>
					</button>
				</div>
			</div>
		</div>
	)
}
