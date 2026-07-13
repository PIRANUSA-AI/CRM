import prisma from '../../lib/prisma'
import { outboundMessageQueue } from '../../lib/queue'
import { isUuid } from '../../lib/utils'

interface SendMessageData {
	conversationId: string
	senderId?: string | null
	senderType: 'agent' | 'contact' | 'system' | 'bot'
	content: string
	contentType?: string
	mediaIds?: string[]
	contentAttributes?: Record<string, unknown>
	uniqueTempId?: string
	replyToMessageId?: string
	createdAt?: Date
}

export abstract class MessageService {
	static async sendMessage(data: SendMessageData) {
		const {
			conversationId,
			senderId,
			senderType,
			content,
			contentType = 'text',
			mediaIds = [],
			contentAttributes = {},
			uniqueTempId,
			replyToMessageId,
			createdAt,
		} = data
		if (!isUuid(conversationId)) {
			throw new Error('Invalid conversation ID')
		}
		if (!content?.trim()) {
			throw new Error('Message content is required')
		}

		const normalizedSenderId =
			senderId && isUuid(senderId) ? senderId : undefined
		const normalizedReplyToMessageId =
			replyToMessageId && isUuid(replyToMessageId)
				? replyToMessageId
				: undefined
		const normalizedContentAttributes = {
			type: contentType || 'text',
			...(contentAttributes || {}),
		}
		const messageType =
			senderType === 'contact'
				? 'incoming'
				: senderType === 'system'
					? 'system'
					: 'outgoing'
		const initialStatus = senderType === 'system' ? 'sent' : 'pending'

		if (uniqueTempId) {
			const existingMessage = await prisma.messages.findFirst({
				where: {
					conversation_id: conversationId,
					unique_temp_id: uniqueTempId,
				},
				orderBy: { created_at: 'desc' },
			})

			if (existingMessage) {
				return existingMessage
			}
		}

			// Create message
			const message = await prisma.messages.create({
				data: {
					conversation_id: conversationId,
					message_type: messageType,
					sender_type: senderType,
					...(normalizedSenderId ? { sender_id: normalizedSenderId } : {}),
					content,
					content_type: contentType,
					content_attributes: normalizedContentAttributes as any,
				...(uniqueTempId ? { unique_temp_id: uniqueTempId } : {}),
					...(normalizedReplyToMessageId
						? { reply_to_message_id: normalizedReplyToMessageId }
						: {}),
					status: initialStatus,
					...(createdAt ? { created_at: createdAt, updated_at: createdAt } : {}),
				},
			})

		// Link media files if provided
		if (mediaIds.length > 0) {
			await prisma.media_files.updateMany({
				where: { id: { in: mediaIds } },
				data: { message_id: message.id },
			})
		}

		// Update conversation
		await prisma.conversations.update({
			where: { id: conversationId },
			data: {
				last_message_at: new Date(),
				updated_at: new Date(),
				// Increment unread if sender is contact
				...(senderType === 'contact' ? { unread_count: { increment: 1 } } : {}),
			},
		})

			// Enqueue to outbound queue only for agent/bot messages.
			// System messages are internal timeline events and must stay in-app.
			if (senderType === 'agent' || senderType === 'bot') {
				await outboundMessageQueue.add('outbound-messages', {
					messageId: message.id,
				})
			}

		return message
	}

	static async getMessageById(id: string) {
		return prisma.messages.findUnique({
			where: { id },
		})
	}

	static async updateMessageStatus(
		id: string,
		status: string,
		externalId?: string,
	) {
		const message = await prisma.messages.update({
			where: { id },
			data: {
				status,
				external_id: externalId,
				updated_at: new Date(),
			},
		})

		// Log status history
		await prisma.message_status_history.create({
			data: {
				message_id: id,
				status,
				timestamp: new Date(),
			},
		})

		return message
	}

	static async deleteMessage(id: string) {
		return prisma.messages.update({
			where: { id },
			data: {
				is_deleted: true,
				deleted_at: new Date(),
			},
		})
	}

	static async getRecentMessages(conversationId: string, limit = 20) {
		return prisma.messages.findMany({
			where: {
				conversation_id: conversationId,
				is_deleted: false,
			},
			orderBy: { created_at: 'desc' },
			take: limit,
		})
	}
}
