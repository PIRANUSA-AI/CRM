import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { metrics } from '@/lib/api'
import PageHeader from '@/components/PageHeader'
import {
	Activity,
	Brain,
	Route as RouteIcon,
	Clock,
	RefreshCw,
} from 'lucide-react'

export const Route = createFileRoute('/_app/metrics')({
	component: MetricsPage,
})

interface MetricsSummary {
	ai: {
		totalAnalyses: number
		averageConfidence: number
		sentimentDistribution: {
			positive: number
			neutral: number
			negative: number
		}
		intentDistribution: Record<string, number>
		escalationRate: number
		averageResponseTime: number
	}
	routing: {
		totalRouted: number
		successRate: number
		ruleDistribution: Record<string, number>
		averageRoutingTime: number
	}
	conversations: {
		totalMessages: number
		totalResolved: number
		averageMessagesPerConversation: number
	}
	period: string
}

const EMPTY_SUMMARY: MetricsSummary = {
	ai: {
		totalAnalyses: 0,
		averageConfidence: 0,
		sentimentDistribution: { positive: 0, neutral: 0, negative: 0 },
		intentDistribution: {},
		escalationRate: 0,
		averageResponseTime: 0,
	},
	routing: {
		totalRouted: 0,
		successRate: 0,
		ruleDistribution: {},
		averageRoutingTime: 0,
	},
	conversations: {
		totalMessages: 0,
		totalResolved: 0,
		averageMessagesPerConversation: 0,
	},
	period: '24h',
}

function finiteNumber(value: unknown): number {
	const number = Number(value)
	return Number.isFinite(number) ? number : 0
}

function normalizeMetricsSummary(input: unknown): MetricsSummary {
	const envelope = input && typeof input === 'object' ? (input as Record<string, any>) : {}
	const raw = envelope.data && typeof envelope.data === 'object' ? envelope.data : envelope
	const ai = raw.ai && typeof raw.ai === 'object' ? raw.ai : {}
	const routing = raw.routing && typeof raw.routing === 'object' ? raw.routing : {}
	const conversations = raw.conversations && typeof raw.conversations === 'object' ? raw.conversations : {}

	return {
		ai: {
			totalAnalyses: finiteNumber(ai.totalAnalyses),
			averageConfidence: finiteNumber(ai.averageConfidence),
			sentimentDistribution: {
				positive: finiteNumber(ai.sentimentDistribution?.positive),
				neutral: finiteNumber(ai.sentimentDistribution?.neutral),
				negative: finiteNumber(ai.sentimentDistribution?.negative),
			},
			intentDistribution:
				ai.intentDistribution && typeof ai.intentDistribution === 'object'
					? ai.intentDistribution
					: {},
			escalationRate: finiteNumber(ai.escalationRate),
			averageResponseTime: finiteNumber(ai.averageResponseTime),
		},
		routing: {
			totalRouted: finiteNumber(routing.totalRouted),
			successRate: finiteNumber(routing.successRate),
			ruleDistribution:
				routing.ruleDistribution && typeof routing.ruleDistribution === 'object'
					? routing.ruleDistribution
					: {},
			averageRoutingTime: finiteNumber(routing.averageRoutingTime),
		},
		conversations: {
			totalMessages: finiteNumber(conversations.totalMessages),
			totalResolved: finiteNumber(conversations.totalResolved),
			averageMessagesPerConversation: finiteNumber(
				conversations.averageMessagesPerConversation,
			),
		},
		period: typeof raw.period === 'string' ? raw.period : EMPTY_SUMMARY.period,
	}
}

