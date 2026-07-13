// Modal components for Pipeline feature
import { useState } from 'react'
import {
	X,
	Plus,
	GripVertical,
	DollarSign,
	Calendar,
	User,
	Mail,
	Phone,
} from 'lucide-react'

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

// Pipeline Create/Edit Modal
export function PipelineModal({
	pipeline,
	onClose,
	onSave,
}: {
	pipeline: Pipeline | null
	onClose: () => void
	onSave: () => void
}) {
	const [name, setName] = useState(pipeline?.name || 'New Pipeline')
	const [stages, setStages] = useState<Array<{ name: string; color: string }>>(
		pipeline?.stages
			.sort((a, b) => a.order - b.order)
			.map((s) => ({ name: s.name, color: s.color })) || [
			{ name: 'New', color: '#3b82f6' },
			{ name: 'Contacted', color: '#eab308' },
			{ name: 'Qualified', color: '#22c55e' },
			{ name: 'Lost', color: '#ef4444' },
		],
	)
	const [saving, setSaving] = useState(false)

	const handleAddStage = () => {
		setStages([...stages, { name: 'New Stage', color: '#6b7280' }])
	}

	const handleRemoveStage = (index: number) => {
		if (stages.length <= 1) {
			alert('Pipeline must have at least one stage')
			return
		}
		setStages(stages.filter((_, i) => i !== index))
	}

	const handleUpdateStage = (
		index: number,
		field: 'name' | 'color',
		value: string,
	) => {
		const newStages = [...stages]
		newStages[index][field] = value
		setStages(newStages)
	}

	const handleSave = async () => {
		if (!name.trim()) {
			alert('Pipeline name is required')
			return
		}

		if (stages.some((s) => !s.name.trim())) {
			alert('All stages must have a name')
			return
		}

		setSaving(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'

			const method = pipeline ? 'PUT' : 'POST'
			const url = pipeline
				? `${API_URL}/api/v1/crm/pipelines/${pipeline.id}`
				: `${API_URL}/api/v1/crm/pipelines`

			await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					name,
					stages: stages.map((stage, index) => ({
						...stage,
						order: index,
					})),
				}),
			})

			onSave()
		} catch (error) {
			console.error('Failed to save pipeline:', error)
			alert('Failed to save pipeline')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-3xl max-h-[90vh] overflow-hidden flex flex-col">
				<div className="px-8 py-6 border-b border-gray-200 flex items-center justify-between">
					<div>
						<h2 className="text-2xl font-bold text-gray-900">
							{pipeline ? 'Edit Pipeline' : 'New Pipeline'}
						</h2>
						<p className="text-gray-500 text-sm mt-1">
							Configure your sales pipeline stages.
						</p>
					</div>
					<button
						onClick={onClose}
						className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
					>
						<X size={24} />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
					{/* Pipeline Name */}
					<div>
						<label className="block text-sm font-semibold text-gray-900 mb-2">
							Pipeline Name
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full px-4 py-3 border-2 border-emerald-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 font-medium"
							placeholder="e.g., Sales Pipeline"
						/>
					</div>

					{/* Stages */}
					<div>
						<div className="flex items-center justify-between mb-4">
							<label className="block text-sm font-semibold text-gray-900">
								Stages
							</label>
							<button
								onClick={handleAddStage}
								className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-emerald-600 hover:bg-emerald-50 rounded-lg transition"
							>
								<Plus size={16} />
								Add Stage
							</button>
						</div>

						<div className="space-y-3">
							{stages.map((stage, index) => (
								<div
									key={index}
									className="flex items-center gap-3 p-4 bg-gray-50 rounded-lg border border-gray-200"
								>
									<GripVertical
										size={20}
										className="text-gray-400 cursor-move"
									/>

									<input
										type="text"
										value={stage.name}
										onChange={(e) =>
											handleUpdateStage(index, 'name', e.target.value)
										}
										className="flex-1 px-4 py-2 bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
										placeholder="Stage name"
									/>

									<div className="flex items-center gap-2">
										<input
											type="color"
											value={stage.color}
											onChange={(e) =>
												handleUpdateStage(index, 'color', e.target.value)
											}
											className="w-12 h-10 rounded cursor-pointer"
										/>
										<input
											type="text"
											value={stage.color}
											onChange={(e) =>
												handleUpdateStage(index, 'color', e.target.value)
											}
											className="w-24 px-2 py-2 bg-white border border-gray-300 rounded text-sm font-mono"
											placeholder="#000000"
										/>
									</div>

									<button
										onClick={() => handleRemoveStage(index)}
										className="p-2 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition"
									>
										<X size={18} />
									</button>
								</div>
							))}
						</div>
					</div>
				</div>

				<div className="px-8 py-6 border-t border-gray-200 flex items-center justify-end gap-3">
					<button
						onClick={onClose}
						className="px-6 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={saving}
						className="px-6 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? 'Saving...' : 'Save Changes'}
					</button>
				</div>
			</div>
		</div>
	)
}

