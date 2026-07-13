import prisma from '../../lib/prisma'

type MessageEventName = 'message.received' | 'message.sent'

type FormatMessageWebhookPayloadArgs = {
	deliveryId: string
	eventName: MessageEventName
	appId: string
	inboxId: string | null
	payload: Record<string, unknown>
	dispatchedAt: Date
}

const MESSAGE_EVENT_NAMES = new Set<MessageEventName>([
	'message.received',
	'message.sent',
])

function isUuid(value: string | null | undefined): value is string {
	return (
		typeof value === 'string' &&
		/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
			value,
		)
	)
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asRecordOrNull(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	if (value === null || value === undefined) return null
	const normalized = String(value).trim()
	return normalized.length > 0 ? normalized : null
}

function asInteger(value: unknown, fallback = 0): number {
	const parsed = Number(value)
	if (!Number.isFinite(parsed)) return fallback
	return Math.trunc(parsed)
}

function toIso(value: unknown): string | null {
	if (value instanceof Date) return value.toISOString()
	if (typeof value === 'string' && value.trim().length > 0) return value
	return null
}

function normalizeSentByType(value: unknown): string | null {
	const senderType = asString(value)?.toLowerCase()
	if (!senderType) return null
	if (senderType === 'contact') return 'user'
	if (senderType === 'user' || senderType === 'agent') return 'agent'
	if (senderType === 'bot') return 'bot'
	if (senderType === 'system') return 'system'
	return senderType
}

function extractMessageId(payload: Record<string, unknown>): string | null {
	const payloadMessage = asRecord(payload.message)
	const candidates = [payloadMessage.id, payload.message_id, payload.id]
	for (const candidate of candidates) {
		const normalized = asString(candidate)
		if (normalized) return normalized
	}
	return null
}

function isMessageEventName(value: string): value is MessageEventName {
	return MESSAGE_EVENT_NAMES.has(value as MessageEventName)
}

function extractFallbackLabels(
	value: unknown,
): Array<{ id: string; color: string | null; label_name: string }> {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => {
			const label = asRecord(item)
			const id = asString(label.id)
			const labelName = asString(label.label_name || label.title || label.name)
			if (!id || !labelName) return null
			return {
				id,
				color: asString(label.color),
				label_name: labelName,
			}
		})
		.filter(
			(
				item,
			): item is { id: string; color: string | null; label_name: string } =>
				Boolean(item),
		)
}

