/**
 * Set up the org structure introduced with the administrator role.
 *
 *   administrator : Benny, oversees every team, hands leads out
 *   leader        : Reza (AEC), Adi (MFG). Each runs one team and sells
 *   sales         : unchanged, in the team they already belong to
 *
 * Idempotent: re-running promotes/creates nothing that already matches, so it
 * is safe to run again after adding a team. Passwords for accounts it creates
 * default to "123", override with SIM_PASSWORD.
 */
import prisma from '../src/lib/prisma'
import { syncBetterAuthCredentialAccount } from '../src/lib/better-auth-credentials'

const PASSWORD = process.env.SIM_PASSWORD || '123'

const ADMINISTRATOR_EMAIL = 'benny@piranusa.com'

// One leader per team. Adding a team later means adding a line here (or doing
// it through Kelola Tim, which is the point of the administrator role).
const LEADERS = [
	{ name: 'Reza', email: 'reza@piranusa.com', team: 'AEC' },
	{ name: 'Adi', email: 'adi@piranusa.com', team: 'MFG' },
]

async function ensureUser(
	name: string,
	email: string,
	role: string,
	appId: string,
	orgId: string,
) {
	const normalized = email.trim().toLowerCase()
	const existing = await prisma.users.findUnique({ where: { email: normalized } })
	if (existing) {
		if (existing.role !== role) {
			await prisma.users.update({ where: { id: existing.id }, data: { role } })
			console.log(`role: ${normalized} ${existing.role} -> ${role}`)
		} else {
			console.log(`role sudah benar: ${normalized} (${role})`)
		}
		await syncBetterAuthCredentialAccount(prisma, { userId: existing.id, password: PASSWORD })
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
				role: role === 'sales' ? 'member' : 'admin',
			},
		})
		return user
	})
	console.log(`dibuat: ${normalized} (${role})`)
	return created
}

async function main() {
	const app = await prisma.apps.findFirst({ select: { id: true } })
	const org = await prisma.organization.findFirst({ select: { id: true } })
	if (!app || !org) throw new Error('App/organization tidak ditemukan')

	// 1. Benny becomes the administrator.
	const admin = await prisma.users.findUnique({ where: { email: ADMINISTRATOR_EMAIL } })
	if (!admin) throw new Error(`${ADMINISTRATOR_EMAIL} tidak ditemukan`)
	if (admin.role !== 'administrator') {
		await prisma.users.update({
			where: { id: admin.id },
			data: { role: 'administrator' },
		})
		console.log(`role: ${ADMINISTRATOR_EMAIL} ${admin.role} -> administrator`)
	} else {
		console.log('role sudah benar: benny (administrator)')
	}

	// 2. One leader per team, each a member of only their own team. The
	//    administrator stays in every team: routing resolves a lead's team
	//    through membership, so dropping him out would leave him unable to hand
	//    leads to anyone.
	for (const entry of LEADERS) {
		const team = await prisma.teams.findFirst({
			where: { app_id: app.id, name: entry.team, deleted_at: null },
			select: { id: true, name: true },
		})
		if (!team) {
			console.log(`LEWAT: tim ${entry.team} belum ada`)
			continue
		}
		const user = await ensureUser(entry.name, entry.email, 'leader', app.id, org.id)
		await prisma.team_members.createMany({
			data: [{ team_id: team.id, user_id: user.id }],
			skipDuplicates: true,
		})
		console.log(`  ${entry.name} -> tim ${team.name}`)
	}

	await prisma.team_members.createMany({
		data: (
			await prisma.teams.findMany({
				where: { app_id: app.id, deleted_at: null },
				select: { id: true },
			})
		).map((team) => ({ team_id: team.id, user_id: admin.id })),
		skipDuplicates: true,
	})

	console.log('\n--- hasil ---')
	const rows = await prisma.users.findMany({
		where: { app_id: app.id, deleted_at: null, active: true },
		select: { name: true, email: true, role: true },
		orderBy: [{ role: 'asc' }, { name: 'asc' }],
	})
	for (const row of rows) console.log(`  ${row.role.padEnd(14)} ${row.name}`)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
