/**
 * Organization API Client
 *
 * Handles Better Auth organization operations
 */

import { CRM_ALLOWED_PATHS } from './crm-navigation'

// Our custom organization API at /api/organization/*
const API_BASE = import.meta.env.VITE_API_URL
	? `${import.meta.env.VITE_API_URL}/api`
	: 'http://localhost:3010/api'

const ORG_SLUG_COOKIE_KEY = 'crm_org_slug'
const APP_ID_COOKIE_KEY = 'crm_app_id'
const ORG_ID_COOKIE_KEY = 'crm_org_id'
const ORG_NAME_COOKIE_KEY = 'crm_org_name'

// Organization types
export interface Organization {
	id: string
	name: string
	slug: string
	logo?: string
	metadata?: Record<string, any>
	createdAt: string
	updatedAt: string
	appId?: string
}

export interface Member {
	id: string
	organizationId: string
	userId: string
	role: 'owner' | 'admin' | 'member'
	createdAt: string
	updatedAt: string
	user?: {
		id: string
		name: string
		email: string
		avatar_url?: string
	}
}

export interface Invitation {
	id: string
	organizationId: string
	email: string
	role: string
	status: 'pending' | 'accepted' | 'rejected' | 'canceled'
	expiresAt: string
	invitedById: string
	createdAt: string
}

const POST_LOGIN_REDIRECT_KEY = 'crm_post_login_redirect'

type AuthContextResponse = {
	success?: boolean
	onboardingRequired?: boolean
	organization?: {
		id?: string
		name?: string
		slug?: string
		appId?: string
		appPublicId?: string
	} | null
	error?: string
}

function setCookie(key: string, value: string, maxAgeSeconds = 60 * 60 * 24 * 30) {
	if (typeof document === 'undefined' || !value) return
	document.cookie = `${key}=${encodeURIComponent(value)}; Path=/; Max-Age=${maxAgeSeconds}; SameSite=Lax`
}

function getCookie(key: string): string | null {
	if (typeof document === 'undefined') return null
	const cookies = document.cookie.split(';')
	for (const cookiePart of cookies) {
		const [rawKey, ...rawValue] = cookiePart.trim().split('=')
		if (rawKey !== key) continue
		const value = rawValue.join('=')
		return value ? decodeURIComponent(value) : null
	}
	return null
}

export function getOrgSlugFromCookie(): string | null {
	return getCookie(ORG_SLUG_COOKIE_KEY)
}

export function getAppIdFromCookie(): string | null {
	return getCookie(APP_ID_COOKIE_KEY)
}

export function persistOrganizationContext(
	org: Pick<Organization, 'id' | 'slug' | 'name' | 'appId'>,
) {
	const resolvedAppId =
		org.appId ||
		(typeof localStorage !== 'undefined'
			? localStorage.getItem('crm_app_id') || org.slug
			: org.slug)

	if (typeof localStorage !== 'undefined') {
		localStorage.setItem('crm_org_id', org.id)
		localStorage.setItem('crm_org_slug', org.slug)
		localStorage.setItem('crm_org_name', org.name)
		localStorage.setItem('crm_app_slug', org.slug)
		localStorage.setItem('crm_app_id', resolvedAppId)
	}

	// Keep org/app context in cookies so routing no longer depends on URL segments.
	setCookie(ORG_ID_COOKIE_KEY, org.id)
	setCookie(ORG_SLUG_COOKIE_KEY, org.slug)
	setCookie(ORG_NAME_COOKIE_KEY, org.name)
	setCookie(APP_ID_COOKIE_KEY, resolvedAppId)
}

export async function syncOrganizationContextFromSession(): Promise<{
	authenticated: boolean
	onboardingRequired: boolean
	organization: Pick<Organization, 'id' | 'slug' | 'name' | 'appId'> | null
}> {
	const response = await fetch(`${API_BASE}/auth/context`, {
		credentials: 'include',
	})

	const payload = (await response.json().catch(() => null)) as AuthContextResponse | null
	if (response.status === 401) {
		return { authenticated: false, onboardingRequired: false, organization: null }
	}
	if (!response.ok) {
		return { authenticated: false, onboardingRequired: false, organization: null }
	}

	const rawOrganization = payload?.organization
	if (
		rawOrganization &&
		rawOrganization.id &&
		rawOrganization.name &&
		rawOrganization.slug
	) {
		const organization = {
			id: String(rawOrganization.id),
			name: String(rawOrganization.name),
			slug: String(rawOrganization.slug),
			appId: rawOrganization.appId ? String(rawOrganization.appId) : undefined,
		}

		persistOrganizationContext(organization)

		return {
			authenticated: true,
			onboardingRequired: false,
			organization,
		}
	}

	return {
		authenticated: true,
		onboardingRequired: Boolean(payload?.onboardingRequired),
		organization: null,
	}
}

