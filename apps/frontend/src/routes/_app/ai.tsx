import { createFileRoute } from '@tanstack/react-router'
import {
	Bot,
	ChevronDown,
	ChevronUp,
	Circle,
	CircleDot,
	Loader2,
	Play,
	Plus,
	RefreshCw,
	Sparkles,
	Trash2,
	WandSparkles,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { CrmSectionHeader } from '@/components/crm/shared'
import { ai } from '@/lib/api'
import { randomId } from '@/lib/id'

export const Route = createFileRoute('/_app/ai')({
	component: AiPlaygroundPage,
})

type ModelSpeed = 'fastest' | 'fast' | 'medium'
type ModelTier = 'highend' | 'fast' | 'open'

type ModelOption = {
	id: string
	name: string
	vendor: string
	contextWindow: string
	priceIn: string
	priceOut: string
	speed: ModelSpeed
	tier: ModelTier
	connected: boolean
	latencyMs: number | null
	usage: number
}

type RoutingStrategy = {
	id: string
	label: string
	description: string
	rules: RoutingRule[]
}

type RoutingRule = {
	id: string
	name: string
	provider: string
	modelId?: string
	modelName?: string
	minConfidence?: number
	maxConfidence?: number
}

type PersonaPreset = {
	id: string
	label: string
	systemInstruction: string
}

type PlaygroundTurn = {
	id: string
	role: 'system' | 'user' | 'assistant'
	text: string
	model?: string
	tokensIn?: number
	tokensOut?: number
	latencyMs?: number
	cost?: string
}

type MetricTrend = 'up' | 'down' | 'neutral'

type MetricItem = {
	id: string
	label: string
	value: string
	delta: string
	trend: MetricTrend
	positiveWhen: Exclude<MetricTrend, 'neutral'> | 'neutral'
}

type GuardrailItem = {
	id: string
	label: string
	enabled: boolean
}

type PlaygroundState = {
	sessionId: string
	selectedModelId: string
	selectedStrategyId: string
	selectedPersonaId: string
	models: ModelOption[]
	routingStrategies: RoutingStrategy[]
	personas: PersonaPreset[]
	metrics: MetricItem[]
	guardrails: GuardrailItem[]
	transcript: PlaygroundTurn[]
}

type PlaygroundQueuedRunStatus = 'queued' | 'running' | 'completed' | 'failed'

type PlaygroundQueuedRunResult = {
	mode: 'queued'
	jobId: string
	status: PlaygroundQueuedRunStatus
	state?: unknown
	error?: string | null
	updatedAt?: string
}

type StrategyRuleDraft = {
	id: string
	name: string
	provider: string
	modelId: string
	minConfidence: string
	maxConfidence: string
}

function nextStrategyRuleDraftId(): string {
	return randomId()
}

function createBlankStrategyRuleDraft(): StrategyRuleDraft {
	return {
		id: nextStrategyRuleDraftId(),
		name: '',
		provider: '',
		modelId: '',
		minConfidence: '',
		maxConfidence: '',
	}
}

function extractPlaygroundState(response: unknown): PlaygroundState {
	const wrapped = response as { data?: PlaygroundState }
	if (wrapped?.data) return wrapped.data
	return response as PlaygroundState
}

function extractQueuedRunResult(
	response: unknown,
): PlaygroundQueuedRunResult | null {
	const wrapped = response as { data?: unknown }
	const payload = (wrapped?.data ?? response) as Record<string, unknown> | null
	if (!payload || typeof payload !== 'object') return null
	if (payload.mode !== 'queued') return null
	const jobId = typeof payload.jobId === 'string' ? payload.jobId.trim() : ''
	const status =
		typeof payload.status === 'string' ? payload.status.trim() : ''
	if (!jobId) return null
	if (!['queued', 'running', 'completed', 'failed'].includes(status)) {
		return null
	}
	return {
		mode: 'queued',
		jobId,
		status: status as PlaygroundQueuedRunStatus,
		state: payload.state,
		error: typeof payload.error === 'string' ? payload.error : null,
		updatedAt:
			typeof payload.updatedAt === 'string' ? payload.updatedAt : undefined,
	}
}

function wait(ms: number): Promise<void> {
	return new Promise((resolve) => {
		setTimeout(resolve, Math.max(1, ms))
	})
}

function getErrorMessage(error: unknown, fallback: string): string {
	if (error instanceof Error && error.message.trim().length > 0) {
		return error.message
	}
	return fallback
}

function metricDeltaClass(metric: MetricItem) {
	if (metric.positiveWhen === 'neutral' || metric.trend === 'neutral') {
		return 'text-muted-foreground'
	}
	const isPositive = metric.trend === metric.positiveWhen
	return isPositive ? 'text-emerald-500' : 'text-red-500'
}

function modelLatencyClass(latencyMs: number | null) {
	if (latencyMs === null) return 'text-muted-foreground'
	if (latencyMs < 500) return 'text-emerald-500'
	if (latencyMs < 1000) return 'text-primary'
	return 'text-muted-foreground'
}

function usageBarClass(usage: number) {
	if (usage > 70) return 'bg-amber-500'
	if (usage > 45) return 'bg-primary'
	return 'bg-emerald-500'
}

function tierTagClass(tier: ModelTier) {
	if (tier === 'highend') return 'ocm-tag-warning'
	if (tier === 'fast') return 'ocm-tag-success'
	return ''
}

function speedTagLabel(speed: ModelSpeed) {
	if (speed === 'fastest') return 'fastest'
	if (speed === 'fast') return 'fast'
	return 'medium'
}

function normalizeProviderKey(value: string): string {
	return value
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9]/g, '')
}

