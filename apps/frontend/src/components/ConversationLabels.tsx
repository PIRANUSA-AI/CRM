import { useState, useEffect, useRef } from 'react'
import { Tag as LabelIcon, Plus, X, Loader2, Search, Check } from 'lucide-react'
import {
	conversations as conversationsApi,
	labels as labelsApi,
} from '@/lib/api'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Dialog,
	DialogContent,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { SketchPicker } from 'react-color'

interface Label {
	id: string
	name: string
	color: string
}

interface ConversationLabelsProps {
	conversationId: string
	compact?: boolean
}

export function ConversationLabels({
	conversationId,
	compact = false,
}: ConversationLabelsProps) {
	const [assignedLabels, setAssignedLabels] = useState<Label[]>([])
	const [allAvailableLabels, setAllAvailableLabels] = useState<Label[]>([])
	const [loading, setLoading] = useState(false)
	const [showPicker, setShowPicker] = useState(false)
	const [isAdding, setIsAdding] = useState(false)
	const [searchQuery, setSearchQuery] = useState('')

	// New Label Modal State
	const [showCreateModal, setShowCreateModal] = useState(false)
	const [newLabelName, setNewLabelName] = useState('')
	const [newLabelColor, setNewLabelColor] = useState('#1F2937')
	const [showColorPicker, setShowColorPicker] = useState(false)
	const [saving, setSaving] = useState(false)

	const pickerRef = useRef<HTMLDivElement>(null)

	useEffect(() => {
		loadAssignedLabels()
		loadAllLabels()
	}, [conversationId])

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				pickerRef.current &&
				!pickerRef.current.contains(event.target as Node)
			) {
				setShowPicker(false)
			}
		}
		document.addEventListener('mousedown', handleClickOutside)
		return () => document.removeEventListener('mousedown', handleClickOutside)
	}, [])

	const loadAssignedLabels = async () => {
		setLoading(true)
		try {
			const data: any = await conversationsApi.getLabels(conversationId)
			if (data.success) {
				const labels = (data.payload || []).map((l: any) => ({
					id: l.id,
					name: l.title || l.name,
					color: l.color,
				}))
				setAssignedLabels(labels)
			}
		} catch (e) {
			console.error('Failed to load assigned labels:', e)
		} finally {
			setLoading(false)
		}
	}

	const loadAllLabels = async () => {
		try {
			const data: any = await labelsApi.list()
			const rawLabels = data.data?.labels || data.payload || []
			const labelsList = rawLabels.map((l: any) => ({
				id: l.id,
				name: l.name || l.title || 'Untitled',
				color: l.color || '#000000',
			}))
			setAllAvailableLabels(labelsList)
		} catch (e) {
			console.error('Failed to load all labels:', e)
		}
	}

	const handleAddLabel = async (label: Label) => {
		if (assignedLabels.some((t) => t.id === label.id)) return

		setIsAdding(true)
		try {
			const data: any = await conversationsApi.addLabel(
				conversationId,
				label.id,
			)
			if (data.success) {
				setAssignedLabels([...assignedLabels, label])
				setShowPicker(false)
			}
		} catch (e) {
			alert('Failed to add label')
		} finally {
			setIsAdding(false)
		}
	}

	const handleRemoveLabel = async (labelId: string) => {
		try {
			const data: any = await conversationsApi.removeLabel(
				conversationId,
				labelId,
			)
			if (data.success) {
				setAssignedLabels(assignedLabels.filter((t) => t.id !== labelId))
			}
		} catch (e) {
			alert('Failed to remove label')
		}
	}

	const handleCreateLabel = async () => {
		if (!newLabelName.trim()) return
		setSaving(true)
		try {
			const data: any = await labelsApi.create({
				name: newLabelName,
				color: newLabelColor,
			})
			if (data.success) {
				const newLabel = {
					id: data.data.id,
					name: data.data.name,
					color: data.data.color,
				}
				setAllAvailableLabels([newLabel, ...allAvailableLabels])
				await handleAddLabel(newLabel)
				setShowCreateModal(false)
				setNewLabelName('')
				setShowPicker(false)
			}
		} catch (e) {
			alert('Failed to create label')
		} finally {
			setSaving(false)
		}
	}

	const filteredLabels = allAvailableLabels
		.filter((label) => !assignedLabels.some((t) => t.id === label.id))
		.filter((label) =>
			label.name.toLowerCase().includes(searchQuery.toLowerCase()),
		)

	return (
		<div
			className={`${compact ? 'p-4' : 'p-6'} border-t border-gray-100 relative`}
		>
			<div
				className={`flex items-center justify-between ${compact ? 'mb-3' : 'mb-4'}`}
			>
				<div className="flex items-center gap-2">
					<LabelIcon className="w-4 h-4 text-emerald-600" />
					<h5 className="text-sm font-semibold text-gray-900">Labels</h5>
				</div>

				<div className="relative">
					<Button
						onClick={() => setShowPicker(!showPicker)}
						variant="outline"
						size="sm"
						className="h-8 border-blue-500 text-blue-600 hover:bg-blue-50 hover:text-blue-700 font-bold px-3 transition-all rounded-lg"
					>
						<LabelIcon size={14} className="mr-1.5" />
						Add Label
					</Button>

					{showPicker && (
						<div
							ref={pickerRef}
							className="absolute right-0 top-full mt-2 w-72 bg-white rounded-xl shadow-2xl border border-gray-100 z-[100] overflow-hidden animate-in fade-in zoom-in-95 duration-150"
						>
							<div className="p-3 border-b border-gray-50">
								<div className="relative">
									<Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
									<Input
										autoFocus
										placeholder="Search labels"
										value={searchQuery}
										onChange={(e) => setSearchQuery(e.target.value)}
										className="h-10 pl-9 pr-3 rounded-lg border-gray-100 bg-gray-50/50 text-sm focus:ring-blue-500"
									/>
								</div>
							</div>

							<div className="max-h-[300px] overflow-y-auto p-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
								{filteredLabels.length === 0 ? (
									<div className="py-8 text-center px-4">
										<div className="w-10 h-10 rounded-full bg-gray-50 flex items-center justify-center mx-auto mb-2 text-gray-300">
											<LabelIcon size={16} />
										</div>
										<p className="text-xs text-gray-400 font-medium whitespace-pre-wrap">
											{searchQuery
												? `No label matching "${searchQuery}"`
												: 'No more labels available'}
										</p>
									</div>
								) : (
									filteredLabels.map((label) => (
										<button
											key={label.id}
											onClick={() => handleAddLabel(label)}
											disabled={isAdding}
											className="w-full flex items-center gap-3 px-3 py-2.5 hover:bg-gray-50 transition-colors text-left group disabled:opacity-50"
										>
											<div
												className="w-5 h-5 rounded-full shrink-0 shadow-sm"
												style={{ backgroundColor: label.color }}
											/>
											<span className="flex-1 text-sm font-bold text-gray-700 group-hover:text-gray-900 truncate">
												{label.name}
											</span>
											{isAdding && (
												<Loader2
													size={12}
													className="animate-spin text-gray-300"
												/>
											)}
										</button>
									))
								)}
							</div>

							<div className="p-2 border-t border-gray-50 bg-gray-50/30">
								<button
									onClick={() => {
										setShowCreateModal(true)
										setShowPicker(false)
									}}
									className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-white hover:shadow-sm transition-all text-left group"
								>
									<div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center text-blue-600 transition-colors group-hover:bg-blue-600 group-hover:text-white">
										<Plus size={16} />
									</div>
									<span className="text-sm font-bold text-gray-700 group-hover:text-blue-600">
										Create New Label
									</span>
								</button>
							</div>
						</div>
					)}
				</div>
			</div>

				<div className={`flex flex-wrap gap-2 ${compact ? 'min-h-[26px]' : 'min-h-[32px]'}`}>
				{loading ? (
					<div className="flex items-center py-2">
						<Loader2 className="w-4 h-4 animate-spin text-gray-300" />
					</div>
				) : assignedLabels.length === 0 ? (
					<p className="text-xs text-gray-400 italic py-2 font-medium">
						No labels assigned yet.
					</p>
				) : (
						assignedLabels.map((tag) => (
							<div
								key={tag.id}
								className={`flex items-center gap-1.5 ${compact ? 'px-2.5 py-1 text-[10px]' : 'px-3 py-1.5 text-[11px]'} rounded-full font-bold transition-all hover:shadow-md hover:scale-105`}
								style={{
									backgroundColor: `${tag.color}15`,
								color: tag.color,
								border: `1px solid ${tag.color}30`,
							}}
						>
							<div
								className="w-2 h-2 rounded-full"
								style={{ backgroundColor: tag.color }}
							/>
							{tag.name}
							<button
								onClick={() => handleRemoveLabel(tag.id)}
								className="ml-1 hover:bg-black/10 rounded-full p-0.5 transition-colors"
							>
								<X className="w-2.5 h-2.5" />
							</button>
						</div>
					))
				)}
			</div>

			{/* Create New Label Modal */}
			<Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
				<DialogContent className="max-w-md p-0">
					<DialogHeader className="px-6 py-4 border-b border-gray-100">
						<DialogTitle className="text-xl font-bold">
							Create New Label
						</DialogTitle>
					</DialogHeader>

					<div className="p-6 space-y-6">
						<div className="space-y-2">
							<label className="text-sm font-bold text-gray-700">
								Label Name
							</label>
							<Input
								value={newLabelName}
								onChange={(e) => setNewLabelName(e.target.value)}
								placeholder="e.g., VIP Customer"
								className="h-12 rounded-xl border-gray-200"
							/>
						</div>

						<div className="space-y-4">
							<label className="text-sm font-bold text-gray-700 block">
								Color
							</label>
							<div className="flex items-center gap-4">
								<button
									type="button"
									onClick={() => setShowColorPicker(!showColorPicker)}
									className="w-16 h-16 rounded-2xl border-2 border-gray-100 shadow-sm"
									style={{ backgroundColor: newLabelColor }}
								/>
								<div className="flex-1 flex flex-wrap gap-2">
									{[
										'#000000',
										'#d0021b',
										'#0047FF',
										'#00FF19',
										'#FBFF49',
										'#9013fe',
										'#f5a623',
									].map((c) => (
										<button
											key={c}
											onClick={() => setNewLabelColor(c)}
											className={`w-8 h-8 rounded-full border-2 ${newLabelColor === c ? 'border-gray-900 scale-110' : 'border-white'} transition-all shadow-sm`}
											style={{ backgroundColor: c }}
										/>
									))}
								</div>
							</div>

							{showColorPicker && (
								<div className="absolute z-[200] mt-2 shadow-2xl">
									<div
										className="fixed inset-0"
										onClick={() => setShowColorPicker(false)}
									/>
									<SketchPicker
										color={newLabelColor}
										onChange={(color) => setNewLabelColor(color.hex)}
										disableAlpha={true}
									/>
								</div>
							)}
						</div>
					</div>

						<div className="px-6 py-4 bg-gray-50 border-t border-gray-100 flex flex-col-reverse sm:flex-row sm:justify-end gap-3">
							<Button
								variant="outline"
								onClick={() => setShowCreateModal(false)}
								className="h-11 px-6 rounded-xl font-bold border-gray-200 text-gray-500"
							>
								Cancel
							</Button>
							<Button
								onClick={handleCreateLabel}
								disabled={saving || !newLabelName.trim()}
								className="h-11 px-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold"
							>
								{saving ? (
									<Loader2 size={16} className="animate-spin mr-2" />
								) : (
									<Check size={16} className="mr-2" />
								)}
								Create Label
							</Button>
						</div>
					</DialogContent>
				</Dialog>
			</div>
		)
}
