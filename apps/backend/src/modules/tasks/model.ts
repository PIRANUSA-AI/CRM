import { t } from 'elysia'

const taskStatus = t.Union([
	t.Literal('open'),
	t.Literal('in_progress'),
	t.Literal('done'),
	t.Literal('cancelled'),
])

const taskPriority = t.Union([
	t.Literal('low'),
	t.Literal('medium'),
	t.Literal('high'),
	t.Literal('urgent'),
])

const taskActionKind = t.Union([
	t.Literal('reply_now'),
	t.Literal('follow_up'),
	t.Literal('qualify_lead'),
	t.Literal('handover_review'),
	t.Literal('manual'),
])

export const TaskModel = {
	status: taskStatus,
	priority: taskPriority,
	actionKind: taskActionKind,
	task: t.Object({
		id: t.String(),
		appId: t.String(),
		assigneeId: t.Nullable(t.String()),
		teamId: t.Nullable(t.String()),
		conversationId: t.Nullable(t.String()),
		contactId: t.Nullable(t.String()),
		sourceMessageId: t.Nullable(t.String()),
		actionKind: taskActionKind,
		title: t.String(),
		description: t.Nullable(t.String()),
		priority: taskPriority,
		status: taskStatus,
		dueAt: t.Nullable(t.Date()),
		snoozedUntil: t.Nullable(t.Date()),
		completedAt: t.Nullable(t.Date()),
		source: t.String(),
		aiSnapshot: t.Any(),
		analysisVersion: t.Nullable(t.String()),
		confidence: t.Nullable(t.Number()),
		contactName: t.Nullable(t.String()),
		contactPhone: t.Nullable(t.String()),
		conversationStatus: t.Nullable(t.String()),
		createdAt: t.Date(),
		updatedAt: t.Date(),
	}),
} as const

export const TaskRequestModel = {
	list: t.Object({
		view: t.Optional(
			t.Union([
				t.Literal('today'),
				t.Literal('all'),
				t.Literal('overdue'),
				t.Literal('done'),
			]),
		),
		status: t.Optional(taskStatus),
		priority: t.Optional(taskPriority),
		cursor: t.Optional(t.String()),
		limit: t.Optional(t.String()),
	}),
	create: t.Object({
		title: t.String({ minLength: 1, maxLength: 255 }),
		description: t.Optional(t.Nullable(t.String({ maxLength: 4000 }))),
		actionKind: t.Optional(taskActionKind),
		priority: t.Optional(taskPriority),
		dueAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
		assigneeId: t.Optional(t.Nullable(t.String())),
		teamId: t.Optional(t.Nullable(t.String())),
		conversationId: t.Optional(t.Nullable(t.String())),
		contactId: t.Optional(t.Nullable(t.String())),
	}),
	update: t.Object({
		title: t.Optional(t.String({ minLength: 1, maxLength: 255 })),
		description: t.Optional(t.Nullable(t.String({ maxLength: 4000 }))),
		priority: t.Optional(taskPriority),
		dueAt: t.Optional(t.Nullable(t.String({ maxLength: 40 }))),
	}),
	snooze: t.Object({
		snoozedUntil: t.String({ minLength: 1, maxLength: 40 }),
		reason: t.Optional(t.String({ maxLength: 500 })),
	}),
	cancel: t.Object({
		reason: t.Optional(t.String({ maxLength: 500 })),
	}),
	replyWhatsapp: t.Object({
		text: t.String({ minLength: 1, maxLength: 4000 }),
	}),
} as const
