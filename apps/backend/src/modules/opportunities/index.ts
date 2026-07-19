import { Elysia } from 'elysia'
import { appContext } from '../../plugins'
import { OpportunityService } from './service'
import { OpportunityRequestModel } from './model'

export const opportunities = new Elysia({ prefix: '/opportunities', tags: ['Opportunities'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const data = await OpportunityService.list(resolvedAppId, {
				status: query.status || undefined,
				ownerId: query.ownerId || undefined,
				contactId: query.contactId || undefined,
				search: query.search || undefined,
				limit: query.limit ? Number(query.limit) : undefined,
				offset: query.offset ? Number(query.offset) : undefined,
			})
			return { success: true, payload: data }
		},
		{ query: OpportunityRequestModel.listQuery },
	)
	.get('/stats', async ({ resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		return { success: true, payload: await OpportunityService.stats(resolvedAppId) }
	})
	.get('/:id', async ({ resolvedAppId, params, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const opportunity = await OpportunityService.getById(resolvedAppId, params.id)
		if (!opportunity) {
			set.status = 404
			return { error: 'Opportunity not found' }
		}
		return { success: true, payload: opportunity }
	})
	.post(
		'/',
		async ({ resolvedAppId, userId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				const opportunity = await OpportunityService.create(
					{ appId: resolvedAppId, userId: userId ?? null },
					body,
				)
				return { success: true, payload: opportunity }
			} catch (error) {
				set.status = 400
				return { error: error instanceof Error ? error.message : 'Gagal membuat opportunity' }
			}
		},
		{ body: OpportunityRequestModel.create },
	)
	.patch(
		'/:id',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const opportunity = await OpportunityService.update(resolvedAppId, params.id, body)
			if (!opportunity) {
				set.status = 404
				return { error: 'Opportunity not found' }
			}
			return { success: true, payload: opportunity }
		},
		{ body: OpportunityRequestModel.update },
	)
	.delete('/:id', async ({ resolvedAppId, params, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const ok = await OpportunityService.remove(resolvedAppId, params.id)
		if (!ok) {
			set.status = 404
			return { error: 'Opportunity not found' }
		}
		return { success: true }
	})
