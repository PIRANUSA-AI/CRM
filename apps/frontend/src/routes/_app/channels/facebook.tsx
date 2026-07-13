import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { Search, Plus, ChevronLeft, Facebook, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/_app/channels/facebook')({
	component: FacebookChannelPage,
})

function FacebookChannelPage() {
	const [loading, setLoading] = useState(false)

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
						<div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
							<Facebook className="text-white" size={18} />
						</div>
						<h1 className="text-2xl font-bold text-gray-900">Facebook Page</h1>
					</div>
					<div className="flex gap-4 border-b border-gray-200">
						<button className="pb-3 px-1 font-medium text-sm text-gray-900 border-b-2 border-gray-900">
							Connected Pages
						</button>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					<div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-6">
						<p className="text-sm text-gray-700">
							Connect your Facebook Pages to manage messages directly.{' '}
							<a href="#" className="text-blue-600 hover:underline">
								Learn more
							</a>
							.
						</p>
					</div>

					<div className="text-center py-12">
						<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-blue-100 mb-4">
							<Facebook className="text-blue-600" size={32} />
						</div>
						<h3 className="text-lg font-medium text-gray-900 mb-2">
							No Facebook Pages Connected
						</h3>
						<p className="text-gray-500 mb-6 max-w-md mx-auto">
							Connect your Facebook page to start receiving messages in your
							omnichannel inbox.
						</p>
						<button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition font-medium">
							Connect Facebook Page
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
