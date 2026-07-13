import prisma from '../../lib/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'
import { BusinessWebhookDispatchService } from '../business-webhooks/dispatch-service'

type StageSettingsPayload = {
	pipelineId: string
	stages: Array<{
		id: string
		name: string
		color: string
		stageOrder: number
		isDefault: boolean
	}>
	defaultStageId: string | null
}

type ContactFieldPayload = {
	id: string
	fieldKey: string
	fieldLabel: string
	fieldType: string
	options: unknown[]
	isRequired: boolean
	isVisible: boolean
	displayOrder: number
}

const DEFAULT_CONTACT_STAGES = [
	{ name: 'Customer', color: '#22C55E' },
	{ name: 'Payment', color: '#F59E0B' },
	{ name: 'Hot Leads', color: '#EF4444' },
	{ name: 'New Leads', color: '#3B82F6' },
]

const ALLOWED_FIELD_TYPES = new Set([
	'text',
	'number',
	'date',
	'dropdown',
	'checkbox',
])

function asObject(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function normalizeFieldKey(input: string): string {
	const normalized = input
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '_')
		.replace(/^_+|_+$/g, '')
	return normalized || 'field'
}

function isEmptyValue(value: unknown): boolean {
	if (value === null || value === undefined) return true
	if (typeof value === 'string') return value.trim().length === 0
	if (Array.isArray(value)) return value.length === 0
	return false
}

function validateFieldValue(
	fieldType: string,
	value: unknown,
	options: unknown[],
	fieldLabel: string,
) {
	if (value === undefined || value === null) return

	switch (fieldType) {
		case 'number':
			if (typeof value !== 'number' && Number.isNaN(Number(value))) {
				throw new Error(`Field "${fieldLabel}" must be a number`)
			}
			return
		case 'date': {
			const parsed = new Date(String(value))
			if (Number.isNaN(parsed.getTime())) {
				throw new Error(`Field "${fieldLabel}" must be a valid date`)
			}
			return
		}
		case 'checkbox':
			if (typeof value !== 'boolean') {
				throw new Error(`Field "${fieldLabel}" must be true or false`)
			}
			return
		case 'dropdown': {
			if (typeof value !== 'string') {
				throw new Error(`Field "${fieldLabel}" must be a string option`)
			}
			const allowed = options
				.filter((option) => typeof option === 'string')
				.map((option) => option.toLowerCase())
			if (allowed.length > 0 && !allowed.includes(value.toLowerCase())) {
				throw new Error(
					`Field "${fieldLabel}" must match one of the configured options`,
				)
			}
			return
		}
		default:
			return
	}
}

export abstract class ContactService {
	static async getContacts(accountId: string, query?: string) {
		let targetAppId = accountId
		if (!isUuid(accountId)) {
			const resolved = await resolveAppId(accountId)
			if (resolved) targetAppId = resolved
		}

		const where: any = {
			AND: [
				{ OR: [{ account_id: targetAppId }, { app_id: targetAppId }] },
				{ deleted_at: null },
			],
		}
		if (query) {
			where.AND.push({
				OR: [
					{
						name: { contains: query, mode: 'insensitive' },
					},
					{
						phone_number: { contains: query, mode: 'insensitive' },
					},
					{
						email: { contains: query, mode: 'insensitive' },
					},
					{
						identifier: { contains: query, mode: 'insensitive' },
					},
				],
			})
		}

		return prisma.contacts.findMany({
			where,
			orderBy: { created_at: 'desc' },
			take: 100,
		})
	}

	static async getContactById(id: string) {
		return prisma.contacts.findUnique({
			where: { id },
			include: {
				conversations: {
					orderBy: { last_message_at: 'desc' },
					take: 5,
				},
			},
		})
	}

