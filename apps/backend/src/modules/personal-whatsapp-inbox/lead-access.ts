import prisma from '../../lib/prisma'

export type PersonalLeadStatus = 'pending' | 'confirmed' | 'blocked'

export type PersonalLeadRegistration = {
	id: string
	app_id: string
	owner_user_id: string
	phone_number: string
	contact_id: string | null
	conversation_id: string | null
	display_name: string | null
	status: PersonalLeadStatus
	source: string
	confirmed_at: Date | null
	blocked_at: Date | null
	created_at: Date
	updated_at: Date
}

let storageReady = false
let storagePromise: Promise<void> | null = null

export function normalizePersonalLeadPhone(value: string | null | undefined) {
	let digits = String(value || '').replace(/\D/g, '')
	if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
	else if (digits.startsWith('8')) digits = `62${digits}`
	return /^\d{8,15}$/.test(digits) ? digits : null
}

export async function ensurePersonalLeadStorage() {
	if (storageReady) return
	if (!storagePromise) {
		storagePromise = (async () => {
			await prisma.$executeRawUnsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto')
			await prisma.$executeRawUnsafe(`
				CREATE TABLE IF NOT EXISTS "whatsapp_lead_registrations" (
					"id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
					"app_id" UUID NOT NULL,
					"owner_user_id" UUID NOT NULL,
					"phone_number" VARCHAR(32) NOT NULL,
					"contact_id" UUID,
					"conversation_id" UUID,
					"display_name" VARCHAR(255),
					"status" VARCHAR(20) NOT NULL DEFAULT 'pending',
					"source" VARCHAR(40) NOT NULL DEFAULT 'inbound',
					"confirmed_at" TIMESTAMPTZ(6),
					"blocked_at" TIMESTAMPTZ(6),
					"created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
					"updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT NOW(),
					CONSTRAINT "whatsapp_lead_registrations_status_check"
						CHECK ("status" IN ('pending', 'confirmed', 'blocked'))
				)
			`)
			await prisma.$executeRawUnsafe(`
				CREATE UNIQUE INDEX IF NOT EXISTS "whatsapp_lead_registrations_owner_phone_key"
				ON "whatsapp_lead_registrations"("app_id", "owner_user_id", "phone_number")
			`)
			await prisma.$executeRawUnsafe(`
				CREATE INDEX IF NOT EXISTS "idx_whatsapp_lead_registrations_owner_status"
				ON "whatsapp_lead_registrations"("app_id", "owner_user_id", "status", "updated_at" DESC)
			`)
			storageReady = true
		})().finally(() => {
			if (!storageReady) storagePromise = null
		})
	}
	await storagePromise
}

export async function resolvePersonalLeadOwner(appId: string, inboxId: string) {
	const rows = await prisma.$queryRaw<Array<{ owner_user_id: string; channel_id: string }>>`
		SELECT s."owner_user_id", s."channel_id"
		FROM "baileys_sessions" s
		JOIN "whatsapp_channels" c ON c."id" = s."channel_id"
		WHERE s."app_id" = ${appId}::uuid
		  AND s."owner_user_id" IS NOT NULL
		  AND c."inbox_id" = ${inboxId}::uuid
		  AND c."provider" = 'baileys'
		  AND c."deleted_at" IS NULL
		LIMIT 1
	`
	return rows[0] || null
}

export async function registerInboundPersonalLead(params: {
	appId: string
	ownerUserId: string
	phoneNumber: string
	contactId: string
	conversationId: string
	displayName?: string | null
}) {
	await ensurePersonalLeadStorage()
	const phone = normalizePersonalLeadPhone(params.phoneNumber)
	if (!phone) return null
	const rows = await prisma.$queryRaw<PersonalLeadRegistration[]>`
		INSERT INTO "whatsapp_lead_registrations" (
			"app_id", "owner_user_id", "phone_number", "contact_id", "conversation_id", "display_name", "status", "source"
		)
		VALUES (
			${params.appId}::uuid, ${params.ownerUserId}::uuid, ${phone}, ${params.contactId}::uuid,
			${params.conversationId}::uuid, ${params.displayName || null}, 'pending', 'inbound'
		)
		ON CONFLICT ("app_id", "owner_user_id", "phone_number") DO UPDATE SET
			"contact_id" = EXCLUDED."contact_id",
			"conversation_id" = EXCLUDED."conversation_id",
			"display_name" = COALESCE(EXCLUDED."display_name", "whatsapp_lead_registrations"."display_name"),
			"updated_at" = NOW()
		RETURNING *
	`
	return rows[0] || null
}

