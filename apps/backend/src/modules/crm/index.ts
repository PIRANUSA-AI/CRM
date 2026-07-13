import { Elysia, t } from 'elysia'
import { CRMService } from './service'
import { CRMModel, CRMRequestModel } from './model'
import { appContext } from '../../plugins'

export const crm = new Elysia({ prefix: '/crm', tags: ['CRM'] })
	.use(appContext)
	.get(
		'/pipelines',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const pipelines = await CRMService.getPipelines(resolvedAppId)
			return { data: pipelines }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/pipelines',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const pipeline = await CRMService.createPipeline(resolvedAppId, body)
			return { data: pipeline }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: CRMRequestModel.createPipeline,
		},
	)
	.delete(
		'/pipelines/:id',
		async ({ params }) => {
			await CRMService.deletePipeline(params.id)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.get(
		'/deals/:conversationId',
		async ({ params }) => {
			const deal = await CRMService.getDealByConversationId(
				params.conversationId,
			)
			return { data: deal }
		},
		{
			params: t.Object({ conversationId: t.String() }),
		},
	)
	.patch(
		'/deals/:conversationId',
		async ({ params, body, userId }) => {
			const deal = await CRMService.updateDeal(
				params.conversationId,
				body,
				userId || 'system',
			)
			return { data: deal }
		},
		{
			params: t.Object({ conversationId: t.String() }),
			body: CRMRequestModel.updateDeal,
		},
	)
