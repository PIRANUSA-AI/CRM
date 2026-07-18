import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import {
	SalesProfileError,
	SalesProfileNotFoundError,
	SalesProfileService,
	type SalesProfileActor,
} from './service'

// Managing sales routing profiles is a leadership action.
const ALLOWED_ROLES: CanonicalRole[] = ['leader', 'ceo', 'superadmin']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<SalesProfileActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, ALLOWED_ROLES)
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
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await SalesProfileService.listWithProfiles(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	.put('/:userId', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await SalesProfileService.upsertProfile(actor, params.userId, body) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		params: t.Object({ userId: t.String() }),
		body: t.Object({
			productSkills: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			segments: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			level: t.Optional(t.Union([t.String({ maxLength: 20 }), t.Null()])),
			maxActive: t.Optional(t.Union([t.Number(), t.Null()])),
			workHours: t.Optional(t.Any()),
			regions: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			languages: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			tags: t.Optional(t.Array(t.String({ maxLength: 120 }))),
			notes: t.Optional(t.Union([t.String({ maxLength: 2000 }), t.Null()])),
		}),
	})
