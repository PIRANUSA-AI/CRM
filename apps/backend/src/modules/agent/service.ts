import bcrypt from 'bcryptjs'
import { syncBetterAuthCredentialAccount } from '../../lib/better-auth-credentials'
import type { Prisma } from '../../generated/prisma'
import { ensureBetterAuthOrganizationMembership } from '../../lib/organization-membership'
import { generateStrongPassword } from '../../lib/generate-password'
import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'
import { CANONICAL_ROLES } from '../../lib/require-role'

type DbTx = Prisma.TransactionClient

function isValidAgentRole(role: unknown): boolean {
	return CANONICAL_ROLES.includes(role as (typeof CANONICAL_ROLES)[number])
}

export abstract class AgentService {
	private static async ensureSupervisorForApp(
		tx: DbTx,
		targetAppId: string,
		supervisorId: string | null | undefined,
	) {
		if (supervisorId === undefined) return undefined
		if (supervisorId === null) return null

		const normalizedSupervisorId = supervisorId.trim()
		if (!normalizedSupervisorId) return null

		const isUuid =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
				normalizedSupervisorId,
			)
		if (!isUuid) {
			throw new Error('Supervisor not found')
		}

		const supervisor = await tx.users.findFirst({
			where: {
				id: normalizedSupervisorId,
				app_id: targetAppId,
				active: true,
			},
			select: { id: true },
		})

		if (!supervisor) {
			throw new Error('Supervisor not found')
		}

