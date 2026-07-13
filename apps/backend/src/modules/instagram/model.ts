import { t } from 'elysia'

export const InstagramModel = {
	connectionStatus: t.Object({
		connected: t.Boolean(),
		id: t.String(),
		igId: t.String(),
		username: t.String(),
		profilePicUrl: t.Nullable(t.String()),
		connectionStatus: t.String(),
		connectedAt: t.Nullable(t.Date()),
		tokenExpiresAt: t.Nullable(t.String()),
		daysUntilTokenExpiry: t.Number(),
	}),
} as const

export const InstagramRequestModel = {
	initLogin: t.Object({
		appId: t.Optional(t.String()),
	}),
} as const
