import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { PrismaClient } from '../generated/prisma'

const connectionString = process.env.DATABASE_URL

const pool = new Pool({ connectionString })
const adapter = new PrismaPg(pool)

export const prisma = new PrismaClient({
	adapter,
	log:
		process.env.NODE_ENV === 'development'
			? ['query', 'error', 'warn']
			: ['error'],
})

process.on('SIGINT', async () => {
	await prisma.$disconnect()
	process.exit(0)
})

process.on('SIGTERM', async () => {
	await prisma.$disconnect()
	process.exit(0)
})
export default prisma
