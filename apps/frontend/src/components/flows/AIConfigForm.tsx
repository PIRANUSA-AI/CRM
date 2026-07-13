/**
 * AI Node Configuration Form
 *
 * Modal/form component for configuring AI flow nodes.
 * Handles all three AI node types: ai_generate, ai_classify, ai_handoff
 */

import React, { useState, useEffect } from 'react'
import {
	X,
	Save,
	Settings,
	Sparkles,
	Brain,
	ShieldAlert,
	Database,
	MessageSquare,
	ChevronRight,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card } from '@/components/ui/card'
import { toast } from 'sonner'
import {
	type AINodeData,
	type AIGenerateNodeData,
	type AIClassifyNodeData,
	type AIHandoffNodeData,
	validateAINodeData,
	getAINodeTypeLabel,
	getAINodeIcon,
} from './AINodeTypes'

interface AIConfigFormProps {
	node: AINodeData
	onSave: (data: AINodeData) => void
	onCancel: () => void
	globalAISettings?: {
		model: string
		temperature: number
		maxTokens: number
		responseTone: string
	}
}

export function AIConfigForm({
	node,
	onSave,
	onCancel,
	globalAISettings,
}: AIConfigFormProps) {
	const [data, setData] = useState<AINodeData>(node)
	const [errors, setErrors] = useState<string[]>([])

	const NodeIcon = getAINodeIcon(node.type)

	// Update local data when node prop changes
	useEffect(() => {
		setData(node)
	}, [node])

	const handleSave = () => {
		const validation = validateAINodeData(data)
		if (!validation.valid) {
			setErrors(validation.errors)
			toast.error('Please fix validation errors')
			return
		}
		setErrors([])
		onSave(data)
		toast.success(`${getAINodeTypeLabel(node.type)} configuration saved`)
	}

	const updateData = (updates: Partial<AINodeData>) => {
		setData((prev) => ({ ...prev, ...updates }) as AINodeData)
	}

	return (
		<div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
			<Card className="bg-white rounded-2xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-hidden flex flex-col">
				{/* Header */}
				<div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gray-50/50">
					<div className="flex items-center gap-3">
						<div
							className={`w-10 h-10 rounded-xl flex items-center justify-center ${
								node.type === 'ai_generate'
									? 'bg-violet-100 text-violet-600'
									: node.type === 'ai_classify'
										? 'bg-cyan-100 text-cyan-600'
										: 'bg-rose-100 text-rose-600'
							}`}
						>
							<NodeIcon size={20} />
						</div>
						<div>
							<h2 className="text-lg font-black text-gray-900">
								{getAINodeTypeLabel(node.type)}
							</h2>
							<p className="text-xs text-gray-500 font-medium">
								Configure AI node settings
							</p>
						</div>
					</div>
					<button
						onClick={onCancel}
						className="w-8 h-8 rounded-lg hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
					>
						<X size={18} />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 space-y-6">
					{errors.length > 0 && (
						<div className="bg-red-50 border border-red-200 rounded-xl p-4">
							<p className="text-sm font-bold text-red-800 mb-2">
								Please fix the following errors:
							</p>
							<ul className="text-sm text-red-700 space-y-1">
								{errors.map((err, i) => (
									<li key={i} className="flex items-start gap-2">
										<ChevronRight size={14} className="mt-0.5 shrink-0" />
										{err}
									</li>
								))}
							</ul>
						</div>
					)}

					{/* Basic Settings */}
					<div className="space-y-4">
						<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
							Basic Settings
						</h3>

						<div className="grid gap-3">
							<label className="text-xs font-bold text-gray-700">Label</label>
							<Input
								value={data.label || ''}
								onChange={(e) => updateData({ label: e.target.value })}
								placeholder="Node label"
								className="h-10 rounded-xl border-gray-200"
							/>
						</div>

						<div className="grid gap-3">
							<label className="text-xs font-bold text-gray-700">
								Description (Optional)
							</label>
							<Input
								value={data.description || ''}
								onChange={(e) => updateData({ description: e.target.value })}
								placeholder="What this node does"
								className="h-10 rounded-xl border-gray-200"
							/>
						</div>
					</div>

					{/* AI Settings */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
								AI Settings
							</h3>
							<div className="flex items-center gap-2">
								<label className="text-xs text-gray-600">
									Use Global Settings
								</label>
								<button
									onClick={() =>
										updateData({ useGlobalSettings: !data.useGlobalSettings })
									}
									className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 shadow-inner ${
										data.useGlobalSettings ? 'bg-emerald-500' : 'bg-gray-200'
									}`}
								>
									<span
										className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-300 ${
											data.useGlobalSettings ? 'translate-x-5' : 'translate-x-1'
										}`}
									/>
								</button>
							</div>
						</div>

						{data.useGlobalSettings && globalAISettings && (
							<div className="bg-emerald-50/50 border border-emerald-100 rounded-xl p-4">
								<p className="text-xs font-bold text-emerald-800 mb-2">
									Global AI Configuration
								</p>
								<div className="space-y-1 text-xs text-emerald-700">
									<p>
										Model:{' '}
										<span className="font-mono font-bold">
											{globalAISettings.model}
										</span>
									</p>
									<p>
										Temperature:{' '}
										<span className="font-bold">
											{globalAISettings.temperature}
										</span>
									</p>
									<p>
										Max Tokens:{' '}
										<span className="font-bold">
											{globalAISettings.maxTokens}
										</span>
									</p>
								</div>
							</div>
						)}
					</div>

					{/* Knowledge Base */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
								Knowledge Base
							</h3>
							<div className="flex items-center gap-2">
								<Database
									size={14}
									className={
										data.enableKnowledgeBase
											? 'text-emerald-500'
											: 'text-gray-400'
									}
								/>
								<label className="text-xs text-gray-600">Enable RAG</label>
								<button
									onClick={() =>
										updateData({
											enableKnowledgeBase: !data.enableKnowledgeBase,
										})
									}
									className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 shadow-inner ${
										data.enableKnowledgeBase ? 'bg-emerald-500' : 'bg-gray-200'
									}`}
								>
									<span
										className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-300 ${
											data.enableKnowledgeBase
												? 'translate-x-5'
												: 'translate-x-1'
										}`}
									/>
								</button>
							</div>
						</div>

						{data.enableKnowledgeBase && (
							<div className="grid gap-3">
								<label className="text-xs font-bold text-gray-700">
									Number of KB Results
								</label>
								<Input
									type="number"
									min={1}
									max={10}
									value={data.knowledgeBaseLimit || 3}
									onChange={(e) =>
										updateData({ knowledgeBaseLimit: parseInt(e.target.value) })
									}
									className="h-10 rounded-xl border-gray-200"
								/>
							</div>
						)}
					</div>

					{/* Conversation History */}
					<div className="space-y-4">
						<div className="flex items-center justify-between">
							<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
								Conversation Context
							</h3>
							<div className="flex items-center gap-2">
								<MessageSquare
									size={14}
									className={
										data.includeConversationHistory
											? 'text-blue-500'
											: 'text-gray-400'
									}
								/>
								<label className="text-xs text-gray-600">Include History</label>
								<button
									onClick={() =>
										updateData({
											includeConversationHistory:
												!data.includeConversationHistory,
										})
									}
									className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 shadow-inner ${
										data.includeConversationHistory
											? 'bg-emerald-500'
											: 'bg-gray-200'
									}`}
								>
									<span
										className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-300 ${
											data.includeConversationHistory
												? 'translate-x-5'
												: 'translate-x-1'
										}`}
									/>
								</button>
							</div>
						</div>
					</div>

					{/* Fallback Behavior */}
					<div className="space-y-4">
						<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
							Fallback Behavior
						</h3>

						<div className="grid gap-3">
							<label className="text-xs font-bold text-gray-700">
								On AI Failure
							</label>
							<select
								value={data.fallbackBehavior || 'block'}
								onChange={(e) =>
									updateData({ fallbackBehavior: e.target.value as any })
								}
								className="h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white"
							>
								<option value="block">Block & Notify Agent</option>
								<option value="skip">Skip & Continue</option>
								<option value="fallback_message">Use Fallback Message</option>
							</select>
						</div>

						{data.fallbackBehavior === 'fallback_message' && (
							<div className="grid gap-3">
								<label className="text-xs font-bold text-gray-700">
									Fallback Message
								</label>
								<textarea
									value={data.fallbackMessage || ''}
									onChange={(e) =>
										updateData({ fallbackMessage: e.target.value })
									}
									placeholder="Message to use when AI fails"
									rows={2}
									className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none"
								/>
							</div>
						)}
					</div>

					{/* Node-Specific Settings */}
					{node.type === 'ai_generate' && (
						<AIGenerateSettings
							data={data as AIGenerateNodeData}
							updateData={updateData}
						/>
					)}
					{node.type === 'ai_classify' && (
						<AIClassifySettings
							data={data as AIClassifyNodeData}
							updateData={updateData}
						/>
					)}
					{node.type === 'ai_handoff' && (
						<AIHandoffSettings
							data={data as AIHandoffNodeData}
							updateData={updateData}
						/>
					)}
				</div>

				{/* Footer */}
				<div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100 bg-gray-50/50">
					<Button
						variant="outline"
						onClick={onCancel}
						className="h-10 px-6 rounded-xl font-bold"
					>
						Cancel
					</Button>
					<Button
						onClick={handleSave}
						className="h-10 px-6 rounded-xl font-bold bg-gray-900 hover:bg-black text-white"
					>
						<Save size={16} className="mr-2" />
						Save Configuration
					</Button>
				</div>
			</Card>
		</div>
	)
}

