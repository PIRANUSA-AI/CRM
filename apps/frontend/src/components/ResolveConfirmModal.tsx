import { X, CheckCircle2 } from 'lucide-react'

interface ResolveConfirmModalProps {
	isOpen: boolean
	onClose: () => void
	onConfirm: () => void
	data?: {
		name: string
		totalMessages: number
	}
}

export function ResolveConfirmModal({
	isOpen,
	onClose,
	onConfirm,
	data,
}: ResolveConfirmModalProps) {
	if (!isOpen) return null

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
			<div className="bg-white rounded-xl shadow-xl w-full max-w-md animate-in fade-in zoom-in-95 duration-200">
				<div className="p-6">
					<div className="flex items-center justify-between mb-4">
						<h3 className="text-lg font-bold text-gray-900">
							Resolve Conversation
						</h3>
						<button
							onClick={onClose}
							className="p-1 hover:bg-gray-100 rounded-lg text-gray-400 transition-colors"
						>
							<X className="w-5 h-5" />
						</button>
					</div>

					<div className="mb-6">
						<div className="flex items-center justify-center w-12 h-12 bg-emerald-100 rounded-full mb-4 mx-auto">
							<CheckCircle2 className="w-6 h-6 text-emerald-600" />
						</div>
						<p className="text-center text-gray-600 mb-2">
							Are you sure you want to resolve the conversation with{' '}
							<span className="font-semibold text-gray-900">{data?.name}</span>?
						</p>
						{data && (
							<p className="text-center text-sm text-gray-400">
								Total messages exchanged: {data.totalMessages}
							</p>
						)}
					</div>

					<div className="flex gap-3 justify-end">
						<button
							onClick={onClose}
							className="px-4 py-2 text-gray-700 hover:bg-gray-100 rounded-lg text-sm font-medium transition-colors"
						>
							Cancel
						</button>
						<button
							onClick={onConfirm}
							className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg text-sm font-medium transition-colors"
						>
							Confirm Resolve
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
