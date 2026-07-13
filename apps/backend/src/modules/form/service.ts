import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'

export abstract class FormService {
	static async getForms(appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.forms.findMany({
			where: { app_id: targetAppId || undefined },
			include: {
				form_fields: true,
			},
		})
	}

	static async getFormById(id: string) {
		return prisma.forms.findUnique({
			where: { id },
			include: {
				form_fields: true,
			},
		})
	}

	static async createForm(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		return prisma.$transaction(async (tx) => {
			const form = await tx.forms.create({
				data: {
					app_id: targetAppId || appId,
					name: data.name,
					description: data.description,
				},
			})

			if (data.fields && data.fields.length > 0) {
				await tx.form_fields.createMany({
					data: data.fields.map((f: any) => ({
						form_id: form.id,
						field_key: f.field_key,
						label: f.label,
						field_type: f.field_type,
						is_required: f.is_required,
					})),
				})
			}

			return tx.forms.findUnique({
				where: { id: form.id },
				include: { form_fields: true },
			})
		})
	}

	static async getSubmission(conversationId: string, formId?: string) {
		return prisma.form_submissions.findFirst({
			where: formId
				? { conversation_id: conversationId, form_id: formId }
				: { conversation_id: conversationId },
			include: {
				form_submission_values: {
					include: {
						form_fields: true,
					},
				},
			},
		})
	}

	static async updateSubmissionValues(
		submissionId: string,
		values: Record<string, any>,
	) {
		// This is a simplified version
		for (const [fieldKey, value] of Object.entries(values)) {
			const field = await prisma.form_fields.findFirst({
				where: { field_key: fieldKey },
			})

			if (field) {
				await prisma.form_submission_values.upsert({
					where: {
						submission_id_field_id: {
							submission_id: submissionId,
							field_id: field.id,
						},
					},
					update: { value: String(value) },
					create: {
						submission_id: submissionId,
						field_id: field.id,
						value: String(value),
						confidence: 100,
					},
				})
			}
		}

		return { success: true }
	}
}
