import prisma from '../../lib/prisma'
import { resolveAppId, isUuid } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'

export abstract class CRMService {
	// Pipeline Management
	static async getPipelines(appId: string) {
		const targetAppId = await resolveAppId(appId)

		return prisma.pipelines.findMany({
			where: { app_id: targetAppId || undefined },
			include: {
				pipeline_stages: {
					orderBy: { stage_order: 'asc' },
				},
			},
		})
	}

	static async createPipeline(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)

		return prisma.$transaction(async (tx) => {
			const pipeline = await tx.pipelines.create({
				data: {
					app_id: targetAppId || appId,
					name: data.name,
					pipeline_type: data.pipelineType || 'retail',
				},
			})

			if (data.stages && data.stages.length > 0) {
				await tx.pipeline_stages.createMany({
					data: data.stages.map((s: any, i: number) => ({
						pipeline_id: pipeline.id,
						name: s.name,
						color: s.color || '#3b82f6',
						stage_order: s.order ?? i,
						stage_type: 'open',
					})),
				})
			}

			return tx.pipelines.findUnique({
				where: { id: pipeline.id },
				include: { pipeline_stages: true },
			})
		})
	}

	static async deletePipeline(id: string) {
		if (!isUuid(id)) return null

		return prisma.pipelines.delete({
			where: { id },
		})
	}

	// Deal Management
	static async getDealByConversationId(conversationId: string) {
		if (!isUuid(conversationId)) return null

		return prisma.conversation_sales.findUnique({
			where: { conversation_id: conversationId },
			include: {
				pipeline_stages: true,
			},
		})
	}

	static async updateDeal(conversationId: string, data: any, agentId?: string) {
		if (!isUuid(conversationId)) return null

		const txResult = await prisma.$transaction(async (tx) => {
			const deal = await tx.conversation_sales.findUnique({
				where: { conversation_id: conversationId },
			})

			if (!deal) throw new Error('Deal not found')

			const requestedPipelineId =
				data.pipeline_id === undefined
					? undefined
					: data.pipeline_id
						? String(data.pipeline_id)
						: null
			let nextPipelineId =
				requestedPipelineId === undefined ? deal.pipeline_id : requestedPipelineId

			const requestedStageId =
				data.stage_id === undefined
					? undefined
					: data.stage_id
						? String(data.stage_id)
						: null
			let nextStageId =
				requestedStageId === undefined ? deal.stage_id : requestedStageId

			if (nextStageId) {
				const stage = await tx.pipeline_stages.findUnique({
					where: { id: nextStageId },
					select: { id: true, pipeline_id: true },
				})
				if (!stage) throw new Error('Stage not found')
				if (nextPipelineId && stage.pipeline_id !== nextPipelineId) {
					throw new Error('Stage does not belong to selected pipeline')
				}
				if (!nextPipelineId) {
					nextPipelineId = stage.pipeline_id
				}
			}

			// If moving stage, log transition
			if (nextStageId && nextStageId !== deal.stage_id) {
				await tx.stage_transitions.create({
					data: {
						conversation_id: conversationId,
						from_stage_id: deal.stage_id,
						to_stage_id: nextStageId,
					},
				})
			}

			const updatedDeal = await tx.conversation_sales.update({
				where: { conversation_id: conversationId },
				data: {
					pipeline_id: nextPipelineId,
					stage_id: nextStageId,
					deal_value: data.deal_value,
					updated_at: new Date(),
				},
			})

			const updatedConversation = await tx.conversations.update({
				where: { id: conversationId },
				data: {
					pipeline_id: nextPipelineId,
					stage_id: nextStageId,
					updated_at: new Date(),
				},
				select: {
					id: true,
					app_id: true,
					inbox_id: true,
					pipeline_id: true,
					stage_id: true,
				},
			})

			return {
				previous: deal,
				updatedDeal,
				updatedConversation,
			}
		})

		if (txResult.updatedConversation.app_id) {
			const stageChanged = txResult.previous.stage_id !== txResult.updatedDeal.stage_id
			const pipelineChanged =
				txResult.previous.pipeline_id !== txResult.updatedDeal.pipeline_id

			if (stageChanged) {
				void BusinessWebhookDispatchService.dispatch({
					event: 'conversation.stage_status_updated',
					appId: txResult.updatedConversation.app_id,
					inboxId: txResult.updatedConversation.inbox_id,
					payload: {
						conversation_id: conversationId,
						previous_stage_id: txResult.previous.stage_id,
						current_stage_id: txResult.updatedDeal.stage_id,
						pipeline_id: txResult.updatedDeal.pipeline_id,
						updated_by: agentId || null,
					},
				})
			}

			if (pipelineChanged) {
				void BusinessWebhookDispatchService.dispatch({
					event: 'conversation.pipeline_status_updated',
					appId: txResult.updatedConversation.app_id,
					inboxId: txResult.updatedConversation.inbox_id,
					payload: {
						conversation_id: conversationId,
						previous_pipeline_id: txResult.previous.pipeline_id,
						current_pipeline_id: txResult.updatedDeal.pipeline_id,
						stage_id: txResult.updatedDeal.stage_id,
						updated_by: agentId || null,
					},
				})
			}
		}

		return txResult.updatedDeal
	}
}