export function buildMessageWebhookPayloadFallback(
	args: FormatMessageWebhookPayloadArgs,
) {
	const payload = asRecord(args.payload)
	const payloadMessage = asRecord(payload.message)
	const payloadConversation = asRecord(payload.conversation)
	const payloadContact = asRecord(payload.contact)
	const contentAttributes = asRecord(payloadMessage.content_attributes)
	const media = asRecord(contentAttributes.media)
	const interactive =
		asRecordOrNull(contentAttributes.interactive) ||
		asRecordOrNull(payloadMessage.interactive) ||
		null
	const messageId = extractMessageId(payload)
	const labels = extractFallbackLabels(payloadConversation.labels)
	const mediaUrl =
		asString(media.url) ||
		asString(media.original_url) ||
		asString(contentAttributes.media_url)
	const currentMessageText = asString(payloadMessage.content)
	const firstMessageText =
		asString(payloadConversation.first_message) || currentMessageText
	const lastMessageText =
		asString(payloadConversation.message_last_content) || currentMessageText
	const lastMessageCreatedAt =
		toIso(payloadConversation.message_last_created_at) ||
		toIso(payloadMessage.created_at)
	const senderType = asString(payloadMessage.sender_type)
	const conversationStatus = asString(payloadConversation.status) || 'open'

	return {
		id: args.deliveryId,
		object: 'message',
		timestamp: Math.floor(args.dispatchedAt.getTime() / 1000),
		event_name: args.eventName,
		data: {
			id: messageId,
			message: currentMessageText || '',
			media_url: mediaUrl || null,
			media_type: asString(payloadMessage.content_type) || 'text',
			status: asString(payloadMessage.status) || 'sent',
			sent_by: asString(payloadMessage.sender_id),
			sent_by_name:
				asString(payloadMessage.sender_name) || asString(payloadContact.name),
			sent_by_type: normalizeSentByType(senderType),
			created_at: toIso(payloadMessage.created_at),
			business_id: args.appId,
			interactive,
			platform_mid: asString(payloadMessage.external_id),
			conversation: {
				cd: {
					id: asString(payloadConversation.id),
					rating: null,
					created_at: toIso(payloadConversation.created_at),
					visitor_ip: null,
					ai_duration: null,
					resolved_at: null,
					resolved_by: null,
					ai_handoff_at: null,
					edit_messages: null,
					first_message: firstMessageText,
					agent_duration: null,
					conversation_id: asString(payloadConversation.id),
					last_session_id: null,
					handled_by_ai_at: null,
					handled_by_ai_id: null,
					resolved_by_type: null,
					resolved_label_id: null,
					assign_to_agent_at: null,
					session_started_at: null,
					last_session_number: 1,
					last_session_status: conversationStatus,
					first_assign_to_agent_at: null,
					first_assign_to_agent_id: null,
					message_limit_per_session: true,
				},
				id: asString(payloadConversation.id),
				note: null,
				labels,
				inbox_id: asString(payloadConversation.inbox_id) || args.inboxId,
				contact_id:
					asString(payloadConversation.contact_id) || asString(payloadContact.id),
				handled_by: asString(payloadConversation.handled_by),
				inbox_name: asString(payloadConversation.inbox_name),
				inbox_type: asString(payloadConversation.inbox_type),
				is_blocked: conversationStatus === 'blocked',
				message_id: messageId,
				ai_agent_id: asString(payloadConversation.ai_agent_id),
				assigned_by: null,
				business_id: args.appId,
				inbox_phone: asString(payloadConversation.inbox_phone),
				platform_id: asString(payloadConversation.platform_id),
				display_name: asString(payloadConversation.display_name) || asString(payloadContact.name),
				phone_number:
					asString(payloadConversation.phone_number) ||
					asString(payloadContact.phone_number),
				stage_status: conversationStatus,
				collaborators: null,
				inbox_waba_id: asString(payloadConversation.inbox_waba_id),
				wa_open_convo: toIso(payloadConversation.wa_open_convo),
				wa_close_convo: toIso(payloadConversation.wa_close_convo),
				additional_data: asRecord(payloadConversation.additional_data),
				handled_by_name: asString(payloadConversation.handled_by_name),
				assigned_by_name: null,
				pipeline_status_id: asString(payloadConversation.pipeline_status_id),
				unreplied_msg_count: asInteger(payloadConversation.unreplied_msg_count, 0),
				message_last_content: lastMessageText,
				whatsapp_call_status: null,
				message_last_created_at: lastMessageCreatedAt,
			},
		},
	}
}

