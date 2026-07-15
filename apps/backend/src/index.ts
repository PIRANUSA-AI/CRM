import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import { node } from '@elysiajs/node'
import { config as loadDotEnv } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
	agentManagement,
	agentSettings,
	ai,
	apiTools,
	authModule,
	businessWebhooks,
	broadcast,
	cannedResponse,
	chatbot,
	contact,
	customer,
	conversation,
	crm,
	developerKeys,
	flow,
	form,
	handover,
	inbox,
	knowledge,
	label,
	media,
	message,
	metrics,
	orchestration,
	personalWhatsappInbox,
	teamModule,
	templateVariables,
	userModule,
	webhook,
	webhooks,
	waba,
	whatsapp,
	whatsappModule,
} from './modules'
import {
	appContext,
	auth,
	betterAuthPlugin,
	openapiPlugin,
	socketPlugin,
} from './plugins'

const currentDir = dirname(fileURLToPath(import.meta.url))
const workspaceDir = resolve(currentDir, '../../..')

// The monorepo root is the single source of environment configuration.
const workspaceEnvPath = resolve(workspaceDir, '.env')
if (existsSync(workspaceEnvPath)) {
	loadDotEnv({ path: workspaceEnvPath, override: false })
}

const APP_MODE = (process.env.APP_MODE || 'api').toLowerCase()
const IS_API_MODE = APP_MODE === 'api'

