/**
 * AI Flow Node Components
 *
 * ReactFlow custom node components for AI-powered flow actions.
 * These integrate with the flow builder in flows.tsx
 */

import React, { useMemo } from 'react'
import { Handle, Position } from '@xyflow/react'
import {
	Sparkles,
	Brain,
	ShieldAlert,
	Plus,
	Trash2,
	Bot,
	Settings,
	Database,
	MessageSquare,
	Activity,
	ChevronRight,
} from 'lucide-react'
import {
	type AINodeData,
	type AIGenerateNodeData,
	type AIClassifyNodeData,
	type AIHandoffNodeData,
	getAINodeIcon,
	getAINodeTypeLabel,
} from './AINodeTypes'

interface AINodeProps {
	id: string
	data: AINodeData
	selected?: boolean
}

// ============================================================================
// AI GENERATE NODE
// ============================================================================

export function AIGenerateNode({ id, data, selected }: AINodeProps) {
	const generateData = data as AIGenerateNodeData

	return (
		<div
			className={`group flex flex-col items-center relative transition-all duration-300 ${selected ? 'scale-105 z-50' : ''}`}
		>
				{selected && (
					<div className="absolute -top-8 right-0 inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white dark:bg-zinc-900 border rounded-lg animate-in fade-in slide-in-from-bottom-2 z-50 text-violet-700 dark:text-violet-300 border-violet-200 dark:border-violet-800/40">
						Selected
					</div>
				)}

				<div
					className={`
	                bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden min-w-[280px] max-w-[320px] transition-all duration-300 relative z-10 border-2
	                border-violet-500
	                ${selected ? 'ring-4 ring-violet-500/20' : 'shadow-xl'}
	            `}
			>
				<Handle
					type="target"
					position={Position.Top}
					className="!w-3 !h-3 !border-2 !border-white shadow-sm !bg-violet-500"
				/>

				{/* Header */}
				<div className="bg-violet-600 px-4 py-3 flex items-center gap-2 text-white">
					<Sparkles size={18} />
					<span className="font-bold text-sm uppercase tracking-wider">
						AI Generate
					</span>
				</div>

				{/* Content */}
					<div className="p-4 bg-white dark:bg-zinc-900 space-y-3">
						<div className="flex items-center gap-2">
							<div className="text-sm font-black text-gray-900 dark:text-zinc-100 leading-tight flex items-center gap-2">
								<Bot size={14} className="text-violet-500" />
								AI Response Generation
							</div>
						</div>

						{/* Prompt Preview */}
						<div className="bg-slate-50 dark:bg-zinc-800 border border-slate-100 dark:border-zinc-700 rounded-xl p-3">
							<p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
								Response Prompt
							</p>
							<p className="text-[11px] text-gray-600 dark:text-zinc-300 line-clamp-2 italic">
								{generateData.responsePrompt || 'Generate a helpful response...'}
							</p>
						</div>

					{/* Features */}
					<div className="flex flex-wrap gap-1.5">
						{generateData.enableKnowledgeBase && (
								<div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 dark:bg-emerald-900/35 text-emerald-600 dark:text-emerald-300 text-[9px] font-bold rounded-full border border-emerald-100 dark:border-emerald-800/40">
									<Database size={10} />
									KB
								</div>
							)}
							{generateData.includeConversationHistory && (
								<div className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 dark:bg-blue-900/35 text-blue-600 dark:text-blue-300 text-[9px] font-bold rounded-full border border-blue-100 dark:border-blue-800/40">
									<MessageSquare size={10} />
									History
								</div>
							)}
							{generateData.useGlobalSettings && (
								<div className="flex items-center gap-1 px-2 py-0.5 bg-violet-50 dark:bg-violet-900/35 text-violet-600 dark:text-violet-300 text-[9px] font-bold rounded-full border border-violet-100 dark:border-violet-800/40">
									<Settings size={10} />
									Global
								</div>
						)}
					</div>
				</div>
			</div>

			{/* Add Next Node Button */}
				<div className="h-10 w-0.5 bg-gray-200 dark:bg-zinc-700 relative flex flex-col items-center -mt-0.5">
				<div className="absolute top-1/2 -translate-y-1/2 z-20 mt-5 mb-5">
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation()
							data.onSelect?.()
							data.onAddAction?.('ai_generate')
						}}
						onMouseDown={(event) => event.stopPropagation()}
							className="w-9 h-9 rounded-xl bg-violet-100 dark:bg-violet-900/40 border-4 border-white dark:border-zinc-900 shadow-lg flex items-center justify-center text-violet-600 dark:text-violet-300 hover:bg-violet-600 hover:text-white transition-all transform hover:scale-110 active:scale-95"
						title="Add AI action"
					>
						<Plus size={18} strokeWidth={3} />
					</button>
				</div>
			</div>

			<Handle
				type="source"
				position={Position.Bottom}
				className="!opacity-0 !bottom-0"
			/>

			{/* Delete Button */}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation()
					if (data.onDelete) data.onDelete(id)
				}}
					className="absolute -right-3 top-1/4 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shadow-lg border border-white dark:border-zinc-700 z-30"
				>
				<Trash2 size={16} />
			</button>
		</div>
	)
}

