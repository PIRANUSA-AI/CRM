import { createFileRoute, useNavigate } from '@tanstack/react-router'
import { MessageCircle, Plus } from 'lucide-react'

export const Route = createFileRoute('/_app/integration')({
	component: IntegrationPage,
})

function IntegrationPage() {
	const navigate = useNavigate()

	return (
		<div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
			<div className="flex-1 overflow-y-auto px-4 pb-10 pt-6 lg:px-8">
				<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6 max-w-7xl">
					<div
						onClick={() =>
							navigate({
								to: '/channels/whatsapp',
							} as any)
						}
						className="group flex cursor-pointer flex-col rounded-2xl border border-border bg-card p-6 shadow-sm transition-all hover:shadow-md"
					>
						<div className="flex items-center justify-between mb-6">
							<div className="w-14 h-14 rounded-2xl bg-green-500 flex items-center justify-center text-white shadow-lg shadow-black/5">
								<MessageCircle size={28} />
							</div>
							<div className="rounded-full border border-border bg-muted px-3 py-1 text-[10px] font-black uppercase tracking-widest text-muted-foreground transition-colors group-hover:border-emerald-500/25 group-hover:bg-emerald-500/10 group-hover:text-emerald-700 dark:group-hover:text-emerald-300">
								Setup Required
							</div>
						</div>

						<h3 className="mb-2 text-lg font-bold leading-tight text-foreground">
							WhatsApp
						</h3>
						<p className="mb-8 flex-1 text-sm leading-relaxed text-muted-foreground">
							Connect your WhatsApp Business Account and manage conversations in
							a single inbox.
						</p>

						<div className="flex items-center justify-between border-t border-border pt-4">
							<span className="text-xs font-bold text-muted-foreground transition-colors group-hover:text-emerald-600 dark:group-hover:text-emerald-400">
								Configure Channel
							</span>
							<div className="flex size-8 transform items-center justify-center rounded-lg bg-muted text-muted-foreground transition-all group-hover:translate-x-1 group-hover:bg-emerald-500 group-hover:text-white">
								<Plus size={16} />
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	)
}
