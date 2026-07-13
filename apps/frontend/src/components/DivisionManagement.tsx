import { useState } from 'react'
import { agentsManagement } from '@/lib/agents-api'
import { Plus, Pencil, Trash2, Users } from 'lucide-react'

interface Division {
	id: string
	name: string
	description?: string
	color: string
	created_at: string
}

interface DivisionManagementProps {
	divisions: Division[]
	onRefresh: () => void
}

export default function DivisionManagement({
	divisions,
	onRefresh,
}: DivisionManagementProps) {
	const [showCreateModal, setShowCreateModal] = useState(false)
	const [editingDivision, setEditingDivision] = useState<Division | null>(null)

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex items-center justify-between">
				<div>
					<h3 className="text-lg font-semibold text-gray-900">Divisions</h3>
					<p className="text-sm text-gray-600 mt-1">
						Organize your team into divisions or departments
					</p>
				</div>
				<button
					onClick={() => setShowCreateModal(true)}
					className="flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition font-medium text-sm"
				>
					<Plus size={18} />
					Create Division
				</button>
			</div>

			{/* Division Grid */}
			<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
				{divisions.map((division) => (
					<div
						key={division.id}
						className="bg-white rounded-lg border border-gray-200 p-4 hover:shadow-md transition"
					>
						<div className="flex items-start justify-between mb-3">
							<div
								className="w-12 h-12 rounded-lg flex items-center justify-center"
								style={{ backgroundColor: division.color + '20' }}
							>
								<Users size={24} style={{ color: division.color }} />
							</div>
							<div className="flex gap-2">
								<button
									onClick={() => setEditingDivision(division)}
									className="text-gray-400 hover:text-gray-600 transition"
								>
									<Pencil size={16} />
								</button>
								<button
									onClick={async () => {
										if (confirm(`Delete division "${division.name}"?`)) {
											try {
												await agentsManagement.divisions.delete(division.id)
												onRefresh()
											} catch (err) {
												alert('Failed to delete division')
											}
										}
									}}
									className="text-gray-400 hover:text-red-600 transition"
								>
									<Trash2 size={16} />
								</button>
							</div>
						</div>

						<h4 className="font-semibold text-gray-900 mb-1">
							{division.name}
						</h4>
						<p className="text-sm text-gray-600 line-clamp-2">
							{division.description || 'No description'}
						</p>

						<div className="mt-4 pt-4 border-t border-gray-100">
							<div
								className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium text-white"
								style={{ backgroundColor: division.color }}
							>
								{division.name}
							</div>
						</div>
					</div>
				))}
			</div>

			{/* Empty State */}
			{divisions.length === 0 && (
				<div className="text-center py-12 bg-white rounded-lg border border-dashed border-gray-300">
					<Users className="mx-auto h-12 w-12 text-gray-400 mb-4" />
					<h3 className="text-lg font-semibold text-gray-900 mb-2">
						No divisions yet
					</h3>
					<p className="text-gray-600 mb-6">
						Create divisions to organize your team
					</p>
					<button
						onClick={() => setShowCreateModal(true)}
						className="inline-flex items-center gap-2 px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition"
					>
						<Plus size={18} />
						Create First Division
					</button>
				</div>
			)}

			{/* Create/Edit Modal */}
			{(showCreateModal || editingDivision) && (
				<DivisionModal
					division={editingDivision}
					onClose={() => {
						setShowCreateModal(false)
						setEditingDivision(null)
					}}
					onSuccess={() => {
						setShowCreateModal(false)
						setEditingDivision(null)
						onRefresh()
					}}
				/>
			)}
		</div>
	)
}

function DivisionModal({
	division,
	onClose,
	onSuccess,
}: {
	division?: Division | null
	onClose: () => void
	onSuccess: () => void
}) {
	const [formData, setFormData] = useState({
		name: division?.name || '',
		description: division?.description || '',
		color: division?.color || '#3B82F6',
	})
	const [loading, setLoading] = useState(false)
	const [error, setError] = useState('')

	const presetColors = [
		'#10B981', // Green
		'#3B82F6', // Blue
		'#8B5CF6', // Purple
		'#F59E0B', // Amber
		'#EF4444', // Red
		'#EC4899', // Pink
		'#14B8A6', // Teal
		'#F97316', // Orange
	]

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setError('')
		setLoading(true)

		try {
			if (division) {
				await agentsManagement.divisions.update(division.id, formData)
			} else {
				await agentsManagement.divisions.create(formData)
			}
			onSuccess()
		} catch (err: any) {
			setError(err.message || 'Failed to save division')
		} finally {
			setLoading(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-md">
				<form onSubmit={handleSubmit}>
					<div className="px-6 py-4 border-b border-gray-200">
						<h2 className="text-xl font-bold text-gray-900">
							{division ? 'Edit Division' : 'Create Division'}
						</h2>
					</div>

					<div className="px-6 py-4 space-y-4">
						{error && (
							<div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
								{error}
							</div>
						)}

						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">
								Division Name *
							</label>
							<input
								type="text"
								required
								value={formData.name}
								onChange={(e) =>
									setFormData({ ...formData, name: e.target.value })
								}
								className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
								placeholder="e.g., Sales Team"
							/>
						</div>

						<div>
							<label className="block text-sm font-medium text-gray-700 mb-1">
								Description
							</label>
							<textarea
								value={formData.description}
								onChange={(e) =>
									setFormData({ ...formData, description: e.target.value })
								}
								className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-teal-500"
								placeholder="Brief description of this division"
								rows={3}
							/>
						</div>

						<div>
							<label className="block text-sm font-medium text-gray-700 mb-2">
								Color Tag
							</label>
							<div className="grid grid-cols-8 gap-2">
								{presetColors.map((color) => (
									<button
										key={color}
										type="button"
										onClick={() => setFormData({ ...formData, color })}
										className={`w-10 h-10 rounded-lg transition ${
											formData.color === color
												? 'ring-2 ring-offset-2 ring-gray-900'
												: 'hover:scale-110'
										}`}
										style={{ backgroundColor: color }}
									/>
								))}
							</div>

							<div className="mt-3">
								<label className="block text-xs text-gray-600 mb-1">
									Custom Color
								</label>
								<input
									type="color"
									value={formData.color}
									onChange={(e) =>
										setFormData({ ...formData, color: e.target.value })
									}
									className="w-full h-10 rounded-lg cursor-pointer"
								/>
							</div>
						</div>

						<div className="p-3 bg-gray-50 rounded-lg">
							<p className="text-xs text-gray-600 mb-2">Preview:</p>
							<span
								className="inline-block px-3 py-1 rounded-full text-sm font-medium text-white"
								style={{ backgroundColor: formData.color }}
							>
								{formData.name || 'Division Name'}
							</span>
						</div>
					</div>

					<div className="px-6 py-4 bg-gray-50 border-t border-gray-200 flex justify-end gap-3">
						<button
							type="button"
							onClick={onClose}
							className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition"
						>
							Cancel
						</button>
						<button
							type="submit"
							disabled={loading}
							className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition disabled:opacity-50"
						>
							{loading ? 'Saving...' : division ? 'Update' : 'Create'}
						</button>
					</div>
				</form>
			</div>
		</div>
	)
}
