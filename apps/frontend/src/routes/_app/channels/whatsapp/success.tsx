import { createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import { CheckCircle2, MessageCircle, ArrowRight } from 'lucide-react'

import { z } from 'zod'

const searchSchema = z.object({
	channelId: z.string().optional(),
})

export const Route = createFileRoute('/_app/channels/whatsapp/success')(
	{
		validateSearch: (search) => searchSchema.parse(search),
		component: WhatsAppSuccessPage,
	},
)

function WhatsAppSuccessPage() {
	const { channelId } = Route.useSearch()
	const [countdown, setCountdown] = useState(5)

	useEffect(() => {
		// 1. Notify the opener immediately
		if (window.opener) {
			window.opener.postMessage({ type: 'WA_CONNECTED', channelId }, '*')
		}

		// 2. Countdown to close
		const timer = setInterval(() => {
			setCountdown((prev) => {
				if (prev <= 1) {
					clearInterval(timer)
					window.close()
					return 0
				}
				return prev - 1
			})
		}, 1000)

		return () => clearInterval(timer)
	}, [channelId])

	return (
		<div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-6 text-center">
			<div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full border border-gray-100 flex flex-col items-center">
				<div className="w-20 h-20 bg-green-100 rounded-full flex items-center justify-center mb-6 animate-bounce">
					<CheckCircle2 size={40} className="text-green-600" />
				</div>

				<h1 className="text-2xl font-bold text-gray-900 mb-2">
					Integration Successful!
				</h1>
				<p className="text-gray-600 mb-8">
					Your WhatsApp Business Account has been successfully connected to
					CRM.
				</p>

				<div className="bg-emerald-50 rounded-xl p-4 w-full flex items-center gap-4 mb-8">
					<div className="w-10 h-10 bg-green-500 rounded-lg flex items-center justify-center shrink-0">
						<MessageCircle className="text-white" size={20} />
					</div>
					<div className="text-left">
						<p className="text-sm font-medium text-gray-900 leading-none">
							WhatsApp Connected
						</p>
						<p className="text-xs text-green-700 mt-1">
							Ready to sync templates & messages
						</p>
					</div>
				</div>

				<div className="flex flex-col gap-3 w-full">
					<button
						onClick={() => window.close()}
						className="w-full bg-teal-600 text-white font-bold py-3 rounded-xl hover:bg-teal-700 transition shadow-lg shadow-teal-500/20 flex items-center justify-center gap-2"
					>
						Success! Close this Window
						<ArrowRight size={18} />
					</button>

					<div className="flex items-center justify-center gap-2 text-sm text-gray-400 mt-2">
						<span>Redirecting in</span>
						<span className="font-bold text-teal-600 tabular-nums">
							{countdown}s
						</span>
					</div>
				</div>

				<div className="mt-6 w-full h-1 bg-gray-100 rounded-full overflow-hidden">
					<div
						className="h-full bg-teal-500 transition-all duration-1000 ease-linear"
						style={{ width: `${(countdown / 5) * 100}%` }}
					/>
				</div>
			</div>
		</div>
	)
}
