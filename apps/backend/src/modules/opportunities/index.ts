import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import prisma from '../../lib/prisma'
import { OpportunityService, type OpportunityActor } from './service'
import { OpportunityRequestModel } from './model'
import { DEAL_STAGES, type DealBucket } from './stages'

/**
 * Deals are visible per role (sales sees their own, leader their team), so
 * every handler needs the caller's role — not just their id.
 */
async function resolveActor(
	resolvedAppId: string | null,
	userId: string | null,
): Promise<OpportunityActor | null> {
	if (!resolvedAppId) return null
	const user = userId
		? await prisma.users.findFirst({
				where: { id: userId, app_id: resolvedAppId, deleted_at: null },
				select: { role: true },
			})
		: null
	return { appId: resolvedAppId, userId: userId ?? null, role: user?.role ?? null }
}

function asBucket(value: unknown): DealBucket | undefined {
	const v = String(value ?? '').toLowerCase()
	return v === 'prospek' || v === 'opportunity' || v === 'closed' ? v : undefined
}

export const opportunities = new Elysia({ prefix: '/opportunities', tags: ['Opportunities'] })
	.use(appContext)
	// Stage catalogue for the Pipeline board — the frontend renders one column
	// per stage, so it must not hardcode its own copy of this list.
	.get('/stages', () => ({ success: true, payload: DEAL_STAGES }))
	.get(
		'/',
		async ({ resolvedAppId, userId, query, set }) => {
			const actor = await resolveActor(resolvedAppId, userId)
			if (!actor) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const data = await OpportunityService.list(actor, {
				status: query.status || undefined,
				ownerId: query.ownerId || undefined,
				contactId: query.contactId || undefined,
				search: query.search || undefined,
				bucket: asBucket((query as Record<string, unknown>).bucket),
				limit: query.limit ? Number(query.limit) : undefined,
				offset: query.offset ? Number(query.offset) : undefined,
			})
			return {
				success: true,
				payload: data.rows,
				meta: { total: data.total, limit: data.limit, offset: data.offset },
			}
		},
		{ query: OpportunityRequestModel.listQuery },
	)
	.get(
		'/board',
		async ({ resolvedAppId, userId, query, set }) => {
			const actor = await resolveActor(resolvedAppId, userId)
			if (!actor) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const board = await OpportunityService.board(actor, {
				search: query.search || undefined,
				bucket: asBucket((query as Record<string, unknown>).bucket),
				perStage: query.perStage ? Number(query.perStage) : undefined,
				wonYear: query.wonYear ? Number(query.wonYear) : undefined,
			})
			return { success: true, payload: board }
		},
		{ query: OpportunityRequestModel.boardQuery },
	)
	.get('/stats', async ({ resolvedAppId, userId, set }) => {
		const actor = await resolveActor(resolvedAppId, userId)
		if (!actor) {
			set.status = 400
			return { error: 'App ID required' }
		}
		return { success: true, payload: await OpportunityService.stats(actor) }
	})
	.get('/:id', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId)
		if (!actor) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const opportunity = await OpportunityService.getById(actor, params.id)
		if (!opportunity) {
			set.status = 404
			return { error: 'Opportunity not found' }
		}
		return { success: true, payload: opportunity }
	})
	.post(
		'/',
		async ({ resolvedAppId, userId, body, set }) => {
			const actor = await resolveActor(resolvedAppId, userId)
			if (!actor) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				return { success: true, payload: await OpportunityService.create(actor, body) }
			} catch (error) {
				set.status = 400
				return { error: error instanceof Error ? error.message : 'Gagal membuat deal' }
			}
		},
		{ body: OpportunityRequestModel.create },
	)
	// Moving the stage is the whole lifecycle: it sets probability, status and
	// close time together, and is what turns a prospek into an opportunity.
	.patch(
		'/:id/stage',
		async ({ resolvedAppId, userId, params, body, set }) => {
			const actor = await resolveActor(resolvedAppId, userId)
			if (!actor) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const deal = await OpportunityService.moveStage(
				actor,
				params.id,
				body.stage,
				body.probability ?? null,
			)
			if (!deal) {
				set.status = 404
				return { error: 'Deal tidak ditemukan atau di luar akses Anda' }
			}
			return { success: true, payload: deal }
		},
		{
			body: t.Object({
				stage: t.String({ maxLength: 60 }),
				probability: t.Optional(t.Union([t.Number(), t.Null()])),
			}),
		},
	)
	.patch(
		'/:id',
		async ({ resolvedAppId, userId, params, body, set }) => {
			const actor = await resolveActor(resolvedAppId, userId)
			if (!actor) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const opportunity = await OpportunityService.update(actor, params.id, body)
			if (!opportunity) {
				set.status = 404
				return { error: 'Opportunity not found' }
			}
			return { success: true, payload: opportunity }
		},
		{ body: OpportunityRequestModel.update },
	)
	.delete('/:id', async ({ resolvedAppId, userId, params, set }) => {
		const actor = await resolveActor(resolvedAppId, userId)
		if (!actor) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const ok = await OpportunityService.remove(actor, params.id)
		if (!ok) {
			set.status = 404
			return { error: 'Opportunity not found' }
		}
		return { success: true }
	})
