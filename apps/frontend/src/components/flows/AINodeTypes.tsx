/**
 * AI Node Types for Flow Builder
 *
 * Defines the data structures and configurations for AI-powered flow nodes.
 * These nodes integrate with the global AI configuration from AIConfigurationManager.
 */

import { Bot, Sparkles, Brain, ShieldAlert } from 'lucide-react'

// ============================================================================
// TYPE DEFINITIONS
// ============================================================================

/**
 * Base AI Node Data Structure
 * All AI nodes extend this base interface
 */
export interface BaseAINodeData {
	id: string
	type: 'ai_generate' | 'ai_classify' | 'ai_handoff'
	label: string
	description?: string

	// Global AI Settings (inherited from AIConfigurationManager)
	useGlobalSettings: boolean

	// Optional: Node-specific overrides (not used if useGlobalSettings is true)
	modelOverride?: {
		model: string
		temperature: number
		maxTokens: number
	}

	// Knowledge Base Integration
	enableKnowledgeBase: boolean
	knowledgeBaseLimit?: number // Number of KB results to include (default: 3)

	// Conversation Context
	includeConversationHistory: boolean
	conversationHistoryLimit?: number // Number of messages to include (default: all)

	// Fallback Behavior
	fallbackBehavior: 'block' | 'skip' | 'fallback_message'
	fallbackMessage?: string

	// Confidence Threshold (for classification/handoff)
	confidenceThreshold?: number // 0.0 - 1.0, default: 0.7

	// Handoff
	onSelect?: () => void
	onAddAction?: (type: string) => void
	onAddEnd?: (type: string) => void
	onAddCondition?: (type: string) => void
	onDelete?: (id: string) => void
}

/**
 * AI Generate Node Data
 * Generates AI-powered responses to messages
 */
export interface AIGenerateNodeData extends BaseAINodeData {
	type: 'ai_generate'

	// Prompt Configuration
	systemPrompt?: string // Custom system prompt (overrides global)
	responsePrompt: string // Template for generating responses
	responseTone?: string // Tone/personality for the response

	// Output Configuration
	outputVariable?: string // Store response in a variable

	// Response Format
	responseFormat?: 'text' | 'json'
}

/**
 * AI Classify Node Data
 * Classifies incoming messages by intent, sentiment, or custom categories
 */
export interface AIClassifyNodeData extends BaseAINodeData {
	type: 'ai_classify'

	// Classification Type
	classificationType: 'intent' | 'sentiment' | 'category' | 'priority'

	// Custom Categories (for category classification)
	categories?: string[] // e.g., ['sales', 'support', 'billing']

	// Output Configuration
	outputVariable?: string // Store classification result

	// Branching Configuration
	branches?: {
		[key: string]: string // Map category value to next node ID
	}
}

/**
 * AI Handoff Node Data
 * Detects when human intervention is needed
 */
export interface AIHandoffNodeData extends BaseAINodeData {
	type: 'ai_handoff'

	// Handoff Triggers
	handoffTriggers: {
		lowConfidence: boolean // Handoff if AI confidence is low
		keywordMatch: boolean // Handoff if keywords detected
		sentimentNegative: boolean // Handoff if sentiment is negative
		escalationRequest: boolean // Handoff if user asks for human
	}

	// Keyword List
	keywords?: string[] // Keywords that trigger handoff

	// Escalation Configuration
	escalationPriority?: 'low' | 'medium' | 'high'
	assignToSupervisor?: boolean
	notifyTeam?: boolean

	// Handoff Message
	handoffMessage?: string // Message to send when handing off
}

/**
 * Union Type for All AI Node Data
 */
export type AINodeData =
	| AIGenerateNodeData
	| AIClassifyNodeData
	| AIHandoffNodeData

// ============================================================================
// NODE CONFIGURATIONS
// ============================================================================

/**
 * AI Node Configuration Metadata
 * Used for rendering nodes in the flow builder
 */
export interface AINodeConfig {
	type: 'ai_generate' | 'ai_classify' | 'ai_handoff'
	label: string
	description: string
	icon: any
	colorClass: string
	borderColor: string
	ringColor: string
	defaultData: Partial<AINodeData>
}

/**
 * AI Node Type Definitions
 */
