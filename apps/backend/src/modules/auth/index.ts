// @ts-nocheck
import bcrypt from 'bcryptjs'
import { Elysia, t } from 'elysia'
import { auth } from '../../auth'
import { syncBetterAuthCredentialAccount } from '../../lib/better-auth-credentials'
import { ensureOrganizationAppLink } from '../../lib/organization-app'
import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'

const DEFAULT_ONBOARDING_TEAM_NAME = 'Customer Service'
const DEFAULT_ONBOARDING_TEAM_DESCRIPTION = ''
const DEFAULT_ONBOARDING_DIVISION_NAME = 'Customer Service'
const DEFAULT_ONBOARDING_DIVISION_DESCRIPTION = ''
const DEFAULT_ONBOARDING_DIVISION_COLOR = '#10B981'

function normalizeCompanyName(value: unknown) {
	return String(value || '')
		.trim()
		.replace(/\s+/g, ' ')
}

function slugifyCompanySlug(value: unknown) {
	return String(value || '')
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9\s-]/g, '')
		.replace(/\s+/g, '-')
		.replace(/-+/g, '-')
		.replace(/^-|-$/g, '')
}

function isValidCompanySlug(slug: string) {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)
}

function getBearerTokenFromHeader(request: Request): string | null {
	const rawAuthHeader = request.headers.get('authorization')
	if (!rawAuthHeader) return null

	const trimmed = String(rawAuthHeader).trim()
	if (!trimmed) return null

	if (trimmed.toLowerCase().startsWith('bearer ')) {
		return trimmed.slice(7).trim() || null
	}

	return trimmed || null
}

async function getSessionUserFromToken(token: string) {
	const session = await prisma.session.findUnique({
		where: { token },
		select: {
			userId: true,
			expiresAt: true,
		},
	})

	if (!session) return null
	if (session.expiresAt && session.expiresAt < new Date()) return null

	return prisma.users.findUnique({
		where: { id: session.userId },
		select: {
			id: true,
			name: true,
			email: true,
			app_id: true,
			organization_name: true,
			organization_slug: true,
		},
	})
}

async function ensureDefaultTeamAndDivision(
	db: any,
	options: { appId: string; userId: string },
) {
	let team = await db.teams.findFirst({
		where: {
			app_id: options.appId,
			name: DEFAULT_ONBOARDING_TEAM_NAME,
		},
		select: { id: true },
	})

	if (!team) {
		team = await db.teams.create({
			data: {
				id: crypto.randomUUID(),
				name: DEFAULT_ONBOARDING_TEAM_NAME,
				description: DEFAULT_ONBOARDING_TEAM_DESCRIPTION,
				app_id: options.appId,
			},
			select: { id: true },
		})
	}

	await db.team_members.createMany({
		data: [
			{
				team_id: team.id,
				user_id: options.userId,
			},
		],
		skipDuplicates: true,
	})

	let division = await db.divisions.findFirst({
		where: {
			app_id: options.appId,
			name: DEFAULT_ONBOARDING_DIVISION_NAME,
		},
		select: { id: true },
	})

	if (!division) {
		division = await db.divisions.create({
			data: {
				id: crypto.randomUUID(),
				name: DEFAULT_ONBOARDING_DIVISION_NAME,
				description: DEFAULT_ONBOARDING_DIVISION_DESCRIPTION,
				color: DEFAULT_ONBOARDING_DIVISION_COLOR,
				app_id: options.appId,
			},
			select: { id: true },
		})
	}

	await db.agent_divisions.createMany({
		data: [
			{
				user_id: options.userId,
				division_id: division.id,
			},
		],
		skipDuplicates: true,
	})
}

async function getAuthenticatedSessionUser(request: Request) {
	const session = await auth.api.getSession({ headers: request.headers }).catch(() => null)
	const userId = String(session?.user?.id || '').trim()
	if (userId) {
		return prisma.users.findUnique({
			where: { id: userId },
			select: {
				id: true,
				name: true,
				email: true,
				app_id: true,
				organization_name: true,
				organization_slug: true,
			},
		})
	}

	const bearerToken = getBearerTokenFromHeader(request)
	if (!bearerToken) return null

	return getSessionUserFromToken(bearerToken)
}

