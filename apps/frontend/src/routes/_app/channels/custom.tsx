import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronLeft, Globe, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/_app/channels/custom')({
	component: CustomChannelPage,
})

function CustomChannelPage() {
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
						<div className="w-8 h-8 rounded-lg bg-teal-500 flex items-center justify-center">
							<Globe className="text-white" size={18} />
						</div>
						<h1 className="text-2xl font-bold text-gray-900">Custom Channel</h1>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					<div className="text-center py-12">
						<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-teal-100 mb-4">
							<Globe className="text-teal-500" size={32} />
						</div>
						<h3 className="text-lg font-medium text-gray-900 mb-2">
							Build Your Own Channel
						</h3>
						<p className="text-gray-500 mb-6 max-w-md mx-auto">
							Use our API to connect any custom source (Email, SMS,
							Marketplaces) to your inbox.
						</p>
						<button className="px-4 py-2 bg-teal-500 text-white rounded-lg hover:bg-teal-600 transition font-medium">
							View API Documentation
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
