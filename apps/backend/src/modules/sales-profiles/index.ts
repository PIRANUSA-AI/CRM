import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import {
	SalesProfileError,
	SalesProfileNotFoundError,
	SalesProfileService,
	type SalesProfileActor,
} from './service'
import { SALES_PRODUCTS } from './products'

// Managing capacity/segments/notes is a leadership action. Background/
// contact info and product skills are the sales' own to set - see
// SELF_ROLES and PUT /:userId/self below.
const ALLOWED_ROLES: CanonicalRole[] = ['leader', 'administrator', 'ceo', 'superadmin']
const SELF_ROLES: CanonicalRole[] = ['sales', 'leader']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	allowedRoles: CanonicalRole[],
	set: { status?: number | string },
): Promise<SalesProfileActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, allowedRoles)
	if (!authorization.ok) {
		set.status = authorization.status
		return null
	}
	return { appId: resolvedAppId, userId, role: authorization.role as CanonicalRole }
}

function toErrorResponse(error: unknown, set: { status?: number | string }) {
	if (error instanceof SalesProfileNotFoundError) {
		set.status = 404
		return { error: error.message }
	}
	if (error instanceof SalesProfileError) {
		set.status = 400
		return { error: error.message }
	}
	if (error instanceof Error) {
		set.status = 400
		return { error: error.message }
	}
	set.status = 500
	return { error: 'Profil sales tidak dapat diproses' }
}

export const salesProfiles = new Elysia({ prefix: '/sales-profiles', tags: ['SalesProfiles'] })
	.use(appContext)
	.get('/', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, ALLOWED_ROLES, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await SalesProfileService.listWithProfiles(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	.get('/:userId/performance', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, ALLOWED_ROLES, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await SalesProfileService.performanceSummary(actor, params.userId) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ userId: t.String() }) })
	.put('/:userId', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, ALLOWED_ROLES, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await SalesProfileService.upsertProfile(actor, params.userId, body) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		params: t.Object({ userId: t.String() }),
		body: t.Object({
			segments: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			level: t.Optional(t.Union([t.String({ maxLength: 20 }), t.Null()])),
			maxActive: t.Optional(t.Union([t.Number(), t.Null()])),
			workHours: t.Optional(t.Any()),
			regions: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			languages: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			tags: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			notes: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
			persona: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
		}),
	})
	// A sales (or leader) reading their own row before editing it.
	.get('/self', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, SELF_ROLES, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await SalesProfileService.getSelfProfile(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	// A sales (or leader) editing their own background/contact info and
	// product skills. Always the caller's own row - params.userId must match.
	.put('/:userId/self', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, SELF_ROLES, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		if (params.userId !== actor.userId) {
			set.status = 403
			return { error: 'Hanya bisa mengisi profil milik sendiri' }
		}
		try {
			return { data: await SalesProfileService.upsertSelfProfile(actor, body) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		params: t.Object({ userId: t.String() }),
		body: t.Object({
			productSkills: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			experienceYears: t.Optional(t.Union([t.Number(), t.Null()])),
			phone: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
			position: t.Optional(t.Union([t.String({ maxLength: 120 }), t.Null()])),
			joinedAt: t.Optional(t.Union([t.String({ maxLength: 40 }), t.Null()])),
		}),
	})
	.get('/meta/products', () => ({ data: SALES_PRODUCTS }))
