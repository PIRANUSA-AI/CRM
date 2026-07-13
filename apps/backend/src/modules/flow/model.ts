import { t } from 'elysia'

export const FlowModel = {
	flow: t.Object({
		id: t.String(),
		app_id: t.String(),
		name: t.String(),
		description: t.Nullable(t.String()),
		nodes: t.Any(),
		edges: t.Any(),
		active: t.Nullable(t.Boolean()),
		created_at: t.Nullable(t.Date()),
		updated_at: t.Nullable(t.Date()),
	}),

	flows: t.Array(
		t.Object({
			id: t.String(),
			name: t.String(),
			active: t.Nullable(t.Boolean()),
		}),
	),
} as const

export const FlowRequestModel = {
	create: t.Object({
		name: t.String(),
		description: t.Optional(t.String()),
		trigger_type: t.Optional(t.String()),
		nodes: t.Optional(t.Any()),
		edges: t.Optional(t.Any()),
		active: t.Optional(t.Boolean()),
		is_active: t.Optional(t.Boolean()),
	}),

	update: t.Object({
		name: t.Optional(t.String()),
		description: t.Optional(t.String()),
		nodes: t.Optional(t.Any()),
		edges: t.Optional(t.Any()),
		active: t.Optional(t.Boolean()),
	}),
} as const
