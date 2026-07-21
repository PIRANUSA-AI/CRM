import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { getRealtimeIO } from '../../lib/realtime'
import prisma from '../../lib/prisma'
import { LabelService } from '../label/service'
import { MessageService } from '../message/service'
import { ConversationBulkEditService } from './bulk-service'
import { NoteService } from './note-service'
import { ConversationService } from './service'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'

const WHATSAPP_FREE_WINDOW_EXPIRED = 'WHATSAPP_FREE_WINDOW_EXPIRED'

function normalizePhoneForWaMe(value: string | null | undefined): string | null {
	if (typeof value !== 'string') return null

	const trimmed = value.trim()
	if (!trimmed) return null

	let normalized = trimmed.replace(/[^\d+]/g, '')
	if (normalized.startsWith('+')) normalized = normalized.slice(1)
	if (normalized.startsWith('00')) normalized = normalized.slice(2)
	if (normalized.startsWith('0')) normalized = `62${normalized.slice(1)}`

	const digitsOnly = normalized.replace(/\D/g, '')
	if (digitsOnly.length < 8) return null

	return digitsOnly
}

function buildWaMeFollowUpUrl(value: string | null | undefined): string | null {
	const normalizedPhone = normalizePhoneForWaMe(value)
	if (!normalizedPhone) return null
	return `https://wa.me/${normalizedPhone}`
}

function isMessagingWindowActive(conversation: {
	messaging_window_expires_at?: Date | null
	contact_window_expires_at?: Date | null
	is_within_messaging_window?: boolean | null
	messaging_window_open?: boolean | null
}) {
	const expiresAt =
		conversation.messaging_window_expires_at ||
		conversation.contact_window_expires_at
	if (expiresAt instanceof Date) {
		return expiresAt.getTime() > Date.now()
	}

	return (
		conversation.is_within_messaging_window === true ||
		conversation.messaging_window_open === true
	)
}

