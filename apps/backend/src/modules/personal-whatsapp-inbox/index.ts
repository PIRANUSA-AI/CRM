import { Elysia, t } from 'elysia'
import prisma from '../../lib/prisma'
import { incomingMessageQueue, webhookQueue } from '../../lib/queue'
import { appContext } from '../../plugins'
import { WebhookService } from '../webhook/service'
import { WhatsAppService } from '../whatsapp/service'
import { transcribePhoneNumber } from '../../services/deepgram'
import { BaileysServiceClient } from '../whatsapp/baileys-service-client'
import { getRealtimeIO } from '../../lib/realtime'
import { requireRole } from '../../lib/require-role'
import { normalizeS3PublicUrl } from '../../lib/s3'
import { enqueueProfileContact, enqueueProfileSweep } from './profile-sync'
import {
	confirmPersonalLead,
	countPersonalLeadRegistrations,
	listConfirmedPersonalLeadPhones,
	listPersonalLeadRegistrations,
	setPersonalLeadStatus,
	type PersonalLeadRegistration,
} from './lead-access'
import { PersonalAiReplyService } from './ai-reply'
import { enqueueTaskAnalysis } from '../tasks/worker'
import { TaskService } from '../tasks/service'
import { PersonalTakeoverService } from './takeover'
import { NotificationService } from '../notifications/service'

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function normalizeMessageMediaAttributes(value: unknown) {
	const attributes = asRecord(value)
	const media = asRecord(attributes.media)
	const currentUrl = typeof media.url === 'string' ? media.url : null
	const normalizedUrl = normalizeS3PublicUrl(currentUrl)
	if (!currentUrl || !normalizedUrl || normalizedUrl === currentUrl) return { value, changed: false }
	return { value: { ...attributes, media: { ...media, url: normalizedUrl } }, changed: true }
}

function normalizePhoneNumber(value: string) {
	let digits = String(value || '').replace(/\D/g, '')
	if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
	else if (digits.startsWith('8')) digits = `62${digits}`
	return /^\d{8,15}$/.test(digits) ? digits : null
}

async function resolveOwnedChannel(appId: string, userId: string) {
	const session = await prisma.baileys_sessions.findFirst({
		where: { app_id: appId, owner_user_id: userId },
		select: { channel_id: true, provider_channel_key: true, status: true, phone_number: true, last_seen_at: true },
	})
	if (!session) return { session: null, channel: null }
	const channel = await prisma.whatsapp_channels.findFirst({
		where: { id: session.channel_id, app_id: appId, provider: 'baileys', deleted_at: null },
		select: { id: true, inbox_id: true, api_key: true },
	})
	return { session, channel }
}

async function updateConversationPersonalLeadState(
	appId: string,
	ownerUserId: string,
	registration: PersonalLeadRegistration,
) {
	if (!registration.conversation_id) return
	const conversation = await prisma.conversations.findFirst({
		where: { id: registration.conversation_id, app_id: appId },
		select: { id: true, additional_attributes: true },
	})
	if (!conversation) return
	await prisma.conversations.update({
		where: { id: conversation.id },
		data: {
			additional_attributes: {
				...asRecord(conversation.additional_attributes),
				personal_whatsapp: {
					owner_user_id: ownerUserId,
					lead_registration_id: registration.id,
					lead_status: registration.status,
				},
			} as any,
			...(registration.status === 'blocked' ? { unread_count: 0 } : {}),
			updated_at: new Date(),
		},
	})
}

