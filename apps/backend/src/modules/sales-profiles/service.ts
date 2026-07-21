import prisma from '../../lib/prisma'
import type { CanonicalRole } from '../../lib/require-role'

export type SalesProfileActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export class SalesProfileError extends Error {}
export class SalesProfileNotFoundError extends Error {}

// Tasks in these states count toward a sales' active workload.
const ACTIVE_TASK_STATUSES = ['open', 'in_progress']

export type SalesProfileInput = {
	productSkills?: string[]
	segments?: string[]
	level?: string | null
	maxActive?: number | null
	workHours?: unknown
	regions?: string[]
	languages?: string[]
	tags?: string[]
	notes?: string | null
	persona?: string | null
	experienceYears?: number | null
	phone?: string | null
	position?: string | null
	joinedAt?: string | null
}

type TeamSales = {
	userId: string
	name: string | null
	email: string
	role: string | null
	teamId: string | null
	teamName: string | null
}

function cleanStringArray(value: unknown, max = 40): string[] {
	if (!Array.isArray(value)) return []
	const out: string[] = []
	for (const item of value) {
		const text = String(item ?? '').trim().slice(0, 120)
		if (text && !out.includes(text)) out.push(text)
		if (out.length >= max) break
	}
	return out
}

function asArray(value: unknown): string[] {
	return Array.isArray(value) ? (value as unknown[]).map((v) => String(v)) : []
}

/**
 * Sales the actor may view/configure profiles for. Mirrors the import module's
 * assignable resolution:
 * - leader: only members sharing a team with the leader.
 * - ceo/superadmin: all active sales/leaders in the app.
 */
async function resolveTeamSales(actor: SalesProfileActor): Promise<Map<string, TeamSales>> {
	const appTeams = await prisma.teams.findMany({
		where: { app_id: actor.appId, deleted_at: null },
		select: { id: true, name: true },
	})
	const appTeamIds = appTeams.map((team) => team.id)
	const teamNameById = new Map(appTeams.map((team) => [team.id, team.name]))
	const appMembers = appTeamIds.length
		? await prisma.team_members.findMany({
				where: { team_id: { in: appTeamIds } },
				select: { team_id: true, user_id: true },
			})
		: []

	const userTeams = new Map<string, string[]>()
	for (const member of appMembers) {
		const list = userTeams.get(member.user_id) || []
		list.push(member.team_id)
		userTeams.set(member.user_id, list)
	}
	const leaderTeamIds = userTeams.get(actor.userId) || []

	const users = await prisma.users.findMany({
		where: {
			app_id: actor.appId,
			deleted_at: null,
			active: true,
			role: { in: ['sales', 'leader'] },
		},
		select: { id: true, name: true, email: true, role: true },
	})

	const map = new Map<string, TeamSales>()
	for (const user of users) {
		if (!user.email) continue
		const teamsOfUser = userTeams.get(user.id) || []
		let teamId: string | null = null
		if (actor.role === 'leader') {
			const shared = teamsOfUser.find((id) => leaderTeamIds.includes(id))
			if (!shared) continue
			teamId = shared
		} else {
			teamId = teamsOfUser[0] || null
		}
		map.set(user.id, {
			userId: user.id,
			name: user.name,
			email: user.email,
			role: user.role,
			teamId,
			teamName: teamId ? teamNameById.get(teamId) ?? null : null,
		})
	}
	return map
}

type ProfileRow = {
	product_skills: unknown
	segments: unknown
	level: string | null
	max_active: number
	work_hours: unknown
	regions: unknown
	languages: unknown
	tags: unknown
	notes: string | null
	persona: string | null
	experience_years: number | null
	phone: string | null
	position: string | null
	joined_at: Date | null
	updated_at: Date
}

function profileShape(row: ProfileRow | null) {
	return {
		// Whether anyone has actually filled this in. Every other field has a
		// sensible default, so without this a sales nobody has configured is
		// indistinguishable from one deliberately left at maxActive 20.
		configured: row !== null,
		productSkills: asArray(row?.product_skills),
		segments: asArray(row?.segments),
		level: row?.level ?? null,
		maxActive: row?.max_active ?? 20,
		workHours: (row?.work_hours as unknown) ?? null,
		regions: asArray(row?.regions),
		languages: asArray(row?.languages),
		tags: asArray(row?.tags),
		notes: row?.notes ?? null,
		persona: row?.persona ?? null,
		experienceYears: row?.experience_years ?? null,
		phone: row?.phone ?? null,
		position: row?.position ?? null,
		joinedAt: row?.joined_at ?? null,
		updatedAt: row?.updated_at ?? null,
	}
}

