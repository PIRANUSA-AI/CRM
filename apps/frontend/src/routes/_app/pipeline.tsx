import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import {
	Plus,
	Settings,
	GripVertical,
	Trash2,
	Edit,
	X,
	DollarSign,
	Calendar,
	User,
	Phone,
	Mail,
	TrendingUp,
	Target,
	Clock,
	Award,
	BarChart2,
	PieChart,
	KanbanSquare,
} from 'lucide-react'
import {
	DndContext,
	DragOverlay,
	closestCorners,
	KeyboardSensor,
	PointerSensor,
	useSensor,
	useSensors,
	type DragStartEvent,
	type DragEndEvent,
} from '@dnd-kit/core'
import {
	arrayMove,
	SortableContext,
	sortableKeyboardCoordinates,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import PageHeader from '@/components/PageHeader'

export const Route = createFileRoute('/_app/pipeline')({
	component: PipelinePage,
})

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
	// Added for card display if available, but optional
	contact?: {
		name: string
		phone: string
		email: string
	}
	currency?: string
	status?: 'open' | 'won' | 'lost'
	priority?: 'low' | 'medium' | 'high'
}

interface CustomField {
	id: string
	name: string
	fieldType: 'text' | 'number' | 'date' | 'dropdown' | 'checkbox'
	options?: string[]
	required: boolean
	order: number
}

type ViewMode = 'board' | 'analytics' | 'settings'
type SettingsTab = 'pipelines' | 'customFields'

