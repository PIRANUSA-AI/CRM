import { t } from 'elysia'

export const TeamModel = {
	team: t.Object({
		id: t.String(),
		account_id: t.String(),
		name: t.String(),
		description: t.Nullable(t.String()),
		allow_auto_assign: t.Boolean(),
		created_at: t.Nullable(t.Date()),
	}),

	member: t.Object({
		id: t.String(),
		team_id: t.String(),
		user_id: t.String(),
		role: t.Nullable(t.String()),
	}),
} as const

export const TeamRequestModel = {
	create: t.Object({
		name: t.String(),
		description: t.Optional(t.String()),
		allow_auto_assign: t.Optional(t.Boolean()),
	}),

	update: t.Object({
		name: t.Optional(t.String()),
		description: t.Optional(t.String()),
		allow_auto_assign: t.Optional(t.Boolean()),
	}),
} as const