function MetricsPage() {
	const [summary, setSummary] = useState<MetricsSummary | null>(null)
	const [period, setPeriod] = useState('24h')
	const [loading, setLoading] = useState(true)
	const [error, setError] = useState('')

	useEffect(() => {
		loadMetrics()
	}, [period])

	const loadMetrics = async () => {
		setLoading(true)
		setError('')
		try {
			const data: any = await metrics.getSummary(period)
			setSummary(normalizeMetricsSummary(data))
		} catch (error) {
			console.error('Failed to load metrics:', error)
			setError('Metrik belum dapat dimuat. Silakan coba lagi.')
		} finally {
			setLoading(false)
		}
	}

	const actions = (
		<div className="flex items-center gap-2 lg:gap-3 w-full lg:w-auto">
			<div className="flex bg-gray-100 p-1 rounded-lg">
				{[
					{ id: '24h', label: '24h' },
					{ id: '7d', label: '7 Hari' },
					{ id: '30d', label: '30 Hari' },
				].map((range) => (
					<button
						key={range.id}
						onClick={() => setPeriod(range.id)}
						className={`px-3 py-1.5 text-xs font-bold rounded-md transition-all ${
							period === range.id
								? 'bg-white text-gray-950 shadow-sm'
								: 'text-gray-500 hover:text-gray-700'
						}`}
					>
						{range.label}
					</button>
				))}
			</div>
			<button
				onClick={loadMetrics}
				className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors border border-gray-200 bg-white shadow-sm"
				title="Muat ulang metrik"
				aria-label="Muat ulang metrik"
			>
				<RefreshCw size={18} className={loading ? 'animate-spin' : ''} />
			</button>
		</div>
	)

	return (
		<div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
			<PageHeader
				title="Metrik Sistem"
				description="Pantau keyakinan respons AI, efisiensi perutean, dan performa sistem"
				icon={<Activity size={24} />}
				actions={actions}
			/>

			<div className="flex-1 overflow-y-auto px-4 lg:px-8 pb-8">
				{loading && !summary ? (
					<div className="h-full flex items-center justify-center">
						<div className="flex flex-col items-center gap-4">
							<RefreshCw className="animate-spin text-emerald-500" size={32} />
							<p className="text-gray-500 font-bold tracking-tight">
								Sedang menghitung metrik…
							</p>
						</div>
					</div>
				) : error && !summary ? (
					<div className="flex h-full flex-col items-center justify-center gap-4 px-6 text-center">
						<Activity size={40} className="text-muted-foreground" />
						<p className="font-semibold text-foreground">{error}</p>
						<button type="button" onClick={loadMetrics} className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Coba lagi</button>
					</div>
				) : summary ? (
					<div className="space-y-8 max-w-7xl">
						{/* Overview Stats */}
						<div className="grid grid-cols-1 md:grid-cols-3 gap-6">
							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<div className="flex items-center gap-4 mb-4">
									<div className="p-3 bg-blue-50 text-blue-600 rounded-xl">
										<Brain size={24} />
									</div>
									<div>
										<h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
											Analisis AI
										</h4>
										<p className="text-2xl font-black text-gray-900">
											{summary.ai.totalAnalyses.toLocaleString()}
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<div className="flex-1 bg-gray-100 h-2 rounded-full overflow-hidden">
										<div
											className='bg-blue-500 h-full'
											style={{ width: `${summary.ai.averageConfidence}%` }}
										/>
									</div>
									<span className="text-xs font-bold text-blue-600">
										{summary.ai.averageConfidence}% keyakinan
									</span>
								</div>
							</div>

							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<div className="flex items-center gap-4 mb-4">
									<div className="p-3 bg-emerald-50 text-emerald-600 rounded-xl">
										<RouteIcon size={24} />
									</div>
									<div>
										<h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
											Perutean Berhasil
										</h4>
										<p className="text-2xl font-black text-gray-900">
											{summary.routing.successRate}%
										</p>
									</div>
								</div>
								<div className="flex items-center gap-2">
									<div className="flex-1 bg-gray-100 h-2 rounded-full overflow-hidden">
										<div
											className='bg-emerald-500 h-full'
											style={{ width: `${summary.routing.successRate}%` }}
										/>
									</div>
									<span className="text-xs font-bold text-emerald-600">
										{summary.routing.totalRouted.toLocaleString('id-ID')} kejadian
									</span>
								</div>
							</div>

							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<div className="flex items-center gap-4 mb-4">
									<div className="p-3 bg-amber-50 text-amber-600 rounded-xl">
										<Clock size={24} />
									</div>
									<div>
										<h4 className="text-xs font-black text-gray-400 uppercase tracking-widest">
											Rata-rata Respons
										</h4>
										<p className="text-2xl font-black text-gray-900">
											{summary.ai.averageResponseTime}ms
										</p>
									</div>
								</div>
								<div className="text-xs font-bold text-gray-400">
									Rata-rata latensi sistem
								</div>
							</div>
						</div>

						<div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<h3 className="text-lg font-bold text-gray-900 mb-6">
									Distribusi Sentimen AI
								</h3>
								<div className="space-y-4">
									{Object.entries(summary.ai.sentimentDistribution).map(
										([key, value]) => (
											<div key={key} className="space-y-1">
												<div className="flex justify-between text-xs font-bold uppercase tracking-wider">
													<span className="text-gray-500">{key}</span>
													<span className="text-gray-900">{value}%</span>
												</div>
												<div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
													<div
														className={`h-full rounded-full ${
															key === 'positive'
																? 'bg-emerald-500'
																: key === 'negative'
																	? 'bg-red-500'
																	: 'bg-gray-400'
														}`}
												style={{ width: `${Math.max(0, Math.min(100, value))}%` }}
													/>
												</div>
											</div>
										),
									)}
								</div>
							</div>

							<div className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm">
								<h3 className="text-lg font-bold text-gray-900 mb-6">
									Distribusi Intent Perutean
								</h3>
								<div className="space-y-4">
									{Object.entries(summary.ai.intentDistribution).map(
										([key, value]) => (
											<div key={key} className="space-y-1">
												<div className="flex justify-between text-xs font-bold uppercase tracking-wider">
													<span className="text-gray-500">{key}</span>
													<span className="text-gray-900">{value}</span>
												</div>
												<div className="w-full bg-gray-100 h-2 rounded-full overflow-hidden">
													<div
														className="bg-blue-600 h-full rounded-full"
														style={{
													width: `${summary.ai.totalAnalyses > 0 ? Math.min(100, (value / summary.ai.totalAnalyses) * 100) : 0}%`,
														}}
													/>
												</div>
											</div>
										),
									)}
								</div>
							</div>
						</div>
					</div>
				) : (
					<div className="flex-1 flex flex-col items-center justify-center py-20 opacity-50 space-y-4">
						<Activity size={48} className="text-gray-300" />
						<p className="text-gray-500 font-bold text-lg">
							Belum ada metrik untuk periode ini
						</p>
					</div>
				)}
			</div>
		</div>
	)
}
