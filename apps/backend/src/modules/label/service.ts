import prisma from '../../lib/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'

export abstract class LabelService {
	static async getLabels(appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.labels.findMany({
			where: { app_id: targetAppId || undefined, is_visible: true },
			orderBy: { created_at: 'desc' },
		})
	}

	static async getLabelById(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.labels.findFirst({
			where: { id, app_id: targetAppId || undefined },
		})
	}

	static async createLabel(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		return prisma.labels.create({
			data: {
				...data,
				app_id: targetAppId || appId,
				is_visible: true,
			},
		})
	}

	static async updateLabel(id: string, appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		return prisma.labels.update({
			where: { id, app_id: targetAppId || undefined },
			data: {
				...data,
				updated_at: new Date(),
			},
		})
	}

	static async deleteLabel(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.labels.update({
			where: { id, app_id: targetAppId || undefined },
			data: { is_visible: false },
		})
	}

	// Conversation Labels
	static async getConversationLabels(conversationId: string) {
		if (!isUuid(conversationId)) return []
		const assignments = await prisma.conversation_labels.findMany({
			where: { conversation_id: conversationId },
			include: { labels: true },
		})
		return assignments.map((a) => a.labels)
	}

	static async addLabelToConversation(conversationId: string, labelId: string) {
		if (!isUuid(conversationId) || !isUuid(labelId)) return null
		const result = await prisma.conversation_labels.create({
			data: {
				conversation_id: conversationId,
				label_id: labelId,
			},
		})

		// Emit socket event
		const conv = await prisma.conversations.findUnique({
			where: { id: conversationId },
			select: { app_id: true, inbox_id: true },
		})
		const { app } = await import('../../index')
		const io = (app as any).io as any
		if (io && conv) {
			io.to(`app:${conv.app_id}`).emit('conversation:label_added', {
				conversationId,
				labelId,
			})
			io.to(`conversation:${conversationId}`).emit('conversation:label_added', {
				conversationId,
				labelId,
			})
		}
		if (conv?.app_id) {
			const labels = await LabelService.getConversationLabels(conversationId)
			void BusinessWebhookDispatchService.dispatch({
				event: 'conversation.labels_updated',
				appId: conv.app_id,
				inboxId: conv.inbox_id,
				payload: {
					conversation_id: conversationId,
					action: 'added',
					label_id: labelId,
					labels,
				},
			})
		}
		return result
	}

	static async removeLabelFromConversation(
		conversationId: string,
		labelId: string,
	) {
		if (!isUuid(conversationId) || !isUuid(labelId)) return null
		const result = await prisma.conversation_labels.delete({
			where: {
				conversation_id_label_id: {
					conversation_id: conversationId,
					label_id: labelId,
				},
			},
		})

		// Emit socket event
		const conv = await prisma.conversations.findUnique({
			where: { id: conversationId },
			select: { app_id: true, inbox_id: true },
		})
		const { app } = await import('../../index')
		const io = (app as any).io as any
		if (io && conv) {
			io.to(`app:${conv.app_id}`).emit('conversation:label_removed', {
				conversationId,
				labelId,
			})
			io.to(`conversation:${conversationId}`).emit(
				'conversation:label_removed',
				{ conversationId, labelId },
			)
		}
		if (conv?.app_id) {
			const labels = await LabelService.getConversationLabels(conversationId)
			void BusinessWebhookDispatchService.dispatch({
				event: 'conversation.labels_updated',
				appId: conv.app_id,
				inboxId: conv.inbox_id,
				payload: {
					conversation_id: conversationId,
					action: 'removed',
					label_id: labelId,
					labels,
				},
			})
		}
		return result
	}
}
