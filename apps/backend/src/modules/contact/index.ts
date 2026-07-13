import { Elysia, t } from 'elysia'
import { ContactService } from './service'
import { ContactRequestModel } from './model'
import { appContext } from '../../plugins'

export const contact = new Elysia({ prefix: '/contacts', tags: ['Contact'] })
	.use(appContext)
	.get(
		'/settings',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const settings = await ContactService.getContactSettings(resolvedAppId)
				return { success: true, payload: settings }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to load settings',
				}
			}
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/settings/stages',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const settings = await ContactService.createContactStage(
					resolvedAppId,
					body,
				)
				return { success: true, payload: settings }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to create stage',
				}
			}
		},
		{
			body: t.Object({
				name: t.String(),
				color: t.Optional(t.String()),
				isDefault: t.Optional(t.Boolean()),
			}),
		},
	)
	.patch(
		'/settings/stages/reorder',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const settings = await ContactService.reorderContactStages(
					resolvedAppId,
					body.stageIds,
				)
				return { success: true, payload: settings }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to reorder stages',
				}
			}
		},
		{
			body: t.Object({
				stageIds: t.Array(t.String()),
			}),
		},
	)
	.patch(
		'/settings/stages/:id',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const settings = await ContactService.updateContactStage(
					resolvedAppId,
					params.id,
					body,
				)
				return { success: true, payload: settings }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to update stage',
				}
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				name: t.Optional(t.String()),
				color: t.Optional(t.String()),
				isDefault: t.Optional(t.Boolean()),
			}),
		},
	)
	.delete(
		'/settings/stages/:id',
		async ({ resolvedAppId, params, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const settings = await ContactService.deleteContactStage(
					resolvedAppId,
					params.id,
				)
				return { success: true, payload: settings }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to delete stage',
				}
			}
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/settings/fields',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const fields = await ContactService.createContactField(resolvedAppId, body)
				return { success: true, payload: fields }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to create field',
				}
			}
		},
		{
			body: t.Object({
				fieldKey: t.Optional(t.String()),
				fieldLabel: t.String(),
				fieldType: t.String(),
				options: t.Optional(t.Array(t.Any())),
				isRequired: t.Optional(t.Boolean()),
				isVisible: t.Optional(t.Boolean()),
			}),
		},
	)
	.patch(
		'/settings/fields/reorder',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const fields = await ContactService.reorderContactFields(
					resolvedAppId,
					body.fieldIds,
				)
				return { success: true, payload: fields }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to reorder fields',
				}
			}
		},
		{
			body: t.Object({
				fieldIds: t.Array(t.String()),
			}),
		},
	)
	.patch(
		'/settings/fields/:id',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const fields = await ContactService.updateContactField(
					resolvedAppId,
					params.id,
					body,
				)
				return { success: true, payload: fields }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to update field',
				}
			}
		},
		{
			params: t.Object({ id: t.String() }),
			body: t.Object({
				fieldKey: t.Optional(t.String()),
				fieldLabel: t.Optional(t.String()),
				fieldType: t.Optional(t.String()),
				options: t.Optional(t.Array(t.Any())),
				isRequired: t.Optional(t.Boolean()),
				isVisible: t.Optional(t.Boolean()),
			}),
		},
	)
	.delete(
		'/settings/fields/:id',
		async ({ resolvedAppId, params, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { success: false, error: 'App ID required' }
			}
			try {
				const fields = await ContactService.deleteContactField(
					resolvedAppId,
					params.id,
				)
				return { success: true, payload: fields }
			} catch (error) {
				set.status = 400
				return {
					success: false,
					error: error instanceof Error ? error.message : 'Failed to delete field',
				}
			}
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.get(
		'/',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const contacts = await ContactService.getContacts(resolvedAppId, query.q)
			return { data: contacts }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
				q: t.Optional(t.String()),
			}),
		},
	)
	.get(
		'/:id',
		async ({ params }) => {
			const contact = await ContactService.getContactById(params.id)
			if (!contact) return { error: 'Contact not found' }
			return { data: contact }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)
	.post(
		'/',
		async ({ body }) => {
			const contact = await ContactService.createContact(body)
			return { data: contact }
		},
		{
			body: ContactRequestModel.create,
		},
	)
	.patch(
		'/:id',
		async ({ params, body, resolvedAppId }) => {
			const contact = await ContactService.updateContact(
				params.id,
				body,
				resolvedAppId,
			)
			return { data: contact }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: ContactRequestModel.update,
		},
	)
	.delete(
		'/:id',
		async ({ params }) => {
			await ContactService.deleteContact(params.id)
			return { success: true }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Get conversations for a contact
	.get(
		'/:id/conversations',
		async ({ params }) => {
			const prisma = (await import('../../lib/prisma')).default
			const conversations = await prisma.conversations.findMany({
				where: { contact_id: params.id },
				include: {
					contacts: {
						select: {
							id: true,
							name: true,
							phone_number: true,
							email: true,
							avatar_url: true,
						},
					},
					inboxes: {
						select: { id: true, name: true, channel_type: true },
					},
					messages: {
						orderBy: { created_at: 'desc' },
						take: 1,
						select: {
							content: true,
							message_type: true,
							created_at: true,
						},
					},
				},
				orderBy: { last_message_at: 'desc' },
				take: 10,
			})
			return { data: conversations }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
