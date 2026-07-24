export interface AIAgentModelConfig {
	provider: string
	model: string
	temperature?: number
	maxOutputTokens?: number
}

export interface AIAgentToolConfig {
	name: string
	enabled: boolean
	settings?: Readonly<Record<string, unknown>>
}

export interface AIAgentGuardrails {
	maxToolCalls?: number
	blockedTopics?: readonly string[]
	requireHumanApprovalFor?: readonly string[]
}

export interface AIAgentMemoryConfig {
	type: 'buffer' | 'summary' | 'hybrid'
	maxTokens: number
}

export interface AIAgentConfig {
	id: string
	name: string
	description?: string
	systemPrompt: string
	model: AIAgentModelConfig
	tools?: readonly AIAgentToolConfig[]
	guardrails?: AIAgentGuardrails
	maxIterations?: number
	timeoutMs?: number
	subAgents?: readonly AIAgentConfig[]
	memory?: AIAgentMemoryConfig
}
