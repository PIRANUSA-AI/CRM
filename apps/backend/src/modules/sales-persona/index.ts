import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import { SALES_LEVELS } from './levels'
import {
	SalesPersonaError,
	SalesPersonaNotFoundError,
	SalesPersonaService,
	type SalesPersonaActor,
} from './service'

// Everyone operational may reach the detail endpoint (the service scopes it:
// sales only ever sees their own row, read-only). Only leader+ may list the
// team, and only administrator may write - per W2I.md §4.3 this is meant to
// start from an AI recommendation and be overridden by administrator; there
// is no sales self-report step.
const GET_DETAIL_ROLES: CanonicalRole[] = ['sales', 'leader', 'administrator', 'ceo', 'superadmin']
const LIST_ROLES: CanonicalRole[] = ['leader', 'administrator', 'ceo', 'superadmin']
const WRITE_ROLES: CanonicalRole[] = ['administrator']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	allowedRoles: CanonicalRole[],
	set: { status?: number | string },
): Promise<SalesPersonaActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, allowedRoles)
	if (!authorization.ok) {
		set.status = authorization.status
		return null
	}
	return {
		appId: resolvedAppId,
		userId,
		role: authorization.role as CanonicalRole,
	}
}

function toErrorResponse(error: unknown, set: { status?: number | string }) {
	if (error instanceof SalesPersonaNotFoundError) {
		set.status = 404
		return { error: error.message }
	}
	if (error instanceof SalesPersonaError) {
		set.status = 400
		return { error: error.message }
	}
	if (error instanceof Error) {
		set.status = 400
		return { error: error.message }
	}
	set.status = 500
	return { error: 'Persona tidak dapat diproses' }
}

export const salesPersona = new Elysia({
	prefix: '/sales-persona',
	tags: ['SalesPersona'],
})
	.use(appContext)
	.get('/meta/levels', () => ({ data: SALES_LEVELS }))
	.get('/', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, LIST_ROLES, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await SalesPersonaService.list(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	.get(
		'/:userId',
		async ({ resolvedAppId, userId, params, set }) => {
			const actor = await resolveActor(resolvedAppId, userId, GET_DETAIL_ROLES, set)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			try {
				return { data: await SalesPersonaService.getForUser(actor, params.userId) }
			} catch (error) {
				return toErrorResponse(error, set)
			}
		},
		{ params: t.Object({ userId: t.String() }) },
	)
	.put(
		'/:userId',
		async ({ resolvedAppId, userId, params, body, set }) => {
			const actor = await resolveActor(resolvedAppId, userId, WRITE_ROLES, set)
			if (!actor) return { error: 'Sesi CRM tidak valid' }
			try {
				return { data: await SalesPersonaService.upsert(actor, params.userId, body) }
			} catch (error) {
				return toErrorResponse(error, set)
			}
		},
		{
			params: t.Object({ userId: t.String() }),
			body: t.Object({
				personaType: t.Optional(t.Union([t.String({ maxLength: 20 }), t.Null()])),
				productExpertise: t.Optional(t.Any()),
				experienceYears: t.Optional(t.Union([t.Number(), t.Null()])),
				experienceLevel: t.Optional(t.Union([t.String({ maxLength: 20 }), t.Null()])),
				strengths: t.Optional(t.Array(t.String({ maxLength: 120 }))),
				weaknesses: t.Optional(t.Array(t.String({ maxLength: 120 }))),
				salesLevel: t.Optional(t.Union([t.String({ maxLength: 20 }), t.Null()])),
			}),
		},
	)