// ============================================================================
// AI GENERATE SETTINGS
// ============================================================================

function AIGenerateSettings({
	data,
	updateData,
}: {
	data: AIGenerateNodeData
	updateData: (updates: Partial<AINodeData>) => void
}) {
	return (
		<div className="space-y-4">
			<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
				Response Generation
			</h3>

			<div className="grid gap-3">
				<label className="text-xs font-bold text-gray-700">
					Response Prompt
				</label>
				<textarea
					value={data.responsePrompt || ''}
					onChange={(e) => updateData({ responsePrompt: e.target.value })}
					placeholder="Generate a helpful response to the customer message based on the context."
					rows={3}
					className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none"
				/>
				<p className="text-[10px] text-gray-500">
					The prompt that guides AI response generation. Use {'{context}'} to
					include conversation history.
				</p>
			</div>

			<div className="grid gap-3">
				<label className="text-xs font-bold text-gray-700">
					Response Tone (Optional)
				</label>
				<Input
					value={data.responseTone || ''}
					onChange={(e) => updateData({ responseTone: e.target.value })}
					placeholder="Professional, friendly, and concise"
					className="h-10 rounded-xl border-gray-200"
				/>
			</div>

			<div className="grid gap-3">
				<label className="text-xs font-bold text-gray-700">
					Output Variable (Optional)
				</label>
				<Input
					value={data.outputVariable || ''}
					onChange={(e) => updateData({ outputVariable: e.target.value })}
					placeholder="ai_response"
					className="h-10 rounded-xl border-gray-200 font-mono text-xs"
				/>
				<p className="text-[10px] text-gray-500">
					Store the generated response in a variable for use in subsequent
					nodes.
				</p>
			</div>
		</div>
	)
}

