// Analytics, Settings, and Modal components
// Append this to pipeline.tsx after line 610
import {
	Target,
	DollarSign,
	TrendingUp,
	Award,
	PieChart,
	Plus,
	Edit,
	Trash2,
} from 'lucide-react'

// Type definitions (imported from main file)
interface Stage {
	id: string
	name: string
	color: string
	order: number
	pipelineId: string
	createdAt: string
	updatedAt: string
}

interface Pipeline {
	id: string
	name: string
	description: string | null
	isDefault: boolean
	userId: string
	createdAt: string
	updatedAt: string
	stages: Stage[]
}

interface Deal {
	id: string
	title: string
	value: number
	stageId: string
	pipelineId: string
	contactId: string
	contactName: string
	contactEmail?: string
	contactPhone?: string
	expectedCloseDate?: string
	customFields?: Record<string, any>
	createdAt: string
	updatedAt: string
}

interface CustomField {
	id: string
	name: string
	fieldType: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox'
	options?: string[]
	required: boolean
	order: number
}

type SettingsTab = 'pipelines' | 'customFields'

// Pipeline Analytics Component
export function PipelineAnalytics({
	pipelines,
	deals,
}: {
	pipelines: Pipeline[]
	deals: Deal[]
}) {
	if (pipelines.length === 0) {
		return (
			<div className="flex items-center justify-center h-full">
				<div className="text-center">
					<PieChart size={64} className="mx-auto text-gray-300 mb-4" />
					<h3 className="text-xl font-semibold text-gray-900 mb-2">
						No Data Yet
					</h3>
					<p className="text-gray-500">Create a pipeline to see analytics</p>
				</div>
			</div>
		)
	}

	const totalDeals = deals.length
	const totalValue = deals.reduce((sum, deal) => sum + deal.value, 0)
	const avgDealValue = totalDeals > 0 ? totalValue / totalDeals : 0

	const stageMetrics =
		(pipelines[0]?.stages || []).map((stage) => {
			const stageDeals = deals.filter(
				(d) => d.stageId === stage.id || (!d.stageId && stage.order === 0),
			)
			return {
				stage,
				count: stageDeals.length,
				value: stageDeals.reduce((sum, deal) => sum + deal.value, 0),
			}
		}) || []

	return (
		<div className="p-8">
			<div className="max-w-6xl mx-auto space-y-8">
				<h2 className="text-2xl font-bold text-gray-900">Pipeline Analytics</h2>

				{/* KPI Cards */}
				<div className="grid grid-cols-1 md:grid-cols-4 gap-6">
					<div className="bg-white rounded-xl border border-gray-200 p-6">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-blue-100 rounded-lg">
								<Target size={24} className="text-blue-600" />
							</div>
							<div>
								<p className="text-sm text-gray-500">Total Deals</p>
								<p className="text-2xl font-bold text-gray-900">{totalDeals}</p>
							</div>
						</div>
					</div>

					<div className="bg-white rounded-xl border border-gray-200 p-6">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-emerald-100 rounded-lg">
								<DollarSign size={24} className="text-emerald-600" />
							</div>
							<div>
								<p className="text-sm text-gray-500">Total Value</p>
								<p className="text-2xl font-bold text-gray-900">
									${totalValue.toLocaleString()}
								</p>
							</div>
						</div>
					</div>

					<div className="bg-white rounded-xl border border-gray-200 p-6">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-purple-100 rounded-lg">
								<TrendingUp size={24} className="text-purple-600" />
							</div>
							<div>
								<p className="text-sm text-gray-500">Avg Deal Value</p>
								<p className="text-2xl font-bold text-gray-900">
									${avgDealValue.toFixed(0)}
								</p>
							</div>
						</div>
					</div>

					<div className="bg-white rounded-xl border border-gray-200 p-6">
						<div className="flex items-center gap-3">
							<div className="p-2 bg-orange-100 rounded-lg">
								<Award size={24} className="text-orange-600" />
							</div>
							<div>
								<p className="text-sm text-gray-500">Win Rate</p>
								<p className="text-2xl font-bold text-gray-900">65%</p>
							</div>
						</div>
					</div>
				</div>

				{/* Stage Distribution */}
				<div className="bg-white rounded-xl border border-gray-200 p-6">
					<h3 className="text-lg font-bold text-gray-900 mb-6">
						Stage Distribution
					</h3>
					<div className="grid grid-cols-2 md:grid-cols-4 gap-4">
						{stageMetrics.map((metric) => (
							<div
								key={metric.stage.id}
								className="p-4 border border-gray-200 rounded-lg text-center hover:shadow-md transition"
							>
								<div
									className="w-16 h-16 rounded-full mx-auto mb-3 flex items-center justify-center text-white font-bold text-2xl"
									style={{ backgroundColor: metric.stage.color }}
								>
									{metric.count}
								</div>
								<p className="text-sm font-semibold text-gray-900">
									{metric.stage.name}
								</p>
								<p className="text-xs text-emerald-600 font-bold mt-1">
									${metric.value.toLocaleString()}
								</p>
							</div>
						))}
					</div>
				</div>
			</div>
		</div>
	)
}

