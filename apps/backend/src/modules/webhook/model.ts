import { t } from 'elysia'

export const WebhookModel = {
	webhook: t.Object({
		id: t.String(),
		account_id: t.String(),
		url: t.String(),
		name: t.Nullable(t.String()),
		events: t.Array(t.String()),
		is_active: t.Boolean(),
		created_at: t.Nullable(t.Date()),
	}),
} as const

export const WebhookRequestModel = {
	create: t.Object({
		url: t.String(),
		name: t.Optional(t.String()),
		events: t.Optional(t.Array(t.String())),
	}),
} as const
