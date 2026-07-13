import { Elysia, t } from 'elysia'
import { InboxService } from './service'
import { InboxModel, InboxRequestModel } from './model'
import { appContext } from '../../plugins'

export const inbox = new Elysia({ prefix: '/inboxes', tags: ['Inbox'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const inboxes = await InboxService.getInboxes(resolvedAppId, userId)
			return { data: inboxes }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const i = await InboxService.getInboxById(params.id, resolvedAppId)
			if (!i) return { error: 'Inbox not found' }
			return { data: i }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ accountId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const i = await InboxService.createInbox(resolvedAppId, body)
			return { data: i }
		},
		{
			query: t.Object({ accountId: t.Optional(t.String()) }),
			body: InboxRequestModel.create,
		},
	)
	.patch(
		'/:id',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const i = await InboxService.updateInbox(params.id, resolvedAppId, body)
			return { data: i }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ accountId: t.Optional(t.String()) }),
			body: InboxRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			await InboxService.deleteInbox(params.id, resolvedAppId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ accountId: t.Optional(t.String()) }),
		},
	)