		return normalizedSupervisorId
	}

	private static async ensureDivisionIdsForApp(
		tx: DbTx,
		targetAppId: string,
		divisionIds: string[] | undefined,
	) {
		if (divisionIds === undefined) return undefined

		const uniqueDivisionIds = Array.from(new Set(divisionIds.filter(Boolean)))
		if (uniqueDivisionIds.length === 0) return []

		const validDivisions = await tx.divisions.findMany({
			where: {
				id: { in: uniqueDivisionIds },
				app_id: targetAppId,
			},
			select: { id: true },
		})

		if (validDivisions.length !== uniqueDivisionIds.length) {
			throw new Error('One or more divisions are invalid for this app')
		}

		return uniqueDivisionIds
	}

	private static async normalizeAgentChannelTypes(
		tx: DbTx,
		targetAppId: string,
		channels: string[] | undefined,
	) {
		if (channels === undefined) return undefined

		const uniqueChannels = Array.from(new Set(channels.filter(Boolean)))
		if (uniqueChannels.length === 0) return []

		const inboxRows = await tx.inboxes.findMany({
			where: {
				id: { in: uniqueChannels },
				app_id: targetAppId,
				channel_type: { not: null },
			},
			select: {
				id: true,
				channel_type: true,
			},
		})

		const channelTypeByInboxId = new Map(
			inboxRows.map((row) => [row.id, row.channel_type || '']),
		)

		return Array.from(
			new Set(
				uniqueChannels
					.map((value) => channelTypeByInboxId.get(value) || value)
					.filter(Boolean),
			),
		)
	}

	static async getAgents(appId: string, filter: any = {}) {
		const targetAppId = await resolveAppId(appId)

		const agents = await prisma.users.findMany({
			where: {
				app_id: targetAppId || undefined,
				active: true,
				OR: filter.search
					? [
							{ name: { contains: filter.search, mode: 'insensitive' } },
							{ email: { contains: filter.search, mode: 'insensitive' } },
						]
					: undefined,
			},
			select: {
				id: true,
				name: true,
				email: true,
				phone_number: true,
				role: true,
				status: true,
				is_available: true,
				supervisor_id: true,
			},
		})

		if (agents.length === 0) return []

		const agentIds = agents.map((agent) => agent.id)
		const supervisorIds = Array.from(
			new Set(
				agents
					.map((agent) => agent.supervisor_id)
					.filter((id): id is string => Boolean(id)),
			),
		)

		const [divisionRows, channelRows, supervisorRows] = await Promise.all([
			prisma.agent_divisions.findMany({
				where: { user_id: { in: agentIds } },
				select: {
					user_id: true,
					divisions: {
						select: {
							id: true,
							name: true,
							color: true,
						},
					},
				},
			}),
			prisma.agent_channels.findMany({
				where: { user_id: { in: agentIds } },
				select: {
					user_id: true,
					channel_type: true,
				},
			}),
			supervisorIds.length > 0
				? prisma.users.findMany({
						where: {
							id: { in: supervisorIds },
							app_id: targetAppId || undefined,
							active: true,
						},
						select: {
							id: true,
							name: true,
						},
					})
				: Promise.resolve([]),
		])

		const divisionsByUserId = new Map<
			string,
			Array<{ id: string; name: string; color: string | null }>
		>()
		for (const row of divisionRows) {
			const list = divisionsByUserId.get(row.user_id) || []
			list.push({
				id: row.divisions.id,
				name: row.divisions.name,
				color: row.divisions.color,
			})
			divisionsByUserId.set(row.user_id, list)
		}

		const channelsByUserId = new Map<string, string[]>()
		for (const row of channelRows) {
			const list = channelsByUserId.get(row.user_id) || []
			list.push(row.channel_type)
			channelsByUserId.set(row.user_id, list)
		}

		const supervisorById = new Map<string, { id: string; name: string }>()
		for (const supervisor of supervisorRows) {
			supervisorById.set(supervisor.id, {
				id: supervisor.id,
				name: supervisor.name,
			})
		}

		return agents.map((agent) => ({
			id: agent.id,
			name: agent.name,
			email: agent.email,
			phone_number: agent.phone_number,
			role: agent.role,
			status: agent.status,
			is_available: agent.is_available,
			divisions:
				(divisionsByUserId.get(agent.id) || []).map((division) => ({
					id: division.id,
					name: division.name,
					color: division.color || '#3B82F6',
				})) || [],
			channels: channelsByUserId.get(agent.id) || [],
			supervisor: agent.supervisor_id
				? supervisorById.get(agent.supervisor_id) || undefined
				: undefined,
		}))
	}

	static async createAgent(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')
		if (data.role !== undefined && !isValidAgentRole(data.role)) {
			throw new Error('Invalid role value')
		}
		const normalizedEmail = String(data.email || '')
			.trim()
			.toLowerCase()
		const plainPassword = data.password || generateStrongPassword()
		const passwordHash = await bcrypt.hash(plainPassword, 10)

		const createdAgent = await prisma.$transaction(async (tx) => {
			const supervisorId = await AgentService.ensureSupervisorForApp(
				tx,
				targetAppId,
				data.supervisor_id,
			)
			const divisionIds = await AgentService.ensureDivisionIdsForApp(
				tx,
				targetAppId,
				data.divisions,
			)
			const channelTypes = await AgentService.normalizeAgentChannelTypes(
				tx,
				targetAppId,
				data.channels,
			)

			const agent = await tx.users.create({
				data: {
					app_id: targetAppId,
					name: data.name,
					email: normalizedEmail,
					password: passwordHash,
					phone_number: data.phone_number,
					role: data.role || 'sales',
					...(supervisorId !== undefined ? { supervisor_id: supervisorId } : {}),
				},
			})

			await syncBetterAuthCredentialAccount(tx, {
				userId: agent.id,
				password: plainPassword,
			})

			await ensureBetterAuthOrganizationMembership(tx, {
				userId: agent.id,
				appId: targetAppId,
				role: agent.role,
			})

			if (divisionIds && divisionIds.length > 0) {
				await tx.agent_divisions.createMany({
					data: divisionIds.map((divisionId) => ({
						user_id: agent.id,
						division_id: divisionId,
					})),
					skipDuplicates: true,
				})
			}

			if (channelTypes && channelTypes.length > 0) {
				await tx.agent_channels.createMany({
					data: channelTypes.map((channelType) => ({
						user_id: agent.id,
						channel_type: channelType,
					})),
					skipDuplicates: true,
				})
			}

			return agent
		})

		return {
			...createdAgent,
			...(data.password ? {} : { generatedPassword: plainPassword }),
		}
	}

	static async updateAgent(appId: string, id: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		const existingAgent = await prisma.users.findFirst({
			where: {
				id,
				app_id: targetAppId,
			},
			select: { id: true },
		})

		if (!existingAgent) {
			throw new Error('Agent not found')
		}

		if (data.role !== undefined && !isValidAgentRole(data.role)) {
			throw new Error('Invalid role value')
		}

		const {
			divisions,
			channels,
			password,
			name,
			email,
			phone_number,
			role,
			status,
			is_available,
			active,
			supervisor_id,
		} = data

		const updateData: Record<string, unknown> = {
			updated_at: new Date(),
		}

		if (name !== undefined) updateData.name = name
		if (email !== undefined) updateData.email = String(email).trim().toLowerCase()
		if (phone_number !== undefined) updateData.phone_number = phone_number
		if (role !== undefined) updateData.role = role
		if (status !== undefined) updateData.status = status
		if (is_available !== undefined) updateData.is_available = is_available
		if (active !== undefined) updateData.active = active
		if (password) {
			updateData.password = await bcrypt.hash(password, 10)
		}

		return prisma.$transaction(async (tx) => {
			const resolvedSupervisorId = await AgentService.ensureSupervisorForApp(
				tx,
				targetAppId,
				supervisor_id,
			)
			if (resolvedSupervisorId !== undefined) {
				updateData.supervisor_id = resolvedSupervisorId
			}

				const updatedAgent = await tx.users.update({
					where: { id },
					data: updateData,
				})

				await ensureBetterAuthOrganizationMembership(tx, {
					userId: updatedAgent.id,
					appId: targetAppId,
					role: updatedAgent.role,
				})

			if (password) {
				await syncBetterAuthCredentialAccount(tx, {
					userId: id,
					password,
				})
			}

			if (divisions !== undefined) {
				const uniqueDivisionIds = await AgentService.ensureDivisionIdsForApp(
					tx,
					targetAppId,
					divisions as string[],
				)

				await tx.agent_divisions.deleteMany({
					where: { user_id: id },
				})

				if (uniqueDivisionIds && uniqueDivisionIds.length > 0) {
					await tx.agent_divisions.createMany({
						data: uniqueDivisionIds.map((divisionId) => ({
							user_id: id,
							division_id: divisionId,
						})),
						skipDuplicates: true,
					})
				}
			}

			if (channels !== undefined) {
				const uniqueChannels = await AgentService.normalizeAgentChannelTypes(
					tx,
					targetAppId,
					channels as string[],
				)

				await tx.agent_channels.deleteMany({
					where: { user_id: id },
				})

				if (uniqueChannels && uniqueChannels.length > 0) {
					await tx.agent_channels.createMany({
						data: uniqueChannels.map((channelType) => ({
							user_id: id,
							channel_type: channelType,
						})),
						skipDuplicates: true,
					})
				}
			}

			return updatedAgent
		})
	}

	static async deleteAgent(id: string) {
		return prisma.users.update({
			where: { id },
			data: { active: false },
		})
	}

	// Divisions
	static async getDivisions(appId: string) {
		const targetAppId = await resolveAppId(appId)

		return prisma.divisions.findMany({
			where: { app_id: targetAppId || undefined },
		})
	}

	static async createDivision(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		return prisma.divisions.create({
			data: {
				app_id: targetAppId,
				name: data.name,
				description: data.description,
				color: data.color,
			},
		})
	}

	static async updateDivision(appId: string, id: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		const existingDivision = await prisma.divisions.findFirst({
			where: {
				id,
				app_id: targetAppId,
			},
			select: { id: true },
		})

		if (!existingDivision) {
			throw new Error('Division not found')
		}

		return prisma.divisions.update({
			where: { id },
			data: {
				...(data.name !== undefined ? { name: data.name } : {}),
				...(data.description !== undefined
					? { description: data.description }
					: {}),
				...(data.color !== undefined ? { color: data.color } : {}),
				...(data.parent_division_id !== undefined
					? { parent_division_id: data.parent_division_id }
					: {}),
				updated_at: new Date(),
			},
		})
	}

	static async deleteDivision(appId: string, id: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('Invalid App ID')

		const existingDivision = await prisma.divisions.findFirst({
			where: {
				id,
				app_id: targetAppId,
			},
			select: { id: true },
		})

		if (!existingDivision) {
			throw new Error('Division not found')
		}

		await prisma.divisions.delete({
			where: { id },
		})
	}
}
