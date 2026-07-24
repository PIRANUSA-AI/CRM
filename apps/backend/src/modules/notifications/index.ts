import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { NotificationService } from './service'
import { cached, invalidateCache } from '../../lib/cache'

// The frontend only ever calls the list endpoint with { limit: 20 } (no
// offset/filter) for the notification bell - that's the one cache variant
// worth busting immediately after a mutation. Other filter combos just ride
// out their 5s TTL, which is an acceptable staleness window.
function invalidateNotifCaches(appId: string, userId: string) {
	invalidateCache(`count:notif:${appId}:${userId}`)
	invalidateCache(`list:notif:${appId}:${userId}:20::false:`)
}

export const notifications = new Elysia({ prefix: '/notifications', tags: ['Notifications'] })
	.use(appContext)
	.get('/', async ({ resolvedAppId, userId, query, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const limit = query.limit ? Number(query.limit) : undefined
		const offset = query.offset ? Number(query.offset) : undefined
		const unreadOnly = query.unreadOnly === 'true'
		const type = query.type || undefined
		// Polled every 60s per tab plus refetched on every socket notification -
		// short TTL absorbs bursts from many agents refreshing near-simultaneously.
		const data = await cached(
			`list:notif:${resolvedAppId}:${userId}:${limit ?? ''}:${offset ?? ''}:${unreadOnly}:${type ?? ''}`,
			5,
			() => NotificationService.list(resolvedAppId, userId, { limit, offset, unreadOnly, type }),
		)
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
		const count = await cached(
			`count:notif:${resolvedAppId}:${userId}`,
			5,
			() => NotificationService.unreadCount(resolvedAppId, userId),
		)
		return { count }
	})
	.post('/:id/read', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const ok = await NotificationService.markRead(resolvedAppId, userId, params.id)
		invalidateNotifCaches(resolvedAppId, userId)
		return { success: ok }
	}, { params: t.Object({ id: t.String() }) })
	.post('/read-all', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const count = await NotificationService.markAllRead(resolvedAppId, userId)
		invalidateNotifCaches(resolvedAppId, userId)
		return { success: true, count }
	})
