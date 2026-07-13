import prisma from '../../lib/prisma'
import { isUuid } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'

export abstract class NoteService {
	private static async getConversationContext(conversationId: string) {
		if (!isUuid(conversationId)) return null
		return prisma.conversations.findUnique({
			where: { id: conversationId },
			select: { id: true, app_id: true, inbox_id: true },
		})
	}

	static async listNotes(conversationId: string) {
		if (!isUuid(conversationId)) return []

		return prisma.conversation_notes.findMany({
			where: { conversation_id: conversationId },
			orderBy: { created_at: 'desc' },
		})
	}

	static async createNote(
		conversationId: string,
		userId: string,
		content: string,
	) {
		const note = await prisma.conversation_notes.create({
			data: {
				conversation_id: conversationId,
				user_id: userId,
				content,
			},
		})
		const conversation = await NoteService.getConversationContext(conversationId)
		if (conversation?.app_id) {
			void BusinessWebhookDispatchService.dispatch({
				event: 'conversation_note.created',
				appId: conversation.app_id,
				inboxId: conversation.inbox_id,
				payload: {
					conversation_id: conversation.id,
					note: {
						id: note.id,
						user_id: note.user_id,
						content: note.content,
						created_at: note.created_at,
						updated_at: note.updated_at,
					},
				},
			})
		}
		return note
	}

	static async updateNote(
		conversationId: string,
		noteId: string,
		userId: string | undefined,
		content: string,
	) {
		if (!isUuid(noteId) || !isUuid(conversationId)) return null

		const note = await prisma.conversation_notes.findUnique({
			where: { id: noteId },
			select: {
				id: true,
				conversation_id: true,
				user_id: true,
			},
		})
		if (!note || note.conversation_id !== conversationId) return null
		if (userId && note.user_id && note.user_id !== userId) return null

		const updatedNote = await prisma.conversation_notes.update({
			where: { id: noteId },
			data: {
				content,
				updated_at: new Date(),
			},
		})

		const conversation = await NoteService.getConversationContext(conversationId)
		if (conversation?.app_id) {
			void BusinessWebhookDispatchService.dispatch({
				event: 'conversation_note.updated',
				appId: conversation.app_id,
				inboxId: conversation.inbox_id,
				payload: {
					conversation_id: conversation.id,
					note: {
						id: updatedNote.id,
						user_id: updatedNote.user_id,
						content: updatedNote.content,
						created_at: updatedNote.created_at,
						updated_at: updatedNote.updated_at,
					},
				},
			})
		}

		return updatedNote
	}

	static async deleteNote(noteId: string, userId?: string) {
		if (!isUuid(noteId)) return null

		// Ownership check if userId is provided (non-admin)
		if (userId) {
			const note = await prisma.conversation_notes.findUnique({
				where: { id: noteId },
			})
			if (!note || note.user_id !== userId) return null
		}

		return prisma.conversation_notes.delete({ where: { id: noteId } })
	}
}