export async function confirmPersonalLead(params: {
	appId: string
	ownerUserId: string
	phoneNumber: string
	contactId?: string | null
	conversationId?: string | null
	displayName?: string | null
	source?: 'manual' | 'approved'
}) {
	await ensurePersonalLeadStorage()
	const phone = normalizePersonalLeadPhone(params.phoneNumber)
	if (!phone) throw new Error('Nomor WhatsApp tidak valid')
	const rows = await prisma.$queryRaw<PersonalLeadRegistration[]>`
		INSERT INTO "whatsapp_lead_registrations" (
			"app_id", "owner_user_id", "phone_number", "contact_id", "conversation_id", "display_name",
			"status", "source", "confirmed_at", "blocked_at"
		)
		VALUES (
			${params.appId}::uuid, ${params.ownerUserId}::uuid, ${phone}, ${params.contactId || null}::uuid,
			${params.conversationId || null}::uuid, ${params.displayName || null}, 'confirmed',
			${params.source || 'manual'}, NOW(), NULL
		)
		ON CONFLICT ("app_id", "owner_user_id", "phone_number") DO UPDATE SET
			"contact_id" = COALESCE(EXCLUDED."contact_id", "whatsapp_lead_registrations"."contact_id"),
			"conversation_id" = COALESCE(EXCLUDED."conversation_id", "whatsapp_lead_registrations"."conversation_id"),
			"display_name" = COALESCE(EXCLUDED."display_name", "whatsapp_lead_registrations"."display_name"),
			"status" = 'confirmed',
			"source" = EXCLUDED."source",
			"confirmed_at" = NOW(),
			"blocked_at" = NULL,
			"updated_at" = NOW()
		RETURNING *
	`
	return rows[0]
}

export async function listPersonalLeadRegistrations(
	appId: string,
	ownerUserId: string,
	status: PersonalLeadStatus,
) {
	await ensurePersonalLeadStorage()
	return prisma.$queryRaw<PersonalLeadRegistration[]>`
		SELECT * FROM "whatsapp_lead_registrations"
		WHERE "app_id" = ${appId}::uuid
		  AND "owner_user_id" = ${ownerUserId}::uuid
		  AND "status" = ${status}
		ORDER BY "updated_at" DESC
		LIMIT 200
	`
}

export async function listConfirmedPersonalLeadPhones(appId: string, ownerUserId: string) {
	await ensurePersonalLeadStorage()
	const rows = await prisma.$queryRaw<Array<{ phone_number: string }>>`
		SELECT "phone_number" FROM "whatsapp_lead_registrations"
		WHERE "app_id" = ${appId}::uuid
		  AND "owner_user_id" = ${ownerUserId}::uuid
		  AND "status" = 'confirmed'
	`
	return rows.map((row) => row.phone_number)
}

export async function setPersonalLeadStatus(params: {
	appId: string
	ownerUserId: string
	registrationId: string
	status: PersonalLeadStatus
}) {
	await ensurePersonalLeadStorage()
	const rows = await prisma.$queryRaw<PersonalLeadRegistration[]>`
		UPDATE "whatsapp_lead_registrations"
		SET "status" = ${params.status},
			"confirmed_at" = CASE WHEN ${params.status} = 'confirmed' THEN NOW() ELSE "confirmed_at" END,
			"blocked_at" = CASE WHEN ${params.status} = 'blocked' THEN NOW() ELSE NULL END,
			"updated_at" = NOW()
		WHERE "id" = ${params.registrationId}::uuid
		  AND "app_id" = ${params.appId}::uuid
		  AND "owner_user_id" = ${params.ownerUserId}::uuid
		RETURNING *
	`
	return rows[0] || null
}
