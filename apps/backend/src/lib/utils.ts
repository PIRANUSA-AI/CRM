import prisma from './prisma'

/**
 * Helper to check if string is a valid UUID
 */
export const isUuid = (str: string | null | undefined): str is string =>
	!!str &&
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str)

/**
 * Resolve appId (slug or UUID) to the internal UUID
 */
export async function resolveAppId(
	appId: string | null | undefined,
): Promise<string | null> {
	if (!appId || appId === 'default' || appId === 'undefined') return null
	if (isUuid(appId)) return appId

	const app = await prisma.apps.findFirst({
		where: { app_id: appId },
		select: { id: true },
	})

	return app?.id || null
}

/**
 * Resolve organizationId (string) to the internal ID
 */
export async function resolveOrganizationId(
	organizationId: string | null | undefined,
): Promise<string | null> {
	if (
		!organizationId ||
		organizationId === 'default' ||
		organizationId === 'undefined'
	)
		return null
	return organizationId
}
