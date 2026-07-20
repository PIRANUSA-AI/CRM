import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { SaktiService } from './service'
import { SaktiRequestModel } from './model'
import { LETTER_TEMPLATES } from './letter-templates'

export const sakti = new Elysia({ prefix: '/sakti', tags: ['Sakti'] })
	.use(appContext)
	// --- Database Sakti records ---
	.get(
		'/records',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const result = await SaktiService.listRecords(resolvedAppId, {
				search: query.search || undefined,
				limit: query.limit ? Number(query.limit) : undefined,
				offset: query.offset ? Number(query.offset) : undefined,
			})
			return { success: true, payload: result.data, meta: result.meta }
		},
		{ query: SaktiRequestModel.listQuery },
	)
	// CSV import. `dryRun` previews without writing so the operator sees which
	// rows will be skipped as duplicates before committing.
	.post(
		'/records/import',
		async ({ resolvedAppId, userId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				const result = await SaktiService.importRecords(
					{ appId: resolvedAppId, userId: userId ?? null },
					{ content: body.content, dryRun: body.dryRun === true },
				)
				return { success: true, payload: result }
			} catch (error) {
				set.status = 400
				return { error: error instanceof Error ? error.message : 'Gagal mengimpor data' }
			}
		},
		{
			body: t.Object({
				content: t.String(),
				dryRun: t.Optional(t.Boolean()),
			}),
		},
	)
	.post(
		'/records',
		async ({ resolvedAppId, userId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				const record = await SaktiService.createRecord(
					{ appId: resolvedAppId, userId: userId ?? null },
					body,
				)
				return { success: true, payload: record }
			} catch (error) {
				set.status = 400
				return { error: error instanceof Error ? error.message : 'Gagal menyimpan' }
			}
		},
		{ body: SaktiRequestModel.createRecord },
	)
	.delete('/records/:id', async ({ resolvedAppId, params, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const ok = await SaktiService.removeRecord(resolvedAppId, params.id)
		if (!ok) {
			set.status = 404
			return { error: 'Record not found' }
		}
		return { success: true }
	})
	// --- The Sakti check ---
	.post(
		'/check',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const result = await SaktiService.check(resolvedAppId, body)
			return { success: true, payload: result }
		},
		{ body: SaktiRequestModel.check },
	)
	// --- Surat Sakti letters ---
	// Template catalogue. The frontend renders the picker and the per-template
	// field list from this, so it must not keep its own copy.
	.get('/templates', () => ({ success: true, payload: LETTER_TEMPLATES }))
	.post(
		'/templates/preview',
		async ({ body, set }) => {
			try {
				return {
					success: true,
					payload: SaktiService.previewLetter(body.template, body.values || {}),
				}
			} catch (error) {
				set.status = 400
				return { error: error instanceof Error ? error.message : 'Gagal merender surat' }
			}
		},
		{
			body: t.Object({
				template: t.String({ maxLength: 60 }),
				values: t.Optional(t.Record(t.String(), t.Any())),
			}),
		},
	)
	.get(
		'/letters',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const data = await SaktiService.listLetters(resolvedAppId, {
				status: query.status || undefined,
			})
			return { success: true, payload: data }
		},
		{ query: t.Object({ status: t.Optional(t.String()) }) },
	)
	.post(
		'/letters',
		async ({ resolvedAppId, userId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			try {
				const letter = await SaktiService.createLetter(
					{ appId: resolvedAppId, userId: userId ?? null },
					body,
				)
				return { success: true, payload: letter }
			} catch (error) {
				set.status = 400
				return { error: error instanceof Error ? error.message : 'Gagal membuat surat' }
			}
		},
		{ body: SaktiRequestModel.createLetter },
	)
	.patch(
		'/letters/:id',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const letter = await SaktiService.updateLetter(resolvedAppId, params.id, body)
			if (!letter) {
				set.status = 404
				return { error: 'Letter not found' }
			}
			return { success: true, payload: letter }
		},
		{ body: SaktiRequestModel.updateLetter },
	)
	.delete('/letters/:id', async ({ resolvedAppId, params, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}
		const ok = await SaktiService.removeLetter(resolvedAppId, params.id)
		if (!ok) {
			set.status = 404
			return { error: 'Letter not found' }
		}
		return { success: true }
	})
