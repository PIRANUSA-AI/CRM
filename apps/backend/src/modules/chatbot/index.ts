import { Elysia, t } from 'elysia'
import { ChatbotService } from './service'
import { ChatbotModel, ChatbotRequestModel } from './model'
import { appContext } from '../../plugins'

export const chatbot = new Elysia({ prefix: '/chatbots', tags: ['Chatbot'] })
	.use(appContext)
	.get('/', async ({ resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const chatbots = await ChatbotService.getChatbots(resolvedAppId)
		return { data: chatbots }
	})
	.get('/default', async ({ resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const chatbotId = await ChatbotService.resolveDefaultChatbotId(resolvedAppId)
		if (!chatbotId) {
			return { data: null }
		}
		const bot = await ChatbotService.getChatbotById(chatbotId, resolvedAppId)
		return {
			data: bot
				? {
						id: bot.id,
						name: bot.name,
					}
				: { id: chatbotId },
		}
	})
	.get('/model-pricing', async ({ resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const pricing = await ChatbotService.getModelPricing()
		return {
			data: pricing.map((item) => ({
				id: item.id,
				model_name: item.model_name,
				cost_per_request: Number(item.cost_per_request),
				description: item.description,
				is_active: item.is_active ?? true,
			})),
		}
	})
	.get(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const bot = await ChatbotService.getChatbotById(params.id, resolvedAppId)
			if (!bot) return { error: 'Chatbot not found' }
			return { data: bot }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const bot = await ChatbotService.createChatbot(resolvedAppId, body)
			return { data: bot }
		},
		{
			body: ChatbotRequestModel.create,
		},
	)
	.patch(
		'/:id',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const bot = await ChatbotService.updateChatbot(
				params.id,
				resolvedAppId,
				body,
			)
			return { data: bot }
		},
		{
			params: t.Object({ id: t.String() }),
			body: ChatbotRequestModel.update,
		},
	)
	.put(
		'/:id',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const bot = await ChatbotService.updateChatbot(
				params.id,
				resolvedAppId,
				body,
			)
			return { data: bot }
		},
		{
			params: t.Object({ id: t.String() }),
			body: ChatbotRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			await ChatbotService.deleteChatbot(params.id, resolvedAppId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/:id/simulate',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const bodyAsRecord =
					body && typeof body === 'object' && !Array.isArray(body)
						? (body as Record<string, unknown>)
						: {}
				const sourceMessages = Array.isArray(bodyAsRecord.messages)
					? (bodyAsRecord.messages as Array<Record<string, unknown>>)
					: []
				const conversationId =
					typeof bodyAsRecord.conversation_id === 'string' &&
					bodyAsRecord.conversation_id.trim().length > 0
						? bodyAsRecord.conversation_id.trim()
						: null
				const sourceMessageIds = sourceMessages
					.map((item) => {
						const idValue = item.id
						if (typeof idValue === 'string' || typeof idValue === 'number') {
							const normalized = String(idValue).trim()
							return normalized.length > 0 ? normalized : null
						}
						return null
					})
					.filter((item): item is string => Boolean(item))

				let message = String(bodyAsRecord.message || '').trim()
				let resolvedFromMessages = false
				let latestUserSourceIndex = -1
				if (!message && sourceMessages.length > 0) {
					for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
						const item = sourceMessages[index]
						const sentByType = String(
							item.sent_by_type || item.role || '',
						).toLowerCase()
						if (sentByType !== 'user' && sentByType !== 'contact') continue

						const candidate = String(item.message || item.content || '').trim()
						if (!candidate) continue

						message = candidate
						resolvedFromMessages = true
						latestUserSourceIndex = index
						break
					}
				}

				if (!message) {
					for (let index = sourceMessages.length - 1; index >= 0; index -= 1) {
						const item = sourceMessages[index]
						const sentByType = String(
							item.sent_by_type || item.role || '',
						).toLowerCase()
						if (sentByType !== 'user' && sentByType !== 'contact') continue

						const candidate = String(item.message || item.content || '').trim()
						if (!candidate) continue

						message = candidate
						latestUserSourceIndex = index
						break
					}
				}

				if (!message) {
					set.status = 400
					return { error: 'Message is required' }
				}

				const mappedHistoryFromMessages = sourceMessages
					.map((item, sourceIndex) => {
						const content = String(item.content || item.message || '').trim()
						if (!content) return null

						const roleValue = String(
							item.role || item.sent_by_type || '',
						).toLowerCase()
						if (roleValue === 'system') return null

						const role: 'user' | 'assistant' =
							roleValue === 'assistant' ||
							roleValue === 'ai' ||
							roleValue === 'bot' ||
							roleValue === 'agent'
								? 'assistant'
								: 'user'

						return {
							role,
							content,
							sourceIndex,
						}
					})
					.filter(
						(
							item,
						): item is {
							role: 'user' | 'assistant'
							content: string
							sourceIndex: number
						} => item !== null,
					)

				const historyFromMessages =
					resolvedFromMessages && latestUserSourceIndex >= 0
						? mappedHistoryFromMessages
								.filter((item) => item.sourceIndex !== latestUserSourceIndex)
								.map(({ role, content }) => ({ role, content }))
						: mappedHistoryFromMessages.map(({ role, content }) => ({
								role,
								content,
							}))

				const history = Array.isArray(bodyAsRecord.history)
					? (bodyAsRecord.history as Array<{ role: string; content: string }>)
					: historyFromMessages

				const requestedChatbotId =
					typeof bodyAsRecord.ai_agent_id === 'string' &&
					bodyAsRecord.ai_agent_id.trim().length > 0
						? bodyAsRecord.ai_agent_id.trim()
						: params.id

				let result: Awaited<ReturnType<typeof ChatbotService.generateAgentReply>>
				try {
					result = await ChatbotService.generateAgentReply(
						requestedChatbotId,
						resolvedAppId,
						{
							message,
							history,
							runTools: bodyAsRecord.execute_tools as boolean | undefined,
							mode: 'simulate',
							entrypoint: 'simulate',
							conversationId,
							sourceMessageIds,
						},
					)
				} catch (error) {
					const shouldFallbackToPathId =
						error instanceof Error &&
						error.message === 'Chatbot not found' &&
						requestedChatbotId !== params.id
					if (!shouldFallbackToPathId) {
						throw error
					}

					result = await ChatbotService.generateAgentReply(
						params.id,
						resolvedAppId,
						{
							message,
							history,
							runTools: bodyAsRecord.execute_tools as boolean | undefined,
							mode: 'simulate',
							entrypoint: 'simulate',
							conversationId,
							sourceMessageIds,
						},
					)
				}

				const timeline = Array.isArray(result.preview?.timeline)
					? result.preview.timeline
					: []
				const responseMessages: Array<
					{
						role: 'system'
						content: string
					} | {
						role: 'assistant'
						content: string
						credits_used: number
					}
				> = []

				const assistantParts: string[] = []
				for (const entry of timeline) {
					if (!entry || typeof entry !== 'object') continue

					if (entry.type === 'status') {
						const content = String(entry.text || '').trim()
						if (!content) continue
						responseMessages.push({
							role: 'system',
							content,
						})
						continue
					}

					if (entry.type === 'text') {
						const content = String(entry.content || '').trim()
						if (!content) continue
						assistantParts.push(content)
						continue
					}

					if (entry.type === 'image') {
						const imageUrl = String(entry.url || '').trim()
						if (!imageUrl) continue
						assistantParts.push(imageUrl)
					}
				}

				if (assistantParts.length === 0) {
					const fallback = String(result.content || '').trim()
					if (fallback) assistantParts.push(fallback)
				}

				if (assistantParts.length > 0) {
					responseMessages.push({
						role: 'assistant',
						content: assistantParts.join('\n###\n'),
						credits_used: Number(result.preview?.credits_used || 0),
					})
				}

				const chatData =
					bodyAsRecord.chat_data &&
					typeof bodyAsRecord.chat_data === 'object' &&
					!Array.isArray(bodyAsRecord.chat_data)
						? bodyAsRecord.chat_data
						: {}

				return {
					success: true,
					messages: responseMessages,
					chat_data: chatData,
					data: result.content,
					meta: result.meta,
					preview: result.preview,
				}
			} catch (error: any) {
				if (error instanceof Error && error.message === 'Chatbot not found') {
					set.status = 404
					return { error: 'Chatbot not found' }
				}

				set.status = 400
				return { error: error?.message || 'Simulation failed' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				message: t.Optional(t.String()),
				history: t.Optional(
					t.Array(
						t.Object({
							role: t.String(),
							content: t.String(),
						}),
					),
				),
				execute_tools: t.Optional(t.Boolean()),
				ai_agent_id: t.Optional(t.String()),
				messages: t.Optional(
					t.Array(
						t.Object({
							id: t.Optional(t.Union([t.String(), t.Number()])),
							message: t.Optional(t.String()),
							content: t.Optional(t.String()),
							role: t.Optional(t.String()),
							sent_by_type: t.Optional(t.String()),
							sent_by: t.Optional(t.String()),
							sent_by_name: t.Optional(t.String()),
							created_at: t.Optional(t.String()),
						}),
					),
				),
				chat_data: t.Optional(t.Any()),
				conversation_id: t.Optional(t.String()),
			}),
		},
	)

	// Documents
	.get(
		'/:id/documents',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const docs = await ChatbotService.getDocuments(params.id)
			return { data: docs }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/:id/documents',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const doc = await ChatbotService.createDocument(
				params.id,
				resolvedAppId,
				body,
			)
			return { data: doc }
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				title: t.String(),
				content: t.String(),
				type: t.Optional(t.String()),
			}),
		},
	)
	.patch(
		'/:id/documents/:docId',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const doc = await ChatbotService.updateDocument(
				params.id,
				params.docId,
				resolvedAppId,
				body,
			)
			if (!doc) {
				set.status = 404
				return { error: 'Document not found' }
			}
			return { data: doc }
		},
		{
			params: t.Object({ id: t.String(), docId: t.String() }),
			body: t.Object({
				title: t.Optional(t.String()),
				content: t.Optional(t.String()),
				type: t.Optional(t.String()),
				metadata: t.Optional(t.Any()),
			}),
		},
	)
	.delete(
		'/:id/documents/:docId',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const doc = await ChatbotService.deleteDocument(
				params.id,
				params.docId,
				resolvedAppId,
			)
			if (!doc) {
				set.status = 404
				return { error: 'Document not found' }
			}
			return { success: true }
		},
		{
			params: t.Object({ id: t.String(), docId: t.String() }),
		},
	)