	static async createContact(data: any) {
		const resolvedAppId =
			(await resolveAppId(data.accountId || data.appId || null)) ||
			data.accountId ||
			data.appId

		await ContactService.validateCustomAttributes(
			resolvedAppId || null,
			asObject(data.customAttributes || {}),
		)

		return prisma.contacts.create({
			data: {
				account_id: resolvedAppId,
				app_id: resolvedAppId,
				name: data.name,
				phone_number: data.phone || data.phone_number,
				email: data.email,
				avatar_url: data.avatarUrl || data.avatar_url,
				identifier: data.identifier,
				custom_attributes: (data.customAttributes || {}) as any,
			},
		})
	}

	static async updateContact(id: string, data: any, appId?: string | null) {
		const existing = await prisma.contacts.findUnique({
			where: { id },
			select: {
				custom_attributes: true,
				app_id: true,
				account_id: true,
			},
		})

		if (!existing) {
			throw new Error('Contact not found')
		}

		const mergedCustomAttributes = {
			...asObject(existing.custom_attributes),
			...asObject(data.customAttributes),
		}
		const effectiveAppId = appId || existing.app_id || existing.account_id || null

		await ContactService.validateCustomAttributes(
			effectiveAppId,
			mergedCustomAttributes,
		)

		const updatedContact = await prisma.contacts.update({
			where: { id },
			data: {
				name: data.name,
				phone_number: data.phone || data.phone_number,
				email: data.email,
				avatar_url: data.avatarUrl || data.avatar_url,
				custom_attributes:
					data.customAttributes !== undefined
						? (mergedCustomAttributes as any)
						: undefined,
				updated_at: new Date(),
			},
		})

		if (effectiveAppId) {
			void BusinessWebhookDispatchService.dispatch({
				event: 'contact.updated',
				appId: effectiveAppId,
				payload: {
					source: 'contacts.update',
					contact: {
						id: updatedContact.id,
						name: updatedContact.name,
						email: updatedContact.email,
						phone_number: updatedContact.phone_number,
						avatar_url: updatedContact.avatar_url,
						identifier: updatedContact.identifier,
						updated_at: updatedContact.updated_at,
					},
				},
			})
		}

		return updatedContact
	}

	static async deleteContact(id: string) {
		// Soft delete if possible, but prisma schema pull will show if it exists
		// For now, hard delete or mark as inactive if field exists
		return prisma.contacts.delete({
			where: { id },
		})
	}

	static async getContactSettings(appId: string): Promise<{
		stages: StageSettingsPayload
		fields: ContactFieldPayload[]
	}> {
		const targetAppId = await ContactService.requireAppId(appId)
		const stageSettings = await ContactService.getOrCreateContactStages(targetAppId)
		const fields = await prisma.contact_custom_fields.findMany({
			where: { app_id: targetAppId },
			orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
		})

		return {
			stages: stageSettings,
			fields: fields.map((field) => ({
				id: field.id,
				fieldKey: field.field_key,
				fieldLabel: field.field_label,
				fieldType: field.field_type,
				options: Array.isArray(field.options)
					? (field.options as unknown[])
					: [],
				isRequired: !!field.is_required,
				isVisible: field.is_visible !== false,
				displayOrder: field.display_order || 0,
			})),
		}
	}

	static async createContactStage(
		appId: string,
		input: {
			name: string
			color?: string
			isDefault?: boolean
		},
	) {
		if (!input.name?.trim()) {
			throw new Error('Stage name is required')
		}
		const targetAppId = await ContactService.requireAppId(appId)
		const pipeline = await ContactService.getOrCreateContactPipeline(targetAppId)
		const currentStages = await prisma.pipeline_stages.findMany({
			where: { pipeline_id: pipeline.id },
			orderBy: { stage_order: 'asc' },
		})
		const nextOrder =
			currentStages.length > 0
				? Math.max(...currentStages.map((stage) => stage.stage_order)) + 1
				: 0

		const stage = await prisma.pipeline_stages.create({
			data: {
				pipeline_id: pipeline.id,
				name: input.name.trim(),
				color: input.color || '#3B82F6',
				stage_order: nextOrder,
				stage_type: 'open',
			},
		})

		if (input.isDefault) {
			await ContactService.setDefaultStageId(pipeline.id, stage.id)
		}

		return ContactService.getOrCreateContactStages(targetAppId)
	}

