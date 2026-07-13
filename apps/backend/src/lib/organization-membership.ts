import type { Prisma } from '../generated/prisma'

type DbClient = Prisma.TransactionClient

type EnsureMembershipParams = {
	userId: string
	appId: string
	role?: string | null
}

function mapAgentRoleToOrgRole(role?: string | null): 'admin' | 'member' {
	return role?.toLowerCase() === 'admin' ? 'admin' : 'member'
}

/**
 * Keep Better Auth organization membership in sync with app-level agents.
 * If app has a linked organization, ensure the user is a member there.
 */
export async function ensureBetterAuthOrganizationMembership(
	tx: DbClient,
	params: EnsureMembershipParams,
) {
	const { userId, appId, role } = params
	if (!userId || !appId) return null

	const organization = await tx.organization.findFirst({
		where: { appId },
		select: { id: true },
	})

	if (!organization) return null

	const targetRole = mapAgentRoleToOrgRole(role)
	const existingMembership = await tx.member.findFirst({
		where: {
			userId,
			organizationId: organization.id,
		},
		select: {
			id: true,
			role: true,
		},
	})

	if (existingMembership) {
		// Never downgrade owner role.
		if (
			existingMembership.role !== 'owner' &&
			existingMembership.role !== targetRole
		) {
			await tx.member.update({
				where: { id: existingMembership.id },
				data: { role: targetRole },
			})
		}
		return {
			organizationId: organization.id,
			memberId: existingMembership.id,
			created: false,
		}
	}

	const membership = await tx.member.create({
		data: {
			id: crypto.randomUUID(),
			organizationId: organization.id,
			userId,
			role: targetRole,
		},
		select: { id: true },
	})

	return {
		organizationId: organization.id,
		memberId: membership.id,
		created: true,
	}
}
