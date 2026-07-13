import { PutObjectCommand } from '@aws-sdk/client-s3'
import {
	s3,
	BUCKET_NAME,
	buildS3PublicUrl,
	getS3UploadConfigurationError,
} from '../../lib/s3'
import prisma from '../../lib/prisma'
import crypto from 'crypto'

export abstract class MediaService {
	static async uploadFile(
		file: File,
		platform: string,
		agentId: string,
		appId: string,
	) {
		const mimeType = file.type
		const fileName = file.name
		const fileSize = file.size

		let type: 'image' | 'video' | 'audio' | 'document' = 'document'
		if (mimeType.startsWith('image/')) type = 'image'
		else if (mimeType.startsWith('video/')) type = 'video'
		else if (mimeType.startsWith('audio/')) type = 'audio'

		const extension = fileName.split('.').pop() || 'bin'
		const mediaId = crypto.randomBytes(8).toString('hex')
		const key = `${platform}/${type}/${mediaId}.${extension}`

		const s3ConfigError = getS3UploadConfigurationError()
		if (s3ConfigError) {
			throw new Error(s3ConfigError)
		}

		const arrayBuffer = await file.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const checksumSha256 = crypto
			.createHash('sha256')
			.update(buffer)
			.digest('hex')

		await s3.send(
			new PutObjectCommand({
				Bucket: BUCKET_NAME,
				Key: key,
				Body: buffer,
				ContentType: mimeType,
				Metadata: {
					originalName: fileName,
					platform,
					agentId,
					appId,
					checksumsha256: checksumSha256,
				},
			}),
		)

		const publicUrl = buildS3PublicUrl(key)
		if (!publicUrl) {
			throw new Error('S3 public URL is not configured')
		}

		await prisma.media_files.create({
			data: {
				app_id: appId,
				platform,
				media_id: mediaId,
				media_type: type,
				mime_type: mimeType,
				filename: fileName,
				file_size: BigInt(fileSize),
				media_url: publicUrl,
				local_url: publicUrl,
				download_status: 'completed',
				downloaded_at: new Date(),
				uploaded_by: agentId,
			},
		})

		return {
			url: publicUrl,
			type,
			mimeType,
			fileName,
			fileSize,
			key,
			checksumSha256,
		}
	}

	static async listGallery(
		appId: string,
		options: { type?: string; take?: number; cursor?: string },
	) {
		const where: Record<string, unknown> = {
			app_id: appId,
			download_status: 'completed',
		}
		if (options.type) {
			where.media_type = options.type
		}

		const files = await prisma.media_files.findMany({
			where,
			orderBy: { created_at: 'desc' },
			take: options.take || 30,
			...(options.cursor && {
				skip: 1,
				cursor: { id: options.cursor },
			}),
			select: {
				id: true,
				media_type: true,
				mime_type: true,
				filename: true,
				file_size: true,
				media_url: true,
				local_url: true,
				created_at: true,
			},
		})

		return files.map((f) => ({
			...f,
			file_size: f.file_size ? Number(f.file_size) : null,
			url: f.local_url || f.media_url,
		}))
	}
}
