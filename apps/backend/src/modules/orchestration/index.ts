import { Elysia, t } from 'elysia'
import { OrchestrationService } from './service'
import { OrchestrationModel, OrchestrationRequestModel } from './model'
import { appContext } from '../../plugins'
import { DecisionEngineService } from '../flow/decision-engine-service'

export const orchestration = new Elysia({
	prefix: '/orchestration',
	tags: ['AI'],
})
	.use(appContext)
	.post(
		'/decide',
		async ({ body, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const decisionEnvelope = await DecisionEngineService.evaluateInbound({
				appId: resolvedAppId,
				conversationId: body.conversationId,
				flowId: null,
				messageId: body.messageId,
				channelType: null,
				incomingText: body.messageContent,
				source: 'inbound',
			})

			return {
				success: true,
				decision: {
					action: decisionEnvelope.recommended_action,
					reason:
						decisionEnvelope.approval_reason ||
						`Intent ${decisionEnvelope.intent} with ${decisionEnvelope.confidence_band} confidence`,
					confidence: decisionEnvelope.overall_confidence,
					agentId: null,
					metadata: decisionEnvelope,
				},
			}
		},
		{
			body: OrchestrationRequestModel.decide,
		},
	)
	.get(
		'/agents',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const agents =
				await OrchestrationService.getAvailableAgents(resolvedAppId)
			return { success: true, agents }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/handoff',
		async ({ body }) => {
			await OrchestrationService.executeHandoff(
				body.conversationId,
				body.fromAgentId,
				body.toAgentId,
				body.reason || 'Manual handoff',
			)
			return { success: true }
		},
		{
			body: OrchestrationRequestModel.handoff,
		},
	)
	.get(
		'/handoffs/:conversationId',
		async ({ params }) => {
			const handoffs = await OrchestrationService.getHandoffs(
				params.conversationId,
			)
			return { success: true, handoffs }
		},
		{
			params: t.Object({ conversationId: t.String() }),
		},
	)