// Pipeline Settings Component
export function PipelineSettings({
	activeTab,
	setActiveTab,
	pipelines,
	customFields,
	onRefreshPipelines,
	onRefreshCustomFields,
	onCreatePipeline,
	onEditPipeline,
	onDeletePipeline,
	onCreateCustomField,
}: {
	activeTab: SettingsTab
	setActiveTab: (tab: SettingsTab) => void
	pipelines: Pipeline[]
	customFields: CustomField[]
	onRefreshPipelines: () => void
	onRefreshCustomFields: () => void
	onCreatePipeline: () => void
	onEditPipeline: (pipeline: Pipeline) => void
	onDeletePipeline: (id: string) => void
	onCreateCustomField: () => void
}) {
	return (
		<div className="p-8">
			<div className="max-w-5xl mx-auto">
				{/* Settings Tabs */}
				<div className="mb-8">
					<div
						role="tablist"
						aria-orientation="horizontal"
						className="bg-gray-100 text-gray-500 inline-flex h-10 items-center justify-center rounded-lg p-1"
						style={{ outline: 'none' }}
					>
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === 'pipelines'}
							onClick={() => setActiveTab('pipelines')}
							className={`ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
								activeTab === 'pipelines'
									? 'bg-white text-gray-950 shadow-sm'
									: 'hover:text-gray-900'
							}`}
						>
							<Target size={18} />
							Pipelines
						</button>
						<button
							type="button"
							role="tab"
							aria-selected={activeTab === 'customFields'}
							onClick={() => setActiveTab('customFields')}
							className={`ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
								activeTab === 'customFields'
									? 'bg-white text-gray-950 shadow-sm'
									: 'hover:text-gray-900'
							}`}
						>
							<DollarSign size={18} />
							Custom Fields
						</button>
					</div>
				</div>

				{activeTab === 'pipelines' ? (
					<div>
						<div className="flex items-center justify-between mb-6">
							<h2 className="text-xl font-bold text-gray-900">
								Sales Pipelines
							</h2>
							<button
								onClick={onCreatePipeline}
								className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium"
							>
								<Plus size={18} />
								New Pipeline
							</button>
						</div>

						<div className="space-y-4">
							{pipelines.map((pipeline) => (
								<div
									key={pipeline.id}
									className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition"
								>
									<div className="flex items-start justify-between mb-4">
										<div className="flex-1">
											<div className="flex items-center gap-3 mb-2">
												<h3 className="text-lg font-bold text-gray-900">
													{pipeline.name}
												</h3>
												{pipeline.isDefault && (
													<span className="px-2 py-1 bg-blue-100 text-blue-700 text-xs font-semibold rounded">
														Default
													</span>
												)}
											</div>
											{pipeline.description && (
												<p className="text-gray-500 text-sm">
													{pipeline.description}
												</p>
											)}
										</div>
										<div className="flex items-center gap-2">
											<button
												onClick={() => onEditPipeline(pipeline)}
												className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition"
											>
												<Edit size={18} />
											</button>
											{!pipeline.isDefault && (
												<button
													onClick={() => onDeletePipeline(pipeline.id)}
													className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
												>
													<Trash2 size={18} />
												</button>
											)}
										</div>
									</div>

									<div className="flex items-center gap-2 mt-4">
										<span className="text-sm text-gray-500">
											{(pipeline.stages || []).length} stages:
										</span>
										{(pipeline.stages || [])
											.sort((a, b) => a.order - b.order)
											.map((stage) => (
												<span
													key={stage.id}
													className="px-3 py-1 rounded-full text-xs font-medium text-white"
													style={{ backgroundColor: stage.color }}
												>
													{stage.name}
												</span>
											))}
									</div>
								</div>
							))}

							{pipelines.length === 0 && (
								<div className="text-center py-12 bg-white rounded-xl border border-gray-200">
									<div className="text-6xl mb-4">📋</div>
									<h3 className="text-lg font-semibold text-gray-900 mb-2">
										No Pipelines Yet
									</h3>
									<p className="text-gray-500 mb-6">
										Create your first sales pipeline to get started
									</p>
									<button
										onClick={onCreatePipeline}
										className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium"
									>
										<Plus size={18} />
										Create Pipeline
									</button>
								</div>
							)}
						</div>
					</div>
				) : (
					<CustomFieldsTab
						customFields={customFields}
						onCreateCustomField={onCreateCustomField}
						onRefresh={onRefreshCustomFields}
					/>
				)}
			</div>
		</div>
	)
}

// Custom Fields Tab
export function CustomFieldsTab({
	customFields,
	onCreateCustomField,
	onRefresh,
}: {
	customFields: CustomField[]
	onCreateCustomField: () => void
	onRefresh: () => void
}) {
	return (
		<div>
			<div className="flex items-center justify-between mb-6">
				<h2 className="text-xl font-bold text-gray-900">Custom Fields</h2>
				<button
					onClick={onCreateCustomField}
					className="flex items-center gap-2 px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium"
				>
					<Plus size={18} />
					New Field
				</button>
			</div>

			{customFields.length === 0 ? (
				<div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
					<div className="text-6xl mb-4">🏷️</div>
					<h3 className="text-xl font-semibold text-gray-900 mb-2">
						No Custom Fields
					</h3>
					<p className="text-gray-500 mb-6">
						Add custom fields to your contacts and deals
					</p>
					<button
						onClick={onCreateCustomField}
						className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium"
					>
						<Plus size={18} />
						Create Custom Field
					</button>
				</div>
			) : (
				<div className="bg-white rounded-xl border border-gray-200">
					<div className="divide-y divide-gray-200">
						{customFields.map((field) => (
							<div
								key={field.id}
								className="p-4 flex items-center justify-between hover:bg-gray-50"
							>
								<div>
									<p className="font-semibold text-gray-900">{field.name}</p>
									<p className="text-sm text-gray-500">
										Type: {field.fieldType} {field.required && '• Required'}
									</p>
								</div>
								<button className="p-2 text-gray-400 hover:text-gray-600">
									<Edit size={18} />
								</button>
							</div>
						))}
					</div>
				</div>
			)}
		</div>
	)
}

// The modals will continue in the next message due to length...
