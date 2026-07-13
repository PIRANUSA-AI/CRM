import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { MediaService } from './service'
import { MediaModel } from './model'

export const media = new Elysia({ prefix: '/media', tags: ['Media'] })
	.use(appContext)
	.post(
		'/upload',
		async ({ body, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 401
				return { error: 'Unauthorized' }
			}

			try {
				const file = body.file as File
				const platform = body.platform || 'whatsapp'

				const result = await MediaService.uploadFile(
					file,
					platform,
					userId || 'unknown',
					resolvedAppId,
				)

				return { data: result }
			} catch (err: unknown) {
				set.status = 500
				return {
					error:
						err instanceof Error ? err.message : 'Upload failed',
				}
			}
		},
		{
			body: t.Object({
				file: t.File(),
				platform: t.Optional(t.String()),
			}),
			response: {
				200: t.Object({ data: MediaModel.uploadResponse }),
				401: t.Object({ error: t.String() }),
				500: t.Object({ error: t.String() }),
			},
		},
	)
	.get(
		'/gallery',
		async ({ query, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 401
				return { error: 'Unauthorized' }
			}

			const files = await MediaService.listGallery(resolvedAppId, {
				type: query.type,
				take: query.take ? Number(query.take) : 30,
				cursor: query.cursor,
			})

			return { data: files }
		},
		{
			query: t.Object({
				type: t.Optional(t.String()),
				take: t.Optional(t.String()),
				cursor: t.Optional(t.String()),
			}),
			response: {
				200: t.Object({ data: t.Array(MediaModel.galleryItem) }),
				401: t.Object({ error: t.String() }),
			},
		},
	)
