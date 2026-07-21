// One-time bootstrap: creates the first CEO account (org + app + user).
// Idempotent, safe to re-run; skips if a CEO already exists.
import prisma from '../src/lib/prisma'
import { syncBetterAuthCredentialAccount } from '../src/lib/better-auth-credentials'

async function main() {
	const email = process.env.SEED_CEO_EMAIL
	const password = process.env.SEED_CEO_PASSWORD

	if (!email || !password) {
		console.error('SEED_CEO_EMAIL and SEED_CEO_PASSWORD must be set in .env')
		process.exit(1)
	}

	const existingCeo = await prisma.users.findFirst({ where: { role: 'ceo' } })
	if (existingCeo) {
		console.log(`CEO already exists (${existingCeo.email}), skipping.`)
		return
	}

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

	await prisma.$transaction(async (tx) => {
		const ceo = await tx.users.create({
			data: {
				name: 'CEO',
				email: email.trim().toLowerCase(),
				role: 'ceo',
				app_id: appRecord.id,
			},
		})

		await syncBetterAuthCredentialAccount(tx, { userId: ceo.id, password })

		await tx.member.create({
			data: {
				id: crypto.randomUUID(),
				organizationId: org.id,
				userId: ceo.id,
				role: 'owner',
			},
		})

		console.log(`CEO account created: ${ceo.email}`)
	})
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
