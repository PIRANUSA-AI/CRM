import { t } from 'elysia'

export const TemplateVariableModel = {
	create: t.Object({
		app_id: t.Optional(t.String()),
		name: t.String(),
		category: t.Optional(t.String()),
		value: t.String(),
		fallback_value: t.Optional(t.String()),
	}),
	id: t.Object({
		id: t.String(),
	}),
}

export type TemplateVariable = {
	id: string
	app_id: string | null
	name: string
	category: string | null
	value: string | null
	fallback_value: string | null
	created_at: Date | null
	updated_at: Date | null
}
