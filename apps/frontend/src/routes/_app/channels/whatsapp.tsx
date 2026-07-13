import {
	createFileRoute,
	Link,
	Outlet,
	useMatches,
	useNavigate,
} from '@tanstack/react-router'
import { ChevronLeft, ExternalLink, MessageCircle, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppConnectModal } from '@/components/whatsapp/WhatsAppConnectModal'
import { WhatsAppProviderBadge } from '@/components/whatsapp/WhatsAppProviderBadge'
import { API_BASE } from '@/lib/api'

export const Route = createFileRoute('/_app/channels/whatsapp')({
	component: WhatsAppChannelsLayout,
})

interface Inbox {
	id: string
	name: string
	phone_number: string
	channel_tag: string
	is_active: boolean
	business_name: string
	badge_url?: string
	provider?: string | null
	baileys_session_status?: string | null
	baileys_is_connected?: boolean | null
	extended_metadata?: {
		tags?: string[]
		profile_picture_url?: string
		[key: string]: unknown
	}
}

function getBaileysSessionLabel(status: string | null | undefined) {
	switch (String(status || '').trim().toLowerCase()) {
		case 'connected':
			return 'Connected'
		case 'pairing_code_ready':
			return 'Pairing Code Ready'
		case 'qr_ready':
			return 'QR Ready'
		case 'reconnecting':
			return 'Reconnecting'
		case 'restarting':
			return 'Restarting'
		case 'connecting':
			return 'Connecting'
		case 'logged_out':
			return 'Logged Out'
		case 'disconnected':
			return 'Disconnected'
		case 'disabled':
			return 'Disabled'
		case 'error':
			return 'Error'
		default:
			return 'Pending'
	}
}

function getBaileysSessionTone(status: string | null | undefined) {
	switch (String(status || '').trim().toLowerCase()) {
		case 'connected':
			return 'border-emerald-200 bg-emerald-50 text-emerald-700'
		case 'pairing_code_ready':
		case 'qr_ready':
			return 'border-sky-200 bg-sky-50 text-sky-700'
		case 'connecting':
		case 'reconnecting':
		case 'restarting':
			return 'border-amber-200 bg-amber-50 text-amber-700'
		case 'logged_out':
		case 'disconnected':
		case 'disabled':
		case 'error':
			return 'border-rose-200 bg-rose-50 text-rose-700'
		default:
			return 'border-gray-200 bg-gray-50 text-gray-600'
	}
}

function getApiHeaders(): HeadersInit {
	if (typeof localStorage === 'undefined') return {}

	const token = localStorage.getItem('scalechat_token')
	const orgSlug = localStorage.getItem('scalechat_org_slug')
	const appId = localStorage.getItem('scalechat_app_id')

	return {
		...(token && { Authorization: `Bearer ${token}` }),
		...(orgSlug && { 'X-Org-Slug': orgSlug }),
		...(appId && { 'X-App-Id': appId }),
	}
}

