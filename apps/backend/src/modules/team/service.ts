// @ts-nocheck
import prisma from '../../lib/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'

export abstract class TeamService {
	static async getTeams(accountId: string) {
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) return []

		const teams = await prisma.teams.findMany({
			where: { app_id: targetAppId },
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

	static async getTeamById(id: string, accountId: string) {
		if (!isUuid(id)) return null
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) return null

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

	static async updateTeam(id: string, accountId: string, data: any) {
		if (!isUuid(id)) throw new Error('Invalid Team ID')
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) throw new Error('Invalid App ID')

		return prisma.teams.update({
			where: { id, app_id: targetAppId },
			data: {
				...data,
				updated_at: new Date(),
			},
		})
	}

	static async deleteTeam(id: string, accountId: string) {
		if (!isUuid(id)) throw new Error('Invalid Team ID')
		const targetAppId = await resolveAppId(accountId)
		if (!targetAppId) throw new Error('Invalid App ID')

		return prisma.teams.delete({
			where: { id, app_id: targetAppId },
		})
	}

	static async addMember(teamId: string, userId: string) {
		if (!isUuid(teamId) || !userId) throw new Error('Invalid IDs')

		return prisma.team_members.create({
			data: {
				team_id: teamId,
				user_id: userId,
			},
		})
	}

	static async removeMember(teamId: string, userId: string) {
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
