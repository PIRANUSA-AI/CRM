import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import prisma from '../../lib/prisma'

type MetaTemplate = {
	id: string
	name: string
	status: string
	category: string
	language: string
	components: any[]
}

function normalizeTemplate(template: Record<string, any>): MetaTemplate {
	return {
		id: String(template.id || ''),
		name: String(template.name || ''),
		status: String(template.status || ''),
		category: String(template.category || ''),
		language: String(template.language || ''),
		components: Array.isArray(template.components) ? template.components : [],
	}
}

async function resolveWhatsAppChannel(
	appId: string,
	options?: {
		channelId?: string
		inboxId?: string
	},
): Promise<{
	id: string
	waba_id: string | null
	api_key: string | null
} | null> {
	return prisma.whatsapp_channels.findFirst({
		where: {
			app_id: appId,
			deleted_at: null,
			is_active: true,
			...(options?.channelId ? { id: options.channelId } : {}),
			...(options?.inboxId ? { inbox_id: options.inboxId } : {}),
		},
		select: {
			id: true,
			waba_id: true,
			api_key: true,
		},
		orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
	})
}

async function fetchMetaTemplates(params: {
	wabaId: string
	apiKey: string
	limit: number
}): Promise<MetaTemplate[]> {
	const normalizedLimit = Math.max(1, Math.min(params.limit || 100, 250))
	const templates: MetaTemplate[] = []

	let nextUrl: string | null = `https://graph.facebook.com/v23.0/${params.wabaId}/message_templates?fields=id,name,status,category,language,components&limit=100`

	while (nextUrl && templates.length < normalizedLimit) {
		const response = await fetch(nextUrl, {
			method: 'GET',
			headers: {
				Authorization: `Bearer ${params.apiKey}`,
				'Content-Type': 'application/json',
			},
		})

		const payload = (await response.json()) as {
			data?: any[]
			paging?: { next?: string }
			error?: { message?: string }
		}

		if (!response.ok) {
			throw new Error(
				payload?.error?.message || 'Failed to fetch templates from Meta',
			)
		}

		if (Array.isArray(payload.data)) {
			payload.data.forEach((item) => templates.push(normalizeTemplate(item)))
		}

		nextUrl = payload?.paging?.next || null
	}

	return templates.slice(0, normalizedLimit)
}

export const whatsappModule = new Elysia({ tags: ['WhatsApp'] })
	.use(appContext)
	.get(
		'/templates',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const limit = Number.parseInt(query.limit || '100', 10)
			const normalizedLimit = Number.isNaN(limit)
				? 100
				: Math.max(1, Math.min(limit, 250))

			const channel = await resolveWhatsAppChannel(resolvedAppId, {
				channelId: query.channelId,
				inboxId: query.inboxId,
			})
			if (!channel) {
				return {
					success: true,
					data: [],
					meta: { reason: 'whatsapp_channel_not_found' },
				}
			}

			if (!channel.waba_id || !channel.api_key) {
				return {
					success: true,
					data: [],
					meta: { reason: 'missing_whatsapp_channel_credentials' },
				}
			}

			const rawTemplates = await fetchMetaTemplates({
				wabaId: channel.waba_id,
				apiKey: channel.api_key,
				limit: normalizedLimit,
			})

			const statusFilter = query.status?.trim().toUpperCase()
			const categoryFilter = query.category?.trim().toUpperCase()
			const searchTerm = query.search?.trim().toLowerCase()

			const filteredTemplates = rawTemplates.filter((template) => {
				if (statusFilter && template.status.toUpperCase() !== statusFilter) {
					return false
				}

				if (categoryFilter && template.category.toUpperCase() !== categoryFilter) {
					return false
				}

				if (searchTerm) {
					const haystack = `${template.name} ${template.category} ${template.language} ${JSON.stringify(template.components || [])}`.toLowerCase()
					return haystack.includes(searchTerm)
				}

				return true
			})

			return {
				success: true,
				data: filteredTemplates.slice(0, normalizedLimit),
			}
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				limit: t.Optional(t.String()),
				status: t.Optional(t.String()),
				category: t.Optional(t.String()),
				search: t.Optional(t.String()),
				channelId: t.Optional(t.String()),
				inboxId: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/templates/sync',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const channel = await resolveWhatsAppChannel(resolvedAppId, {
				channelId: body?.channelId,
			})
			if (!channel) {
				return {
					success: true,
					data: { synced: 0, reason: 'whatsapp_channel_not_found' },
				}
			}

			if (!channel.waba_id || !channel.api_key) {
				return {
					success: true,
					data: { synced: 0, reason: 'missing_whatsapp_channel_credentials' },
				}
			}

			const templates = await fetchMetaTemplates({
				wabaId: channel.waba_id,
				apiKey: channel.api_key,
				limit: 250,
			})

			return { success: true, data: { synced: templates.length } }
		},
		{
			body: t.Optional(
				t.Object({
					channelId: t.Optional(t.String()),
				}),
			),
		},
	)
