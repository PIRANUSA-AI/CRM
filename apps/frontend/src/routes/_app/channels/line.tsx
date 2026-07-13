import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronLeft, MessageSquare, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/_app/channels/line')({
	component: LineChannelPage,
})

function LineChannelPage() {
	return (
		<div className="flex h-screen bg-gray-50">
			<div className="flex-1 flex flex-col overflow-hidden">
				{/* Header */}
				<div className="bg-white p-6 pb-0">
					<div className="flex items-center gap-2 text-sm text-teal-600 mb-4">
						<Link
							to="/integration"
							className="hover:underline flex items-center gap-1"
						>
							<ChevronLeft size={16} />
							Integration
						</Link>
					</div>
					<div className="flex items-center gap-3 mb-4">
						<div className="w-8 h-8 rounded-lg bg-green-400 flex items-center justify-center">
							<MessageSquare className="text-white" size={18} />
						</div>
						<h1 className="text-2xl font-bold text-gray-900">
							LINE Official Account
						</h1>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					<div className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6">
						<p className="text-sm text-gray-700">
							Connect your LINE Official Account to manage customer chats.
						</p>
					</div>

					<div className="text-center py-12">
						<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-green-100 mb-4">
							<MessageSquare className="text-green-500" size={32} />
						</div>
						<h3 className="text-lg font-medium text-gray-900 mb-2">
							No LINE Accounts Connected
						</h3>
						<p className="text-gray-500 mb-6 max-w-md mx-auto">
							Connect your LINE Official Account to start receiving messages.
						</p>
						<button className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 transition font-medium">
							Connect LINE Account
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