function PipelinePage() {
	const [viewMode, setViewMode] = useState<ViewMode>('board')
	const [settingsTab, setSettingsTab] = useState<SettingsTab>('pipelines')
	const [pipelines, setPipelines] = useState<Pipeline[]>([])
	const [activePipeline, setActivePipeline] = useState<Pipeline | null>(null)
	const [deals, setDeals] = useState<Deal[]>([])
	const [customFields, setCustomFields] = useState<CustomField[]>([])
	const [loading, setLoading] = useState(true)
	const [showCreatePipelineModal, setShowCreatePipelineModal] = useState(false)
	const [showCreateDealModal, setShowCreateDealModal] = useState(false)
	const [showCustomFieldModal, setShowCustomFieldModal] = useState(false)
	const [editingPipeline, setEditingPipeline] = useState<Pipeline | null>(null)
	const [editingDeal, setEditingDeal] = useState<Deal | null>(null)
	const [selectedStageId, setSelectedStageId] = useState<string | null>(null)

	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
	const token = localStorage.getItem('scalechat_token')

	useEffect(() => {
		loadInitialData()
	}, [])

	const loadInitialData = async () => {
		setLoading(true)
		await Promise.all([fetchPipelines(), loadCustomFields()])
		setLoading(false)
	}

	const fetchPipelines = async () => {
		try {
			const res = await fetch(`${API_URL}/api/v1/crm/pipelines`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			const pipelineList = data.pipelines || data.data || []

			if (pipelineList.length > 0) {
				setPipelines(pipelineList)
				const defaultP =
					pipelineList.find((p: Pipeline) => p.isDefault) || pipelineList[0]
				setActivePipeline(defaultP)
				await fetchDeals(defaultP.id)
			} else {
				setPipelines([])
			}
		} catch (error) {
			console.error('Failed to fetch pipelines:', error)
		}
	}

	const fetchDeals = async (pipelineId: string) => {
		try {
			const res = await fetch(
				`${API_URL}/api/v1/crm/deals?pipelineId=${pipelineId}`,
				{
					headers: { Authorization: `Bearer ${token}` },
				},
			)
			const data = await res.json()
			if (data.data) {
				setDeals(data.data)
			} else {
				setDeals([])
			}
		} catch (error) {
			console.error('Failed to fetch deals:', error)
			setDeals([])
		}
	}

	const loadCustomFields = async () => {
		try {
			const response = await fetch(`${API_URL}/api/v1/crm/custom-fields`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const result = await response.json()
			setCustomFields(result.data || [])
		} catch (error) {
			console.error('Failed to load custom fields:', error)
			setCustomFields([])
		}
	}

	const handleDeletePipeline = async (id: string) => {
		if (!confirm('Are you sure you want to delete this pipeline?')) return
		try {
			await fetch(`${API_URL}/api/v1/crm/pipelines/${id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})
			fetchPipelines()
		} catch (error) {
			console.error('Failed to delete pipeline:', error)
		}
	}

	const actions = (
		<div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 lg:gap-3 w-full lg:w-auto">
			<div
				role="tablist"
				aria-orientation="horizontal"
				className="bg-gray-100 text-gray-500 flex h-10 items-center rounded-lg p-1 overflow-x-auto no-scrollbar"
				style={{ outline: 'none' }}
			>
				<button
					type='button'
					role='tab'
					aria-selected={viewMode === 'board'}
					onClick={() => setViewMode('board')}
					className={`ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
						viewMode === 'board'
							? 'bg-white text-gray-950 shadow-sm'
							: 'hover:text-gray-900'
					}`}
				>
					<Target size={16} />
					Pipeline Board
				</button>
				<button
					type='button'
					role='tab'
					aria-selected={viewMode === 'analytics'}
					onClick={() => setViewMode('analytics')}
					className={`ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
						viewMode === 'analytics'
							? 'bg-white text-gray-950 shadow-sm'
							: 'hover:text-gray-900'
					}`}
				>
					<BarChart2 size={16} />
					Analytics
				</button>
				<button
					type='button'
					role='tab'
					aria-selected={viewMode === 'settings'}
					onClick={() => setViewMode('settings')}
					className={`ring-offset-white focus-visible:ring-gray-950 justify-center rounded-md px-4 py-1.5 text-sm font-medium whitespace-nowrap transition-all focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 flex items-center gap-2 ${
						viewMode === 'settings'
							? 'bg-white text-gray-950 shadow-sm'
							: 'hover:text-gray-900'
					}`}
				>
					<Settings size={16} />
					Settings
				</button>
			</div>
			<button
				onClick={() => setShowCreateDealModal(true)}
				className="px-4 py-2 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition-colors shadow-sm font-bold text-sm flex items-center justify-center gap-2 whitespace-nowrap"
			>
				<Plus size={18} />
				New Deal
			</button>
		</div>
	)

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center bg-white">
				<div className="flex flex-col items-center gap-4">
					<Clock className="animate-spin text-emerald-500" size={32} />
					<p className="text-gray-500 font-bold tracking-tight">
						Loading pipeline...
					</p>
				</div>
			</div>
		)
	}

	return (
		<div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
			<PageHeader
				title="Sales Pipeline"
				description="Manage your deals, track sales progress, and optimize your conversion pipeline"
				icon={<KanbanSquare size={24} />}
				actions={actions}
			/>

			<div className="flex-1 overflow-auto">
				{viewMode === 'board' && activePipeline && (
					<PipelineBoard
						pipelines={pipelines}
						deals={deals}
						activePipelineId={activePipeline.id}
						onPipelineChange={(id) => {
							const p = pipelines.find((pl) => pl.id === id) || null
							setActivePipeline(p)
							if (p) fetchDeals(p.id)
						}}
						onCreateDeal={(stageId) => {
							setSelectedStageId(stageId)
							setShowCreateDealModal(true)
						}}
						onEditDeal={setEditingDeal}
						onRefreshDeals={() =>
							activePipeline && fetchDeals(activePipeline.id)
						}
						onViewSettings={() => setViewMode('settings')}
					/>
				)}
				{viewMode === 'analytics' && (
					<PipelineAnalytics pipelines={pipelines} deals={deals} />
				)}
				{viewMode === 'settings' && (
					<PipelineSettings
						activeTab={settingsTab}
						setActiveTab={setSettingsTab}
						pipelines={pipelines}
						customFields={customFields}
						onRefreshPipelines={fetchPipelines}
						onRefreshCustomFields={loadCustomFields}
						onCreatePipeline={() => setShowCreatePipelineModal(true)}
						onEditPipeline={setEditingPipeline}
						onDeletePipeline={handleDeletePipeline}
						onCreateCustomField={() => setShowCustomFieldModal(true)}
					/>
				)}
			</div>

			{/* Modals */}
			{(showCreatePipelineModal || editingPipeline) && (
				<PipelineModal
					pipeline={editingPipeline}
					onClose={() => {
						setShowCreatePipelineModal(false)
						setEditingPipeline(null)
					}}
					onSave={() => {
						fetchPipelines()
						setShowCreatePipelineModal(false)
						setEditingPipeline(null)
					}}
				/>
			)}

			{(showCreateDealModal || editingDeal) && (
				<DealModal
					deal={editingDeal}
					pipelines={pipelines}
					customFields={customFields}
					selectedStageId={selectedStageId}
					onClose={() => {
						setShowCreateDealModal(false)
						setEditingDeal(null)
						setSelectedStageId(null)
					}}
					onSave={() => {
						if (activePipeline) fetchDeals(activePipeline.id)
						setShowCreateDealModal(false)
						setEditingDeal(null)
						setSelectedStageId(null)
					}}
				/>
			)}

			{showCustomFieldModal && (
				<CustomFieldModal
					onClose={() => setShowCustomFieldModal(false)}
					onSave={() => {
						loadCustomFields()
						setShowCustomFieldModal(false)
					}}
				/>
			)}
		</div>
	)
}

function DealCard({
	deal,
	onEdit,
}: {
	deal: Deal
	onEdit: (deal: Deal) => void
}) {
	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: deal.id,
		data: {
			stageId: deal.stageId,
		},
	})

	const style = {
		transform: CSS.Transform.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
		zIndex: isDragging ? 50 : 1,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className="bg-white rounded-xl border border-gray-200 p-4 mb-3 cursor-pointer hover:shadow-md transition-all group relative shadow-sm"
			onClick={() => onEdit(deal)}
		>
			<div className="flex items-start justify-between mb-2">
				<h4 className="font-bold text-gray-900 text-sm flex-1 pr-6 leading-tight">
					{deal.title}
				</h4>
				<div
					{...attributes}
					{...listeners}
					className="absolute right-2 top-4 p-1 opacity-0 group-hover:opacity-100 transition-opacity cursor-grab active:cursor-grabbing text-gray-400"
					onClick={(e) => e.stopPropagation()}
				>
					<GripVertical size={16} />
				</div>
			</div>

			<div className="space-y-3">
				<div className="flex items-center gap-2 text-xs font-medium text-gray-500">
					<div className="w-5 h-5 rounded-full bg-gray-100 flex items-center justify-center">
						<User size={12} className="text-gray-400" />
					</div>
					<span className="truncate">{deal.contactName || 'No Name'}</span>
				</div>

				<div className="flex items-center justify-between pt-3 border-t border-gray-100">
					<div className="flex items-center gap-1 text-emerald-600 font-bold text-sm">
						<span className="text-xs">{deal.currency || '$'}</span>
						<span>{deal.value.toLocaleString()}</span>
					</div>
					{deal.status === 'won' ? (
						<span className="px-2 py-0.5 bg-emerald-50 text-emerald-600 text-[10px] font-black uppercase rounded-full">
							Won
						</span>
					) : deal.status === 'lost' ? (
						<span className="px-2 py-0.5 bg-red-50 text-red-600 text-[10px] font-black uppercase rounded-full">
							Lost
						</span>
					) : (
						<span
							className={`px-2 py-0.5 text-[10px] font-black uppercase rounded-full ${
								deal.priority === 'high'
									? 'bg-amber-50 text-amber-600'
									: 'bg-gray-100 text-gray-500'
							}`}
						>
							{deal.priority || 'medium'}
						</span>
					)}
				</div>
			</div>
		</div>
	)
}

function PipelineBoard({
	pipelines,
	deals,
	activePipelineId,
	onPipelineChange,
	onCreateDeal,
	onEditDeal,
	onRefreshDeals,
	onViewSettings,
}: {
	pipelines: Pipeline[]
	deals: Deal[]
	activePipelineId: string
	onPipelineChange: (id: string) => void
	onCreateDeal: (stageId: string) => void
	onEditDeal: (deal: Deal) => void
	onRefreshDeals: () => void
	onViewSettings: () => void
}) {
	const [localDeals, setLocalDeals] = useState(deals)
	const [activeId, setActiveId] = useState<string | null>(null)

	const sensors = useSensors(
		useSensor(PointerSensor),
		useSensor(KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		}),
	)

	useEffect(() => {
		setLocalDeals(deals)
	}, [deals])

	const activePipeline =
		pipelines.find((p) => p.id === activePipelineId) || pipelines[0]

	if (!activePipeline) return null

	const handleDragStart = (event: DragStartEvent) => {
		setActiveId(event.active.id as string)
	}

	const handleDragEnd = async (event: DragEndEvent) => {
		const { active, over } = event
		if (!over) {
			setActiveId(null)
			return
		}

		const activeStageId = active.data.current?.stageId as string
		const overId = over.id as string

		let targetStageId = overId
		// If dropped on another card, get its stage
		const overDeal = localDeals.find((d) => d.id === overId)
		if (overDeal) {
			targetStageId = overDeal.stageId
		}

		if (activeStageId !== targetStageId) {
			setLocalDeals((deals) =>
				(deals || []).map((deal) =>
					deal.id === active.id ? { ...deal, stageId: targetStageId } : deal,
				),
			)

			try {
				const token = localStorage.getItem('scalechat_token')
				const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
				await fetch(`${API_URL}/api/v1/crm/deals/${active.id}`, {
					method: 'PATCH',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
					},
					body: JSON.stringify({ stageId: targetStageId }),
				})
			} catch (error) {
				console.error('Failed to update deal stage:', error)
				onRefreshDeals()
			}
		}

		setActiveId(null)
	}

	const getDealsByStage = (stageId: string) => {
		return localDeals.filter((deal) => deal.stageId === stageId)
	}

	const activeDeal = activeId ? localDeals.find((d) => d.id === activeId) : null

	return (
		<div className="p-4 lg:p-8 pt-0 lg:pt-0">
			{/* Pipeline Selector */}
			<div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-8">
				<div>
					<h2 className="text-xl font-bold text-gray-900 tracking-tight">
						{activePipeline.name}
					</h2>
					{activePipeline.description && (
						<p className="text-sm text-gray-500 mt-1">
							{activePipeline.description}
						</p>
					)}
				</div>
				{pipelines.length > 1 && (
					<select
						value={activePipelineId}
						onChange={(e) => onPipelineChange(e.target.value)}
						className="px-4 py-2 bg-gray-50 border border-gray-200 rounded-lg font-bold text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/20 shadow-sm min-w-[200px]"
					>
						{pipelines.map((pipeline) => (
							<option key={pipeline.id} value={pipeline.id}>
								{pipeline.name}
							</option>
						))}
					</select>
				)}
			</div>

			<DndContext
				sensors={sensors}
				collisionDetection={closestCorners}
				onDragStart={handleDragStart}
				onDragEnd={handleDragEnd}
			>
				<div className="flex gap-6 overflow-x-auto pb-8 snap-x">
					{(activePipeline.stages || [])
						.sort((a, b) => a.order - b.order)
						.map((stage) => {
							const stageDeals = getDealsByStage(stage.id)
							const totalValue = stageDeals.reduce(
								(sum, deal) => sum + deal.value,
								0,
							)

							return (
								<div
									key={stage.id}
									className="flex-shrink-0 w-[320px] bg-gray-50/50 rounded-2xl border border-gray-100 flex flex-col snap-start"
								>
									<div className="px-5 py-4 border-b border-gray-100 bg-white rounded-t-2xl">
										<div className="flex items-center justify-between mb-1">
											<div className="flex items-center gap-2">
												<div
													className='w-2.5 h-2.5 rounded-full'
													style={{ backgroundColor: stage.color }}
												/>
												<h3 className="font-bold text-gray-900 text-sm tracking-tight">
													{stage.name}
												</h3>
											</div>
											<span className="text-[10px] font-black uppercase text-gray-400 bg-gray-50 px-2 py-0.5 rounded-full border border-gray-100">
												{stageDeals.length}
											</span>
										</div>
										<div className="text-xs text-emerald-600 font-bold opacity-80">
											${totalValue.toLocaleString()}
										</div>
									</div>

									<SortableContext
										items={(stageDeals || []).map((d) => d.id)}
										strategy={verticalListSortingStrategy}
										id={stage.id}
									>
										<div className="p-4 flex-1 overflow-y-auto min-h-[400px]">
											{(stageDeals || []).map((deal) => (
												<DealCard
													key={deal.id}
													deal={deal}
													onEdit={onEditDeal}
												/>
											))}

											<button
												onClick={() => onCreateDeal(stage.id)}
												className="w-full py-3 border-2 border-dashed border-gray-200 rounded-xl text-gray-400 hover:border-emerald-500 hover:text-emerald-600 hover:bg-emerald-50/30 text-xs font-bold transition-all group flex items-center justify-center gap-2"
											>
												<Plus size={14} />
												Add New Deal
											</button>
										</div>
									</SortableContext>
								</div>
							)
						})}
				</div>

				<DragOverlay>
					{activeDeal ? (
						<div className="bg-white rounded-xl border border-emerald-500 p-4 shadow-2xl w-[320px] scale-105 rotate-2 cursor-grabbing">
							<h4 className="font-bold text-gray-900 text-sm mb-2">
								{activeDeal.title}
							</h4>
							<div className="flex items-center gap-1 text-emerald-600 font-bold text-xs">
								<DollarSign size={14} />
								<span>{activeDeal.value.toLocaleString()}</span>
							</div>
						</div>
					) : null}
				</DragOverlay>
			</DndContext>
		</div>
	)
}

// Import additional components
import {
	PipelineAnalytics,
	PipelineSettings,
} from '@/components/PipelineComponents'
import {
	PipelineModal,
	DealModal,
	CustomFieldModal,
} from '@/components/PipelineModals'

// Export all types for use in component files
export type { Stage, Pipeline, Deal, CustomField, ViewMode, SettingsTab }
