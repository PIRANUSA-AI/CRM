import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { NotificationService } from './service'

export const notifications = new Elysia({ prefix: '/notifications', tags: ['Notifications'] })
	.use(appContext)
	.get('/', async ({ resolvedAppId, userId, query, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const data = await NotificationService.list(resolvedAppId, userId, {
			limit: query.limit ? Number(query.limit) : undefined,
			offset: query.offset ? Number(query.offset) : undefined,
			unreadOnly: query.unreadOnly === 'true',
			type: query.type || undefined,
		})
		return { data }
	}, {
		query: t.Object({
			limit: t.Optional(t.String()),
			offset: t.Optional(t.String()),
			unreadOnly: t.Optional(t.String()),
			type: t.Optional(t.String()),
		}),
	})
	.get('/count', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const count = await NotificationService.unreadCount(resolvedAppId, userId)
		return { count }
	})
	.post('/:id/read', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const ok = await NotificationService.markRead(resolvedAppId, userId, params.id)
		return { success: ok }
	}, { params: t.Object({ id: t.String() }) })
	.post('/read-all', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const count = await NotificationService.markAllRead(resolvedAppId, userId)
		return { success: true, count }
	})
