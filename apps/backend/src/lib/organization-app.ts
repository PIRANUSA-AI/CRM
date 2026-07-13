// @ts-nocheck
import { randomBytes } from 'node:crypto'
import prisma from './prisma'

function generateAppUuid() {
	const hex = randomBytes(16).toString('hex')
	return `app_${hex}`
}

async function getAppUsageScore(appId: string) {
	const [conversations, inboxes, messages] = await Promise.all([
		prisma.conversations.count({ where: { app_id: appId } }),
		prisma.inboxes.count({ where: { app_id: appId } }),
		prisma.messages.count({ where: { app_id: appId } }),
	])

	return {
		conversations,
		inboxes,
		messages,
		score: conversations * 100 + inboxes * 10 + messages,
	}
}

async function tryRecoverHistoricalAppLink(input: {
	orgId: string
	orgName: string
	currentAppId: string
	currentAppCreatedAt?: Date | null
}) {
	const currentUsage = await getAppUsageScore(input.currentAppId)
	if (currentUsage.score > 0) return input.currentAppId

	const candidates = await prisma.apps.findMany({
		where: {
			id: { not: input.currentAppId },
			...(input.currentAppCreatedAt
				? { created_at: { lt: input.currentAppCreatedAt } }
				: {}),
			OR: [
				{ app_name: input.orgName },
				{ business_name: input.orgName },
			],
		},
		select: { id: true, created_at: true },
		orderBy: { created_at: 'asc' },
		take: 25,
	})

	let best: { id: string; score: number } | null = null
	for (const candidate of candidates) {
		const linkedOrg = await prisma.organization.findFirst({
			where: { appId: candidate.id, id: { not: input.orgId } },
			select: { id: true },
		})
		if (linkedOrg) continue

		const usage = await getAppUsageScore(candidate.id)
		if (usage.score <= 0) continue

		if (!best || usage.score > best.score) {
			best = { id: candidate.id, score: usage.score }
		}
	}

	if (!best) return input.currentAppId

	await prisma.organization.update({
		where: { id: input.orgId },
		data: { appId: best.id },
	})

	return best.id
}

export async function ensureOrganizationAppLink(org: {
	id: string
	name: string
	slug: string
	appId: string | null
	app: { id: string } | null
}) {
	const persistedOrg = await prisma.organization.findUnique({
		where: { id: org.id },
		select: {
			id: true,
			name: true,
			slug: true,
			appId: true,
			app: { select: { id: true } },
		},
	})

	const orgName = org.name || persistedOrg?.name || 'Workspace'
	const orgSlug = org.slug || persistedOrg?.slug || org.id

	if (persistedOrg?.app?.id) {
		return tryRecoverHistoricalAppLink({
			orgId: org.id,
			orgName,
			currentAppId: persistedOrg.app.id,
		})
	}

	if (persistedOrg?.appId) {
		const existingApp = await prisma.apps.findUnique({
			where: { id: persistedOrg.appId },
			select: { id: true, created_at: true },
		})
		if (existingApp?.id) {
			return tryRecoverHistoricalAppLink({
				orgId: org.id,
				orgName,
				currentAppId: existingApp.id,
				currentAppCreatedAt: existingApp.created_at,
			})
		}
	}

	if (org.app?.id) return org.app.id

	const appBySlug = await prisma.apps.findFirst({
		where: { app_id: orgSlug },
		select: { id: true },
	})
	if (appBySlug?.id) {
		await prisma.organization.update({
			where: { id: org.id },
			data: { appId: appBySlug.id },
		})
		return appBySlug.id
	}

	if (org.appId) {
		const existingApp = await prisma.apps.findUnique({
			where: { id: org.appId },
			select: { id: true, created_at: true },
		})
		if (existingApp?.id) {
			return tryRecoverHistoricalAppLink({
				orgId: org.id,
				orgName,
				currentAppId: existingApp.id,
				currentAppCreatedAt: existingApp.created_at,
			})
		}
	}

	const appId = generateAppUuid()

	const app = await prisma.apps
		.create({
			data: {
				app_id: appId,
				app_secret_hash: null,
				app_name: org.name,
				business_name: org.name,
			},
			select: { id: true },
		})
		.catch(async () => {
			const existing = await prisma.apps.findFirst({
				where: { app_id: orgSlug },
				select: { id: true },
			})
			if (!existing) throw new Error('Failed to create or resolve app link')
			return existing
		})

	await prisma.organization.update({
		where: { id: org.id },
		data: { appId: app.id },
	})

	return app.id
}
