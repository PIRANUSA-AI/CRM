import type {
	SalesExperienceLevel,
	SalesPersonaType,
} from '@crm/shared/sales-types'
import { recordAuditLog } from '../../lib/audit-log'
import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'
import { isSalesLevel } from './levels'

export type SalesPersonaActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export class SalesPersonaError extends Error {}
export class SalesPersonaNotFoundError extends Error {}

export type SalesPersonaInput = {
	personaType?: string | null
	productExpertise?: Record<string, number> | null
	experienceYears?: number | null
	experienceLevel?: string | null
	strengths?: string[] | null
	weaknesses?: string[] | null
	// Undefined = leave users.sales_level untouched, null = clear it.
	salesLevel?: string | null
}

const PERSONA_TYPES = new Set<SalesPersonaType>([
	'hunter',
	'farmer',
	'closer',
	'advisor',
	'negotiator',
])
const EXPERIENCE_LEVELS = new Set<SalesExperienceLevel>(['junior', 'mid', 'senior', 'lead'])

function cleanExpertise(
	value: Record<string, number> | null | undefined,
): Record<string, number> {
	if (!value || typeof value !== 'object') return {}
	const out: Record<string, number> = {}
	for (const [key, raw] of Object.entries(value)) {
		const name = String(key || '').trim().slice(0, 120)
		if (!name) continue
		const score = Number(raw)
		if (!Number.isFinite(score)) continue
		out[name] = Math.max(0, Math.min(100, Math.round(score)))
		if (Object.keys(out).length >= 40) break
	}
	return out
}

function cleanTags(value: string[] | null | undefined, max = 20): string[] {
	if (!Array.isArray(value)) return []
	const out: string[] = []
	for (const item of value) {
		const text = String(item ?? '').trim().slice(0, 120)
		if (text && !out.includes(text)) out.push(text)
		if (out.length >= max) break
	}
	return out
}

function normalizeInput(input: SalesPersonaInput) {
	return {
		persona_type:
			input.personaType && PERSONA_TYPES.has(input.personaType as SalesPersonaType)
				? input.personaType
				: null,
		product_expertise: cleanExpertise(input.productExpertise),
		experience_years:
			input.experienceYears === null || input.experienceYears === undefined
				? null
				: Math.max(0, Math.min(60, Math.floor(Number(input.experienceYears) || 0))),
		experience_level:
			input.experienceLevel &&
			EXPERIENCE_LEVELS.has(input.experienceLevel as SalesExperienceLevel)
				? input.experienceLevel
				: null,
		strengths: cleanTags(input.strengths),
		weaknesses: cleanTags(input.weaknesses),
	}
}

type PersonaRow = {
	persona_type: string | null
	product_expertise: unknown
	experience_years: number | null
	experience_level: string | null
	strengths: unknown
	weaknesses: unknown
	updated_at: Date
}

function shapeRow(row: PersonaRow | null | undefined) {
	if (!row) return null
	return {
		personaType: (row.persona_type as SalesPersonaType) ?? null,
		productExpertise: (row.product_expertise as Record<string, number>) ?? {},
		experienceYears: row.experience_years,
		experienceLevel: (row.experience_level as SalesExperienceLevel) ?? null,
		strengths: Array.isArray(row.strengths) ? (row.strengths as string[]) : [],
		weaknesses: Array.isArray(row.weaknesses) ? (row.weaknesses as string[]) : [],
		updatedAt: row.updated_at,
	}
}

/**
 * Same visibility rule as sales-targets/sales-profiles: sales sees only
 * themself, leader sees their team plus themself, administrator/ceo/
 * superadmin see everyone.
 */
async function resolveVisibleUserIds(
	actor: SalesPersonaActor,
): Promise<string[] | null> {
	if (actor.role === 'sales') return [actor.userId]
	if (actor.role === 'leader') {
		const memberships = await prisma.team_members.findMany({
			where: { user_id: actor.userId },
			select: { team_id: true },
		})
		const teamIds = memberships.map((m) => m.team_id)
		if (!teamIds.length) return [actor.userId]
		const teamMembers = await prisma.team_members.findMany({
			where: { team_id: { in: teamIds } },
			select: { user_id: true },
		})
		return [...new Set([actor.userId, ...teamMembers.map((m) => m.user_id)])]
	}
	return null
}

