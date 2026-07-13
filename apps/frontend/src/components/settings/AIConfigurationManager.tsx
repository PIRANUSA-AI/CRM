import { useCallback, useEffect, useMemo, useState } from 'react'
import { Brain, Copy, Key, Save, Sparkles, Terminal, Zap } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

type AISettings = {
	app_id?: string
	ai_mode: 'assist' | 'hybrid' | 'auto' | 'off'
	model_provider: string
	model_name: string
	temperature: number
	max_tokens: number
	auto_reply_confidence: number
	handoff_keywords: string[]
	response_tone: string
	supported_languages: string[]
	auto_detect_language: boolean
	use_platform_credentials: boolean
	api_key?: string
	api_endpoint?: string
	api_version?: string
	deployment_name?: string
}

type ProviderProtocol = 'openai' | 'anthropic'

type ProviderChannelConfig = {
	base_url: string
	path?: string
	auth_header?: 'authorization' | 'x-api-key'
	auth_scheme?: 'bearer' | 'raw'
}

type ProviderModelCatalogItem = {
	id: string
	name: string
	vendor: string
	context_window: string
	max_output: string
}

type ProviderPlanType = 'free' | 'paid' | 'team'

type ProviderConfig = {
	provider: string
	base_url: string
	api_key?: string
	plan_type?: ProviderPlanType
	model_name?: string
	api_version?: string
	deployment_name?: string
	temperature?: number
	max_tokens?: number
	default_protocol?: ProviderProtocol
	channels?: Partial<Record<ProviderProtocol, ProviderChannelConfig>>
	models?: ProviderModelCatalogItem[]
}

type ProviderConfigurationsPayload = {
	active_provider: string | null
	active_embedding_provider?: string | null
	providers: Record<string, ProviderConfig | null>
}

type ProviderTestResult = {
	provider: string
	protocol: ProviderProtocol
	endpoint: string
	model: {
		id: string
		name: string | null
		vendor: string | null
	}
	request: {
		model: string
		message: string
		max_tokens: number | null
	}
	response: {
		status: number
		text: string | null
		usage: unknown
		raw: unknown
	}
}

const ACTIVE_PROVIDER_OPTIONS = ['growthcircle', 'custom'] as const
const ACTIVE_PROVIDER_LABELS: Record<
	(typeof ACTIVE_PROVIDER_OPTIONS)[number],
	string
> = {
	growthcircle: 'Growthcircle',
	custom: 'Custom',
}

const GROWTHCIRCLE_MODELS: ProviderModelCatalogItem[] = [
	{
		id: 'gpt-5.5',
		name: 'gpt-5.5',
		vendor: 'OpenAI',
		context_window: '1.1M',
		max_output: '128K',
	},
	{
		id: 'gpt-5.4',
		name: 'gpt-5.4',
		vendor: 'OpenAI',
		context_window: '1.1M',
		max_output: '128K',
	},
	{
		id: 'gpt-5.4-mini',
		name: 'gpt-5.4 mini',
		vendor: 'OpenAI',
		context_window: '400K',
		max_output: '128K',
	},
	{
		id: 'claude-haiku-4-5-20251001',
		name: 'Claude Haiku 4.5 (2025-10-01)',
		vendor: 'Anthropic',
		context_window: '200K',
		max_output: '64K',
	},
	{
		id: 'claude-3-5-haiku-latest',
		name: 'Claude 3.5 Haiku (Latest)',
		vendor: 'Anthropic',
		context_window: '200K',
		max_output: '8K',
	},
	{
		id: 'MiniMax-M2.7-highspeed',
		name: 'MiniMax M2.7 Highspeed',
		vendor: 'MiniMax',
		context_window: '205K',
		max_output: '64K',
	},
	{
		id: 'MiniMax-M2.7',
		name: 'MiniMax M2.7',
		vendor: 'MiniMax',
		context_window: '205K',
		max_output: '64K',
	},
]

const DEFAULT_GROWTHCIRCLE_PROVIDER: ProviderConfig = {
	provider: 'growthcircle',
	plan_type: 'paid',
	base_url: 'https://ai.growthcircle.id/v1',
	model_name: 'gpt-5.4',
	default_protocol: 'openai',
	channels: {
		openai: {
			base_url: 'https://ai.growthcircle.id/v1',
			auth_header: 'authorization',
			auth_scheme: 'bearer',
		},
		anthropic: {
			base_url: 'https://ai.growthcircle.id/anthropic',
			path: '/v1/messages',
			auth_header: 'x-api-key',
			auth_scheme: 'raw',
		},
	},
	models: GROWTHCIRCLE_MODELS,
}

const DEFAULT_CUSTOM_MODEL: ProviderModelCatalogItem = {
	id: 'custom/provider',
	name: 'custom/provider',
	vendor: 'OpenAI',
	context_window: '200000',
	max_output: '8192',
}

const DEFAULT_CUSTOM_PROVIDER: ProviderConfig = {
	provider: 'custom',
	base_url: '',
	api_key: '',
	model_name: DEFAULT_CUSTOM_MODEL.id,
	max_tokens: 8192,
	default_protocol: 'openai',
	channels: {
		openai: {
			base_url: '',
			auth_header: 'authorization',
			auth_scheme: 'bearer',
		},
	},
	models: [DEFAULT_CUSTOM_MODEL],
}

const DEFAULT_SETTINGS: AISettings = {
	ai_mode: 'assist',
	model_provider: 'growthcircle',
	model_name: 'gpt-5.4',
	temperature: 0.2,
	max_tokens: 280,
	auto_reply_confidence: 0.8,
	handoff_keywords: [],
	response_tone: '',
	supported_languages: ['id'],
	auto_detect_language: true,
	use_platform_credentials: false,
}

function cloneProviderConfig(config: ProviderConfig): ProviderConfig {
	return {
		...config,
		channels: config.channels
			? {
					openai: config.channels.openai
						? { ...config.channels.openai }
						: undefined,
					anthropic: config.channels.anthropic
						? { ...config.channels.anthropic }
						: undefined,
				}
			: undefined,
		models: Array.isArray(config.models)
			? config.models.map((item) => ({ ...item }))
			: undefined,
	}
}

