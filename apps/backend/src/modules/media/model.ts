import { t } from 'elysia'

export const MediaModel = {
	uploadResponse: t.Object({
		url: t.String(),
		type: t.String(),
		mimeType: t.String(),
		fileName: t.String(),
		fileSize: t.Number(),
		key: t.String(),
		checksumSha256: t.Optional(t.String()),
	}),
	galleryItem: t.Object({
		id: t.String(),
		media_type: t.Nullable(t.String()),
		mime_type: t.Nullable(t.String()),
		filename: t.Nullable(t.String()),
		file_size: t.Nullable(t.Number()),
		url: t.Nullable(t.String()),
		created_at: t.Nullable(t.Date()),
	}),
} as const
