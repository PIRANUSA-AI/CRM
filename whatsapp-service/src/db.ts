import crypto from 'node:crypto'
import { Pool, type QueryResultRow } from 'pg'

const connectionString = String(process.env.DATABASE_URL || '').trim()

if (!connectionString) {
	throw new Error('DATABASE_URL is required for CRM Baileys Service')
}

export const db = new Pool({
	connectionString,
	max: Math.max(2, Number(process.env.BAILEYS_DB_POOL_MAX || 10)),
})

db.on('error', (error: Error) => {
	console.error('[BaileysService][db] Unexpected pool error', error)
})

export async function queryMany<T extends QueryResultRow>(
	text: string,
	params: unknown[] = [],
) {
	const result = await db.query<T>(text, params)
	return result.rows
}

export async function queryOne<T extends QueryResultRow>(
	text: string,
	params: unknown[] = [],
) {
	const rows = await queryMany<T>(text, params)
	return rows[0] || null
}

export async function execute(text: string, params: unknown[] = []) {
	await db.query(text, params)
}

let ensureStoragePromise: Promise<void> | null = null

export async function ensureBaileysSessionStorage() {
	if (ensureStoragePromise) return ensureStoragePromise

	ensureStoragePromise = (async () => {
		await execute(`
			CREATE TABLE IF NOT EXISTS public.baileys_sessions (
				id uuid PRIMARY KEY,
				channel_id uuid NOT NULL UNIQUE,
				app_id uuid NOT NULL,
				owner_user_id uuid,
				provider_channel_key varchar(191) NOT NULL UNIQUE,
				phone_number varchar(50),
				status varchar(50) DEFAULT 'pending',
				auth_state jsonb,
				pairing_code varchar(64),
				qr_code text,
				last_error text,
				last_connected_at timestamptz,
				first_connected_at timestamptz,
				last_seen_at timestamptz,
				metadata jsonb DEFAULT '{}'::jsonb,
				created_at timestamptz DEFAULT now(),
				updated_at timestamptz DEFAULT now()
			)
		`)
		await execute(`
			ALTER TABLE public.baileys_sessions
			ADD COLUMN IF NOT EXISTS owner_user_id uuid,
			ADD COLUMN IF NOT EXISTS first_connected_at timestamptz
		`)
		await execute(`
			CREATE INDEX IF NOT EXISTS idx_baileys_sessions_app_id
			ON public.baileys_sessions(app_id)
		`)
		await execute(`
			CREATE INDEX IF NOT EXISTS idx_baileys_sessions_status
			ON public.baileys_sessions(status)
		`)
	})().catch((error) => {
		ensureStoragePromise = null
		throw error
	})

	return ensureStoragePromise
}

export function createUuid() {
	return crypto.randomUUID()
}

export async function closeDb() {
	await db.end()
}
