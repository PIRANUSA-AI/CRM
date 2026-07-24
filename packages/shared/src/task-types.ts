export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'
export type TaskStatus = 'open' | 'in_progress' | 'done' | 'cancelled'
export type TaskActionKind =
	| 'reply_now'
	| 'follow_up'
	| 'qualify_lead'
	| 'handover_review'
	| 'prospect_followup'
	| 'manual'

/**
 * Mirrors the `tasks` table + apps/backend/src/modules/tasks/model.ts
 * (TaskModel.task), plus the ai_generated/source_agent/suggested_start/
 * priority_score columns added for W2I.md. Those four are optional here
 * because the API (TaskModel.task) does not surface them yet - the columns
 * exist in the DB, wiring them into the read/write path is separate work.
 */
export interface TaskDefinition {
	id: string
	appId: string
	assigneeId: string | null
	teamId: string | null
	conversationId: string | null
	contactId: string | null
	sourceMessageId: string | null
	actionKind: TaskActionKind
	title: string
	description: string | null
	priority: TaskPriority
	status: TaskStatus
	dueAt: string | null
	completedAt: string | null
	source: string
	aiSnapshot?: Record<string, unknown> | null
	analysisVersion?: string | null
	confidence?: number | null
	// Not yet exposed by TaskModel.task - present in the DB, read here for
	// forward compatibility once the API catches up.
	aiGenerated?: boolean | null
	sourceAgent?: string | null
	suggestedStart?: string | null
	priorityScore?: number | null
	createdAt: string
	updatedAt: string
}

/** Mirrors the `task_reminders` table. */
export type TaskReminderType = 'daily' | 'weekly' | 'custom'

export interface TaskReminder {
	id: string
	appId: string
	taskId: string
	userId: string
	reminderType: TaskReminderType
	remindAt: string
	isSent: boolean
	message?: string | null
	createdAt: string
}

/**
 * Output of the two-tier classifier/generator in apps/backend/src/modules/
 * tasks/analyzer.ts (TaskAnalysisDecisionSchema). This is what actually runs
 * today - not a future-agent placeholder.
 */
export type TaskAnalysisAction =
	| 'ignore'
	| 'reply_now'
	| 'follow_up'
	| 'qualify_lead'
	| 'handover_review'

export type TaskLeadSignal = 'none' | 'interest' | 'qualified' | 'purchase_intent'

export interface TaskAnalysisDecision {
	action: TaskAnalysisAction
	confidence: number
	leadSignal: TaskLeadSignal
	priority: TaskPriority | null
	dueInMinutes: number | null
	title: string | null
	summary: string | null
	suggestedReply: string | null
	evidence: string[]
	safetyFlags: string[]
}
