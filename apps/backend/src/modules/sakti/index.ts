import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { SaktiService } from './service'
import { SaktiRequestModel } from './model'

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
			const data = await SaktiService.listRecords(resolvedAppId, {
				search: query.search || undefined,
				limit: query.limit ? Number(query.limit) : undefined,
				offset: query.offset ? Number(query.offset) : undefined,
			})
			return { success: true, payload: data }
		},
		{ query: SaktiRequestModel.listQuery },
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
