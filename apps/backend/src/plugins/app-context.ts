import { Elysia } from 'elysia'
import { auth } from '../auth'
import prisma from '../lib/prisma'
import { ensureOrganizationAppLink } from '../lib/organization-app'
import { DeveloperKeysService } from '../modules/developer-keys/service'
import { resolveAppId } from '../lib/utils'
import { cached, hashCacheKey } from '../lib/cache'

// Tenant/app data changes rarely - a short TTL keeps every request from
// re-resolving it via Prisma while still bounding staleness after a change.
const APP_CONTEXT_CACHE_TTL_SECONDS = 45

// Routes that authenticate themselves (e.g. via their own channel key/secret
// check) don't need appContext's session/app resolution at all. Running it
// anyway wastes a bearer-token lookup + session call on every request -
// most costly on high-volume webhook routes like the WhatsApp ingest path,
// which fires once per inbound message across every connected session.
const SELF_AUTHENTICATING_PATHS = ['/api/personal-whatsapp-inbox/ingest']

const EMPTY_APP_CONTEXT = {
	orgId: null,
	orgSlug: null,
	appUuid: null,
	userId: null,
	resolvedAppId: null,
	rawAppId: null,
	integrationAuthError: null,
}

function extractBearerToken(
	requestHeaders: Headers,
	headers: Record<string, unknown>,
): string | null {
	const rawAuthHeader =
		requestHeaders.get('authorization') ||
		(headers.authorization as string | undefined) ||
		(headers.Authorization as string | undefined)

	if (!rawAuthHeader || typeof rawAuthHeader !== 'string') {
		return null
	}

	if (rawAuthHeader.toLowerCase().startsWith('bearer ')) {
		const token = rawAuthHeader.slice(7).trim()
		return token || null
	}

	return rawAuthHeader.trim() || null
}

async function getSessionFromBearerToken(token: string): Promise<{
	userId: string
} | null> {
	if (!token) return null

	const session = await prisma.session.findUnique({
		where: { token },
		select: {
			userId: true,
			expiresAt: true,
		},
	})

	if (!session) return null
	if (session.expiresAt && session.expiresAt < new Date()) return null

	return {
		userId: session.userId,
	}
}

function extractApiKey(
	requestHeaders: Headers,
	headers: Record<string, unknown>,
	query: Record<string, unknown>,
	body: unknown,
): string | null {
	const bodyRecord =
		body && typeof body === 'object' && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: null

	const candidate = [
		requestHeaders.get('x-api-key'),
		requestHeaders.get('x-app-secret'),
		(headers['x-api-key'] as string | undefined),
		(headers['X-Api-Key'] as string | undefined),
		(headers['x-app-secret'] as string | undefined),
		(headers['X-App-Secret'] as string | undefined),
		(query.api_key as string | undefined),
		(query.apiKey as string | undefined),
		(bodyRecord?.api_key as string | undefined),
		(bodyRecord?.apiKey as string | undefined),
	]
		.map((value) => String(value || '').trim())
		.find(Boolean)

	if (!candidate) return null
	const lowered = candidate.toLowerCase()
	if (lowered === 'scalesecret') return null
	if (candidate.length < 16) return null
	return candidate
}

function extractAppIdCandidate(
	requestHeaders: Headers,
	headers: Record<string, unknown>,
	query: Record<string, unknown>,
	body: unknown,
): string | null {
	const bodyRecord =
		body && typeof body === 'object' && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: null

	const candidate = [
		requestHeaders.get('x-app-id'),
		(headers['x-app-id'] as string | undefined),
		(headers['X-App-Id'] as string | undefined),
		(query.appId as string | undefined),
		(query.app_id as string | undefined),
		(query.accountId as string | undefined),
		(bodyRecord?.appId as string | undefined),
		(bodyRecord?.app_id as string | undefined),
	]
		.map((value) => String(value || '').trim())
		.find(Boolean)

	return candidate || null
}

function extractAppSecretCandidate(
	requestHeaders: Headers,
	headers: Record<string, unknown>,
	query: Record<string, unknown>,
	body: unknown,
): string | null {
	const bodyRecord =
		body && typeof body === 'object' && !Array.isArray(body)
			? (body as Record<string, unknown>)
			: null

	const candidate = [
		requestHeaders.get('x-app-secret'),
		(headers['x-app-secret'] as string | undefined),
		(headers['X-App-Secret'] as string | undefined),
		(query.appSecret as string | undefined),
		(query.app_secret as string | undefined),
		(bodyRecord?.appSecret as string | undefined),
		(bodyRecord?.app_secret as string | undefined),
	]
		.map((value) => String(value || '').trim())
		.find(Boolean)

	return candidate || null
}

