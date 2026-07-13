import { useState } from 'react'
import { X, Pin, Clock, Check } from 'lucide-react'

interface PinChatModalProps {
	conversationId: string
	conversationName: string
	onConfirm: () => Promise<void>
	onClose: () => void
}

export function PinChatModal({
	conversationId,
	conversationName,
	onConfirm,
	onClose,
}: PinChatModalProps) {
	const [isPinning, setIsPinning] = useState(false)

	const handleConfirm = async () => {
		setIsPinning(true)
		try {
			await onConfirm()
			onClose()
		} catch (error) {
			console.error('Failed to pin chat:', error)
			alert('Failed to pin chat')
		} finally {
			setIsPinning(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-emerald-100 flex items-center justify-center">
							<Pin className="w-5 h-5 text-emerald-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">Pin Chat</h3>
							<p className="text-xs text-gray-500">Keep this chat at the top</p>
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
				<div className="p-6 space-y-4">
					<div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
						<p className="text-sm text-gray-700">
							<strong>Chat:</strong> {conversationName}
						</p>
					</div>

					<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 flex gap-3">
						<Pin className="w-5 h-5 text-blue-600 shrink-0 mt-0.5" />
						<div>
							<p className="text-sm font-semibold text-blue-900 mb-1">
								Pinned Chat
							</p>
							<p className="text-xs text-blue-700">
								This chat will stay at the top of your inbox list, making it
								easy to access important conversations.
							</p>
						</div>
					</div>

					{/* Actions */}
					<div className="flex gap-3 pt-2">
						<button
							type="button"
							onClick={onClose}
							className="flex-1 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors font-medium"
						>
							Cancel
						</button>
						<button
							onClick={handleConfirm}
							disabled={isPinning}
							className="flex-1 px-4 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							{isPinning ? (
								<>
									<Clock className="w-4 h-4 animate-spin" />
									<span>Pinning...</span>
								</>
							) : (
								<>
									<Pin className="w-4 h-4" />
									<span>Pin Chat</span>
								</>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
