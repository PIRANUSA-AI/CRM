import { useState } from 'react'
import { UserPlus, User, X, UserMinus, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { isSupervisorRole } from '@/lib/role-access'

interface Agent {
	id: string
	name: string
	email: string
	avatar_url?: string
	is_primary?: boolean
}

interface AgentAssignmentPanelProps {
	conversationId: string
	assignedAgents: Agent[]
	availableAgents: Agent[]
	currentUserRole: 'sales' | 'leader' | 'ceo' | 'superadmin'
	currentUserId: string
	onAddAgent: (agentId: string) => Promise<void>
	onRemoveAgent: (agentId: string) => Promise<void>
	onTakeover: () => Promise<void>
	canTakeover: boolean
	compact?: boolean
}

export function AgentAssignmentPanel({
	assignedAgents,
	availableAgents,
	currentUserRole,
	currentUserId,
	onAddAgent,
	onRemoveAgent,
	onTakeover,
	canTakeover,
	compact = false,
}: AgentAssignmentPanelProps) {
	const [showAgentSelector, setShowAgentSelector] = useState(false)
	const [showRemoveModal, setShowRemoveModal] = useState(false)
	const [removingAgent, setRemovingAgent] = useState<Agent | null>(null)
	const [isRemoving, setIsRemoving] = useState(false)

	const canManageAgents =
		isSupervisorRole(currentUserRole)
	const isAssigned = assignedAgents.some((a) => a.id === currentUserId)

	const confirmRemoveAgent = (agent: Agent) => {
		setRemovingAgent(agent)
		setShowRemoveModal(true)
	}

	const handleRemoveAgent = async () => {
		if (!removingAgent) return
		setIsRemoving(true)
		try {
			await onRemoveAgent(removingAgent.id)
			setShowRemoveModal(false)
			setRemovingAgent(null)
		} catch (error) {
			console.error('Failed to remove agent:', error)
		} finally {
			setIsRemoving(false)
		}
	}

	return (
		<div className={`${compact ? 'p-4' : 'p-6'} border-t border-gray-100`}>
			<div
				className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}
			>
				<h5 className="text-sm font-semibold text-gray-900">Assigned Agents</h5>
				{canManageAgents && (
					<button
						onClick={() => setShowAgentSelector(!showAgentSelector)}
						className="flex items-center gap-1 text-xs font-medium text-emerald-600 hover:text-emerald-700 transition-colors"
					>
						<UserPlus className="w-3.5 h-3.5" />
						<span>Add</span>
					</button>
				)}
			</div>

			{/* Agent Selector Dropdown */}
				{showAgentSelector && (
					<div
						className={`${compact ? 'mb-3 p-2.5' : 'mb-4 p-3'} bg-gray-50 rounded-xl border border-gray-200 animate-in slide-in-from-top-2 duration-200`}
					>
					<p className="text-xs text-gray-500 mb-2">Select agent to assign:</p>
					<div className="max-h-36 overflow-y-auto space-y-1">
						{availableAgents
							.filter(
								(agent) => !assignedAgents.some((ca) => ca.id === agent.id),
							)
							.map((agent) => (
								<button
									key={agent.id}
									onClick={async () => {
										await onAddAgent(agent.id)
										setShowAgentSelector(false)
									}}
									className="w-full flex items-center gap-2 p-2 hover:bg-white rounded-lg text-left transition-colors"
								>
									<div className="w-7 h-7 rounded-full bg-gradient-to-br from-blue-400 to-blue-600 text-white text-xs font-semibold flex items-center justify-center">
										{(agent.name || 'A').substring(0, 2).toUpperCase()}
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-sm font-medium text-gray-900 truncate">
											{agent.name}
										</p>
										<p className="text-xs text-gray-500 truncate">
											{agent.email}
										</p>
									</div>
								</button>
							))}
						{availableAgents.filter(
							(agent) => !assignedAgents.some((ca) => ca.id === agent.id),
						).length === 0 && (
							<p className="text-xs text-gray-400 text-center py-2">
								No more agents available
							</p>
						)}
					</div>
				</div>
			)}

			{/* Assigned Agents List */}
				{assignedAgents.length > 0 ? (
					<div className={`${compact ? 'space-y-1.5' : 'space-y-2'}`}>
						{assignedAgents.map((agent) => (
							<div
								key={agent.id}
								className={`flex items-center justify-between ${compact ? 'p-2' : 'p-2.5'} bg-gray-50 rounded-xl group hover:bg-gray-100/80 transition-colors`}
							>
							<div className="flex items-center gap-2.5">
								<div className="w-8 h-8 rounded-full bg-gradient-to-br from-emerald-400 to-emerald-600 text-white text-xs font-semibold flex items-center justify-center shadow-sm">
									{(agent.name || 'A').substring(0, 2).toUpperCase()}
								</div>
								<div>
									<div className="flex items-center gap-1.5">
										<p className="text-sm font-medium text-gray-900">
											{agent.name}
										</p>
										{agent.is_primary && (
											<span className="px-1.5 py-0.5 bg-emerald-100 text-emerald-700 text-[10px] font-semibold rounded">
												Primary
											</span>
										)}
									</div>
									<p className="text-xs text-gray-500">{agent.email}</p>
								</div>
							</div>
							{/* Remove button (Supervisors/Admins only) */}
							{canManageAgents && (
								<button
									onClick={() => confirmRemoveAgent(agent)}
									className="p-1.5 text-gray-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
									title="Remove agent"
								>
									<UserMinus className="w-4 h-4" />
								</button>
							)}
						</div>
					))}

					{/* Takeover Button - Show when current user is not in assigned agents list */}
						{!isAssigned && (
							<button
								onClick={onTakeover}
								className={`w-full flex items-center justify-center gap-2 px-4 ${compact ? 'py-2 mt-2' : 'py-2.5 mt-3'} bg-emerald-500 hover:bg-emerald-600 text-white rounded-xl text-sm font-medium transition-colors shadow-sm`}
							>
							<User className="w-4 h-4" />
							<span>Join Conversation</span>
						</button>
					)}
				</div>
				) : (
					<div
						className={`flex flex-col items-center justify-center ${compact ? 'py-4' : 'py-6'} text-center`}
					>
					<div className="w-12 h-12 bg-gray-100 rounded-full flex items-center justify-center mb-3">
						<UserPlus className="w-6 h-6 text-gray-400" />
					</div>
					<p className="text-sm text-gray-500 mb-3">No agents assigned</p>

					{/* Takeover Button */}
					{canTakeover && !isAssigned && (
						<button
							onClick={onTakeover}
							className="flex items-center gap-2 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
						>
							<User className="w-4 h-4" />
							<span>Takeover</span>
						</button>
					)}
				</div>
			)}

			{/* Remove Agent Confirmation Modal */}
			{showRemoveModal && removingAgent && (
				<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
					<div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
						<div className="p-6 text-center">
							<div className="w-16 h-16 rounded-full bg-red-100 flex items-center justify-center mx-auto mb-4">
								<UserMinus size={32} className="text-red-600" />
							</div>
							<h3 className="text-lg font-bold text-gray-900 mb-2">
								Remove Agent
							</h3>
							<p className="text-sm text-gray-500 mb-4">
								Are you sure you want to remove{' '}
								<strong className="text-gray-900">{removingAgent.name}</strong>{' '}
								from this conversation?
							</p>
							<div className="flex gap-3">
								<Button
									variant="outline"
									onClick={() => {
										setShowRemoveModal(false)
										setRemovingAgent(null)
									}}
									disabled={isRemoving}
									className="flex-1"
								>
									Cancel
								</Button>
								<Button
									onClick={handleRemoveAgent}
									disabled={isRemoving}
									className="flex-1 bg-red-600 hover:bg-red-700 text-white font-bold"
								>
									{isRemoving ? (
										<>
											<div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2" />
											Removing...
										</>
									) : (
										<>
											<UserMinus size={16} className="mr-2" />
											Remove Agent
										</>
									)}
								</Button>
							</div>
						</div>
					</div>
				</div>
			)}
		</div>
	)
}
