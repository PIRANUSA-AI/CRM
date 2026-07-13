import { t } from 'elysia'

const NumberLike = t.Union([t.Number(), t.String()])
const BooleanLike = t.Union([t.Boolean(), t.String()])

export const ChatbotModel = {
	chatbot: t.Object({
		id: t.String(),
		app_id: t.String(),
		name: t.String(),
		description: t.Nullable(t.String()),
		model: t.String(),
		prompt: t.Nullable(t.String()),
		welcome_msg: t.Nullable(t.String()),
		is_deleted: t.Boolean(),
		created_at: t.Nullable(t.Date()),
	}),

	chatbots: t.Array(
		t.Object({
			id: t.String(),
			name: t.String(),
			model: t.String(),
			is_deleted: t.Boolean(),
		}),
	),

	document: t.Object({
		id: t.String(),
		chatbot_id: t.String(),
		title: t.String(),
		content: t.String(),
		type: t.String(),
		metadata: t.Nullable(t.Any()),
	}),
} as const

export const ChatbotRequestModel = {
	create: t.Object({
		app_id: t.Optional(t.String()),
		name: t.String(),
		description: t.Optional(t.String()),
		model: t.Optional(t.String()),
		prompt: t.Optional(t.String()),
		welcome_msg: t.Optional(t.String()),
		agent_transfer: t.Optional(t.String()),
		temperature: t.Optional(NumberLike),
		history_limit: t.Optional(NumberLike),
		context_limit: t.Optional(NumberLike),
		message_await: t.Optional(NumberLike),
		message_limit: t.Optional(NumberLike),
		max_file_read_window: t.Optional(NumberLike),
		is_silent_handoff_agent: t.Optional(BooleanLike),
		watcher_enabled: t.Optional(BooleanLike),
		session_only_memory: t.Optional(BooleanLike),
		stop_after_handoff: t.Optional(BooleanLike),
		usage_mode: t.Optional(t.String()),
		timezone: t.Optional(t.String()),
		label_condition: t.Optional(t.String()),
		selected_labels: t.Optional(t.Union([t.Array(t.String()), t.String()])),
		app_data: t.Optional(t.Any()),
		ai_followups: t.Optional(t.Union([t.Array(t.Any()), t.String()])),
		plugin_data: t.Optional(t.Any()),
	}),

	update: t.Object({
		app_id: t.Optional(t.String()),
		name: t.Optional(t.String()),
		description: t.Optional(t.String()),
		model: t.Optional(t.String()),
		prompt: t.Optional(t.String()),
		welcome_msg: t.Optional(t.String()),
		agent_transfer: t.Optional(t.String()),
		temperature: t.Optional(NumberLike),
		history_limit: t.Optional(NumberLike),
		context_limit: t.Optional(NumberLike),
		message_await: t.Optional(NumberLike),
		message_limit: t.Optional(NumberLike),
		max_file_read_window: t.Optional(NumberLike),
		is_silent_handoff_agent: t.Optional(BooleanLike),
		watcher_enabled: t.Optional(BooleanLike),
		session_only_memory: t.Optional(BooleanLike),
		stop_after_handoff: t.Optional(BooleanLike),
		usage_mode: t.Optional(t.String()),
		timezone: t.Optional(t.String()),
		label_condition: t.Optional(t.String()),
		selected_labels: t.Optional(t.Union([t.Array(t.String()), t.String()])),
		app_data: t.Optional(t.Any()),
		ai_followups: t.Optional(t.Union([t.Array(t.Any()), t.String()])),
		plugin_data: t.Optional(t.Any()),
	}),
} as const