export const conversation = new Elysia({
	prefix: '/conversations',
	tags: ['Conversation'],
})
	.use(appContext)
	// Get conversation status counts
	.get(
		'/counts',
		async ({ resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const counts = await ConversationService.getStatusCounts(
				resolvedAppId,
				userId,
			)
			return counts
		},
		{
			query: t.Object({
				accountId: t.Optional(t.String()),
				appId: t.Optional(t.String()),
			}),
		},
	)
	// List conversations with filters
	.get(
		'/',
		async ({ resolvedAppId, query, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const viewer = userId
				? await prisma.users.findUnique({ where: { id: userId }, select: { role: true } })
				: null

			// Fail closed: a userId that doesn't resolve to a real user row (stale
			// session, deleted account) must not fall through to unfiltered access.
			if (userId && !viewer) {
				set.status = 403
				return { error: 'Not authorized' }
			}

			const result = await ConversationService.getConversations(resolvedAppId, {
				status: query.status,
				inboxId: query.inboxId,
				agentId: query.agentId,
				priority: query.priority,
				page: query.page ? parseInt(query.page) : 1,
				limit: query.limit ? parseInt(query.limit) : 10,
				viewerUserId: userId,
				viewerRole: viewer?.role ?? undefined,
				dateFrom: query.dateFrom,
				dateTo: query.dateTo,
				labelIds: query.labelIds ? query.labelIds.split(',') : undefined,
				resolvedBy: query.resolvedBy,
				aiAgentId: query.aiAgentId,
				pipelineStageId: query.pipelineStageId,
				channelType: query.channelType,
				provider: query.provider,
			})
			return result
		},
		{
			query: t.Object({
				accountId: t.Optional(t.String()),
				appId: t.Optional(t.String()),
				status: t.Optional(t.String()),
				inboxId: t.Optional(t.String()),
				agentId: t.Optional(t.String()),
				priority: t.Optional(t.String()),
				page: t.Optional(t.String()),
				limit: t.Optional(t.String()),
				dateFrom: t.Optional(t.String()),
				dateTo: t.Optional(t.String()),
				labelIds: t.Optional(t.String()),
				resolvedBy: t.Optional(t.String()),
				aiAgentId: t.Optional(t.String()),
				pipelineStageId: t.Optional(t.String()),
				channelType: t.Optional(t.String()),
				provider: t.Optional(t.String()),
			}),
		},
	)

	// Queue bulk-edit conversation actions
	.post(
		'/bulk-edit',
		async ({ resolvedAppId, body, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}

			try {
				const queued = await ConversationBulkEditService.enqueueBulkEdit({
					appId: resolvedAppId,
					actorId: userId || null,
					conversationIds: body.conversationIds,
					changes: {
						collaboratorIds: body.collaboratorIds,
						handledById: body.handledById,
						labelId: body.labelId,
						pipelineStageId: body.pipelineStageId,
						resolveStatus: body.resolveStatus,
					},
				})

				return { success: true, payload: queued }
			} catch (error: any) {
				set.status = 400
				return {
					success: false,
					error: error?.message || 'Failed to queue bulk edit',
				}
			}
		},
		{
			body: t.Object({
				conversationIds: t.Array(t.String()),
				collaboratorIds: t.Optional(t.Array(t.String())),
				handledById: t.Optional(t.String()),
				labelId: t.Optional(t.String()),
				pipelineStageId: t.Optional(t.String()),
				resolveStatus: t.Optional(
					t.Union([
						t.Literal('open'),
						t.Literal('pending'),
						t.Literal('resolved'),
					]),
				),
			}),
		},
	)

	// Get bulk-edit job status
	.get(
		'/bulk-edit/:jobId',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}

			const status = await ConversationBulkEditService.getBulkEditJobStatus(
				resolvedAppId,
				params.jobId,
			)

			if (!status) {
				set.status = 404
				return { success: false, error: 'Bulk edit job not found' }
			}

			return { success: true, payload: status }
		},
		{
			params: t.Object({
				jobId: t.String(),
			}),
		},
	)

	// Get conversation contact detail summary
	.get(
		'/:id/contact-detail',
		async ({ params, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const detail = await ConversationService.getContactDetail(
				params.id,
				resolvedAppId,
				userId,
			)

			if (!detail) {
				set.status = 404
				return { error: 'Conversation not found' }
			}

			return { data: detail }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Get conversation by ID
	.get(
		'/:id',
		async ({ params, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const conv = await ConversationService.getConversationById(
				params.id,
				resolvedAppId,
				userId,
			)
			if (!conv) {
				return { error: 'Conversation not found' }
			}
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Update conversation status (PATCH)
	.patch(
		'/:id/status',
		async ({ params, body }) => {
			const conv = await ConversationService.updateStatus(
				params.id,
				body.status,
			)
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				status: t.String(),
			}),
		},
	)

	// Update conversation status (POST, frontend uses POST)
	.post(
		'/:id/status',
		async ({ params, body }) => {
			const conv = await ConversationService.updateStatus(
				params.id,
				body.status,
			)
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				status: t.String(),
			}),
		},
	)

	// Resolve conversation (shortcut)
	.post(
		'/:id/resolve',
		async ({ params }) => {
			const conv = await ConversationService.updateStatus(params.id, 'resolved')
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Assign agent to conversation
	.post(
		'/:id/assign',
		async ({ params, body }) => {
			const conv = await ConversationService.assignAgent(
				params.id,
				body.agentId,
			)
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				agentId: t.String(),
			}),
		},
	)

	// Take over conversation with current authenticated agent
	.post(
		'/:id/takeover',
		async ({ params, body, userId, set }) => {
			const requestedAgentId =
				(userId && userId.trim()) ||
				(typeof body === 'object' &&
				body !== null &&
				'agentId' in body &&
				typeof (body as { agentId?: unknown }).agentId === 'string'
					? (body as { agentId: string }).agentId
					: null) ||
				(typeof body === 'object' &&
				body !== null &&
				'agent_id' in body &&
				typeof (body as { agent_id?: unknown }).agent_id === 'string'
					? (body as { agent_id: string }).agent_id
					: null)

			if (!requestedAgentId) {
				set.status = 401
				return { error: 'Unauthorized: user not found' }
			}

			const conv = await ConversationService.assignAgent(
				params.id,
				requestedAgentId,
				'takeover',
			)
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Optional(
				t.Object({
					agentId: t.Optional(t.String()),
					agent_id: t.Optional(t.String()),
				}),
			),
		},
	)

	// Mark conversation as read
	.post(
		'/:id/read',
		async ({ params }) => {
			const conv = await ConversationService.markAsRead(params.id)
			return { data: conv }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

		// Get conversation messages
		.get(
			'/:id/messages',
			async ({ params, query, resolvedAppId, userId, set }) => {
				if (!resolvedAppId) {
					set.status = 400
					return { error: 'App ID required' }
				}
				const messages = await ConversationService.getConversationMessages(
					params.id,
					query.limit ? parseInt(query.limit) : 10,
					query.before,
					resolvedAppId,
					userId,
				)
				return { data: messages }
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				query: t.Object({
					limit: t.Optional(t.String()),
					before: t.Optional(t.String()),
				}),
			},
		)
		.post(
			'/:id/messages',
			async ({ params, body, userId, resolvedAppId, set }) => {
				if (!resolvedAppId) {
					set.status = 400
					return { error: 'App ID required' }
				}

				const targetConversation = await ConversationService.getConversationById(
					params.id,
					resolvedAppId,
					userId,
				)

				if (!targetConversation) {
					set.status = 404
					return { error: 'Conversation not found' }
				}

				const mediaPayload = body.media as
					| { type?: string; url?: string; mimeType?: string; fileName?: string }
					| undefined
				const hasMedia = mediaPayload?.url
				const senderType =
					body.sender_type === 'system' ? 'system' : ('agent' as const)

				const contentType = hasMedia
					? mediaPayload.type || 'image'
					: body.type || body.content_type || 'text'
				const isTemplate = contentType === 'template'
				const rawContent = body.content

				let content = ''
				let contentAttributes: Record<string, unknown> = {
					...(body.content_attributes || {}),
					type: contentType,
				}

				if (
					senderType !== 'system' &&
					targetConversation.channel_type === 'whatsapp' &&
					!isTemplate &&
					!isMessagingWindowActive({
						messaging_window_expires_at:
							targetConversation.messaging_window_expires_at,
						contact_window_expires_at:
							targetConversation.contacts?.window_expires_at || null,
						is_within_messaging_window:
							targetConversation.is_within_messaging_window,
						messaging_window_open: targetConversation.messaging_window_open,
					})
				) {
					const followUpUrl = buildWaMeFollowUpUrl(
						targetConversation.contacts?.phone_number ||
							targetConversation.contacts?.identifier ||
							null,
					)

					set.status = 422
					return {
						error:
							'Window gratis 24 jam WhatsApp customer sudah habis. Tidak bisa kirim pesan lagi, silakan follow up via WhatsApp biasa.',
						code: WHATSAPP_FREE_WINDOW_EXPIRED,
						...(followUpUrl ? { follow_up_url: followUpUrl } : {}),
					}
				}

				if (hasMedia) {
					content = mediaPayload.url!
					contentAttributes = {
						...contentAttributes,
						type: contentType,
						media_url: mediaPayload.url,
						media_type: mediaPayload.type,
						mime_type: mediaPayload.mimeType,
						file_name: mediaPayload.fileName,
					}
				} else if (isTemplate) {
					if (rawContent && typeof rawContent === 'object') {
						const templatePayload = rawContent as Record<string, unknown>
						content = String(templatePayload.name || '')
						contentAttributes = {
							...contentAttributes,
							...(templatePayload.language
								? { language: templatePayload.language }
								: {}),
							...(Array.isArray(templatePayload.components)
								? { components: templatePayload.components }
								: {}),
						}
					} else {
						content = String(rawContent || '')
					}
				} else {
					content =
						typeof rawContent === 'string'
							? rawContent
							: JSON.stringify(rawContent ?? '')
				}

				if (!content.trim()) {
					set.status = 400
					return { error: 'Message content is required' }
				}

				const message = await MessageService.sendMessage({
					conversationId: params.id,
					senderId: userId || body.senderId || null,
					senderType,
					content,
					contentType,
					mediaIds: body.mediaIds,
					contentAttributes,
					uniqueTempId: body.unique_temp_id,
					replyToMessageId: body.reply_to_message_id,
				})

				// Emit socket event so other agents see the message in realtime
				try {
					const io = getRealtimeIO()
					if (io) {
						const conv = await ConversationService.getConversationById(params.id)
						if (conv) {
							const payload = {
								message: {
									id: message.id,
									external_id: message.external_id || null,
									content: message.content,
									message_type: message.message_type,
									content_type: message.content_type,
									content_attributes: message.content_attributes || {},
									extras: message.extras || {},
									status: message.status,
									sender_type: message.sender_type,
									sender_id: message.sender_id,
									created_at: message.created_at,
									reply_to_message_id: message.reply_to_message_id || null,
									unique_temp_id: message.unique_temp_id || null,
								},
								conversation: {
									id: conv.id,
									app_id: conv.app_id,
									inbox_id: conv.inbox_id,
									channel_type: conv.channel_type,
									provider: (conv as any).provider || null,
									whatsapp_provider:
										(conv as any).whatsapp_provider || (conv as any).provider || null,
									status: conv.status,
									channel_name: conv.inboxes?.name,
									contacts: conv.contacts,
								},
							}
							io.to(`app:${conv.app_id}`).emit('message:created', payload)
						}
					}
				} catch (e) {
					console.error('[Conversation] Failed to emit outgoing message event:', e)
				}

				return { data: message }
			},
			{
				params: t.Object({
					id: t.String(),
				}),
				body: t.Object({
					content: t.Any(),
					senderId: t.Optional(t.String()),
					sender_type: t.Optional(
						t.Union([t.Literal('agent'), t.Literal('system')]),
					),
					type: t.Optional(t.String()),
					content_type: t.Optional(t.String()),
					content_attributes: t.Optional(t.Record(t.String(), t.Any())),
					media: t.Optional(t.Any()),
					mediaIds: t.Optional(t.Array(t.String())),
					unique_temp_id: t.Optional(t.String()),
					reply_to_message_id: t.Optional(t.String()),
				}),
			},
		)

	// === Labels ===
	.get(
		'/:id/labels',
		async ({ params }) => {
			const labels = await LabelService.getConversationLabels(params.id)
			return { success: true, payload: labels }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/:id/labels',
		async ({ params, body }) => {
			await LabelService.addLabelToConversation(params.id, body.labelId)
			const labels = await LabelService.getConversationLabels(params.id)
			return { success: true, payload: labels }
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({ labelId: t.String() }),
		},
	)
	.delete(
		'/:id/labels/:labelId',
		async ({ params }) => {
			await LabelService.removeLabelFromConversation(params.id, params.labelId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String(), labelId: t.String() }),
		},
	)

	// === Notes ===
	.get(
		'/:id/notes',
		async ({ params }) => {
			const notes = await NoteService.listNotes(params.id)
			return { notes }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/:id/notes',
		async ({ params, body, store }) => {
			const user = (store as any)?.user
			const userId = user?.id
			const note = await NoteService.createNote(params.id, userId, body.content)
			return { note }
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({ content: t.String() }),
		},
	)
	.patch(
		'/:id/notes/:noteId',
		async ({ params, body, store, set }) => {
			const user = (store as any)?.user
			const userId = user?.id
			const note = await NoteService.updateNote(
				params.id,
				params.noteId,
				userId,
				body.content,
			)
			if (!note) {
				set.status = 404
				return { error: 'Note not found' }
			}
			return { note }
		},
		{
			params: t.Object({ id: t.String(), noteId: t.String() }),
			body: t.Object({ content: t.String() }),
		},
	)

	// === Activity Log ===
	.get(
		'/:id/activity',
		async ({ params }) => {
			const prisma = (await import('../../lib/prisma')).default
			const activities = await prisma.conversation_activity_log.findMany({
				where: { conversation_id: params.id },
				orderBy: { created_at: 'desc' },
			})
			return { success: true, payload: activities }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)

	// === Agents ===
	.post(
		'/:id/agents',
		async ({ params, body, set }) => {
			const agentId = body.agentId || body.agent_id
			if (!agentId) {
				set.status = 400
				return { error: 'agentId is required' }
			}

			const conv = await ConversationService.assignAgent(params.id, agentId)
			return { success: true, payload: conv }
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				agentId: t.Optional(t.String()),
				agent_id: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/:id/agents',
		async ({ params }) => {
			const prisma = (await import('../../lib/prisma')).default
			const assignments = await prisma.conversation_agents.findMany({
				where: {
					conversation_id: params.id,
					status: 'active',
				},
				select: {
					agent_id: true,
					is_primary: true,
					assigned_at: true,
				},
				orderBy: [{ is_primary: 'desc' }, { assigned_at: 'asc' }],
			})

			const agentIds = Array.from(
				new Set(
					assignments
						.map((assignment) => assignment.agent_id)
						.filter((agentId): agentId is string => Boolean(agentId)),
				),
			)

				const users = agentIds.length
					? await prisma.users.findMany({
							where: { id: { in: agentIds } },
							select: {
								id: true,
								name: true,
								email: true,
								avatar_url: true,
							},
						})
					: []

				const usersById = new Map<
					string,
					{
						id: string
						name: string
						email: string
						avatar_url: string | null
					}
				>(users.map((user) => [user.id, user]))
			const agents = assignments
				.map((assignment) => {
					const user = usersById.get(assignment.agent_id)
					if (!user) return null
					return {
						id: user.id,
						name: user.name,
						email: user.email,
						avatar_url: user.avatar_url,
						is_primary: assignment.is_primary,
						assigned_at: assignment.assigned_at,
					}
				})
				.filter(
					(
						agent,
					): agent is {
						id: string
						name: string
						email: string
						avatar_url: string | null
						is_primary: boolean | null
						assigned_at: Date | null
					} => Boolean(agent),
				)
			// Fallback: If no agents found in relational table, check main assignee_id
			if (Array.isArray(agents) && agents.length === 0) {
				const conv = await prisma.conversations.findUnique({
					where: { id: params.id },
					select: { assignee_id: true },
				})

				if (conv?.assignee_id) {
					const assignee = await prisma.users.findUnique({
						where: { id: conv.assignee_id },
						select: {
							id: true,
							name: true,
							email: true,
							avatar_url: true,
						},
					})

					if (assignee) {
						return {
							success: true,
							payload: [
								{
									...assignee,
									is_primary: true,
									assigned_at: new Date(),
								},
							],
						}
					}
				}
			}

			return { success: true, payload: agents }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.delete(
		'/:id/agents/:agentId',
		async ({ params }) => {
			const prisma = (await import('../../lib/prisma')).default

			await prisma.conversation_agents.updateMany({
				where: {
					conversation_id: params.id,
					agent_id: params.agentId,
					status: 'active',
				},
				data: {
					status: 'inactive',
					is_primary: false,
					removed_at: new Date(),
				},
			})

			const conv = await prisma.conversations.findUnique({
				where: { id: params.id },
				select: { assignee_id: true, app_id: true, inbox_id: true },
			})

			if (conv?.assignee_id === params.agentId) {
				const fallbackPrimary = await prisma.conversation_agents.findFirst({
					where: {
						conversation_id: params.id,
						status: 'active',
						agent_id: { not: params.agentId },
					},
					orderBy: [{ is_primary: 'desc' }, { assigned_at: 'asc' }],
					select: { agent_id: true },
				})

				await prisma.conversations.update({
					where: { id: params.id },
					data: {
						assignee_id: fallbackPrimary?.agent_id || null,
						updated_at: new Date(),
					},
				})

				if (conv.app_id) {
					void BusinessWebhookDispatchService.dispatch({
						event: 'conversation.handled_by_updated',
						appId: conv.app_id,
						inboxId: conv.inbox_id,
						payload: {
							conversation_id: params.id,
							previous_assignee_id: params.agentId,
							current_assignee_id: fallbackPrimary?.agent_id || null,
							assignment_type: 'unassign',
						},
					})
				}
			}

			return { success: true }
		},
		{
			params: t.Object({ id: t.String(), agentId: t.String() }),
		},
	)
