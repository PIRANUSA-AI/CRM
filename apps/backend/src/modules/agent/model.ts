import { t } from 'elysia'

export const AgentModel = {
	agent: t.Object({
		id: t.String(),
		name: t.String(),
		email: t.String(),
		phone_number: t.Nullable(t.String()),
		role: t.Nullable(t.String()),
		status: t.Nullable(t.String()),
		is_available: t.Nullable(t.Boolean()),
	}),

	division: t.Object({
		id: t.String(),
		name: t.String(),
		description: t.Nullable(t.String()),
		color: t.Nullable(t.String()),
	}),
} as const

export const AgentRequestModel = {
	create: t.Object({
		name: t.String(),
		email: t.String(),
		password: t.Optional(t.String()),
		phone_number: t.Optional(t.String()),
		role: t.Optional(t.String()),
		supervisor_id: t.Optional(t.Union([t.String(), t.Null()])),
		divisions: t.Optional(t.Array(t.String())),
		channels: t.Optional(t.Array(t.String())),
	}),

	update: t.Object({
		name: t.Optional(t.String()),
		email: t.Optional(t.String()),
		password: t.Optional(t.String()),
		phone_number: t.Optional(t.String()),
		role: t.Optional(t.String()),
		status: t.Optional(t.String()),
		is_available: t.Optional(t.Boolean()),
		active: t.Optional(t.Boolean()),
		supervisor_id: t.Optional(t.Union([t.String(), t.Null()])),
		divisions: t.Optional(t.Array(t.String())),
		channels: t.Optional(t.Array(t.String())),
	}),
} as const