export const AI_NODE_TYPES: Record<string, AINodeConfig> = {
	ai_generate: {
		type: 'ai_generate',
		label: 'AI Generate',
		description:
			'Generate AI-powered responses using conversation context and knowledge base',
		icon: Sparkles,
		colorClass: 'bg-violet-600',
		borderColor: 'border-violet-500',
		ringColor: 'ring-violet-500/20',
		defaultData: {
			type: 'ai_generate',
			label: 'AI Generate',
			useGlobalSettings: true,
			enableKnowledgeBase: false,
			knowledgeBaseLimit: 3,
			includeConversationHistory: true,
			fallbackBehavior: 'block',
			confidenceThreshold: 0.7,
			responsePrompt: 'Generate a helpful response to the customer message.',
			responseFormat: 'text',
		},
	},
	ai_classify: {
		type: 'ai_classify',
		label: 'AI Classify',
		description: 'Classify messages by intent, sentiment, or custom categories',
		icon: Brain,
		colorClass: 'bg-cyan-600',
		borderColor: 'border-cyan-500',
		ringColor: 'ring-cyan-500/20',
		defaultData: {
			type: 'ai_classify',
			label: 'AI Classify',
			useGlobalSettings: true,
			enableKnowledgeBase: false,
			includeConversationHistory: true,
			fallbackBehavior: 'block',
			confidenceThreshold: 0.7,
			classificationType: 'intent',
			categories: ['sales', 'support', 'billing', 'general'],
		},
	},
	ai_handoff: {
		type: 'ai_handoff',
		label: 'AI Handoff',
		description:
			'Detect when human intervention is needed and escalate to agents',
		icon: ShieldAlert,
		colorClass: 'bg-rose-600',
		borderColor: 'border-rose-500',
		ringColor: 'ring-rose-500/20',
		defaultData: {
			type: 'ai_handoff',
			label: 'AI Handoff',
			useGlobalSettings: true,
			enableKnowledgeBase: false,
			includeConversationHistory: true,
			fallbackBehavior: 'block',
			confidenceThreshold: 0.7,
			handoffTriggers: {
				lowConfidence: true,
				keywordMatch: true,
				sentimentNegative: false,
				escalationRequest: true,
			},
			keywords: ['talk to human', 'agent', 'representative', 'speak to person'],
			escalationPriority: 'medium',
			assignToSupervisor: false,
			notifyTeam: true,
			handoffMessage: 'Connecting you to a human agent...',
		},
	},
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Get AI node configuration by type
 */
export function getAINodeConfig(type: string): AINodeConfig | undefined {
	return AI_NODE_TYPES[type]
}

/**
 * Get default data for an AI node type
 */
export function getAINodeDefaultData(
	type: string,
): Partial<AINodeData> | undefined {
	return AI_NODE_TYPES[type]?.defaultData
}

/**
 * Create a new AI node with default data
 */
export function createAINode(
	type: 'ai_generate' | 'ai_classify' | 'ai_handoff',
	position: { x: number; y: number },
): AINodeData {
	const config = AI_NODE_TYPES[type]
	return {
		id: `ai-${type}-${Date.now()}`,
		...config.defaultData,
		type,
	} as AINodeData
}

/**
 * Validate AI node data
 */
export function validateAINodeData(data: AINodeData): {
	valid: boolean
	errors: string[]
} {
	const errors: string[] = []

	// Base validation
	if (!data.type) errors.push('Node type is required')
	if (
		data.confidenceThreshold !== undefined &&
		(data.confidenceThreshold < 0 || data.confidenceThreshold > 1)
	) {
		errors.push('Confidence threshold must be between 0 and 1')
	}

	// Type-specific validation
	switch (data.type) {
		case 'ai_generate':
			if (!data.responsePrompt) errors.push('Response prompt is required')
			break
		case 'ai_classify':
			if (!data.classificationType)
				errors.push('Classification type is required')
			if (
				data.classificationType === 'category' &&
				(!data.categories || data.categories.length === 0)
			) {
				errors.push(
					'At least one category is required for category classification',
				)
			}
			break
		case 'ai_handoff':
			if (!data.handoffTriggers) errors.push('Handoff triggers are required')
			if (
				data.handoffTriggers?.keywordMatch &&
				(!data.keywords || data.keywords.length === 0)
			) {
				errors.push('Keywords are required when keyword match is enabled')
			}
			break
	}

	return {
		valid: errors.length === 0,
		errors,
	}
}

/**
 * Get AI node type label
 */
export function getAINodeTypeLabel(type: string): string {
	return AI_NODE_TYPES[type]?.label || 'AI Node'
}

/**
 * Get AI node icon component
 */
export function getAINodeIcon(type: string): any {
	return AI_NODE_TYPES[type]?.icon || Bot
}
