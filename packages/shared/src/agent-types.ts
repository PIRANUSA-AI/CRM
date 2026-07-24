/**
 * AgentConfig already exists as AIAgentConfig (./ai-agent.ts) - re-exported
 * here under both names so a caller can import everything from one place
 * (agent-types, matching W2I.md §2.1) without a second, competing
 * definition. Nothing in the codebase constructs an AI agent yet; this
 * module and apps/agent-service/ do not exist. These types exist so the DB
 * side (agent_conversations table, added this session) and the eventual
 * agent process agree on a shape before either is built further.
 */
export type {
	AIAgentConfig,
	AIAgentConfig as AgentConfig,
	AIAgentGuardrails,
	AIAgentMemoryConfig,
	AIAgentModelConfig,
	AIAgentToolConfig,
} from './ai-agent'

/** Matches agent_conversations.agent_type (apps/backend/prisma/schema.prisma). */
export type AgentType = 'supervisor' | 'task' | 'lead' | 'report' | 'scoring'

export type AgentStatus = 'idle' | 'processing' | 'waiting_tool' | 'error'

export interface AgentMessage {
	role: 'system' | 'user' | 'assistant' | 'tool'
	content: string
	toolCallId?: string
	name?: string
}

export interface ToolCall {
	id: string
	name: string
	arguments: Record<string, unknown>
}

export interface ToolDefinition {
	name: string
	description: string
	parameters: Record<string, unknown>
	handler: string
	requiresApproval?: boolean
}

/** W2I.md §8.2 AgentInstance - the runtime state of one agent invocation. */
export interface AgentInstance {
	id: string
	type: AgentType
	status: AgentStatus
	conversationId?: string
	parentId?: string
	context: {
		messages: AgentMessage[]
		tokensUsed: number
		tools: string[]
		startedAt: string
		deadlineAt: string
	}
	state: {
		currentStep: string
		pendingToolCalls: ToolCall[]
		completedSteps: string[]
		result?: unknown
	}
}

/**
 * Mirrors the `agent_conversations` table - what an agent read/concluded
 * about one conversation, for debugging ("why did this task get generated").
 * Separate from audit_logs, which is business actions (assign/delete/target
 * set), not agent reasoning.
 */
export interface AgentConversationLog {
	id: string
	appId: string
	conversationId: string
	agentId?: string | null
	agentType: AgentType
	inputSummary?: string | null
	outputSummary?: string | null
	metadata?: Record<string, unknown> | null
	createdAt: string
}