async function resolveWorkspaceContextForUser(userId: string) {
	const user = await prisma.users.findUnique({
		where: { id: userId },
		select: {
			id: true,
			name: true,
			app_id: true,
			organization_name: true,
			organization_slug: true,
		},
	})

	if (!user) return null

	let organization = null

	if (user.app_id) {
		organization = await prisma.organization.findFirst({
			where: { appId: user.app_id },
			select: {
				id: true,
				name: true,
				slug: true,
				appId: true,
				app: { select: { id: true } },
			},
		})
	}

	if (!organization && user.organization_slug) {
		organization = await prisma.organization.findFirst({
			where: { slug: user.organization_slug },
			select: {
				id: true,
				name: true,
				slug: true,
				appId: true,
				app: { select: { id: true } },
			},
		})
	}

	if (!organization) {
		organization = await prisma.organization.findFirst({
			where: { members: { some: { userId: user.id } } },
			orderBy: { createdAt: 'asc' },
			select: {
				id: true,
				name: true,
				slug: true,
				appId: true,
				app: { select: { id: true } },
			},
		})
	}

	if (organization) {
		const linkedAppId = await ensureOrganizationAppLink({
			id: organization.id,
			name: organization.name,
			slug: organization.slug || organization.id,
			appId: organization.appId || null,
			app: organization.app
				? {
						id: organization.app.id,
					}
				: null,
		})

		const app = await prisma.apps.findUnique({
			where: { id: linkedAppId },
			select: { id: true, app_id: true, app_name: true, business_name: true },
		})

		if (!app) return null

		const resolvedOrgSlug = organization.slug || app.app_id
		const resolvedOrgName =
			String(organization.name || '').trim() ||
			String(user.organization_name || '').trim() ||
			'Workspace'

		await prisma.users.update({
			where: { id: user.id },
			data: {
				app_id: app.id,
				organization_slug: resolvedOrgSlug,
				organization_name: resolvedOrgName,
			},
		})

		return {
			organization: {
				id: organization.id,
				name: resolvedOrgName,
				slug: resolvedOrgSlug,
				appId: app.id,
				appPublicId: app.app_id,
			},
		}
	}

	// Fallback for legacy users that already have app_id but no organization row.
	if (user.app_id) {
		const app = await prisma.apps.findUnique({
			where: { id: user.app_id },
			select: { id: true, app_id: true, app_name: true, business_name: true },
		})

		if (!app) return null

		const fallbackSlug =
			String(user.organization_slug || '').trim() || String(app.app_id || '').trim()
		const fallbackName =
			String(user.organization_name || '').trim() ||
			String(app.business_name || '').trim() ||
			String(app.app_name || '').trim() ||
			'Workspace'

		if (!user.organization_slug || !user.organization_name) {
			await prisma.users.update({
				where: { id: user.id },
				data: {
					organization_slug: fallbackSlug || null,
					organization_name: fallbackName,
				},
			})
		}

		return {
			organization: {
				id: app.id,
				name: fallbackName,
				slug: fallbackSlug,
				appId: app.id,
				appPublicId: app.app_id,
			},
		}
	}

	return null
}

