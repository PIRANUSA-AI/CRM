// Simulation seeder: 3 sales (Deska, Yoel, Fathur) placed in the real product
// teams under the leader. Idempotent. Password for all = "123" (override with
// SIM_PASSWORD).
import prisma from '../src/lib/prisma'
import { syncBetterAuthCredentialAccount } from '../src/lib/better-auth-credentials'

const PASSWORD = process.env.SIM_PASSWORD || '123'

// The business is split by product line, not by a single catch-all sales team:
// AEC sells Archicad, MFG sells ZWCAD. This seeder used to create its own "Tim
// Sales" alongside them, which left a third team that routing and the leader's
// task scope had to work around; it was deleted on 2026-07-20. Seed into the
// real teams instead so re-running this never resurrects it.
const SALES = [
	{ name: 'Deska', email: 'deska@piranusa.com', team: 'AEC' },
	{ name: 'Yoel', email: 'yoel@piranusa.com', team: 'MFG' },
	{ name: 'Fathur', email: 'fathur@piranusa.com', team: 'MFG' },
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
		const user = await ensureUser(s.name, s.email, 'sales', app.id, org.id)
		salesUsers.push({ ...s, id: user.id })
	}

	// Put each sales in their product team, and the leader in both — the leader
	// has to be a member of every team they oversee for routing to resolve the
	// team at all. Teams are expected to exist already; this seeder no longer
	// creates them, so a missing one is a real setup problem worth failing on.
	const memberships: Array<{ team_id: string; user_id: string }> = []
	for (const teamName of ['AEC', 'MFG']) {
		const team = await prisma.teams.findFirst({
			where: { app_id: app.id, name: teamName, deleted_at: null },
		})
		if (!team) throw new Error(`Team ${teamName} not found — create it in Kelola Tim first`)
		memberships.push({ team_id: team.id, user_id: leader.id })
		for (const s of salesUsers.filter((u) => u.team === teamName)) {
			memberships.push({ team_id: team.id, user_id: s.id })
		}
		console.log(`team: ${teamName} (${team.id})`)
	}

	await prisma.team_members.createMany({ data: memberships, skipDuplicates: true })
	console.log(`team_members ensured: ${memberships.length}`)

	console.log(`\nDone. Password semua akun: ${PASSWORD}`)
	console.log('Sales login: deska@piranusa.com, yoel@piranusa.com, fathur@piranusa.com')
	console.log('Leader login: benny@piranusa.com')
}

main()
	.catch((error) => { console.error(error); process.exit(1) })
	.finally(() => prisma.$disconnect())