function getCustomChannelConfig(
	protocol: ProviderProtocol,
	baseUrl: string,
	previous?: ProviderChannelConfig,
): ProviderChannelConfig {
	if (protocol === 'anthropic') {
		return {
			base_url: baseUrl,
			path: previous?.path || '/v1/messages',
			auth_header: previous?.auth_header || 'x-api-key',
			auth_scheme: previous?.auth_scheme || 'raw',
		}
	}

	return {
		base_url: baseUrl,
		auth_header: previous?.auth_header || 'authorization',
		auth_scheme: previous?.auth_scheme || 'bearer',
	}
}

function parsePositiveInteger(value: unknown): number | null {
	const parsed = Number.parseInt(String(value || '').replace(/,/g, ''), 10)
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function normalizeCustomProviderConfig(
	config?: ProviderConfig | null,
): ProviderConfig {
	const source = config || DEFAULT_CUSTOM_PROVIDER
	const protocol =
		source.default_protocol === 'anthropic' ? 'anthropic' : 'openai'
	const existingModel = source.models?.[0]
	const modelId =
		String(
			source.model_name || existingModel?.id || DEFAULT_CUSTOM_MODEL.id,
		).trim() || DEFAULT_CUSTOM_MODEL.id
	const maxOutput =
		String(
			source.max_tokens ||
				existingModel?.max_output ||
				DEFAULT_CUSTOM_MODEL.max_output,
		).trim() || DEFAULT_CUSTOM_MODEL.max_output
	const model: ProviderModelCatalogItem = {
		...DEFAULT_CUSTOM_MODEL,
		...existingModel,
		id: modelId,
		name: modelId,
		vendor: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI',
		context_window:
			String(
				existingModel?.context_window || DEFAULT_CUSTOM_MODEL.context_window,
			).trim() || DEFAULT_CUSTOM_MODEL.context_window,
		max_output: maxOutput,
	}
	const baseUrl = String(
		source.base_url ||
			source.channels?.[protocol]?.base_url ||
			source.channels?.openai?.base_url ||
			source.channels?.anthropic?.base_url ||
			'',
	).trim()

	return {
		...cloneProviderConfig(DEFAULT_CUSTOM_PROVIDER),
		...source,
		provider: 'custom',
		base_url: baseUrl,
		model_name: modelId,
		max_tokens: parsePositiveInteger(maxOutput) || source.max_tokens || 8192,
		default_protocol: protocol,
		channels: {
			...source.channels,
			[protocol]: getCustomChannelConfig(
				protocol,
				baseUrl,
				source.channels?.[protocol],
			),
		},
		models: [model],
	}
}

function normalizeStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => String(item || '').trim())
		.filter((item) => item.length > 0)
}

function mergeModelCatalogs(
	defaultModels: ProviderModelCatalogItem[] | undefined,
	providerModels: ProviderModelCatalogItem[] | undefined,
): ProviderModelCatalogItem[] | undefined {
	const merged = new Map<string, ProviderModelCatalogItem>()
	for (const model of defaultModels || []) {
		if (model.id) merged.set(model.id, { ...model })
	}
	for (const model of providerModels || []) {
		if (model.id) merged.set(model.id, { ...merged.get(model.id), ...model })
	}
	return merged.size > 0 ? Array.from(merged.values()) : undefined
}

function normalizeProviderConfig(
	provider: string,
	raw: unknown,
): ProviderConfig {
	const record =
		raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
	const channelsRaw =
		record.channels && typeof record.channels === 'object'
			? (record.channels as Record<string, unknown>)
			: null
	const modelsRaw = Array.isArray(record.models)
		? (record.models as Array<Record<string, unknown>>)
		: []

	const baseConfig: ProviderConfig = {
		provider,
		base_url: String(record.base_url || '').trim(),
		api_key: typeof record.api_key === 'string' ? record.api_key : undefined,
		model_name:
			typeof record.model_name === 'string' ? record.model_name : undefined,
		api_version:
			typeof record.api_version === 'string' ? record.api_version : undefined,
		plan_type:
			record.plan_type === 'paid' || record.plan_type === 'team'
				? record.plan_type
				: 'free',
		deployment_name:
			typeof record.deployment_name === 'string'
				? record.deployment_name
				: undefined,
		default_protocol:
			record.default_protocol === 'openai' ||
			record.default_protocol === 'anthropic'
				? (record.default_protocol as ProviderProtocol)
				: undefined,
		channels: channelsRaw
			? {
					openai:
						channelsRaw.openai && typeof channelsRaw.openai === 'object'
							? {
									base_url: String(
										(channelsRaw.openai as Record<string, unknown>).base_url ||
											'',
									).trim(),
									path:
										typeof (channelsRaw.openai as Record<string, unknown>)
											.path === 'string'
											? String(
													(channelsRaw.openai as Record<string, unknown>).path,
												)
											: undefined,
									auth_header:
										(channelsRaw.openai as Record<string, unknown>)
											.auth_header === 'x-api-key'
											? 'x-api-key'
											: 'authorization',
									auth_scheme:
										(channelsRaw.openai as Record<string, unknown>)
											.auth_scheme === 'raw'
											? 'raw'
											: 'bearer',
								}
							: undefined,
					anthropic:
						channelsRaw.anthropic && typeof channelsRaw.anthropic === 'object'
							? {
									base_url: String(
										(channelsRaw.anthropic as Record<string, unknown>)
											.base_url || '',
									).trim(),
									path:
										typeof (channelsRaw.anthropic as Record<string, unknown>)
											.path === 'string'
											? String(
													(channelsRaw.anthropic as Record<string, unknown>)
														.path,
												)
											: undefined,
									auth_header:
										(channelsRaw.anthropic as Record<string, unknown>)
											.auth_header === 'authorization'
											? 'authorization'
											: 'x-api-key',
									auth_scheme:
										(channelsRaw.anthropic as Record<string, unknown>)
											.auth_scheme === 'bearer'
											? 'bearer'
											: 'raw',
								}
							: undefined,
				}
			: undefined,
		models: modelsRaw
			.map((model) => {
				const rawId = String(model.id || '').trim()
				return {
					id: rawId.replace(/-free$/, ''),
					name: String(model.name || model.id || '').trim(),
					vendor: String(model.vendor || '').trim(),
					context_window: String(model.context_window || '').trim(),
					max_output: String(model.max_output || '').trim(),
				}
			})
			.filter((model) => model.id),
	}

	if (provider === 'growthcircle') {
		const merged = cloneProviderConfig(DEFAULT_GROWTHCIRCLE_PROVIDER)
		const planType = baseConfig.plan_type || merged.plan_type || 'free'
		let rawModelName = baseConfig.model_name || merged.model_name || 'gpt-5.4'

			if (planType === 'paid' || planType === 'team') {
				rawModelName = rawModelName.replace(/-free$/, '')
			} else if (planType === 'free' && !rawModelName.endsWith('-free')) {
				rawModelName = `${rawModelName}-free`
		}

			const models = mergeModelCatalogs(merged.models, baseConfig.models)

			return {
				...merged,
				...baseConfig,
				plan_type: planType,
			base_url: baseConfig.base_url || merged.base_url,
			model_name: rawModelName,
			default_protocol: baseConfig.default_protocol || merged.default_protocol,
			channels: {
				openai: {
					...merged.channels?.openai,
					...baseConfig.channels?.openai,
					base_url:
						baseConfig.channels?.openai?.base_url ||
						merged.channels?.openai?.base_url ||
						merged.base_url,
				},
				anthropic: {
					...merged.channels?.anthropic,
					...baseConfig.channels?.anthropic,
					base_url:
						baseConfig.channels?.anthropic?.base_url ||
						merged.channels?.anthropic?.base_url ||
						'https://ai.growthcircle.id/anthropic',
					path:
						baseConfig.channels?.anthropic?.path ||
						merged.channels?.anthropic?.path ||
						'/v1/messages',
				},
			},
				models,
			}
		}

	if (provider === 'custom') {
		return normalizeCustomProviderConfig(baseConfig)
	}

	return baseConfig
}

