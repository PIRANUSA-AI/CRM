import { MessageCircle, Plus, Search } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { WhatsAppConnectModal } from '@/components/whatsapp/WhatsAppConnectModal'
import { WhatsAppProviderBadge } from '@/components/whatsapp/WhatsAppProviderBadge'
import { Button } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { API_BASE } from '@/lib/api'

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
	baileys_last_error?: string | null
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
	const token =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_token')
			: null
	const orgSlug =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_org_slug')
			: null
	const appId =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_app_id')
			: null

	return {
		...(token && { Authorization: `Bearer ${token}` }),
		...(orgSlug && { 'X-Org-Slug': orgSlug }),
		...(appId && { 'X-App-Id': appId }),
	}
}

export default function WhatsAppSettingsManager() {
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
			toast.error('Gagal memuat channel WhatsApp')
		} finally {
			setLoading(false)
		}
	}, [])

	useEffect(() => {
		void loadChannels()
	}, [loadChannels])

	const toggleChannel = async (id: string) => {
		try {
			await fetch(`${API_BASE}/whatsapp-channels/${id}/toggle`, {
				method: 'POST',
				headers: getApiHeaders(),
			})
			toast.success('Status channel berhasil diperbarui')
			void loadChannels()
		} catch (error) {
			console.error('Failed to toggle channel:', error)
			toast.error('Gagal memperbarui status channel')
		}
	}

	const filteredChannels = channels.filter((channel) => {
		const haystack =
			`${channel.name || ''} ${channel.business_name || ''} ${channel.phone_number || ''}`.toLowerCase()
		return haystack.includes(searchQuery.trim().toLowerCase())
	})

	return (
		<div className="space-y-6">
			<Card className="overflow-hidden border-gray-100 shadow-sm">
				<CardHeader className="border-b border-gray-100 bg-gray-50/50 px-6 py-4">
					<div className="flex items-center justify-between">
						<div className="flex items-center gap-2">
							<MessageCircle size={20} className="text-emerald-600" />
							<CardTitle className="text-lg font-bold">
								WhatsApp Channels
							</CardTitle>
						</div>
						<Button
							onClick={() => setShowConnectModal(true)}
							className="h-9 bg-emerald-500 px-4 font-bold text-white hover:bg-emerald-600"
						>
							<Plus size={16} className="mr-2" />
							Connect Channel
						</Button>
					</div>
					<CardDescription>
						Kelola channel WhatsApp resmi dan Baileys non official untuk
						menerima pesan.
					</CardDescription>
				</CardHeader>
				<CardContent className="p-6">
					{loading ? (
						<div className="flex items-center justify-center py-12">
							<div className="h-8 w-8 animate-spin rounded-full border-4 border-emerald-500 border-t-transparent" />
						</div>
					) : channels.length === 0 ? (
						<div className="flex flex-col items-center justify-center py-12 text-center">
							<MessageCircle size={48} className="mb-4 text-gray-300" />
							<h4 className="mb-1 font-bold text-gray-900">Belum Ada Channel</h4>
							<p className="mb-4 max-w-sm text-sm text-gray-500">
								Connect Official WABA atau Non Official (Baileys) untuk mulai
								menerima pesan.
							</p>
							<Button
								onClick={() => setShowConnectModal(true)}
								variant="outline"
								className="font-bold"
							>
								<Plus size={16} className="mr-2" />
								Connect Channel
							</Button>
						</div>
					) : (
						<>
							<div className="relative mb-4 w-full sm:max-w-sm">
								<Search
									className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
									size={18}
								/>
								<Input
									type="text"
									placeholder="Cari channel..."
									value={searchQuery}
									onChange={(event) => setSearchQuery(event.target.value)}
									className="pl-9"
								/>
							</div>
							<div className="space-y-3">
								{filteredChannels.map((channel) => (
									<div
										key={channel.id}
										className="flex items-center justify-between rounded-xl border border-gray-100 p-4 transition-colors hover:bg-gray-50"
									>
										<div className="flex items-center gap-3">
											<div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-green-100">
												{channel.badge_url ? (
													<img
														src={channel.badge_url}
														alt={channel.name}
														className="h-full w-full object-cover"
													/>
												) : (
													<MessageCircle size={20} className="text-green-600" />
												)}
											</div>
										<div className="space-y-1">
											<div className="flex flex-wrap items-center gap-2">
												<p className="font-bold text-gray-900">
													{channel.name || channel.business_name || 'WhatsApp'}
												</p>
												<WhatsAppProviderBadge provider={channel.provider} />
												{channel.provider === 'baileys' ? (
													<span
														className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-[11px] font-semibold ${getBaileysSessionTone(channel.baileys_session_status)}`}
													>
														Sesi: {getBaileysSessionLabel(channel.baileys_session_status)}
													</span>
												) : null}
											</div>
											<p className="text-xs text-gray-500">
												{channel.phone_number}
											</p>
											{channel.provider === 'baileys' &&
											channel.baileys_session_status &&
											channel.baileys_session_status !== 'connected' ? (
												<p className="text-xs text-gray-500">
													{channel.baileys_session_status === 'qr_ready'
														? 'Channel sudah diaktifkan, tapi perangkat masih menunggu scan QR.'
														: channel.baileys_session_status === 'pairing_code_ready'
															? 'Channel sudah diaktifkan, tapi perangkat masih menunggu pairing code.'
															: 'Channel sudah diaktifkan, tetapi sesi perangkat belum fully connected.'}
												</p>
											) : null}
										</div>
									</div>
									<div className="flex items-center gap-3">
											<Button
												variant={channel.is_active ? 'default' : 'outline'}
												size="sm"
												onClick={() => toggleChannel(channel.id)}
												className={
													channel.is_active
														? 'bg-emerald-500 text-white hover:bg-emerald-600'
														: ''
												}
											>
												{channel.is_active ? 'Diaktifkan' : 'Nonaktif'}
											</Button>
											<Button
												variant="outline"
												size="sm"
												onClick={() => {
													window.location.href = `/channels/whatsapp/${channel.id}`
												}}
											>
												Pengaturan
											</Button>
										</div>
									</div>
								))}
							</div>
						</>
					)}
				</CardContent>
			</Card>

			<WhatsAppConnectModal
				open={showConnectModal}
				onClose={() => setShowConnectModal(false)}
				onSuccess={() => loadChannels()}
				onContinue={(channelId) => {
					setShowConnectModal(false)
					window.location.href = `/channels/whatsapp/${channelId}`
				}}
			/>
		</div>
	)
}
