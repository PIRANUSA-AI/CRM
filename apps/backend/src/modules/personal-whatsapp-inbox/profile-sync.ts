import crypto from 'node:crypto'
import { Worker, type Job } from 'bullmq'
import prisma from '../../lib/prisma'
import { redis } from '../../lib/redis'
import { whatsappProfileSyncQueue } from '../../lib/queue'
import { MediaService } from '../media/service'
import { BaileysServiceClient } from '../whatsapp/baileys-service-client'
import { emitRealtimeToRoom } from '../../lib/realtime-emitter'
import { normalizeS3PublicUrl } from '../../lib/s3'

type ProfileJob = { appId: string; channelId: string; contactId?: string; force?: boolean }

function asRecord(value: unknown): Record<string, any> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, any>
}

async function syncContact(job: ProfileJob) {
	if (!job.contactId) return { skipped: true }
	const [contact, channel, session] = await Promise.all([
		prisma.contacts.findFirst({ where: { id: job.contactId, app_id: job.appId, deleted_at: null } }),
		prisma.whatsapp_channels.findFirst({ where: { id: job.channelId, app_id: job.appId, provider: 'baileys', deleted_at: null } }),
		prisma.baileys_sessions.findFirst({ where: { channel_id: job.channelId, app_id: job.appId } }),
	])
	const phone = String(contact?.phone_number || contact?.whatsapp_id || '').replace(/\D/g, '')
	if (!contact || !channel?.api_key || !session || !phone) return { skipped: true }
	const attributes = asRecord(contact.additional_attributes)
	const normalizedAvatarUrl = normalizeS3PublicUrl(contact.avatar_url)
	if (normalizedAvatarUrl && normalizedAvatarUrl !== contact.avatar_url) {
		await Promise.all([
			prisma.contacts.update({ where: { id: contact.id }, data: { avatar_url: normalizedAvatarUrl, updated_at: new Date() } }),
			prisma.media_files.updateMany({
				where: { app_id: job.appId, OR: [{ media_url: contact.avatar_url }, { local_url: contact.avatar_url }] },
				data: { media_url: normalizedAvatarUrl, local_url: normalizedAvatarUrl },
			}),
		])
		emitRealtimeToRoom(`app:${job.appId}`, 'contact:profile_updated', { contactId: contact.id, avatarUrl: normalizedAvatarUrl })
	}
	const lastFetchedAt = new Date(String(attributes.profile_picture_fetched_at || 0))
	if (!job.force && Number.isFinite(lastFetchedAt.valueOf()) && Date.now() - lastFetchedAt.valueOf() < 7 * 24 * 60 * 60 * 1000) {
		return { skipped: true, fresh: true }
	}
	const credentials = { Authorization: `Bearer ${channel.api_key}`, 'X-Crm-Channel-Secret': channel.api_key }
	const profile = await BaileysServiceClient.getProfilePicture({ channelKey: session.provider_channel_key, phoneNumber: phone }, credentials)
	const fetchedAt = new Date().toISOString()
	if (!profile.available || !profile.url) {
		await prisma.contacts.update({
			where: { id: contact.id },
			data: { additional_attributes: { ...attributes, profile_picture_fetched_at: fetchedAt, profile_picture_available: false } as any, updated_at: new Date() },
		})
		return { updated: false, unavailable: true }
	}
	const response = await fetch(profile.url, { signal: AbortSignal.timeout(15_000) })
	if (!response.ok) throw new Error(`Profile picture download failed (HTTP ${response.status})`)
	const mimeType = response.headers.get('content-type') || 'image/jpeg'
	const buffer = Buffer.from(await response.arrayBuffer())
	if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw new Error('Invalid profile picture response')
	const hash = crypto.createHash('sha256').update(buffer).digest('hex')
	if (attributes.profile_picture_hash === hash && contact.avatar_url) {
		await prisma.contacts.update({
			where: { id: contact.id },
			data: { additional_attributes: { ...attributes, profile_picture_fetched_at: fetchedAt, profile_picture_available: true } as any, updated_at: new Date() },
		})
		return { updated: false, unchanged: true }
	}
	const extension = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg'
	const uploaded = await MediaService.uploadFile(
		new File([new Uint8Array(buffer)], `profile-${contact.id}.${extension}`, { type: mimeType }),
		'whatsapp-profile',
		session.owner_user_id || 'system',
		job.appId,
	)
	await prisma.contacts.update({
		where: { id: contact.id },
		data: {
			avatar_url: uploaded.url,
			additional_attributes: {
				...attributes,
				profile_picture_hash: hash,
				profile_picture_fetched_at: fetchedAt,
				profile_picture_available: true,
				profile_picture_source: 'baileys_image',
			} as any,
			updated_at: new Date(),
		},
	})
	emitRealtimeToRoom(`app:${job.appId}`, 'contact:profile_updated', { contactId: contact.id, avatarUrl: uploaded.url })
	return { updated: true }
}

