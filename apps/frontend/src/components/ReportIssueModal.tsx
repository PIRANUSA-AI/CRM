import { useState } from 'react'
import { X, Flag, AlertCircle, Loader2 } from 'lucide-react'
import { API_BASE } from '@/lib/api'

interface ReportIssueModalProps {
	conversationId: string
	onClose: () => void
}

export function ReportIssueModal({
	conversationId,
	onClose,
}: ReportIssueModalProps) {
	const [reason, setReason] = useState('spam')
	const [description, setDescription] = useState('')
	const [isSubmitting, setIsSubmitting] = useState(false)

	const handleSubmit = async (e: React.FormEvent) => {
		e.preventDefault()
		setIsSubmitting(true)
		try {
			const token = localStorage.getItem('scalechat_token')
			const appId = localStorage.getItem('scalechat_app_id')

			const response = await fetch(
				`${API_BASE}/conversations/${conversationId}/report`,
				{
					method: 'POST',
					headers: {
						'Content-Type': 'application/json',
						Authorization: `Bearer ${token}`,
						'X-App-Id': appId || '',
					},
					body: JSON.stringify({ reason, description }),
				},
			)

			if (!response.ok) throw new Error('Failed to submit report')

			alert('Report submitted successfully. Thank you for your feedback.')
			onClose()
		} catch (error) {
			console.error('Report failed:', error)
			alert('Failed to submit report')
		} finally {
			setIsSubmitting(false)
		}
	}

	const reasons = [
		{ value: 'spam', label: 'Spam or Unwanted' },
		{ value: 'abuse', label: 'Harassment or Abuse' },
		{ value: 'inappropriate', label: 'Inappropriate Content' },
		{ value: 'other', label: 'Other Issue' },
	]

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
					<div className="flex items-center gap-2">
						<Flag className="w-5 h-5 text-red-500" />
						<h3 className="text-lg font-bold text-gray-900">Report Issue</h3>
					</div>
					<button
						onClick={onClose}
						className="p-2 hover:bg-gray-100 rounded-lg"
					>
						<X className="w-5 h-5 text-gray-400" />
					</button>
				</div>

				<form onSubmit={handleSubmit} className="p-6 space-y-4">
					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Reason
						</label>
						<select
							value={reason}
							onChange={(e) => setReason(e.target.value)}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none"
						>
							{reasons.map((r) => (
								<option key={r.value} value={r.value}>
									{r.label}
								</option>
							))}
						</select>
					</div>

					<div>
						<label className="block text-sm font-medium text-gray-700 mb-1">
							Description (Optional)
						</label>
						<textarea
							value={description}
							onChange={(e) => setDescription(e.target.value)}
							rows={3}
							className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-red-500 focus:border-red-500 outline-none resize-none"
							placeholder="Please provide more details..."
						/>
					</div>

					<div className="bg-gray-50 p-3 rounded-lg flex gap-3 text-xs text-gray-500">
						<AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
						<p>
							This conversation will be flagged for review by our moderation
							team.
						</p>
					</div>

					<button
						type="submit"
						disabled={isSubmitting}
						className="w-full px-4 py-2.5 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors font-medium flex items-center justify-center gap-2"
					>
						{isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
						Submit Report
					</button>
				</form>
			</div>
		</div>
	)
}