function inferProtocolFromCatalog(args: {
	modelId?: string
	vendor?: string
	fallback?: ProviderProtocol
}): ProviderProtocol {
	const vendor = String(args.vendor || '')
		.trim()
		.toLowerCase()
	const modelId = String(args.modelId || '')
		.trim()
		.toLowerCase()

	if (vendor.includes('anthropic') || modelId.includes('claude')) {
		return 'anthropic'
	}
	if (
		vendor.includes('openai') ||
		modelId.startsWith('gpt') ||
		modelId.startsWith('o1') ||
		modelId.startsWith('o3') ||
		modelId.startsWith('o4')
	) {
		return 'openai'
	}

	return args.fallback || 'openai'
}

function parseTokenLimit(value: string | undefined): number | null {
	if (!value) return null
	const normalized = String(value).trim().toLowerCase().replace(/,/g, '')
	const match = normalized.match(/^(\d+(?:\.\d+)?)\s*([km])?$/)
	if (!match) return null

	const amount = Number(match[1])
	if (!Number.isFinite(amount) || amount <= 0) return null
	const multiplier = match[2] === 'm' ? 1_000_000 : match[2] === 'k' ? 1_000 : 1
	return Math.max(1, Math.trunc(amount * multiplier))
}

function isVisibleActiveProvider(provider: string): boolean {
	return ACTIVE_PROVIDER_OPTIONS.includes(
		provider as (typeof ACTIVE_PROVIDER_OPTIONS)[number],
	)
}

function formatProviderLabel(provider: string): string {
	return isVisibleActiveProvider(provider)
		? ACTIVE_PROVIDER_LABELS[
				provider as (typeof ACTIVE_PROVIDER_OPTIONS)[number]
			]
		: provider
}