export const appContext = new Elysia({ name: 'app-context' }).derive(
	{ as: 'global' },
	async ({ request, query, headers, body, params }) => {
		try {
			const pathname = new URL(request.url).pathname
			if (SELF_AUTHENTICATING_PATHS.includes(pathname)) {
				return EMPTY_APP_CONTEXT
			}

			let userId: string | null = null
			let appUuid: string | null = null
			let orgSlug: string | null = null
			let integrationAuthError: string | null = null

			const bearerToken = extractBearerToken(
				request.headers,
				headers as Record<string, unknown>,
			)

			if (bearerToken) {
				const tokenSession = await cached(
					`appctx:session:${hashCacheKey(bearerToken)}`,
					APP_CONTEXT_CACHE_TTL_SECONDS,
					() => getSessionFromBearerToken(bearerToken),
				)
				if (tokenSession) {
					userId = tokenSession.userId
				}
			}

			if (!userId) {
				try {
					const session = await auth.api.getSession({ headers: request.headers })
					if (session?.user) {
						userId = session.user.id
					}
				} catch (e) {}
			}

			if (userId) {
				const user = await cached(
					`appctx:user:${userId}`,
					APP_CONTEXT_CACHE_TTL_SECONDS,
					() =>
						prisma.users.findUnique({
							where: { id: userId as string },
							select: { app_id: true, organization_slug: true },
						}),
				)
				if (user?.app_id) {
					const resolved = await resolveAppId(user.app_id)
					const app = resolved
						? await cached(
								`appctx:app:full:${resolved}`,
								APP_CONTEXT_CACHE_TTL_SECONDS,
								() =>
									prisma.apps.findUnique({
										where: { id: resolved },
									}),
							)
						: null
					if (app) {
						appUuid = app.id
						orgSlug = app.app_id
					}
				} else {
					// CRM fallback:
					// If session user doesn't have app_id yet, resolve from organization
					// membership/slug and persist back to users.app_id.
					const org = await prisma.organization.findFirst({
						where: {
							OR: [
								...(user?.organization_slug
									? [{ slug: user.organization_slug }]
									: []),
								{ members: { some: { userId } } },
							],
						},
						select: {
							id: true,
							name: true,
							slug: true,
							appId: true,
							app: {
								select: {
									id: true,
									app_id: true,
								},
							},
						},
					})

					if (org) {
						const linkedAppId = await ensureOrganizationAppLink({
							id: org.id,
							name: org.name,
							slug: org.slug || org.id,
							appId: org.appId || null,
							app: org.app
								? {
										id: org.app.id,
									}
								: null,
						})

						const app = await prisma.apps.findUnique({
							where: { id: linkedAppId },
							select: { id: true, app_id: true },
						})

						if (app) {
							appUuid = app.id
							orgSlug = app.app_id

							await prisma.users.updateMany({
								where: { id: userId, app_id: null },
								data: { app_id: app.id },
							})
						}
					}
				}
			}

			const appIdCandidate = extractAppIdCandidate(
				request.headers,
				headers as Record<string, unknown>,
				query as Record<string, unknown>,
				body,
			)
			const appSecretCandidate = extractAppSecretCandidate(
				request.headers,
				headers as Record<string, unknown>,
				query as Record<string, unknown>,
				body,
			)

			// Integration mode: app_id is required, app_secret is optional.
			const hasIntegrationCredentials =
				Boolean(appIdCandidate) || Boolean(appSecretCandidate)

			if (!appUuid && hasIntegrationCredentials) {
				if (!appIdCandidate) {
					integrationAuthError = 'App ID required'
				} else {
					const resolved = await resolveAppId(appIdCandidate)
					if (!resolved) {
						integrationAuthError = 'Invalid app ID'
					} else {
						const app = await cached(
							`appctx:app:integration:${resolved}`,
							APP_CONTEXT_CACHE_TTL_SECONDS,
							() =>
								prisma.apps.findUnique({
									where: { id: resolved },
									select: {
										id: true,
										app_id: true,
										organization: { select: { id: true, slug: true } },
									},
								}),
						)

						if (!app) {
							integrationAuthError = 'Invalid app ID'
						} else {
							appUuid = app.id
							orgSlug = app.app_id

							// Optional hardening: if client sends app_secret, verify it.
							if (appSecretCandidate) {
								const businessIdentifier = await cached(
									`appctx:apikey:${hashCacheKey(appSecretCandidate)}`,
									APP_CONTEXT_CACHE_TTL_SECONDS,
									() =>
										DeveloperKeysService.resolveBusinessIdByApiKey(
											appSecretCandidate,
										),
								)
								const allowed = new Set<string>(
									[
										app.id,
										app.app_id,
										app.organization?.id || null,
										app.organization?.slug || null,
									].filter(Boolean) as string[],
								)

								if (!businessIdentifier || !allowed.has(businessIdentifier)) {
									appUuid = null
									orgSlug = null
									integrationAuthError = 'Invalid app secret'
								}
							}
						}
					}
				}
			}

			// Backward compatibility path (session/user-based app context) when no
			// explicit integration credentials are provided.
			if (!appUuid && !hasIntegrationCredentials) {
				const rawAppId =
					(query as any)?.appId ||
					(query as any)?.app_id ||
					(query as any)?.accountId ||
					headers['X-App-Id'] ||
					headers['x-app-id'] ||
					(body as any)?.app_id ||
					(body as any)?.appId

				if (rawAppId) {
					const resolved = await resolveAppId(rawAppId as string)
					if (resolved) {
						const app = await prisma.apps.findUnique({
							where: { id: resolved },
						})
						if (app) {
							appUuid = app.id
							orgSlug = app.app_id
						}
					}
				}
			}

			if (!appUuid && !userId) {
				try {
					const apiKey = extractApiKey(
						request.headers,
						headers as Record<string, unknown>,
						query as Record<string, unknown>,
						body,
					)
					if (apiKey) {
						const businessIdentifier = await cached(
							`appctx:apikey:${hashCacheKey(apiKey)}`,
							APP_CONTEXT_CACHE_TTL_SECONDS,
							() => DeveloperKeysService.resolveBusinessIdByApiKey(apiKey),
						)
						if (businessIdentifier) {
							const app = await prisma.apps.findFirst({
								where: {
									OR: [
										{ id: businessIdentifier },
										{ app_id: businessIdentifier },
									],
								},
							})
							if (app) {
								appUuid = app.id
								orgSlug = app.app_id
							}
						}
					}
				} catch (e) {}
			}

			return {
				orgId: null,
				orgSlug: orgSlug,
				appUuid: appUuid,
				userId,
				resolvedAppId: appUuid,
				rawAppId: orgSlug,
				integrationAuthError,
			}
		} catch (error) {
			console.error('App Context Error:', error)
			return EMPTY_APP_CONTEXT
		}
	},
)
