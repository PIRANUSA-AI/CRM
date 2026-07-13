import { ArrowUp, ArrowDown, ChevronDown } from 'lucide-react'
import { useState } from 'react'

interface Props {
	orderBy: string
	orderDirection: 'asc' | 'desc'
	onOrderByChange: (orderBy: string, direction: 'asc' | 'desc') => void
}

const ORDER_OPTIONS = [
	{ value: 'last_activity', label: 'Last activity' },
	{ value: 'created_at', label: 'Created date' },
	{ value: 'unread_count', label: 'Unread count' },
	{ value: 'sender_name', label: 'Sender name' },
]

export default function OrderBy({
	orderBy,
	orderDirection,
	onOrderByChange,
}: Props) {
	const [isOpen, setIsOpen] = useState(false)
	const currentLabel =
		ORDER_OPTIONS.find((o) => o.value === orderBy)?.label || 'Last activity'

	return (
		<div className="flex items-center gap-1">
			{/* Sort Direction Buttons - Icon Only */}
			<button
				onClick={() => onOrderByChange(orderBy, 'desc')}
				className={`p-2 rounded transition-colors ${
					orderDirection === 'desc'
						? 'bg-gray-200 text-gray-900'
						: 'text-gray-400 hover:text-gray-600'
				}`}
				title="Newest first"
			>
				<ArrowDown size={16} />
			</button>
			<button
				onClick={() => onOrderByChange(orderBy, 'asc')}
				className={`p-2 rounded transition-colors ${
					orderDirection === 'asc'
						? 'bg-gray-200 text-gray-900'
						: 'text-gray-400 hover:text-gray-600'
				}`}
				title="Oldest first"
			>
				<ArrowUp size={16} />
			</button>

			{/* Order By Dropdown - Icon Only */}
			<div className="relative">
				<button
					onClick={() => setIsOpen(!isOpen)}
					className="p-2 text-gray-400 hover:text-gray-600 transition-colors rounded"
					title={`${currentLabel}: ${orderDirection === 'desc' ? 'Newest' : 'Oldest'}`}
				>
					<ChevronDown size={16} />
				</button>

				{isOpen && (
					<div className="absolute top-full right-0 mt-1 bg-white rounded-lg shadow-lg border border-gray-200 z-50 min-w-max">
						{ORDER_OPTIONS.map((option) => (
							<button
								key={option.value}
								onClick={() => {
									onOrderByChange(option.value, orderDirection)
									setIsOpen(false)
								}}
								className={`w-full text-left px-4 py-2 text-sm transition-colors ${
									orderBy === option.value
										? 'bg-gray-100 text-gray-900 font-medium'
										: 'text-gray-700 hover:bg-gray-50'
								}`}
							>
								{option.label}
							</button>
						))}
					</div>
				)}
			</div>
		</div>
	)
}
