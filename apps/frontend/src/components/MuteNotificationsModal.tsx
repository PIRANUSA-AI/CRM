import { useState } from 'react'
import { X, BellOff, Clock } from 'lucide-react'

interface MuteNotificationsModalProps {
	conversationName: string
	onConfirm: (duration: number | null) => Promise<void>
	onClose: () => void
}

const MUTE_DURATIONS = [
	{ label: '1 Hour', value: 60 * 60 * 1000, icon: '⏰' },
	{ label: '8 Hours', value: 8 * 60 * 60 * 1000, icon: '🌙' },
	{ label: '24 Hours', value: 24 * 60 * 60 * 1000, icon: '📅' },
	{ label: 'Until I unmute', value: null, icon: '🔕' },
]

export function MuteNotificationsModal({
	conversationName,
	onConfirm,
	onClose,
}: MuteNotificationsModalProps) {
	const [selectedDuration, setSelectedDuration] = useState<number | null>(
		60 * 60 * 1000,
	)
	const [isMuting, setIsMuting] = useState(false)

	const handleConfirm = async () => {
		setIsMuting(true)
		try {
			await onConfirm(selectedDuration)
			onClose()
		} catch (error) {
			console.error('Failed to mute notifications:', error)
			alert('Failed to mute notifications')
		} finally {
			setIsMuting(false)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-orange-100 flex items-center justify-center">
							<BellOff className="w-5 h-5 text-orange-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-gray-900">
								Mute Notifications
							</h3>
							<p className="text-xs text-gray-500">
								Silence alerts for this chat
							</p>
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
					{/* Chat Info */}
					<div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
						<p className="text-sm text-gray-700">
							<strong>Chat:</strong> {conversationName}
						</p>
					</div>

					{/* Duration Options */}
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-3">
							Mute duration:
						</label>
						<div className="space-y-2">
							{MUTE_DURATIONS.map((option) => (
								<button
									key={option.label}
									onClick={() => setSelectedDuration(option.value)}
									className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 transition-all ${
										selectedDuration === option.value
											? 'border-orange-500 bg-orange-50'
											: 'border-gray-200 hover:border-gray-300 bg-white'
									}`}
								>
									<span className="text-2xl">{option.icon}</span>
									<span
										className={`flex-1 text-left font-medium ${
											selectedDuration === option.value
												? 'text-orange-900'
												: 'text-gray-700'
										}`}
									>
										{option.label}
									</span>
									{selectedDuration === option.value && (
										<div className="w-5 h-5 rounded-full bg-orange-500 flex items-center justify-center">
											<Clock className="w-3 h-3 text-white" />
										</div>
									)}
								</button>
							))}
						</div>
					</div>

					{/* Info Box */}
					<div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
						<p className="text-xs text-blue-700">
							<strong>Note:</strong> You'll still receive messages, but won't
							get sound or browser notifications for this chat.
						</p>
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
							disabled={isMuting}
							className="flex-1 px-4 py-2.5 bg-orange-600 text-white rounded-lg hover:bg-orange-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							{isMuting ? (
								<>
									<Clock className="w-4 h-4 animate-spin" />
									<span>Muting...</span>
								</>
							) : (
								<>
									<BellOff className="w-4 h-4" />
									<span>Mute</span>
								</>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
