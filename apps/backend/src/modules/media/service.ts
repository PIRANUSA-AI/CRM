import { PutObjectCommand } from '@aws-sdk/client-s3'
import {
	s3,
	BUCKET_NAME,
	buildS3PublicUrl,
	getS3UploadConfigurationError,
} from '../../lib/s3'
import prisma from '../../lib/prisma'
import crypto from 'crypto'
import { spawn } from 'node:child_process'
import ffmpegStaticPath from 'ffmpeg-static'

type MediaPurpose = 'attachment' | 'voice' | 'gif' | 'sticker'

function runFfmpeg(input: Buffer, args: string[]) {
	return new Promise<Buffer>((resolve, reject) => {
		const ffmpegExecutable = process.env.FFMPEG_PATH || (process.platform === 'win32' ? ffmpegStaticPath : null) || 'ffmpeg'
		const child = spawn(ffmpegExecutable, ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', ...args, 'pipe:1'], {
			stdio: ['pipe', 'pipe', 'pipe'],
		})
		const stdout: Buffer[] = []
		const stderr: Buffer[] = []
		child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk))
		child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk))
		child.on('error', (error) => reject(new Error(`FFmpeg tidak tersedia: ${error.message}`)))
		child.on('close', (code) => {
			if (code === 0 && stdout.length) return resolve(Buffer.concat(stdout))
			reject(new Error(Buffer.concat(stderr).toString('utf8').trim() || 'Konversi media gagal'))
		})
		child.stdin.end(input)
	})
}

async function prepareMedia(file: File, purpose: MediaPurpose) {
	const source = Buffer.from(await file.arrayBuffer())
	if (purpose === 'voice') {
		return {
			buffer: await runFfmpeg(source, ['-vn', '-c:a', 'libopus', '-ac', '1', '-ar', '48000', '-b:a', '32k', '-f', 'ogg']),
			mimeType: 'audio/ogg; codecs=opus', fileName: `${file.name.replace(/\.[^.]+$/, '') || 'voice-note'}.ogg`, type: 'audio' as const,
		}
	}
	if (purpose === 'gif') {
		return {
			buffer: await runFfmpeg(source, ['-an', '-movflags', 'frag_keyframe+empty_moov', '-pix_fmt', 'yuv420p', '-vf', "scale='min(720,iw)':-2:force_original_aspect_ratio=decrease", '-c:v', 'libx264', '-f', 'mp4']),
			mimeType: 'video/mp4', fileName: `${file.name.replace(/\.[^.]+$/, '') || 'animation'}.mp4`, type: 'video' as const,
		}
	}
	if (purpose === 'sticker') {
		return {
			buffer: await runFfmpeg(source, ['-vf', "scale=512:512:force_original_aspect_ratio=decrease,pad=512:512:(ow-iw)/2:(oh-ih)/2:color=0x00000000", '-vcodec', 'libwebp', '-lossless', '0', '-compression_level', '6', '-q:v', '75', '-f', 'webp']),
			mimeType: 'image/webp', fileName: `${file.name.replace(/\.[^.]+$/, '') || 'sticker'}.webp`, type: 'image' as const,
		}
	}
	let type: 'image' | 'video' | 'audio' | 'document' = 'document'
	if (file.type.startsWith('image/')) type = 'image'
	else if (file.type.startsWith('video/')) type = 'video'
	else if (file.type.startsWith('audio/')) type = 'audio'
	return { buffer: source, mimeType: file.type || 'application/octet-stream', fileName: file.name || 'attachment', type }
}

export abstract class MediaService {
	static async uploadFile(
		file: File,
		platform: string,
		agentId: string,
		appId: string,
		purpose: MediaPurpose = 'attachment',
	) {
		const prepared = await prepareMedia(file, purpose)
		const { buffer, mimeType, fileName, type } = prepared
		const fileSize = buffer.length

		const extension = fileName.split('.').pop() || 'bin'
		const mediaId = crypto.randomBytes(8).toString('hex')
		const key = `${platform}/${type}/${mediaId}.${extension}`

		const s3ConfigError = getS3UploadConfigurationError()
		if (s3ConfigError) {
			throw new Error(s3ConfigError)
		}

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
