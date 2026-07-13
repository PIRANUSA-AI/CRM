import { Elysia, t } from 'elysia'
import { GetObjectCommand } from '@aws-sdk/client-s3'
import { appContext } from '../../plugins'
import prisma from '../../lib/prisma'
import { BUCKET_NAME, getS3KeyFromPublicUrl, s3 } from '../../lib/s3'
import { MediaService } from './service'
import { MediaModel } from './model'

export const media = new Elysia({ prefix: '/media', tags: ['Media'] })
	.use(appContext)
	.get('/messages/:messageId/download', async ({ params, resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 401
			return { error: 'Unauthorized' }
		}
		const message = await prisma.messages.findFirst({
			where: { id: params.messageId, app_id: resolvedAppId, deleted_at: null },
			select: { content_attributes: true },
		})
		const attributes = message?.content_attributes && typeof message.content_attributes === 'object' && !Array.isArray(message.content_attributes)
			? message.content_attributes as Record<string, any>
			: {}
		const media = attributes.media && typeof attributes.media === 'object' && !Array.isArray(attributes.media)
			? attributes.media as Record<string, any>
			: {}
		const key = getS3KeyFromPublicUrl(typeof media.url === 'string' ? media.url : null)
		if (!message || !key) {
			set.status = 404
			return { error: 'File tidak ditemukan' }
		}
		try {
			const object = await s3.send(new GetObjectCommand({ Bucket: BUCKET_NAME, Key: key }))
			if (!object.Body) throw new Error('Empty object body')
			const bytes = await object.Body.transformToByteArray()
			const rawName = String(media.file_name || media.filename || key.split('/').pop() || 'download')
			const safeName = rawName.replace(/[\r\n"\\/]/g, '_').slice(0, 180) || 'download'
			const encodedName = encodeURIComponent(rawName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`)
			return new Response(new Blob([new Uint8Array(bytes)], { type: object.ContentType || media.mime_type || 'application/octet-stream' }), {
				headers: {
					'Content-Type': object.ContentType || media.mime_type || 'application/octet-stream',
					'Content-Disposition': `attachment; filename="${safeName}"; filename*=UTF-8''${encodedName}`,
					'Cache-Control': 'private, max-age=3600',
				},
			})
		} catch (error) {
			console.error('[Media] Download failed', { messageId: params.messageId, key, error })
			set.status = 404
			return { error: 'File tidak tersedia di penyimpanan' }
		}
	}, { params: t.Object({ messageId: t.String() }) })
	.post(
		'/upload',
		async ({ body, resolvedAppId, userId, set }) => {
			if (!resolvedAppId) {
				set.status = 401
				return { error: 'Unauthorized' }
			}

			try {
				const file = body.file as File
				if (file.size > 25 * 1024 * 1024) {
					set.status = 413
					return { error: 'File exceeds the 25 MB limit' }
				}
				const platform = body.platform || 'whatsapp'

				const result = await MediaService.uploadFile(
					file,
					platform,
					userId || 'unknown',
					resolvedAppId,
					body.purpose,
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
				purpose: t.Optional(t.Union([t.Literal('attachment'), t.Literal('voice'), t.Literal('gif'), t.Literal('sticker')])),
			}),
			response: {
				200: t.Object({ data: MediaModel.uploadResponse }),
				401: t.Object({ error: t.String() }),
				413: t.Object({ error: t.String() }),
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
