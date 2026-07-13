import { prisma } from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'

export const TemplateVariableService = {
	async list(appIdOrSlug: string) {
		const appId = await resolveAppId(appIdOrSlug)
		return await prisma.template_variables.findMany({
			where: { app_id: appId },
			orderBy: { created_at: 'desc' },
		})
	},

	async create(appIdOrSlug: string, data: any) {
		const appId = await resolveAppId(appIdOrSlug)
		return await prisma.template_variables.create({
			data: {
				app_id: appId,
				name: data.name,
				category: data.category || 'custom',
				value: data.value,
				fallback_value: data.fallback_value || '',
			},
		})
	},

	async delete(id: string) {
		return await prisma.template_variables.delete({
			where: { id },
		})
	},
}