// ============================================================================
// AI CLASSIFY SETTINGS
// ============================================================================

function AIClassifySettings({
	data,
	updateData,
}: {
	data: AIClassifyNodeData
	updateData: (updates: Partial<AINodeData>) => void
}) {
	return (
		<div className="space-y-4">
			<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
				Classification Settings
			</h3>

			<div className="grid gap-3">
				<label className="text-xs font-bold text-gray-700">
					Classification Type
				</label>
				<select
					value={data.classificationType || 'intent'}
					onChange={(e) =>
						updateData({ classificationType: e.target.value as any })
					}
					className="h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white"
				>
					<option value="intent">Intent Classification</option>
					<option value="sentiment">Sentiment Analysis</option>
					<option value="category">Custom Category</option>
					<option value="priority">Priority Level</option>
				</select>
			</div>

			{data.classificationType === 'category' && (
				<div className="grid gap-3">
					<label className="text-xs font-bold text-gray-700">Categories</label>
					<div className="space-y-2">
						{(data.categories || ['sales', 'support', 'billing']).map(
							(cat, i) => (
								<div key={i} className="flex gap-2">
									<Input
										value={cat}
										onChange={(e) => {
											const newCategories = [...(data.categories || [])]
											newCategories[i] = e.target.value
											updateData({ categories: newCategories })
										}}
										className="h-9 rounded-xl border-gray-200 text-sm"
									/>
									<button
										onClick={() => {
											const newCategories = (data.categories || []).filter(
												(_, idx) => idx !== i,
											)
											updateData({ categories: newCategories })
										}}
										className="w-9 h-9 rounded-lg text-red-500 hover:bg-red-50 flex items-center justify-center"
									>
										<X size={14} />
									</button>
								</div>
							),
						)}
						<Button
							variant="outline"
							size="sm"
							onClick={() =>
								updateData({ categories: [...(data.categories || []), ''] })
							}
							className="w-full h-9 rounded-xl border-dashed"
						>
							+ Add Category
						</Button>
					</div>
				</div>
			)}

			<div className="grid gap-3">
				<label className="text-xs font-bold text-gray-700">
					Output Variable
				</label>
				<Input
					value={data.outputVariable || ''}
					onChange={(e) => updateData({ outputVariable: e.target.value })}
					placeholder="classification_result"
					className="h-10 rounded-xl border-gray-200 font-mono text-xs"
				/>
			</div>

			<div className="grid gap-3">
				<div className="flex justify-between items-center">
					<label className="text-xs font-bold text-gray-700">
						Confidence Threshold
					</label>
					<span className="text-xs font-bold text-cyan-600 bg-cyan-50 px-2 py-0.5 rounded-full">
						{Math.round((data.confidenceThreshold || 0.7) * 100)}%
					</span>
				</div>
				<input
					type="range"
					min="0.5"
					max="1.0"
					step="0.05"
					value={data.confidenceThreshold || 0.7}
					onChange={(e) =>
						updateData({ confidenceThreshold: parseFloat(e.target.value) })
					}
					className="w-full h-2 bg-gray-100 rounded-lg appearance-none cursor-pointer accent-cyan-500"
				/>
			</div>
		</div>
	)
}