async function enqueueDueContacts(job: ProfileJob) {
	const channel = await prisma.whatsapp_channels.findFirst({
		where: { id: job.channelId, app_id: job.appId, provider: 'baileys', deleted_at: null }, select: { inbox_id: true },
	})
	if (!channel?.inbox_id) return { queued: 0 }
	const ignoredPhones = new Set(
		(await prisma.$queryRaw<Array<{ phone_number: string }>>`
			SELECT "phone_number" FROM "whatsapp_lead_registrations"
			WHERE "app_id" = ${job.appId}::uuid AND "status" = 'ignored'
		`).map((r) => r.phone_number)
	)
	const contacts = await prisma.contacts.findMany({
		where: {
			app_id: job.appId, deleted_at: null,
			phone_number: ignoredPhones.size ? { notIn: Array.from(ignoredPhones) } : undefined,
			conversations: { some: { inbox_id: channel.inbox_id, deleted_at: null } },
		},
		select: { id: true, phone_number: true, avatar_url: true, additional_attributes: true }, take: 10_000,
	})
	let queued = 0
	for (const contact of contacts) {
		const lastFetchedAt = new Date(String(asRecord(contact.additional_attributes).profile_picture_fetched_at || 0))
		const urlNeedsRepair = Boolean(contact.avatar_url && normalizeS3PublicUrl(contact.avatar_url) !== contact.avatar_url)
		const due = job.force || urlNeedsRepair || !Number.isFinite(lastFetchedAt.valueOf()) || Date.now() - lastFetchedAt.valueOf() >= 7 * 24 * 60 * 60 * 1000
		if (!due) continue
		await whatsappProfileSyncQueue.add('contact', { appId: job.appId, channelId: job.channelId, contactId: contact.id, force: job.force }, {
			jobId: `profile-${job.channelId}-${contact.id}-${Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000))}`,
			attempts: 4,
			backoff: { type: 'exponential', delay: 15_000 },
			removeOnComplete: 5000,
			removeOnFail: 5000,
			delay: queued * 250,
		})
		queued += 1
	}
	return { queued }
}

export async function enqueueProfileSweep(appId: string, channelId: string, force = false) {
	await whatsappProfileSyncQueue.add('sweep', { appId, channelId, force }, {
		jobId: `profile-sweep-${channelId}-${force ? Date.now() : Math.floor(Date.now() / 86_400_000)}`,
		removeOnComplete: 30,
		removeOnFail: 30,
	})
	await whatsappProfileSyncQueue.add('sweep', { appId, channelId }, {
		jobId: `profile-weekly-${channelId}`,
		repeat: { every: 24 * 60 * 60 * 1000 },
		removeOnComplete: 30,
		removeOnFail: 30,
	})
}

export async function enqueueProfileContact(appId: string, channelId: string, contactId: string, force = true) {
	await whatsappProfileSyncQueue.add('contact', { appId, channelId, contactId, force }, {
		jobId: `profile-change-${channelId}-${contactId}-${Math.floor(Date.now() / 60_000)}`,
		attempts: 4,
		backoff: { type: 'exponential', delay: 10_000 },
		removeOnComplete: 1000,
		removeOnFail: 1000,
	})
}

// Start the profile-sync consumer. Called explicitly from the worker entry
// (src/workers) so it runs ONCE in the worker process only. Importing this module
// from an API route (for the enqueue helpers below) must not spin up a duplicate
// consumer in every process. That side effect left multiple half-dead workers
// that stopped draining the queue after hot-reloads.
export function startWhatsappProfileSyncWorker() {
	return new Worker<ProfileJob>(
		'whatsapp-profile-sync',
		async (job: Job<ProfileJob>) =>
			job.name === 'sweep' ? enqueueDueContacts(job.data) : syncContact(job.data),
		{ connection: redis, concurrency: 4 },
	)
}
