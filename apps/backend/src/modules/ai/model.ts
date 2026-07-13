import { t } from 'elysia'

const ProviderUnion = t.Union([
	t.Literal('growthcircle'),
	t.Literal('custom'),
	t.Literal('azure'),
	t.Literal('sumopod'),
])
const ProviderProtocolUnion = t.Union([
	t.Literal('openai'),
	t.Literal('anthropic'),
])
const ProviderChannelSchema = t.Object({
	base_url: t.String(),
	path: t.Optional(t.String()),
	auth_header: t.Optional(
		t.Union([t.Literal('authorization'), t.Literal('x-api-key')]),
	),
	auth_scheme: t.Optional(t.Union([t.Literal('bearer'), t.Literal('raw')])),
})
const PlaygroundAgentTypeUnion = t.Union([
	t.Literal('ai_sales'),
	t.Literal('ai_support'),
	t.Literal('ai_general'),
])
const PlaygroundRoutingRule = t.Object({
	name: t.Optional(t.String()),
	provider: t.Optional(t.String()),
	modelId: t.Optional(t.String()),
	minConfidence: t.Optional(t.Number()),
	maxConfidence: t.Optional(t.Number()),
})

export const AIModel = {
	settings: t.Object({
		id: t.String(),
		app_id: t.String(),
		model_name: t.String(),
		temperature: t.Number(),
		max_tokens: t.Number(),
		system_prompt: t.Nullable(t.String()),
		is_active: t.Boolean(),
	}),

	suggestResponse: t.Object({
		suggestion: t.String(),
		confidence: t.Number(),
	}),
} as const

export const AIRequestModel = {
	updateSettings: t.Object({
		ai_mode: t.Optional(
			t.Union([
				t.Literal('assist'),
				t.Literal('hybrid'),
				t.Literal('auto'),
				t.Literal('off'),
			]),
		),
		model_provider: t.Optional(
			t.Union([
				t.Literal('growthcircle'),
				t.Literal('custom'),
				t.Literal('openai'),
				t.Literal('azure'),
				t.Literal('sumopod'),
				t.Literal('local'),
			]),
		),
		model_name: t.Optional(t.String()),
		temperature: t.Optional(t.Number()),
		max_tokens: t.Optional(t.Number()),
		auto_reply_confidence: t.Optional(t.Number()),
		handoff_keywords: t.Optional(t.Array(t.String())),
		response_tone: t.Optional(t.String()),
		supported_languages: t.Optional(t.Array(t.String())),
		auto_detect_language: t.Optional(t.Boolean()),
		use_platform_credentials: t.Optional(t.Boolean()),
		api_key: t.Optional(t.String()),
		api_endpoint: t.Optional(t.String()),
		api_version: t.Optional(t.String()),
		deployment_name: t.Optional(t.String()),
		system_prompt: t.Optional(t.String()),
		is_active: t.Optional(t.Boolean()),
	}),

	ask: t.Object({
		message: t.String(),
		context: t.Optional(t.Array(t.String())),
	}),

	upsertProviderConfig: t.Object({
		base_url: t.String(),
		api_key: t.Optional(t.String()),
		plan_type: t.Optional(
			t.Union([t.Literal('free'), t.Literal('paid'), t.Literal('team')]),
		),
		model_name: t.Optional(t.String()),
		api_version: t.Optional(t.String()),
		deployment_name: t.Optional(t.String()),
		temperature: t.Optional(t.Number()),
		max_tokens: t.Optional(t.Number()),
		default_protocol: t.Optional(ProviderProtocolUnion),
		channels: t.Optional(
			t.Object({
				openai: t.Optional(ProviderChannelSchema),
				anthropic: t.Optional(ProviderChannelSchema),
			}),
		),
		models: t.Optional(
			t.Array(
				t.Object({
					id: t.String(),
					name: t.String(),
					vendor: t.String(),
					context_window: t.String(),
					max_output: t.String(),
				}),
			),
		),
	}),

	setActiveProvider: t.Object({
		provider: ProviderUnion,
	}),

	setActiveEmbeddingProvider: t.Object({
		provider: ProviderUnion,
	}),

	testProviderModel: t.Object({
		modelId: t.Optional(t.String()),
		message: t.Optional(t.String()),
		maxTokens: t.Optional(t.Number()),
		protocol: t.Optional(ProviderProtocolUnion),
		apiKey: t.Optional(t.String()),
		config: t.Optional(
			t.Object({
				base_url: t.String(),
				api_key: t.Optional(t.String()),
				plan_type: t.Optional(
					t.Union([t.Literal('free'), t.Literal('paid'), t.Literal('team')]),
				),
				model_name: t.Optional(t.String()),
				api_version: t.Optional(t.String()),
				deployment_name: t.Optional(t.String()),
				temperature: t.Optional(t.Number()),
				max_tokens: t.Optional(t.Number()),
				default_protocol: t.Optional(ProviderProtocolUnion),
				channels: t.Optional(
					t.Object({
						openai: t.Optional(ProviderChannelSchema),
						anthropic: t.Optional(ProviderChannelSchema),
					}),
				),
				models: t.Optional(
					t.Array(
						t.Object({
							id: t.String(),
							name: t.String(),
							vendor: t.String(),
							context_window: t.String(),
							max_output: t.String(),
						}),
					),
				),
			}),
		),
	}),

	playgroundSelection: t.Object({
		modelId: t.Optional(t.String()),
		strategyId: t.Optional(t.String()),
		personaId: t.Optional(t.String()),
	}),

	createPlaygroundStrategy: t.Object({
		label: t.String(),
		description: t.Optional(t.String()),
		activate: t.Optional(t.Boolean()),
		rules: t.Optional(t.Array(PlaygroundRoutingRule)),
	}),

	createPlaygroundPersona: t.Object({
		label: t.String(),
		systemInstruction: t.String(),
		agentType: PlaygroundAgentTypeUnion,
		setAsDefaultForType: t.Optional(t.Boolean()),
		setAsGlobalDefault: t.Optional(t.Boolean()),
	}),

	updatePlaygroundPersona: t.Object({
		label: t.Optional(t.String()),
		systemInstruction: t.Optional(t.String()),
		agentType: t.Optional(PlaygroundAgentTypeUnion),
		setAsDefaultForType: t.Optional(t.Boolean()),
		setAsGlobalDefault: t.Optional(t.Boolean()),
	}),

	resetPlaygroundSession: t.Object({
		sessionId: t.Optional(t.String()),
		modelId: t.Optional(t.String()),
		strategyId: t.Optional(t.String()),
		personaId: t.Optional(t.String()),
	}),

	runPlayground: t.Object({
		sessionId: t.String(),
		message: t.String(),
		modelId: t.Optional(t.String()),
		strategyId: t.Optional(t.String()),
		personaId: t.Optional(t.String()),
		selectedSourceIds: t.Optional(t.Array(t.String())),
		ragTopK: t.Optional(t.Number()),
		enqueue: t.Optional(t.Boolean()),
	}),
} as const