function WhatsAppChannelsLayout() {
	const navigate = useNavigate()
	const matches = useMatches()
	const isDetailMode = matches.some(
		(match) =>
			match.routeId.endsWith('$channelId') || match.routeId.endsWith('success'),
	)

	const [channels, setChannels] = useState<Inbox[]>([])
	const [loading, setLoading] = useState(true)
	const [searchQuery, setSearchQuery] = useState('')
	const [showConnectModal, setShowConnectModal] = useState(false)

	const loadChannels = useCallback(async () => {
		try {
			const response = await fetch(`${API_BASE}/whatsapp-channels`, {
				headers: getApiHeaders(),
			})
			const payload = await response.json()
			setChannels(payload.data || [])
		} catch (error) {
			console.error('Failed to load channels:', error)
			toast.error('Failed to load WhatsApp channels')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		if (!isDetailMode) {
			void loadChannels()
		}
	}, [isDetailMode, loadChannels])

	const toggleChannel = async (id: string) => {
		try {
			await fetch(`${API_BASE}/whatsapp-channels/${id}/toggle`, {
				method: 'POST',
				headers: getApiHeaders(),
			})
			void loadChannels()
		} catch (error) {
			console.error('Failed to toggle channel:', error)
			toast.error('Failed to update channel status')
		}
	}

	const navigateToChannel = useCallback(
		(channelId: string) => {
			navigate({
				to: '/channels/whatsapp/$channelId',
				params: { channelId },
			})
		},
		[navigate],
	)

	if (isDetailMode) {
		return <Outlet />
	}

	const filteredChannels = channels.filter((channel) => {
		const haystack =
			`${channel.name || ''} ${channel.business_name || ''} ${channel.phone_number || ''}`.toLowerCase()
		return haystack.includes(searchQuery.trim().toLowerCase())
	})

	return (
		<div className="flex h-full flex-1 flex-col overflow-hidden bg-background">
			<div className="flex flex-1 flex-col overflow-hidden">
				<div className="bg-card p-6 pb-0">
					<div className="mb-4 flex items-center gap-2 text-sm text-teal-600">
						<Link
							to="/integration"
							className="flex items-center gap-1 hover:underline"
						>
							<ChevronLeft size={16} />
							Integration
						</Link>
					</div>
					<div className="mb-4 flex items-center gap-3">
						<div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-500">
							<MessageCircle className="text-white" size={18} />
						</div>
						<h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
					</div>
				</div>

				<div className="flex-1 overflow-y-auto p-6 pt-3">
					<div className="mb-6 rounded-lg border border-emerald-200 bg-emerald-50 p-4">
						<p className="text-sm text-gray-700">
							Kelola dua jalur integrasi WhatsApp dalam satu tempat: Official
							WABA dan Non Official (Baileys).
						</p>
					</div>

					<div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
						<div className="relative w-full sm:max-w-sm">
							<Search
								className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
								size={18}
							/>
							<input
								type="text"
								placeholder="Search channel name"
								value={searchQuery}
								onChange={(event) => setSearchQuery(event.target.value)}
								className="w-full rounded-lg border border-gray-300 py-2 pl-10 pr-4 focus:outline-none focus:ring-2 focus:ring-teal-500"
							/>
						</div>
						<button
							onClick={() => setShowConnectModal(true)}
							className="inline-flex w-full items-center justify-center gap-2 whitespace-nowrap rounded-lg bg-teal-600 px-4 py-2 text-white transition hover:bg-teal-700 sm:w-auto"
						>
							<Plus size={18} />
							New Integration
						</button>
					</div>

					{loading ? (
						<div className="rounded-lg border border-gray-200 bg-white p-12 text-center text-gray-500">
							Loading channels...
						</div>
					) : filteredChannels.length === 0 ? (
						<div className="rounded-xl border border-dashed border-gray-300 bg-white py-16">
							<div className="flex flex-col items-center justify-center text-center">
								<MessageCircle className="mb-4 h-12 w-12 text-gray-400" />
								<h3 className="mb-2 text-lg font-semibold text-gray-900">
									No channels found
								</h3>
								<p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
									{searchQuery
										? `We couldn't find any WhatsApp accounts matching "${searchQuery}"`
										: 'Connect your first Official WABA or Baileys bridge to start messaging.'}
								</p>
								{!searchQuery ? (
									<button
										onClick={() => setShowConnectModal(true)}
										className="flex items-center gap-2 rounded-lg bg-emerald-600 px-6 py-2 font-medium text-white shadow-sm transition hover:bg-emerald-700"
									>
										<Plus size={18} />
										New Integration
									</button>
								) : null}
							</div>
						</div>
					) : (
						<div className="rounded-lg border border-gray-200 bg-white">
							<div className="overflow-x-auto">
								<table className="w-full min-w-[760px]">
									<thead>
										<tr className="border-b border-gray-200">
											<th className="px-6 py-4 text-left text-sm font-medium text-gray-500">
												WhatsApp Account
											</th>
											<th className="px-6 py-4 text-left text-sm font-medium text-gray-500">
												Phone Number
											</th>
											<th className="px-6 py-4 text-left text-sm font-medium text-gray-500">
												Provider
											</th>
											<th className="px-6 py-4 text-right text-sm font-medium text-gray-500">
												Action
											</th>
										</tr>
									</thead>
									<tbody>
										{filteredChannels.map((channel) => (
											<tr
												key={channel.id}
												className="group/row border-b border-gray-100 hover:bg-gray-50"
											>
												<td className="px-6 py-4">
													<Link
														to="/channels/whatsapp/$channelId"
														params={{ channelId: channel.id }}
														className="group flex items-start gap-3"
													>
														<div className="mt-0.5 shrink-0">
															{channel.badge_url ||
															channel.extended_metadata?.profile_picture_url ? (
																<img
																	src={
																		channel.badge_url ||
																		channel.extended_metadata?.profile_picture_url
																	}
																	alt={channel.name}
																	className="h-10 w-10 rounded-full border border-gray-100 object-cover shadow-sm transition-transform group-hover:scale-105"
																/>
															) : (
																<div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 shadow-sm transition-colors group-hover:bg-green-600">
																	<MessageCircle
																		className="text-green-600 transition-colors group-hover:text-white"
																		size={20}
																	/>
																</div>
															)}
														</div>
														<div className="flex flex-col">
															<span className="flex items-center gap-1.5 font-semibold text-gray-900 transition-colors group-hover:text-teal-600">
																{channel.name || channel.business_name || 'WhatsApp'}
																<ExternalLink
																	size={12}
																	className="opacity-0 transition-opacity group-hover:opacity-100"
																/>
															</span>
															{channel.extended_metadata?.tags &&
															channel.extended_metadata.tags.length > 0 ? (
																<div className="mt-1 flex flex-wrap gap-1">
																	{channel.extended_metadata.tags
																		.slice(0, 3)
																		.map((tag: string, index: number) => (
																			<span
																				key={index}
																				className="rounded border border-gray-200 bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-600"
																			>
																				{tag}
																			</span>
																		))}
																</div>
															) : (
																<span className="mt-0.5 text-xs text-gray-400">
																	{channel.business_name || channel.id.substring(0, 8)}
																</span>
															)}
														</div>
													</Link>
												</td>
												<td className="px-6 py-4">
													<span className="rounded-md border border-gray-100 bg-gray-50 px-2 py-1 text-sm font-medium text-gray-500">
														{channel.phone_number || 'No Number'}
													</span>
												</td>
												<td className="px-6 py-4">
													<div className="flex flex-wrap items-center gap-2">
														<WhatsAppProviderBadge provider={channel.provider} />
														{channel.provider === 'baileys' ? (
															<span
																className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getBaileysSessionTone(channel.baileys_session_status)}`}
															>
																Sesi: {getBaileysSessionLabel(channel.baileys_session_status)}
															</span>
														) : null}
													</div>
												</td>
												<td className="px-6 py-4 text-right">
													<button
														onClick={() => toggleChannel(channel.id)}
														className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
															channel.is_active ? 'bg-teal-500' : 'bg-gray-300'
														}`}
													>
														<span
															className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
																channel.is_active
																	? 'translate-x-6'
																	: 'translate-x-1'
															}`}
														/>
													</button>
												</td>
											</tr>
										))}
									</tbody>
								</table>
							</div>
						</div>
					)}
				</div>
			</div>

			<WhatsAppConnectModal
				open={showConnectModal}
				onClose={() => setShowConnectModal(false)}
				onSuccess={() => loadChannels()}
				onContinue={(channelId) => {
					setShowConnectModal(false)
					navigateToChannel(channelId)
				}}
			/>
		</div>
	)
}