	static async updateContactStage(
		appId: string,
		stageId: string,
		input: {
			name?: string
			color?: string
			isDefault?: boolean
		},
	) {
		const targetAppId = await ContactService.requireAppId(appId)
		const stage = await prisma.pipeline_stages.findFirst({
			where: {
				id: stageId,
				pipelines: { app_id: targetAppId, pipeline_type: 'contact' },
			},
			select: { id: true, pipeline_id: true },
		})
		if (!stage?.pipeline_id) {
			throw new Error('Stage not found')
		}

		await prisma.pipeline_stages.update({
			where: { id: stageId },
			data: {
				name: input.name?.trim() || undefined,
				color: input.color || undefined,
				updated_at: new Date(),
			},
		})

		if (input.isDefault) {
			await ContactService.setDefaultStageId(stage.pipeline_id, stageId)
		}

		return ContactService.getOrCreateContactStages(targetAppId)
	}

	static async deleteContactStage(appId: string, stageId: string) {
		const targetAppId = await ContactService.requireAppId(appId)
		const pipeline = await ContactService.getOrCreateContactPipeline(targetAppId)
		const stages = await prisma.pipeline_stages.findMany({
			where: { pipeline_id: pipeline.id },
			orderBy: { stage_order: 'asc' },
		})
		if (stages.length <= 1) {
			throw new Error('At least one stage is required')
		}

		const target = stages.find((stage) => stage.id === stageId)
		if (!target) {
			throw new Error('Stage not found')
		}

		await prisma.pipeline_stages.delete({ where: { id: stageId } })
		const remaining = stages.filter((stage) => stage.id !== stageId)
		await prisma.$transaction(
			remaining.map((stage, index) =>
				prisma.pipeline_stages.update({
					where: { id: stage.id },
					data: { stage_order: index, updated_at: new Date() },
				}),
			),
		)

		const pipelineSettings = asObject(pipeline.settings)
		if (pipelineSettings.default_stage_id === stageId) {
			await ContactService.setDefaultStageId(pipeline.id, remaining[0]?.id || null)
		}

		return ContactService.getOrCreateContactStages(targetAppId)
	}

	static async reorderContactStages(appId: string, stageIds: string[]) {
		const targetAppId = await ContactService.requireAppId(appId)
		const pipeline = await ContactService.getOrCreateContactPipeline(targetAppId)
		const stages = await prisma.pipeline_stages.findMany({
			where: { pipeline_id: pipeline.id },
			select: { id: true },
		})
		const stageSet = new Set(stages.map((stage) => stage.id))
		if (
			stageIds.length !== stages.length ||
			stageIds.some((stageId) => !stageSet.has(stageId))
		) {
			throw new Error('Invalid stage order payload')
		}

		await prisma.$transaction(
			stageIds.map((stageId, index) =>
				prisma.pipeline_stages.update({
					where: { id: stageId },
					data: { stage_order: index, updated_at: new Date() },
				}),
			),
		)

		return ContactService.getOrCreateContactStages(targetAppId)
	}

	static async createContactField(
		appId: string,
		input: {
			fieldKey?: string
			fieldLabel: string
			fieldType: string
			options?: unknown[]
			isRequired?: boolean
			isVisible?: boolean
		},
	) {
		if (!input.fieldLabel?.trim()) {
			throw new Error('Field label is required')
		}
		if (!ALLOWED_FIELD_TYPES.has(input.fieldType)) {
			throw new Error('Invalid field type')
		}
		const targetAppId = await ContactService.requireAppId(appId)
		const lastField = await prisma.contact_custom_fields.findFirst({
			where: { app_id: targetAppId },
			orderBy: { display_order: 'desc' },
			select: { display_order: true },
		})
		const baseKey = normalizeFieldKey(input.fieldKey || input.fieldLabel)
		const fieldKey = await ContactService.buildUniqueFieldKey(targetAppId, baseKey)

		await prisma.contact_custom_fields.create({
			data: {
				app_id: targetAppId,
				field_key: fieldKey,
				field_label: input.fieldLabel.trim(),
				field_type: input.fieldType,
				options: (input.options || []) as any,
				is_required: !!input.isRequired,
				is_visible: input.isVisible !== false,
				display_order: (lastField?.display_order || 0) + 1,
			},
		})

		return ContactService.getContactFields(targetAppId)
	}

