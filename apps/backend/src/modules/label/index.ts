import { Elysia, t } from 'elysia'
import { LabelService } from './service'
import { LabelModel, LabelRequestModel } from './model'
import { appContext } from '../../plugins'

export const label = new Elysia({ prefix: '/labels', tags: ['Label'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const labels = await LabelService.getLabels(resolvedAppId)
			return { success: true, data: { labels } }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const normalizedTitle =
				typeof body.title === 'string' && body.title.trim()
					? body.title.trim()
					: typeof body.name === 'string' && body.name.trim()
						? body.name.trim()
						: null
			if (!normalizedTitle) {
				set.status = 400
				return {
					error: "Field 'title' is required (or provide legacy field 'name')",
				}
			}
			const l = await LabelService.createLabel(resolvedAppId, {
				title: normalizedTitle,
				description:
					typeof body.description === 'string' ? body.description : undefined,
				color: typeof body.color === 'string' ? body.color : undefined,
			})
			return { data: l }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: LabelRequestModel.create,
		},
	)
	.patch(
		'/:id',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const normalizedTitle =
				typeof body.title === 'string' && body.title.trim()
					? body.title.trim()
					: typeof body.name === 'string' && body.name.trim()
						? body.name.trim()
						: undefined
			const l = await LabelService.updateLabel(params.id, resolvedAppId, {
				title: normalizedTitle,
				description:
					typeof body.description === 'string' ? body.description : undefined,
				color: typeof body.color === 'string' ? body.color : undefined,
			})
			return { data: l }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: LabelRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			await LabelService.deleteLabel(params.id, resolvedAppId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)

	// Conversation Labels
	.get(
		'/conversation/:id',
		async ({ params }) => {
			const labels = await LabelService.getConversationLabels(params.id)
			return { data: labels }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/conversation/:id',
		async ({ params, body }) => {
			const assignment = await LabelService.addLabelToConversation(
				params.id,
				body.labelId,
			)
			return { data: assignment }
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({ labelId: t.String() }),
		},
	)
	.delete(
		'/conversation/:id/:labelId',
		async ({ params }) => {
			await LabelService.removeLabelFromConversation(params.id, params.labelId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String(), labelId: t.String() }),
		},
	)
