import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import prisma from '../../lib/prisma'
import { CompanyService } from './service'
import { resolveSalesRowScope } from '../customer'

/**
 * Resolve the viewer once for every company read. Shares
 * `resolveSalesRowScope` with the customer module so the fail-closed rule (a
 * userId that no longer resolves to a user is blocked, not silently widened)
 * has one definition rather than a copy that can drift.
 */
async function resolveViewer(userId: string | null | undefined) {
	const viewer = userId
		? await prisma.users.findUnique({ where: { id: userId }, select: { role: true } })
		: null
	const scope = resolveSalesRowScope(userId, viewer)
	if (scope.blocked) return { blocked: true as const }

	// Only a leader needs their teams resolved; a sales is scoped by owner and
	// the administrator tier is not scoped at all.
	const viewerTeamIds =
		scope.viewerRole === 'leader' && userId
			? (
					await prisma.team_members.findMany({
						where: { user_id: userId },
						select: { team_id: true },
					})
				).map((row) => row.team_id)
			: undefined

	return {
		blocked: false as const,
		viewerRole: scope.viewerRole ?? undefined,
		viewerUserId: userId ?? undefined,
		viewerTeamIds,
	}
}

export const company = new Elysia({ prefix: '/companies', tags: ['Company'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, query, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const viewer = await resolveViewer(userId)
			if (viewer.blocked) {
				set.status = 403
				return { error: 'Not authorized' }
			}

			const result = await CompanyService.listCompanies({
				appId: resolvedAppId,
				search: query.search || query.q,
				page: query.page ? parseInt(query.page, 10) : 1,
				perPage: query.per_page ? parseInt(query.per_page, 10) : 20,
				viewerRole: viewer.viewerRole,
				viewerUserId: viewer.viewerUserId,
				viewerTeamIds: viewer.viewerTeamIds,
			})

			return { success: true, payload: result.payload, meta: result.meta }
		},
		{
			query: t.Object({
				page: t.Optional(t.String()),
				per_page: t.Optional(t.String()),
				search: t.Optional(t.String()),
				q: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/:id',
		async ({ params, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const viewer = await resolveViewer(userId)
			if (viewer.blocked) {
				set.status = 403
				return { error: 'Not authorized' }
			}

			const result = await CompanyService.getCompanyById(params.id, {
				appId: resolvedAppId,
				viewerRole: viewer.viewerRole,
				viewerUserId: viewer.viewerUserId,
				viewerTeamIds: viewer.viewerTeamIds,
			})

			// Also the answer when the company exists but none of its contacts are
			// the viewer's — see the note on getCompanyById.
			if (!result) {
				set.status = 404
				return { error: 'Company not found' }
			}

			return { success: true, payload: result }
		},
		{ params: t.Object({ id: t.String() }) },
	)
