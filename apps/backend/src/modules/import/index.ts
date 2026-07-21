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
const ALLOWED_ROLES: CanonicalRole[] = ['leader', 'administrator', 'ceo', 'superadmin']
// Prospecting is sales-owned: a sales logs their own sourced leads.
const PROSPECT_ROLES: CanonicalRole[] = ['sales', 'leader', 'administrator', 'ceo', 'superadmin']

async function resolveActorFor(
	roles: CanonicalRole[],
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<ImportActor | null> {
	if (!resolvedAppId || !userId) {
		set.status = 401
		return null
	}
	const authorization = await requireRole(userId, roles)
	if (!authorization.ok) {
		set.status = authorization.status
		return null
	}
	return { appId: resolvedAppId, userId, role: authorization.role as CanonicalRole }
}

async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
	set: { status?: number | string },
): Promise<ImportActor | null> {
	return resolveActorFor(ALLOWED_ROLES, resolvedAppId, userId, set)
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
	.get('/assignables', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await ImportService.listAssignables(actor) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	})
	.post('/manual-lead', async ({ resolvedAppId, userId, body, set }) => {
		const actor = await resolveActor(resolvedAppId, userId, set)
		if (!actor) return { error: 'Akses hanya untuk leader/ceo/superadmin' }
		try {
			return { data: await ImportService.createManualLead(actor, body) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		body: t.Object({
			name: t.String({ minLength: 1, maxLength: 255 }),
			phone: t.Optional(t.String({ maxLength: 40 })),
			email: t.Optional(t.String({ maxLength: 255 })),
			company: t.Optional(t.String({ maxLength: 255 })),
			city: t.Optional(t.String({ maxLength: 120 })),
			productInterest: t.Optional(t.String({ maxLength: 255 })),
			pipelineStage: t.Optional(t.String({ maxLength: 80 })),
			notes: t.Optional(t.String({ maxLength: 2000 })),
			assignedTo: t.String({ minLength: 1 }),
		}),
	})
	.post('/prospect', async ({ resolvedAppId, userId, body, set }) => {
		const actor = await resolveActorFor(PROSPECT_ROLES, resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return { data: await ImportService.createProspect(actor, body) }
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		body: t.Object({
			name: t.String({ minLength: 1, maxLength: 255 }),
			phone: t.Optional(t.String({ maxLength: 40 })),
			email: t.Optional(t.String({ maxLength: 255 })),
			company: t.Optional(t.String({ maxLength: 255 })),
			city: t.Optional(t.String({ maxLength: 120 })),
			productInterest: t.Optional(t.String({ maxLength: 255 })),
			channel: t.Optional(t.String({ maxLength: 40 })),
			notes: t.Optional(t.String({ maxLength: 2000 })),
			followUpAt: t.Optional(t.String({ maxLength: 40 })),
			assigneeId: t.Optional(t.String({ maxLength: 64 })),
			dealName: t.Optional(t.String({ maxLength: 255 })),
			dealValue: t.Optional(t.Nullable(t.Number())),
			dealStage: t.Optional(t.String({ maxLength: 60 })),
		}),
	})
	// Same roles as /prospect: this serves the form that calls it, and a sales
	// who cannot check for a duplicate is exactly who creates one.
	.get('/contact-lookup', async ({ resolvedAppId, userId, query, set }) => {
		const actor = await resolveActorFor(PROSPECT_ROLES, resolvedAppId, userId, set)
		if (!actor) return { error: 'Sesi CRM tidak valid' }
		try {
			return {
				data: await ImportService.lookupContact(actor, {
					phone: query.phone || null,
					email: query.email || null,
				}),
			}
		} catch (error) {
			return toErrorResponse(error, set)
		}
	}, {
		query: t.Object({
			phone: t.Optional(t.String({ maxLength: 40 })),
			email: t.Optional(t.String({ maxLength: 255 })),
		}),
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
