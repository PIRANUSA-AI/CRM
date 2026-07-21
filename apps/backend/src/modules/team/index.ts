import { Elysia, t } from 'elysia'
import prisma from '../../lib/prisma'
import { TeamService, visibleTeamIds } from './service'
import { TeamModel, TeamRequestModel } from './model'
import { appContext } from '../../plugins'
import { ROLE_RANK, isMultiTeamRole, type CanonicalRole } from '../../lib/require-role'

/**
 * The caller's team scope. Every handler here used to take an app id alone,
 * so Kelola Tim showed a leader every team in the company and let them edit
 * teams that were not theirs.
 */
async function scopeFor(userId: string | null | undefined, appId: string) {
	const user = userId
		? await prisma.users.findFirst({
				where: { id: userId, app_id: appId, deleted_at: null },
				select: { role: true },
			})
		: null
	return {
		role: user?.role ?? null,
		allowedTeamIds: await visibleTeamIds(userId, user?.role),
	}
}

/**
 * Team settings are a supervisor's job. Scoping alone was not enough: a sales
 * belongs to a team, so "their team is in scope" let them rename it and change
 * its opportunity threshold through the API. Kelola Tim is not in their sidebar,
 * which hid the hole rather than closing it.
 */
function canManageTeams(role: string | null | undefined): boolean {
	const rank = ROLE_RANK[String(role || '').toLowerCase() as CanonicalRole]
	return rank !== undefined && rank >= ROLE_RANK.leader
}

export const team = new Elysia({ prefix: '/teams', tags: ['Team'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const { allowedTeamIds } = await scopeFor(userId, resolvedAppId)
			const teams = await TeamService.getTeams(resolvedAppId, allowedTeamIds)
			return { data: teams }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
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
			const { allowedTeamIds } = await scopeFor(userId, resolvedAppId)
			const t = await TeamService.getTeamById(params.id, resolvedAppId, allowedTeamIds)
			if (!t) {
				set.status = 404
				return { error: 'Team not found' }
			}
			return { data: t }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/',
		async ({ resolvedAppId, userId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			// Creating a team is staffing, which belongs to the administrator tier:
			// a team a leader made for themselves is not a team they were given.
			const { role } = await scopeFor(userId, resolvedAppId)
			if (!isMultiTeamRole(role)) {
				set.status = 403
				return { error: 'Hanya administrator yang boleh membuat tim' }
			}
			const t = await TeamService.createTeam(resolvedAppId, body)
			return { data: t }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
			}),
			body: TeamRequestModel.create,
		},
	)
	.patch(
		'/:id',
		async ({ params, resolvedAppId, userId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const { role, allowedTeamIds } = await scopeFor(userId, resolvedAppId)
			if (!canManageTeams(role)) {
				set.status = 403
				return { error: 'Tidak berhak mengubah pengaturan tim' }
			}
			try {
				const t = await TeamService.updateTeam(params.id, resolvedAppId, body, allowedTeamIds)
				return { data: t }
			} catch (error) {
				set.status = 403
				return { error: error instanceof Error ? error.message : 'Gagal memperbarui tim' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
			}),
			body: TeamRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const { role } = await scopeFor(userId, resolvedAppId)
			if (!isMultiTeamRole(role)) {
				set.status = 403
				return { error: 'Hanya administrator yang boleh menghapus tim' }
			}
			await TeamService.deleteTeam(params.id, resolvedAppId)
			return { success: true }
		},
		{
			params: t.Object({ id: t.String() }),
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/:id/members',
		async ({ params, body, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const { role, allowedTeamIds } = await scopeFor(userId, resolvedAppId)
			if (!canManageTeams(role)) {
				set.status = 403
				return { error: 'Tidak berhak mengubah anggota tim' }
			}
			try {
				const member = await TeamService.addMember(params.id, body.userId, allowedTeamIds)
				return { data: member }
			} catch (error) {
				set.status = 403
				return { error: error instanceof Error ? error.message : 'Gagal menambah anggota' }
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({ userId: t.String() }),
		},
	)
	.delete(
		'/:id/members/:userId',
		async ({ params, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const { role, allowedTeamIds } = await scopeFor(userId, resolvedAppId)
			if (!canManageTeams(role)) {
				set.status = 403
				return { error: 'Tidak berhak mengubah anggota tim' }
			}
			try {
				await TeamService.removeMember(params.id, params.userId, allowedTeamIds)
				return { success: true }
			} catch (error) {
				set.status = 403
				return { error: error instanceof Error ? error.message : 'Gagal menghapus anggota' }
			}
		},
		{
			params: t.Object({ id: t.String(), userId: t.String() }),
		},
	)
