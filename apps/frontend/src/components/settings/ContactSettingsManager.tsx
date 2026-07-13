import { useEffect, useMemo, useState } from 'react'
import {
	ChevronDown,
	ChevronUp,
	Circle,
	Edit2,
	Plus,
	Save,
	Tag,
	Trash2,
	Users,
} from 'lucide-react'
import { contacts } from '@/lib/api'
import { toast } from 'sonner'

type ContactStage = {
	id: string
	name: string
	color: string
	stageOrder: number
	isDefault: boolean
}

type ContactField = {
	id: string
	fieldKey: string
	fieldLabel: string
	fieldType: string
	options: unknown[]
	isRequired: boolean
	isVisible: boolean
	displayOrder: number
}

type ContactSettingsPayload = {
	stages: {
		pipelineId: string
		defaultStageId: string | null
		stages: ContactStage[]
	}
	fields: ContactField[]
}

function normalizeOptions(value: string): string[] {
	return value
		.split(',')
		.map((part) => part.trim())
		.filter(Boolean)
}

export default function ContactSettingsManager() {
	const [loading, setLoading] = useState(true)
	const [saving, setSaving] = useState(false)
	const [stages, setStages] = useState<ContactStage[]>([])
	const [fields, setFields] = useState<ContactField[]>([])
	const [selectedPreviewStageId, setSelectedPreviewStageId] = useState<string>('')

	const [showAddStage, setShowAddStage] = useState(false)
	const [newStageName, setNewStageName] = useState('')
	const [newStageColor, setNewStageColor] = useState('#3B82F6')

	const [editingStageId, setEditingStageId] = useState<string | null>(null)
	const [editingStageName, setEditingStageName] = useState('')
	const [editingStageColor, setEditingStageColor] = useState('#3B82F6')

	const [showAddField, setShowAddField] = useState(false)
	const [newFieldLabel, setNewFieldLabel] = useState('')
	const [newFieldType, setNewFieldType] = useState('text')
	const [newFieldOptions, setNewFieldOptions] = useState('')
	const [newFieldRequired, setNewFieldRequired] = useState(false)
	const [newFieldVisible, setNewFieldVisible] = useState(true)

	const [editingFieldId, setEditingFieldId] = useState<string | null>(null)
	const [editingFieldLabel, setEditingFieldLabel] = useState('')
	const [editingFieldType, setEditingFieldType] = useState('text')
	const [editingFieldOptions, setEditingFieldOptions] = useState('')
	const [editingFieldRequired, setEditingFieldRequired] = useState(false)
	const [editingFieldVisible, setEditingFieldVisible] = useState(true)

	const selectedPreviewStage = useMemo(
		() => stages.find((stage) => stage.id === selectedPreviewStageId) || null,
		[stages, selectedPreviewStageId],
	)

	const loadSettings = async () => {
		setLoading(true)
		try {
			const res: any = await contacts.settings.get()
			const payload: ContactSettingsPayload =
				res?.payload || res?.data || res || { stages: { stages: [] }, fields: [] }
			const loadedStages = Array.isArray(payload?.stages?.stages)
				? payload.stages.stages
				: []
			const loadedFields = Array.isArray(payload?.fields) ? payload.fields : []
			setStages(loadedStages)
			setFields(loadedFields)
			setSelectedPreviewStageId(
				payload?.stages?.defaultStageId || loadedStages[0]?.id || '',
			)
		} catch (error) {
			console.error('Failed to load contact settings:', error)
			toast.error('Failed to load contact settings')
		} finally {
			setLoading(false)
		}
	}

	useEffect(() => {
		loadSettings()
	}, [])

	const submitCreateStage = async () => {
		if (!newStageName.trim()) {
			toast.error('Stage name is required')
			return
		}
		setSaving(true)
		try {
			const res: any = await contacts.settings.createStage({
				name: newStageName.trim(),
				color: newStageColor,
			})
			const payload = res?.payload || {}
			setStages(payload?.stages || [])
			setSelectedPreviewStageId((prev) => prev || payload?.defaultStageId || '')
			setNewStageName('')
			setNewStageColor('#3B82F6')
			setShowAddStage(false)
			toast.success('Stage added')
		} catch (error) {
			console.error('Failed to create stage:', error)
			toast.error('Failed to create stage')
		} finally {
			setSaving(false)
		}
	}

	const submitUpdateStage = async () => {
		if (!editingStageId || !editingStageName.trim()) {
			toast.error('Stage name is required')
			return
		}
		setSaving(true)
		try {
			const res: any = await contacts.settings.updateStage(editingStageId, {
				name: editingStageName.trim(),
				color: editingStageColor,
			})
			const payload = res?.payload || {}
			setStages(payload?.stages || [])
			setEditingStageId(null)
			setEditingStageName('')
			setEditingStageColor('#3B82F6')
			toast.success('Stage updated')
		} catch (error) {
			console.error('Failed to update stage:', error)
			toast.error('Failed to update stage')
		} finally {
			setSaving(false)
		}
	}

	const setDefaultStage = async (stageId: string) => {
		setSaving(true)
		try {
			const res: any = await contacts.settings.updateStage(stageId, {
				isDefault: true,
			})
			const payload = res?.payload || {}
			setStages(payload?.stages || [])
			setSelectedPreviewStageId(stageId)
			toast.success('Default stage updated')
		} catch (error) {
			console.error('Failed to set default stage:', error)
			toast.error('Failed to set default stage')
		} finally {
			setSaving(false)
		}
	}

	const removeStage = async (stageId: string) => {
		if (!confirm('Delete this stage?')) return
		setSaving(true)
		try {
			const res: any = await contacts.settings.deleteStage(stageId)
			const payload = res?.payload || {}
			const nextStages = payload?.stages || []
			setStages(nextStages)
			if (!nextStages.find((stage: ContactStage) => stage.id === selectedPreviewStageId)) {
				setSelectedPreviewStageId(payload?.defaultStageId || nextStages[0]?.id || '')
			}
			toast.success('Stage deleted')
		} catch (error: any) {
			console.error('Failed to delete stage:', error)
			toast.error(error?.message || 'Failed to delete stage')
		} finally {
			setSaving(false)
		}
	}

	const moveStage = async (index: number, direction: -1 | 1) => {
		const target = index + direction
		if (target < 0 || target >= stages.length) return
		const reordered = [...stages]
		const current = reordered[index]
		reordered[index] = reordered[target]
		reordered[target] = current
		setStages(reordered)
		try {
			await contacts.settings.reorderStages(reordered.map((stage) => stage.id))
		} catch (error) {
			console.error('Failed to reorder stages:', error)
			toast.error('Failed to reorder stages')
			loadSettings()
		}
	}

	const submitCreateField = async () => {
		if (!newFieldLabel.trim()) {
			toast.error('Field label is required')
			return
		}
		setSaving(true)
		try {
			const res: any = await contacts.settings.createField({
				fieldLabel: newFieldLabel.trim(),
				fieldType: newFieldType,
				options: newFieldType === 'dropdown' ? normalizeOptions(newFieldOptions) : [],
				isRequired: newFieldRequired,
				isVisible: newFieldVisible,
			})
			setFields(res?.payload || [])
			setNewFieldLabel('')
			setNewFieldType('text')
			setNewFieldOptions('')
			setNewFieldRequired(false)
			setNewFieldVisible(true)
			setShowAddField(false)
			toast.success('Field added')
		} catch (error) {
			console.error('Failed to create field:', error)
			toast.error('Failed to create field')
		} finally {
			setSaving(false)
		}
	}

	const submitUpdateField = async () => {
		if (!editingFieldId || !editingFieldLabel.trim()) {
			toast.error('Field label is required')
			return
		}
		setSaving(true)
		try {
			const res: any = await contacts.settings.updateField(editingFieldId, {
				fieldLabel: editingFieldLabel.trim(),
				fieldType: editingFieldType,
				options:
					editingFieldType === 'dropdown'
						? normalizeOptions(editingFieldOptions)
						: [],
				isRequired: editingFieldRequired,
				isVisible: editingFieldVisible,
			})
			setFields(res?.payload || [])
			setEditingFieldId(null)
			setEditingFieldLabel('')
			setEditingFieldType('text')
			setEditingFieldOptions('')
			setEditingFieldRequired(false)
			setEditingFieldVisible(true)
			toast.success('Field updated')
		} catch (error) {
			console.error('Failed to update field:', error)
			toast.error('Failed to update field')
		} finally {
			setSaving(false)
		}
	}

	const removeField = async (fieldId: string) => {
		if (!confirm('Delete this field?')) return
		setSaving(true)
		try {
			const res: any = await contacts.settings.deleteField(fieldId)
			setFields(res?.payload || [])
			toast.success('Field deleted')
		} catch (error) {
			console.error('Failed to delete field:', error)
			toast.error('Failed to delete field')
		} finally {
			setSaving(false)
		}
	}

	const moveField = async (index: number, direction: -1 | 1) => {
		const target = index + direction
		if (target < 0 || target >= fields.length) return
		const reordered = [...fields]
		const current = reordered[index]
		reordered[index] = reordered[target]
		reordered[target] = current
		setFields(reordered)
		try {
			await contacts.settings.reorderFields(reordered.map((field) => field.id))
		} catch (error) {
			console.error('Failed to reorder fields:', error)
			toast.error('Failed to reorder fields')
			loadSettings()
		}
	}

	if (loading) {
		return (
			<div className="rounded-xl border border-gray-200 bg-white p-6 text-sm text-gray-500">
				Loading contact settings...
			</div>
		)
	}

	return (
		<div className="space-y-6">
			<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<div className="xl:col-span-2 rounded-xl border border-gray-200 bg-white p-5">
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-xl font-semibold text-gray-900">Stage Fields</h3>
						<button
							type="button"
							onClick={() => setShowAddStage((prev) => !prev)}
							className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
						>
							<Plus size={14} />
							Add Stage
						</button>
					</div>

					{showAddStage && (
						<div className="mb-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3 md:grid-cols-[1fr_160px_auto]">
							<input
								value={newStageName}
								onChange={(event) => setNewStageName(event.target.value)}
								className="h-10 rounded-md border border-gray-300 px-3 text-sm"
								placeholder="Stage name"
							/>
							<input
								value={newStageColor}
								onChange={(event) => setNewStageColor(event.target.value)}
								type="color"
								className="h-10 w-full rounded-md border border-gray-300 px-2"
							/>
							<button
								type="button"
								onClick={submitCreateStage}
								disabled={saving}
								className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
							>
								<Save size={14} />
								Save
							</button>
						</div>
					)}

					<div className="overflow-hidden rounded-lg border border-gray-200">
						<table className="w-full text-left text-sm">
							<thead className="bg-gray-50 text-xs uppercase text-gray-500">
								<tr>
									<th className="px-3 py-2">Stage Name</th>
									<th className="px-3 py-2">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 bg-white">
								{stages.map((stage, index) => (
									<tr key={stage.id}>
										<td className="px-3 py-2">
											{editingStageId === stage.id ? (
												<div className="grid gap-2 sm:grid-cols-[1fr_100px]">
													<input
														value={editingStageName}
														onChange={(event) =>
															setEditingStageName(event.target.value)
														}
														className="h-9 rounded-md border border-gray-300 px-2 text-sm"
													/>
													<input
														type="color"
														value={editingStageColor}
														onChange={(event) =>
															setEditingStageColor(event.target.value)
														}
														className="h-9 w-full rounded-md border border-gray-300 px-1"
													/>
												</div>
											) : (
												<div className="flex items-center gap-2">
													<Circle
														size={12}
														fill={stage.color}
														className="text-transparent"
													/>
													<span className="font-medium text-gray-800">
														{stage.name}
													</span>
													{stage.isDefault && (
														<span className="rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
															Default
														</span>
													)}
												</div>
											)}
										</td>
										<td className="px-3 py-2">
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => moveStage(index, -1)}
													className="rounded p-1 text-gray-500 hover:bg-gray-100"
													title="Move up"
												>
													<ChevronUp size={14} />
												</button>
												<button
													type="button"
													onClick={() => moveStage(index, 1)}
													className="rounded p-1 text-gray-500 hover:bg-gray-100"
													title="Move down"
												>
													<ChevronDown size={14} />
												</button>
												{editingStageId === stage.id ? (
													<button
														type="button"
														onClick={submitUpdateStage}
														className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
														title="Save"
													>
														<Save size={14} />
													</button>
												) : (
													<button
														type="button"
														onClick={() => {
															setEditingStageId(stage.id)
															setEditingStageName(stage.name)
															setEditingStageColor(stage.color)
														}}
														className="rounded p-1 text-gray-500 hover:bg-gray-100"
														title="Edit"
													>
														<Edit2 size={14} />
													</button>
												)}
												<button
													type="button"
													onClick={() => setDefaultStage(stage.id)}
													className="rounded px-2 py-1 text-xs font-medium text-blue-600 hover:bg-blue-50"
												>
													Default
												</button>
												<button
													type="button"
													onClick={() => removeStage(stage.id)}
													className="rounded p-1 text-red-500 hover:bg-red-50"
													title="Delete"
												>
													<Trash2 size={14} />
												</button>
											</div>
										</td>
									</tr>
								))}
								{stages.length === 0 && (
									<tr>
										<td colSpan={2} className="px-3 py-6 text-center text-gray-500">
											No stages yet
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>

				<div className="rounded-xl border border-gray-200 bg-white p-5">
					<h4 className="mb-3 text-base font-semibold text-gray-900">Preview</h4>
					<select
						value={selectedPreviewStageId}
						onChange={(event) => setSelectedPreviewStageId(event.target.value)}
						className="mb-4 h-10 w-full rounded-md border border-gray-300 px-3 text-sm"
					>
						<option value="">Select a stage</option>
						{stages.map((stage) => (
							<option key={stage.id} value={stage.id}>
								{stage.name}
							</option>
						))}
					</select>
					<div className="space-y-2">
						{stages.map((stage) => {
							const active = selectedPreviewStage?.id === stage.id
							return (
								<div
									key={stage.id}
									className={`flex items-center gap-2 rounded-md border px-3 py-2 text-sm ${
										active ? 'border-blue-200 bg-blue-50' : 'border-gray-200'
									}`}
								>
									<Circle size={10} fill={stage.color} className="text-transparent" />
									<span className="font-medium text-gray-700">{stage.name}</span>
									{stage.isDefault && (
										<span className="ml-auto rounded bg-blue-100 px-2 py-0.5 text-[11px] font-semibold text-blue-700">
											Default
										</span>
									)}
								</div>
							)
						})}
					</div>
				</div>
			</div>

			<div className="grid grid-cols-1 gap-6 xl:grid-cols-3">
				<div className="xl:col-span-2 rounded-xl border border-gray-200 bg-white p-5">
					<div className="mb-4 flex items-center justify-between">
						<h3 className="text-xl font-semibold text-gray-900">Additional Fields</h3>
						<button
							type="button"
							onClick={() => setShowAddField((prev) => !prev)}
							className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
						>
							<Plus size={14} />
							Add Field
						</button>
					</div>

					{showAddField && (
						<div className="mb-4 grid gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
							<div className="grid gap-3 sm:grid-cols-2">
								<input
									value={newFieldLabel}
									onChange={(event) => setNewFieldLabel(event.target.value)}
									className="h-10 rounded-md border border-gray-300 px-3 text-sm"
									placeholder="Field label"
								/>
								<select
									value={newFieldType}
									onChange={(event) => setNewFieldType(event.target.value)}
									className="h-10 rounded-md border border-gray-300 px-3 text-sm"
								>
									<option value="text">Text</option>
									<option value="number">Number</option>
									<option value="date">Date</option>
									<option value="dropdown">Dropdown</option>
									<option value="checkbox">Checkbox</option>
								</select>
							</div>
							{newFieldType === 'dropdown' && (
								<input
									value={newFieldOptions}
									onChange={(event) => setNewFieldOptions(event.target.value)}
									className="h-10 rounded-md border border-gray-300 px-3 text-sm"
									placeholder="Options, comma separated"
								/>
							)}
							<div className="flex items-center gap-4 text-sm text-gray-700">
								<label className="inline-flex items-center gap-2">
									<input
										type="checkbox"
										checked={newFieldRequired}
										onChange={(event) => setNewFieldRequired(event.target.checked)}
									/>
									Required
								</label>
								<label className="inline-flex items-center gap-2">
									<input
										type="checkbox"
										checked={newFieldVisible}
										onChange={(event) => setNewFieldVisible(event.target.checked)}
									/>
									Visible
								</label>
							</div>
							<div>
								<button
									type="button"
									onClick={submitCreateField}
									disabled={saving}
									className="inline-flex items-center gap-2 rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
								>
									<Save size={14} />
									Save Field
								</button>
							</div>
						</div>
					)}

					<div className="overflow-hidden rounded-lg border border-gray-200">
						<table className="w-full text-left text-sm">
							<thead className="bg-gray-50 text-xs uppercase text-gray-500">
								<tr>
									<th className="px-3 py-2">Name</th>
									<th className="px-3 py-2">Type</th>
									<th className="px-3 py-2">Actions</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-gray-100 bg-white">
								{fields.map((field, index) => (
									<tr key={field.id}>
										<td className="px-3 py-2">
											{editingFieldId === field.id ? (
												<input
													value={editingFieldLabel}
													onChange={(event) =>
														setEditingFieldLabel(event.target.value)
													}
													className="h-9 w-full rounded-md border border-gray-300 px-2 text-sm"
												/>
											) : (
												<span className="font-medium text-gray-800">
													{field.fieldLabel}
												</span>
											)}
										</td>
										<td className="px-3 py-2">
											{editingFieldId === field.id ? (
												<div className="space-y-2">
													<select
														value={editingFieldType}
														onChange={(event) =>
															setEditingFieldType(event.target.value)
														}
														className="h-8 rounded-md border border-gray-300 px-2 text-xs"
													>
														<option value="text">Text</option>
														<option value="number">Number</option>
														<option value="date">Date</option>
														<option value="dropdown">Dropdown</option>
														<option value="checkbox">Checkbox</option>
													</select>
													{editingFieldType === 'dropdown' && (
														<input
															value={editingFieldOptions}
															onChange={(event) =>
																setEditingFieldOptions(event.target.value)
															}
															className="h-8 w-full rounded-md border border-gray-300 px-2 text-xs"
															placeholder="Options, comma separated"
														/>
													)}
												</div>
											) : (
												<span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-700">
													{field.fieldType}
												</span>
											)}
										</td>
										<td className="px-3 py-2">
											<div className="flex items-center gap-1">
												<button
													type="button"
													onClick={() => moveField(index, -1)}
													className="rounded p-1 text-gray-500 hover:bg-gray-100"
													title="Move up"
												>
													<ChevronUp size={14} />
												</button>
												<button
													type="button"
													onClick={() => moveField(index, 1)}
													className="rounded p-1 text-gray-500 hover:bg-gray-100"
													title="Move down"
												>
													<ChevronDown size={14} />
												</button>
												{editingFieldId === field.id ? (
													<button
														type="button"
														onClick={submitUpdateField}
														className="rounded p-1 text-emerald-600 hover:bg-emerald-50"
													>
														<Save size={14} />
													</button>
												) : (
													<button
														type="button"
														onClick={() => {
															setEditingFieldId(field.id)
															setEditingFieldLabel(field.fieldLabel)
															setEditingFieldType(field.fieldType)
															setEditingFieldOptions(
																(field.options || []).join(', '),
															)
															setEditingFieldRequired(field.isRequired)
															setEditingFieldVisible(field.isVisible)
														}}
														className="rounded p-1 text-gray-500 hover:bg-gray-100"
													>
														<Edit2 size={14} />
													</button>
												)}
												<button
													type="button"
													onClick={() => removeField(field.id)}
													className="rounded p-1 text-red-500 hover:bg-red-50"
												>
													<Trash2 size={14} />
												</button>
											</div>
											{editingFieldId === field.id && (
												<div className="mt-2 flex items-center gap-3 text-xs text-gray-700">
													<label className="inline-flex items-center gap-1">
														<input
															type="checkbox"
															checked={editingFieldRequired}
															onChange={(event) =>
																setEditingFieldRequired(event.target.checked)
															}
														/>
														Required
													</label>
													<label className="inline-flex items-center gap-1">
														<input
															type="checkbox"
															checked={editingFieldVisible}
															onChange={(event) =>
																setEditingFieldVisible(event.target.checked)
															}
														/>
														Visible
													</label>
												</div>
											)}
										</td>
									</tr>
								))}
								{fields.length === 0 && (
									<tr>
										<td colSpan={3} className="px-3 py-6 text-center text-gray-500">
											No additional fields yet
										</td>
									</tr>
								)}
							</tbody>
						</table>
					</div>
				</div>

				<div className="rounded-xl border border-gray-200 bg-white p-5">
					<h4 className="mb-3 text-base font-semibold text-gray-900">Preview</h4>
					<div className="space-y-2">
						{fields
							.filter((field) => field.isVisible)
							.map((field) => (
								<div
									key={field.id}
									className="rounded-md border border-gray-200 px-3 py-2 text-sm text-gray-700"
								>
									<div className="mb-1 flex items-center gap-2 font-medium">
										{field.fieldType === 'checkbox' ? (
											<Tag size={14} className="text-violet-500" />
										) : (
											<Users size={14} className="text-gray-500" />
										)}
										{field.fieldLabel}
										{field.isRequired && (
											<span className="rounded bg-red-100 px-2 py-0.5 text-[10px] font-semibold text-red-600">
												Required
											</span>
										)}
									</div>
									<div className="text-xs text-gray-500">
										{field.fieldType}
										{field.fieldType === 'dropdown' &&
											Array.isArray(field.options) &&
											field.options.length > 0 &&
											` • ${field.options.join(', ')}`}
									</div>
								</div>
							))}
						{fields.filter((field) => field.isVisible).length === 0 && (
							<p className="text-sm text-gray-500">
								No visible additional fields configured yet.
							</p>
						)}
					</div>
				</div>
			</div>
		</div>
	)
}
