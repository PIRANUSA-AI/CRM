import prisma from '../../lib/prisma'
import { getAllowedChannelTypesForUser } from '../../lib/agent-channel-access'
import { isUuid, resolveAppId } from '../../lib/utils'

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asUuidOrNull(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	if (!normalized) return null
	return isUuid(normalized) ? normalized : null
}

export abstract class InboxService {
	static async getInboxes(accountId: string, viewerUserId?: string | null) {
		const targetAppId = await resolveAppId(accountId)
		const allowedChannelTypes = await getAllowedChannelTypesForUser({
			appId: targetAppId,
			userId: viewerUserId,
		})

		return prisma.inboxes.findMany({
			where: {
				app_id: targetAppId || undefined,
				deleted_at: null,
				...(allowedChannelTypes?.length
					? { channel_type: { in: allowedChannelTypes } }
					: {}),
			},
			orderBy: { created_at: 'desc' },
		})
	}

	static async getInboxById(id: string, accountId: string) {
		const targetAppId = await resolveAppId(accountId)

		return prisma.inboxes.findFirst({
			where: { id, app_id: targetAppId || undefined, deleted_at: null },
		})
	}

	static async createInbox(accountId: string, data: any) {
		const targetAppId = await resolveAppId(accountId)

		return prisma.inboxes.create({
			data: {
				...data,
				app_id: targetAppId,
			},
		})
	}

	static async updateInbox(id: string, accountId: string, data: any) {
		const targetAppId = await resolveAppId(accountId)
		const payload: Record<string, unknown> = {
			...data,
			updated_at: new Date(),
		}

		const channelConfig = asRecord(data?.channel_config)
		const chatbotFromConfig = asUuidOrNull(
			channelConfig.default_chatbot_id || channelConfig.defaultChatbotId,
		)
		const chatbotFromPayload = asUuidOrNull(data?.chatbot_id)
		const hasChatbotIdInPayload = Object.prototype.hasOwnProperty.call(
			data || {},
			'chatbot_id',
		)
		const hasChatbotIdInChannelConfig =
			Object.prototype.hasOwnProperty.call(channelConfig, 'default_chatbot_id') ||
			Object.prototype.hasOwnProperty.call(channelConfig, 'defaultChatbotId')

		if (hasChatbotIdInPayload || hasChatbotIdInChannelConfig) {
			payload.chatbot_id = chatbotFromPayload ?? chatbotFromConfig ?? null
		}

		return prisma.inboxes.update({
			where: { id, app_id: targetAppId || undefined },
			data: payload,
		})
	}

	static async deleteInbox(id: string, accountId: string) {
		const targetAppId = await resolveAppId(accountId)

		return prisma.inboxes.update({
			where: { id, app_id: targetAppId || undefined },
			data: {
				deleted_at: new Date(),
			},
		})
	}
}
