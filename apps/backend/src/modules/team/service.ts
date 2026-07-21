// @ts-nocheck
import prisma from '../../lib/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'
import { isMultiTeamRole } from '../../lib/require-role'

/**
 * Which teams a caller may see and touch.
 *
 * Returns null for "no restriction" (the administrator tier and above, who
 * oversee every team) and an id list otherwise. A leader runs one team and had
 * no scoping here at all: every handler took only an app id, so Kelola Tim
 * handed a leader the whole company and let them edit teams that were not
 * theirs.
 *
 * A leader in no team gets an empty list, which fails closed to nothing rather
 * than falling through to everything.
 */
export async function visibleTeamIds(
	userId: string | null | undefined,
	role: string | null | undefined,
): Promise<string[] | null> {
	if (isMultiTeamRole(role)) return null
	if (!userId) return []
	const memberships = await prisma.team_members.findMany({
		where: { user_id: userId },
		select: { team_id: true },
	})
	return memberships.map((row) => row.team_id)
}

export abstract class TeamService {
	static async getTeams(accountId: string, allowedTeamIds?: string[] | null) {
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) return []
		if (allowedTeamIds && allowedTeamIds.length === 0) return []

		const teams = await prisma.teams.findMany({
			where: {
				app_id: targetAppId,
				...(allowedTeamIds ? { id: { in: allowedTeamIds } } : {}),
			},
			include: {
				team_members: true,
			},
		})

		const userIds = teams.flatMap(t => t.team_members.map(m => m.user_id))
		const users = await prisma.users.findMany({
			where: { id: { in: userIds } },
			select: { id: true, name: true, avatar_url: true }
		})

		return teams.map(t => ({
			...t,
			team_members: t.team_members.map(m => ({
				...m,
				users: users.find(u => u.id === m.user_id)
			}))
		}))
	}

	static async getTeamById(id: string, accountId: string, allowedTeamIds?: string[] | null) {
		if (!isUuid(id)) return null
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) return null
		// Out of scope reads as "not found" rather than "forbidden": telling a
		// leader a team exists but is not theirs answers a question about rows
		// they are not allowed to know about.
		if (allowedTeamIds && !allowedTeamIds.includes(id)) return null

		const team = await prisma.teams.findFirst({
			where: { id, app_id: targetAppId },
			include: {
				team_members: true,
			},
		})

		if (!team) return null

		const userIds = team.team_members.map(m => m.user_id)
		const users = await prisma.users.findMany({
			where: { id: { in: userIds } },
			select: { id: true, name: true, avatar_url: true }
		})

		return {
			...team,
			team_members: team.team_members.map(m => ({
				...m,
				users: users.find(u => u.id === m.user_id)
			}))
		}
	}

	static async createTeam(accountId: string, data: any) {
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) throw new Error('Invalid App ID')

		return prisma.teams.create({
			data: {
				...data,
				app_id: targetAppId,
			},
		})
	}

	static async updateTeam(id: string, accountId: string, data: any, allowedTeamIds?: string[] | null) {
		if (!isUuid(id)) throw new Error('Invalid Team ID')
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) throw new Error('Invalid App ID')
		if (allowedTeamIds && !allowedTeamIds.includes(id)) throw new Error('Tim di luar scope Anda')

		return prisma.teams.update({
			where: { id, app_id: targetAppId },
			data: {
				...data,
				updated_at: new Date(),
			},
		})
	}

	static async deleteTeam(id: string, accountId: string, allowedTeamIds?: string[] | null) {
		if (!isUuid(id)) throw new Error('Invalid Team ID')
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) throw new Error('Invalid App ID')
		if (allowedTeamIds && !allowedTeamIds.includes(id)) throw new Error('Tim di luar scope Anda')

		return prisma.teams.delete({
			where: { id, app_id: targetAppId },
		})
	}

	static async addMember(teamId: string, userId: string, allowedTeamIds?: string[] | null) {
		if (!isUuid(teamId) || !userId) throw new Error('Invalid IDs')
		if (allowedTeamIds && !allowedTeamIds.includes(teamId)) throw new Error('Tim di luar scope Anda')

		return prisma.team_members.create({
			data: {
				team_id: teamId,
				user_id: userId,
			},
		})
	}

	static async removeMember(teamId: string, userId: string, allowedTeamIds?: string[] | null) {
		if (allowedTeamIds && !allowedTeamIds.includes(teamId)) throw new Error('Tim di luar scope Anda')
		if (!isUuid(teamId) || !userId) throw new Error('Invalid IDs')

		return prisma.team_members.delete({
			where: {
				team_id_user_id: {
					team_id: teamId,
					user_id: userId,
				},
			},
		})
	}
}