export async function completeOrganizationOnboarding(input: {
	companyName: string
	slug: string
}): Promise<Pick<Organization, 'id' | 'slug' | 'name' | 'appId'>> {
	const response = await fetch(`${API_BASE}/auth/onboarding`, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
		},
		credentials: 'include',
		body: JSON.stringify(input),
	})

	const payload = (await response.json().catch(() => null)) as AuthContextResponse | null
	if (!response.ok || !payload?.organization) {
		throw new Error(payload?.error || 'Failed to complete onboarding')
	}

	const organization = payload.organization
	if (!organization.id || !organization.name || !organization.slug) {
		throw new Error('Invalid onboarding response')
	}

	const normalized = {
		id: String(organization.id),
		name: String(organization.name),
		slug: String(organization.slug),
		appId: organization.appId ? String(organization.appId) : undefined,
	}

	persistOrganizationContext(normalized)
	return normalized
}

export function rememberPostLoginRedirect(path: string) {
	if (typeof sessionStorage === 'undefined') return
	if (!path || path.includes('/login')) return
	sessionStorage.setItem(POST_LOGIN_REDIRECT_KEY, path)
}

export function consumePostLoginRedirect(params?: {
	defaultPath?: string
}): string {
	const fallback = params?.defaultPath || '/dashboard'

	if (typeof sessionStorage === 'undefined' || typeof window === 'undefined') {
		return fallback
	}

	const stored = sessionStorage.getItem(POST_LOGIN_REDIRECT_KEY)
	if (!stored) return fallback

	sessionStorage.removeItem(POST_LOGIN_REDIRECT_KEY)

	try {
		const url = new URL(stored, window.location.origin)
		const pathname = url.pathname

		if (!pathname.startsWith('/')) return fallback
		if (pathname.includes('/login')) return fallback

		const segments = pathname.split('/').filter(Boolean)
		if (segments.length === 0) return fallback

		// Public pre-auth pages aren't part of CRM_ALLOWED_PATHS (that only
		// covers the authenticated app shell), so they're listed separately.
		// 'my-inbox' is a legacy alias remapped to 'chat' below, not a live route.
		const rootRoutes = new Set([
			'login',
			'register',
			'onboarding',
			'create-org',
			'select-org',
			'terms',
			'privacy',
			'my-inbox',
			...CRM_ALLOWED_PATHS.map((path) => path.split('/').filter(Boolean)[0]),
		])

		let normalized = [...segments]

		// Legacy format A: /{lang}/{orgSlug}/...
		if (
			segments.length >= 3 &&
			segments[0].length <= 5 &&
			!rootRoutes.has(segments[1])
		) {
			normalized = segments.slice(2)
		}
		// Legacy format B: /{lang}/...
		else if (
			segments.length >= 2 &&
			segments[0].length <= 5 &&
			rootRoutes.has(segments[1])
		) {
			normalized = segments.slice(1)
		}

		if (normalized.length === 0) return fallback
		if (normalized[0] === 'my-inbox') {
			normalized[0] = 'chat'
		}

		return `/${normalized.join('/')}${url.search}`
	} catch {
		return fallback
	}
}

// Get current org slug from URL path
export function getCurrentOrgSlug(): string | null {
	if (typeof window === 'undefined') return null

	const cookieSlug = getOrgSlugFromCookie()
	if (cookieSlug) return cookieSlug

	if (typeof localStorage !== 'undefined') {
		const localSlug = localStorage.getItem('crm_org_slug')
		if (localSlug) return localSlug
	}

	// Legacy fallback: /$lang/$orgSlug/...
	const pathMatch = window.location.pathname.match(/^\/[^/]+\/([^/]+)/)
	return pathMatch?.[1] || null
}

