import { t } from 'elysia'

// User response models
export const UserModel = {
	user: t.Object({
		id: t.String(),
		email: t.String(),
		name: t.Nullable(t.String()),
		role: t.Nullable(t.String()),
		avatar_url: t.Nullable(t.String()),
		active: t.Nullable(t.Boolean()),
		created_at: t.Nullable(t.Date()),
	}),

	users: t.Array(
		t.Object({
			id: t.String(),
			email: t.String(),
			name: t.Nullable(t.String()),
			role: t.Nullable(t.String()),
			avatar_url: t.Nullable(t.String()),
			active: t.Nullable(t.Boolean()),
			created_at: t.Nullable(t.Date()),
		}),
	),

	userProfile: t.Object({
		id: t.String(),
		email: t.String(),
		name: t.Nullable(t.String()),
		role: t.Nullable(t.String()),
		avatar_url: t.Nullable(t.String()),
		phone: t.Nullable(t.String()),
		account: t.Nullable(
			t.Object({
				id: t.String(),
				name: t.String(),
			}),
		),
	}),
} as const

// Request models
export const UserRequestModel = {
	updateProfile: t.Object({
		name: t.Optional(t.String()),
		avatar_url: t.Optional(t.String()),
		phone: t.Optional(t.String()),
	}),
} as const