export const personalWhatsappInbox = new Elysia({ prefix: '/personal-whatsapp-inbox' })
	.use(appContext)
	.post('/ingest', async ({ body, headers, set }) => {
		const payload = body as Record<string, any>
		const channelKey = String(payload?.channelKey || '').trim()
		const authorization = String(headers.authorization || '')
		const bearer = authorization.toLowerCase().startsWith('bearer ')
			? authorization.slice(7).trim()
			: ''
		const secret = String(headers['x-crm-channel-secret'] || bearer).trim()
		if (!channelKey || !secret) { set.status = 403; return { error: 'Channel authentication required' } }
		const channel = await WhatsAppService.authenticateBaileysChannel(channelKey, secret)
		if (!channel) { set.status = 403; return { error: 'Invalid channel credentials' } }
		if (!channel.app_id) { set.status = 422; return { error: 'Channel is not assigned to a CRM app' } }
		if (String(payload?.event || '') === 'presence.update') {
			getRealtimeIO()?.to(`app:${channel.app_id}`).emit('whatsapp:presence', {
				phone: String(payload.phone || '').replace(/\D/g, ''),
				presence: String(payload.presence || 'unavailable'),
				timestamp: Number(payload.timestamp || Date.now()),
			})
			return { success: true, realtime: true }
		}
		if (String(payload?.event || '') === 'contact.profile_changed') {
			const phone = String(payload.phone || '').replace(/\D/g, '')
			const contact = await prisma.contacts.findFirst({
				where: { app_id: channel.app_id, deleted_at: null, OR: [{ phone_number: phone }, { whatsapp_id: phone }] }, select: { id: true },
			})
			if (contact) await enqueueProfileContact(channel.app_id, channel.id, contact.id, true)
			return { success: true, queued: Boolean(contact) }
		}
		if (String(payload?.event || '') === 'message.deleted') {
			const externalIds = Array.isArray(payload.externalIds)
				? payload.externalIds.map((id: unknown) => String(id || '').trim()).filter(Boolean).slice(0, 500)
				: []
			if (!externalIds.length) return { success: true, updated: 0 }
			const messages = await prisma.messages.findMany({
				where: { app_id: channel.app_id, inbox_id: channel.inbox_id, external_id: { in: externalIds }, deleted_at: null },
				select: { id: true, content: true, content_type: true, content_attributes: true },
			})
			for (const message of messages) {
				await prisma.messages.update({
					where: { id: message.id },
					data: {
						content: null,
						content_type: 'revoked',
						status: 'deleted',
						content_attributes: {
							...asRecord(message.content_attributes),
							whatsapp_revoke: { original_content: message.content, original_content_type: message.content_type, detected_at: new Date().toISOString() },
						} as any,
						updated_at: new Date(),
					},
				})
			}
			if (messages.length) getRealtimeIO()?.to(`app:${channel.app_id}`).emit('message:revoked', { messageIds: messages.map((message) => message.id) })
			return { success: true, updated: messages.length }
		}
		if (String(payload?.event || '') === 'session.status') {
			// Microservice Baileys melaporkan perubahan status koneksi (logout/
			// reconnect). Delegasikan ke processWhatsAppPayload yang mem-fire
			// notifikasi wa_disconnected ke owner + emit realtime + mencatat audit.
			return WebhookService.processWhatsAppPayload(payload)
		}
		const result = await WebhookService.handleWhatsAppInbound(payload)
		if (!result.success) { set.status = 422; return result }
		const inboundPhone = String(payload?.contact?.waId || payload?.contact?.wa_id || payload?.message?.from || '').replace(/\D/g, '')
		if (inboundPhone) {
			const contact = await prisma.contacts.findFirst({
				where: { app_id: channel.app_id, deleted_at: null, OR: [{ phone_number: inboundPhone }, { whatsapp_id: inboundPhone }] }, select: { id: true },
			})
			if (contact) void enqueueProfileContact(channel.app_id, channel.id, contact.id, false).catch(() => undefined)
		}
		return { success: true, direct: true, result }
	}, { body: t.Any() })
	.post('/repair-queue', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }

		const queues = [incomingMessageQueue, webhookQueue]
		let retried = 0
		let promoted = 0
		let waiting = 0
		let active = 0
		for (const queue of queues) {
			const jobs = await queue.getJobs(['failed', 'delayed', 'waiting', 'active'], 0, 1999, true)
			for (const job of jobs) {
				const payload = (job.data as any)?.payload ?? job.data
				if (String(payload?.channelKey || '') !== session.provider_channel_key) continue
				const state = await job.getState()
				if (state === 'failed') { await job.retry(); retried += 1 }
				else if (state === 'delayed') { await job.promote(); promoted += 1 }
				else if (state === 'waiting') waiting += 1
				else if (state === 'active') active += 1
			}
		}
		return { data: { retried, promoted, waiting, active } }
	})
	.post('/sync-profiles', async ({ resolvedAppId, userId, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		await enqueueProfileSweep(resolvedAppId, session.channel_id, body.force === true)
		return { success: true, queued: true }
	}, { body: t.Object({ force: t.Optional(t.Boolean()) }) })
	.get('/leads', async ({ resolvedAppId, userId, query, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const [rows, total] = await Promise.all([
			listPersonalLeadRegistrations(resolvedAppId, userId, query.status),
			countPersonalLeadRegistrations(resolvedAppId, userId, query.status),
		])
		const contactIds = rows.map((row) => row.contact_id).filter((id): id is string => Boolean(id))
		const conversationIds = rows.map((row) => row.conversation_id).filter((id): id is string => Boolean(id))
		const [contacts, conversations] = await Promise.all([
			contactIds.length ? prisma.contacts.findMany({
				where: { id: { in: contactIds }, app_id: resolvedAppId },
				select: { id: true, name: true, phone_number: true, avatar_url: true },
			}) : [],
			conversationIds.length ? prisma.conversations.findMany({
				where: { id: { in: conversationIds }, app_id: resolvedAppId },
				select: { id: true, last_message_at: true, messages: { where: { deleted_at: null }, orderBy: { created_at: 'desc' }, take: 1, select: { content: true, created_at: true } } },
			}) : [],
		])
		const contactMap = new Map(contacts.map((contact) => [contact.id, contact]))
		const conversationMap = new Map(conversations.map((conversation) => [conversation.id, conversation]))
		return {
			total,
			data: rows.map((row) => {
				const contact = row.contact_id ? contactMap.get(row.contact_id) : null
				const conversation = row.conversation_id ? conversationMap.get(row.conversation_id) : null
				return {
					id: row.id,
					status: row.status,
					name: contact?.name || row.display_name || row.phone_number,
					phone: contact?.phone_number || row.phone_number,
					avatarUrl: normalizeS3PublicUrl(contact?.avatar_url) || null,
					conversationId: row.conversation_id,
					preview: conversation?.messages[0]?.content || 'Pesan baru menunggu keputusan',
					// Prefer the real last message time (reliable) over the conversation's
					// last_message_at, which can be stale/skewed from WhatsApp timestamps.
					lastMessageAt: conversation?.messages[0]?.created_at || conversation?.last_message_at || row.updated_at,
					source: row.source,
				}
			}),
		}
	}, { query: t.Object({ status: t.Union([t.Literal('pending'), t.Literal('blocked'), t.Literal('ignored')]) }) })
	.post('/leads/:registrationId/confirm', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const registration = await setPersonalLeadStatus({ appId: resolvedAppId, ownerUserId: userId, registrationId: params.registrationId, status: 'confirmed' })
		if (!registration) { set.status = 404; return { error: 'Permintaan lead tidak ditemukan' } }
		await updateConversationPersonalLeadState(resolvedAppId, userId, registration)
		getRealtimeIO()?.to(`app:${resolvedAppId}`).emit('personal-lead:updated', { registrationId: registration.id, status: 'confirmed', conversationId: registration.conversation_id })
		// Fetch the WhatsApp profile photo now that it's a confirmed lead so it shows
		// in the chat (best-effort; needs WhatsApp connected).
		if (registration.contact_id) {
			const { session } = await resolveOwnedChannel(resolvedAppId, userId)
			if (session?.channel_id) {
				void enqueueProfileContact(resolvedAppId, session.channel_id, registration.contact_id, true).catch(() => undefined)
			}
		}
		if (registration.conversation_id) {
			await NotificationService.resolve(resolvedAppId, userId, `lead_pending:${registration.conversation_id}`)
			const latestInbound = await prisma.messages.findFirst({
				where: { conversation_id: registration.conversation_id, app_id: resolvedAppId, deleted_at: null, message_type: 'incoming' },
				orderBy: { created_at: 'desc' },
				select: { id: true },
			})
			if (latestInbound) {
				void PersonalAiReplyService.scheduleInbound({
					appId: resolvedAppId,
					ownerUserId: userId,
					conversationId: registration.conversation_id,
					inboundMessageId: latestInbound.id,
				}).catch((error) => {
					console.warn('[PersonalWhatsAppInbox] Failed resuming AI after lead confirmation:', error)
				})
				// Analyze the customer's latest message right after confirmation so a task
				// appears without waiting for a brand-new inbound message. The worker
				// re-validates confirmed status, and the deterministic job id keeps this
				// idempotent with the webhook enqueue.
				void enqueueTaskAnalysis({
					appId: resolvedAppId,
					messageId: latestInbound.id,
					ownerUserId: userId,
				}).catch((error) => {
					console.warn('[PersonalWhatsAppInbox] Failed enqueueing task analysis after lead confirmation:', error)
				})
			}
		}
		return { success: true, data: registration }
	}, { params: t.Object({ registrationId: t.String() }) })
	.post('/leads/:registrationId/reject', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const registration = await setPersonalLeadStatus({ appId: resolvedAppId, ownerUserId: userId, registrationId: params.registrationId, status: 'ignored' })
		if (!registration) { set.status = 404; return { error: 'Permintaan lead tidak ditemukan' } }
		await updateConversationPersonalLeadState(resolvedAppId, userId, registration)
		getRealtimeIO()?.to(`app:${resolvedAppId}`).emit('personal-lead:updated', { registrationId: registration.id, status: 'ignored', conversationId: registration.conversation_id })
		return { success: true }
	}, { params: t.Object({ registrationId: t.String() }) })
	.post('/leads/:registrationId/block', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const registration = await setPersonalLeadStatus({ appId: resolvedAppId, ownerUserId: userId, registrationId: params.registrationId, status: 'blocked' })
		if (!registration) { set.status = 404; return { error: 'Nomor tidak ditemukan' } }
		await updateConversationPersonalLeadState(resolvedAppId, userId, registration)
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		let whatsappBlocked = false
		if (session?.status === 'connected' && channel?.api_key) {
			try {
				await BaileysServiceClient.updateBlockStatus({ channelKey: session.provider_channel_key, phoneNumber: registration.phone_number, action: 'block' }, { Authorization: `Bearer ${channel.api_key}`, 'X-Crm-Channel-Secret': channel.api_key })
				whatsappBlocked = true
			} catch (error) {
				console.warn('[PersonalWhatsAppInbox] CRM block saved, but WhatsApp block failed:', error)
			}
		}
		if (registration.conversation_id) {
			await NotificationService.resolve(resolvedAppId, userId, `lead_pending:${registration.conversation_id}`)
		}
		getRealtimeIO()?.to(`app:${resolvedAppId}`).emit('personal-lead:updated', { registrationId: registration.id, status: 'blocked', conversationId: registration.conversation_id })
		return { success: true, whatsappBlocked }
	}, { params: t.Object({ registrationId: t.String() }) })
	.post('/leads/:registrationId/unblock', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const registration = await setPersonalLeadStatus({ appId: resolvedAppId, ownerUserId: userId, registrationId: params.registrationId, status: 'confirmed' })
		if (!registration) { set.status = 404; return { error: 'Nomor terblokir tidak ditemukan' } }
		await updateConversationPersonalLeadState(resolvedAppId, userId, registration)
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		let whatsappUnblocked = false
		if (session?.status === 'connected' && channel?.api_key) {
			try {
				await BaileysServiceClient.updateBlockStatus({ channelKey: session.provider_channel_key, phoneNumber: registration.phone_number, action: 'unblock' }, { Authorization: `Bearer ${channel.api_key}`, 'X-Crm-Channel-Secret': channel.api_key })
				whatsappUnblocked = true
			} catch (error) {
				console.warn('[PersonalWhatsAppInbox] CRM unblock saved, but WhatsApp unblock failed:', error)
			}
		}
		getRealtimeIO()?.to(`app:${resolvedAppId}`).emit('personal-lead:updated', { registrationId: registration.id, status: 'confirmed', conversationId: registration.conversation_id })
		return { success: true, whatsappUnblocked }
	}, { params: t.Object({ registrationId: t.String() }) })
	.get('/ai/settings', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const settings = await PersonalAiReplyService.getSettings(resolvedAppId, userId)
		return {
			data: {
				autoReplyEnabled: settings.auto_reply_enabled,
				reviewEnabled: settings.review_enabled,
				replyDelaySeconds: settings.reply_delay_seconds,
				minConfidence: settings.min_confidence,
				personaPrompt: settings.persona_prompt,
				model: process.env.OLLAMA_CHAT_MODEL || 'qwen3.5:4b',
			},
		}
	})
	.patch('/ai/settings', async ({ resolvedAppId, userId, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const settings = await PersonalAiReplyService.updateSettings(resolvedAppId, userId, body)
		return {
			data: {
				autoReplyEnabled: settings.auto_reply_enabled,
				reviewEnabled: settings.review_enabled,
				replyDelaySeconds: settings.reply_delay_seconds,
				minConfidence: settings.min_confidence,
				personaPrompt: settings.persona_prompt,
				model: process.env.OLLAMA_CHAT_MODEL || 'qwen3.5:4b',
			},
		}
	}, {
		body: t.Object({
			autoReplyEnabled: t.Optional(t.Boolean()),
			replyDelaySeconds: t.Optional(t.Number({ minimum: 1, maximum: 300 })),
			minConfidence: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
			personaPrompt: t.Optional(t.Nullable(t.String({ maxLength: 2000 }))),
		}),
	})
	.get('/ai/drafts', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const rows = await PersonalAiReplyService.listDrafts(resolvedAppId, userId)
		return {
			data: rows.map((row) => ({
				id: row.id,
				status: row.status,
				conversationId: row.conversation_id,
				contactName: row.contact_name || row.phone_number || 'Customer',
				phoneNumber: row.phone_number,
				latestCustomerMessage: row.latest_customer_message,
				draftText: row.draft_text,
				reviewReason: row.review_reason,
				reviewConfidence: row.review_confidence,
				updatedAt: row.updated_at,
			})),
		}
	})
	.post('/ai/drafts/:taskId/send', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		try {
			const message = await PersonalAiReplyService.sendDraft(resolvedAppId, userId, params.taskId, body.content)
			return { success: true, data: { messageId: message.id } }
		} catch (error) {
			set.status = 409
			return { error: error instanceof Error ? error.message : 'Draft tidak dapat dikirim' }
		}
	}, {
		params: t.Object({ taskId: t.String() }),
		body: t.Object({ content: t.Optional(t.String({ minLength: 1, maxLength: 4096 })) }),
	})
	.post('/ai/drafts/:taskId/dismiss', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const dismissed = await PersonalAiReplyService.dismissDraft(resolvedAppId, userId, params.taskId)
		if (!dismissed) { set.status = 404; return { error: 'Draft tidak ditemukan' } }
		return { success: true }
	}, { params: t.Object({ taskId: t.String() }) })
	.get('/unread-count', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session || !channel?.inbox_id) return { count: 0 }
		const confirmedPhones = await listConfirmedPersonalLeadPhones(resolvedAppId, userId)
		if (!confirmedPhones.length) return { count: 0 }
		// Number of the sales' own conversations that have unread messages.
		const count = await prisma.conversations.count({
			where: {
				app_id: resolvedAppId,
				inbox_id: channel.inbox_id,
				deleted_at: null,
				unread_count: { gt: 0 },
				contacts: { is: { OR: [{ phone_number: { in: confirmedPhones } }, { whatsapp_id: { in: confirmedPhones } }] } },
			},
		})
		return { count }
	})
	.get('/needs-reply-count', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session || !channel?.inbox_id) return { count: 0 }
		const confirmedPhones = await listConfirmedPersonalLeadPhones(resolvedAppId, userId)
		if (!confirmedPhones.length) return { count: 0 }
		const conversations = await prisma.conversations.findMany({
			where: {
				app_id: resolvedAppId,
				inbox_id: channel.inbox_id,
				deleted_at: null,
				contacts: { is: { OR: [{ phone_number: { in: confirmedPhones } }, { whatsapp_id: { in: confirmedPhones } }] } },
			},
			select: { id: true },
		})
		const conversationIds = conversations.map((row) => row.id)
		if (!conversationIds.length) return { count: 0 }
		// Same "awaiting response" definition as PersonalTakeoverService.list()
		// (takeover.ts): the customer's latest incoming message is newer than the
		// sales' latest outgoing reply. Applied here to every conversation on this
		// channel, not just ones currently in takeover mode.
		const [lastInboundRows, lastAgentRows] = await Promise.all([
			prisma.messages.groupBy({
				by: ['conversation_id'],
				where: { conversation_id: { in: conversationIds }, message_type: 'incoming', deleted_at: null },
				_max: { created_at: true },
			}),
			prisma.messages.groupBy({
				by: ['conversation_id'],
				where: { conversation_id: { in: conversationIds }, message_type: 'outgoing', sender_type: 'user', deleted_at: null },
				_max: { created_at: true },
			}),
		])
		const lastInboundAt = new Map(lastInboundRows.map((row) => [row.conversation_id, row._max.created_at?.getTime() || 0]))
		const lastAgentAt = new Map(lastAgentRows.map((row) => [row.conversation_id, row._max.created_at?.getTime() || 0]))
		const count = conversationIds.filter((id) => {
			const customerAt = lastInboundAt.get(id) || 0
			const agentAt = lastAgentAt.get(id) || 0
			return customerAt > 0 && customerAt > agentAt
		}).length
		return { count }
	})
	.get('/conversations', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) {
			set.status = 401
			return { error: 'Sesi CRM tidak valid' }
		}
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session || !channel?.inbox_id) {
			return { data: [], diagnostic: { connection: session?.status || 'not_paired', storedMessages: 0 } }
		}
		const confirmedPhones = await listConfirmedPersonalLeadPhones(resolvedAppId, userId)
		// Order by the real last message time (MAX(messages.created_at)) instead of
		// conversations.last_message_at, which can be stale/skewed from WhatsApp
		// timestamps and pushed newer chats down. Two steps so we keep Prisma's
		// includes: rank the ids in SQL, then fetch details preserving that order.
		const orderedIds = confirmedPhones.length
			? await prisma.$queryRaw<Array<{ id: string }>>`
				SELECT c."id"
				FROM "conversations" c
				JOIN "contacts" ct ON ct."id" = c."contact_id"
				LEFT JOIN LATERAL (
					SELECT MAX(m."created_at") AS last_at
					FROM "messages" m
					WHERE m."conversation_id" = c."id" AND m."deleted_at" IS NULL
				) lm ON TRUE
				WHERE c."app_id" = ${resolvedAppId}::uuid
				  AND c."inbox_id" = ${channel.inbox_id}::uuid
				  AND c."deleted_at" IS NULL
				  AND (ct."phone_number" = ANY(${confirmedPhones}::text[]) OR ct."whatsapp_id" = ANY(${confirmedPhones}::text[]))
				ORDER BY COALESCE(lm.last_at, c."last_message_at") DESC
				LIMIT 100
			`
			: []
		const orderedIdList = orderedIds.map((row) => row.id)
		const fetchedRows = orderedIdList.length
			? await prisma.conversations.findMany({
					where: { id: { in: orderedIdList } },
					include: {
						contacts: { select: { name: true, phone_number: true, whatsapp_id: true, avatar_url: true, source: true } },
						messages: { where: { deleted_at: null }, orderBy: { created_at: 'desc' }, take: 1, select: { content: true, created_at: true } },
					},
				})
			: []
		const fetchedById = new Map(fetchedRows.map((row) => [row.id, row]))
		const rows = orderedIdList
			.map((id) => fetchedById.get(id))
			.filter((row): row is (typeof fetchedRows)[number] => Boolean(row))
		const visibleRows = rows
		const storedMessages = visibleRows.length ? await prisma.messages.count({ where: { conversation_id: { in: visibleRows.map((row) => row.id) }, deleted_at: null } }) : 0
		// Real takeover state per conversation drives the workflow badge/filters:
		// AI-sourced takeover -> "handover" (waiting for a human), manual takeover
		// -> "human" (sales handling), otherwise the AI is still in control.
		const takeoverByConversation = new Map<string, { aiHandling: boolean; source: string | null }>()
		if (visibleRows.length) {
			const registrations = await prisma.whatsapp_lead_registrations.findMany({
				where: {
					app_id: resolvedAppId,
					owner_user_id: userId,
					conversation_id: { in: visibleRows.map((row) => row.id) },
				},
				select: { conversation_id: true, ai_handling_enabled: true, takeover_source: true },
			})
			for (const registration of registrations) {
				if (registration.conversation_id) {
					takeoverByConversation.set(registration.conversation_id, {
						aiHandling: registration.ai_handling_enabled,
						source: registration.takeover_source,
					})
				}
			}
		}
		return {
			data: visibleRows.map((row) => {
				const takeover = takeoverByConversation.get(row.id)
				const aiHandling = takeover ? takeover.aiHandling : true
				const workflow = !aiHandling
					? takeover?.source === 'ai'
						? 'handover'
						: 'human'
					: row.status === 'pending'
						? 'handover'
						: row.assignee_id
							? 'human'
							: 'ai'
				return {
					id: row.id,
					contactId: row.contact_id || null,
					workflow,
					aiHandling,
					name: row.contacts?.name || row.contacts?.phone_number || 'Kontak WhatsApp',
					phone: row.contacts?.phone_number || row.contacts?.whatsapp_id || '',
					avatarUrl: normalizeS3PublicUrl(row.contacts?.avatar_url) || null,
					source: row.contacts?.source || null,
					preview: row.messages[0]?.content || 'Belum ada isi pesan',
					lastMessageAt: row.messages[0]?.created_at || row.last_message_at,
					unread: row.unread_count || 0,
				}
			}),
			diagnostic: { connection: session.status, storedMessages, lastSeenAt: session.last_seen_at },
		}
	})
	.get('/takeovers', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const user = await prisma.users.findFirst({
			where: { id: userId, app_id: resolvedAppId, deleted_at: null },
			select: { role: true },
		})
		const data = await PersonalTakeoverService.list({
			appId: resolvedAppId,
			userId,
			role: user?.role || 'sales',
		})
		return { data }
	})
	.get('/takeovers/count', async ({ resolvedAppId, userId, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const user = await prisma.users.findFirst({
			where: { id: userId, app_id: resolvedAppId, deleted_at: null },
			select: { role: true },
		})
		const count = await PersonalTakeoverService.count({
			appId: resolvedAppId,
			userId,
			role: user?.role || 'sales',
		})
		return { count }
	})
	// Declared after /takeovers/count so the literal path wins: a param route
	// registered first would swallow "count" as a conversation id.
	// One takeover, for the detail page. Reuses list() and picks the row rather
	// than growing a second query that could scope differently from the list the
	// user just clicked out of.
	.get('/takeovers/:conversationId', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const user = await prisma.users.findFirst({
			where: { id: userId, app_id: resolvedAppId, deleted_at: null },
			select: { role: true },
		})
		const data = await PersonalTakeoverService.list({
			appId: resolvedAppId,
			userId,
			role: user?.role || 'sales',
		})
		const item = data.find((row) => row.conversationId === params.conversationId)
		if (!item) { set.status = 404; return { error: 'Alih tugas tidak ditemukan' } }
		return { data: item }
	})
	.post('/:conversationId/takeover', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const conversation = await prisma.conversations.findFirst({
			where: { id: params.conversationId, app_id: resolvedAppId, deleted_at: null },
			select: { additional_attributes: true },
		})
		if (!conversation) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		const personal = ((conversation.additional_attributes as Record<string, unknown>)?.personal_whatsapp || {}) as Record<string, unknown>
		const ownerUserId = typeof personal.owner_user_id === 'string' && personal.owner_user_id ? personal.owner_user_id : userId
		const result = await PersonalTakeoverService.takeover({
			appId: resolvedAppId,
			ownerUserId,
			conversationId: params.conversationId,
			source: 'manual',
			byUserId: userId,
			reason: typeof body?.reason === 'string' ? body.reason : null,
			note: typeof body?.note === 'string' ? body.note : null,
		})
		if (!result) { set.status = 404; return { error: 'Lead tidak ditemukan untuk dialihkan' } }
		// Cancel any AI draft/reply already queued for this lead.
		await PersonalAiReplyService.cancelConversationTasks(resolvedAppId, ownerUserId, params.conversationId)
		return { success: true, ...result }
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Optional(t.Object({
			reason: t.Optional(t.String({ maxLength: 2000 })),
			note: t.Optional(t.String({ maxLength: 2000 })),
		})),
	})
	.post('/:conversationId/ignore', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const conversation = await prisma.conversations.findFirst({
			where: { id: params.conversationId, app_id: resolvedAppId, deleted_at: null },
			select: { additional_attributes: true },
		})
		if (!conversation) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		const personal = ((conversation.additional_attributes as Record<string, unknown>)?.personal_whatsapp || {}) as Record<string, unknown>
		const ownerUserId = typeof personal.owner_user_id === 'string' && personal.owner_user_id ? personal.owner_user_id : userId
		const existing = await prisma.whatsapp_lead_registrations.findFirst({
			where: { app_id: resolvedAppId, owner_user_id: ownerUserId, conversation_id: params.conversationId },
			select: { id: true },
		})
		if (!existing) { set.status = 404; return { error: 'Lead tidak ditemukan untuk diabaikan' } }
		const registration = await setPersonalLeadStatus({ appId: resolvedAppId, ownerUserId, registrationId: existing.id, status: 'ignored' })
		if (!registration) { set.status = 404; return { error: 'Lead tidak ditemukan' } }
		await updateConversationPersonalLeadState(resolvedAppId, ownerUserId, registration)
		// Cancel any queued AI reply; future inbound is skipped because scheduleInbound
		// ignores 'ignored'/'blocked' leads.
		await PersonalAiReplyService.cancelConversationTasks(resolvedAppId, ownerUserId, params.conversationId)
		getRealtimeIO()?.to(`app:${resolvedAppId}`).emit('personal-lead:updated', { registrationId: registration.id, status: 'ignored', conversationId: params.conversationId })
		return { success: true }
	}, { params: t.Object({ conversationId: t.String() }) })
	.post('/:conversationId/release', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const conversation = await prisma.conversations.findFirst({
			where: { id: params.conversationId, app_id: resolvedAppId, deleted_at: null },
			select: { additional_attributes: true },
		})
		if (!conversation) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		const personal = ((conversation.additional_attributes as Record<string, unknown>)?.personal_whatsapp || {}) as Record<string, unknown>
		const ownerUserId = typeof personal.owner_user_id === 'string' && personal.owner_user_id ? personal.owner_user_id : userId
		const result = await PersonalTakeoverService.release({
			appId: resolvedAppId,
			ownerUserId,
			conversationId: params.conversationId,
			byUserId: userId,
			note: typeof body?.note === 'string' ? body.note : null,
		})
		if (!result) { set.status = 404; return { error: 'Lead tidak ditemukan' } }
		return { success: true, ...result }
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Optional(t.Object({ note: t.Optional(t.String({ maxLength: 2000 })) })),
	})
	.get('/:conversationId/takeover-history', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const data = await PersonalTakeoverService.history(resolvedAppId, params.conversationId)
		return { data }
	}, { params: t.Object({ conversationId: t.String() }) })
	// F1: lead-need profile (leader intake qualification). GET is read-only for any
	// signed-in CRM user; PATCH (manual override) is limited to supervisors.
	.get('/:conversationId/lead-need', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const result = await PersonalAiReplyService.getLeadNeed(resolvedAppId, params.conversationId)
		if (!result) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		return { data: result }
	}, { params: t.Object({ conversationId: t.String() }) })
	.patch('/:conversationId/lead-need', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const guard = await requireRole(userId, ['leader', 'ceo', 'superadmin'])
		if (!guard.ok) { set.status = guard.status; return { error: guard.error } }
		const result = await PersonalAiReplyService.updateLeadNeed(resolvedAppId, params.conversationId, body)
		if (!result) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		return { data: result }
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Object({
			name: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
			company: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
			product: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
			segment: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
			useCase: t.Optional(t.Nullable(t.String({ maxLength: 400 }))),
			seats: t.Optional(t.Nullable(t.Union([t.Number(), t.String({ maxLength: 20 })]))),
			budget: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
			urgency: t.Optional(t.Nullable(t.String({ maxLength: 20 }))),
			source: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
			city: t.Optional(t.Nullable(t.String({ maxLength: 200 }))),
			notes: t.Optional(t.Nullable(t.String({ maxLength: 400 }))),
		}),
	})
	.post('/:conversationId/read', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!channel?.inbox_id) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const conversation = await prisma.conversations.findFirst({
			where: { id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null },
			include: {
				contacts: { select: { phone_number: true, whatsapp_id: true } },
				messages: { where: { deleted_at: null, message_type: 'incoming', external_id: { not: null } }, orderBy: { created_at: 'desc' }, take: 100, select: { external_id: true } },
			},
		})
		if (!conversation) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		const recipient = normalizePhoneNumber(conversation.contacts?.phone_number || conversation.contacts?.whatsapp_id || '')
		const messageIds = conversation.messages.map((message) => message.external_id).filter((id): id is string => Boolean(id))
		if (session && channel.api_key && recipient && messageIds.length) {
			void BaileysServiceClient.markMessagesRead({ channelKey: session.provider_channel_key, recipientWhatsAppId: recipient, messageIds }, {
				Authorization: `Bearer ${channel.api_key}`, 'X-Crm-Channel-Secret': channel.api_key,
			}).catch((error) => console.warn('[PersonalWhatsAppInbox] WhatsApp read receipt failed:', error))
		}
		const updated = await prisma.conversations.updateMany({
			where: { id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null },
			data: { unread_count: 0, agent_last_seen_at: new Date(), updated_at: new Date() },
		})
		if (!updated.count) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		return { success: true }
	}, { params: t.Object({ conversationId: t.String() }) })
	.post('/:conversationId/presence', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session || !channel?.inbox_id || !channel.api_key) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const conversation = await prisma.conversations.findFirst({
			where: { id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null },
			include: { contacts: { select: { phone_number: true, whatsapp_id: true } } },
		})
		const recipient = normalizePhoneNumber(conversation?.contacts?.phone_number || conversation?.contacts?.whatsapp_id || '')
		if (!recipient) { set.status = 404; return { error: 'Kontak WhatsApp tidak ditemukan' } }
		await BaileysServiceClient.sendPresence({ channelKey: session.provider_channel_key, recipientWhatsAppId: recipient, presence: body.presence }, {
			Authorization: `Bearer ${channel.api_key}`, 'X-Crm-Channel-Secret': channel.api_key,
		})
		return { success: true }
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Object({ presence: t.Union([t.Literal('composing'), t.Literal('recording'), t.Literal('paused')]) }),
	})
	.post('/start', async ({ resolvedAppId, userId, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!channel?.inbox_id) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const phoneNumber = normalizePhoneNumber(body.phoneNumber)
		if (!phoneNumber) { set.status = 400; return { error: 'Nomor WhatsApp tidak valid' } }
		const identifier = `wa:${resolvedAppId}:${phoneNumber}`
		const now = new Date()
		const conversation = await prisma.$transaction(async (tx) => {
			const existingContact = await tx.contacts.findFirst({
				where: { app_id: resolvedAppId, deleted_at: null, OR: [{ identifier }, { whatsapp_id: phoneNumber }, { phone_number: phoneNumber }] },
			})
			const contact = existingContact
				? await tx.contacts.update({
					where: { id: existingContact.id },
					data: { identifier: existingContact.identifier || identifier, name: body.name?.trim() || existingContact.name || phoneNumber, phone_number: phoneNumber, whatsapp_id: phoneNumber, channel_type: 'whatsapp', deleted_at: null, updated_at: now },
				})
				: await tx.contacts.create({
					data: { app_id: resolvedAppId, identifier, name: body.name?.trim() || phoneNumber, phone_number: phoneNumber, whatsapp_id: phoneNumber, channel_type: 'whatsapp', source: 'manual_whatsapp', first_contact_at: now, created_at: now, updated_at: now },
				})
			const existingConversation = await tx.conversations.findFirst({
				where: { app_id: resolvedAppId, inbox_id: channel.inbox_id, contact_id: contact.id, channel_type: 'whatsapp', deleted_at: null, status: { not: 'resolved' } },
				orderBy: { updated_at: 'desc' },
			})
			if (existingConversation) return existingConversation
			return tx.conversations.create({
				data: { app_id: resolvedAppId, inbox_id: channel.inbox_id, contact_id: contact.id, channel_type: 'whatsapp', status: 'open', unread_count: 0, last_message_at: now, last_activity_at: now, created_at: now, updated_at: now },
			})
		})
		const registration = await confirmPersonalLead({
			appId: resolvedAppId,
			ownerUserId: userId,
			phoneNumber,
			contactId: conversation.contact_id,
			conversationId: conversation.id,
			displayName: body.name?.trim() || null,
			source: 'manual',
		})
		if (registration) await updateConversationPersonalLeadState(resolvedAppId, userId, registration)
		return { data: { id: conversation.id, phoneNumber } }
	}, { body: t.Object({ phoneNumber: t.String({ minLength: 1 }), name: t.Optional(t.String()) }) })
	.post('/transcribe-number', async ({ resolvedAppId, userId, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const audio = body.audio
		if (audio.size > 8 * 1024 * 1024) { set.status = 413; return { error: 'Rekaman terlalu besar' } }
		try {
			const result = await transcribePhoneNumber({
				appId: resolvedAppId,
				audio: await audio.arrayBuffer(),
				mimeType: audio.type || 'audio/webm',
				language: body.language,
			})
			return { data: result }
		} catch (error) {
			set.status = 502
			return { error: error instanceof Error ? error.message : 'Transkripsi suara gagal' }
		}
	}, { body: t.Object({ audio: t.File(), language: t.Optional(t.Union([t.Literal('id'), t.Literal('en'), t.Literal('auto')])) }) })
	.get('/trash', async ({ resolvedAppId, userId, query, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const guard = await requireRole(userId, ['superadmin'])
		if (!guard.ok) { set.status = guard.status; return { error: guard.error } }
		const channels = await prisma.whatsapp_channels.findMany({
			where: { app_id: resolvedAppId, provider: 'baileys', deleted_at: null, inbox_id: { not: null } },
			select: { inbox_id: true },
		})
		const inboxIds = channels.map((channel) => channel.inbox_id).filter((id): id is string => Boolean(id))
		if (!inboxIds.length) return { data: [] }
		const limit = Math.min(100, Math.max(1, Number(query.limit || 50)))
		const rows = await prisma.messages.findMany({
			where: { app_id: resolvedAppId, inbox_id: { in: inboxIds }, deleted_at: { not: null } },
			orderBy: { deleted_at: 'desc' },
			take: limit,
			select: { id: true, conversation_id: true, content: true, content_type: true, message_type: true, sender_type: true, created_at: true, deleted_at: true, additional_attributes: true },
		})
		return { data: rows }
	}, { query: t.Object({ limit: t.Optional(t.Numeric({ minimum: 1, maximum: 100 })) }) })
	.post('/trash/:messageId/restore', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const guard = await requireRole(userId, ['superadmin'])
		if (!guard.ok) { set.status = guard.status; return { error: guard.error } }
		const message = await prisma.messages.findFirst({
			where: { id: params.messageId, app_id: resolvedAppId, deleted_at: { not: null }, conversations: { is: { channel_type: 'whatsapp' } } },
			select: { id: true, conversation_id: true, additional_attributes: true },
		})
		if (!message) { set.status = 404; return { error: 'Pesan trash tidak ditemukan' } }
		const attributes = asRecord(message.additional_attributes)
		const { trash: _trash, ...restoredAttributes } = attributes
		const now = new Date()
		await prisma.$transaction(async (tx) => {
			await tx.messages.update({
				where: { id: message.id },
				data: {
					deleted_at: null,
					additional_attributes: { ...restoredAttributes, last_restore: { restored_by: userId, restored_at: now.toISOString() } } as any,
					updated_at: now,
				},
			})
			if (message.conversation_id) {
				const latest = await tx.messages.findFirst({
					where: { conversation_id: message.conversation_id, deleted_at: null },
					orderBy: { created_at: 'desc' },
					select: { created_at: true },
				})
				await tx.conversations.update({
					where: { id: message.conversation_id },
					data: { last_message_at: latest?.created_at || now, updated_at: now },
				})
			}
		})
		if (message.conversation_id) {
			const payload = { messageId: message.id, conversationId: message.conversation_id }
			const io = getRealtimeIO()
			io?.to(`app:${resolvedAppId}`).emit('message:restored', payload)
			io?.to(`conversation:${message.conversation_id}`).emit('message:restored', payload)
		}
		return { success: true }
	}, { params: t.Object({ messageId: t.String() }) })
	.post('/:conversationId/messages', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { session, channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!session || !channel?.inbox_id || !channel.api_key) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		if (session.status !== 'connected') { set.status = 409; return { error: 'WhatsApp sedang tidak terhubung' } }
		const content = String(body.content || '').trim()
		const media = body.media
		if (!content && !media?.url) { set.status = 400; return { error: 'Pesan tidak boleh kosong' } }
		const conversation = await prisma.conversations.findFirst({
			where: { id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null },
			include: { contacts: { select: { id: true, phone_number: true, whatsapp_id: true } } },
		})
		const recipient = normalizePhoneNumber(conversation?.contacts?.phone_number || conversation?.contacts?.whatsapp_id || '')
		if (!conversation || !recipient) { set.status = 404; return { error: 'Kontak WhatsApp tidak ditemukan' } }
		const quotedMessage = body.replyToMessageId
			? await prisma.messages.findFirst({
					where: { id: body.replyToMessageId, conversation_id: conversation.id, app_id: resolvedAppId, deleted_at: null, content_type: { not: 'revoked' } },
					select: { id: true, external_id: true, content: true, content_type: true, message_type: true, sender_type: true, created_at: true },
				})
			: null
		if (body.replyToMessageId && (!quotedMessage || !quotedMessage.external_id)) {
			set.status = 409
			return { error: 'Pesan asli sudah tidak tersedia untuk dibalas' }
		}
		await PersonalAiReplyService.cancelConversationTasks(resolvedAppId, userId, conversation.id)
		try {
			const outboundType = media?.kind === 'voice' ? 'audio' : media?.kind === 'gif' ? 'video' : media?.kind || 'text'
			const sent = await BaileysServiceClient.sendMessage({
				channelKey: session.provider_channel_key,
				recipientWhatsAppId: recipient,
				recipientAddressingMode: 'pn',
				type: outboundType,
				text: { body: content },
				...(media ? {
					media: { url: media.url, mimeType: media.mimeType, fileName: media.fileName, caption: content },
					ptt: media.kind === 'voice',
					gifPlayback: media.kind === 'gif',
					isAnimated: media.kind === 'sticker' && media.animated === true,
				} : {}),
				...(quotedMessage ? {
					quote: {
						externalId: quotedMessage.external_id,
						fromMe: quotedMessage.message_type === 'outgoing' || quotedMessage.sender_type === 'user',
						content: quotedMessage.content,
						contentType: quotedMessage.content_type,
						timestamp: quotedMessage.created_at ? Math.floor(quotedMessage.created_at.getTime() / 1000) : undefined,
					},
				} : {}),
			}, {
				Authorization: `Bearer ${channel.api_key}`,
				'X-Crm-Channel-Secret': channel.api_key,
			})
			const now = new Date()
			const created = await prisma.$transaction(async (tx) => {
				const message = await tx.messages.create({
					data: {
						conversation_id: conversation.id, app_id: resolvedAppId, inbox_id: channel.inbox_id,
						message_type: 'outgoing', sender_type: 'user', sender_id: userId,
						content, content_type: media?.kind || 'text', status: 'sent', external_id: sent.externalId || null,
						content_attributes: {
							...(media ? { media: { url: media.url, mime_type: media.mimeType, file_name: media.fileName, purpose: media.kind } } : {}),
							...(quotedMessage ? { quote: { message_id: quotedMessage.id, external_id: quotedMessage.external_id, content: quotedMessage.content, content_type: quotedMessage.content_type, sender_type: quotedMessage.sender_type } } : {}),
						},
						reply_to_message_id: quotedMessage?.id || null,
						created_at: now, updated_at: now,
					},
				})
				if (media?.url) {
					await tx.media_files.updateMany({
						where: { app_id: resolvedAppId, message_id: null, OR: [{ media_url: media.url }, { local_url: media.url }] },
						data: { message_id: message.id, updated_at: now },
					})
				}
				await tx.conversations.update({ where: { id: conversation.id }, data: { last_message_at: now, last_activity_at: now, updated_at: now } })
				await tx.contacts.update({ where: { id: conversation.contacts!.id }, data: { last_message_at: now, last_activity_at: now, updated_at: now } })
				return message
			})
			const realtimePayload = { message: created, conversation: { id: conversation.id, app_id: resolvedAppId, channel_type: 'whatsapp' } }
			const io = getRealtimeIO()
			io?.to(`app:${resolvedAppId}`).emit('message:created', realtimePayload)
			io?.to(`conversation:${conversation.id}`).emit('message:created', realtimePayload)
			// Replying starts the task (marks it "in progress"), it does NOT finish
			// it. The sales decides when the conversation is actually done.
			void TaskService.markInProgressOnConversationReply(
				resolvedAppId,
				conversation.id,
				userId,
			).catch((error) => {
				console.error(
					'[PersonalInbox] Failed to mark task in progress on reply (fail-open):',
					error,
				)
			})
			return { data: created }
		} catch (error) {
			set.status = 503
			return { error: error instanceof Error ? error.message : 'Pesan gagal dikirim' }
		}
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Object({
			content: t.Optional(t.String({ maxLength: 4096 })),
			replyToMessageId: t.Optional(t.String()),
			media: t.Optional(t.Object({
				url: t.String({ minLength: 1 }),
				kind: t.Union([t.Literal('image'), t.Literal('video'), t.Literal('audio'), t.Literal('document'), t.Literal('voice'), t.Literal('gif'), t.Literal('sticker')]),
				mimeType: t.String({ minLength: 1 }),
				fileName: t.String({ minLength: 1 }),
				animated: t.Optional(t.Boolean()),
			})),
		}),
	})
	.delete('/:conversationId/messages/bulk-delete', async ({ resolvedAppId, userId, params, body, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!channel?.inbox_id) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const ids = [...new Set(body.messageIds)].slice(0, 100)
		const messages = await prisma.messages.findMany({
			where: { id: { in: ids }, conversation_id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null },
			select: { id: true, additional_attributes: true },
		})
		if (!messages.length) { set.status = 404; return { error: 'Pesan tidak ditemukan' } }
		const now = new Date()
		await prisma.$transaction(async (tx) => {
			for (const message of messages) {
				await tx.messages.update({
					where: { id: message.id },
					data: {
						deleted_at: now,
						additional_attributes: { ...asRecord(message.additional_attributes), trash: { deleted_by: userId, deleted_at: now.toISOString(), scope: 'crm_only' } } as any,
						updated_at: now,
					},
				})
			}
			const latest = await tx.messages.findFirst({
				where: { conversation_id: params.conversationId, deleted_at: null }, orderBy: { created_at: 'desc' }, select: { created_at: true },
			})
			await tx.conversations.update({ where: { id: params.conversationId }, data: { last_message_at: latest?.created_at || now, updated_at: now } })
		})
		const payload = { messageIds: messages.map((message) => message.id), conversationId: params.conversationId }
		const io = getRealtimeIO()
		io?.to(`app:${resolvedAppId}`).emit('message:deleted', payload)
		io?.to(`conversation:${params.conversationId}`).emit('message:deleted', payload)
		return { success: true, deleted: messages.length }
	}, {
		params: t.Object({ conversationId: t.String() }),
		body: t.Object({ messageIds: t.Array(t.String(), { minItems: 1, maxItems: 100 }) }),
	})
	.delete('/:conversationId/messages/:messageId', async ({ resolvedAppId, userId, params, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!channel?.inbox_id) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const message = await prisma.messages.findFirst({
			where: { id: params.messageId, conversation_id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null },
			select: { id: true, conversation_id: true, additional_attributes: true },
		})
		if (!message) { set.status = 404; return { error: 'Pesan tidak ditemukan' } }
		const now = new Date()
		await prisma.$transaction(async (tx) => {
			await tx.messages.update({
				where: { id: message.id },
				data: {
					deleted_at: now,
					additional_attributes: {
						...asRecord(message.additional_attributes),
						trash: { deleted_by: userId, deleted_at: now.toISOString(), scope: 'crm_only' },
					} as any,
					updated_at: now,
				},
			})
			const latest = await tx.messages.findFirst({
				where: { conversation_id: params.conversationId, deleted_at: null },
				orderBy: { created_at: 'desc' },
				select: { created_at: true },
			})
			await tx.conversations.update({
				where: { id: params.conversationId },
				data: { last_message_at: latest?.created_at || now, updated_at: now },
			})
		})
		const payload = { messageId: message.id, conversationId: params.conversationId }
		const io = getRealtimeIO()
		io?.to(`app:${resolvedAppId}`).emit('message:deleted', payload)
		io?.to(`conversation:${params.conversationId}`).emit('message:deleted', payload)
		return { success: true }
	}, { params: t.Object({ conversationId: t.String(), messageId: t.String() }) })
	.get('/:conversationId/messages', async ({ resolvedAppId, userId, params, query, set }) => {
		if (!resolvedAppId || !userId) { set.status = 401; return { error: 'Sesi CRM tidak valid' } }
		const { channel } = await resolveOwnedChannel(resolvedAppId, userId)
		if (!channel?.inbox_id) { set.status = 404; return { error: 'WhatsApp belum terhubung' } }
		const conversation = await prisma.conversations.findFirst({ where: { id: params.conversationId, app_id: resolvedAppId, inbox_id: channel.inbox_id, deleted_at: null }, select: { id: true } })
		if (!conversation) { set.status = 404; return { error: 'Percakapan tidak ditemukan' } }
		const before = query.before ? new Date(query.before) : null
		const rows = await prisma.messages.findMany({
			where: { conversation_id: conversation.id, deleted_at: null, ...(before && !Number.isNaN(before.valueOf()) ? { created_at: { lt: before } } : {}) },
			orderBy: { created_at: 'desc' }, take: 50,
			select: { id: true, external_id: true, content: true, content_type: true, content_attributes: true, message_type: true, sender_type: true, status: true, reply_to_message_id: true, created_at: true },
		})
		const nextCursor = rows.length === 50 ? rows[rows.length - 1]?.created_at : null
		const data = rows.reverse().map((message) => {
			const normalized = normalizeMessageMediaAttributes(message.content_attributes)
			if (normalized.changed) {
				void prisma.messages.update({
					where: { id: message.id },
					data: { content_attributes: normalized.value as any, updated_at: new Date() },
				}).catch(() => undefined)
			}
			return { ...message, content_attributes: normalized.value }
		})
		return { data, nextCursor }
	}, { params: t.Object({ conversationId: t.String() }), query: t.Object({ before: t.Optional(t.String()) }) })
