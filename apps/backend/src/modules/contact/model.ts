import { t } from 'elysia'

export const ContactModel = {
	contact: t.Object({
		id: t.String(),
		account_id: t.String(),
		name: t.Nullable(t.String()),
		phone: t.Nullable(t.String()),
		email: t.Nullable(t.String()),
		avatar_url: t.Nullable(t.String()),
		identifier: t.Nullable(t.String()),
		custom_attributes: t.Nullable(t.Any()),
		created_at: t.Nullable(t.Date()),
	}),

	contacts: t.Array(
		t.Object({
			id: t.String(),
			name: t.Nullable(t.String()),
			phone: t.Nullable(t.String()),
			email: t.Nullable(t.String()),
			avatar_url: t.Nullable(t.String()),
		}),
	),
} as const

export const ContactRequestModel = {
	create: t.Object({
		accountId: t.String(),
		appId: t.Optional(t.String()),
		name: t.Optional(t.String()),
		phone: t.Optional(t.String()),
		phone_number: t.Optional(t.String()),
		email: t.Optional(t.String()),
		avatarUrl: t.Optional(t.String()),
		avatar_url: t.Optional(t.String()),
		identifier: t.Optional(t.String()),
		customAttributes: t.Optional(t.Any()),
	}),

	update: t.Object({
		name: t.Optional(t.String()),
		phone: t.Optional(t.String()),
		phone_number: t.Optional(t.String()),
		email: t.Optional(t.String()),
		avatarUrl: t.Optional(t.String()),
		avatar_url: t.Optional(t.String()),
		customAttributes: t.Optional(t.Any()),
	}),
} as const
