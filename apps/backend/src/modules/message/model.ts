import { t } from 'elysia'

export const MessageModel = {
	message: t.Object({
		id: t.String(),
		conversation_id: t.String(),
		sender_type: t.String(),
		sender_id: t.Nullable(t.String()),
		content: t.Nullable(t.String()),
		content_type: t.String(),
		external_id: t.Nullable(t.String()),
		status: t.Nullable(t.String()),
		created_at: t.Nullable(t.Date()),
	}),

	messageWithMedia: t.Object({
		id: t.String(),
		conversation_id: t.String(),
		sender_type: t.String(),
		content: t.Nullable(t.String()),
		content_type: t.String(),
		status: t.Nullable(t.String()),
		created_at: t.Nullable(t.Date()),
		media: t.Optional(
			t.Array(
				t.Object({
					id: t.String(),
					media_url: t.Nullable(t.String()),
					media_type: t.Nullable(t.String()),
					filename: t.Nullable(t.String()),
				}),
			),
		),
	}),
} as const

export const MessageRequestModel = {
	send: t.Object({
		conversationId: t.String(),
		content: t.String(),
		contentType: t.Optional(t.String()),
		mediaIds: t.Optional(t.Array(t.String())),
	}),

	sendTemplate: t.Object({
		conversationId: t.String(),
		templateName: t.String(),
		templateVariables: t.Optional(t.Record(t.String(), t.String())),
	}),
} as const
