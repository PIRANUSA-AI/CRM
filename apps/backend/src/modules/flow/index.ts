import { Elysia, t } from 'elysia'
import { FlowService } from './service'
import { FlowRequestModel } from './model'
import { appContext } from '../../plugins'
import { DecisionEngineService } from './decision-engine-service'

export const flow = new Elysia({ prefix: '/flows', tags: ['Flow'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const flows = await FlowService.getFlows(resolvedAppId)
			return { success: true, payload: flows }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.get(
		'/decision-policy',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const policy = await DecisionEngineService.getPolicy(
				resolvedAppId,
				query.flowId || null,
			)
			return { success: true, payload: policy }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				flowId: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/decision-evaluation',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const summary = await DecisionEngineService.getDecisionEvaluationSummary({
				appId: resolvedAppId,
				flowId: query.flowId || null,
				from: query.from || null,
				to: query.to || null,
				limit: query.limit ? Number(query.limit) : undefined,
			})
			return { success: true, payload: summary }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				flowId: t.Optional(t.String()),
				from: t.Optional(t.String()),
				to: t.Optional(t.String()),
				limit: t.Optional(t.String()),
			}),
		},
	)
	.put(
		'/decision-policy',
		async ({ resolvedAppId, query, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const updated = await DecisionEngineService.upsertPolicy({
				appId: resolvedAppId,
				flowId: query.flowId || null,
				policyPatch:
					body && typeof body === 'object' && !Array.isArray(body)
						? (body as Record<string, unknown>)
						: {},
				active:
					body && typeof body === 'object'
						? (body as Record<string, unknown>).active === false
							? false
							: true
						: true,
			})
			return { success: true, payload: updated }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				flowId: t.Optional(t.String()),
			}),
			body: t.Any(),
		},
	)
	.get(
		'/conversations/:conversationId/ai-signals',
		async ({ params, query, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const signals = await DecisionEngineService.listConversationSignals({
				appId: resolvedAppId,
				conversationId: params.conversationId,
				limit: query.limit ? Number(query.limit) : 80,
			})
			return { success: true, payload: signals }
		},
		{
			params: t.Object({ conversationId: t.String() }),
			query: t.Object({
				appId: t.Optional(t.String()),
				limit: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/default',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const defaultFlow = await FlowService.getDefaultFlow(resolvedAppId)
			return { success: true, payload: defaultFlow }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.get(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const fl = await FlowService.getFlowById(params.id, resolvedAppId)
			if (!fl) return { error: 'Flow not found' }
			return { data: fl }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.get(
		'/:id/executions',
		async ({ params, query, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const fl = await FlowService.getFlowById(params.id, resolvedAppId)
			if (!fl) return { error: 'Flow not found' }
			const executions = await FlowService.getFlowExecutions(
				params.id,
				resolvedAppId,
				query.conversationId,
				query.executionId,
			)
			return { success: true, payload: executions }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				appId: t.Optional(t.String()),
				conversationId: t.Optional(t.String()),
				executionId: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/:id/versions',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const fl = await FlowService.getFlowById(params.id, resolvedAppId)
			if (!fl) return { error: 'Flow not found' }
			const versions = await FlowService.getFlowVersions(
				params.id,
				resolvedAppId,
			)
			return { success: true, payload: versions }
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
			const fl = await FlowService.createFlow(resolvedAppId, body)
			return { data: fl }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: FlowRequestModel.create,
		},
	)
	.post(
		'/:id/test-run',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const fl = await FlowService.getFlowById(params.id, resolvedAppId)
			if (!fl) return { error: 'Flow not found' }
			const requestBody =
				body && typeof body === 'object' && !Array.isArray(body)
					? (body as Record<string, unknown>)
					: {}
			const input = Object.prototype.hasOwnProperty.call(requestBody, 'input')
				? requestBody.input
				: requestBody
			const result = await FlowService.runFlowTest(params.id, resolvedAppId, {
				input,
			})
			return { success: true, payload: result }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Optional(t.Any()),
		},
	)
	.post(
		'/:id/debug-node',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const fl = await FlowService.getFlowById(params.id, resolvedAppId)
			if (!fl) return { error: 'Flow not found' }
			const result = await FlowService.debugNodeRun(
				params.id,
				resolvedAppId,
				body as { nodeId: string; input: Record<string, unknown> },
			)
			return { success: true, payload: result }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Object({
				nodeId: t.String(),
				input: t.Any(),
			}),
		},
	)
	.post(
		'/:id/default',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				const result = await FlowService.setDefaultFlow(
					params.id,
					resolvedAppId,
				)
				return { success: true, payload: result }
			} catch (error) {
				if (
					error instanceof Error &&
					error.message.toLowerCase().includes('flow not found')
				) {
					set.status = 404
					return { success: false, error: 'Flow not found' }
				}
				throw error
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Optional(t.Any()),
		},
	)
	.patch(
		'/:id',
		async ({ params, resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const fl = await FlowService.updateFlow(params.id, resolvedAppId, body)
			return { data: fl }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: FlowRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			await FlowService.deleteFlow(params.id, resolvedAppId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
