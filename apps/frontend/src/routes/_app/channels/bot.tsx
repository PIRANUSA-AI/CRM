import { createFileRoute, Link } from '@tanstack/react-router'
import { useState } from 'react'
import { ChevronLeft, Bot, ExternalLink } from 'lucide-react'

export const Route = createFileRoute('/_app/channels/bot')({
	component: BotChannelPage,
})

function BotChannelPage() {
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
						<div className="w-8 h-8 rounded-lg bg-violet-500 flex items-center justify-center">
							<Bot className="text-white" size={18} />
						</div>
						<h1 className="text-2xl font-bold text-gray-900">
							Bot Integration
						</h1>
					</div>
				</div>

				{/* Content */}
				<div className="flex-1 overflow-y-auto p-6 pt-3">
					<div className="text-center py-12">
						<div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-violet-100 mb-4">
							<Bot className="text-violet-500" size={32} />
						</div>
						<h3 className="text-lg font-medium text-gray-900 mb-2">
							Connect AI Bots
						</h3>
						<p className="text-gray-500 mb-6 max-w-md mx-auto">
							Integrate external bots (Dialogflow, Rasa, etc.) to handle
							conversations automatically.
						</p>
						<button className="px-4 py-2 bg-violet-500 text-white rounded-lg hover:bg-violet-600 transition font-medium">
							Add New Bot
						</button>
					</div>
				</div>
			</div>
		</div>
	)
}
