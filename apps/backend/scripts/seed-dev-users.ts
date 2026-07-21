// One-shot dev seeder: creates the 4 core local accounts (ceo, leader, sales, superadmin).
// Idempotent, upserts the org/app and skips users that already exist.
import prisma from '../src/lib/prisma'
import { syncBetterAuthCredentialAccount } from '../src/lib/better-auth-credentials'

const PASSWORD = process.env.SEED_CEO_PASSWORD || 'password123'

const TEAM = [
	{ name: 'Kristian', email: 'kristian@piranusa.com', role: 'ceo', memberRole: 'owner' },
	{ name: 'Benny', email: 'benny@piranusa.com', role: 'leader', memberRole: 'admin' },
	{ name: 'Deska', email: 'deska@piranusa.com', role: 'sales', memberRole: 'member' },
	{ name: 'Yoka', email: 'yoka@piranusa.com', role: 'superadmin', memberRole: 'admin' },
]

async function main() {
	let org = await prisma.organization.findFirst()
	let appRecord = await prisma.apps.findFirst()

	if (!appRecord) {
		appRecord = await prisma.apps.create({
			data: {
				app_id: 'crm-internal',
				app_name: 'CRM Internal',
				business_name: 'CRM',
			},
		})
	}

	if (!org) {
		org = await prisma.organization.create({
			data: {
				id: crypto.randomUUID(),
				name: 'CRM',
				slug: 'crm',
				appId: appRecord.id,
			},
		})
	}

	for (const member of TEAM) {
		const email = member.email.trim().toLowerCase()
		const existing = await prisma.users.findUnique({ where: { email } })

		if (existing) {
			await prisma.$transaction(async (tx) => {
				await syncBetterAuthCredentialAccount(tx, {
					userId: existing.id,
					password: PASSWORD,
				})
				console.log(`reset password: ${email} (${existing.role})`)
			})
			continue
		}

		await prisma.$transaction(async (tx) => {
			const user = await tx.users.create({
				data: {
					name: member.name,
					email,
					role: member.role,
					app_id: appRecord.id,
					emailVerified: true,
					active: true,
				},
			})

			await syncBetterAuthCredentialAccount(tx, {
				userId: user.id,
				password: PASSWORD,
			})

			await tx.member.create({
				data: {
					id: crypto.randomUUID(),
					organizationId: org.id,
					userId: user.id,
					role: member.memberRole,
				},
			})

			console.log(`created: ${email} (${member.role})`)
		})
	}

	console.log(`\nDone. Password for all accounts: ${PASSWORD}`)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
