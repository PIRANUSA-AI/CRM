import { t } from 'elysia'

export const LabelModel = {
	label: t.Object({
		id: t.String(),
		app_id: t.String(),
		title: t.String(),
		description: t.Nullable(t.String()),
		color: t.Nullable(t.String()),
		is_visible: t.Boolean(),
		created_at: t.Nullable(t.Date()),
	}),

	labels: t.Array(
		t.Object({
			id: t.String(),
			title: t.String(),
			color: t.Nullable(t.String()),
		}),
	),
} as const

export const LabelRequestModel = {
	create: t.Object({
		title: t.Optional(t.String()),
		name: t.Optional(t.String()),
		description: t.Optional(t.String()),
		color: t.Optional(t.String()),
	}),

	update: t.Object({
		title: t.Optional(t.String()),
		name: t.Optional(t.String()),
		description: t.Optional(t.String()),
		color: t.Optional(t.String()),
	}),
} as const
