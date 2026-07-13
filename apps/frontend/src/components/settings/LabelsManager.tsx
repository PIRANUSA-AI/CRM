import { useState, useEffect } from 'react'
import {
	Plus,
	Edit2,
	Trash2,
	Tag,
	Loader2,
	X,
	Check,
	Palette,
} from 'lucide-react'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from '@/components/ui/dialog'
import { SketchPicker } from 'react-color'

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3010'

interface Label {
	id: string
	name: string
	description?: string
	color: string
	created_at: string
	business_id: string
}

interface LabelFormData {
	name: string
	color: string
	description: string
}

export default function LabelsManager() {
	const [labels, setLabels] = useState<Label[]>([])
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [editingLabel, setEditingLabel] = useState<Label | null>(null)
	const [showForm, setShowForm] = useState(false)
	const [showDeleteConfirm, setShowDeleteConfirm] = useState(false)
	const [labelToDelete, setLabelToDelete] = useState<Label | null>(null)
	const [showColorPicker, setShowColorPicker] = useState(false)
	const [formData, setFormData] = useState<LabelFormData>({
		name: '',
		color: '#1F2937',
		description: '',
	})

	// Fixed: Using 'scalechat_token' instead of 'token'
	const token = localStorage.getItem('scalechat_token')

	useEffect(() => {
		loadLabels()
	}, [])

	const loadLabels = async () => {
		try {
			setLoading(true)
			const res = await fetch(`${API_BASE}/api/labels`, {
				headers: { Authorization: `Bearer ${token}` },
			})
			const data = await res.json()
			if (data.success && data.data?.labels) {
				setLabels(data.data.labels)
			}
		} catch (error) {
			console.error('Failed to load labels:', error)
		} finally {
			setLoading(false)
		}
	}

	const handleSubmit = async (e?: React.FormEvent) => {
		e?.preventDefault()
		if (!formData.name.trim()) return

		setSaving(true)
		try {
			const url = editingLabel
				? `${API_BASE}/api/labels/${editingLabel.id}`
				: `${API_BASE}/api/labels`
			const method = editingLabel ? 'PUT' : 'POST'

			const res = await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify(formData),
			})

			const data = await res.json()
			if (data.success) {
				loadLabels()
				resetForm()
			} else {
				alert(data.error || 'Failed to save label')
			}
		} catch (error) {
			console.error('Failed to save label:', error)
			alert('Failed to save label')
		} finally {
			setSaving(false)
		}
	}

	const handleDeleteClick = (label: Label) => {
		setLabelToDelete(label)
		setShowDeleteConfirm(true)
	}

	const confirmDelete = async () => {
		if (!labelToDelete) return

		setSaving(true)
		try {
			const res = await fetch(`${API_BASE}/api/labels/${labelToDelete.id}`, {
				method: 'DELETE',
				headers: { Authorization: `Bearer ${token}` },
			})

			const data = await res.json()
			if (data.success) {
				loadLabels()
				setShowDeleteConfirm(false)
				setLabelToDelete(null)
			} else {
				alert(data.error || 'Failed to delete label')
			}
		} catch (error) {
			console.error('Failed to delete label:', error)
			alert('Failed to delete label')
		} finally {
			setSaving(false)
		}
	}

	const handleEdit = (label: Label) => {
		setEditingLabel(label)
		setFormData({
			name: label.name,
			color: label.color || '#1F2937',
			description: label.description || '',
		})
		setShowForm(true)
	}

	const resetForm = () => {
		setEditingLabel(null)
		setFormData({ name: '', color: '#1F2937', description: '' })
		setShowForm(false)
		setShowColorPicker(false)
	}

	const colorPresets = [
		'#d0021b',
		'#f5a623',
		'#f8e71c',
		'#7ed321',
		'#4a90d9',
		'#9013fe',
		'#bd10e0',
		'#50e3c2',
		'#000000',
		'#1F2937',
	]

	return (
		<div className="space-y-6 h-full">
			<Card className="border-gray-100 shadow-sm overflow-hidden flex flex-col h-[650px]">
				<CardHeader className="bg-gray-50/50 border-b border-gray-100 px-6 py-4 shrink-0">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<Tag size={20} className="text-emerald-600" />
							<CardTitle className="text-lg font-bold">Labels</CardTitle>
						</div>
						<Button
							onClick={() => {
								setEditingLabel(null)
								setFormData({ name: '', color: '#1F2937', description: '' })
								setShowForm(true)
							}}
							className="bg-emerald-500 hover:bg-emerald-600 text-white font-bold h-9 px-4"
						>
							<Plus size={16} className="mr-1" />
							Add Label
						</Button>
					</div>
					<CardDescription>
						Manage labels to organize and categorize conversations
					</CardDescription>
				</CardHeader>
				<CardContent className="p-0 overflow-y-auto flex-1 scrollbar-thin scrollbar-thumb-gray-200 scrollbar-track-transparent">
					{loading ? (
						<div className="flex items-center justify-center py-24">
							<Loader2 size={32} className="animate-spin text-gray-300" />
						</div>
					) : labels.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-24 text-center">
							<Tag size={64} className="text-gray-100 mb-6" />
							<h4 className="font-bold text-gray-900 text-xl">No Labels Yet</h4>
							<p className="text-sm text-gray-500 max-w-xs mt-2 font-medium">
								Create labels to organize your conversations and enable AI
								auto-labeling.
							</p>
							<Button
								onClick={() => setShowForm(true)}
								variant="outline"
								className="mt-8 font-bold border-emerald-200 text-emerald-700 hover:bg-emerald-50"
							>
								<Plus size={16} className="mr-2" />
								Create First Label
							</Button>
						</div>
					) : (
						<div className="bg-white">
							<table className="w-full text-left border-collapse table-fixed">
								<thead className="sticky top-0 z-10 bg-gray-50/95 backdrop-blur-sm border-b border-gray-100 shadow-sm">
									<tr>
										<th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 w-[240px]">
											Label
										</th>
										<th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400">
											Description
										</th>
										<th className="px-6 py-4 text-[10px] font-black uppercase tracking-widest text-gray-400 text-right w-[100px]">
											Actions
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-gray-100">
									{labels.map((label) => (
										<tr
											key={label.id}
											className="hover:bg-gray-50/50 transition-colors group"
										>
											<td className="px-6 py-5">
												<div className="flex items-center gap-3">
													<div
														className="w-9 h-9 rounded-xl flex items-center justify-center text-white shrink-0 shadow-sm border border-black/5"
														style={{
															backgroundColor: label.color || '#1F2937',
														}}
													>
														<Tag size={16} />
													</div>
													<div className="min-w-0">
														<p className="font-bold text-gray-900 truncate">
															{label.name}
														</p>
														<p className="text-[10px] text-gray-400 font-mono mt-0.5 uppercase tracking-wider">
															{label.color}
														</p>
													</div>
												</div>
											</td>
											<td className="px-6 py-5">
												<p className="text-sm text-gray-500 line-clamp-2 max-w-md font-medium">
													{label.description || (
														<span className="text-gray-300 italic font-normal">
															No description
														</span>
													)}
												</p>
											</td>
											<td className="px-6 py-5 text-right">
												<div className="flex items-center justify-end gap-1">
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleEdit(label)}
														className="h-8 w-8 p-0 text-gray-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-all"
													>
														<Edit2 size={14} />
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => handleDeleteClick(label)}
														className="h-8 w-8 p-0 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-all"
													>
														<Trash2 size={14} />
													</Button>
												</div>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					)}
				</CardContent>
			</Card>

			{/* Edit/Add Modal */}
			<Dialog open={showForm} onOpenChange={setShowForm}>
				<DialogContent className="max-w-md p-0 overflow-visible">
					<DialogHeader className="px-6 py-4 border-b border-gray-100">
						<DialogTitle className="text-xl font-bold">
							{editingLabel ? 'Edit Label' : 'New Label'}
						</DialogTitle>
					</DialogHeader>

					<div className="p-6 space-y-6">
						<div className="space-y-2">
							<label className="text-sm font-bold text-gray-700">Name</label>
							<Input
								value={formData.name}
								onChange={(e) =>
									setFormData({ ...formData, name: e.target.value })
								}
								placeholder="e.g., HOT Leads"
								className="h-12 rounded-xl border-gray-200 focus:ring-emerald-500"
							/>
						</div>

						<div className="space-y-4">
							<label className="text-sm font-bold text-gray-700 block">
								Label Color
							</label>
							<div className="flex items-start gap-4">
								<button
									type="button"
									onClick={() => setShowColorPicker(!showColorPicker)}
									className="p-1 border border-gray-200 rounded-xl shadow-sm hover:border-emerald-300 transition-colors overflow-hidden group"
								>
									<div
										className="w-16 h-16 rounded-lg flex items-center justify-center"
										style={{ backgroundColor: formData.color }}
									>
										<Palette className="w-6 h-6 text-white opacity-0 group-hover:opacity-50 transition-opacity" />
									</div>
								</button>

								<div className="flex-1 space-y-3">
									<div className="flex gap-2 flex-wrap">
										{[
											'#d0021b',
											'#f5a623',
											'#f8e71c',
											'#7ed321',
											'#4a90d9',
											'#9013fe',
											'#4ade80',
											'#fbbf24',
											'#f87171',
											'#60a5fa',
										].map((c) => (
											<button
												key={c}
												type="button"
												onClick={() => setFormData({ ...formData, color: c })}
												className={`w-8 h-8 rounded-full border-2 transition-all ${formData.color === c ? 'border-gray-900 scale-110 shadow-md' : 'border-white hover:scale-110'}`}
												style={{ backgroundColor: c }}
											/>
										))}
									</div>
									<div className="flex items-center gap-2">
										<Input
											value={formData.color}
											onChange={(e) =>
												setFormData({ ...formData, color: e.target.value })
											}
											className="h-10 rounded-lg border-gray-200 font-mono text-xs uppercase"
											placeholder="#HEXCODE"
										/>
									</div>
								</div>
							</div>

							{showColorPicker && (
								<div className="absolute z-[10001] mt-2 shadow-2xl animate-in fade-in slide-in-from-top-2 duration-200">
									<div
										className="fixed inset-0"
										onClick={() => setShowColorPicker(false)}
									/>
									<SketchPicker
										color={formData.color}
										onChange={(color) =>
											setFormData({ ...formData, color: color.hex })
										}
										disableAlpha={true}
									/>
								</div>
							)}
						</div>

						<div className="space-y-2">
							<label className="text-sm font-bold text-gray-700">
								Description
							</label>
							<Input
								value={formData.description}
								onChange={(e) =>
									setFormData({ ...formData, description: e.target.value })
								}
								placeholder="Describe what this label is for..."
								className="h-12 rounded-xl border-gray-200"
							/>
						</div>
					</div>

					<DialogFooter className="px-6 py-4 bg-gray-50 border-t border-gray-100 gap-3">
						<Button
							variant="outline"
							onClick={() => setShowForm(false)}
							className="h-11 px-6 rounded-xl font-bold border-red-200 text-red-600 hover:bg-red-50 hover:text-red-700 transition-all hover:scale-105"
						>
							Cancel
						</Button>
						<Button
							onClick={() => handleSubmit()}
							disabled={saving}
							className="h-11 px-8 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-bold shadow-lg shadow-blue-200 transition-all hover:scale-105 active:scale-95"
						>
							{saving ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : null}
							{editingLabel ? 'Update' : 'Create'}
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>

			{/* Delete Confirmation Modal */}
			<Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
				<DialogContent className="max-w-md p-0">
					<DialogHeader className="px-6 py-6 border-b border-gray-100 flex flex-col items-center text-center">
						<div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-4">
							<Trash2 className="w-6 h-6 text-red-500" />
						</div>
						<DialogTitle className="text-xl font-bold text-gray-900">
							Delete Label
						</DialogTitle>
						<DialogDescription className="mt-2 text-gray-500">
							Are you sure you want to delete the label{' '}
							<span className="font-bold text-gray-900">
								"{labelToDelete?.name}"
							</span>
							? This action cannot be undone and will remove the label from all
							conversations.
						</DialogDescription>
					</DialogHeader>
					<DialogFooter className="px-6 py-4 bg-gray-50 flex gap-3 sm:space-x-0">
						<Button
							variant="outline"
							onClick={() => setShowDeleteConfirm(false)}
							className="flex-1 h-11 rounded-xl font-bold border-gray-200 text-gray-600 hover:bg-white"
						>
							Cancel
						</Button>
						<Button
							onClick={confirmDelete}
							disabled={saving}
							className="flex-1 h-11 rounded-xl bg-red-500 hover:bg-red-600 text-white font-bold shadow-lg shadow-red-100"
						>
							{saving ? (
								<Loader2 className="w-4 h-4 animate-spin mr-2" />
							) : null}
							Yes, Delete
						</Button>
					</DialogFooter>
				</DialogContent>
			</Dialog>
		</div>
	)
}