// Deal Modal
export function DealModal({
	deal,
	pipelines,
	customFields,
	selectedStageId,
	onClose,
	onSave,
}: {
	deal: Deal | null
	pipelines: Pipeline[]
	customFields: CustomField[]
	selectedStageId: string | null
	onClose: () => void
	onSave: () => void
}) {
	const [title, setTitle] = useState(deal?.title || '')
	const [value, setValue] = useState(deal?.value || 0)
	const [contactName, setContactName] = useState(deal?.contactName || '')
	const [contactEmail, setContactEmail] = useState(deal?.contactEmail || '')
	const [contactPhone, setContactPhone] = useState(deal?.contactPhone || '')
	const [stageId, setStageId] = useState(
		selectedStageId || deal?.stageId || pipelines[0]?.stages[0]?.id || '',
	)
	const [expectedCloseDate, setExpectedCloseDate] = useState(
		deal?.expectedCloseDate || '',
	)
	const [saving, setSaving] = useState(false)

	const handleSave = async () => {
		if (!title.trim()) {
			alert('Deal title is required')
			return
		}

		if (!contactName.trim()) {
			alert('Contact name is required')
			return
		}

		setSaving(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'

			const method = deal ? 'PUT' : 'POST'
			const url = deal
				? `${API_URL}/api/v1/crm/deals/${deal.id}`
				: `${API_URL}/api/v1/crm/deals`

			await fetch(url, {
				method,
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					title,
					value,
					stageId,
					contactName,
					contactEmail,
					contactPhone,
					expectedCloseDate,
				}),
			})

			onSave()
		} catch (error) {
			console.error('Failed to save deal:', error)
			alert('Failed to save deal')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
				<div className="px-8 py-6 border-b border-gray-200 flex items-center justify-between">
					<h2 className="text-2xl font-bold text-gray-900">
						{deal ? 'Edit Deal' : 'New Deal'}
					</h2>
					<button
						onClick={onClose}
						className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
					>
						<X size={24} />
					</button>
				</div>

				<div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">
					<div className="grid grid-cols-2 gap-4">
						<div className="col-span-2">
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Deal Title *
							</label>
							<input
								type="text"
								value={title}
								onChange={(e) => setTitle(e.target.value)}
								className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
								placeholder="e.g., Acme Corp - Enterprise Plan"
							/>
						</div>

						<div>
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Deal Value *
							</label>
							<div className="relative">
								<DollarSign
									size={18}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								/>
								<input
									type="number"
									value={value}
									onChange={(e) => setValue(Number(e.target.value))}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
									placeholder="50000"
								/>
							</div>
						</div>

						<div>
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Expected Close Date
							</label>
							<div className="relative">
								<Calendar
									size={18}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								/>
								<input
									type="date"
									value={expectedCloseDate}
									onChange={(e) => setExpectedCloseDate(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
								/>
							</div>
						</div>

						<div className="col-span-2">
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Contact Name *
							</label>
							<div className="relative">
								<User
									size={18}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								/>
								<input
									type="text"
									value={contactName}
									onChange={(e) => setContactName(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
									placeholder="John Smith"
								/>
							</div>
						</div>

						<div>
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Email
							</label>
							<div className="relative">
								<Mail
									size={18}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								/>
								<input
									type="email"
									value={contactEmail}
									onChange={(e) => setContactEmail(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
									placeholder="john@company.com"
								/>
							</div>
						</div>

						<div>
							<label className="block text-sm font-semibold text-gray-900 mb-2">
								Phone
							</label>
							<div className="relative">
								<Phone
									size={18}
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								/>
								<input
									type="tel"
									value={contactPhone}
									onChange={(e) => setContactPhone(e.target.value)}
									className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
									placeholder="+1234567890"
								/>
							</div>
						</div>
					</div>
				</div>

				<div className="px-8 py-6 border-t border-gray-200 flex items-center justify-end gap-3">
					<button
						onClick={onClose}
						className="px-6 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={saving}
						className="px-6 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? 'Saving...' : deal ? 'Update Deal' : 'Create Deal'}
					</button>
				</div>
			</div>
		</div>
	)
}

// Custom Field Modal
export function CustomFieldModal({
	onClose,
	onSave,
}: {
	onClose: () => void
	onSave: () => void
}) {
	const [name, setName] = useState('')
	const [fieldType, setFieldType] = useState<
		'text' | 'number' | 'date' | 'dropdown' | 'checkbox'
	>('text')
	const [required, setRequired] = useState(false)
	const [saving, setSaving] = useState(false)

	const handleSave = async () => {
		if (!name.trim()) {
			alert('Field name is required')
			return
		}

		setSaving(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'

			await fetch(`${API_URL}/api/v1/crm/custom-fields`, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					Authorization: `Bearer ${token}`,
				},
				body: JSON.stringify({
					name,
					fieldType,
					required,
				}),
			})

			onSave()
		} catch (error) {
			console.error('Failed to create custom field:', error)
			alert('Failed to create custom field')
		} finally {
			setSaving(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-lg">
				<div className="px-8 py-6 border-b border-gray-200 flex items-center justify-between">
					<h2 className="text-2xl font-bold text-gray-900">New Custom Field</h2>
					<button
						onClick={onClose}
						className="p-2 text-gray-400 hover:text-gray-600 rounded-lg hover:bg-gray-100 transition"
					>
						<X size={24} />
					</button>
				</div>

				<div className="px-8 py-6 space-y-6">
					<div>
						<label className="block text-sm font-semibold text-gray-900 mb-2">
							Field Name
						</label>
						<input
							type="text"
							value={name}
							onChange={(e) => setName(e.target.value)}
							className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
							placeholder="e.g., Industry"
						/>
					</div>

					<div>
						<label className="block text-sm font-semibold text-gray-900 mb-2">
							Field Type
						</label>
						<select
							value={fieldType}
							onChange={(e) => setFieldType(e.target.value as any)}
							className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
						>
							<option value="text">Text</option>
							<option value="number">Number</option>
							<option value="date">Date</option>
							<option value="dropdown">Dropdown</option>
							<option value="checkbox">Checkbox</option>
						</select>
					</div>

					<div className="flex items-center gap-2">
						<input
							type="checkbox"
							id="required"
							checked={required}
							onChange={(e) => setRequired(e.target.checked)}
							className="w-4 h-4 text-emerald-600"
						/>
						<label
							htmlFor="required"
							className="text-sm font-medium text-gray-900"
						>
							Required field
						</label>
					</div>
				</div>

				<div className="px-8 py-6 border-t border-gray-200 flex items-center justify-end gap-3">
					<button
						onClick={onClose}
						className="px-6 py-2.5 text-gray-700 hover:bg-gray-100 rounded-lg transition font-medium"
					>
						Cancel
					</button>
					<button
						onClick={handleSave}
						disabled={saving}
						className="px-6 py-2.5 bg-emerald-500 text-white rounded-lg hover:bg-emerald-600 transition font-medium disabled:opacity-50 disabled:cursor-not-allowed"
					>
						{saving ? 'Creating...' : 'Create Field'}
					</button>
				</div>
			</div>
		</div>
	)
}