	static async updateContactField(
		appId: string,
		fieldId: string,
		input: {
			fieldKey?: string
			fieldLabel?: string
			fieldType?: string
			options?: unknown[]
			isRequired?: boolean
			isVisible?: boolean
		},
	) {
		const targetAppId = await ContactService.requireAppId(appId)
		const existing = await prisma.contact_custom_fields.findFirst({
			where: { id: fieldId, app_id: targetAppId },
			select: { id: true, field_key: true },
		})
		if (!existing) throw new Error('Field not found')
		if (input.fieldType && !ALLOWED_FIELD_TYPES.has(input.fieldType)) {
			throw new Error('Invalid field type')
		}

		const fieldKey =
			input.fieldKey && input.fieldKey.trim()
				? await ContactService.buildUniqueFieldKey(
						targetAppId,
						normalizeFieldKey(input.fieldKey),
						fieldId,
					)
				: undefined

		await prisma.contact_custom_fields.update({
			where: { id: fieldId },
			data: {
				field_key: fieldKey,
				field_label: input.fieldLabel?.trim() || undefined,
				field_type: input.fieldType || undefined,
				options:
					input.options === undefined ? undefined : (input.options as any),
				is_required:
					input.isRequired === undefined ? undefined : !!input.isRequired,
				is_visible: input.isVisible,
			},
		})

		return ContactService.getContactFields(targetAppId)
	}

	static async deleteContactField(appId: string, fieldId: string) {
		const targetAppId = await ContactService.requireAppId(appId)
		const existing = await prisma.contact_custom_fields.findFirst({
			where: { id: fieldId, app_id: targetAppId },
			select: { id: true },
		})
		if (!existing) throw new Error('Field not found')

		await prisma.contact_custom_fields.delete({ where: { id: fieldId } })
		const remaining = await prisma.contact_custom_fields.findMany({
			where: { app_id: targetAppId },
			orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
			select: { id: true },
		})
		await prisma.$transaction(
			remaining.map((field, index) =>
				prisma.contact_custom_fields.update({
					where: { id: field.id },
					data: { display_order: index + 1 },
				}),
			),
		)

		return ContactService.getContactFields(targetAppId)
	}

	static async reorderContactFields(appId: string, fieldIds: string[]) {
		const targetAppId = await ContactService.requireAppId(appId)
		const existing = await prisma.contact_custom_fields.findMany({
			where: { app_id: targetAppId },
			select: { id: true },
		})
		const existingSet = new Set(existing.map((item) => item.id))
		if (
			fieldIds.length !== existing.length ||
			fieldIds.some((fieldId) => !existingSet.has(fieldId))
		) {
			throw new Error('Invalid field order payload')
		}

		await prisma.$transaction(
			fieldIds.map((fieldId, index) =>
				prisma.contact_custom_fields.update({
					where: { id: fieldId },
					data: { display_order: index + 1 },
				}),
			),
		)

		return ContactService.getContactFields(targetAppId)
	}

	private static async requireAppId(appId: string | null | undefined) {
		const resolved = await resolveAppId(appId)
		if (resolved) return resolved
		if (appId && isUuid(appId)) return appId
		throw new Error('App ID required')
	}

