import { PrismaClient } from './src/generated/prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({
	connectionString: process.env.DATABASE_URL!,
})

const prisma = new PrismaClient({ adapter })

async function main() {
	const id = '10366a8e-1e8e-416e-9b71-40595c0eb21d'
	console.log(`Checking conversation: ${id}`)

	const conv = await prisma.conversations.findUnique({
		where: { id },
		include: {
			users: true,
		},
	})

	console.log('Conversation:', conv)

	const agents = await prisma.conversation_agents.findMany({
		where: { conversation_id: id },
	})

	console.log('Conversation Agents:', agents)

	const user = await prisma.users.findFirst()
	// Log minimal user info to avoid clutter
	if (user) {
		console.log('Test User ID:', user.id)
		console.log('Test User Name:', user.name)
	} else {
		console.log('No users found in database.')
	}
}

main()
	.catch((e) => console.error(e))
	.finally(async () => {
		await prisma.$disconnect()
	})
