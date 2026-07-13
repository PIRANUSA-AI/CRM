import { t } from 'elysia'

export const FormModel = {
	form: t.Object({
		id: t.String(),
		app_id: t.String(),
		name: t.String(),
		description: t.Nullable(t.String()),
		is_active: t.Boolean(),
		created_at: t.Nullable(t.Date()),
	}),

	field: t.Object({
		id: t.String(),
		form_id: t.String(),
		field_key: t.String(),
		label: t.String(),
		field_type: t.String(),
		is_required: t.Boolean(),
	}),

	submission: t.Object({
		id: t.String(),
		form_id: t.String(),
		conversation_id: t.String(),
		status: t.String(),
		overall_confidence: t.Number(),
		created_at: t.Nullable(t.Date()),
	}),
} as const

export const FormRequestModel = {
	create: t.Object({
		name: t.String(),
		description: t.Optional(t.String()),
		fields: t.Array(
			t.Object({
				field_key: t.String(),
				label: t.String(),
				field_type: t.String(),
				is_required: t.Boolean(),
			}),
		),
	}),

	extract: t.Object({
		force: t.Optional(t.Boolean()),
	}),
} as const
