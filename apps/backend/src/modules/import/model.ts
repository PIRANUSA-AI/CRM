import { t } from 'elysia'

export const ImportRequestModel = {
	// Frontend reads the CSV file as text and posts it here (CSV is plain text).
	preview: t.Object({
		filename: t.Optional(t.String({ maxLength: 255 })),
		content: t.String({ minLength: 1, maxLength: 5_000_000 }),
	}),
	updateRow: t.Object({
		assignedTo: t.Optional(t.Nullable(t.String({ maxLength: 255 }))),
	}),
} as const
