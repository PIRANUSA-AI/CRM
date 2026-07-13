import { useState } from 'react'
import { X, Plus, Trash2, Filter } from 'lucide-react'

interface FilterRule {
	id: string
	field: string
	operator: string
	value: string
}

interface Props {
	onApplyFilters: (filters: FilterRule[]) => void
}

const FILTER_FIELDS = [
	{ value: 'status', label: 'Status' },
	{ value: 'assignee', label: 'Assignee' },
	{ value: 'sender', label: 'Sender' },
	{ value: 'unread', label: 'Unread' },
]

const OPERATORS = [
	{ value: 'equal', label: 'Equal to' },
	{ value: 'not_equal', label: 'Not equal to' },
	{ value: 'contains', label: 'Contains' },
	{ value: 'not_contains', label: 'Does not contain' },
]

const FIELD_VALUES: Record<string, { value: string; label: string }[]> = {
	status: [
		{ value: 'open', label: 'Open' },
		{ value: 'resolved', label: 'Resolved' },
		{ value: 'pending', label: 'Pending' },
	],
	assignee: [
		{ value: 'assigned', label: 'Assigned' },
		{ value: 'unassigned', label: 'Unassigned' },
	],
	unread: [
		{ value: 'true', label: 'Yes' },
		{ value: 'false', label: 'No' },
	],
}

export default function AdvancedFilter({ onApplyFilters }: Props) {
	const [isOpen, setIsOpen] = useState(false)
	const [filters, setFilters] = useState<FilterRule[]>([
		{ id: '1', field: 'status', operator: 'equal', value: 'open' },
	])

	const addFilter = () => {
		setFilters([
			...filters,
			{
				id: Date.now().toString(),
				field: 'status',
				operator: 'equal',
				value: 'open',
			},
		])
	}

	const removeFilter = (id: string) => {
		setFilters(filters.filter((f) => f.id !== id))
	}

	const updateFilter = (id: string, key: keyof FilterRule, value: string) => {
		setFilters(filters.map((f) => (f.id === id ? { ...f, [key]: value } : f)))
	}

	const handleApply = () => {
		onApplyFilters(filters)
		setIsOpen(false)
	}

	const handleClear = () => {
		setFilters([{ id: '1', field: 'status', operator: 'equal', value: 'open' }])
	}

	return (
		<div className="relative">
			<button
				onClick={() => setIsOpen(!isOpen)}
				className="flex items-center gap-2 px-3 py-2 bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors text-sm font-medium"
			>
				<Filter size={16} />
			</button>

			{isOpen && (
				<div
					className="absolute top-full left-0 mt-2 w-full bg-white rounded-lg shadow-2xl border border-gray-200 z-50 p-6"
					style={{ minWidth: '500px' }}
				>
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-semibold text-gray-900">
							Filter conversations
						</h3>
						<button
							onClick={() => setIsOpen(false)}
							className="text-gray-400 hover:text-gray-600"
						>
							<X size={20} />
						</button>
					</div>

					<div className="space-y-3 mb-6">
						{filters.map((filter) => (
							<div key={filter.id} className="flex items-center gap-2">
								<select
									value={filter.field}
									onChange={(e) =>
										updateFilter(filter.id, 'field', e.target.value)
									}
									className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
								>
									{FILTER_FIELDS.map((f) => (
										<option key={f.value} value={f.value}>
											{f.label}
										</option>
									))}
								</select>

								<select
									value={filter.operator}
									onChange={(e) =>
										updateFilter(filter.id, 'operator', e.target.value)
									}
									className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white"
								>
									{OPERATORS.map((op) => (
										<option key={op.value} value={op.value}>
											{op.label}
										</option>
									))}
								</select>

								<select
									value={filter.value}
									onChange={(e) =>
										updateFilter(filter.id, 'value', e.target.value)
									}
									className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white flex-1"
								>
									{FIELD_VALUES[filter.field]?.map((v) => (
										<option key={v.value} value={v.value}>
											{v.label}
										</option>
									))}
								</select>

								<button
									onClick={() => removeFilter(filter.id)}
									className="p-2 text-gray-400 hover:text-red-600 transition-colors"
								>
									<Trash2 size={16} />
								</button>
							</div>
						))}
					</div>

					<button
						onClick={addFilter}
						className="text-blue-600 hover:text-blue-700 text-sm font-medium mb-6 flex items-center gap-1"
					>
						<Plus size={16} />
						Add filter
					</button>

					<div className="flex justify-end gap-3">
						<button
							onClick={handleClear}
							className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg transition-colors text-sm font-medium"
						>
							Clear filters
						</button>
						<button
							onClick={handleApply}
							className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
						>
							Apply filters
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