export abstract class SalesProfileService {
	// List every sales the actor manages, merged with their routing profile and
	// current active workload (open + in_progress tasks).
	static async listWithProfiles(actor: SalesProfileActor) {
		const sales = await resolveTeamSales(actor)
		const ids = [...sales.keys()]
		if (!ids.length) return []

		// Last activity is derived, never stored: a "last seen" column has to be
		// written on every action to stay true, and one missed write makes it a
		// lie. These three rows already exist.
		const [profiles, loads, lastTask, lastDeal, lastOwned] = await Promise.all([
			prisma.sales_profiles.findMany({
				where: { app_id: actor.appId, user_id: { in: ids } },
			}),
			prisma.tasks.groupBy({
				by: ['assignee_id'],
				where: {
					app_id: actor.appId,
					assignee_id: { in: ids },
					status: { in: ACTIVE_TASK_STATUSES },
				},
				_count: { _all: true },
			}),
			prisma.tasks.groupBy({
				by: ['assignee_id'],
				where: { app_id: actor.appId, assignee_id: { in: ids } },
				_max: { updated_at: true },
			}),
			prisma.opportunities.groupBy({
				by: ['owner_id'],
				where: { app_id: actor.appId, owner_id: { in: ids } },
				_max: { stage_changed_at: true },
			}),
			prisma.contacts.groupBy({
				by: ['owner_id'],
				where: { app_id: actor.appId, owner_id: { in: ids }, deleted_at: null },
				_max: { last_activity_at: true },
			}),
		])

		const latest = new Map<string, Date | null>()
		const note = (id: string | null, at: Date | null | undefined) => {
			if (!id || !at) return
			const current = latest.get(id)
			if (!current || at.getTime() > current.getTime()) latest.set(id, at)
		}
		for (const row of lastTask) note(row.assignee_id, row._max.updated_at)
		for (const row of lastDeal) note(row.owner_id, row._max.stage_changed_at)
		for (const row of lastOwned) note(row.owner_id, row._max.last_activity_at)

		const profileByUser = new Map(profiles.map((p) => [p.user_id, p]))
		const loadByUser = new Map(
			loads.map((l) => [String(l.assignee_id), l._count._all]),
		)

		return [...sales.values()]
			.map((s) => ({
				userId: s.userId,
				name: s.name,
				email: s.email,
				role: s.role,
				teamId: s.teamId,
				teamName: s.teamName,
				activeLoad: loadByUser.get(s.userId) || 0,
				lastActivityAt: latest.get(s.userId) ?? null,
				profile: profileShape((profileByUser.get(s.userId) as ProfileRow) || null),
			}))
			.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
	}

	// Create or update a sales' routing profile. Leaders may only edit sales in
	// their own team.
	static async upsertProfile(
		actor: SalesProfileActor,
		userId: string,
		input: SalesProfileInput,
	) {
		const sales = await resolveTeamSales(actor)
		const target = sales.get(userId)
		if (!target)
			throw new SalesProfileNotFoundError('Sales tidak ditemukan atau di luar tim Anda')

		const maxActiveRaw = Number(input.maxActive)
		const maxActive =
			Number.isFinite(maxActiveRaw) && maxActiveRaw > 0
				? Math.min(1000, Math.floor(maxActiveRaw))
				: 20
		// Only include work_hours when a real object is supplied; a nullable Json
		// column cannot take a plain `null` via Prisma, so we omit it otherwise.
		const workHours =
			input.workHours && typeof input.workHours === 'object' && !Array.isArray(input.workHours)
				? { work_hours: input.workHours as object }
				: {}

		const data = {
			product_skills: cleanStringArray(input.productSkills),
			segments: cleanStringArray(input.segments),
			level: input.level ? String(input.level).trim().slice(0, 20) : null,
			max_active: maxActive,
			regions: cleanStringArray(input.regions),
			languages: cleanStringArray(input.languages),
			tags: cleanStringArray(input.tags),
			notes: input.notes ? String(input.notes).trim().slice(0, 2000) : null,
			persona: input.persona ? String(input.persona).trim().slice(0, 2000) : null,
			experience_years:
				input.experienceYears === null || input.experienceYears === undefined
					? null
					: Math.max(0, Math.min(60, Math.floor(Number(input.experienceYears) || 0))),
			phone: input.phone ? String(input.phone).trim().slice(0, 40) : null,
			position: input.position ? String(input.position).trim().slice(0, 120) : null,
			// Date-only column, so a bad string becomes null rather than throwing
			// at the driver and losing the rest of the save.
			joined_at: (() => {
				if (!input.joinedAt) return null
				const parsed = new Date(input.joinedAt)
				return Number.isNaN(parsed.getTime()) ? null : parsed
			})(),
		}

		const row = await prisma.sales_profiles.upsert({
			where: { app_id_user_id: { app_id: actor.appId, user_id: userId } },
			create: { app_id: actor.appId, user_id: userId, ...data, ...workHours },
			update: { ...data, ...workHours },
		})

		return {
			userId: target.userId,
			name: target.name,
			email: target.email,
			role: target.role,
			teamId: target.teamId,
			profile: profileShape(row as ProfileRow),
		}
	}
}