// ============================================================================
// AI HANDOFF SETTINGS
// ============================================================================

function AIHandoffSettings({
	data,
	updateData,
}: {
	data: AIHandoffNodeData
	updateData: (updates: Partial<AINodeData>) => void
}) {
	return (
		<div className="space-y-4">
			<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
				Handoff Triggers
			</h3>

			<div className="space-y-3">
				{[
					{
						key: 'lowConfidence',
						label: 'Low Confidence',
						desc: 'AI confidence falls below threshold',
					},
					{
						key: 'keywordMatch',
						label: 'Keyword Match',
						desc: 'Customer uses specific keywords',
					},
					{
						key: 'sentimentNegative',
						label: 'Negative Sentiment',
						desc: 'Customer sentiment is negative',
					},
					{
						key: 'escalationRequest',
						label: 'Escalation Request',
						desc: 'Customer asks for human agent',
					},
				].map(({ key, label, desc }) => (
					<div
						key={key}
						className="flex items-center justify-between p-3 bg-slate-50 rounded-xl"
					>
						<div>
							<p className="text-sm font-bold text-gray-900">{label}</p>
							<p className="text-[10px] text-gray-500">{desc}</p>
						</div>
						<button
							onClick={() =>
								updateData({
									handoffTriggers: {
										...data.handoffTriggers,
										[key]: !(
											data.handoffTriggers?.[
												key as keyof typeof data.handoffTriggers
											] ?? false
										),
									},
								})
							}
							className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 shadow-inner ${
								data.handoffTriggers?.[key as keyof typeof data.handoffTriggers]
									? 'bg-rose-500'
									: 'bg-gray-200'
							}`}
						>
							<span
								className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-300 ${
									data.handoffTriggers?.[
										key as keyof typeof data.handoffTriggers
									]
										? 'translate-x-5'
										: 'translate-x-1'
								}`}
							/>
						</button>
					</div>
				))}
			</div>

			{data.handoffTriggers?.keywordMatch && (
				<div className="grid gap-3">
					<label className="text-xs font-bold text-gray-700">
						Handoff Keywords
					</label>
					<textarea
						value={(data.keywords || []).join(', ')}
						onChange={(e) =>
							updateData({
								keywords: e.target.value
									.split(',')
									.map((s) => s.trim())
									.filter((s) => s),
							})
						}
						placeholder="talk to human, agent, representative, supervisor"
						rows={2}
						className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none"
					/>
					<p className="text-[10px] text-gray-500">
						Comma-separated keywords that trigger handoff
					</p>
				</div>
			)}

			<div className="space-y-3">
				<h3 className="text-sm font-black uppercase tracking-widest text-gray-400">
					Escalation Settings
				</h3>

				<div className="grid gap-3">
					<label className="text-xs font-bold text-gray-700">
						Priority Level
					</label>
					<select
						value={data.escalationPriority || 'medium'}
						onChange={(e) =>
							updateData({ escalationPriority: e.target.value as any })
						}
						className="h-10 px-3 rounded-xl border border-gray-200 text-sm bg-white"
					>
						<option value="low">Low</option>
						<option value="medium">Medium</option>
						<option value="high">High</option>
					</select>
				</div>

				<div className="flex items-center justify-between p-3 bg-slate-50 rounded-xl">
					<div>
						<p className="text-sm font-bold text-gray-900">
							Assign to Supervisor
						</p>
						<p className="text-[10px] text-gray-500">
							Route handoff to supervisor instead of random agent
						</p>
					</div>
					<button
						onClick={() =>
							updateData({ assignToSupervisor: !data.assignToSupervisor })
						}
						className={`relative inline-flex h-5 w-9 items-center rounded-full transition-all duration-300 shadow-inner ${
							data.assignToSupervisor ? 'bg-rose-500' : 'bg-gray-200'
						}`}
					>
						<span
							className={`inline-block h-3 w-3 transform rounded-full bg-white shadow-sm transition-transform duration-300 ${
								data.assignToSupervisor ? 'translate-x-5' : 'translate-x-1'
							}`}
						/>
					</button>
				</div>

				<div className="grid gap-3">
					<label className="text-xs font-bold text-gray-700">
						Handoff Message
					</label>
					<textarea
						value={data.handoffMessage || ''}
						onChange={(e) => updateData({ handoffMessage: e.target.value })}
						placeholder="Connecting you to a human agent..."
						rows={2}
						className="w-full px-3 py-2 rounded-xl border border-gray-200 text-sm resize-none"
					/>
				</div>
			</div>
		</div>
	)
}
