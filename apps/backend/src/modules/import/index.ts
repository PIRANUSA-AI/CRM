import { Elysia, t } from 'elysia'
import { requireRole, type CanonicalRole } from '../../lib/require-role'
import { appContext } from '../../plugins'
import { ImportRequestModel } from './model'
import {
	ImportError,
	ImportNotFoundError,
	ImportService,
	type ImportActor,
} from './service'

// Import is a management action: it distributes leads to multiple sales.
const ALLOWED_ROLES: CanonicalRole[] = ['leader', 'ceo', 'superadmin']

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<ImportActor | null> {
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
	if (error instanceof ImportNotFoundError) {
		set.status = 404
		return { error: error.message }
	}
	if (error instanceof ImportError) {
		set.status = 400
		return { error: error.message }
	}
	if (error instanceof Error) {
		set.status = 400
		return { error: error.message }
	}
	set.status = 500
	return { error: 'Import tidak dapat diproses' }
}

export const importLeads = new Elysia({ prefix: '/import', tags: ['Import'] })
	.use(appContext)
	.get('/history', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses import hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await ImportService.history(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	.post('/csv/preview', async ({ resolvedAppId, userId, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses import hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await ImportService.preview(actor, body.filename || null, body.content) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { body: ImportRequestModel.preview })
	.get('/jobs/:id', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses import hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await ImportService.getJob(actor, params.id) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }) })
	.patch('/jobs/:id/rows/:rowId', async ({ resolvedAppId, userId, params, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses import hanya untuk leader/ceo/superadmin' }
		try {
			return {
				data: await ImportService.updateRowAssignee(
					actor,
					params.id,
					params.rowId,
					body.assignedTo ?? null,
				),
			}
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String(), rowId: t.String() }), body: ImportRequestModel.updateRow })
	.post('/jobs/:id/commit', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses import hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await ImportService.commit(actor, params.id) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, { params: t.Object({ id: t.String() }) })