// ============================================================================
// AI CLASSIFY NODE
// ============================================================================

export function AIClassifyNode({ id, data, selected }: AINodeProps) {
	const classifyData = data as AIClassifyNodeData

	const classificationTypeLabel = useMemo(() => {
		switch (classifyData.classificationType) {
			case 'intent':
				return 'Intent'
			case 'sentiment':
				return 'Sentiment'
			case 'category':
				return 'Category'
			case 'priority':
				return 'Priority'
			default:
				return 'Classify'
		}
	}, [classifyData.classificationType])

	return (
		<div
			className={`group flex flex-col items-center relative transition-all duration-300 ${selected ? 'scale-105 z-50' : ''}`}
		>
				{selected && (
					<div className="absolute -top-8 right-0 inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white dark:bg-zinc-900 border rounded-lg animate-in fade-in slide-in-from-bottom-2 z-50 text-cyan-700 dark:text-cyan-300 border-cyan-200 dark:border-cyan-800/40">
						Selected
					</div>
				)}

			<div
				className={`
	                bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden min-w-[280px] max-w-[320px] transition-all duration-300 relative z-10 border-2
	                border-cyan-500
	                ${selected ? 'ring-4 ring-cyan-500/20' : 'shadow-xl'}
	            `}
			>
				<Handle
					type="target"
					position={Position.Top}
					className="!w-3 !h-3 !border-2 !border-white shadow-sm !bg-cyan-500"
				/>

				{/* Header */}
				<div className="bg-cyan-600 px-4 py-3 flex items-center gap-2 text-white">
					<Brain size={18} />
					<span className="font-bold text-sm uppercase tracking-wider">
						AI Classify
					</span>
				</div>

				{/* Content */}
					<div className="p-4 bg-white dark:bg-zinc-900 space-y-3">
						<div className="flex items-center justify-between">
							<div className="text-sm font-black text-gray-900 dark:text-zinc-100 leading-tight flex items-center gap-2">
								<Activity size={14} className="text-cyan-500" />
								{classificationTypeLabel} Classification
							</div>
							{classifyData.confidenceThreshold && (
								<div className="px-2 py-0.5 bg-cyan-50 dark:bg-cyan-900/35 text-cyan-600 dark:text-cyan-300 text-[9px] font-bold rounded-full border border-cyan-100 dark:border-cyan-800/40">
									{Math.round(classifyData.confidenceThreshold * 100)}%
								</div>
							)}
						</div>

					{/* Categories Preview */}
					{classifyData.classificationType === 'category' &&
						classifyData.categories && (
								<div className="bg-slate-50 dark:bg-zinc-800 border border-slate-100 dark:border-zinc-700 rounded-xl p-3">
									<p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-1">
										Categories
									</p>
									<div className="flex flex-wrap gap-1">
										{classifyData.categories.slice(0, 3).map((cat, i) => (
											<span
												key={i}
												className="px-2 py-0.5 bg-cyan-50 dark:bg-cyan-900/35 text-cyan-600 dark:text-cyan-300 text-[10px] font-bold rounded-full border border-cyan-100 dark:border-cyan-800/40"
											>
												{cat}
											</span>
										))}
										{classifyData.categories.length > 3 && (
											<span className="px-2 py-0.5 bg-gray-100 dark:bg-zinc-700 text-gray-500 dark:text-zinc-300 text-[10px] font-bold rounded-full">
												+{classifyData.categories.length - 3}
											</span>
										)}
								</div>
							</div>
						)}

					{/* Output Variable */}
						{classifyData.outputVariable && (
							<div className="bg-blue-50/50 dark:bg-blue-950/35 border border-blue-100 dark:border-blue-800/40 rounded-lg p-2">
								<p className="text-[10px] text-blue-600 dark:text-blue-300 font-medium">
									Output:{' '}
									<code className="bg-blue-100/50 dark:bg-blue-900/50 px-1 rounded text-blue-800 dark:text-blue-200 font-bold">
										{'{'}
										{classifyData.outputVariable}
										{'}'}
								</code>
							</p>
						</div>
					)}
				</div>
			</div>

			{/* Add Next Node Button */}
				<div className="h-10 w-0.5 bg-gray-200 dark:bg-zinc-700 relative flex flex-col items-center -mt-0.5">
				<div className="absolute top-1/2 -translate-y-1/2 z-20 mt-5 mb-5">
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation()
							data.onSelect?.()
							data.onAddAction?.('ai_classify')
						}}
						onMouseDown={(event) => event.stopPropagation()}
							className="w-9 h-9 rounded-xl bg-cyan-100 dark:bg-cyan-900/40 border-4 border-white dark:border-zinc-900 shadow-lg flex items-center justify-center text-cyan-600 dark:text-cyan-300 hover:bg-cyan-600 hover:text-white transition-all transform hover:scale-110 active:scale-95"
						title="Add AI action"
					>
						<Plus size={18} strokeWidth={3} />
					</button>
				</div>
			</div>

			<Handle
				type="source"
				position={Position.Bottom}
				className="!opacity-0 !bottom-0"
			/>

			{/* Delete Button */}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation()
					if (data.onDelete) data.onDelete(id)
				}}
					className="absolute -right-3 top-1/4 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shadow-lg border border-white dark:border-zinc-700 z-30"
				>
				<Trash2 size={16} />
			</button>
		</div>
	)
}

