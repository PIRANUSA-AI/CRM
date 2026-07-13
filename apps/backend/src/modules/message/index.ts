import { Elysia, t } from 'elysia'
import { MessageService } from './service'
import { appContext } from '../../plugins'

export const message = new Elysia({ prefix: '/messages', tags: ['Message'] })
	.use(appContext)
	// Send a message
	.post(
		'/',
		async ({ body, userId }) => {
			const msg = await MessageService.sendMessage({
				conversationId: body.conversationId,
				senderId: userId || body.senderId || '',
				senderType: 'agent',
				content: body.content,
				contentType: body.contentType || 'text',
				mediaIds: body.mediaIds,
			})
			return { data: msg }
		},
		{
			body: t.Object({
				conversationId: t.String(),
				senderId: t.Optional(t.String()),
				content: t.String(),
				contentType: t.Optional(t.String()),
				mediaIds: t.Optional(t.Array(t.String())),
			}),
		},
	)

	// Get message by ID
	.get(
		'/:id',
		async ({ params }) => {
			const msg = await MessageService.getMessageById(params.id)
			if (!msg) {
				return { error: 'Message not found' }
			}
			return { data: msg }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Update message status
	.patch(
		'/:id/status',
		async ({ params, body }) => {
			const msg = await MessageService.updateMessageStatus(
				params.id,
				body.status,
				body.externalId,
			)
			return { data: msg }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				status: t.String(),
				externalId: t.Optional(t.String()),
			}),
		},
	)

	// Delete message (soft delete)
	.delete(
		'/:id',
		async ({ params }) => {
			await MessageService.deleteMessage(params.id)
			return { success: true }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)
