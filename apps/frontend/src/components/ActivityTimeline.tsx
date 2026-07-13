import {
	MessageSquare,
	UserPlus,
	CheckCircle2,
	Users,
	UserX,
	Clock,
} from 'lucide-react'

interface Activity {
	id: string
	action:
		| 'created'
		| 'assigned'
		| 'agent_added'
		| 'agent_removed'
		| 'agent_left'
		| 'resolved'
		| 'reopened'
		| 'status_changed'
		| 'message_sent'
	actor?: {
		id: string
		name: string
		email?: string
	}
	target?: {
		id: string
		name: string
		email?: string
	}
	metadata?: any
	created_at: string
}

interface ActivityTimelineProps {
	activities: Activity[]
}

export function ActivityTimeline({ activities }: ActivityTimelineProps) {
	if (!activities || activities.length === 0) return null

	return (
		<div className="p-6 border-t border-gray-100">
			<h5 className="text-sm font-semibold text-gray-900 mb-4">Activity</h5>
			<div className="space-y-3 max-h-48 overflow-y-auto pr-1">
				{activities.slice(0, 10).map((activity, idx) => (
					<div key={activity.id || idx} className="flex gap-3 text-xs group">
						<div className="w-6 h-6 rounded-full bg-gray-100 flex items-center justify-center flex-shrink-0 group-hover:bg-gray-200 transition-colors">
							{activity.action === 'created' && (
								<MessageSquare className="w-3 h-3 text-gray-500" />
							)}
							{activity.action === 'assigned' && (
								<UserPlus className="w-3 h-3 text-blue-500" />
							)}
							{activity.action === 'resolved' && (
								<CheckCircle2 className="w-3 h-3 text-emerald-500" />
							)}
							{activity.action === 'agent_added' && (
								<Users className="w-3 h-3 text-blue-500" />
							)}
							{activity.action === 'agent_removed' && (
								<UserX className="w-3 h-3 text-red-500" />
							)}
							{![
								'created',
								'assigned',
								'resolved',
								'agent_added',
								'agent_removed',
							].includes(activity.action) && (
								<Clock className="w-3 h-3 text-gray-400" />
							)}
						</div>
						<div className="flex-1 min-w-0">
							<p className="text-gray-700 truncate">
								{activity.action === 'created' && 'Conversation created'}
								{activity.action === 'assigned' && (
									<>
										Assigned to{' '}
										<span className="font-medium">
											{activity.target?.name || 'Agent'}
										</span>
									</>
								)}
								{activity.action === 'resolved' && (
									<>
										Resolved by{' '}
										<span className="font-medium">
											{activity.actor?.name || 'Agent'}
										</span>
									</>
								)}
								{activity.action === 'agent_added' && (
									<>
										<span className="font-medium">
											{activity.target?.name || 'Agent'}
										</span>{' '}
										added
									</>
								)}
								{activity.action === 'agent_removed' && (
									<>
										<span className="font-medium">
											{activity.target?.name || 'Agent'}
										</span>{' '}
										removed
									</>
								)}
								{/* Fallback for other actions */}
								{![
									'created',
									'assigned',
									'resolved',
									'agent_added',
									'agent_removed',
								].includes(activity.action) &&
									activity.action.replace('_', ' ')}
							</p>
							<p
								className="text-gray-400 mt-0.5"
								title={new Date(activity.created_at).toLocaleString()}
							>
								{new Date(activity.created_at).toLocaleString('id-ID', {
									day: 'numeric',
									month: 'short',
									hour: '2-digit',
									minute: '2-digit',
								})}
							</p>
						</div>
					</div>
				))}
			</div>
		</div>
	)
}