export async function formatMessageWebhookPayload(
	args: FormatMessageWebhookPayloadArgs,
) {
	const payload = asRecord(args.payload)
	const payloadMessage = asRecord(payload.message)
	const payloadConversation = asRecord(payload.conversation)
	const payloadContact = asRecord(payload.contact)

	const messageId = extractMessageId(payload)
	const messageRecord =
		messageId && isUuid(messageId)
			? await prisma.messages.findUnique({
					where: { id: messageId },
					select: {
						id: true,
						conversation_id: true,
						content: true,
						content_type: true,
						sender_id: true,
						sender_type: true,
						status: true,
						external_id: true,
						content_attributes: true,
						created_at: true,
						app_id: true,
						conversations: {
							select: {
								id: true,
								app_id: true,
								inbox_id: true,
								contact_id: true,
								assignee_id: true,
								status: true,
								stage_id: true,
								unread_count: true,
								created_at: true,
								resolved_at: true,
								source_id: true,
								messaging_window_opened_at: true,
								messaging_window_expires_at: true,
								additional_attributes: true,
								contacts: {
									select: {
										id: true,
										name: true,
										phone_number: true,
										identifier: true,
									},
								},
								inboxes: {
									select: {
										id: true,
										name: true,
										channel_type: true,
										chatbot_id: true,
									},
								},
								conversation_labels: {
									select: {
										labels: {
											select: {
												id: true,
												title: true,
												color: true,
											},
										},
									},
								},
							},
						},
					},
				})
			: null

	const conversation = messageRecord?.conversations || null
	const conversationId =
		asString(conversation?.id) ||
		asString(messageRecord?.conversation_id) ||
		asString(payloadConversation.id)
	const effectiveInboxId =
		asString(conversation?.inbox_id) ||
		asString(payloadConversation.inbox_id) ||
		args.inboxId
	const effectiveAppId = asString(messageRecord?.app_id) || args.appId
	const senderId = asString(messageRecord?.sender_id) || asString(payloadMessage.sender_id)
	const assigneeId =
		asString(conversation?.assignee_id) || asString(payloadConversation.handled_by)
	const contentAttributes = asRecord(
		messageRecord?.content_attributes || payloadMessage.content_attributes,
	)
	const media = asRecord(contentAttributes.media)
	const channelType = asString(conversation?.inboxes?.channel_type)?.toLowerCase()

	const userIds = [...new Set([senderId, assigneeId].filter((item) => isUuid(item)))]
	const isConversationIdUuid = isUuid(conversationId)
	const isAppIdUuid = isUuid(effectiveAppId)
	const isInboxIdUuid = isUuid(effectiveInboxId)

	const [organization, firstMessage, latestMessage, ratingRow, waChannel, users] =
		await Promise.all([
			isAppIdUuid
				? prisma.organization.findFirst({
						where: { appId: effectiveAppId },
						select: { id: true },
					})
				: Promise.resolve(null),
			isConversationIdUuid
				? prisma.messages.findFirst({
						where: {
							conversation_id: conversationId,
							deleted_at: null,
							OR: [{ is_deleted: false }, { is_deleted: null }],
						},
						orderBy: { created_at: 'asc' },
						select: { content: true, created_at: true },
					})
				: Promise.resolve(null),
			isConversationIdUuid
				? prisma.messages.findFirst({
						where: {
							conversation_id: conversationId,
							deleted_at: null,
							OR: [{ is_deleted: false }, { is_deleted: null }],
						},
						orderBy: { created_at: 'desc' },
						select: { content: true, created_at: true },
					})
				: Promise.resolve(null),
			isConversationIdUuid
				? prisma.conversation_ratings.findUnique({
						where: { conversation_id: conversationId },
						select: { rating: true },
					})
				: Promise.resolve(null),
			channelType === 'whatsapp' && isInboxIdUuid && isAppIdUuid
				? prisma.whatsapp_channels.findFirst({
						where: {
							inbox_id: effectiveInboxId,
							app_id: effectiveAppId,
							deleted_at: null,
						},
						select: {
							waba_id: true,
							phone_number: true,
							display_phone_number: true,
						},
					})
				: Promise.resolve(null),
			userIds.length > 0
				? prisma.users.findMany({
						where: { id: { in: userIds } },
						select: { id: true, name: true },
					})
				: Promise.resolve([]),
		])

	const userNameById = new Map(
		users.map((user) => [user.id, asString(user.name) || user.id]),
	)
	const contact = conversation?.contacts || null
	const labels =
		conversation?.conversation_labels?.map((item) => ({
			id: item.labels.id,
			color: asString(item.labels.color),
			label_name: asString(item.labels.title) || item.labels.id,
		})) || extractFallbackLabels(payloadConversation.labels)

	const mediaUrl =
		asString(media.url) ||
		asString(media.original_url) ||
		asString(contentAttributes.media_url)
	const fallbackInteractive = asRecordOrNull(payloadMessage.interactive)
	const interactive =
		asRecordOrNull(contentAttributes.interactive) || fallbackInteractive || null
	const senderType = asString(messageRecord?.sender_type || payloadMessage.sender_type)
	let sentByName: string | null = null

	if (senderType?.toLowerCase() === 'contact') {
		sentByName = asString(contact?.name) || asString(payloadContact.name)
	} else if (
		(senderType?.toLowerCase() === 'user' || senderType?.toLowerCase() === 'agent') &&
		senderId
	) {
		sentByName = userNameById.get(senderId) || null
	} else if (senderType?.toLowerCase() === 'bot') {
		sentByName = asString(contentAttributes.ai_agent_name)
	}

	const businessId = asString(organization?.id) || args.appId
	const conversationStatus = asString(conversation?.status) || 'open'
	const additionalData = asRecord(conversation?.additional_attributes)
	const currentMessageText =
		asString(messageRecord?.content) || asString(payloadMessage.content)
	const firstMessageText = asString(firstMessage?.content) || currentMessageText
	const lastMessageText = asString(latestMessage?.content) || currentMessageText
	const lastMessageCreatedAt =
		toIso(latestMessage?.created_at) ||
		toIso(messageRecord?.created_at) ||
		toIso(payloadMessage.created_at)

	return {
		id: args.deliveryId,
		object: 'message',
		timestamp: Math.floor(args.dispatchedAt.getTime() / 1000),
		event_name: args.eventName,
		data: {
			id: asString(messageRecord?.id) || messageId,
			message: currentMessageText || '',
			media_url: mediaUrl || null,
			media_type:
				asString(messageRecord?.content_type) ||
				asString(payloadMessage.content_type) ||
				'text',
			status: asString(messageRecord?.status) || asString(payloadMessage.status) || 'sent',
			sent_by: senderId || null,
			sent_by_name: sentByName,
			sent_by_type: normalizeSentByType(senderType),
			created_at: toIso(messageRecord?.created_at || payloadMessage.created_at),
			business_id: businessId,
			interactive,
			platform_mid:
				asString(messageRecord?.external_id) ||
				asString(payloadMessage.external_id) ||
				null,
			conversation: {
				cd: {
					id: conversationId,
					rating: ratingRow?.rating ?? null,
					created_at: toIso(conversation?.created_at),
					visitor_ip: null,
					ai_duration: null,
					resolved_at: toIso(conversation?.resolved_at),
					resolved_by: null,
					ai_handoff_at: null,
					edit_messages: null,
					first_message: firstMessageText,
					agent_duration: null,
					conversation_id: conversationId,
					last_session_id: null,
					handled_by_ai_at: null,
					handled_by_ai_id: null,
					resolved_by_type: null,
					resolved_label_id: null,
					assign_to_agent_at: null,
					session_started_at: toIso(conversation?.created_at),
					last_session_number: 1,
					last_session_status: conversationStatus,
					first_assign_to_agent_at: null,
					first_assign_to_agent_id: null,
					message_limit_per_session: true,
				},
				id: conversationId,
				note: null,
				labels,
				inbox_id: effectiveInboxId,
				contact_id:
					asString(conversation?.contact_id) ||
					asString(contact?.id) ||
					asString(payloadContact.id),
				handled_by: assigneeId || null,
				inbox_name: asString(conversation?.inboxes?.name) || null,
				inbox_type: asString(conversation?.inboxes?.channel_type) || null,
				is_blocked: conversationStatus === 'blocked',
				message_id: asString(messageRecord?.id) || messageId,
				ai_agent_id: asString(conversation?.inboxes?.chatbot_id),
				assigned_by: null,
				business_id: businessId,
				inbox_phone:
					asString(waChannel?.phone_number) ||
					asString(waChannel?.display_phone_number) ||
					null,
				platform_id: asString(conversation?.source_id),
				display_name: asString(contact?.name) || asString(payloadContact.name),
				phone_number:
					asString(contact?.phone_number) ||
					asString(payloadContact.phone_number) ||
					null,
				stage_status: conversationStatus,
				collaborators: null,
				inbox_waba_id: asString(waChannel?.waba_id),
				wa_open_convo:
					channelType === 'whatsapp'
						? toIso(conversation?.messaging_window_opened_at)
						: null,
				wa_close_convo:
					channelType === 'whatsapp'
						? toIso(conversation?.messaging_window_expires_at)
						: null,
				additional_data: additionalData,
				handled_by_name: assigneeId ? (userNameById.get(assigneeId) ?? null) : null,
				assigned_by_name: null,
				pipeline_status_id: asString(conversation?.stage_id),
				unreplied_msg_count: Number(conversation?.unread_count || 0),
				message_last_content: lastMessageText,
				whatsapp_call_status: null,
				message_last_created_at: lastMessageCreatedAt,
			},
		},
	}
}

export function isMessageWebhookEvent(eventName: string): eventName is MessageEventName {
	return isMessageEventName(eventName)
}
