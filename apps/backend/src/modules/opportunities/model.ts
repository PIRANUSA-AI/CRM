import { t } from 'elysia'

// A qualified deal, distinct from a raw lead. Statuses mirror a simple deal
// lifecycle; won/lost are terminal.
export const OPPORTUNITY_STATUSES = ['open', 'won', 'lost'] as const
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number]

export const OpportunityRequestModel = {
	create: t.Object({
		contactId: t.Optional(t.Nullable(t.String())),
		name: t.String({ minLength: 1 }),
		product: t.Optional(t.Nullable(t.String())),
		value: t.Optional(t.Nullable(t.Number())),
		currency: t.Optional(t.String()),
		ownerId: t.Optional(t.Nullable(t.String())),
		stage: t.Optional(t.Nullable(t.String())),
		probability: t.Optional(t.Nullable(t.Number())),
		status: t.Optional(t.String()),
		source: t.Optional(t.Nullable(t.String())),
		notes: t.Optional(t.Nullable(t.String())),
	}),
	update: t.Object({
		name: t.Optional(t.String({ minLength: 1 })),
		product: t.Optional(t.Nullable(t.String())),
		value: t.Optional(t.Nullable(t.Number())),
		currency: t.Optional(t.String()),
		ownerId: t.Optional(t.Nullable(t.String())),
		stage: t.Optional(t.Nullable(t.String())),
		probability: t.Optional(t.Nullable(t.Number())),
		status: t.Optional(t.String()),
		notes: t.Optional(t.Nullable(t.String())),
	}),
	listQuery: t.Object({
		status: t.Optional(t.String()),
		ownerId: t.Optional(t.String()),
		contactId: t.Optional(t.String()),
		search: t.Optional(t.String()),
		// prospek | opportunity | closed
		bucket: t.Optional(t.String()),
		stage: t.Optional(t.String()),
		pipeline: t.Optional(t.String()),
		limit: t.Optional(t.String()),
		offset: t.Optional(t.String()),
	}),

	boardQuery: t.Object({
		search: t.Optional(t.String()),
		bucket: t.Optional(t.String()),
		/** Cards rendered per column; the count beside the heading is the real one. */
		perStage: t.Optional(t.String()),
		/** Narrows only the won column to one closing year. */
		wonYear: t.Optional(t.String()),
		pipeline: t.Optional(t.String()),
	}),
}