async function ensureEligibleUser(appId: string, userId: string) {
	const user = await prisma.users.findFirst({
		where: { id: userId, app_id: appId, deleted_at: null, role: { in: ['sales', 'leader'] } },
		select: { id: true, name: true, email: true, sales_level: true },
	})
	if (!user) {
		throw new SalesPersonaNotFoundError('User bukan sales/leader aktif di app ini')
	}
	return user
}

export abstract class SalesPersonaService {
	// Leader/administrator/ceo/superadmin only - scoped the same as
	// sales-targets/sales-profiles (leader = own team, admin+ = everyone).
	static async list(actor: SalesPersonaActor) {
		const visibleUserIds = await resolveVisibleUserIds(actor)
		const users = await prisma.users.findMany({
			where: {
				app_id: actor.appId,
				deleted_at: null,
				active: true,
				role: { in: ['sales', 'leader'] },
				...(visibleUserIds ? { id: { in: visibleUserIds } } : {}),
			},
			select: { id: true, name: true, email: true, sales_level: true },
		})
		if (!users.length) return []

		const rows = await prisma.sales_persona.findMany({
			where: { app_id: actor.appId, user_id: { in: users.map((u) => u.id) } },
		})
		const rowByUser = new Map(rows.map((row) => [row.user_id, row]))

		return users
			.map((user) => ({
				userId: user.id,
				name: user.name,
				email: user.email,
				salesLevel: user.sales_level,
				persona: shapeRow(rowByUser.get(user.id)),
			}))
			.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
	}

	static async getForUser(actor: SalesPersonaActor, targetUserId: string) {
		if (actor.role === 'sales' && actor.userId !== targetUserId) {
			throw new SalesPersonaError('Sales hanya bisa lihat persona sendiri')
		}
		if (actor.role !== 'sales') {
			const visibleUserIds = await resolveVisibleUserIds(actor)
			if (visibleUserIds && !visibleUserIds.includes(targetUserId)) {
				throw new SalesPersonaError('User di luar scope Anda')
			}
		}

		const user = await ensureEligibleUser(actor.appId, targetUserId)
		const row = await prisma.sales_persona.findUnique({
			where: { app_id_user_id: { app_id: actor.appId, user_id: targetUserId } },
		})
		return {
			userId: user.id,
			name: user.name,
			email: user.email,
			salesLevel: user.sales_level,
			persona: shapeRow(row),
		}
	}

	// Administrator sets/overrides a sales' persona. No self-report path - per
	// W2I.md §4.3 this is meant to start from an AI recommendation, which
	// does not exist yet, so administrator sets it directly for now.
	static async upsert(
		actor: SalesPersonaActor,
		targetUserId: string,
		input: SalesPersonaInput,
	) {
		await ensureEligibleUser(actor.appId, targetUserId)
		const data = normalizeInput(input)

		const compoundKey = { app_id: actor.appId, user_id: targetUserId }
		const row = await prisma.sales_persona.upsert({
			where: { app_id_user_id: compoundKey },
			create: { ...compoundKey, ...data },
			update: data,
		})

		let salesLevel: string | null = null
		if (input.salesLevel !== undefined) {
			salesLevel = input.salesLevel && isSalesLevel(input.salesLevel) ? input.salesLevel : null
			await prisma.users.update({
				where: { id: targetUserId },
				data: { sales_level: salesLevel },
			})
		}

		await recordAuditLog({
			appId: actor.appId,
			entityType: 'sales_persona',
			entityId: targetUserId,
			action: 'persona_set',
			actorId: actor.userId,
			metadata: {
				...data,
				...(input.salesLevel !== undefined ? { salesLevel } : {}),
			},
		})

		return { persona: shapeRow(row), salesLevel }
	}
}
