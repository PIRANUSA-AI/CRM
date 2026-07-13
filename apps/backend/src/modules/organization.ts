import { Elysia, t } from 'elysia'

type AnyObj = Record<string, any>

function normalizeOrganization(org: AnyObj) {
	return {
		id: org.id,
		name: org.name,
		slug: org.slug,
		appId: org.appId ?? org.app?.id ?? null,
		logo: org.logo ?? null,
		description: org.description ?? null,
		createdBy: org.createdBy ?? null,
		metadata: org.metadata ?? null,
		createdAt: new Date(org.createdAt ?? Date.now()).toISOString(),
		updatedAt: new Date(org.updatedAt ?? Date.now()).toISOString(),
	}
}

function normalizeMember(member: AnyObj) {
	return {
		id: member.id,
		organizationId: member.organizationId,
		userId: member.userId,
		role: member.role,
		createdAt: new Date(member.createdAt ?? Date.now()).toISOString(),
		updatedAt: new Date(member.updatedAt ?? Date.now()).toISOString(),
		user: member.user
			? {
					id: member.user.id,
					name: member.user.name,
					email: member.user.email,
					avatar_url: member.user.image ?? member.user.avatar_url,
				}
			: undefined,
	}
}

function getErrorMessage(error: unknown, fallback: string) {
	if (error && typeof error === 'object' && 'message' in error) {
		const message = (error as AnyObj).message
		if (typeof message === 'string' && message.length > 0) return message
	}
	return fallback
}

export const organizationModule = new Elysia({
	prefix: '/organization',
	tags: ['Organization'],
})
	.get('/list', async () => {
		return { organizations: [], activeOrganizationId: undefined }
	})
	.get('/get-active', async () => {
		return { organization: null, member: null }
	})
	.post('/set-active', async ({ set }) => {
		set.status = 410
		return { error: 'Organization management has been disabled' }
	})
	.post('/create', async ({ set }) => {
		set.status = 410
		return { error: 'Organization creation has been disabled' }
	})
	.post('/update', async ({ set }) => {
		set.status = 410
		return { error: 'Organization update has been disabled' }
	})
	.post('/delete', async ({ set }) => {
		set.status = 410
		return { error: 'Organization deletion has been disabled' }
	})
	.get('/get-members', async ({ set }) => {
		set.status = 410
		return []
	})
	.post('/invite-member', async ({ set }) => {
		set.status = 410
		return { error: 'Organization invitations have been disabled' }
	})
	.post('/remove-member', async ({ set }) => {
		set.status = 410
		return { error: 'Organization member management has been disabled' }
	})
	.post('/update-member-role', async ({ set }) => {
		set.status = 410
		return { error: 'Organization member role updates have been disabled' }
	})