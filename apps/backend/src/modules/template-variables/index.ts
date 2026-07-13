import { Elysia, t } from 'elysia'
import { TemplateVariableService } from './service'
import { TemplateVariableModel } from './model'
import { appContext } from '../../plugins'

export const templateVariables = new Elysia({
	prefix: '/template-variables',
	tags: ['Template Variables'],
})
	.use(appContext)
	.get('/', async ({ resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const variables = await TemplateVariableService.list(resolvedAppId)
		return { success: true, data: variables }
	})
	.post(
		'/',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const variable = await TemplateVariableService.create(resolvedAppId, body)
			return { success: true, data: variable }
		},
		{
			body: TemplateVariableModel.create,
		},
	)
	.delete(
		'/:id',
		async ({ params }) => {
			await TemplateVariableService.delete(params.id)
			return { success: true }
		},
		{
			params: TemplateVariableModel.id,
		},
	)
