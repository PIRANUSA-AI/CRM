import { t } from 'elysia'

export const SaktiRequestModel = {
	createRecord: t.Object({
		customerName: t.String({ minLength: 1 }),
		company: t.Optional(t.Nullable(t.String())),
		product: t.Optional(t.Nullable(t.String())),
		vendor: t.Optional(t.Nullable(t.String())),
		licenseNo: t.Optional(t.Nullable(t.String())),
		notes: t.Optional(t.Nullable(t.String())),
	}),
	listQuery: t.Object({
		search: t.Optional(t.String()),
		limit: t.Optional(t.String()),
		offset: t.Optional(t.String()),
	}),
	check: t.Object({
		name: t.String(),
		company: t.Optional(t.Nullable(t.String())),
		product: t.Optional(t.Nullable(t.String())),
	}),
	createLetter: t.Object({
		customerName: t.String({ minLength: 1 }),
		company: t.Optional(t.Nullable(t.String())),
		product: t.Optional(t.Nullable(t.String())),
		fromVendor: t.Optional(t.Nullable(t.String())),
		contactId: t.Optional(t.Nullable(t.String())),
		opportunityId: t.Optional(t.Nullable(t.String())),
		saktiRecordId: t.Optional(t.Nullable(t.String())),
		notes: t.Optional(t.Nullable(t.String())),
		template: t.Optional(t.Nullable(t.String({ maxLength: 60 }))),
		templateValues: t.Optional(t.Nullable(t.Record(t.String(), t.Any()))),
	}),
	updateLetter: t.Object({
		status: t.Optional(t.String()),
		ourApproved: t.Optional(t.Boolean()),
		theirApproved: t.Optional(t.Boolean()),
		notes: t.Optional(t.Nullable(t.String())),
	}),
}