export const authModule = new Elysia({ prefix: '/auth', tags: ['Authority'] })
	/**
	 * Login Endpoint - Uses Better Auth
	 */
	.post(
		'/login',
		async ({ body, set, request }) => {
			const { email, password } = body
			const normalizedEmail = String(email || '')
				.trim()
				.toLowerCase()

			const user = await prisma.users.findUnique({
				where: { email: normalizedEmail },
			})

			if (!user || !user.active) {
				set.status = 401
				return { error: 'Invalid credentials' }
			}

			let linkedApp: any = null
			if (user.app_id) {
				const resolvedAppId = await resolveAppId(String(user.app_id))
				if (resolvedAppId) {
					linkedApp = await prisma.apps.findUnique({
						where: { id: resolvedAppId },
					})
				}
			}

			const signInWithBetterAuth = () =>
				fetch(
					`${process.env.BETTER_AUTH_BASE_URL || 'http://localhost:3010'}/auth/sign-in/email`,
					{
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ email: normalizedEmail, password }),
					},
				)

			// Use Better Auth to create session
			let loginResponse = await signInWithBetterAuth()

			if (!loginResponse.ok) {
				// Legacy user path: verify old bcrypt password then sync Better Auth credential account.
				if (!user.password) {
					set.status = 401
					return { error: 'Invalid credentials' }
				}

				const validPassword = await bcrypt.compare(password, user.password)
				if (!validPassword) {
					set.status = 401
					return { error: 'Invalid credentials' }
				}

				await prisma.$transaction(async (tx) => {
					await syncBetterAuthCredentialAccount(tx, {
						userId: user.id,
						password,
					})
				})

				// Retry sign-in after syncing Better Auth credential hash.
				loginResponse = await signInWithBetterAuth()
			}

			if (!loginResponse.ok) {
				console.log(
					'Better Auth sign-in failed after credential sync, returning legacy format',
				)

				return {
					success: true,
					token: 'legacy-token',
					refreshToken: 'legacy-token',
					user: {
						id: user.id,
						name: user.name,
						email: user.email,
						role: user.role,
						avatar_url: user.avatar_url,
					app_id: user.app_id,
					},
					app: linkedApp,
					expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
				}
			}

			const baData = (await loginResponse.json()) as any

			// Return Better Auth session data
			return {
				success: true,
				token: baData.token || 'better-auth-session',
				refreshToken:
					baData.refreshToken || baData.token || 'better-auth-session',
				user: {
					id: user.id,
					name: user.name,
					email: user.email,
					role: user.role,
					avatar_url: user.avatar_url,
					app_id: user.app_id,
				},
				app: linkedApp,
				expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
			}
		},
		{
			body: t.Object({
				email: t.String(),
				password: t.String(),
				app_id: t.Optional(t.String()),
			}),
			},
		)

	.get('/context', async ({ request, set }) => {
		const sessionUser = await getAuthenticatedSessionUser(request)
		if (!sessionUser) {
			set.status = 401
			return { success: false, error: 'Unauthorized' }
		}

		const context = await resolveWorkspaceContextForUser(sessionUser.id)
		const organization = context?.organization || null

		return {
			success: true,
			onboardingRequired: !organization,
			organization,
		}
	})

	.post(
		'/onboarding',
		async ({ body, request, set }) => {
			const sessionUser = await getAuthenticatedSessionUser(request)
			if (!sessionUser) {
				set.status = 401
				return { success: false, error: 'Unauthorized' }
			}

			const companyName = normalizeCompanyName(body.companyName)
			const slug = slugifyCompanySlug(body.slug || companyName)

			if (companyName.length < 2) {
				set.status = 400
				return { success: false, error: 'Company name must be at least 2 characters' }
			}

			if (slug.length < 3 || !isValidCompanySlug(slug)) {
				set.status = 400
				return {
					success: false,
					error:
						'Slug must be at least 3 characters and only contain lowercase letters, numbers, and hyphens',
				}
			}

			const existingContext = await resolveWorkspaceContextForUser(sessionUser.id)
			if (existingContext?.organization?.appId) {
				await ensureDefaultTeamAndDivision(prisma, {
					appId: existingContext.organization.appId,
					userId: sessionUser.id,
				}).catch((error) =>
					console.error('[AUTH ONBOARDING DEFAULT SEED ERROR]', error),
				)

				return {
					success: true,
					onboardingRequired: false,
					organization: existingContext.organization,
				}
			}

			try {
				const duplicateSlug = await prisma.organization.findUnique({
					where: { slug },
					select: { id: true },
				})
				if (duplicateSlug) {
					set.status = 409
					return { success: false, error: 'Organization slug is already used' }
				}

				const organization = await prisma.organization.create({
					data: {
						id: crypto.randomUUID(),
						name: companyName,
						slug,
						createdBy: sessionUser.id,
					},
					select: {
						id: true,
						name: true,
						slug: true,
						appId: true,
						app: { select: { id: true } },
					},
				})

				const appId = await ensureOrganizationAppLink({
					id: organization.id,
					name: organization.name,
					slug: organization.slug || organization.id,
					appId: organization.appId || null,
					app: organization.app
						? {
								id: organization.app.id,
							}
						: null,
				})

				const app = await prisma.apps.findUnique({
					where: { id: appId },
					select: { id: true, app_id: true },
				})

				if (!app) {
					throw new Error('Failed to resolve app after onboarding')
				}

				await prisma.$transaction(async (tx) => {
					await tx.member.create({
						data: {
							id: crypto.randomUUID(),
							organizationId: organization.id,
							userId: sessionUser.id,
							role: 'owner',
						},
					})

					await tx.users.update({
						where: { id: sessionUser.id },
						data: {
							app_id: app.id,
							organization_slug: organization.slug,
							organization_name: organization.name,
						},
					})

					await tx.session.updateMany({
						where: { userId: sessionUser.id },
						data: { activeOrganizationId: organization.id },
					})

					await ensureDefaultTeamAndDivision(tx, {
						appId: app.id,
						userId: sessionUser.id,
					})
				})

				const created = {
					id: organization.id,
					name: organization.name,
					slug: organization.slug || app.app_id,
					appId: app.id,
					appPublicId: app.app_id,
				}

				return {
					success: true,
					onboardingRequired: false,
					organization: created,
				}
			} catch (error: any) {
				const message = String(error?.message || '').trim()

				if (message === 'Organization slug is already used') {
					set.status = 409
					return { success: false, error: message }
				}

				if (error?.code === 'P2002') {
					set.status = 409
					return { success: false, error: 'Organization slug is already used' }
				}

				console.error('[AUTH ONBOARDING ERROR]', error)
				set.status = 500
				return {
					success: false,
					error: 'Failed to complete onboarding',
				}
			}
		},
		{
			body: t.Object({
				companyName: t.String(),
				slug: t.Optional(t.String()),
			}),
		},
	)

	.get('/me', async ({ request, headers }) => {
		// Use Better Auth only
		const session = await auth.api.getSession({ headers: request.headers })
		if (session) {
			return { data: session }
		}

		return { error: 'Unauthorized' }
	})

	.post('/logout', async ({ request }) => {
		// Use Better Auth signOut
		await auth.api.signOut({ headers: request.headers })
		return { success: true }
	})
