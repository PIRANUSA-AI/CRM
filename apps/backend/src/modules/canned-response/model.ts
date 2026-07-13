import { t } from 'elysia'

export const CannedResponseModel = {
	response: t.Object({
		id: t.String(),
		account_id: t.String(),
		short_code: t.String(),
		content: t.String(),
		created_at: t.Nullable(t.Date()),
	}),
} as const

export const CannedResponseRequestModel = {
	create: t.Object({
		short_code: t.String(),
		content: t.String(),
	}),
} as const
