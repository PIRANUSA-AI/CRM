import { t } from 'elysia'

export const MetricsModel = {
	summary: t.Object({
		period: t.String(),
		total_messages: t.Number(),
		active_conversations: t.Number(),
		avg_response_time: t.Number(),
		ai_handling_rate: t.Number(),
	}),
} as const

export const MetricsRequestModel = {
	get: t.Object({
		period: t.Optional(
			t.Union([
				t.Literal('1h'),
				t.Literal('24h'),
				t.Literal('today'),
				t.Literal('7d'),
				t.Literal('30d'),
			]),
		),
	}),
} as const