// Organization API
// Uses Better Auth sessions (cookies) instead of Bearer tokens
export const organizationApi = {
	// List user's organizations
	list: async (): Promise<{
		organizations: Organization[]
		activeOrganizationId?: string
	}> => {
		const response = await fetch(`${API_BASE}/organization/list`, {
			credentials: 'include', // Important: includes cookies for Better Auth session
		})
		if (!response.ok) throw new Error('Failed to fetch organizations')
		return response.json()
	},

	// Get active organization
	getActive: async (): Promise<{
		organization: Organization | null
		member: Member | null
	}> => {
		const response = await fetch(`${API_BASE}/organization/get-active`, {
			credentials: 'include', // Important: includes cookies for Better Auth session
		})
		if (!response.ok) throw new Error('Failed to get active organization')
		return response.json()
	},

	// Set active organization
	setActive: async (organizationId: string): Promise<void> => {
		if (!organizationId) {
			throw new Error('Missing organizationId when setting active organization')
		}

		const response = await fetch(`${API_BASE}/organization/set-active`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include', // Important: includes cookies for Better Auth session
			body: JSON.stringify({ organizationId }),
		})

		const payload = await response.json().catch(() => null)
		if (!response.ok || payload?.error) {
			throw new Error(payload?.error || 'Failed to set active organization')
		}
	},

	// Create new organization
	create: async (data: {
		name: string
		slug: string
		logo?: string
	}): Promise<Organization> => {
		const response = await fetch(`${API_BASE}/organization/create`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include',
			body: JSON.stringify(data),
		})
		const payload = await response.json().catch(() => null)
		if (!response.ok || payload?.error) {
			throw new Error(payload?.error || 'Failed to create organization')
		}
		return payload as Organization
	},

	// Update organization
	update: async (
		organizationId: string,
		data: { name?: string; slug?: string; logo?: string },
	): Promise<Organization> => {
		const response = await fetch(`${API_BASE}/organization/update`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include',
			body: JSON.stringify({ organizationId, data }),
		})
		if (!response.ok) throw new Error('Failed to update organization')
		return response.json()
	},

	// Delete organization
	delete: async (organizationId: string): Promise<void> => {
		const response = await fetch(`${API_BASE}/organization/delete`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include',
			body: JSON.stringify({ organizationId }),
		})
		if (!response.ok) throw new Error('Failed to delete organization')
	},

	// Get organization members
	getMembers: async (organizationId: string): Promise<Member[]> => {
		const response = await fetch(
			`${API_BASE}/organization/get-members?organizationId=${organizationId}`,
			{
				credentials: 'include',
			},
		)
		if (!response.ok) throw new Error('Failed to fetch members')
		return response.json()
	},

	// Invite member
	inviteMember: async (data: {
		organizationId: string
		email: string
		role: 'admin' | 'member'
	}): Promise<Invitation> => {
		const response = await fetch(`${API_BASE}/organization/invite-member`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include',
			body: JSON.stringify(data),
		})
		if (!response.ok) throw new Error('Failed to invite member')
		return response.json()
	},

	// Remove member
	removeMember: async (data: {
		organizationId: string
		memberId: string
	}): Promise<void> => {
		const response = await fetch(`${API_BASE}/organization/remove-member`, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
			},
			credentials: 'include',
			body: JSON.stringify(data),
		})
		if (!response.ok) throw new Error('Failed to remove member')
	},

	// Update member role
	updateMemberRole: async (data: {
		organizationId: string
		memberId: string
		role: 'admin' | 'member'
	}): Promise<void> => {
		const response = await fetch(
			`${API_BASE}/organization/update-member-role`,
			{
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
				},
				credentials: 'include',
				body: JSON.stringify(data),
			},
		)
		if (!response.ok) throw new Error('Failed to update member role')
	},
}

// Hook for checking if user has multiple organizations
export async function hasMultipleOrganizations(): Promise<boolean> {
	try {
		const { organizations } = await organizationApi.list()
		return organizations.length > 1
	} catch {
		return false
	}
}

// Hook for getting default organization redirect URL
export async function getDefaultOrgRedirect(
	_lang: string = 'en',
): Promise<string | null> {
	try {
		const { organizations, activeOrganizationId } = await organizationApi.list()

		if (organizations.length === 0) {
			return '/create-org'
		}

		if (organizations.length === 1) {
			const org = organizations[0]
			// Set as active if not already
			if (!activeOrganizationId || activeOrganizationId !== org.id) {
				await organizationApi.setActive(org.id)
			}
			return '/dashboard'
		}

		// Multiple orgs - check if one is active
		if (activeOrganizationId) {
			const activeOrg = organizations.find((o) => o.id === activeOrganizationId)
			if (activeOrg) {
				return '/dashboard'
			}
		}

		// Multiple orgs, none active - go to picker
		return '/select-org'
	} catch {
		return null
	}
}