function AiPlaygroundPage() {
	const [loading, setLoading] = useState(true)
	const [syncingSelection, setSyncingSelection] = useState(false)
	const [running, setRunning] = useState(false)
	const [resetting, setResetting] = useState(false)
	const [savingStrategy, setSavingStrategy] = useState(false)
	const [creatingStrategy, setCreatingStrategy] = useState(false)
	const [routingExpanded, setRoutingExpanded] = useState(false)
	const [sessionId, setSessionId] = useState('')
	const [models, setModels] = useState<ModelOption[]>([])
	const [routingStrategies, setRoutingStrategies] = useState<RoutingStrategy[]>(
		[],
	)
	const [personas, setPersonas] = useState<PersonaPreset[]>([])
	const [metrics, setMetrics] = useState<MetricItem[]>([])
	const [guardrails, setGuardrails] = useState<GuardrailItem[]>([])
	const [transcript, setTranscript] = useState<PlaygroundTurn[]>([])
	const [selectedModel, setSelectedModel] = useState('')
	const [selectedProvider, setSelectedProvider] = useState('')
	const [selectedStrategy, setSelectedStrategy] = useState('')
	const [selectedPersona, setSelectedPersona] = useState('')
	const [prompt, setPrompt] = useState('')
	const [strategyName, setStrategyName] = useState('')
	const [strategyDescription, setStrategyDescription] = useState('')
	const [strategyRulesDraft, setStrategyRulesDraft] = useState<
		StrategyRuleDraft[]
	>([createBlankStrategyRuleDraft()])

	const applyPlaygroundState = useCallback((state: PlaygroundState) => {
		setSessionId(state.sessionId)
		const rawModels = Array.isArray(state.models) ? state.models : []
		setModels(rawModels)
		setRoutingStrategies(
			(state.routingStrategies || []).map((strategy) => ({
				...strategy,
				rules: Array.isArray(strategy.rules) ? strategy.rules : [],
			})),
		)
		const rawPersonas = Array.isArray(state.personas) ? state.personas : []
		setPersonas(rawPersonas)
		setMetrics(state.metrics || [])
		setGuardrails(state.guardrails || [])
		setTranscript(state.transcript || [])
		const selectedModelFromState =
			rawModels.find((model) => model.id === state.selectedModelId) || null
		const fallbackModel = selectedModelFromState || rawModels[0] || null
		setSelectedModel(fallbackModel?.id || '')
		setSelectedProvider(fallbackModel?.vendor || '')
		setSelectedStrategy(
			state.selectedStrategyId || state.routingStrategies?.[0]?.id || '',
		)
		const selectedPersonaFromState = rawPersonas.find(
			(persona) => persona.id === state.selectedPersonaId,
		)
		const fallbackPersona = selectedPersonaFromState || rawPersonas[0]
		setSelectedPersona(fallbackPersona?.id || '')
	}, [])

	const loadPlayground = useCallback(
		async (requestedSessionId?: string) => {
			setLoading(true)
			try {
				const response = await ai.getPlayground(requestedSessionId)
				const state = extractPlaygroundState(response)
				applyPlaygroundState(state)
			} catch (error) {
				toast.error(getErrorMessage(error, 'Failed to load AI Playground'))
			} finally {
				setLoading(false)
			}
		},
		[applyPlaygroundState],
	)

	useEffect(() => {
		void loadPlayground()
	}, [loadPlayground])

	const updateSelection = useCallback(
		async (changes: {
			modelId?: string
			strategyId?: string
			personaId?: string
		}) => {
			if (changes.modelId) {
				setSelectedModel(changes.modelId)
				const nextModel = models.find((model) => model.id === changes.modelId)
				if (nextModel?.vendor) {
					setSelectedProvider(nextModel.vendor)
				}
			}
			if (changes.strategyId) setSelectedStrategy(changes.strategyId)
			if (changes.personaId) {
				setSelectedPersona(changes.personaId)
			}

			if (!sessionId) return

			setSyncingSelection(true)
			try {
				const response = await ai.updatePlaygroundSession(sessionId, changes)
				const state = extractPlaygroundState(response)
				applyPlaygroundState(state)
			} catch (error) {
				toast.error(
					getErrorMessage(error, 'Failed to update playground selection'),
				)
				await loadPlayground(sessionId)
			} finally {
				setSyncingSelection(false)
			}
		},
		[applyPlaygroundState, loadPlayground, models, sessionId],
	)

	const resetSession = useCallback(async () => {
		setPrompt('')
		setResetting(true)
		try {
			const response = await ai.resetPlaygroundSession({
				sessionId: sessionId || undefined,
				modelId: selectedModel || undefined,
				strategyId: selectedStrategy || undefined,
				personaId: selectedPersona || undefined,
			})
			const state = extractPlaygroundState(response)
			applyPlaygroundState(state)
		} catch (error) {
			toast.error(getErrorMessage(error, 'Failed to reset playground session'))
		} finally {
			setResetting(false)
		}
	}, [
		applyPlaygroundState,
		selectedModel,
		selectedPersona,
		selectedStrategy,
		sessionId,
	])

	const resetStrategyComposer = useCallback(() => {
		setStrategyName('')
		setStrategyDescription('')
		setStrategyRulesDraft([createBlankStrategyRuleDraft()])
		setCreatingStrategy(false)
	}, [])

	const addStrategyRuleDraft = useCallback(() => {
		setStrategyRulesDraft((current) => [
			...current,
			createBlankStrategyRuleDraft(),
		])
	}, [])

	const removeStrategyRuleDraft = useCallback((index: number) => {
		setStrategyRulesDraft((current) => {
			if (current.length <= 1) return current
			return current.filter((_, currentIndex) => currentIndex !== index)
		})
	}, [])

	const updateStrategyRuleDraft = useCallback(
		(
			index: number,
			changes: Partial<{
				name: string
				provider: string
				modelId: string
				minConfidence: string
				maxConfidence: string
			}>,
		) => {
			setStrategyRulesDraft((current) =>
				current.map((item, currentIndex) =>
					currentIndex === index ? { ...item, ...changes } : item,
				),
			)
		},
		[],
	)

	const createStrategy = useCallback(async () => {
		const label = strategyName.trim()
		if (!label) {
			toast.error('Nama strategy wajib diisi')
			return
		}

		setSavingStrategy(true)
		try {
			const rules = strategyRulesDraft
				.map((rule, index) => {
					const ruleName = rule.name.trim()
					const provider = rule.provider.trim()
					const modelId = rule.modelId.trim()
					const minRaw = rule.minConfidence.trim()
					const maxRaw = rule.maxConfidence.trim()

					const minConfidence =
						minRaw.length > 0 ? Number.parseFloat(minRaw) : undefined
					const maxConfidence =
						maxRaw.length > 0 ? Number.parseFloat(maxRaw) : undefined

					if (
						minConfidence !== undefined &&
						(!Number.isFinite(minConfidence) ||
							minConfidence < 0 ||
							minConfidence > 1)
					) {
						throw new Error(
							`Rule ${index + 1}: min confidence harus antara 0 sampai 1`,
						)
					}
					if (
						maxConfidence !== undefined &&
						(!Number.isFinite(maxConfidence) ||
							maxConfidence < 0 ||
							maxConfidence > 1)
					) {
						throw new Error(
							`Rule ${index + 1}: max confidence harus antara 0 sampai 1`,
						)
					}
					if (
						minConfidence !== undefined &&
						maxConfidence !== undefined &&
						minConfidence > maxConfidence
					) {
						throw new Error(
							`Rule ${index + 1}: min confidence tidak boleh lebih besar dari max confidence`,
						)
					}

					const isRuleFilled =
						ruleName.length > 0 ||
						provider.length > 0 ||
						modelId.length > 0 ||
						minConfidence !== undefined ||
						maxConfidence !== undefined
					if (!isRuleFilled) return null

					return {
						name: ruleName || undefined,
						provider: provider || undefined,
						modelId: modelId || undefined,
						minConfidence,
						maxConfidence,
					}
				})
				.filter((rule): rule is NonNullable<typeof rule> => Boolean(rule))

			if (rules.length === 0) {
				toast.error('Tambahkan minimal 1 rule untuk strategy ini')
				return
			}

			const response = await ai.createPlaygroundStrategy({
				label,
				description: strategyDescription.trim() || undefined,
				activate: true,
				rules,
			})
			const state = extractPlaygroundState(response)
			applyPlaygroundState(state)
			resetStrategyComposer()
			toast.success('Routing strategy berhasil dibuat')
		} catch (error) {
			toast.error(getErrorMessage(error, 'Failed to create routing strategy'))
		} finally {
			setSavingStrategy(false)
		}
	}, [
		applyPlaygroundState,
		resetStrategyComposer,
		strategyDescription,
		strategyName,
		strategyRulesDraft,
	])

	const runSimulation = useCallback(async () => {
		const userPrompt = prompt.trim()
		if (!userPrompt) return
		if (!sessionId) {
			toast.error('Playground session belum siap, coba refresh halaman')
			return
		}

		setRunning(true)
		try {
			const response = await ai.runPlayground({
				sessionId,
				message: userPrompt,
				modelId: selectedModel || undefined,
				strategyId: selectedStrategy || undefined,
				personaId: selectedPersona || undefined,
				enqueue: true,
			})
			const queuedResult = extractQueuedRunResult(response)
			if (!queuedResult) {
				const state = extractPlaygroundState(response)
				applyPlaygroundState(state)
				setPrompt('')
				return
			}

			let currentResult = queuedResult
			const timeoutAt = Date.now() + 60_000
			let pollDelayMs = 900
			let lastStatus: PlaygroundQueuedRunStatus = currentResult.status
			let lastUpdatedAt = currentResult.updatedAt || ''
			while (Date.now() < timeoutAt) {
				if (currentResult.status === 'completed') {
					if (currentResult.state) {
						const state = extractPlaygroundState(currentResult.state)
						applyPlaygroundState(state)
					} else {
						const refreshed = await ai.getPlayground(sessionId)
						const state = extractPlaygroundState(refreshed)
						applyPlaygroundState(state)
					}
					setPrompt('')
					return
				}
				if (currentResult.status === 'failed') {
					throw new Error(
						currentResult.error ||
							'Background simulation failed. Please retry.',
					)
				}

				await wait(pollDelayMs)
				const statusResponse = await ai.getPlaygroundRunStatus(
					currentResult.jobId,
				)
				const statusResult = extractQueuedRunResult(statusResponse)
				if (!statusResult) {
					const state = extractPlaygroundState(statusResponse)
					applyPlaygroundState(state)
					setPrompt('')
					return
				}

				const nextUpdatedAt = statusResult.updatedAt || ''
				const hasProgress =
					statusResult.status !== lastStatus || nextUpdatedAt !== lastUpdatedAt
				pollDelayMs = hasProgress ? 900 : Math.min(3000, pollDelayMs + 300)
				lastStatus = statusResult.status
				lastUpdatedAt = nextUpdatedAt
				currentResult = statusResult
			}

			throw new Error(
				'Simulation masih diproses di background, coba ulang dalam beberapa detik.',
			)
		} catch (error) {
			toast.error(getErrorMessage(error, 'Failed to run simulation'))
		} finally {
			setRunning(false)
		}
	}, [
		applyPlaygroundState,
		prompt,
		sessionId,
		selectedModel,
		selectedPersona,
		selectedStrategy,
	])

	const currentModel = useMemo(
		() => models.find((item) => item.id === selectedModel) || models[0] || null,
		[models, selectedModel],
	)

	const selectedStrategyItem = useMemo(
		() =>
			routingStrategies.find((strategy) => strategy.id === selectedStrategy) ||
			routingStrategies[0] ||
			null,
		[routingStrategies, selectedStrategy],
	)

	const visibleStrategies = useMemo(
		() =>
			routingExpanded
				? routingStrategies
				: selectedStrategyItem
					? [selectedStrategyItem]
					: [],
		[routingExpanded, routingStrategies, selectedStrategyItem],
	)

	const activeModels = useMemo(
		() => models.filter((model) => model.connected),
		[models],
	)

	const providerOptions = useMemo(() => {
		const sourceModels = activeModels.length > 0 ? activeModels : models
		const vendors = sourceModels
			.map((model) => model.vendor.trim())
			.filter((vendor) => vendor.length > 0)
		return Array.from(new Set(vendors)).sort((a, b) => a.localeCompare(b))
	}, [activeModels, models])

	const filteredModels = useMemo(() => {
		const sourceModels = activeModels.length > 0 ? activeModels : models
		const normalizedSelectedProvider = normalizeProviderKey(selectedProvider)
		if (!normalizedSelectedProvider) return sourceModels
		return sourceModels.filter(
			(model) =>
				normalizeProviderKey(model.vendor) === normalizedSelectedProvider,
		)
	}, [activeModels, models, selectedProvider])

	const getRuleModelsForProvider = useCallback(
		(provider: string) => {
			const sourceModels = activeModels.length > 0 ? activeModels : models
			const normalizedProvider = normalizeProviderKey(provider)
			if (!normalizedProvider) return sourceModels
			return sourceModels.filter(
				(model) => normalizeProviderKey(model.vendor) === normalizedProvider,
			)
		},
		[activeModels, models],
	)

	useEffect(() => {
		if (providerOptions.length === 0) return
		const hasSelectedProvider = providerOptions.some(
			(provider) =>
				normalizeProviderKey(provider) ===
				normalizeProviderKey(selectedProvider),
		)
		if (!hasSelectedProvider) {
			setSelectedProvider(providerOptions[0] || '')
		}
	}, [providerOptions, selectedProvider])

	const handleProviderChange = useCallback(
		(provider: string) => {
			setSelectedProvider(provider)
			const sourceModels = activeModels.length > 0 ? activeModels : models
			const candidate = sourceModels.find(
				(model) =>
					normalizeProviderKey(model.vendor) === normalizeProviderKey(provider),
			)
			if (!candidate) {
				toast.error('Tidak ada model aktif untuk provider ini')
				return
			}
			if (candidate.id !== selectedModel) {
				void updateSelection({ modelId: candidate.id })
			}
		},
		[activeModels, models, selectedModel, updateSelection],
	)

	return (
		<main className="ocm-page">
			<CrmSectionHeader
				title="AI Playground"
				subtitle="Lab uji prompt, routing model, dan guardrails untuk workflow CRM"
				actions={
					<button
						type="button"
						className="ocm-btn"
						disabled={loading}
						onClick={() =>
							toast.info(
								'Preset management akan menyusul di iterasi berikutnya',
							)
						}
					>
						<WandSparkles size={14} />
						Load Preset
					</button>
				}
			/>

			<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[300px_minmax(0,1fr)] xl:grid-cols-[300px_minmax(0,1fr)_320px]">
				<section className="ocm-card flex min-h-0 flex-col">
					<div className="ocm-card-header flex-col items-start gap-2.5">
						<div className="min-w-0">
							<h2 className="ocm-card-title">Connected Models</h2>
							<p className="mt-1 text-xs text-muted-foreground">
								Model aktif dari provider yang dipilih
							</p>
						</div>
						<div className="flex w-full items-center gap-2">
							<div className="min-w-0 flex-1">
								<select
									className="ocm-select h-8 min-w-0"
									value={selectedProvider}
									onChange={(event) => handleProviderChange(event.target.value)}
									disabled={loading || providerOptions.length === 0}
								>
									{providerOptions.map((provider) => (
										<option key={provider} value={provider}>
											{provider}
										</option>
									))}
								</select>
							</div>
							<button
								type="button"
								className="ocm-btn h-8 shrink-0 px-2"
								onClick={() => toast.info('Manajemen model BYOK akan menyusul')}
							>
								<Plus size={12} />
								Add
							</button>
						</div>
					</div>

					<div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
						{loading && filteredModels.length === 0 ? (
							<div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Memuat model...
							</div>
						) : null}
						{!loading && filteredModels.length === 0 ? (
							<div className="flex h-24 items-center justify-center text-xs text-muted-foreground">
								Tidak ada model aktif untuk provider ini
							</div>
						) : null}
						{filteredModels.map((model) => {
							const isActive = selectedModel === model.id
							return (
								<button
									type="button"
									key={model.id}
									onClick={() => void updateSelection({ modelId: model.id })}
									disabled={syncingSelection || loading}
									className={`w-full rounded-lg border p-2 text-left transition ${
										isActive
											? 'border-primary/40 bg-primary/10'
											: 'border-border bg-card hover:bg-muted/70'
									}`}
								>
									<div className="mb-1.5 flex items-center gap-2">
										<div className="grid h-6 w-6 place-items-center rounded-md border border-border bg-muted text-[10px] font-bold text-primary">
											{model.vendor[0]}
										</div>
										<div className="min-w-0 flex-1">
											<p className="truncate text-xs font-semibold text-foreground">
												{model.name}
											</p>
											<p className="text-[11px] text-muted-foreground">
												{model.vendor}
											</p>
										</div>
										<span
											className={`h-2.5 w-2.5 rounded-full ${
												model.connected
													? 'bg-emerald-500'
													: 'bg-muted-foreground/40'
											}`}
										/>
									</div>

									<div className="flex flex-wrap gap-x-1.5 gap-y-0.5 text-[11px] text-muted-foreground">
										<span>ctx {model.contextWindow}</span>
										<span>·</span>
										<span>in {model.priceIn}</span>
										<span>·</span>
										<span>out {model.priceOut}</span>
										{model.latencyMs !== null ? (
											<>
												<span>·</span>
												<span className={modelLatencyClass(model.latencyMs)}>
													p50 {model.latencyMs}ms
												</span>
											</>
										) : null}
									</div>

									<div className="mt-1.5 flex flex-wrap gap-1">
										<span className={`ocm-tag ${tierTagClass(model.tier)}`}>
											{model.tier}
										</span>
										<span className="ocm-tag">
											{speedTagLabel(model.speed)}
										</span>
									</div>

									{model.connected ? (
										<div className="mt-2">
											<div className="ocm-progress-track">
												<div
													className={`ocm-progress-bar ${usageBarClass(model.usage)}`}
													style={{ width: `${model.usage}%` }}
												/>
											</div>
											<p className="mt-1 text-[10px] text-muted-foreground">
												Usage {model.usage}%
											</p>
										</div>
									) : (
										<p className="mt-2 text-[10px] text-muted-foreground">
											Belum terhubung
										</p>
									)}
								</button>
							)
						})}
						</div>

						<div className="border-t border-border p-3">
							<div className="mb-2 flex items-start justify-between gap-2">
								<div>
									<p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
										Routing Strategy
									</p>
									<p className="mt-1 text-[11px] text-muted-foreground">
										Strategi default untuk memilih model
									</p>
								</div>
								<button
									type="button"
									className="ocm-btn h-8 w-8 shrink-0 px-0"
									onClick={() => {
										if (routingExpanded && creatingStrategy) {
											resetStrategyComposer()
										}
										setRoutingExpanded((current) => !current)
									}}
									aria-expanded={routingExpanded}
									aria-label={
										routingExpanded
											? 'Collapse routing strategy section'
											: 'Expand routing strategy section'
									}
								>
									{routingExpanded ? (
										<ChevronUp size={14} />
									) : (
										<ChevronDown size={14} />
									)}
								</button>
							</div>
							{routingExpanded ? (
								<div className="mb-2">
									<div className="mb-2 flex justify-end">
										<button
											type="button"
											className="ocm-btn h-8 px-2 text-[11px]"
											onClick={() => {
												if (creatingStrategy) {
													resetStrategyComposer()
													return
												}
												setCreatingStrategy(true)
											}}
											disabled={loading || savingStrategy}
										>
											<Plus size={12} />
											{creatingStrategy ? 'Close' : 'Create'}
										</button>
									</div>
									{creatingStrategy ? (
										<div className="space-y-2 rounded-lg border border-border bg-card p-2.5">
											<input
												className="ocm-input h-9"
												placeholder="Strategy name"
												value={strategyName}
												onChange={(event) => setStrategyName(event.target.value)}
												disabled={savingStrategy}
											/>
											<textarea
												className="ocm-textarea min-h-[64px]"
												placeholder="Description (optional)"
												value={strategyDescription}
												onChange={(event) =>
													setStrategyDescription(event.target.value)
												}
												disabled={savingStrategy}
											/>
											<div className="space-y-2">
												{strategyRulesDraft.map((rule, index) => (
													<div
														key={rule.id}
														className="rounded-md border border-border/80 bg-muted/20 p-2"
													>
														<div className="mb-2 flex items-center justify-between">
															<p className="text-[11px] font-semibold text-foreground">
																Rule {index + 1}
															</p>
															<button
																type="button"
																className="ocm-btn h-7 px-2 text-[11px]"
																onClick={() => removeStrategyRuleDraft(index)}
																disabled={
																	savingStrategy ||
																	strategyRulesDraft.length <= 1
																}
															>
																<Trash2 size={12} />
																Remove
															</button>
														</div>
														<input
															className="ocm-input h-9"
															placeholder="Rule name (optional)"
															value={rule.name}
															onChange={(event) =>
																updateStrategyRuleDraft(index, {
																	name: event.target.value,
																})
															}
															disabled={savingStrategy}
														/>
														<div className="mt-2 grid grid-cols-2 gap-2">
															<select
																className="ocm-select h-9"
																value={rule.provider}
																onChange={(event) => {
																	const nextProvider = event.target.value
																	const nextRuleModels =
																		getRuleModelsForProvider(nextProvider)
																	const modelStillMatch = nextRuleModels.some(
																		(model) => model.id === rule.modelId,
																	)
																	updateStrategyRuleDraft(index, {
																		provider: nextProvider,
																		modelId: modelStillMatch ? rule.modelId : '',
																	})
																}}
																disabled={savingStrategy}
															>
																<option value="">Provider (optional)</option>
																{providerOptions.map((provider) => (
																	<option key={provider} value={provider}>
																		{provider}
																	</option>
																))}
															</select>
															<select
																className="ocm-select h-9"
																value={rule.modelId}
																onChange={(event) =>
																	updateStrategyRuleDraft(index, {
																		modelId: event.target.value,
																	})
																}
																disabled={
																	savingStrategy ||
																	(rule.provider.trim().length > 0 &&
																		getRuleModelsForProvider(rule.provider).length ===
																			0)
																}
															>
																<option value="">
																	{rule.provider.trim().length > 0 &&
																	getRuleModelsForProvider(rule.provider).length === 0
																		? 'No model for selected provider'
																		: 'Model (optional)'}
																</option>
																{getRuleModelsForProvider(rule.provider).map(
																	(model) => (
																		<option key={model.id} value={model.id}>
																			{model.name} · {model.vendor}
																		</option>
																	),
																)}
															</select>
														</div>
														<div className="mt-2 grid grid-cols-2 gap-2">
															<input
																type="number"
																min={0}
																max={1}
																step="0.01"
																className="ocm-input h-9"
																placeholder="Min conf (0-1)"
																value={rule.minConfidence}
																onChange={(event) =>
																	updateStrategyRuleDraft(index, {
																		minConfidence: event.target.value,
																	})
																}
																disabled={savingStrategy}
															/>
															<input
																type="number"
																min={0}
																max={1}
																step="0.01"
																className="ocm-input h-9"
																placeholder="Max conf (0-1)"
																value={rule.maxConfidence}
																onChange={(event) =>
																	updateStrategyRuleDraft(index, {
																		maxConfidence: event.target.value,
																	})
																}
																disabled={savingStrategy}
															/>
														</div>
													</div>
												))}
											</div>
											<div className="flex flex-wrap items-center justify-between gap-2">
												<button
													type="button"
													className="ocm-btn h-8 px-2 text-[11px]"
													onClick={addStrategyRuleDraft}
													disabled={savingStrategy}
												>
													<Plus size={12} />
													Add Rule
												</button>
												<div className="flex flex-wrap items-center gap-2">
													<button
														type="button"
														className="ocm-btn h-8 px-2 text-[11px]"
														onClick={resetStrategyComposer}
														disabled={savingStrategy}
													>
														Cancel
													</button>
													<button
														type="button"
														className="ocm-btn ocm-btn-primary h-8 px-2 text-[11px]"
														onClick={() => void createStrategy()}
														disabled={savingStrategy}
													>
														{savingStrategy ? (
															<Loader2 size={12} className="animate-spin" />
														) : (
															<Plus size={12} />
														)}
														Save Strategy
													</button>
												</div>
											</div>
										</div>
									) : null}
								</div>
							) : null}
							<div className="space-y-1.5">
								{visibleStrategies.length === 0 ? (
									<div className="rounded-md border border-dashed border-border px-2.5 py-3 text-[11px] text-muted-foreground">
										Belum ada routing strategy
									</div>
								) : (
									visibleStrategies.map((strategy) => {
										const active = selectedStrategy === strategy.id
										return (
											<button
												type="button"
												key={strategy.id}
												onClick={() =>
													void updateSelection({ strategyId: strategy.id })
												}
												disabled={syncingSelection || loading}
												className={`w-full rounded-md border px-2.5 py-2 text-left ${
													active
														? 'border-primary/40 bg-primary/10'
														: 'border-border bg-card hover:bg-muted/60'
												}`}
											>
												<div className="flex items-start gap-2">
													{active ? (
														<CircleDot size={14} className="mt-0.5 text-primary" />
													) : (
														<Circle
															size={14}
															className="mt-0.5 text-muted-foreground"
														/>
													)}
													<div className="min-w-0">
														<div className="flex flex-wrap items-center gap-1.5">
															<p className="text-xs font-semibold text-foreground">
																{strategy.label}
															</p>
															{active ? (
																<span className="inline-flex rounded-full border border-primary/30 bg-primary/10 px-1.5 py-0 text-[9px] font-semibold uppercase tracking-[0.08em] text-primary">
																	Selected
																</span>
															) : null}
														</div>
														<p className="text-[11px] text-muted-foreground">
															{strategy.description}
														</p>
														{strategy.rules.length > 0 ? (
															<p className="mt-0.5 text-[10px] text-muted-foreground">
																{strategy.rules.length} rules
															</p>
														) : null}
													</div>
												</div>
											</button>
										)
									})
								)}
							</div>
						</div>
					</section>

					<section className="ocm-card flex min-h-0 flex-col">
						<div className="ocm-card-header">
							<div className="grid w-full gap-3 md:grid-cols-[minmax(0,1fr)_minmax(280px,420px)] md:items-start">
								<div className="min-w-0">
									<h2 className="ocm-card-title">Playground Session</h2>
									<div className="mt-2 flex flex-wrap items-center gap-2">
										<div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
											<span>Model aktif:</span>
											<span className="ocm-tag font-semibold text-foreground">
												{currentModel?.name || '-'}
											</span>
										</div>
										<button
											type="button"
											className="ocm-btn h-8 rounded-full px-2.5 text-[11px]"
											onClick={() => void resetSession()}
											disabled={resetting || loading}
											aria-label="Reset playground session"
										>
											{resetting ? (
												<Loader2 size={12} className="animate-spin" />
											) : (
												<RefreshCw size={12} />
											)}
											Reset
										</button>
									</div>
								</div>
								<div className="min-w-0 md:justify-self-end">
									<label className="mb-1 block text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
										Persona
									</label>
									<select
										className="ocm-select h-10 w-full"
										value={selectedPersona}
										onChange={(event) =>
											void updateSelection({
												personaId: event.target.value || undefined,
											})
										}
										disabled={
											syncingSelection || loading || personas.length === 0
										}
									>
										{personas.length === 0 ? (
											<option value="">No persona available</option>
										) : (
											personas.map((persona) => (
												<option key={persona.id} value={persona.id}>
													{persona.label}
												</option>
											))
										)}
									</select>
								</div>
							</div>
						</div>

					<div className="min-h-0 flex-1 space-y-2 overflow-y-auto bg-muted/20 p-4">
						{loading && transcript.length === 0 ? (
							<div className="flex h-28 items-center justify-center text-sm text-muted-foreground">
								<Loader2 className="mr-2 h-4 w-4 animate-spin" />
								Memuat transcript...
							</div>
						) : null}
						{transcript.map((turn) => {
							if (turn.role === 'system') {
								return (
									<div
										key={turn.id}
										className="rounded-lg border border-dashed border-border bg-card px-3 py-2 text-xs text-muted-foreground"
									>
										<span className="font-semibold text-primary">
											SYSTEM ·{' '}
										</span>
										{turn.text}
									</div>
								)
							}

							if (turn.role === 'user') {
								return (
									<div
										key={turn.id}
										className="max-w-[78%] rounded-xl rounded-tl-sm border border-border bg-card px-3 py-2 text-sm"
									>
										{turn.text}
									</div>
								)
							}

							return (
								<div key={turn.id} className="ml-auto max-w-[80%]">
									<div className="rounded-xl rounded-tr-sm border border-primary/30 bg-primary/10 px-3 py-2 text-sm">
										{turn.text}
									</div>
									<div className="mt-1 flex flex-wrap items-center justify-end gap-1 text-[11px] text-muted-foreground">
										<Sparkles size={11} className="text-primary" />
										<span>{turn.model || currentModel?.name || '-'}</span>
										{turn.tokensIn ? <span>· in {turn.tokensIn}</span> : null}
										{turn.tokensOut ? (
											<span>· out {turn.tokensOut}</span>
										) : null}
										{turn.latencyMs ? <span>· {turn.latencyMs}ms</span> : null}
										{turn.cost ? (
											<span className="text-emerald-500">· {turn.cost}</span>
										) : null}
									</div>
								</div>
							)
						})}
					</div>

					<div className="border-t border-border p-3">
						<div className="rounded-xl border border-border bg-card p-3">
							<label
								htmlFor="ai-playground-prompt"
								className="mb-1 block text-xs font-semibold uppercase tracking-[0.1em] text-muted-foreground"
							>
								Prompt
							</label>
							<textarea
								id="ai-playground-prompt"
								className="ocm-textarea min-h-[72px]"
								placeholder="Test a customer message..."
								value={prompt}
								onChange={(event) => setPrompt(event.target.value)}
							/>
							<div className="mt-2 flex flex-wrap items-center justify-between gap-2">
								<div className="flex items-center gap-1.5 text-xs text-muted-foreground">
									<span className="ocm-tag">RAG: retrieve all sources</span>
									<span className="ocm-tag">tools: 4</span>
									<span className="ocm-tag">
										strategy: {selectedStrategyItem?.label || selectedStrategy}
									</span>
								</div>
								<div className="flex flex-wrap items-center gap-2">
									<button
										type="button"
										className="ocm-btn"
										onClick={() =>
											toast.info(
												'A/B testing akan tersedia pada iterasi berikutnya',
											)
										}
									>
										<Bot size={13} />
										A/B vs GPT-5.4
									</button>
									<button
										type="button"
										className="ocm-btn ocm-btn-primary"
										onClick={() => void runSimulation()}
										disabled={running || loading || prompt.trim().length === 0}
									>
										{running ? (
											<Loader2 size={13} className="animate-spin" />
										) : (
											<Play size={13} />
										)}
										Run
									</button>
								</div>
							</div>
						</div>
					</div>
				</section>

				<section className="ocm-card flex min-h-0 flex-col lg:col-span-2 xl:col-span-1">
					<div className="ocm-card-header">
						<h2 className="ocm-card-title">Metrics (24h)</h2>
					</div>

					<div className="min-h-0 flex-1 overflow-y-auto p-3">
						<div className="space-y-2">
							{metrics.map((metric) => (
								<div
									key={metric.id}
									className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2"
								>
									<div>
										<p className="text-[11px] text-muted-foreground">
											{metric.label}
										</p>
										<p className="text-sm font-semibold text-foreground">
											{metric.value}
										</p>
									</div>
									<p
										className={`text-xs font-semibold ${metricDeltaClass(metric)}`}
									>
										{metric.delta}
									</p>
								</div>
							))}
						</div>

						<div className="mt-4">
							<p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
								Guardrails
							</p>
							<div className="space-y-1">
								{guardrails.map((guardrail) => (
									<div
										key={guardrail.id}
										className="flex items-center gap-2 border-b border-dashed border-border/80 py-2 text-sm"
									>
										<span
											className={`inline-flex h-5 w-9 items-center rounded-full border px-0.5 ${
												guardrail.enabled
													? 'border-emerald-400/40 bg-emerald-500/70 justify-end'
													: 'border-border bg-muted justify-start'
											}`}
										>
											<span className="h-4 w-4 rounded-full bg-white" />
										</span>
										<span className="text-xs text-foreground">
											{guardrail.label}
										</span>
									</div>
								))}
							</div>
						</div>
					</div>
				</section>
			</div>
		</main>
	)
}
