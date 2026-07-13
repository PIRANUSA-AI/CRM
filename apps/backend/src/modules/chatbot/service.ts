import prisma from '../../lib/prisma'
import { ChatbotSimulationService } from './simulation-service'
import { KnowledgeIndexService } from '../knowledge/indexing-service'

const isUuid = (str: string) =>
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)

async function resolveAppId(appId: string): Promise<string | null> {
	if (!appId || appId === 'default') return null
	if (isUuid(appId)) return appId

	const app = await prisma.apps.findFirst({
		where: { app_id: appId },
		select: { id: true },
	})

	return app?.id || null
}

function toOptionalNumber(value: unknown): number | undefined {
	if (value === null || value === undefined) return undefined
	if (typeof value === 'number') {
		return Number.isFinite(value) ? value : undefined
	}
	if (typeof value === 'string') {
		const normalized = value.trim()
		if (!normalized) return undefined
		const parsed = Number(normalized)
		return Number.isFinite(parsed) ? parsed : undefined
	}
	return undefined
}

function toOptionalInteger(value: unknown): number | undefined {
	const parsed = toOptionalNumber(value)
	if (parsed === undefined) return undefined
	return Math.trunc(parsed)
}

function toOptionalBoolean(value: unknown): boolean | undefined {
	if (value === null || value === undefined) return undefined
	if (typeof value === 'boolean') return value
	if (typeof value === 'string') {
		const normalized = value.trim().toLowerCase()
		if (normalized === 'true' || normalized === '1') return true
		if (normalized === 'false' || normalized === '0') return false
	}
	return undefined
}

function toOptionalJsonArray(value: unknown): any[] | undefined {
	if (value === null || value === undefined) return undefined
	if (Array.isArray(value)) return value
	if (typeof value === 'string') {
		try {
			const parsed = JSON.parse(value)
			return Array.isArray(parsed) ? parsed : undefined
		} catch {
			return undefined
		}
	}
	return undefined
}

function normalizeChatbotPayload(data: Record<string, any>) {
	const nextData: Record<string, any> = { ...data }

	const parsedTemperature = toOptionalNumber(data.temperature)
	if (parsedTemperature !== undefined) nextData.temperature = parsedTemperature
	else delete nextData.temperature

	for (const field of [
		'history_limit',
		'context_limit',
		'message_await',
		'message_limit',
		'max_file_read_window',
	] as const) {
		const parsedInteger = toOptionalInteger(data[field])
		if (parsedInteger !== undefined) nextData[field] = parsedInteger
		else delete nextData[field]
	}

	for (const field of [
		'is_silent_handoff_agent',
		'watcher_enabled',
		'session_only_memory',
		'stop_after_handoff',
	] as const) {
		const parsedBoolean = toOptionalBoolean(data[field])
		if (parsedBoolean !== undefined) nextData[field] = parsedBoolean
		else delete nextData[field]
	}

	const parsedSelectedLabels = toOptionalJsonArray(data.selected_labels)
	if (parsedSelectedLabels !== undefined) {
		nextData.selected_labels = parsedSelectedLabels.map((item) => String(item))
	}

	const parsedFollowups = toOptionalJsonArray(data.ai_followups)
	if (parsedFollowups !== undefined) {
		nextData.ai_followups = parsedFollowups
	}

	// Deprecated from legacy UI, kept only for request compatibility.
	delete nextData.usage_mode

	return nextData
}

export abstract class ChatbotService {
	static async getChatbots(appId: string) {
		const targetAppId = await resolveAppId(appId)

		return prisma.chatbots.findMany({
			where: { app_id: targetAppId || undefined, is_deleted: false },
			orderBy: { created_at: 'desc' },
		})
	}

	static async getChatbotById(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)

