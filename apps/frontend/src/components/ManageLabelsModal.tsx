import { useState, useEffect } from 'react'
import { X, Tag, Plus, Loader2, Check } from 'lucide-react'
import {
	labels as labelsApi,
	conversations as conversationsApi,
} from '@/lib/api'

interface Label {
	id: string
	title: string
	color: string
}

interface ManageLabelsModalProps {
	conversationId: string
	onClose: () => void
}

export function ManageLabelsModal({
	conversationId,
	onClose,
}: ManageLabelsModalProps) {
	const [labels, setLabels] = useState<Label[]>([])
	const [selectedLabelIds, setSelectedLabelIds] = useState<Set<string>>(
		new Set(),
	)
	const [isLoading, setIsLoading] = useState(true)
	const [isSaving, setIsSaving] = useState(false)

	// New label state
	const [isCreating, setIsCreating] = useState(false)
	const [newLabelTitle, setNewLabelTitle] = useState('')
	const [newLabelColor, setNewLabelColor] = useState('#3B82F6') // Default Blue

	useEffect(() => {
		loadData()
	}, [conversationId])

	const loadData = async () => {
		setIsLoading(true)
		try {
			// Load all available labels
			const labelsRes: any = await labelsApi.list()
			if (labelsRes.success) {
				setLabels(labelsRes.payload || [])
			}

			// Load conversation labels
			const convLabelsRes: any =
				await conversationsApi.getLabels(conversationId)
			if (convLabelsRes.success) {
				const ids = new Set(
					(convLabelsRes.payload || []).map((l: Label) => l.id),
				)
				setSelectedLabelIds(ids as Set<string>)
			}
		} catch (error) {
			console.error('Failed to load labels:', error)
		} finally {
			setIsLoading(false)
		}
	}

	const toggleLabel = async (label: Label) => {
		if (isSaving) return
		setIsSaving(true)

		const isSelected = selectedLabelIds.has(label.id)

		try {
			if (isSelected) {
				await conversationsApi.removeLabel(conversationId, label.id)
				selectedLabelIds.delete(label.id)
			} else {
				await conversationsApi.addLabel(conversationId, label.id)
				selectedLabelIds.add(label.id)
			}
			setSelectedLabelIds(new Set(selectedLabelIds))
		} catch (error) {
			console.error('Failed to toggle label:', error)
		} finally {
			setIsSaving(false)
		}
	}

	// Basic colors for new labels
	const colors = [
		'#EF4444', // Red
		'#F97316', // Orange
		'#EAB308', // Yellow
		'#22C55E', // Green
		'#3B82F6', // Blue
		'#8B5CF6', // Purple
		'#EC4899', // Pink
		'#6B7280', // Gray
	]

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200 flex flex-col max-h-[85vh]">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between flex-shrink-0">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
							<Tag className="w-5 h-5 text-indigo-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">Manage Labels</h3>
							<p className="text-xs text-gray-500">
								Organize this conversation
							</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
					>
						<X className="w-5 h-5 text-gray-400" />
					</button>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					{isLoading ? (
						<div className="flex justify-center py-8">
							<Loader2 className="w-8 h-8 text-indigo-500 animate-spin" />
						</div>
					) : (
						<div className="space-y-4">
							{/* Labels List */}
							<div className="space-y-2">
								{labels.length === 0 && !isCreating ? (
									<p className="text-center text-sm text-gray-500 py-4">
										No labels found. Create one to get started!
									</p>
								) : (
									labels.map((label) => {
										const isSelected = selectedLabelIds.has(label.id)
										return (
											<button
												key={label.id}
												onClick={() => toggleLabel(label)}
												disabled={isSaving}
												className={`w-full flex items-center justify-between p-3 rounded-lg border transition-all ${
													isSelected
														? 'bg-indigo-50 border-indigo-200'
														: 'bg-white border-gray-200 hover:border-indigo-200 hover:shadow-sm'
												}`}
											>
												<div className="flex items-center gap-3">
													<div
														className="w-4 h-4 rounded-full"
														style={{ backgroundColor: label.color }}
													/>
													<span
														className={`text-sm font-medium ${isSelected ? 'text-indigo-900' : 'text-gray-700'}`}
													>
														{label.title}
													</span>
												</div>
												{isSelected && (
													<Check className="w-4 h-4 text-indigo-600" />
												)}
											</button>
										)
									})
								)}
							</div>

							{/* Create New Label Button (Placeholder for now, simplified) */}
							{/* In a real implementation, we would add label creation UI here */}
						</div>
					)}
				</div>

				{/* Footer */}
				<div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex-shrink-0">
					<button
						onClick={onClose}
						className="w-full px-4 py-2.5 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors font-medium"
					>
						Done
					</button>
				</div>
			</div>
		</div>
	)
}