const normalizeOrigin = (origin: string) => {
	const trimmed = origin.trim()
	if (!trimmed) return []
	if (/^https?:\/\//i.test(trimmed)) return [trimmed]
	return [`https://${trimmed}`, `http://${trimmed}`]
}

// Create main application
export const app = new Elysia({ adapter: node() })
	// Middleware
	.use(
		cors({
			origin: (request) => {
				const origin = request.headers.get('origin')
				if (!origin) return false
				const envFrontendUrls = (process.env.FRONTEND_URL || '')
					.split(',')
					.flatMap(normalizeOrigin)
				const allowedOrigins = [
					...envFrontendUrls,
					...normalizeOrigin(process.env.TUNNEL_FE_HOST || ''),
					'https://app.crm.chat',
					'https://crm.chat',
					'http://localhost:5173',
					'http://localhost:3000',
					'http://localhost:3005',
					'http://localhost:3006',
					'http://localhost:3309',
				].filter(Boolean)

				return allowedOrigins.includes(origin)
			},
			credentials: true,
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
			allowedHeaders: [
				'Content-Type',
				'Authorization',
				'x-business-id',
				'x-api-key',
				'DNT',
				'x-app-id',
				'x-app-secret',
				'x-org-slug',
			],
		}),
	)

	// Plugins
	.use(betterAuthPlugin)
	.use(openapiPlugin)
	.use(IS_API_MODE ? socketPlugin : (app) => app)
	.use(appContext)

	// Health check
	.get('/health', () => ({
		status: 'healthy',
		timestamp: new Date().toISOString(),
		version: '2.0.0',
	}))

	// API Compatibility routes
	.group('/api', (app) =>
		app
			.use(authModule)
			.use(userModule)
			.use(conversation)
			.use(message)
			.use(contact)
			.use(customer)
				.group('/whatsapp-channels', (app) => app.use(whatsapp))
				.group('/waba', (app) => app.use(waba))
				.use(webhook)
			.use(businessWebhooks)
			.use(webhooks)
			.use(media)
			.use(ai)
			.use(apiTools)
			.use(chatbot)
			.use(knowledge)
			.use(flow)
			.use(orchestration)
			.use(personalWhatsappInbox)
			.use(crm)
			.use(teamModule)
			.use(inbox)
			.group('/agents-management', (app) => app.use(agentManagement))
			.group('/agents', (app) => app.use(agentManagement))
			.use(label)
			.use(broadcast)
			.use(handover)
			.use(form)
			.use(metrics)
			.use(cannedResponse)
			.use(agentSettings)
			.use(whatsappModule)
			.use(templateVariables)
				.use(developerKeys)
			// Specific compatibility mappings
			.get('/ai-settings', async ({ query, headers, resolvedAppId }) => {
				const appId = resolvedAppId || query.appId || headers['x-app-id']
				if (!appId) return { error: 'Organization or app ID required' }
				const { AIService } = await import('./modules/ai/service')
				const settings = await AIService.getSettings(appId)
				const providerConfigurations =
					await AIService.getProviderConfigurations()
				const activeProvider = providerConfigurations.active_provider
				const activeEmbeddingProvider =
					providerConfigurations.active_embedding_provider
				const activeProviderConfig = activeProvider
					? providerConfigurations.providers[activeProvider]
					: null

				const payload = {
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
				}

				return { success: true, payload }
			})
			.put(
				'/ai-settings',
				async ({ query, headers, resolvedAppId, body, set }) => {
					const appId = resolvedAppId || query.appId || headers['x-app-id']
					if (!appId) {
						set.status = 400
						return { error: 'Organization or app ID required' }
					}

					const { AIService } = await import('./modules/ai/service')
					const nextBody = (body || {}) as Record<string, any>
					const settings = await AIService.updateSettings(appId, nextBody)

					return { success: true, payload: settings }
				},
			)
			.get('/ai-providers', async () => {
				const { AIService } = await import('./modules/ai/service')
				const providers = await AIService.getProviderConfigurations()
				return { success: true, payload: providers }
			})
			.put(
				'/ai-providers/:provider',
				async ({ params, body, set }) => {
					try {
						const { AIService } = await import('./modules/ai/service')
						const config = await AIService.upsertProviderConfiguration(
							params.provider,
							body,
						)
						return { success: true, payload: config }
					} catch (error: any) {
						set.status = 400
						return { error: error?.message || 'Failed to save provider config' }
					}
				},
			)
			.post('/ai-providers/:provider/test', async ({ params, body, set }) => {
				try {
					const { AIService } = await import('./modules/ai/service')
					const result = await AIService.testProviderModel(
						params.provider,
						(body || {}) as any,
					)
					return { success: true, payload: result }
				} catch (error: any) {
					set.status = 400
					return { error: error?.message || 'Failed to test provider model' }
				}
			})
			.patch('/ai-providers/active', async ({ body, set }) => {
				try {
					const { AIService } = await import('./modules/ai/service')
					const provider = await AIService.setActiveProvider(
						(body as any)?.provider || '',
					)
					return { success: true, payload: { active_provider: provider } }
				} catch (error: any) {
					set.status = 400
					return { error: error?.message || 'Failed to set active provider' }
				}
			})
			.patch('/ai-providers/embedding-active', async ({ body, set }) => {
				try {
					const { AIService } = await import('./modules/ai/service')
					const provider = await AIService.setActiveEmbeddingProvider(
						(body as any)?.provider || '',
					)
					return {
						success: true,
						payload: { active_embedding_provider: provider },
					}
				} catch (error: any) {
					set.status = 400
					return {
						error: error?.message || 'Failed to set active embedding provider',
					}
				}
			})
			.use(
				new Elysia({ prefix: '/whatsapp' }).use(whatsappModule).use(whatsapp),
			),
	)

	// API v1 routes
	.group('/api/v1', (app) =>
		app
			.use(userModule)
			.use(conversation)
			.use(message)
			.use(contact)
			.use(customer)
				.group('/whatsapp-channels', (app) => app.use(whatsapp))
				.group('/waba', (app) => app.use(waba))
				.use(webhook)
			.use(businessWebhooks)
			.use(webhooks)
			.use(media)
			.use(ai)
			.use(apiTools)
			.use(chatbot)
			.use(knowledge)
			.use(flow)
			.use(orchestration)
			.use(crm)
			.use(teamModule)
			.use(inbox)
			.group('/agents-management', (app) => app.use(agentManagement))
			.group('/agents', (app) => app.use(agentManagement))
			.use(label)
			.use(broadcast)
			.use(handover)
			.use(form)
			.use(metrics)
			.use(cannedResponse)
			.use(agentSettings)
			.use(whatsappModule)
			.use(templateVariables),
	)

if (IS_API_MODE) {
	app.listen(process.env.PORT || 3000)
	console.log(
		`CRM API v2.0 running at http://localhost:${app.server?.port}`,
	)
	console.log(`📚 Swagger docs at http://localhost:${app.server?.port}/docs`)
	console.log(`🔐 Auth at http://localhost:${app.server?.port}/auth`)
} else if (APP_MODE === 'worker' || APP_MODE === 'scheduler') {
	await import('./workers')
	console.log(`⚙️ Runtime mode ${APP_MODE} started`)
} else {
	console.error(`❌ Unsupported APP_MODE: ${APP_MODE}`)
	process.exit(1)
}

// Export type for Eden Treaty
export type App = typeof app
