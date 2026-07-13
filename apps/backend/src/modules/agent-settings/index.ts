import { Elysia, t } from 'elysia'
import { AgentSettingsService } from './service'
import { AgentSettingsRequestModel } from './model'
import { appContext } from '../../plugins'

export const agentSettings = new Elysia({
	prefix: '/agent-settings',
	tags: ['Admin'],
})
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const settings = await AgentSettingsService.getSettings(resolvedAppId)
			return { success: true, settings }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.put(
		'/',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const settings = await AgentSettingsService.updateSettings(
				resolvedAppId,
				body,
			)
			return { success: true, settings }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AgentSettingsRequestModel.update,
		},
	)
