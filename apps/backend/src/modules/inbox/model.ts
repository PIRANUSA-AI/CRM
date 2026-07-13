import { t } from 'elysia'

export const InboxModel = {
	inbox: t.Object({
		id: t.String(),
		account_id: t.String(),
		name: t.String(),
		channel_type: t.String(),
		channel_config: t.Nullable(t.Any()),
		chatbot_id: t.Nullable(t.String()),
		created_at: t.Nullable(t.Date()),
	}),

	inboxes: t.Array(
		t.Object({
			id: t.String(),
			name: t.String(),
			channel_type: t.String(),
			chatbot_id: t.Nullable(t.String()),
		}),
	),
} as const

export const InboxRequestModel = {
	create: t.Object({
		name: t.String(),
		channel_type: t.String(),
		channel_config: t.Optional(t.Any()),
	}),

	update: t.Object({
		name: t.Optional(t.String()),
		channel_config: t.Optional(t.Any()),
		chatbot_id: t.Optional(t.Nullable(t.String())),
	}),
} as const
