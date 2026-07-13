import { useState } from 'react'
import { X, Download, FileText, FileJson, Loader2 } from 'lucide-react'
import { API_BASE } from '@/lib/api'

interface ExportChatModalProps {
	conversationId: string
	onClose: () => void
}

export function ExportChatModal({
	conversationId,
	onClose,
}: ExportChatModalProps) {
	const [downloading, setDownloading] = useState<'json' | 'txt' | null>(null)

	const handleExport = async (format: 'json' | 'txt') => {
		setDownloading(format)
		try {
			const token = localStorage.getItem('scalechat_token')
			const appId = localStorage.getItem('scalechat_app_id')

			const response = await fetch(
				`${API_BASE}/conversations/${conversationId}/export?format=${format}`,
				{
					headers: {
						Authorization: `Bearer ${token}`,
						'X-App-Id': appId || '',
					},
				},
			)

			if (!response.ok) throw new Error('Export failed')

			const blob = await response.blob()
			const url = window.URL.createObjectURL(blob)
			const a = document.createElement('a')
			a.href = url
			a.download = `conversation-${conversationId}.${format}`
			document.body.appendChild(a)
			a.click()
			window.URL.revokeObjectURL(url)
			document.body.removeChild(a)

			onClose()
		} catch (error) {
			console.error('Export error:', error)
			alert('Failed to export conversation')
		} finally {
			setDownloading(null)
		}
	}

	return (
		<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 animate-in fade-in duration-200">
			<div className="bg-white rounded-xl shadow-2xl w-full max-w-sm overflow-hidden animate-in zoom-in-95 duration-200">
				<div className="px-6 py-4 border-b border-gray-200 flex items-center justify-between">
					<h3 className="text-lg font-bold text-gray-900">Export Chat</h3>
					<button
						onClick={onClose}
						className="p-2 hover:bg-gray-100 rounded-lg"
					>
						<X className="w-5 h-5 text-gray-400" />
					</button>
				</div>

				<div className="p-6 space-y-3">
					<p className="text-sm text-gray-500 mb-4">
						Select a format to download the full conversation history.
					</p>

					<button
						onClick={() => handleExport('txt')}
						disabled={!!downloading}
						className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-all group"
					>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-lg bg-blue-100 flex items-center justify-center">
								<FileText className="w-5 h-5 text-blue-600" />
							</div>
							<div className="text-left">
								<p className="font-medium text-gray-900">Text File (.txt)</p>
								<p className="text-xs text-gray-500">Readable transcript</p>
							</div>
						</div>
						{downloading === 'txt' ? (
							<Loader2 className="w-5 h-5 text-blue-600 animate-spin" />
						) : (
							<Download className="w-5 h-5 text-gray-300 group-hover:text-blue-600" />
						)}
					</button>

					<button
						onClick={() => handleExport('json')}
						disabled={!!downloading}
						className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 border border-gray-200 rounded-lg transition-all group"
					>
						<div className="flex items-center gap-3">
							<div className="w-10 h-10 rounded-lg bg-yellow-100 flex items-center justify-center">
								<FileJson className="w-5 h-5 text-yellow-600" />
							</div>
							<div className="text-left">
								<p className="font-medium text-gray-900">JSON Data (.json)</p>
								<p className="text-xs text-gray-500">Machine readable</p>
							</div>
						</div>
						{downloading === 'json' ? (
							<Loader2 className="w-5 h-5 text-yellow-600 animate-spin" />
						) : (
							<Download className="w-5 h-5 text-gray-300 group-hover:text-yellow-600" />
						)}
					</button>
				</div>
			</div>
		</div>
	)
}
