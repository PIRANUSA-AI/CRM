import { Prisma } from '../../generated/prisma'
import prisma from '../../lib/prisma'
import { resolveAppId } from '../../lib/utils'

const agentSettingsSelect = {
	id: true,
	app_id: true,
	default_ticket_board_id: true,
	auto_assign_agent: true,
	agent_can_takeover_unserved: true,
	agent_can_access_customers: true,
	agent_can_import_export_customers: true,
	agent_can_send_broadcast: true,
	agent_can_broadcast_in_service_window: true,
	hide_agent_status_toggle: true,
	hide_customer_id: true,
	agent_can_assign_chat: true,
	agent_can_add_agents_to_chat: true,
	agent_can_leave_chat: true,
	hide_handover_dialogue: true,
	agent_can_manage_quick_replies: true,
} as const satisfies Prisma.agent_settingsSelect

const legacyAgentSettingsSelect = {
	id: true,
	app_id: true,
	auto_assign_agent: true,
	agent_can_takeover_unserved: true,
	agent_can_access_customers: true,
	agent_can_import_export_customers: true,
	agent_can_send_broadcast: true,
	agent_can_broadcast_in_service_window: true,
	hide_agent_status_toggle: true,
	hide_customer_id: true,
	agent_can_assign_chat: true,
	agent_can_add_agents_to_chat: true,
	agent_can_leave_chat: true,
	hide_handover_dialogue: true,
	agent_can_manage_quick_replies: true,
} as const satisfies Prisma.agent_settingsSelect

type AgentSettingsPayload = Prisma.agent_settingsGetPayload<{
	select: typeof agentSettingsSelect
}>
type LegacyAgentSettingsPayload = Prisma.agent_settingsGetPayload<{
	select: typeof legacyAgentSettingsSelect
}>

let useLegacyAgentSettingsQueries = false
let legacyModeCheck: Promise<void> | null = null

function isMissingColumnError(error: unknown) {
	return (
		error instanceof Prisma.PrismaClientKnownRequestError &&
		error.code === 'P2022'
	)
}

async function ensureLegacyModeLoaded() {
	if (!legacyModeCheck) {
		legacyModeCheck = (async () => {
			try {
				const rows = await prisma.$queryRaw<Array<{ exists: boolean }>>`
					SELECT EXISTS (
						SELECT 1
						FROM information_schema.columns
						WHERE table_schema = 'public'
							AND table_name = 'agent_settings'
							AND column_name = 'default_ticket_board_id'
					) AS "exists"
				`
				useLegacyAgentSettingsQueries = !Boolean(rows[0]?.exists)
			} catch {
				// Keep modern mode when metadata lookup fails; runtime fallback still handles P2022.
			}
		})()
	}

	await legacyModeCheck
}

function shouldFallbackToLegacy(error: unknown) {
	if (!isMissingColumnError(error)) {
		return false
	}

	useLegacyAgentSettingsQueries = true
	return true
}

function toCurrentShape(
	settings: LegacyAgentSettingsPayload,
): AgentSettingsPayload {
	return {
		...settings,
		default_ticket_board_id: null,
	}
}

export abstract class AgentSettingsService {
	static async getSettings(appId: string) {
		await ensureLegacyModeLoaded()

		const targetAppId = await resolveAppId(appId)

		if (!targetAppId) {
			throw new Error('Invalid App ID')
		}

		let settings: AgentSettingsPayload | null = null
		if (useLegacyAgentSettingsQueries) {
			const legacySettings = await prisma.agent_settings.findUnique({
				where: { app_id: targetAppId },
				select: legacyAgentSettingsSelect,
			})
			settings = legacySettings ? toCurrentShape(legacySettings) : null
		} else {
			try {
				settings = await prisma.agent_settings.findUnique({
					where: { app_id: targetAppId },
					select: agentSettingsSelect,
				})
			} catch (error) {
				if (!shouldFallbackToLegacy(error)) {
					throw error
				}

				const legacySettings = await prisma.agent_settings.findUnique({
					where: { app_id: targetAppId },
					select: legacyAgentSettingsSelect,
				})
				settings = legacySettings ? toCurrentShape(legacySettings) : null
			}
		}

		if (!settings) {
			if (useLegacyAgentSettingsQueries) {
				const legacySettings = await prisma.agent_settings.create({
					data: { app_id: targetAppId },
					select: legacyAgentSettingsSelect,
				})
				settings = toCurrentShape(legacySettings)
			} else {
				try {
					settings = await prisma.agent_settings.create({
						data: { app_id: targetAppId },
						select: agentSettingsSelect,
					})
				} catch (error) {
					if (!shouldFallbackToLegacy(error)) {
						throw error
					}

					const legacySettings = await prisma.agent_settings.create({
						data: { app_id: targetAppId },
						select: legacyAgentSettingsSelect,
					})
					settings = toCurrentShape(legacySettings)
				}
			}
		}

		return settings
	}

	static async updateSettings(appId: string, data: any) {
		await ensureLegacyModeLoaded()

		const targetAppId = await resolveAppId(appId)

		if (!targetAppId) {
			throw new Error('Invalid App ID')
		}

		const updateData = {
			...(data || {}),
			updated_at: new Date(),
		} as Prisma.agent_settingsUpdateInput

		if (useLegacyAgentSettingsQueries) {
			const legacyUpdateData = { ...updateData } as Record<string, unknown>
			delete legacyUpdateData.default_ticket_board_id

			const legacySettings = await prisma.agent_settings.update({
				where: { app_id: targetAppId },
				data: legacyUpdateData as Prisma.agent_settingsUpdateInput,
				select: legacyAgentSettingsSelect,
			})

			return toCurrentShape(legacySettings)
		}

		try {
			return await prisma.agent_settings.update({
				where: { app_id: targetAppId },
				data: updateData,
				select: agentSettingsSelect,
			})
		} catch (error) {
			if (!shouldFallbackToLegacy(error)) {
				throw error
			}

			const legacyUpdateData = { ...updateData } as Record<string, unknown>
			delete legacyUpdateData.default_ticket_board_id

			const legacySettings = await prisma.agent_settings.update({
				where: { app_id: targetAppId },
				data: legacyUpdateData as Prisma.agent_settingsUpdateInput,
				select: legacyAgentSettingsSelect,
			})

			return toCurrentShape(legacySettings)
		}
	}
}
