import { Elysia, t } from 'elysia'
import { AgentService } from './service'
import { AgentRequestModel } from './model'
import { appContext } from '../../plugins'
import { requireRole, canGrantRole, CANONICAL_ROLES } from '../../lib/require-role'

export const agent = new Elysia({ tags: ['User'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const agents = await AgentService.getAgents(resolvedAppId, {
				search: query.q,
			})
			return { data: agents }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				q: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, userId, body, set }) => {
			const guard = await requireRole(userId, ['leader', 'ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (
				body.role !== undefined &&
				CANONICAL_ROLES.includes(body.role as (typeof CANONICAL_ROLES)[number]) &&
				!canGrantRole(guard.role, body.role)
			) {
				set.status = 403
				return { error: 'Cannot grant a role higher than your own' }
			}

			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const a = await AgentService.createAgent(resolvedAppId, body)
				return { data: a }
			} catch (error) {
				if (
					error instanceof Error &&
					(error.message === 'Supervisor not found' ||
						error.message === 'One or more divisions are invalid for this app' ||
						error.message === 'Invalid role value')
				) {
					set.status = 400
					return { error: error.message }
				}
				throw error
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AgentRequestModel.create,
		},
	)
	.get('/login-link', async () => {
		return { loginLink: 'https://api.crm.chat/en/login' }
	})
	.patch(
		'/:id',
		async ({ resolvedAppId, userId, params, body, set }) => {
			const guard = await requireRole(userId, ['leader', 'ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (
				body.role !== undefined &&
				CANONICAL_ROLES.includes(body.role as (typeof CANONICAL_ROLES)[number]) &&
				!canGrantRole(guard.role, body.role)
			) {
				set.status = 403
				return { error: 'Cannot grant a role higher than your own' }
			}

			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const a = await AgentService.updateAgent(resolvedAppId, params.id, body)
				return { data: a }
				} catch (error) {
					if (error instanceof Error && error.message === 'Agent not found') {
						set.status = 404
						return { error: 'Agent not found' }
					}
					if (
						error instanceof Error &&
						(error.message === 'Supervisor not found' ||
							error.message ===
								'One or more divisions are invalid for this app' ||
							error.message === 'Invalid role value')
					) {
						set.status = 400
						return { error: error.message }
					}
					throw error
				}
			},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AgentRequestModel.update,
		},
	)
	.put(
		'/:id',
		async ({ resolvedAppId, userId, params, body, set }) => {
			const guard = await requireRole(userId, ['leader', 'ceo', 'superadmin'])
			if (!guard.ok) {
				set.status = guard.status
				return { error: guard.error }
			}
			if (
				body.role !== undefined &&
				CANONICAL_ROLES.includes(body.role as (typeof CANONICAL_ROLES)[number]) &&
				!canGrantRole(guard.role, body.role)
			) {
				set.status = 403
				return { error: 'Cannot grant a role higher than your own' }
			}

			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const a = await AgentService.updateAgent(resolvedAppId, params.id, body)
				return { data: a }
				} catch (error) {
					if (error instanceof Error && error.message === 'Agent not found') {
						set.status = 404
						return { error: 'Agent not found' }
					}
					if (
						error instanceof Error &&
						(error.message === 'Supervisor not found' ||
							error.message ===
								'One or more divisions are invalid for this app' ||
							error.message === 'Invalid role value')
					) {
						set.status = 400
						return { error: error.message }
					}
					throw error
				}
			},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AgentRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params }) => {
			await AgentService.deleteAgent(params.id)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)

	// Divisions
	.get(
		'/divisions',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const divs = await AgentService.getDivisions(resolvedAppId)
			return { data: divs }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/divisions',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const div = await AgentService.createDivision(resolvedAppId, body)
			return { data: div }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Object({
				name: t.String(),
				description: t.Optional(t.String()),
				color: t.Optional(t.String()),
			}),
		},
	)
	.put(
		'/divisions/:id',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const div = await AgentService.updateDivision(
					resolvedAppId,
					params.id,
					body,
				)
				return { data: div }
			} catch (error) {
				if (error instanceof Error && error.message === 'Division not found') {
					set.status = 404
					return { error: 'Division not found' }
				}
				throw error
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Object({
				name: t.Optional(t.String()),
				description: t.Optional(t.String()),
				color: t.Optional(t.String()),
				parent_division_id: t.Optional(t.Union([t.String(), t.Null()])),
			}),
		},
	)
	.delete(
		'/divisions/:id',
		async ({ resolvedAppId, params, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				await AgentService.deleteDivision(resolvedAppId, params.id)
				return { success: true }
			} catch (error) {
				if (error instanceof Error && error.message === 'Division not found') {
					set.status = 404
					return { error: 'Division not found' }
				}
				throw error
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
