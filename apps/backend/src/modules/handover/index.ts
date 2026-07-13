import { Elysia, t } from 'elysia'
import { HandoverService } from './service'
import { appContext } from '../../plugins'

export const handover = new Elysia({
	prefix: '/handover',
	tags: ['Handover'],
})
	.use(appContext)

	.get(
		'/queue',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			const queue = await HandoverService.getQueue(resolvedAppId)
			return { success: true, payload: queue }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)

	.get(
		'/rules',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			const rules = await HandoverService.getRules(resolvedAppId)
			return { success: true, payload: rules }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)

	.get(
		'/roster',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			const roster = await HandoverService.getRoster(resolvedAppId)
			return { success: true, payload: roster }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)

	.get(
		'/logs',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			const logs = await HandoverService.getLogs(resolvedAppId, {
				conversationId: query.conversationId,
				limit: query.limit ? parseInt(query.limit) : 100,
				period: query.period,
			})
			return { success: true, payload: logs }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				conversationId: t.Optional(t.String()),
				limit: t.Optional(t.String()),
				period: t.Optional(t.String()),
			}),
		},
	)

	.get(
		'/analytics',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			const analytics = await HandoverService.getAnalytics(
				resolvedAppId,
				query.period || '24h',
			)
			return { success: true, payload: analytics }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				period: t.Optional(t.String()),
			}),
		},
	)

	.post(
		'/requests',
		async ({ resolvedAppId, body, userId, store, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}

			const userObj = (store as any)?.user as { id?: string; role?: string } | undefined
			const userRole = userObj?.role || 'sales'
			const requestedBy = userId || userObj?.id || (body as any).requestedBy

			if (!requestedBy) {
				set.status = 401
				return { success: false, error: 'User not authenticated' }
			}

			try {
				const result = await HandoverService.createRequest(resolvedAppId, {
					conversationId: (body as any).conversationId,
					requestType: (body as any).requestType || 'take',
					requestedBy,
					targetAgentId: (body as any).targetAgentId,
					requestNote: (body as any).requestNote,
					sourceRuleId: (body as any).sourceRuleId,
				}, userRole)

				return {
					success: true,
					payload: result.request,
					autoApproved: result.autoApproved,
				}
			} catch (error: any) {
				set.status = 400
				return { success: false, error: error.message || 'Failed to create request' }
			}
		},
		{
			body: t.Object({
				conversationId: t.String(),
				requestType: t.Optional(t.Union([t.Literal('take'), t.Literal('reassign')])),
				targetAgentId: t.Optional(t.String()),
				requestNote: t.Optional(t.String()),
				sourceRuleId: t.Optional(t.String()),
			}),
		},
	)

	.post(
		'/requests/:id/approve',
		async ({ params, body, userId, set }) => {
			if (!userId) {
				set.status = 401
				return { success: false, error: 'User not authenticated' }
			}

			try {
				const result = await HandoverService.approveRequest(
					params.id,
					userId,
					(body as any).approvalNote,
				)
				return { success: true, payload: result }
			} catch (error: any) {
				set.status = 400
				return { success: false, error: error.message || 'Failed to approve request' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				approvalNote: t.Optional(t.String()),
			}),
		},
	)

	.post(
		'/requests/:id/reject',
		async ({ params, body, userId, set }) => {
			if (!userId) {
				set.status = 401
				return { success: false, error: 'User not authenticated' }
			}

			try {
				const result = await HandoverService.rejectRequest(
					params.id,
					userId,
					(body as any).rejectionNote,
				)
				return { success: true, payload: result }
			} catch (error: any) {
				set.status = 400
				return { success: false, error: error.message || 'Failed to reject request' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				rejectionNote: t.Optional(t.String()),
			}),
		},
	)

	.get(
		'/requests/:id/status',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const status = await HandoverService.getRequestStatus(
					resolvedAppId,
					params.id,
				)
				return { success: true, payload: status }
			} catch (error: any) {
				set.status = 400
				return {
					success: false,
					error: error.message || 'Failed to get request status',
				}
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)

	.post(
		'/escalations/run',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const result = await HandoverService.runEscalationSweep(resolvedAppId)
				return { success: true, payload: result }
			} catch (error: any) {
				set.status = 400
				return {
					success: false,
					error: error.message || 'Failed to run escalation sweep',
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)

	.get(
		'/conversation/:conversationId/logs',
		async ({ params }) => {
			const logs = await HandoverService.getLogs('', {
				conversationId: params.conversationId,
				limit: 50,
			})
			return { success: true, payload: logs }
		},
		{
			params: t.Object({ conversationId: t.String() }),
		},
	)
