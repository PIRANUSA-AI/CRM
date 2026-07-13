import { t } from 'elysia'

export const ConversationModel = {
	conversation: t.Object({
		id: t.String(),
		contact_id: t.String(),
		inbox_id: t.String(),
		status: t.String(),
		priority: t.Nullable(t.String()),
		assigned_agent_id: t.Nullable(t.String()),
		last_message_at: t.Nullable(t.Date()),
		unread_count: t.Number(),
		created_at: t.Nullable(t.Date()),
	}),

	conversationWithDetails: t.Object({
		id: t.String(),
		contact_id: t.String(),
		inbox_id: t.String(),
		status: t.String(),
		priority: t.Nullable(t.String()),
		assigned_agent_id: t.Nullable(t.String()),
		last_message_at: t.Nullable(t.Date()),
		unread_count: t.Number(),
		created_at: t.Nullable(t.Date()),
		contact: t.Nullable(
			t.Object({
				id: t.String(),
				name: t.Nullable(t.String()),
				phone: t.Nullable(t.String()),
				email: t.Nullable(t.String()),
				avatar_url: t.Nullable(t.String()),
			}),
		),
		inbox: t.Nullable(
			t.Object({
				id: t.String(),
				name: t.String(),
				channel_type: t.String(),
			}),
		),
		assignedAgent: t.Nullable(
			t.Object({
				id: t.String(),
				name: t.Nullable(t.String()),
				avatar_url: t.Nullable(t.String()),
			}),
		),
	}),

	conversations: t.Array(
		t.Object({
			id: t.String(),
			contact_id: t.String(),
			inbox_id: t.String(),
			status: t.String(),
			priority: t.Nullable(t.String()),
			last_message_at: t.Nullable(t.Date()),
			unread_count: t.Number(),
		}),
	),
} as const

export const ConversationRequestModel = {
	updateStatus: t.Object({
		status: t.Union([
			t.Literal('open'),
			t.Literal('resolved'),
			t.Literal('pending'),
			t.Literal('snoozed'),
		]),
	}),

	assign: t.Object({
		agentId: t.String(),
	}),

	filter: t.Object({
		status: t.Optional(t.String()),
		inboxId: t.Optional(t.String()),
		agentId: t.Optional(t.String()),
		priority: t.Optional(t.String()),
		page: t.Optional(t.Number()),
		limit: t.Optional(t.Number()),
	}),
} as const