// ============================================================================
// AI HANDOFF NODE
// ============================================================================

export function AIHandoffNode({ id, data, selected }: AINodeProps) {
	const handoffData = data as AIHandoffNodeData

	const activeTriggers = useMemo(() => {
		if (!handoffData.handoffTriggers) return []
		const triggers: string[] = []
		if (handoffData.handoffTriggers.lowConfidence)
			triggers.push('Low Confidence')
		if (handoffData.handoffTriggers.keywordMatch) triggers.push('Keywords')
		if (handoffData.handoffTriggers.sentimentNegative)
			triggers.push('Negative Sentiment')
		if (handoffData.handoffTriggers.escalationRequest)
			triggers.push('Escalation')
		return triggers
	}, [handoffData.handoffTriggers])

	return (
		<div
			className={`group flex flex-col items-center relative transition-all duration-300 ${selected ? 'scale-105 z-50' : ''}`}
		>
				{selected && (
					<div className="absolute -top-8 right-0 inline-block px-3 py-1 text-[10px] font-black uppercase tracking-widest bg-white dark:bg-zinc-900 border rounded-lg animate-in fade-in slide-in-from-bottom-2 z-50 text-rose-700 dark:text-rose-300 border-rose-200 dark:border-rose-800/40">
						Selected
					</div>
				)}

			<div
				className={`
	                bg-white dark:bg-zinc-900 rounded-2xl overflow-hidden min-w-[280px] max-w-[320px] transition-all duration-300 relative z-10 border-2
	                border-rose-500
	                ${selected ? 'ring-4 ring-rose-500/20' : 'shadow-xl'}
	            `}
			>
				<Handle
					type="target"
					position={Position.Top}
					className="!w-3 !h-3 !border-2 !border-white shadow-sm !bg-rose-500"
				/>

				{/* Header */}
				<div className="bg-rose-600 px-4 py-3 flex items-center gap-2 text-white">
					<ShieldAlert size={18} />
					<span className="font-bold text-sm uppercase tracking-wider">
						AI Handoff
					</span>
				</div>

				{/* Content */}
					<div className="p-4 bg-white dark:bg-zinc-900 space-y-3">
						<div className="flex items-center gap-2">
							<div className="text-sm font-black text-gray-900 dark:text-zinc-100 leading-tight flex items-center gap-2">
								<ShieldAlert size={14} className="text-rose-500" />
								Human Handoff Detection
							</div>
						</div>

						{/* Triggers */}
						<div className="bg-slate-50 dark:bg-zinc-800 border border-slate-100 dark:border-zinc-700 rounded-xl p-3">
							<p className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-zinc-500 mb-2">
								Triggers
							</p>
							<div className="flex flex-wrap gap-1.5">
								{activeTriggers.map((trigger, i) => (
									<div
										key={i}
										className="flex items-center gap-1 px-2 py-0.5 bg-rose-50 dark:bg-rose-900/35 text-rose-600 dark:text-rose-300 text-[9px] font-bold rounded-full border border-rose-100 dark:border-rose-800/40"
									>
										<ChevronRight size={8} />
										{trigger}
									</div>
								))}
								{activeTriggers.length === 0 && (
									<p className="text-[10px] text-gray-400 dark:text-zinc-500 italic">
										No triggers configured
									</p>
								)}
						</div>
					</div>

					{/* Escalation Priority */}
						{handoffData.escalationPriority && (
							<div className="flex items-center justify-between px-3 py-2 bg-slate-50 dark:bg-zinc-800 rounded-lg border border-slate-100 dark:border-zinc-700">
								<span className="text-[10px] font-black uppercase tracking-widest text-gray-400 dark:text-zinc-500">
									Priority
								</span>
								<span
									className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
										handoffData.escalationPriority === 'high'
											? 'bg-red-100 dark:bg-red-900/35 text-red-600 dark:text-red-300'
											: handoffData.escalationPriority === 'medium'
												? 'bg-amber-100 dark:bg-amber-900/35 text-amber-600 dark:text-amber-300'
												: 'bg-gray-100 dark:bg-zinc-700 text-gray-600 dark:text-zinc-300'
									}`}
								>
								{handoffData.escalationPriority.toUpperCase()}
							</span>
						</div>
					)}
				</div>
			</div>

			{/* Add Next Node Button */}
				<div className="h-10 w-0.5 bg-gray-200 dark:bg-zinc-700 relative flex flex-col items-center -mt-0.5">
				<div className="absolute top-1/2 -translate-y-1/2 z-20 mt-5 mb-5">
					<button
						type="button"
						onClick={(event) => {
							event.stopPropagation()
							data.onSelect?.()
							data.onAddEnd?.('human')
						}}
						onMouseDown={(event) => event.stopPropagation()}
							className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-900/40 border-4 border-white dark:border-zinc-900 shadow-lg flex items-center justify-center text-rose-600 dark:text-rose-300 hover:bg-rose-600 hover:text-white transition-all transform hover:scale-110 active:scale-95"
						title="Add human agent endpoint"
					>
						<Plus size={18} strokeWidth={3} />
					</button>
				</div>
			</div>

			<Handle
				type="source"
				position={Position.Bottom}
				className="!opacity-0 !bottom-0"
			/>

			{/* Delete Button */}
			<button
				type="button"
				onClick={(e) => {
					e.stopPropagation()
					if (data.onDelete) data.onDelete(id)
				}}
					className="absolute -right-3 top-1/4 -translate-y-1/2 w-8 h-8 rounded-lg bg-gray-100 dark:bg-zinc-800 text-gray-400 dark:text-zinc-400 opacity-0 group-hover:opacity-100 hover:bg-red-500 hover:text-white transition-all flex items-center justify-center shadow-lg border border-white dark:border-zinc-700 z-30"
				>
				<Trash2 size={16} />
			</button>
		</div>
	)
}

// ============================================================================
// NODE TYPE MAPPING
// ============================================================================

/**
 * Map AI node type to React component
 */
export const AI_NODE_COMPONENTS = {
	ai_generate: AIGenerateNode,
	ai_classify: AIClassifyNode,
	ai_handoff: AIHandoffNode,
}

/**
 * Get AI node component by type
 */
export function getAINodeComponent(type: string) {
	return AI_NODE_COMPONENTS[type as keyof typeof AI_NODE_COMPONENTS]
}
