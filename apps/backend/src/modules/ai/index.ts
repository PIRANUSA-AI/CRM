import { Elysia, t } from 'elysia'
import { appContext } from '../../plugins'
import { AIRequestModel } from './model'
import { AIService } from './service'

function toErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message
	}
	return fallback
}

export const ai = new Elysia({ prefix: '/ai', tags: ['AI'] })
	.use(appContext)
	.get(
		'/settings',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const settings = await AIService.getSettings(resolvedAppId)
			const providerConfigurations = await AIService.getProviderConfigurations()
			const activeProvider = providerConfigurations.active_provider
			const activeEmbeddingProvider =
				providerConfigurations.active_embedding_provider
			const activeProviderConfig = activeProvider
				? providerConfigurations.providers[activeProvider]
				: null

			return {
				data: {
					...settings,
					active_provider: activeProvider,
					active_embedding_provider: activeEmbeddingProvider,
					provider_configurations: providerConfigurations.providers,
					model_provider: activeProvider || settings?.model_provider || null,
					embedding_provider: activeEmbeddingProvider || activeProvider || null,
					api_endpoint:
						activeProviderConfig?.base_url || settings?.api_endpoint || null,
					api_key: activeProviderConfig?.api_key || settings?.api_key || null,
					api_version:
						activeProviderConfig?.api_version || settings?.api_version || null,
					deployment_name:
						activeProviderConfig?.deployment_name ||
						settings?.deployment_name ||
						null,
					model_name:
						settings?.model_name || activeProviderConfig?.model_name || null,
					temperature:
						activeProviderConfig?.temperature ?? settings?.temperature ?? null,
					max_tokens:
						activeProviderConfig?.max_tokens ?? settings?.max_tokens ?? null,
				},
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.patch(
		'/settings',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const settings = await AIService.updateSettings(resolvedAppId, body)
			return { data: settings }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.updateSettings,
		},
	)
	.get('/providers', async () => {
		const providers = await AIService.getProviderConfigurations()
		return { data: providers }
	})
	.put(
		'/providers/:provider',
		async ({ params, body }) => {
			const config = await AIService.upsertProviderConfiguration(
				params.provider,
				body,
			)
			return { data: config }
		},
		{
			params: t.Object({
				provider: t.Union([
					t.Literal('growthcircle'),
					t.Literal('custom'),
					t.Literal('azure'),
					t.Literal('sumopod'),
				]),
			}),
			body: AIRequestModel.upsertProviderConfig,
		},
	)
	.post(
		'/providers/:provider/test',
		async ({ params, body, set }) => {
			try {
				const result = await AIService.testProviderModel(params.provider, body)
				return { data: result }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to test provider model'),
				}
			}
		},
		{
			params: t.Object({
				provider: t.Union([
					t.Literal('growthcircle'),
					t.Literal('custom'),
					t.Literal('azure'),
					t.Literal('sumopod'),
				]),
			}),
			body: AIRequestModel.testProviderModel,
		},
	)
	.patch(
		'/providers/active',
		async ({ body }) => {
			const provider = await AIService.setActiveProvider(body.provider)
			return { data: { active_provider: provider } }
		},
		{
			body: AIRequestModel.setActiveProvider,
		},
	)
	.patch(
		'/providers/embedding-active',
		async ({ body }) => {
			const provider = await AIService.setActiveEmbeddingProvider(body.provider)
			return { data: { active_embedding_provider: provider } }
		},
		{
			body: AIRequestModel.setActiveEmbeddingProvider,
		},
	)
	.get(
		'/playground',
		async ({ resolvedAppId, query, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const state = await AIService.getPlaygroundState(
					resolvedAppId,
					query.sessionId,
				)
				return { data: state }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to load playground state'),
				}
			}
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				sessionId: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/playground/session',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const state = await AIService.resetPlaygroundSession(
					resolvedAppId,
					body,
				)
				return { data: state }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to reset playground session'),
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.resetPlaygroundSession,
		},
	)
	.post(
		'/playground/strategy',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const state = await AIService.createPlaygroundRoutingStrategy(
					resolvedAppId,
					body,
				)
				return { data: state }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(
						error,
						'Failed to create playground routing strategy',
					),
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.createPlaygroundStrategy,
		},
	)
	.get(
		'/playground/personas',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const personas = await AIService.getPlaygroundPersonas(resolvedAppId)
				return { data: personas }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to load playground personas'),
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/playground/personas',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const personas = await AIService.createPlaygroundPersona(
					resolvedAppId,
					body,
				)
				return { data: personas }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to create persona'),
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.createPlaygroundPersona,
		},
	)
	.patch(
		'/playground/personas/:personaId',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const personas = await AIService.updatePlaygroundPersona(
					resolvedAppId,
					params.personaId,
					body,
				)
				return { data: personas }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to update persona'),
				}
			}
		},
		{
			params: t.Object({ personaId: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.updatePlaygroundPersona,
		},
	)
	.delete(
		'/playground/personas/:personaId',
		async ({ resolvedAppId, params, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const personas = await AIService.deletePlaygroundPersona(
					resolvedAppId,
					params.personaId,
				)
				return { data: personas }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to delete persona'),
				}
			}
		},
		{
			params: t.Object({ personaId: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.patch(
		'/playground/session/:sessionId',
		async ({ resolvedAppId, params, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const state = await AIService.updatePlaygroundSession(
					resolvedAppId,
					params.sessionId,
					body,
				)
				return { data: state }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to update playground session'),
				}
			}
		},
		{
			params: t.Object({ sessionId: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.playgroundSelection,
		},
	)
	.post(
		'/playground/run',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const state = await AIService.runPlayground(resolvedAppId, body)
				return { data: state }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(error, 'Failed to run playground simulation'),
				}
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: AIRequestModel.runPlayground,
		},
	)
	.get(
		'/playground/run/:jobId',
		async ({ resolvedAppId, params, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const result = await AIService.getPlaygroundRunJob(
					resolvedAppId,
					params.jobId,
				)
				return { data: result }
			} catch (error: unknown) {
				set.status = 400
				return {
					error: toErrorMessage(
						error,
						'Failed to get playground run background job status',
					),
				}
			}
		},
		{
			params: t.Object({ jobId: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.get(
		'/suggest/:conversationId',
		async ({ params, resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const suggestion = await AIService.getSuggestions(
					params.conversationId,
					resolvedAppId,
				)
				return { data: suggestion }
			} catch (error: unknown) {
				return { error: toErrorMessage(error, 'Failed to generate suggestion') }
			}
		},
		{
			params: t.Object({ conversationId: t.String() }),
			query: t.Object({ appId: t.Optional(t.String()) }),
		},
	)
	.post(
		'/generate',
		async ({ resolvedAppId, body, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}

			try {
				const response = await AIService.generateResponse(resolvedAppId, body)
				return { success: true, ...response }
			} catch (error: unknown) {
				return { error: toErrorMessage(error, 'Failed to generate response') }
			}
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Object({
				message: t.String(),
				conversationId: t.Optional(t.String()),
			}),
		},
	)
	.post(
		'/evaluate',
		async ({ body, resolvedAppId, set }) => {
			const targetAppId = resolvedAppId || body.appId
			if (!targetAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const evaluation = await AIService.recordEvaluation({
				...body,
				appId: targetAppId,
			})
			return { data: evaluation }
		},
		{
			query: t.Object({ appId: t.Optional(t.String()) }),
			body: t.Object({
				appId: t.Optional(t.String()),
				conversationId: t.String(),
				score: t.Number(),
				feedback: t.Optional(t.String()),
			}),
		},
	)
