import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import { TaskRequestModel } from './model'
import { TaskAccessError, parseFutureDate, type TaskActor } from './policy'
import { TaskConflictError, TaskNotFoundError, TaskService } from './service'

const ALLOWED_ROLES: CanonicalRole[] = ['sales', 'leader', 'ceo', 'superadmin']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<TaskActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, ALLOWED_ROLES)
	if (!authorization.ok) {
		set.status = authorization.status
		return null
	}
	return {
		appId: resolvedAppId,
		userId,
		role: authorization.role as CanonicalRole,
	}
}

function toErrorResponse(error: unknown, set: { status?: number | string }) {
	if (error instanceof TaskNotFoundError) {
		set.status = 404
		return { error: error.message }
	}
	if (error instanceof TaskAccessError) {
		set.status = 403
		return { error: error.message }
	}
	if (error instanceof TaskConflictError) {
		set.status = 409
		return { error: error.message }
	}
	if (error instanceof Error) {
		set.status = 400
		return { error: error.message }
	}
	set.status = 500
	return { error: 'Task tidak dapat diproses' }
}

function optionalDate(value: string | null | undefined) {
	if (value === undefined) return undefined
	if (value === null) return null
	const date = new Date(value)
	if (Number.isNaN(date.getTime())) throw new Error('Format waktu tidak valid')
	return date
}

export const tasks = new Elysia({ prefix: '/tasks', tags: ['Tasks'] })
	.use(appContext)
	.get('/', async ({ resolvedAppId, userId, query, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return await TaskService.list(actor, {
				view: query.view,
				status: query.status,
				priority: query.priority,
				cursor: query.cursor,
				limit: query.limit ? Number(query.limit) : undefined,
			})
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { query: TaskRequestModel.list })
	.get('/summary/today', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await TaskService.summary(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	.get('/:id/events', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await TaskService.events(actor, params.id) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }) })
	.get('/:id', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await TaskService.get(actor, params.id) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }) })
	.post('/', async ({ resolvedAppId, userId, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			const task = await TaskService.createManual(actor, {
				...body,
				dueAt: optionalDate(body.dueAt),
			})
			set.status = 201
			return { data: task }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { body: TaskRequestModel.create })
	.patch('/:id', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return {
				data: await TaskService.update(actor, params.id, {
					...body,
					dueAt: optionalDate(body.dueAt),
				}),
			}
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }), body: TaskRequestModel.update })
	.post('/:id/start', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await TaskService.start(actor, params.id) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }) })
	.post('/:id/complete', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await TaskService.complete(actor, params.id) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }) })
	.post('/:id/snooze', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return {
				data: await TaskService.snooze(
					actor,
					params.id,
					parseFutureDate(body.snoozedUntil),
					body.reason,
				),
			}
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }), body: TaskRequestModel.snooze })
	.post('/:id/cancel', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await TaskService.cancel(actor, params.id, body.reason) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }), body: TaskRequestModel.cancel })
