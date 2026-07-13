import { useState } from 'react'
import { X, Ban, AlertTriangle, Loader2 } from 'lucide-react'

interface BlockCustomerModalProps {
	customerName: string
	customerPhone: string
	blockType: 'chat' | 'call' | 'both'
	onConfirm: (reason: string) => Promise<void>
	onClose: () => void
}

export function BlockCustomerModal({
	customerName,
	customerPhone,
	blockType,
	onConfirm,
	onClose,
}: BlockCustomerModalProps) {
	const [reason, setReason] = useState('')
	const [isBlocking, setIsBlocking] = useState(false)

	const handleConfirm = async () => {
		if (!reason.trim()) {
			alert('Please provide a reason for blocking')
			return
		}

		setIsBlocking(true)
		try {
			await onConfirm(reason)
			onClose()
		} catch (error) {
			console.error('Failed to block customer:', error)
			alert('Failed to block customer')
		} finally {
			setIsBlocking(false)
		}
	}

	const getBlockTitle = () => {
		switch (blockType) {
			case 'chat':
				return 'Block Customer Chat'
			case 'call':
				return 'Block Customer Calls'
			case 'both':
				return 'Block Customer Chat & Calls'
		}
	}

	const getBlockDescription = () => {
		switch (blockType) {
			case 'chat':
				return 'This customer will not be able to send messages. All existing conversations will be automatically resolved.'
			case 'call':
				return 'This customer will not be able to make voice or video calls, but can still send messages.'
			case 'both':
				return 'This customer will be completely blocked from all communications (chat and calls). All conversations will be resolved.'
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 duration-200">
				{/* Header */}
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between bg-red-50">
					<div className="flex items-center gap-3">
						<div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center">
							<AlertTriangle className="w-5 h-5 text-red-600" />
						</div>
						<div>
							<h3 className="text-lg font-bold text-red-900">
								{getBlockTitle()}
							</h3>
							<p className="text-xs text-red-600">
								This action requires supervisor approval
							</p>
						</div>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-red-100 rounded-lg transition-colors"
					>
						<X className="w-5 h-5 text-red-400" />
					</button>
				</div>

				{/* Content */}
				<div className="p-6 space-y-4">
					{/* Customer Info */}
					<div className="bg-gray-50 rounded-lg p-4 border border-gray-200">
						<p className="text-sm text-gray-700">
							<strong>Customer:</strong> {customerName}
						</p>
						<p className="text-sm text-gray-600 mt-1">
							<strong>Phone:</strong> {customerPhone}
						</p>
					</div>

					{/* Warning */}
					<div className="bg-amber-50 border border-amber-200 rounded-lg p-4 flex gap-3">
						<Ban className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
						<div>
							<p className="text-sm font-semibold text-amber-900 mb-1">
								Warning
							</p>
							<p className="text-xs text-amber-700">{getBlockDescription()}</p>
						</div>
					</div>

					{/* Reason Input */}
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-2">
							Reason for blocking <span className="text-red-500">*</span>
						</label>
						<textarea
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							rows={3}
							className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500/20 focus:border-red-500 transition-all resize-none"
							placeholder="e.g., Spam, Abusive behavior, Fraudulent activity..."
						/>
						<p className="text-xs text-gray-500 mt-1">
							This reason will be logged for audit purposes
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
							disabled={isBlocking || !reason.trim()}
							className="flex-1 px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
						>
							{isBlocking ? (
								<>
									<Loader2 className="w-4 h-4 animate-spin" />
									<span>Blocking...</span>
								</>
							) : (
								<>
									<Ban className="w-4 h-4" />
									<span>Block Customer</span>
								</>
							)}
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
