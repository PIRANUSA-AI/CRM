import { Elysia, t } from 'elysia'
import { CannedResponseService } from './service'
import { CannedResponseModel, CannedResponseRequestModel } from './model'

export const cannedResponse = new Elysia({
	prefix: '/canned-responses',
	tags: ['Message'],
})
	.get(
		'/',
		async ({ query }) => {
			const responses = await CannedResponseService.getCannedResponses(
				query.accountId,
			)
			return { data: responses }
		},
		{
			query: t.Object({ accountId: t.String() }),
		},
	)
	.post(
		'/',
		async ({ query, body }) => {
			const resp = await CannedResponseService.createCannedResponse(
				query.accountId,
				body,
			)
			return { data: resp }
		},
		{
			query: t.Object({ accountId: t.String() }),
			body: CannedResponseRequestModel.create,
		},
	)
	.delete(
		'/:id',
		async ({ params, query }) => {
			await CannedResponseService.deleteCannedResponse(
				params.id,
				query.accountId,
			)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ accountId: t.String() }),
		},
	)