export default function AIConfigurationManager() {
	const [settings, setSettings] = useState<AISettings | null>(null)
	const [providerConfigs, setProviderConfigs] = useState<
		Record<string, ProviderConfig | null>
	>({
		growthcircle: cloneProviderConfig(DEFAULT_GROWTHCIRCLE_PROVIDER),
		custom: cloneProviderConfig(DEFAULT_CUSTOM_PROVIDER),
	})
	const [activeProvider, setActiveProvider] = useState('growthcircle')
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [showKey, setShowKey] = useState(false)
	const [testPrompt, setTestPrompt] = useState('Halo')
	const [testingProvider, setTestingProvider] = useState(false)
	const [testResult, setTestResult] = useState<ProviderTestResult | null>(null)
	const [testError, setTestError] = useState<string | null>(null)

	const token =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_token')
			: null

	const currentProviderConfig = useMemo(() => {
		const selected = providerConfigs[activeProvider]
		if (activeProvider === 'custom') {
			return normalizeCustomProviderConfig(selected)
		}
		if (selected) return selected
		if (activeProvider === 'growthcircle') {
			return cloneProviderConfig(DEFAULT_GROWTHCIRCLE_PROVIDER)
		}
		return {
			provider: activeProvider,
			base_url: '',
			model_name: '',
		}
	}, [providerConfigs, activeProvider])

	const providerOptions = useMemo(() => {
		return ACTIVE_PROVIDER_OPTIONS
	}, [])

	const selectedCatalogModel = useMemo(() => {
		const targetModel = String(currentProviderConfig.model_name || '').trim()
		if (!targetModel) return null
		const catalog = currentProviderConfig.models || []
		return (
			catalog.find(
				(item) => item.id === targetModel || item.name === targetModel,
			) || null
		)
	}, [currentProviderConfig.model_name, currentProviderConfig.models])

	const inferredTestProtocol = useMemo(
		() =>
			inferProtocolFromCatalog({
				modelId: currentProviderConfig.model_name,
				vendor: selectedCatalogModel?.vendor,
				fallback: currentProviderConfig.default_protocol || 'openai',
			}),
		[
			currentProviderConfig.default_protocol,
			currentProviderConfig.model_name,
			selectedCatalogModel?.vendor,
		],
	)

	const inferredTestMaxTokens = useMemo(
		() => parseTokenLimit(selectedCatalogModel?.max_output),
		[selectedCatalogModel?.max_output],
	)

	const currentProviderBaseUrl = useMemo(() => {
		const protocol =
			currentProviderConfig.default_protocol || inferredTestProtocol
		return String(
			currentProviderConfig.channels?.[protocol]?.base_url ||
				currentProviderConfig.base_url ||
				'',
		).trim()
	}, [
		currentProviderConfig.base_url,
		currentProviderConfig.channels,
		currentProviderConfig.default_protocol,
		inferredTestProtocol,
	])

	const generatedCurl = useMemo(() => {
		const modelId =
			String(currentProviderConfig.model_name || '').trim() || 'gpt-5.4'
		const apiKey =
			String(currentProviderConfig.api_key || '').trim() || '<API_KEY>'
		const protocol = inferredTestProtocol
		const maxTokens =
			inferredTestMaxTokens || currentProviderConfig.max_tokens || 256
		const prompt = testPrompt || 'Halo'

		let baseUrl = currentProviderConfig.base_url || ''
		let path = ''
		let authHeader = 'authorization'
		let authScheme = 'bearer'

		if (protocol === 'anthropic') {
			baseUrl = currentProviderConfig.channels?.anthropic?.base_url || baseUrl
			path = currentProviderConfig.channels?.anthropic?.path || ''
			authHeader =
				currentProviderConfig.channels?.anthropic?.auth_header || 'x-api-key'
			authScheme =
				currentProviderConfig.channels?.anthropic?.auth_scheme || 'raw'
		} else {
			baseUrl = currentProviderConfig.channels?.openai?.base_url || baseUrl
			authHeader =
				currentProviderConfig.channels?.openai?.auth_header || 'authorization'
			authScheme =
				currentProviderConfig.channels?.openai?.auth_scheme || 'bearer'
		}

		if (activeProvider === 'custom') {
			path = ''
		} else if (!path) {
			const baseUrlEndsWithVersion = /\/v\d+\/?$/i.test(baseUrl)
			path =
				protocol === 'anthropic'
					? baseUrlEndsWithVersion
						? '/messages'
						: '/v1/messages'
					: baseUrlEndsWithVersion
						? '/chat/completions'
						: '/v1/chat/completions'
		}

		const endpoint = path
			? baseUrl.replace(/\/+$/, '') + (path.startsWith('/') ? path : `/${path}`)
			: baseUrl
		const finalAuthHeaderName =
			authHeader === 'authorization' ? 'Authorization' : authHeader
		const finalAuthHeaderValue =
			authScheme === 'bearer' ? `Bearer ${apiKey}` : apiKey

		const body = {
			model: modelId,
			max_tokens: maxTokens,
			messages: [{ role: 'user', content: prompt }],
		}

		return `curl -X POST "${endpoint}" \\
  -H "Content-Type: application/json" \\
  -H "${finalAuthHeaderName}: ${finalAuthHeaderValue}" \\
  -d '${JSON.stringify(body, null, 2)}'`
	}, [
			currentProviderConfig,
			activeProvider,
			inferredTestProtocol,
			inferredTestMaxTokens,
			testPrompt,
	])

	const updateCurrentProviderConfig = (
		updater: (prev: ProviderConfig) => ProviderConfig,
	) => {
		setProviderConfigs((prev) => {
			const current = prev[activeProvider]
			const normalized =
				activeProvider === 'growthcircle'
					? current || cloneProviderConfig(DEFAULT_GROWTHCIRCLE_PROVIDER)
					: activeProvider === 'custom'
						? normalizeCustomProviderConfig(current)
						: current || {
								provider: activeProvider,
								base_url: '',
								model_name: '',
							}
			return {
				...prev,
				[activeProvider]:
					activeProvider === 'custom'
						? normalizeCustomProviderConfig(updater(normalized))
						: updater(normalized),
			}
		})
	}

	const updateCustomBaseUrl = (baseUrl: string) => {
		updateCurrentProviderConfig((prev) => {
			const protocol = prev.default_protocol || 'openai'
			return {
				...prev,
				base_url: baseUrl,
				channels: {
					...prev.channels,
					[protocol]: getCustomChannelConfig(
						protocol,
						baseUrl,
						prev.channels?.[protocol],
					),
				},
			}
		})
	}

	const updateCustomProtocol = (protocol: ProviderProtocol) => {
		updateCurrentProviderConfig((prev) => {
			const baseUrl =
				prev.base_url ||
				prev.channels?.[prev.default_protocol || 'openai']?.base_url ||
				''
			const model = {
				...(prev.models?.[0] || DEFAULT_CUSTOM_MODEL),
				vendor: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI',
			}
			return {
				...prev,
				default_protocol: protocol,
				channels: {
					...prev.channels,
					[protocol]: getCustomChannelConfig(
						protocol,
						baseUrl,
						prev.channels?.[protocol],
					),
				},
				models: [model],
			}
		})
	}

	const updateCustomModel = (patch: Partial<ProviderModelCatalogItem>) => {
		updateCurrentProviderConfig((prev) => {
			const protocol = prev.default_protocol || 'openai'
			const previousModel = prev.models?.[0] || DEFAULT_CUSTOM_MODEL
			const nextModel = {
				...DEFAULT_CUSTOM_MODEL,
				...previousModel,
				...patch,
			}
			const modelId =
				String(nextModel.id || '').trim() || DEFAULT_CUSTOM_MODEL.id
			const maxTokens =
				parsePositiveInteger(nextModel.max_output) || prev.max_tokens || 8192

			return {
				...prev,
				model_name: modelId,
				max_tokens: maxTokens,
				models: [
					{
						...nextModel,
						id: modelId,
						name: modelId,
						vendor: protocol === 'anthropic' ? 'Anthropic' : 'OpenAI',
						max_output: String(nextModel.max_output || maxTokens),
					},
				],
			}
		})
	}

	const fetchSettings = useCallback(async () => {
		setLoading(true)
		try {
			const [settingsRes, providersRes] = await Promise.all([
				fetch('/api/ai-settings', {
					headers: { Authorization: `Bearer ${token}` },
				}),
				fetch('/api/ai-providers', {
					headers: { Authorization: `Bearer ${token}` },
				}),
			])

			const settingsJson = await settingsRes.json().catch(() => ({}))
			const providersJson = await providersRes.json().catch(() => ({}))

			const settingsPayload = (settingsJson?.payload ||
				{}) as Partial<AISettings>
			const nextSettings: AISettings = {
				...DEFAULT_SETTINGS,
				...settingsPayload,
				handoff_keywords: normalizeStringArray(
					settingsPayload.handoff_keywords,
				),
				supported_languages: normalizeStringArray(
					settingsPayload.supported_languages,
				),
			}
			setSettings(nextSettings)

			const providerPayload = (providersJson?.payload ||
				{}) as Partial<ProviderConfigurationsPayload>
			const rawProviders = providerPayload?.providers || {}
			const normalizedProviders = Object.entries(rawProviders).reduce<
				Record<string, ProviderConfig | null>
			>((acc, [providerKey, providerValue]) => {
				acc[providerKey] = providerValue
					? normalizeProviderConfig(providerKey, providerValue)
					: null
				return acc
			}, {})

			if (!normalizedProviders.growthcircle) {
				normalizedProviders.growthcircle = cloneProviderConfig(
					DEFAULT_GROWTHCIRCLE_PROVIDER,
				)
			}
			normalizedProviders.custom = normalizeCustomProviderConfig(
				normalizedProviders.custom || normalizedProviders.azure,
			)

			setProviderConfigs(normalizedProviders)

			const rawActiveProvider =
				(providerPayload.active_provider &&
					typeof providerPayload.active_provider === 'string' &&
					providerPayload.active_provider.trim()) ||
				nextSettings.model_provider ||
				'growthcircle'
			const nextActiveProvider =
				rawActiveProvider === 'azure'
					? 'custom'
					: isVisibleActiveProvider(rawActiveProvider)
						? rawActiveProvider
						: 'growthcircle'
			setActiveProvider(nextActiveProvider)
		} catch (error) {
			console.error('Failed to fetch AI settings:', error)
			toast.error('Failed to load AI settings')
		} finally {
			setLoading(false)
		}
	}, [token])

	useEffect(() => {
		void fetchSettings()
	}, [fetchSettings])

	useEffect(() => {
		setTestResult(null)
		setTestError(null)
	}, [activeProvider, currentProviderConfig.model_name])

	const handleTestProvider = async () => {
		const modelId = String(currentProviderConfig.model_name || '').trim()
		if (!modelId) {
			toast.error('Pilih model dulu sebelum test provider')
			return
		}
		if (!currentProviderBaseUrl) {
			toast.error('Isi Base URL dulu sebelum test provider')
			return
		}

		setTestingProvider(true)
		setTestError(null)
		try {
			const configPayload = {
				base_url: currentProviderConfig.base_url,
				api_key: currentProviderConfig.api_key,
				plan_type: currentProviderConfig.plan_type,
				model_name: currentProviderConfig.model_name,
				api_version: currentProviderConfig.api_version,
				deployment_name: currentProviderConfig.deployment_name,
				temperature: currentProviderConfig.temperature,
				max_tokens: currentProviderConfig.max_tokens,
				default_protocol: currentProviderConfig.default_protocol,
				channels: currentProviderConfig.channels,
				models: currentProviderConfig.models,
			}
			const response = await fetch(`/api/ai-providers/${activeProvider}/test`, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({
					modelId,
					message: testPrompt || 'Halo',
					protocol: inferredTestProtocol,
					maxTokens: inferredTestMaxTokens || currentProviderConfig.max_tokens,
					apiKey: currentProviderConfig.api_key || undefined,
					config: configPayload,
				}),
			})

			const payload = await response.json().catch(() => null)
			if (!response.ok) {
				throw new Error(payload?.error || 'Provider test failed')
			}

			const result = (payload?.payload ||
				payload?.data ||
				null) as ProviderTestResult | null
			if (!result) {
				throw new Error('Provider test returned empty response')
			}

			setTestResult(result)
			toast.success('Provider test success')
		} catch (error) {
			const message =
				error instanceof Error ? error.message : 'Provider test failed'
			setTestResult(null)
			setTestError(message)
			toast.error(message)
		} finally {
			setTestingProvider(false)
		}
	}

	const handleSave = async () => {
		if (!settings || !currentProviderConfig) return
		if (!currentProviderBaseUrl) {
			toast.error('Isi Base URL dulu sebelum simpan provider')
			return
		}
		setSaving(true)
		try {
			const providerPayload = {
				base_url: currentProviderConfig.base_url,
				api_key: currentProviderConfig.api_key,
				plan_type: currentProviderConfig.plan_type,
				model_name: currentProviderConfig.model_name,
				api_version: currentProviderConfig.api_version,
				deployment_name: currentProviderConfig.deployment_name,
				temperature: currentProviderConfig.temperature,
				max_tokens: currentProviderConfig.max_tokens,
				default_protocol: currentProviderConfig.default_protocol,
				channels: currentProviderConfig.channels,
				models: currentProviderConfig.models,
			}

			const providerResponse = await fetch(
				`/api/ai-providers/${activeProvider}`,
				{
					method: 'PUT',
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify(providerPayload),
				},
			)
			if (!providerResponse.ok) {
				const payload = await providerResponse.json().catch(() => null)
				throw new Error(
					payload?.error || 'Failed to save provider configuration',
				)
			}

			const activeResponse = await fetch('/api/ai-providers/active', {
				method: 'PATCH',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify({ provider: activeProvider }),
			})
			if (!activeResponse.ok) {
				const payload = await activeResponse.json().catch(() => null)
				throw new Error(payload?.error || 'Failed to activate provider')
			}

			const embeddingActiveResponse = await fetch(
				'/api/ai-providers/embedding-active',
				{
					method: 'PATCH',
					headers: {
						Authorization: `Bearer ${token}`,
						'Content-Type': 'application/json',
					},
					body: JSON.stringify({ provider: activeProvider }),
				},
			)
			if (!embeddingActiveResponse.ok) {
				const payload = await embeddingActiveResponse.json().catch(() => null)
				throw new Error(
					payload?.error || 'Failed to activate embedding provider',
				)
			}

			const settingsPayload: AISettings = {
				...settings,
				model_provider: activeProvider,
				model_name: currentProviderConfig.model_name || settings.model_name,
				api_endpoint:
					currentProviderConfig.base_url ||
					currentProviderConfig.channels?.openai?.base_url ||
					settings.api_endpoint,
				api_key: currentProviderConfig.api_key || settings.api_key,
			}

			const settingsResponse = await fetch('/api/ai-settings', {
				method: 'PUT',
				headers: {
					Authorization: `Bearer ${token}`,
					'Content-Type': 'application/json',
				},
				body: JSON.stringify(settingsPayload),
			})
			if (!settingsResponse.ok) {
				const payload = await settingsResponse.json().catch(() => null)
				throw new Error(payload?.error || 'Failed to save AI settings')
			}

			setSettings(settingsPayload)
			toast.success('AI models & provider settings saved')
		} catch (error) {
			toast.error(
				error instanceof Error ? error.message : 'Failed to save settings',
			)
		} finally {
			setSaving(false)
		}
	}

	const customModelConfig =
		currentProviderConfig.models?.[0] || DEFAULT_CUSTOM_MODEL

	if (loading) {
		return (
			<div className="p-12 text-center">
				<div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-b-2 border-emerald-500"></div>
				<p className="font-medium text-gray-400">
					Loading AI model settings...
				</p>
			</div>
		)
	}

	if (!settings) return null

	return (
			<div className="space-y-6">
				<Card className="overflow-hidden border-gray-100 shadow-sm">
				<CardHeader className="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
					<div className="flex items-center gap-2">
						<Key size={20} className="text-emerald-600" />
						<CardTitle className="text-lg font-bold">
							AI Models & Providers
						</CardTitle>
					</div>
					<CardDescription>
						Pilih Growthcircle atau Custom untuk credential provider AI.
					</CardDescription>
				</CardHeader>
				<CardContent className="space-y-6 p-6">
					<div className="space-y-4">
						<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
							<div className="grid gap-2">
								<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
									Active Provider
								</p>
								<select
									value={activeProvider}
									onChange={(event) => {
										const nextProvider = event.target.value
										setActiveProvider(nextProvider)
										setSettings((prev) =>
											prev ? { ...prev, model_provider: nextProvider } : prev,
										)
									}}
									className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold"
								>
									{providerOptions.map((provider) => (
										<option key={provider} value={provider}>
											{formatProviderLabel(provider)}
										</option>
									))}
								</select>
							</div>

							{activeProvider === 'growthcircle' && (
								<div className="grid gap-2">
									<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
										API Key
									</p>
									<div className="relative">
										<Input
											type={showKey ? 'text' : 'password'}
											value={currentProviderConfig.api_key || ''}
											onChange={(event) =>
												updateCurrentProviderConfig((prev) => ({
													...prev,
													api_key: event.target.value,
												}))
											}
											placeholder="gcl_xxx"
											className="h-10 rounded-xl border-gray-200 pr-10 font-mono text-xs"
										/>
										<button
											type="button"
											onClick={() => setShowKey((prev) => !prev)}
											className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
										>
											<Zap size={16} />
										</button>
									</div>
								</div>
							)}

							{activeProvider === 'growthcircle' && (
								<div className="grid gap-2">
									<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
										Type
									</p>
									<select
										value={currentProviderConfig.plan_type || 'free'}
										onChange={(event) => {
											const nextPlan = event.target.value as ProviderPlanType
											let nextModel = currentProviderConfig.model_name || ''
											if (nextPlan === 'paid' || nextPlan === 'team') {
												nextModel = nextModel.replace(/-free$/, '')
											} else if (nextPlan === 'free') {
												if (nextModel && !nextModel.endsWith('-free')) {
													nextModel = `${nextModel}-free`
												}
											}

											updateCurrentProviderConfig((prev) => ({
												...prev,
												plan_type: nextPlan,
												model_name: nextModel,
											}))
											setSettings((prev) =>
												prev ? { ...prev, model_name: nextModel } : prev,
											)
										}}
										className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm font-bold"
									>
										<option value="free">Free</option>
										<option value="paid">Paid</option>
										<option value="team">Team</option>
									</select>
								</div>
							)}

							{activeProvider === 'growthcircle' && (
								<div className="grid gap-2">
									<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
										Model ID
									</p>
									{(currentProviderConfig.models || []).length > 0 ? (
										<select
											value={currentProviderConfig.model_name || ''}
											onChange={(event) => {
												const nextModel = event.target.value
												updateCurrentProviderConfig((prev) => ({
													...prev,
													model_name: nextModel,
												}))
												setSettings((prev) =>
													prev ? { ...prev, model_name: nextModel } : prev,
												)
											}}
											className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm"
										>
											{(currentProviderConfig.models || []).map((model) => {
												const isGrowthcircle =
													currentProviderConfig.provider === 'growthcircle'
													const isFree =
														currentProviderConfig.plan_type === 'free'
												const baseId = model.id.replace(/-free$/, '')
												const id =
													isGrowthcircle && isFree ? `${baseId}-free` : baseId
												return (
													<option key={id} value={id}>
														{model.name} ({id})
													</option>
												)
											})}
										</select>
									) : (
										<Input
											value={currentProviderConfig.model_name || ''}
											onChange={(event) => {
												const nextModel = event.target.value
												updateCurrentProviderConfig((prev) => ({
													...prev,
													model_name: nextModel,
												}))
												setSettings((prev) =>
													prev ? { ...prev, model_name: nextModel } : prev,
												)
											}}
											placeholder="model-id"
											className="h-10 rounded-xl border-gray-200 text-sm"
										/>
									)}
								</div>
							)}

							{activeProvider === 'growthcircle' && (
								<div className="grid gap-2">
									<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
										Default Protocol
									</p>
									<select
										value={currentProviderConfig.default_protocol || 'openai'}
										onChange={(event) =>
											updateCurrentProviderConfig((prev) => ({
												...prev,
												default_protocol: event.target
													.value as ProviderProtocol,
											}))
										}
										className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm"
									>
										<option value="openai">OpenAI compatible</option>
										<option value="anthropic">Anthropic messages</option>
									</select>
								</div>
							)}
						</div>

						{activeProvider === 'growthcircle' ? (
							<div className="space-y-4 rounded-2xl border border-emerald-100 bg-emerald-50/30 p-4">
								<p className="text-xs font-semibold text-emerald-700">
									Growthcircle gateway channel mapping
								</p>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
											OpenAI Base URL
										</p>
										<Input
											value={
												currentProviderConfig.channels?.openai?.base_url || ''
											}
											onChange={(event) =>
												updateCurrentProviderConfig((prev) => ({
													...prev,
													base_url: event.target.value,
													channels: {
														...prev.channels,
														openai: {
															base_url: event.target.value,
															auth_header:
																prev.channels?.openai?.auth_header ||
																'authorization',
															auth_scheme:
																prev.channels?.openai?.auth_scheme || 'bearer',
														},
													},
												}))
											}
										/>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
											Anthropic Base URL
										</p>
										<Input
											value={
												currentProviderConfig.channels?.anthropic?.base_url ||
												''
											}
											onChange={(event) =>
												updateCurrentProviderConfig((prev) => ({
													...prev,
													channels: {
														...prev.channels,
														anthropic: {
															base_url: event.target.value,
															path:
																prev.channels?.anthropic?.path ||
																'/v1/messages',
															auth_header:
																prev.channels?.anthropic?.auth_header ||
																'x-api-key',
															auth_scheme:
																prev.channels?.anthropic?.auth_scheme || 'raw',
														},
													},
												}))
											}
										/>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-500">
											Anthropic Path
										</p>
										<Input
											value={
												currentProviderConfig.channels?.anthropic?.path ||
												'/v1/messages'
											}
											onChange={(event) =>
												updateCurrentProviderConfig((prev) => ({
													...prev,
													channels: {
														...prev.channels,
														anthropic: {
															base_url:
																prev.channels?.anthropic?.base_url ||
																'https://ai.growthcircle.id/anthropic',
															path: event.target.value,
															auth_header:
																prev.channels?.anthropic?.auth_header ||
																'x-api-key',
															auth_scheme:
																prev.channels?.anthropic?.auth_scheme || 'raw',
														},
													},
												}))
											}
										/>
									</div>

									<div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 text-[11px] font-medium text-amber-700">
										OpenAI header: <code>Authorization: Bearer gcl_xxx</code>
										<br />
										Anthropic header: <code>x-api-key: gcl_xxx</code> (Bearer
										juga didukung)
									</div>
								</div>
							</div>
						) : (
							<div className="space-y-4 rounded-2xl border border-gray-100 bg-gray-50/30 p-4">
								<div className="flex items-center gap-3">
									<Key size={20} className="text-emerald-500" />
									<h4 className="text-base font-bold text-gray-900">
										Custom credential
									</h4>
								</div>
								<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
											Base URL
										</p>
										<Input
											value={currentProviderConfig.base_url || ''}
											onChange={(event) =>
												updateCustomBaseUrl(event.target.value)
											}
											placeholder="https://api.example.com/v1"
											className="h-10 rounded-xl border-gray-200 font-mono text-sm"
										/>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
											API Key
										</p>
										<div className="relative">
											<Input
												type={showKey ? 'text' : 'password'}
												value={currentProviderConfig.api_key || ''}
												onChange={(event) =>
													updateCurrentProviderConfig((prev) => ({
														...prev,
														api_key: event.target.value,
													}))
												}
												placeholder="sk-..."
												className="h-10 rounded-xl border-gray-200 pr-10 font-mono text-sm"
											/>
											<button
												type="button"
												onClick={() => setShowKey((prev) => !prev)}
												className="absolute right-3 top-2.5 text-gray-400 hover:text-gray-600"
											>
												<Zap size={16} />
											</button>
										</div>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
											Model ID
										</p>
										<Input
											value={currentProviderConfig.model_name || ''}
											onChange={(event) => {
												const nextModel = event.target.value
												updateCustomModel({ id: nextModel, name: nextModel })
												setSettings((prev) =>
													prev ? { ...prev, model_name: nextModel } : prev,
												)
											}}
											placeholder="custom/provider"
											className="h-10 rounded-xl border-gray-200 font-mono text-sm"
										/>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
											Compatibility
										</p>
										<select
											value={currentProviderConfig.default_protocol || 'openai'}
											onChange={(event) =>
												updateCustomProtocol(
													event.target.value as ProviderProtocol,
												)
											}
											className="h-10 rounded-xl border border-gray-200 bg-white px-3 text-sm"
										>
											<option value="openai">OpenAI</option>
											<option value="anthropic">Anthropic</option>
										</select>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
											Max Context
										</p>
										<Input
											value={customModelConfig.context_window}
											onChange={(event) =>
												updateCustomModel({
													context_window: event.target.value,
												})
											}
											placeholder="200000"
											className="h-10 rounded-xl border-gray-200 font-mono text-sm"
										/>
									</div>

									<div className="grid gap-2">
										<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
											Max Tokens
										</p>
										<Input
											value={customModelConfig.max_output}
											onChange={(event) =>
												updateCustomModel({ max_output: event.target.value })
											}
											placeholder="8192"
											className="h-10 rounded-xl border-gray-200 font-mono text-sm"
										/>
									</div>
								</div>
							</div>
						)}

						<div className="space-y-4 rounded-xl border border-gray-100 bg-white p-4">
							<div className="flex flex-wrap items-center justify-between gap-2">
								<p className="text-[11px] font-black uppercase tracking-widest text-gray-500">
									Provider Test (Auto by Model Catalog)
								</p>
								<span className="rounded-full bg-emerald-50 px-2 py-1 text-[11px] font-black text-emerald-700">
									{inferredTestProtocol.toUpperCase()}
								</span>
							</div>

							<div className="grid grid-cols-1 gap-2 md:grid-cols-3">
								<div className="rounded-lg border border-gray-100 bg-gray-50/40 p-2.5">
									<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
										Model
									</p>
									<p className="mt-1 font-mono text-xs text-gray-700">
										{currentProviderConfig.model_name || '-'}
									</p>
								</div>
								<div className="rounded-lg border border-gray-100 bg-gray-50/40 p-2.5">
									<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
										Max Tokens (auto)
									</p>
									<p className="mt-1 text-xs font-semibold text-gray-700">
										{inferredTestMaxTokens
											? inferredTestMaxTokens.toLocaleString()
											: '-'}
									</p>
								</div>
								<div className="rounded-lg border border-gray-100 bg-gray-50/40 p-2.5">
									<p className="text-[10px] font-black uppercase tracking-wider text-gray-400">
										Protocol Route
									</p>
									<p className="mt-1 font-mono text-xs text-gray-700">
										{inferredTestProtocol === 'anthropic'
											? '/anthropic/v1/messages'
											: '/v1/chat/completions'}
									</p>
								</div>
							</div>

							<div className="grid gap-2">
								<p className="text-[10px] font-black uppercase tracking-widest text-gray-400">
									Test Input
								</p>
								<Textarea
									value={testPrompt}
									onChange={(event) => setTestPrompt(event.target.value)}
									rows={3}
									placeholder="Halo"
									className="resize-y rounded-xl border-gray-200"
								/>
							</div>

							<div className="flex flex-wrap items-center gap-3">
								<Button
									type="button"
									onClick={handleTestProvider}
									disabled={
										testingProvider ||
										!String(currentProviderConfig.model_name || '').trim() ||
										!String(currentProviderConfig.api_key || '').trim() ||
										!currentProviderBaseUrl
									}
									className="h-10 rounded-xl bg-gray-900 px-5 text-sm font-bold text-white hover:bg-black"
								>
									{testingProvider ? 'Testing...' : 'Test Provider'}
								</Button>
								<p className="text-xs text-gray-500">
									Model, protocol, dan payload akan auto sesuai model catalog
									terpilih.
								</p>
							</div>

							{!String(currentProviderConfig.api_key || '').trim() && (
								<div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-700">
									Isi API key dulu untuk menjalankan test provider.
								</div>
							)}
							{!currentProviderBaseUrl && (
								<div className="rounded-lg border border-amber-200 bg-amber-50/60 px-3 py-2 text-xs font-medium text-amber-700">
									Isi Base URL dulu untuk menjalankan test provider.
								</div>
							)}

							{testError && (
								<div className="rounded-lg border border-red-200 bg-red-50/70 px-3 py-2 text-xs font-semibold text-red-700">
									{testError}
								</div>
							)}

							{testResult && (
								<div className="space-y-2 rounded-lg border border-emerald-200 bg-emerald-50/40 p-3">
									<p className="text-[11px] font-black uppercase tracking-widest text-emerald-700">
										Test Result
									</p>
									<p className="text-xs text-gray-700">
										Endpoint: <code>{testResult.endpoint}</code>
									</p>
									<p className="text-xs text-gray-700">
										Status: <strong>{testResult.response.status}</strong> •
										Protocol: <strong>{testResult.protocol}</strong>
									</p>
									<div className="rounded border border-emerald-200 bg-white px-3 py-2 text-sm text-gray-800">
										{testResult.response.text || 'No text returned from model'}
									</div>
								</div>
							)}

							<details className="group mt-4 rounded-xl border border-gray-200 bg-gray-50/30">
								<summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-3 text-xs font-semibold text-gray-600 outline-none hover:text-gray-900">
									<Terminal
										size={14}
										className="text-gray-400 group-hover:text-gray-600"
									/>
									Show Generated cURL Command
								</summary>
								<div className="border-t border-gray-200 p-4">
									<div className="relative">
										<pre className="overflow-x-auto rounded-lg bg-gray-900 p-4 text-[11px] leading-relaxed text-gray-100 shadow-inner">
											<code>{generatedCurl}</code>
										</pre>
										<Button
											type="button"
											variant="secondary"
											size="icon"
											className="absolute right-2 top-2 h-7 w-7 bg-white/10 text-white hover:bg-white/20"
											onClick={() => {
												navigator.clipboard.writeText(generatedCurl)
												toast.success('cURL disalin ke clipboard')
											}}
										>
											<Copy size={12} />
										</Button>
									</div>
									<p className="mt-3 text-[11px] leading-relaxed text-gray-500">
										Gunakan perintah ini di terminal Anda untuk melihat persis
										seperti apa payload dan kredensial yang dikirim backend.
										Jika di terminal <b>gagal</b> dengan error yang sama,
										artinya API Key salah atau belum berbayar.
									</p>
								</div>
							</details>
						</div>

						{activeProvider === 'growthcircle' &&
							(currentProviderConfig.models || []).length > 0 && (
								<div className="space-y-2 rounded-xl border border-gray-100 bg-gray-50/40 p-4">
									<p className="text-[11px] font-black uppercase tracking-widest text-gray-500">
										Model Catalog ({currentProviderConfig.models?.length})
									</p>
									<div className="grid grid-cols-1 gap-2 md:grid-cols-2">
										{currentProviderConfig.models?.map((model) => (
											<div
												key={model.id}
												className="rounded-lg border border-gray-200 bg-white p-3"
											>
												<p className="text-sm font-bold text-gray-900">
													{model.name}
												</p>
												<p className="font-mono text-[11px] text-gray-500">
													{model.id}
												</p>
												<div className="mt-2 flex items-center gap-2 text-[11px] text-gray-600">
													<span className="rounded bg-blue-50 px-2 py-0.5 text-blue-700">
														Ctx {model.context_window}
													</span>
													<span className="rounded bg-purple-50 px-2 py-0.5 text-purple-700">
														Max Out {model.max_output}
													</span>
												</div>
											</div>
										))}
									</div>
								</div>
							)}
					</div>

					<div className="flex flex-col items-start justify-between gap-4 rounded-2xl border border-emerald-100 bg-emerald-50/50 p-4 sm:flex-row sm:items-center">
						<div className="flex items-center gap-3">
							<div className="flex h-10 w-10 items-center justify-center rounded-xl border border-emerald-100 bg-white">
								<Brain size={22} className="text-emerald-600" />
							</div>
							<p className="text-[11px] font-medium leading-relaxed text-gray-600">
								Provider aktif saat ini:{' '}
								<strong>{formatProviderLabel(activeProvider)}</strong>. Simpan
								untuk update endpoint provider completion + embedding.
							</p>
						</div>
						<Button
							onClick={handleSave}
							disabled={saving}
							className="h-11 w-full rounded-xl bg-gray-900 px-10 font-black text-white hover:bg-black sm:w-auto"
						>
							{saving ? (
								'Saving...'
							) : (
								<>
									<Save size={18} className="mr-2" />
									Save AI Models
								</>
							)}
						</Button>
					</div>
				</CardContent>
			</Card>

			<div className="flex items-center justify-center gap-2 pb-8 pt-2 text-gray-300">
				<Sparkles size={14} className="animate-spin-slow" />
				<p className="text-[10px] font-black uppercase tracking-[0.2em]">
					Dynamic Provider Routing • Active Model: {settings.model_name || '-'}
				</p>
			</div>
		</div>
	)
}