		return prisma.chatbots.findFirst({
			where: { id, app_id: targetAppId || undefined, is_deleted: false },
		})
	}

	static async resolveDefaultChatbotId(appId: string): Promise<string | null> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return null

		const watcherChatbot = await prisma.chatbots.findFirst({
			where: {
				app_id: targetAppId,
				is_deleted: false,
				watcher_enabled: true,
			},
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
			select: { id: true },
		})
		if (watcherChatbot?.id) return watcherChatbot.id

		const fallbackChatbot = await prisma.chatbots.findFirst({
			where: {
				app_id: targetAppId,
				is_deleted: false,
			},
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
			select: { id: true },
		})
		return fallbackChatbot?.id || null
	}

	static async getModelPricing() {
		return prisma.ai_model_pricing.findMany({
			where: { is_active: true },
			orderBy: { model_name: 'asc' },
		})
	}

	static async createChatbot(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		const normalizedData = normalizeChatbotPayload(data)

		return prisma.chatbots.create({
			data: {
				...(normalizedData as any),
				app_id: targetAppId || appId,
			} as any,
		})
	}

	static async updateChatbot(id: string, appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		const normalizedData = normalizeChatbotPayload(data)

		return prisma.chatbots.update({
			where: { id, app_id: targetAppId || undefined },
			data: {
				...normalizedData,
				updated_at: new Date(),
			},
		})
	}

	static async deleteChatbot(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)

		return prisma.chatbots.update({
			where: { id, app_id: targetAppId || undefined },
			data: {
				is_deleted: true,
				updated_at: new Date(),
			},
		})
	}

	// Document Management
	static async getDocuments(chatbotId: string) {
		return prisma.knowledge_sources.findMany({
			where: { chatbot_id: chatbotId, is_active: true },
		})
	}

	static async createDocument(chatbotId: string, appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)

		const created = await prisma.knowledge_sources.create({
			data: {
				...data,
				chatbot_id: chatbotId,
				app_id: targetAppId,
				is_active: true,
				status: 'processing',
				error_message: null,
				chunk_count: 0,
			},
		})

		if (created?.id && targetAppId) {
			void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
				action: 'create',
				entity: 'source',
				app_id: targetAppId,
				chatbot_id: chatbotId,
				knowledge_id: created.id,
				timestamp: new Date().toISOString(),
			}).catch((error) => {
				console.error(
					'[ChatbotService] Failed enqueue knowledge_change_events for source create',
					error,
				)
			})
		}

		return created
	}

	static async updateDocument(
		chatbotId: string,
		docId: string,
		appId: string,
		data: any,
	) {
		const targetAppId = await resolveAppId(appId)

		const existing = await prisma.knowledge_sources.findFirst({
			where: {
				id: docId,
				chatbot_id: chatbotId,
				app_id: targetAppId || undefined,
				is_active: true,
			},
			select: { id: true },
		})

		if (!existing) return null

		const updated = await prisma.knowledge_sources.update({
			where: { id: docId },
			data: {
				...(data.title !== undefined && { title: data.title }),
				...(data.content !== undefined && { content: data.content }),
				...(data.type !== undefined && { type: data.type }),
				...(data.metadata !== undefined && { metadata: data.metadata }),
				status: 'processing',
				error_message: null,
				updated_at: new Date(),
			},
		})

		if (updated?.id && targetAppId) {
			void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
				action: 'update',
				entity: 'source',
				app_id: targetAppId,
				chatbot_id: chatbotId,
				knowledge_id: updated.id,
				timestamp: new Date().toISOString(),
			}).catch((error) => {
				console.error(
					'[ChatbotService] Failed enqueue knowledge_change_events for source update',
					error,
				)
			})
		}

		return updated
	}

	static async deleteDocument(chatbotId: string, docId: string, appId: string) {
		const targetAppId = await resolveAppId(appId)

		const existing = await prisma.knowledge_sources.findFirst({
			where: {
				id: docId,
				chatbot_id: chatbotId,
				app_id: targetAppId || undefined,
				is_active: true,
			},
			select: { id: true },
		})

		if (!existing) return null

		const deleted = await prisma.knowledge_sources.update({
			where: { id: docId },
			data: { is_active: false, updated_at: new Date() },
		})

		if (deleted?.id && targetAppId) {
			void KnowledgeIndexService.enqueueKnowledgeChangeEvent({
				action: 'delete',
				entity: 'source',
				app_id: targetAppId,
				chatbot_id: chatbotId,
				knowledge_id: deleted.id,
				timestamp: new Date().toISOString(),
			}).catch((error) => {
				console.error(
					'[ChatbotService] Failed enqueue knowledge_change_events for source delete',
					error,
				)
			})
		}

		return deleted
	}

	static async generateAgentReply(
		chatbotId: string,
		appId: string,
		payload: {
			message: string
			history?: unknown
			runTools?: boolean
			strictFollowup?: boolean
			mode?: 'simulate' | 'live'
			entrypoint?:
				| 'webhook_live'
				| 'flow_runtime'
				| 'followup'
				| 'simulate'
				| 'unknown'
			conversationId?: string | null
			sourceMessageIds?: string[]
			skipRag?: boolean
			allowAllKnowledge?: boolean
			minimalContext?: boolean
		},
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) {
			throw new Error('Invalid App ID')
		}

		const chatbot = await prisma.chatbots.findFirst({
			where: {
				id: chatbotId,
				app_id: targetAppId,
				is_deleted: false,
			},
			select: {
				id: true,
				app_id: true,
				name: true,
				model: true,
				prompt: true,
				welcome_msg: true,
				agent_transfer: true,
				temperature: true,
				history_limit: true,
				context_limit: true,
				max_file_read_window: true,
				message_limit: true,
				session_only_memory: true,
				timezone: true,
				label_condition: true,
				selected_labels: true,
				app_data: true,
				ai_followups: true,
				plugin_data: true,
			},
		})

		if (!chatbot) {
			const persona = await prisma.ai_playground_personas.findFirst({
				where: {
					id: chatbotId,
					app_id: targetAppId,
				},
				select: {
					id: true,
					app_id: true,
					persona_key: true,
					label: true,
					system_instruction: true,
				},
			})

			if (!persona) {
				throw new Error('Chatbot not found')
			}

			return ChatbotSimulationService.simulateResponse({
				chatbot: {
					id: persona.id,
					app_id: persona.app_id,
					name: persona.label,
					model: null,
					prompt: persona.system_instruction,
					welcome_msg: null,
					agent_transfer: null,
					temperature: null,
					history_limit: 50,
					context_limit: 50,
					max_file_read_window: 3,
					message_limit: 1000,
					session_only_memory: false,
					timezone: 'Asia/Jakarta',
					label_condition: null,
					selected_labels: [],
					app_data: {
						agent_kind: 'ai_persona',
						persona_id: persona.id,
						persona_key: persona.persona_key,
					},
					ai_followups: [],
					plugin_data: {
						agent_kind: 'ai_persona',
						persona_id: persona.id,
						persona_key: persona.persona_key,
					},
				},
				appId: targetAppId,
				message: String(payload.message || ''),
				history: payload.history,
				runTools: payload.runTools,
				strictFollowup: payload.strictFollowup,
				mode: payload.mode || 'simulate',
				entrypoint: payload.entrypoint || 'unknown',
				conversationId: payload.conversationId || null,
				sourceMessageIds: Array.isArray(payload.sourceMessageIds)
					? payload.sourceMessageIds
					: [],
				skipRag: payload.skipRag,
				allowAllKnowledge: payload.allowAllKnowledge,
				minimalContext: payload.minimalContext,
			})
		}

		return ChatbotSimulationService.simulateResponse({
			chatbot: {
				...chatbot,
				app_id: chatbot.app_id,
				model: chatbot.model ?? null,
				prompt: chatbot.prompt ?? null,
				welcome_msg: chatbot.welcome_msg ?? null,
				agent_transfer: chatbot.agent_transfer ?? null,
				history_limit: chatbot.history_limit ?? null,
				context_limit: chatbot.context_limit ?? null,
				max_file_read_window: chatbot.max_file_read_window ?? null,
				message_limit: chatbot.message_limit ?? null,
				session_only_memory: chatbot.session_only_memory ?? null,
				timezone: chatbot.timezone ?? null,
				label_condition: chatbot.label_condition ?? null,
				selected_labels: chatbot.selected_labels ?? [],
			},
			appId: targetAppId,
			message: String(payload.message || ''),
			history: payload.history,
			runTools: payload.runTools,
			strictFollowup: payload.strictFollowup,
			mode: payload.mode || 'simulate',
			entrypoint: payload.entrypoint || 'unknown',
			conversationId: payload.conversationId || null,
			sourceMessageIds: Array.isArray(payload.sourceMessageIds)
				? payload.sourceMessageIds
				: [],
			skipRag: payload.skipRag,
			allowAllKnowledge: payload.allowAllKnowledge,
			minimalContext: payload.minimalContext,
		})
	}
}
