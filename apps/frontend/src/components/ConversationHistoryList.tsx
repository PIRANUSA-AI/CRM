import { useEffect, useMemo, useState } from 'react'
import {
	MessageSquare,
	Calendar,
	CheckCircle,
	ChevronLeft,
	ChevronRight,
} from 'lucide-react'

interface ConversationHistoryListProps {
	history: any[]
	currentConversationId: string
	onSelect: (conv: any) => void
	pageSize?: number
	maxHeightClassName?: string
}

function resolveConversationTimestamp(conv: any): number {
	const candidates = [
		conv?.created_at,
		conv?.updated_at,
		conv?.last_message_at,
		conv?.resolved_at,
	]

	for (const candidate of candidates) {
		if (!candidate) continue
		const parsed = new Date(candidate).getTime()
		if (Number.isFinite(parsed)) return parsed
	}

	return 0
}

export function ConversationHistoryList({
	history,
	currentConversationId,
	onSelect,
	pageSize = 5,
	maxHeightClassName = 'max-h-[360px]',
}: ConversationHistoryListProps) {
	const [page, setPage] = useState(1)
	const sortedHistory = useMemo(
		() =>
			[...(history || [])].sort(
				(a, b) => resolveConversationTimestamp(b) - resolveConversationTimestamp(a),
			),
		[history],
	)
	const totalPages = Math.max(1, Math.ceil(sortedHistory.length / pageSize))

	useEffect(() => {
		setPage(1)
	}, [currentConversationId, sortedHistory.length, pageSize])

	useEffect(() => {
		setPage((previous) => Math.min(previous, totalPages))
	}, [totalPages])

	const startIndex = (page - 1) * pageSize
	const paginatedHistory = sortedHistory.slice(startIndex, startIndex + pageSize)
	const showingFrom = sortedHistory.length === 0 ? 0 : startIndex + 1
	const showingTo = startIndex + paginatedHistory.length

	if (!history || history.length === 0) {
		return (
			<div className="p-6 flex flex-col items-center justify-center text-center">
				<div className="w-10 h-10 bg-gray-50 rounded-full flex items-center justify-center mb-2">
					<MessageSquare className="w-5 h-5 text-gray-300" />
				</div>
				<p className="text-sm text-gray-500">
					No previous conversations found.
				</p>
			</div>
		)
	}

	return (
		<div className="space-y-2 p-2">
			<div className={`space-y-2 overflow-y-auto pr-1 ${maxHeightClassName}`}>
				{paginatedHistory.map((conv) => (
					<button
						key={conv.id}
						onClick={() => onSelect(conv)}
						className={`w-full text-left p-2.5 rounded-xl border transition-all group ${
							conv.id === currentConversationId
								? 'bg-emerald-50/50 border-emerald-200 ring-1 ring-emerald-500/20 shadow-sm'
								: 'bg-white border-gray-100 hover:border-emerald-200 hover:shadow-md'
						}`}
					>
						<div className="flex items-center justify-between mb-1.5">
							<div className="flex items-center gap-1.5">
								<span
									className={`px-1.5 py-0.5 text-[10px] font-semibold rounded ${
										conv.status === 'resolved'
											? 'bg-emerald-100 text-emerald-700'
											: 'bg-blue-100 text-blue-700'
									}`}
								>
									{conv.status?.toUpperCase() || 'OPEN'}
								</span>
								<span className="text-[10px] text-gray-400 font-mono opacity-0 group-hover:opacity-100 transition-opacity">
									#{conv.id.substring(0, 6)}
								</span>
							</div>
							<span className="text-[10px] text-gray-400 flex items-center gap-1">
								<Calendar className="w-3 h-3" />
								{new Date(conv.created_at).toLocaleDateString(undefined, {
									month: 'short',
									day: 'numeric',
								})}
							</span>
						</div>

						<div className="flex items-center gap-2 text-xs text-gray-600 mb-1">
							<MessageSquare className="w-3.5 h-3.5 text-gray-400" />
							<span className="truncate">
								{conv.total_messages || 0} messages exchanged
							</span>
						</div>

						{conv.resolved_at && (
							<div className="pt-1.5 border-t border-gray-50 flex items-center gap-1.5 text-[10px] text-gray-500">
								<CheckCircle className="w-3 h-3 text-emerald-500" />
								Resolved{' '}
								{new Date(conv.resolved_at).toLocaleDateString(undefined, {
									hour: '2-digit',
									minute: '2-digit',
								})}
							</div>
						)}
					</button>
				))}
			</div>

			{sortedHistory.length > pageSize && (
				<div className="flex items-center justify-between px-1 pt-1">
					<p className="text-[11px] text-gray-500">
						{showingFrom}-{showingTo} of {sortedHistory.length}
					</p>
					<div className="flex items-center gap-1">
						<button
							type="button"
							onClick={() => setPage((previous) => Math.max(1, previous - 1))}
							disabled={page <= 1}
							className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
							aria-label="Previous session page"
						>
							<ChevronLeft className="h-4 w-4" />
						</button>
						<span className="px-1 text-[11px] font-medium text-gray-600">
							{page}/{totalPages}
						</span>
						<button
							type="button"
							onClick={() =>
								setPage((previous) => Math.min(totalPages, previous + 1))
							}
							disabled={page >= totalPages}
							className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40"
							aria-label="Next session page"
						>
							<ChevronRight className="h-4 w-4" />
						</button>
					</div>
				</div>
			)}
		</div>
	)
}
