import { Elysia, t } from 'elysia'
import { BroadcastService } from './service'
import { BroadcastModel, BroadcastRequestModel } from './model'
import { appContext } from '../../plugins'

export const broadcast = new Elysia({
	prefix: '/broadcasts',
	tags: ['Broadcast'],
})
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const items = await BroadcastService.getBroadcasts(resolvedAppId)
			return { data: items }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.get(
		'/jobs',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}

			const rawStatus = query.status ?? query.statuses
			const statuses = Array.isArray(rawStatus)
				? rawStatus
				: typeof rawStatus === 'string'
					? [rawStatus]
					: []

			const result = await BroadcastService.getBroadcastJobs(resolvedAppId, {
				page: Number(query.page || 1),
				limit: Number(query.limit || 10),
				statuses,
			})

			return {
				success: true,
				data: result.data,
				pagination: result.pagination,
			}
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				page: t.Optional(t.String()),
				limit: t.Optional(t.String()),
				status: t.Optional(t.Union([t.String(), t.Array(t.String())])),
				statuses: t.Optional(t.Union([t.String(), t.Array(t.String())])),
			}),
		},
	)
	.get(
		'/jobs/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}

			try {
				const item = await BroadcastService.getBroadcastJobDetail(
					params.id,
					resolvedAppId,
				)
				return {
					success: true,
					data: item,
				}
			} catch (error: any) {
				const message = error?.message || 'Failed to load broadcast job'
				set.status = message === 'Broadcast not found' ? 404 : 500
				return {
					success: false,
					error: message,
				}
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/audience/preview',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}

			try {
				const result = await BroadcastService.previewAudience(
					resolvedAppId,
					body.filters,
				)
				return {
					success: true,
					data: result,
				}
			} catch (error: any) {
				set.status = 400
				return {
					success: false,
					error: error?.message || 'Failed to preview audience',
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Object({
				filters: t.Optional(t.Any()),
			}),
		},
	)
	.get(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const item = await BroadcastService.getBroadcastById(
				params.id,
				resolvedAppId,
			)

			if (!item) {
				set.status = 404
				return { error: 'Broadcast not found' }
			}

			return { data: item }
		},
		{
			params: t.Object({ id: t.String() }),
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
			const b = await BroadcastService.createBroadcast(resolvedAppId, body)
			return { data: b }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: BroadcastRequestModel.create,
		},
	)
	.post(
		'/:id/send',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const result = await BroadcastService.sendBroadcast(
				params.id,
				resolvedAppId,
			)
			return result
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