	private static async getOrCreateContactPipeline(appId: string) {
		const existing = await prisma.pipelines.findFirst({
			where: {
				app_id: appId,
				pipeline_type: 'contact',
			},
		})
		if (existing) return existing

		const created = await prisma.pipelines.create({
			data: {
				app_id: appId,
				name: 'Contact Stages',
				pipeline_type: 'contact',
				is_default: false,
				settings: {},
			},
		})

		await prisma.$transaction(
			DEFAULT_CONTACT_STAGES.map((stage, index) =>
				prisma.pipeline_stages.create({
					data: {
						pipeline_id: created.id,
						name: stage.name,
						color: stage.color,
						stage_order: index,
						stage_type: 'open',
					},
				}),
			),
		)

		return created
	}

	private static async getOrCreateContactStages(
		appId: string,
	): Promise<StageSettingsPayload> {
		const pipeline = await ContactService.getOrCreateContactPipeline(appId)
		const stages = await prisma.pipeline_stages.findMany({
			where: { pipeline_id: pipeline.id },
			orderBy: { stage_order: 'asc' },
		})
		const settings = asObject(pipeline.settings)
		const defaultStageId =
			typeof settings.default_stage_id === 'string'
				? settings.default_stage_id
				: (stages[0]?.id ?? null)

		return {
			pipelineId: pipeline.id,
			defaultStageId,
			stages: stages.map((stage) => ({
				id: stage.id,
				name: stage.name,
				color: stage.color || '#3B82F6',
				stageOrder: stage.stage_order,
				isDefault: stage.id === defaultStageId,
			})),
		}
	}

	private static async setDefaultStageId(
		pipelineId: string,
		stageId: string | null,
	) {
		const pipeline = await prisma.pipelines.findUnique({
			where: { id: pipelineId },
			select: { settings: true },
		})
		const settings = asObject(pipeline?.settings)
		await prisma.pipelines.update({
			where: { id: pipelineId },
			data: {
				settings: {
					...settings,
					default_stage_id: stageId,
				},
				updated_at: new Date(),
			},
		})
	}

	private static async getContactFields(appId: string) {
		const fields = await prisma.contact_custom_fields.findMany({
			where: { app_id: appId },
			orderBy: [{ display_order: 'asc' }, { created_at: 'asc' }],
		})

		return fields.map((field) => ({
			id: field.id,
			fieldKey: field.field_key,
			fieldLabel: field.field_label,
			fieldType: field.field_type,
			options: Array.isArray(field.options)
				? (field.options as unknown[])
				: [],
			isRequired: !!field.is_required,
			isVisible: field.is_visible !== false,
			displayOrder: field.display_order || 0,
		}))
	}

	private static async buildUniqueFieldKey(
		appId: string,
		baseKey: string,
		excludeId?: string,
	): Promise<string> {
		let attempt = 0
		let candidate = baseKey

		while (attempt < 20) {
			const existing = await prisma.contact_custom_fields.findFirst({
				where: {
					app_id: appId,
					field_key: candidate,
					...(excludeId ? { id: { not: excludeId } } : {}),
				},
				select: { id: true },
			})
			if (!existing) return candidate
			attempt += 1
			candidate = `${baseKey}_${attempt + 1}`
		}

		return `${baseKey}_${Date.now()}`
	}

	private static async validateCustomAttributes(
		appId: string | null,
		customAttributes: Record<string, unknown>,
	) {
		if (!appId) return
		const fieldDefinitions = await prisma.contact_custom_fields.findMany({
			where: { app_id: appId },
			select: {
				field_key: true,
				field_label: true,
				field_type: true,
				is_required: true,
				options: true,
			},
		})

		for (const definition of fieldDefinitions) {
			const value = customAttributes[definition.field_key]
			const options = Array.isArray(definition.options)
				? (definition.options as unknown[])
				: []

			validateFieldValue(
				definition.field_type,
				value,
				options,
				definition.field_label,
			)

			if (definition.is_required && isEmptyValue(value)) {
				throw new Error(`Field "${definition.field_label}" is required`)
			}
		}
	}
}
