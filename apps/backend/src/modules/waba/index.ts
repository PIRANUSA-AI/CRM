import { Elysia } from 'elysia'
import { appContext } from '../../plugins'
import { WhatsAppRequestModel } from '../whatsapp/model'
import {
	WhatsAppChannelAssignmentConflictError,
	WhatsAppService,
} from '../whatsapp/service'
import { getOfficialWhatsappWebhookSetupData } from '../whatsapp/webhook-config'

export const waba = new Elysia({ tags: ['WABA'] })
	.use(appContext)
	.get('/webhook-config', ({ request, headers }) => {
		return {
			success: true,
			data: getOfficialWhatsappWebhookSetupData(
				request,
				headers as Record<string, unknown>,
			),
		}
	})
	.post(
		'/connect/manual',
		async ({ resolvedAppId, body, set, request, headers }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			const accessToken = body.accessToken.trim()
			const wabaId = body.wabaId.trim()

			if (!accessToken || !wabaId) {
				set.status = 400
				return { error: 'Access Token and WABA ID are required' }
			}

			try {
				const createdChannels = await WhatsAppService.completeWabaSync(
					accessToken,
					resolvedAppId,
					{ wabaIds: [wabaId], phoneIds: [] },
				)

				if (createdChannels.length === 0) {
					set.status = 400
					return { error: 'No WhatsApp channels were found or created' }
				}

				return {
					success: true,
					data: {
						channels: createdChannels,
						primaryChannelId: createdChannels[0].id,
						webhook: getOfficialWhatsappWebhookSetupData(
							request,
							headers as Record<string, unknown>,
						),
					},
				}
			} catch (error: any) {
				console.error('[WABA] Manual connect error:', error)
				const errorCode = String(error?.code || '').toUpperCase()
				set.status =
					error instanceof WhatsAppChannelAssignmentConflictError ||
					errorCode === 'P2002'
						? 409
						: 400
				return { error: error.message || 'Failed to connect WABA manually' }
			}
		},
		{
			body: WhatsAppRequestModel.manualConnect,
		},
	)
