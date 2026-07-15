// Simulation seeder: 3 sales (Deska, Yoel, Fathur) + 1 team under the leader.
// Idempotent. Password for all = "123" (override with SIM_PASSWORD).
import prisma from '../src/lib/prisma'
import { syncBetterAuthCredentialAccount } from '../src/lib/better-auth-credentials'

const PASSWORD = process.env.SIM_PASSWORD || '123'
const TEAM_NAME = 'Tim Sales'

// Sales for the simulation. Deska already exists (kept), Yoel & Fathur are new.
const SALES = [
	{ name: 'Deska', email: 'deska@piranusa.com' },
	{ name: 'Yoel', email: 'yoel@piranusa.com' },
	{ name: 'Fathur', email: 'fathur@piranusa.com' },
]
const LEADER_EMAIL = 'benny@piranusa.com'

async function ensureUser(
	name: string,
	email: string,
	role: 'sales' | 'leader',
	appId: string,
	orgId: string,
) {
	const normalized = email.trim().toLowerCase()
	const existing = await prisma.users.findUnique({ where: { email: normalized } })
	if (existing) {
		await syncBetterAuthCredentialAccount(prisma, { userId: existing.id, password: PASSWORD })
		console.log(`reset password: ${normalized} (${existing.role})`)
		return existing
	}
	const created = await prisma.$transaction(async (tx) => {
		const user = await tx.users.create({
			data: { name, email: normalized, role, app_id: appId, emailVerified: true, active: true },
		})
		await syncBetterAuthCredentialAccount(tx, { userId: user.id, password: PASSWORD })
		await tx.member.create({
			data: {
				id: crypto.randomUUID(),
				organizationId: orgId,
				userId: user.id,
				role: role === 'leader' ? 'admin' : 'member',
			},
		})
		return user
	})
	console.log(`created: ${normalized} (${role})`)
	return created
}

async function main() {
	const app = await prisma.apps.findFirst({ select: { id: true } })
	const org = await prisma.organization.findFirst({ select: { id: true } })
	if (!app || !org) throw new Error('App/organization missing')

	const leader = await prisma.users.findUnique({ where: { email: LEADER_EMAIL } })
	if (!leader) throw new Error(`Leader ${LEADER_EMAIL} not found — run db:seed:dev-users first`)
	await syncBetterAuthCredentialAccount(prisma, { userId: leader.id, password: PASSWORD })
	console.log(`reset password: ${LEADER_EMAIL} (leader)`)

	const salesUsers = []
	for (const s of SALES) {
		salesUsers.push(await ensureUser(s.name, s.email, 'sales', app.id, org.id))
	}

	// Ensure one team, with leader + the 3 sales as members.
	let team = await prisma.teams.findFirst({ where: { app_id: app.id, name: TEAM_NAME, deleted_at: null } })
	if (!team) {
		team = await prisma.teams.create({
			data: { app_id: app.id, name: TEAM_NAME, description: 'Tim simulasi sales', allow_auto_assign: true },
		})
		console.log(`created team: ${TEAM_NAME} (${team.id})`)
	} else {
		console.log(`team exists: ${TEAM_NAME} (${team.id})`)
	}

	const memberIds = [leader.id, ...salesUsers.map((u) => u.id)]
	await prisma.team_members.createMany({
		data: memberIds.map((user_id) => ({ team_id: team!.id, user_id })),
		skipDuplicates: true,
	})
	console.log(`team_members ensured: ${memberIds.length} (leader + ${salesUsers.length} sales)`)

	console.log(`\nDone. Password semua akun: ${PASSWORD}`)
	console.log('Sales login: deska@piranusa.com, yoel@piranusa.com, fathur@piranusa.com')
	console.log('Leader login: benny@piranusa.com')
}

main()
	.catch((error) => { console.error(error); process.exit(1) })
	.finally(() => prisma.$disconnect())
