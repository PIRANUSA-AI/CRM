import prisma from '../../lib/prisma'

const BAILEYS_STORAGE_ERROR_MESSAGE =
	'Baileys session storage is not ready. The backend could not prepare the baileys_sessions table automatically.'

let storageReady = false
let storagePromise: Promise<void> | null = null

async function enableUuidGeneration() {
	try {
		await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto')
	} catch (error) {
		console.warn(
			'[BaileysStorage] Could not enable pgcrypto extension automatically; continuing with application-generated ids',
			error,
		)
	}
}

async function hasBaileysSessionsTable() {
	const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
		SELECT EXISTS (
			SELECT 1
			FROM information_schema.tables
			WHERE table_schema = 'public'
				AND table_name = 'baileys_sessions'
		) AS "exists"
	`

	return Boolean(rows[0]?.exists)
}

async function createBaileysSessionsTable() {
	await prisma.$executeRawUnsafe(`
		CREATE TABLE IF NOT EXISTS "baileys_sessions" (
			"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
			"channel_id" UUID NOT NULL,
			"app_id" UUID NOT NULL,
			"owner_user_id" UUID,
			"provider_channel_key" VARCHAR(191) NOT NULL,
			"phone_number" VARCHAR(50),
			"status" VARCHAR(50) DEFAULT 'pending',
			"auth_state" JSONB,
			"pairing_code" VARCHAR(64),
			"qr_code" TEXT,
			"last_error" TEXT,
			"last_connected_at" TIMESTAMPTZ(6),
			"first_connected_at" TIMESTAMPTZ(6),
			"last_seen_at" TIMESTAMPTZ(6),
			"metadata" JSONB DEFAULT '{}'::jsonb,
			"created_at" TIMESTAMPTZ(6) DEFAULT NOW(),
			"updated_at" TIMESTAMPTZ(6) DEFAULT NOW()
		)
	`)
	await prisma.$executeRawUnsafe(`
		CREATE UNIQUE INDEX IF NOT EXISTS "baileys_sessions_channel_id_key"
		ON "baileys_sessions"("channel_id")
	`)
	await prisma.$executeRawUnsafe(`
		CREATE UNIQUE INDEX IF NOT EXISTS "baileys_sessions_provider_channel_key_key"
		ON "baileys_sessions"("provider_channel_key")
	`)
	await prisma.$executeRawUnsafe(`
		CREATE INDEX IF NOT EXISTS "idx_baileys_sessions_app_id"
		ON "baileys_sessions"("app_id")
	`)
	await prisma.$executeRawUnsafe(`
		CREATE INDEX IF NOT EXISTS "idx_baileys_sessions_status"
		ON "baileys_sessions"("status")
	`)
	await prisma.$executeRawUnsafe(`
		ALTER TABLE "baileys_sessions"
		ADD COLUMN IF NOT EXISTS "owner_user_id" UUID,
		ADD COLUMN IF NOT EXISTS "first_connected_at" TIMESTAMPTZ(6)
	`)
	await prisma.$executeRawUnsafe(`
		CREATE UNIQUE INDEX IF NOT EXISTS "baileys_sessions_app_owner_key"
		ON "baileys_sessions"("app_id", "owner_user_id")
		WHERE "owner_user_id" IS NOT NULL
	`)
}

async function repairBaileysSessionsTableDefaults() {
	try {
		await prisma.$executeRawUnsafe(`
			ALTER TABLE "baileys_sessions"
			ALTER COLUMN "id" SET DEFAULT gen_random_uuid()
		`)
	} catch (error) {
		console.warn(
			'[BaileysStorage] Could not repair baileys_sessions.id default automatically; continuing with application-generated ids',
			error,
		)
	}
}

export async function ensureBaileysSessionStorage() {
	if (storageReady) return

	if (!storagePromise) {
		storagePromise = (async () => {
			try {
				await enableUuidGeneration()

				if (!(await hasBaileysSessionsTable())) {
					await createBaileysSessionsTable()
				}

				await repairBaileysSessionsTableDefaults()
				storageReady = true
			} catch (error) {
				console.error(
					'[BaileysStorage] Failed to prepare baileys_sessions table',
					error,
				)
				throw new Error(BAILEYS_STORAGE_ERROR_MESSAGE)
			} finally {
				if (!storageReady) {
					storagePromise = null
				}
			}
		})()
	}

	await storagePromise
}

export function resetBaileysSessionStorageForTests() {
	storageReady = false
	storagePromise = null
}
