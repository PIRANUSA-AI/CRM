// apps/backend/scripts/rename-legacy-roles.ts
import prisma from '../src/lib/prisma'

const RENAME_MAP: Record<string, string> = {
	agent: 'sales',
	supervisor: 'leader',
	admin: 'ceo',
}

async function main() {
	for (const [oldRole, newRole] of Object.entries(RENAME_MAP)) {
		const result = await prisma.users.updateMany({
			where: { role: oldRole },
			data: { role: newRole },
		})
		console.log(`${oldRole} -> ${newRole}: ${result.count} row(s) updated`)
	}
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
