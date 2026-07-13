import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { MessageCircle, Plus, Zap } from 'lucide-react'
import PageHeader from '@/components/PageHeader'

export const Route = createFileRoute('/_app/integration')({
	component: IntegrationPage,
})

function IntegrationPage() {
	const navigate = useNavigate()

	return (
		<div className="flex-1 flex flex-col h-full bg-white overflow-hidden">
			<PageHeader
				title="Connect Channels"
				description="CRM currently supports WhatsApp integration only."
				icon={<Zap size={24} />}
			/>

			<div className="flex-1 overflow-y-auto px-4 lg:px-8 pb-10">
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl">
					<div
						onClick={() =>
							navigate({
								to: '/channels/whatsapp',
							} as any)
						}
						className="bg-white border border-gray-100 rounded-2xl p-6 shadow-sm flex flex-col hover:shadow-md transition-all cursor-pointer group"
					>
						<div className="flex items-center justify-between mb-6">
							<div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center text-white shadow-lg shadow-black/5">
								<MessageCircle size={28} />
							</div>
							<div className="px-3 py-1 text-[10px] font-black uppercase tracking-widest rounded-full border transition-colors bg-gray-50 text-gray-400 border-gray-100 group-hover:bg-emerald-50 group-hover:text-emerald-600 group-hover:border-emerald-100">
								Setup Required
							</div>
						</div>

						<h3 className="text-lg font-bold text-gray-900 mb-2 leading-tight">
							WhatsApp
						</h3>
						<p className="text-sm text-gray-500 leading-relaxed mb-8 flex-1">
							Connect your WhatsApp Business Account and manage conversations in
							a single inbox.
						</p>

						<div className="flex items-center justify-between pt-4 border-t border-gray-50">
							<span className="text-xs font-bold transition-colors text-gray-400 group-hover:text-emerald-500">
								Configure Channel
							</span>
							<div className="w-8 h-8 rounded-lg flex items-center justify-center transition-all bg-gray-50 text-gray-400 group-hover:bg-emerald-500 group-hover:text-white transform group-hover:translate-x-1">
								<Plus size={16} />
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
