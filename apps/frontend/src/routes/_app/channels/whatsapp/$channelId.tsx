import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useState, useEffect, useRef } from 'react'
import QRCode from 'qrcode'
import {
	ChevronLeft,
	RefreshCw,
	Unlink,
	Phone,
	AlertTriangle,
	TrendingUp,
	Settings,
	ShieldCheck,
	Upload,
	X,
	Users,
	Shuffle,
	ChevronDown,
	Check,
	Search,
} from 'lucide-react'
import { whatsappChannels, teams, agents } from '@/lib/api'
import {
	WhatsAppProviderBadge,
	normalizeWhatsappProviderLabel,
} from '@/components/whatsapp/WhatsAppProviderBadge'

type BaileysSessionState = {
	channelId: string
	providerChannelKey: string
	phoneNumber: string | null
	status: string
	pairingCode: string | null
	qrCode: string | null
	lastError: string | null
	lastConnectedAt: string | null
	lastSeenAt: string | null
	isConnected: boolean
}

function normalizeBaileysSessionStatusLabel(status: string | null | undefined) {
	switch (
		String(status || '')
			.trim()
			.toLowerCase()
	) {
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
		case 'error':
			return 'Attention Needed'
		default:
			return status ? String(status) : 'Pending'
	}
}

function getBaileysStatusToneClasses(status: string | null | undefined) {
	switch (
		String(status || '')
			.trim()
			.toLowerCase()
	) {
		case 'connected':
			return 'bg-emerald-100 text-emerald-800 border-emerald-200'
		case 'pairing_code_ready':
		case 'qr_ready':
			return 'bg-blue-100 text-blue-800 border-blue-200'
		case 'connecting':
		case 'reconnecting':
		case 'restarting':
			return 'bg-amber-100 text-amber-800 border-amber-200'
		case 'logged_out':
		case 'disconnected':
		case 'error':
			return 'bg-red-100 text-red-800 border-red-200'
		default:
			return 'bg-gray-100 text-gray-700 border-gray-200'
	}
}

function getBaileysStatusDescription(session: BaileysSessionState | null) {
	switch (
		String(session?.status || '')
			.trim()
			.toLowerCase()
	) {
		case 'connected':
			return 'Perangkat WhatsApp sudah terhubung dan siap kirim-terima pesan lewat service Baileys.'
		case 'pairing_code_ready':
			return 'Masukkan pairing code ini dari WhatsApp utama melalui menu Linked Devices untuk menautkan perangkat.'
		case 'qr_ready':
			return 'Scan QR code ini dari WhatsApp utama melalui menu Linked Devices untuk menautkan perangkat.'
		case 'connecting':
		case 'reconnecting':
		case 'restarting':
			return 'Service Baileys sedang menyiapkan atau menyambungkan ulang sesi ini.'
		case 'logged_out':
			return 'Sesi sebelumnya sudah logout. Jalankan restart session untuk meminta QR atau pairing code baru.'
		case 'disconnected':
			return 'Sesi sedang tidak aktif. Jalankan restart session untuk menyambungkan ulang perangkat.'
		case 'error':
			return 'Service sempat gagal menyelesaikan proses pairing. Cek catatan error di bawah dan restart session bila perlu.'
		default:
			return 'CRM sedang menunggu status terbaru dari service Baileys.'
	}
}

function formatOptionalDateTime(value: string | null | undefined) {
	if (!value) return '-'
	const parsed = new Date(value)
	if (Number.isNaN(parsed.getTime())) return value
	return parsed.toLocaleString()
}

export const Route = createFileRoute('/_app/channels/whatsapp/$channelId')({
	component: WhatsAppChannelDetailPage,
})

function WhatsAppChannelDetailPage() {
	const routeParams = Route.useParams({ strict: false }) as {
		channelId: string
	}
	const { channelId } = routeParams
	const navigate = useNavigate()
	const [channel, setChannel] = useState<any>(null)
	const [loading, setLoading] = useState(true)
	const [syncing, setSyncing] = useState(false)
	const [loadingBaileysSession, setLoadingBaileysSession] = useState(false)
	const [restartingBaileysSession, setRestartingBaileysSession] =
		useState(false)
	const [baileysSession, setBaileysSession] =
		useState<BaileysSessionState | null>(null)
	const [baileysQrPreviewUrl, setBaileysQrPreviewUrl] = useState<string | null>(
		null,
	)
	const [activeTab, setActiveTab] = useState<'overview' | 'quality'>('overview')

	useEffect(() => {
		loadChannelDetails()
	}, [channelId])

	const loadChannelDetails = async () => {
		try {
			setLoading(true)
			const res = await whatsappChannels.getDetails(channelId)
			setChannel(res.data)
		} catch (error) {
			console.error('Failed to load channel:', error)
		} finally {
			setLoading(false)
		}
	}

	const loadBaileysSession = async (options?: { silent?: boolean }) => {
		if (!channelId) return

		try {
			if (!options?.silent) {
				setLoadingBaileysSession(true)
			}
			const response = await whatsappChannels.getBaileysSession(channelId)
			setBaileysSession(response.data)
		} catch (error) {
			console.error('Failed to load Baileys session:', error)
			if (!options?.silent) {
				setBaileysSession(null)
			}
		} finally {
			if (!options?.silent) {
				setLoadingBaileysSession(false)
			}
		}
	}

	const [isEditing, setIsEditing] = useState(false)
	const [editName, setEditName] = useState('')
	const [editTags, setEditTags] = useState('')
	const [saving, setSaving] = useState(false)

	// Configuration state
	const [availableTeams, setAvailableTeams] = useState<any[]>([])
	const [availableAgents, setAvailableAgents] = useState<any[]>([])

	const [selectedTeams, setSelectedTeams] = useState<string[]>([])
	const [selectedAgents, setSelectedAgents] = useState<string[]>([])
	const [distributionMethod, setDistributionMethod] = useState<
		'round_robin' | 'least_assigned'
	>('round_robin')

	const [showTeamsDropdown, setShowTeamsDropdown] = useState(false)
	const [showAgentsDropdown, setShowAgentsDropdown] = useState(false)
	const [showDistributionDropdown, setShowDistributionDropdown] =
		useState(false)
	const [agentSearchQuery, setAgentSearchQuery] = useState('')
	const agentDropdownRef = useRef<HTMLDivElement>(null)

	// Close dropdown when clicking outside
	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			if (
				agentDropdownRef.current &&
				!agentDropdownRef.current.contains(event.target as Node)
			) {
				setShowAgentsDropdown(false)
				setAgentSearchQuery('')
			}
		}
		if (showAgentsDropdown) {
			document.addEventListener('mousedown', handleClickOutside)
		}
		return () => {
			document.removeEventListener('mousedown', handleClickOutside)
		}
	}, [showAgentsDropdown])

	// Fetch available options
	useEffect(() => {
		const fetchOptions = async () => {
			try {
				const [teamsRes, agentsRes] = (await Promise.all([
					teams.list(),
					agents.list(),
				])) as any[]

				setAvailableTeams(
					(teamsRes as any)?.payload || (teamsRes as any)?.data || [],
				)
				setAvailableAgents(
					(agentsRes as any)?.payload || (agentsRes as any)?.data || [],
				)
			} catch (error) {
				console.error('Failed to fetch options:', error)
			}
		}
		fetchOptions()
	}, [])

	// Initialize state when channel loads
	useEffect(() => {
		if (channel) {
			setEditName(channel.name)
			setEditTags(channel.metadata?.tags?.join(', ') || '')
			// Load channel config
			setSelectedTeams(channel.metadata?.default_team_ids || [])
			setSelectedAgents(channel.metadata?.default_agent_ids || [])
			setDistributionMethod(
				channel.metadata?.distribution_method || 'round_robin',
			)
		}
	}, [channel])

	useEffect(() => {
		if (channel?.provider !== 'baileys') {
			setBaileysSession(null)
			return
		}

		let cancelled = false
		let timerId: ReturnType<typeof setTimeout> | null = null

		const pollSession = async () => {
			try {
				const response = await whatsappChannels.getBaileysSession(channelId)
				if (!cancelled) {
					setBaileysSession(response.data)
				}
			} catch (error) {
				if (!cancelled) {
					console.error('Failed to poll Baileys session:', error)
				}
			} finally {
				if (!cancelled) {
					timerId = setTimeout(pollSession, 4000)
				}
			}
		}

		void pollSession()

		return () => {
			cancelled = true
			if (timerId) {
				clearTimeout(timerId)
			}
		}
	}, [channel?.provider, channelId])

	useEffect(() => {
		if (!baileysSession?.qrCode) {
			setBaileysQrPreviewUrl(null)
			return
		}

		let cancelled = false

		void QRCode.toDataURL(baileysSession.qrCode, {
			width: 320,
			margin: 1,
		})
			.then((value) => {
				if (!cancelled) {
					setBaileysQrPreviewUrl(value)
				}
			})
			.catch((error) => {
				console.error('Failed to render Baileys QR preview:', error)
				if (!cancelled) {
					setBaileysQrPreviewUrl(null)
				}
			})

		return () => {
			cancelled = true
		}
	}, [baileysSession?.qrCode])

	const handleSaveSettings = async () => {
		try {
			setSaving(true)
			await whatsappChannels.update(channelId, {
				name: editName,
				tags: editTags
					.split(',')
					.map((t) => t.trim())
					.filter(Boolean),
				default_team_ids: selectedTeams,
				default_agent_ids: selectedAgents,
				distribution_method: distributionMethod,
			})
			setChannel((prev: any) => ({
				...prev,
				name: editName,
				metadata: {
					...prev.metadata,
					tags: editTags
						.split(',')
						.map((t: string) => t.trim())
						.filter(Boolean),
					default_team_ids: selectedTeams,
					default_agent_ids: selectedAgents,
					distribution_method: distributionMethod,
				},
			}))
			setIsEditing(false)
			alert('Settings saved successfully')
		} catch (error) {
			console.error('Failed to save settings:', error)
			alert('Failed to save settings')
		} finally {
			setSaving(false)
		}
	}

	const handleSync = async () => {
		try {
			setSyncing(true)
			if (channel?.provider === 'baileys') {
				await Promise.all([
					loadChannelDetails(),
					loadBaileysSession({ silent: false }),
				])
				return
			}
			await whatsappChannels.sync(channelId)
			await loadChannelDetails()
		} catch (error) {
			console.error('Sync failed:', error)
			alert(
				channel?.provider === 'baileys'
					? 'Failed to refresh Baileys status. Please try again.'
					: 'Failed to sync. Please try again.',
			)
		} finally {
			setSyncing(false)
		}
	}

	const handleRestartBaileysSession = async () => {
		try {
			setRestartingBaileysSession(true)
			await whatsappChannels.restartBaileysSession(channelId)
			await loadBaileysSession({ silent: false })
		} catch (error) {
			console.error('Failed to restart Baileys session:', error)
			alert('Failed to restart Baileys session. Please try again.')
		} finally {
			setRestartingBaileysSession(false)
		}
	}

	const handleDisconnect = async () => {
		if (
			confirm(
				channel?.provider === 'baileys'
					? 'Are you sure you want to disconnect this Baileys channel? This will stop messaging and remove the saved session.'
					: 'Are you sure you want to disconnect this WhatsApp Business Account? This will stop all messaging and remove the connection.',
			)
		) {
			try {
				await whatsappChannels.delete(channelId)
				navigate({
					to: '/channels/whatsapp',
				})
			} catch (error) {
				console.error('Failed to disconnect:', error)
				alert('Failed to disconnect. Please try again.')
			}
		}
	}

	const handleBadgeUpdated = (newBadgeUrl: string | null) => {
		setChannel((prev: any) => ({ ...prev, badge_url: newBadgeUrl }))
	}

	if (loading) {
		return (
			<div className="flex-1 flex items-center justify-center bg-gray-50">
				<div className="text-center">
					<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-emerald-600 mx-auto mb-4"></div>
					<p className="text-gray-600">Loading channel details...</p>
				</div>
			</div>
		)
	}

	if (!channel) {
		return (
			<div className="flex-1 flex items-center justify-center bg-gray-50">
				<div className="text-center">
					<p className="text-gray-600 mb-4">Channel not found</p>
					<Link
						to="/channels/whatsapp"
						className="text-emerald-600 hover:underline"
					>
						Back to WhatsApp Channels
					</Link>
				</div>
			</div>
		)
	}

	const isBaileysChannel = channel.provider === 'baileys'
	const baileysStatusLabel = normalizeBaileysSessionStatusLabel(
		baileysSession?.status,
	)
	const baileysStatusClasses = getBaileysStatusToneClasses(
		baileysSession?.status,
	)

	return (
		<div className="flex-1 flex flex-col h-full bg-gray-50 overflow-hidden">
			{/* Header */}
			<div className="bg-white border-b border-gray-200 p-4 sm:p-6">
				<div className="flex items-center gap-2 text-sm text-emerald-600 mb-4">
					<Link
						to="/channels/whatsapp"
						className="hover:underline flex items-center gap-1"
					>
						<ChevronLeft size={16} />
						WhatsApp Channels
					</Link>
				</div>
				<div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
					<div>
						<div className="flex flex-wrap items-center gap-2">
							<h1 className="text-xl sm:text-2xl font-bold text-gray-900">
								{channel.verified_name ||
									channel.business_name ||
									channel.name ||
									'WhatsApp Channel'}
							</h1>
							<WhatsAppProviderBadge provider={channel.provider} />
							{isBaileysChannel ? (
								<span
									className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${baileysStatusClasses}`}
								>
									{baileysStatusLabel}
								</span>
							) : null}
						</div>
						<p className="text-gray-600 mt-1">{channel.phone_number}</p>
					</div>
					<div className="flex gap-2 w-full sm:w-auto">
						<button
							onClick={handleSync}
							disabled={syncing}
							className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-gray-300 rounded-lg hover:bg-gray-50 transition disabled:opacity-50 text-sm"
						>
							<RefreshCw size={16} className={syncing ? 'animate-spin' : ''} />
							{syncing
								? isBaileysChannel
									? 'Refreshing...'
									: 'Syncing...'
								: isBaileysChannel
									? 'Refresh Status'
									: 'Refresh'}
						</button>
						<button
							onClick={handleDisconnect}
							className="flex-1 sm:flex-none flex items-center justify-center gap-2 px-4 py-2 border border-red-300 text-red-600 rounded-lg hover:bg-red-50 transition text-sm"
						>
							<Unlink size={16} />
							Disconnect
						</button>
					</div>
				</div>
			</div>

			{/* Tabs */}
			<div className="bg-white border-b border-gray-200 px-4 sm:px-6 overflow-x-auto scrollbar-hide">
				<div className="flex gap-2 sm:gap-4 min-w-max">
					<button
						onClick={() => setActiveTab('overview')}
						className={`py-3 px-3 sm:px-4 border-b-2 font-medium text-sm flex items-center gap-2 ${
							activeTab === 'overview'
								? 'border-emerald-600 text-emerald-600'
								: 'border-transparent text-gray-600 hover:text-gray-900'
						}`}
					>
						<Settings size={16} />
						Overview
					</button>
					<button
						onClick={() => setActiveTab('quality')}
						className={`py-3 px-3 sm:px-4 border-b-2 font-medium text-sm flex items-center gap-2 ${
							activeTab === 'quality'
								? 'border-emerald-600 text-emerald-600'
								: 'border-transparent text-gray-600 hover:text-gray-900'
						}`}
					>
						<ShieldCheck size={16} />
						{isBaileysChannel ? 'Health' : 'Quality'}
					</button>
				</div>
			</div>

			{/* Content */}
				<div className="flex-1 overflow-y-auto p-4 sm:p-6 pt-3 space-y-6">
					{activeTab === 'overview' && (
						<div className="space-y-6">
							<div
								className={
									isBaileysChannel
										? 'grid grid-cols-1 items-start gap-6 xl:grid-cols-2'
										: undefined
								}
							>
								{/* Channel Profile Settings */}
								<div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
									<div className="p-4 sm:p-6 border-b border-gray-200 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
										<div>
											<h2 className="text-lg font-semibold">Channel Profile</h2>
											<p className="text-sm text-gray-600">
											Customize how this channel appears in CRM
											</p>
										</div>
										{!isEditing ? (
											<button
												onClick={() => setIsEditing(true)}
												className="text-sm font-medium text-emerald-600 hover:text-emerald-700 w-full sm:w-auto text-left sm:text-right"
											>
												Edit Profile
											</button>
										) : (
											<div className="flex gap-2 w-full sm:w-auto">
												<button
													onClick={() => setIsEditing(false)}
													className="flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-800 border border-gray-300 rounded-lg"
												>
													Cancel
												</button>
												<button
													onClick={handleSaveSettings}
													disabled={saving}
													className="flex-1 sm:flex-none px-3 py-1.5 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50"
												>
													{saving ? 'Saving...' : 'Save'}
												</button>
											</div>
										)}
									</div>
									<div className="p-4 sm:p-6 space-y-6">
										{/* Badge & Name */}
										<div className="flex flex-col sm:flex-row gap-6 items-start">
											<div className="w-full sm:w-auto shrink-0">
												<label className="block text-sm font-medium text-gray-700 mb-2">
													Channel Icon
												</label>
												<ChannelBadgeUpload
													channel={channel}
													onBadgeUpdated={handleBadgeUpdated}
												/>
											</div>
											<div className="flex-1 w-full space-y-4">
										<div>
											<label className="block text-sm font-medium text-gray-700 mb-1">
												Channel Name
											</label>
											{isEditing ? (
												<input
													type="text"
													value={editName}
													onChange={(e) => setEditName(e.target.value)}
													className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
												/>
											) : (
												<p className="py-2 text-gray-900 font-medium">
													{channel.name}
												</p>
											)}
										</div>
										<div>
											<label className="block text-sm font-medium text-gray-700 mb-1">
												Tags
											</label>
											{isEditing ? (
												<input
													type="text"
													value={editTags}
													onChange={(e) => setEditTags(e.target.value)}
													placeholder="Separate tags with commas (e.g. Sales, Support)"
													className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
												/>
											) : (
												<div className="flex flex-wrap gap-2 py-2">
													{channel.metadata?.tags?.length > 0 ? (
														channel.metadata.tags.map(
															(tag: string, i: number) => (
																<span
																	key={i}
																	className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800"
																>
																	{tag}
																</span>
															),
														)
													) : (
														<span className="text-gray-400 italic">
															No tags set
														</span>
													)}
												</div>
											)}
										</div>

										{/* Configuration Section */}
										<div className="pt-4 border-t border-gray-100 space-y-4">
											{/* Teams */}
											<div className="relative">
												<label className="block text-sm font-medium text-gray-700 mb-1">
													Teams
												</label>
												{isEditing ? (
													<>
														<div
															className="w-full px-3 py-2 border border-gray-300 rounded-lg flex flex-wrap items-center gap-2 cursor-pointer bg-white min-h-[42px]"
															onClick={() =>
																setShowTeamsDropdown(!showTeamsDropdown)
															}
														>
															{selectedTeams.length > 0 ? (
																selectedTeams.map((teamId) => {
																	const team = availableTeams.find(
																		(t) => t.id === teamId,
																	)
																	return (
																		<span
																			key={teamId}
																			className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium border border-blue-100"
																		>
																			<Users className="w-3 h-3" />
																			{team?.name || 'Unknown'}
																			<X
																				className="w-3 h-3 hover:text-red-500 cursor-pointer"
																				onClick={(e) => {
																					e.stopPropagation()
																					setSelectedTeams((prev) =>
																						prev.filter((id) => id !== teamId),
																					)
																				}}
																			/>
																		</span>
																	)
																})
															) : (
																<span className="text-gray-400 text-sm">
																	Select Teams
																</span>
															)}
															<ChevronDown className="w-4 h-4 text-gray-500 ml-auto" />
														</div>
														{showTeamsDropdown && (
															<div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 max-h-60 overflow-y-auto">
																{availableTeams.map((team) => {
																	const isSelected = selectedTeams.includes(
																		team.id,
																	)
																	return (
																		<div
																			key={team.id}
																			className="flex items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer"
																			onClick={() => {
																				if (isSelected) {
																					setSelectedTeams((prev) =>
																						prev.filter((id) => id !== team.id),
																					)
																				} else {
																					setSelectedTeams((prev) => [
																						...prev,
																						team.id,
																					])
																				}
																			}}
																		>
																			<Users className="w-4 h-4 text-blue-500" />
																			<span className="text-sm">
																				{team.name}
																			</span>
																			{isSelected && (
																				<Check className="w-4 h-4 text-emerald-500 ml-auto" />
																			)}
																		</div>
																	)
																})}
																{availableTeams.length === 0 && (
																	<div className="p-2 text-gray-400 text-sm italic">
																		No teams available
																	</div>
																)}
															</div>
														)}
													</>
												) : (
													<div className="flex flex-wrap gap-2 py-2">
														{selectedTeams.length > 0 ? (
															selectedTeams.map((teamId) => {
																const team = availableTeams.find(
																	(t) => t.id === teamId,
																)
																return (
																	<span
																		key={teamId}
																		className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium"
																	>
																		<Users className="w-3.5 h-3.5" />
																		{team?.name || 'Unknown'}
																	</span>
																)
															})
														) : (
															<span className="text-gray-400 italic text-sm">
																No teams assigned
															</span>
														)}
													</div>
												)}
											</div>

											{/* Human Agents */}
											<div className="relative" ref={agentDropdownRef}>
												<label className="block text-sm font-medium text-gray-700 mb-1">
													Human Agent
												</label>
												{isEditing ? (
													<>
														<div
															className="w-full px-3 py-2 border border-gray-300 rounded-lg flex flex-wrap items-center gap-2 cursor-pointer bg-white min-h-[42px]"
															onClick={() => {
																setShowAgentsDropdown(!showAgentsDropdown)
																setAgentSearchQuery('')
															}}
														>
															{selectedAgents.length > 0 ? (
																selectedAgents.map((agentId) => {
																	const agent = availableAgents.find(
																		(a) => a.id === agentId,
																	)
																	return (
																		<span
																			key={agentId}
																			className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium border border-blue-100"
																		>
																			<div className="w-4 h-4 rounded-full bg-blue-200 flex items-center justify-center text-[9px] font-bold">
																				{(agent?.name || 'A')[0]}
																			</div>
																			{agent?.name || 'Unknown'}
																			<X
																				className="w-3 h-3 hover:text-red-500 cursor-pointer"
																				onClick={(e) => {
																					e.stopPropagation()
																					setSelectedAgents((prev) =>
																						prev.filter((id) => id !== agentId),
																					)
																				}}
																			/>
																		</span>
																	)
																})
															) : (
																<span className="text-gray-400 text-sm">
																	Select Agents
																</span>
															)}
															<ChevronDown
																className={`w-4 h-4 text-gray-500 ml-auto transition-transform ${showAgentsDropdown ? 'rotate-180' : ''}`}
															/>
														</div>
														{showAgentsDropdown && (
															<div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 overflow-hidden">
																{/* Search Input */}
																<div className="p-2 border-b border-gray-200 sticky top-0 bg-white">
																	<div className="relative">
																		<Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
																		<input
																			type="text"
																			placeholder="Search agents..."
																			value={agentSearchQuery}
																			onChange={(e) =>
																				setAgentSearchQuery(e.target.value)
																			}
																			onClick={(e) => e.stopPropagation()}
																			className="w-full pl-8 pr-3 py-1.5 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500"
																			autoFocus
																		/>
																	</div>
																</div>
																{/* Agent List */}
																<div className="max-h-48 overflow-y-auto">
																	{availableAgents
																		.filter(
																			(agent) =>
																				agent.name
																					?.toLowerCase()
																					.includes(
																						agentSearchQuery.toLowerCase(),
																					) ||
																				agent.email
																					?.toLowerCase()
																					.includes(
																						agentSearchQuery.toLowerCase(),
																					),
																		)
																		.map((agent) => {
																			const isSelected =
																				selectedAgents.includes(agent.id)
																			return (
																				<div
																					key={agent.id}
																					className={`flex items-center gap-2 p-2.5 hover:bg-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-emerald-50' : ''}`}
																					onClick={(e) => {
																						e.stopPropagation()
																						if (isSelected) {
																							setSelectedAgents((prev) =>
																								prev.filter(
																									(id) => id !== agent.id,
																								),
																							)
																						} else {
																							setSelectedAgents((prev) => [
																								...prev,
																								agent.id,
																							])
																						}
																					}}
																				>
																					<div
																						className={`w-5 h-5 rounded-full flex items-center justify-center text-xs font-medium ${isSelected ? 'bg-emerald-200 text-emerald-700' : 'bg-gray-100 text-gray-600'}`}
																					>
																						{(agent.name || 'A')[0]}
																					</div>
																					<div className="flex-1 min-w-0">
																						<span className="text-sm font-medium block truncate">
																							{agent.name}
																						</span>
																						<span className="text-xs text-gray-400 block truncate">
																							{agent.email}
																						</span>
																					</div>
																					{isSelected && (
																						<Check className="w-4 h-4 text-emerald-500 flex-shrink-0" />
																					)}
																				</div>
																			)
																		})}
																	{availableAgents.filter(
																		(agent) =>
																			agent.name
																				?.toLowerCase()
																				.includes(
																					agentSearchQuery.toLowerCase(),
																				) ||
																			agent.email
																				?.toLowerCase()
																				.includes(
																					agentSearchQuery.toLowerCase(),
																				),
																	).length === 0 && (
																		<div className="p-3 text-center text-gray-400 text-sm">
																			{agentSearchQuery
																				? 'No agents found'
																				: 'No agents available'}
																		</div>
																	)}
																</div>
															</div>
														)}
													</>
												) : (
													<div className="flex flex-wrap gap-2 py-2">
														{selectedAgents.length > 0 ? (
															selectedAgents.map((agentId) => {
																const agent = availableAgents.find(
																	(a) => a.id === agentId,
																)
																return (
																	<span
																		key={agentId}
																		className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 text-blue-700 text-sm font-medium"
																	>
																		<div className="w-4 h-4 rounded-full bg-blue-200 flex items-center justify-center text-[9px] font-bold">
																			{(agent?.name || 'A')[0]}
																		</div>
																		{agent?.name || 'Unknown'}
																	</span>
																)
															})
														) : (
															<span className="text-gray-400 italic text-sm">
																No agents assigned
															</span>
														)}
													</div>
												)}
											</div>

											{/* Distribution Method */}
											<div className="relative">
												<label className="block text-sm font-medium text-gray-700 mb-1">
													Chat Distribution Method
												</label>
												{isEditing ? (
													<>
														<div
															className="w-full px-3 py-2 border border-gray-300 rounded-lg flex items-center justify-between cursor-pointer bg-white"
															onClick={() =>
																setShowDistributionDropdown(
																	!showDistributionDropdown,
																)
															}
														>
															<span className="text-gray-900 font-medium">
																{distributionMethod === 'least_assigned'
																	? 'Least Assigned First'
																	: 'Round Robin'}
															</span>
															<ChevronDown className="w-4 h-4 text-gray-500" />
														</div>
														{showDistributionDropdown && (
															<div className="absolute top-full left-0 w-full mt-1 bg-white border border-gray-300 rounded-lg shadow-lg z-50 overflow-hidden">
																<div
																	className="flex justify-between items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer"
																	onClick={() => {
																		setDistributionMethod('least_assigned')
																		setShowDistributionDropdown(false)
																	}}
																>
																	<div>
																		<p className="text-sm font-bold mb-0">
																			Least Assigned First
																		</p>
																		<p className="text-xs text-gray-500">
																			Memberikan chat kepada agent dengan chat
																			assigned paling sedikit
																		</p>
																	</div>
																	{distributionMethod === 'least_assigned' && (
																		<Check className="w-4 h-4 text-blue-500 mr-2" />
																	)}
																</div>
																<div
																	className="flex justify-between items-center gap-2 p-2 hover:bg-gray-50 cursor-pointer border-t border-gray-100"
																	onClick={() => {
																		setDistributionMethod('round_robin')
																		setShowDistributionDropdown(false)
																	}}
																>
																	<div>
																		<p className="text-sm font-bold mb-0">
																			Round Robin
																		</p>
																		<p className="text-xs text-gray-500">
																			Membagi rata chat kepada semua agent
																		</p>
																	</div>
																	{distributionMethod === 'round_robin' && (
																		<Check className="w-4 h-4 text-blue-500 mr-2" />
																	)}
																</div>
															</div>
														)}
													</>
												) : (
													<div className="flex items-center gap-2 py-2">
														<Shuffle className="w-4 h-4 text-gray-500" />
														<span className="font-medium">
															{distributionMethod === 'least_assigned'
																? 'Least Assigned First'
																: 'Round Robin'}
														</span>
														<span className="text-xs text-gray-500 ml-2">
															{distributionMethod === 'least_assigned'
																? '(Memberikan chat kepada agent dengan chat assigned paling sedikit)'
																: '(Membagi rata chat kepada semua agent)'}
														</span>
													</div>
												)}
											</div>
										</div>
									</div>
								</div>
							</div>
						</div>

						{isBaileysChannel ? (
							<div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
								<div className="p-4 sm:p-6 border-b border-gray-200 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
									<div>
										<div className="flex flex-wrap items-center gap-2 mb-2">
											<h2 className="text-lg font-semibold">Baileys Session</h2>
											<span
												className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${baileysStatusClasses}`}
											>
												{baileysStatusLabel}
											</span>
										</div>
										<p className="text-sm text-gray-600">
											{getBaileysStatusDescription(baileysSession)}
										</p>
									</div>
										<div className="flex flex-col gap-2 sm:flex-row xl:flex-col 2xl:flex-row">
										<button
											onClick={() => void loadBaileysSession()}
											disabled={
												loadingBaileysSession || restartingBaileysSession
											}
											className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
										>
											<RefreshCw
												size={16}
												className={loadingBaileysSession ? 'animate-spin' : ''}
											/>
											Refresh Session
										</button>
										<button
											onClick={handleRestartBaileysSession}
											disabled={restartingBaileysSession}
											className="inline-flex items-center justify-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
										>
											<RefreshCw
												size={16}
												className={
													restartingBaileysSession ? 'animate-spin' : ''
												}
											/>
											{restartingBaileysSession
												? 'Restarting...'
												: 'Restart Session'}
										</button>
									</div>
								</div>
								<div className="p-4 sm:p-6 space-y-6">
									{baileysQrPreviewUrl ? (
										<div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
											<p className="text-sm font-semibold text-blue-900">
												Scan QR Code
											</p>
											<p className="mt-1 text-sm text-blue-800">
												Buka WhatsApp utama, masuk ke menu Linked Devices, lalu
												scan QR ini untuk menautkan channel.
											</p>
											<div className="mt-4 flex justify-center">
												<img
													src={baileysQrPreviewUrl}
													alt="Baileys session QR code"
													className="h-64 w-64 rounded-2xl border border-white bg-white p-3 shadow-sm"
												/>
											</div>
										</div>
									) : baileysSession?.pairingCode ? (
										<div className="rounded-2xl border border-blue-200 bg-blue-50/70 p-4">
											<p className="text-sm font-semibold text-blue-900">
												Pairing Code
											</p>
											<p className="mt-1 text-sm text-blue-800">
												Masukkan kode ini di WhatsApp utama lewat menu Linked
												Devices.
											</p>
											<div className="mt-3 rounded-xl border border-blue-200 bg-white px-4 py-3">
												<p className="font-mono text-xl font-bold tracking-[0.35em] text-blue-900">
													{baileysSession.pairingCode}
												</p>
											</div>
										</div>
									) : (
										<div className="rounded-2xl border border-gray-200 bg-gray-50 p-4">
											<p className="text-sm font-semibold text-gray-900">
												Waiting For Linking Credential
											</p>
											<p className="mt-1 text-sm text-gray-600">
												Belum ada QR code atau pairing code yang siap
												ditampilkan. Jika sesi macet, gunakan tombol restart
												session di atas.
											</p>
										</div>
									)}

									{baileysSession?.lastError ? (
										<div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
											<div className="flex items-start gap-3">
												<AlertTriangle className="mt-0.5 h-5 w-5 text-amber-600" />
												<div>
													<p className="text-sm font-semibold text-amber-900">
														Runtime Note
													</p>
													<p className="mt-1 text-sm text-amber-800">
														{baileysSession.lastError}
													</p>
												</div>
											</div>
										</div>
									) : null}

										<div className="grid gap-4 grid-cols-1 sm:grid-cols-2 2xl:grid-cols-4">
										<div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
											<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
												Session Status
											</p>
											<p className="mt-2 text-sm font-semibold text-gray-900">
												{baileysStatusLabel}
											</p>
										</div>
										<div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
											<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
												Last Seen
											</p>
											<p className="mt-2 text-sm font-semibold text-gray-900">
												{formatOptionalDateTime(baileysSession?.lastSeenAt)}
											</p>
										</div>
										<div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
											<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
												Last Connected
											</p>
											<p className="mt-2 text-sm font-semibold text-gray-900">
												{formatOptionalDateTime(
													baileysSession?.lastConnectedAt,
												)}
											</p>
										</div>
										<div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
											<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
												Linked Number
											</p>
											<p className="mt-2 text-sm font-semibold text-gray-900">
												{baileysSession?.phoneNumber ||
													channel.phone_number ||
													'-'}
											</p>
										</div>
									</div>
								</div>
							</div>
						) : null}
						</div>

						{/* WABA Info Card */}
						<div className="bg-white rounded-xl border border-gray-200 shadow-sm overflow-hidden">
							<div className="p-4 sm:p-6 border-b border-gray-200">
								<div className="flex items-start justify-between">
									<div>
										<div className="flex items-center gap-2 mb-2">
											<h2 className="text-lg font-semibold">
												{channel.provider === 'baileys'
													? 'Baileys Connection Settings'
													: 'WhatsApp Business Account'}
											</h2>
											<span
												className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-medium ${
													isBaileysChannel
														? baileysStatusClasses
														: 'bg-emerald-100 text-emerald-800 border-emerald-200'
												}`}
											>
												{isBaileysChannel ? baileysStatusLabel : 'Connected'}
											</span>
										</div>
										<p className="text-sm text-gray-600">
											{channel.provider === 'baileys'
												? 'Review the saved channel identity, outbound route, and runtime-facing Baileys configuration.'
												: 'Manage your WABA connection and settings'}
										</p>
									</div>
								</div>
							</div>
							<div className="p-4 sm:p-6">
								<div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
									<div>
										<p className="text-sm text-gray-600">
											{channel.provider === 'baileys' ? 'Provider' : 'WABA ID'}
										</p>
										<p className="font-mono text-sm font-medium mt-1">
											{channel.provider === 'baileys'
												? normalizeWhatsappProviderLabel(channel.provider)
												: channel.waba_id || channel.business_id}
										</p>
									</div>
									<div>
										<p className="text-sm text-gray-600">
											{channel.provider === 'baileys'
												? 'Provider Channel Key'
												: 'Business Name'}
										</p>
										<p className="font-medium mt-1">
											{channel.provider === 'baileys'
												? channel.provider_channel_key || '-'
												: channel.business_name}
										</p>
									</div>
									{channel.provider === 'baileys' ? (
										<div className="md:col-span-2">
											<p className="text-sm text-gray-600">
												Outbound Send Route
											</p>
											<p className="mt-1 break-all font-mono text-sm font-medium">
												{channel.provider_webhook_url || '-'}
											</p>
										</div>
									) : null}
									<div>
										<p className="text-sm text-gray-600">Timezone</p>
										<p className="font-medium mt-1">{channel.timezone}</p>
									</div>
									<div>
										<p className="text-sm text-gray-600">Currency</p>
										<p className="font-medium mt-1">{channel.currency}</p>
									</div>
									<div className="md:col-span-2">
										<p className="text-sm text-gray-600">Last Synced</p>
										<p className="text-sm mt-1">
											{isBaileysChannel
												? formatOptionalDateTime(baileysSession?.lastSeenAt)
												: channel.last_synced_at
													? new Date(channel.last_synced_at).toLocaleString()
													: 'Never synced'}
										</p>
									</div>
								</div>
							</div>
						</div>

						{/* Phone Number Card */}
						<div className="bg-white rounded-xl border border-gray-200 shadow-sm">
							<div className="p-6 border-b border-gray-200">
								<div className="flex items-center gap-2 mb-2">
									<Phone size={20} />
									<h2 className="text-lg font-semibold">Phone Number</h2>
									<span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium bg-blue-100 text-blue-800">
										Primary
									</span>
								</div>
								<p className="text-sm text-gray-600">
									{isBaileysChannel
										? 'Primary phone identity used by this Baileys session'
										: 'Your WhatsApp Business phone number details'}
								</p>
							</div>
							<div className="p-6">
								<div className="space-y-6">
									{/* Phone Display */}
									<div className="flex items-center gap-4">
										<div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
											<Phone className="text-emerald-600" size={24} />
										</div>
										<div className="flex-1">
											<p className="font-mono text-lg font-bold">
												{channel.phone_number}
											</p>
											<p className="text-sm text-gray-600">
												{channel.verified_name || channel.business_name}
											</p>
										</div>
									</div>

									{isBaileysChannel ? (
										<div className="grid gap-4 grid-cols-1 sm:grid-cols-2">
											<div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
												<p className="text-xs text-gray-600 uppercase tracking-wide">
													Connection Mode
												</p>
												<p className="mt-1 text-sm font-semibold text-gray-900">
													Non Official (Baileys)
												</p>
											</div>
											<div className="rounded-xl border border-gray-200 bg-gray-50 px-4 py-3">
												<p className="text-xs text-gray-600 uppercase tracking-wide">
													Session Key
												</p>
												<p className="mt-1 break-all font-mono text-sm font-semibold text-gray-900">
													{channel.provider_channel_key || '-'}
												</p>
											</div>
										</div>
									) : (
										<>
											{/* Quality Rating */}
											<QualityRatingCard
												rating={channel.quality_rating}
												score={channel.quality_score}
											/>

											{/* Messaging Limit */}
											<MessagingLimitCard
												tier={channel.messaging_limit}
												limitInfo={channel.limit_info}
											/>
										</>
									)}

									{/* Phone Number ID */}
									<div className="border-t pt-4">
										<p className="text-xs text-gray-600">
											{channel.provider === 'baileys'
												? 'Provider Channel Key'
												: 'Phone Number ID'}
										</p>
										<p className="font-mono text-sm mt-1">
											{channel.provider === 'baileys'
												? channel.provider_channel_key || '-'
												: channel.phone_number_id}
										</p>
									</div>
								</div>
							</div>
						</div>
					</div>
				)}

				{activeTab === 'quality' &&
					(isBaileysChannel ? (
						<div className="grid gap-4 grid-cols-1 md:grid-cols-2">
							<div className="bg-white rounded-xl border border-gray-200 shadow-sm">
								<div className="p-6 border-b border-gray-200">
									<div className="flex items-start justify-between gap-3">
										<div>
											<div className="flex items-center gap-2 mb-2">
												<ShieldCheck className="h-5 w-5" />
												<h2 className="text-lg font-semibold">
													Baileys Runtime Health
												</h2>
											</div>
											<p className="text-sm text-gray-600">
												Connection health dan kesiapan sesi untuk channel
												non-official ini.
											</p>
										</div>
										<span
											className={`inline-flex items-center rounded-md border px-2.5 py-0.5 text-xs font-semibold ${baileysStatusClasses}`}
										>
											{baileysStatusLabel}
										</span>
									</div>
								</div>
								<div className="p-6 space-y-4">
									<div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
										<p className="text-sm font-semibold text-gray-900">
											{getBaileysStatusDescription(baileysSession)}
										</p>
										<p className="mt-2 text-xs text-gray-600">
											Last connected:{' '}
											{formatOptionalDateTime(baileysSession?.lastConnectedAt)}
										</p>
										<p className="mt-1 text-xs text-gray-600">
											Last heartbeat:{' '}
											{formatOptionalDateTime(baileysSession?.lastSeenAt)}
										</p>
									</div>

									{baileysSession?.lastError ? (
										<div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
											<p className="text-sm font-semibold text-amber-900">
												Last Runtime Note
											</p>
											<p className="mt-1 text-sm text-amber-800">
												{baileysSession.lastError}
											</p>
										</div>
									) : (
										<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
											<p className="text-sm font-semibold text-emerald-900">
												No runtime warning at the moment
											</p>
											<p className="mt-1 text-sm text-emerald-800">
												Tidak ada error terbaru yang dilaporkan oleh runtime
												Baileys.
											</p>
										</div>
									)}
								</div>
							</div>

							<div className="bg-white rounded-xl border border-gray-200 shadow-sm">
								<div className="p-6 border-b border-gray-200">
									<div className="flex items-center gap-2 mb-2">
										<Phone className="h-5 w-5" />
										<h2 className="text-lg font-semibold">Provider Notes</h2>
									</div>
									<p className="text-sm text-gray-600">
										Meta quality rating dan messaging tier tidak berlaku untuk
										channel Baileys non-official.
									</p>
								</div>
								<div className="p-6 space-y-4">
									<div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
										<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
											Connection Model
										</p>
										<p className="mt-2 text-sm font-semibold text-gray-900">
											Runtime device pairing via Baileys
										</p>
									</div>
									<div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
										<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
											Outbound Route
										</p>
										<p className="mt-2 break-all font-mono text-sm font-semibold text-gray-900">
											{channel.provider_webhook_url || '-'}
										</p>
									</div>
									<div className="rounded-xl border border-gray-200 bg-gray-50 p-4">
										<p className="text-xs font-semibold uppercase tracking-wide text-gray-500">
											Session Key
										</p>
										<p className="mt-2 break-all font-mono text-sm font-semibold text-gray-900">
											{channel.provider_channel_key || '-'}
										</p>
									</div>
								</div>
							</div>
						</div>
					) : (
						<div className="grid gap-4 grid-cols-1 md:grid-cols-2">
							{/* Quality Metrics Card */}
							<div className="bg-white rounded-xl border border-gray-200 shadow-sm">
								<div className="p-6 border-b border-gray-200">
									<div className="flex items-start justify-between">
										<div>
											<div className="flex items-center gap-2 mb-2">
												<ShieldCheck className="h-5 w-5" />
												<h2 className="text-lg font-semibold">
													Quality Metrics
												</h2>
											</div>
											<p className="text-sm text-gray-600">
												Monitor your messaging quality rating
											</p>
										</div>
										<span
											className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${
												channel.quality_rating === 'GREEN'
													? 'bg-emerald-600 text-white'
													: channel.quality_rating === 'YELLOW'
														? 'bg-yellow-500 text-white'
														: channel.quality_rating === 'RED'
															? 'bg-red-600 text-white'
															: 'bg-gray-400 text-white'
											}`}
										>
											{channel.quality_score.label} Quality
										</span>
									</div>
								</div>
								<div className="p-6">
									<div className="space-y-6">
										{/* Overall Score */}
										<div>
											<div className="flex items-center justify-between mb-2">
												<div className="flex items-center gap-2">
													<p className="text-sm font-medium">Overall Score</p>
													{channel.quality_rating === 'GREEN' && (
														<TrendingUp className="h-4 w-4 text-emerald-600" />
													)}
													{channel.quality_rating === 'RED' && (
														<AlertTriangle className="h-4 w-4 text-red-600" />
													)}
												</div>
												<p
													className={`text-2xl font-bold ${
														channel.quality_rating === 'GREEN'
															? 'text-emerald-600'
															: channel.quality_rating === 'YELLOW'
																? 'text-yellow-600'
																: channel.quality_rating === 'RED'
																	? 'text-red-600'
																	: 'text-gray-600'
													}`}
												>
													{channel.quality_score.percentage}%
												</p>
											</div>
											<div className="w-full bg-gray-200 rounded-full h-2">
												<div
													className={`h-2 rounded-full transition-all ${
														channel.quality_rating === 'GREEN'
															? 'bg-emerald-600'
															: channel.quality_rating === 'YELLOW'
																? 'bg-yellow-500'
																: channel.quality_rating === 'RED'
																	? 'bg-red-600'
																	: 'bg-gray-400'
													}`}
													style={{
														width: `${channel.quality_score.percentage}%`,
													}}
												></div>
											</div>
											<p className="text-xs text-gray-600 mt-1">
												Based on customer feedback and engagement
											</p>
										</div>

										{/* Quality Indicators */}
										<div className="space-y-3">
											<div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
												<div>
													<p className="text-sm font-medium">
														Template Quality
													</p>
													<p className="text-xs text-gray-600">
														Message template performance
													</p>
												</div>
												<span
													className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${
														channel.quality_rating === 'GREEN'
															? 'bg-emerald-600 text-white'
															: channel.quality_rating === 'YELLOW'
																? 'bg-yellow-500 text-white'
																: channel.quality_rating === 'RED'
																	? 'bg-red-600 text-white'
																	: 'bg-gray-400 text-white'
													}`}
												>
													{channel.quality_rating === 'UNKNOWN'
														? 'N/A'
														: channel.quality_rating}
												</span>
											</div>

											<div className="flex items-center justify-between rounded-lg border border-gray-200 p-3">
												<div>
													<p className="text-sm font-medium">
														Phone Number Quality
													</p>
													<p className="text-xs text-gray-600">
														Account health status
													</p>
												</div>
												<span
													className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold ${
														channel.quality_rating === 'GREEN'
															? 'bg-emerald-600 text-white'
															: channel.quality_rating === 'YELLOW'
																? 'bg-yellow-500 text-white'
																: channel.quality_rating === 'RED'
																	? 'bg-red-600 text-white'
																	: 'bg-gray-400 text-white'
													}`}
												>
													{channel.quality_rating}
												</span>
											</div>
										</div>

										<div className="border-t pt-3">
											<p className="text-xs text-gray-600">
												Last updated:{' '}
												{channel.last_synced_at
													? new Date(channel.last_synced_at).toLocaleString()
													: 'Never'}
											</p>
										</div>
									</div>
								</div>
							</div>

							{/* Phone Number Card (in Quality Tab) */}
							<div className="bg-white rounded-xl border border-gray-200 shadow-sm">
								<div className="p-6 border-b border-gray-200">
									<div className="flex items-center gap-2 mb-2">
										<Phone className="h-5 w-5" />
										<h2 className="text-lg font-semibold">Phone Number</h2>
										<span className="inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-semibold bg-blue-600 text-white">
											Primary
										</span>
									</div>
									<p className="text-sm text-gray-600">
										Your WhatsApp Business phone number details
									</p>
								</div>
								<div className="p-6">
									<div className="space-y-6">
										{/* Phone Display */}
										<div className="flex items-center gap-4">
											<div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center">
												<Phone className="text-emerald-600" size={24} />
											</div>
											<div className="flex-1">
												<p className="font-mono text-lg font-bold">
													{channel.phone_number}
												</p>
												<p className="text-sm text-gray-600">
													{channel.verified_name || channel.business_name}
												</p>
											</div>
										</div>

										{/* Quality Rating */}
										<QualityRatingCard
											rating={channel.quality_rating}
											score={channel.quality_score}
										/>

										{/* Messaging Limit */}
										<MessagingLimitCard
											tier={channel.messaging_limit}
											limitInfo={channel.limit_info}
										/>

										{/* Phone Number ID */}
										<div className="border-t pt-4">
											<p className="text-xs text-gray-600">Phone Number ID</p>
											<p className="font-mono text-sm mt-1">
												{channel.phone_number_id}
											</p>
										</div>
									</div>
								</div>
							</div>
						</div>
					))}
				</div>
		</div>
	)
}

// Quality Rating Component
function QualityRatingCard({ rating, score }: { rating: string; score: any }) {
	const getColor = () => {
		switch (score.color) {
			case 'emerald':
				return 'bg-emerald-600'
			case 'yellow':
				return 'bg-yellow-500'
			case 'red':
				return 'bg-red-600'
			default:
				return 'bg-gray-400'
		}
	}

	const getBadgeColor = () => {
		switch (score.color) {
			case 'emerald':
				return 'bg-emerald-100 text-emerald-800'
			case 'yellow':
				return 'bg-yellow-100 text-yellow-800'
			case 'red':
				return 'bg-red-100 text-red-800'
			default:
				return 'bg-gray-100 text-gray-800'
		}
	}

	return (
		<div className="rounded-lg border border-gray-200 p-4">
			<div className="flex items-center justify-between mb-3">
				<p className="text-sm font-medium">Quality Rating</p>
				<span
					className={`inline-flex items-center px-2.5 py-0.5 rounded-md text-xs font-medium ${getBadgeColor()}`}
				>
					{rating === 'UNKNOWN' && <AlertTriangle size={12} className="mr-1" />}
					{score.label}
				</span>
			</div>
			<p className="text-sm text-gray-600 mb-3">
				{rating === 'UNKNOWN'
					? 'Quality not rated yet'
					: `Your account quality is ${score.label.toLowerCase()}`}
			</p>
			<div className="w-full bg-gray-200 rounded-full h-2">
				<div
					className={`h-2 rounded-full transition-all ${getColor()}`}
					style={{ width: `${score.percentage}%` }}
				></div>
			</div>
		</div>
	)
}

// Messaging Limit Component
function MessagingLimitCard({
	tier,
	limitInfo,
}: {
	tier: string
	limitInfo: any
}) {
	const tierLevel = limitInfo.tier_level

	return (
		<div className="space-y-3">
			<div className="flex items-center justify-between">
				<div className="flex items-center gap-2">
					<TrendingUp size={16} className="text-gray-400" />
					<span className="text-sm font-medium">Messaging Limit</span>
				</div>
				<span className="text-lg font-bold text-gray-900">
					{limitInfo.daily_limit}
					{tier !== 'TIER_UNLIMITED' && '/day'}
				</span>
			</div>

			{/* Tier Progress */}
			<div className="flex gap-1">
				<div
					className={`flex-1 h-1.5 rounded-full ${tierLevel >= 0 ? 'bg-emerald-600' : 'bg-gray-200'}`}
				></div>
				<div
					className={`flex-1 h-1.5 rounded-full ${tierLevel >= 1 ? 'bg-emerald-600' : 'bg-gray-200'}`}
				></div>
				<div
					className={`flex-1 h-1.5 rounded-full ${tierLevel >= 2 ? 'bg-emerald-600' : 'bg-gray-200'}`}
				></div>
				<div
					className={`flex-1 h-1.5 rounded-full ${tierLevel >= 3 ? 'bg-emerald-600' : 'bg-gray-200'}`}
				></div>
				<div
					className={`flex-1 h-1.5 rounded-full ${tierLevel >= 4 ? 'bg-emerald-600' : 'bg-gray-200'}`}
				></div>
			</div>

			<div className="flex justify-between text-xs text-gray-500">
				<span>50</span>
				<span>1K</span>
				<span>10K</span>
				<span>100K</span>
				<span>∞</span>
			</div>
		</div>
	)
}

// Channel Badge Upload Component
function ChannelBadgeUpload({
	channel,
	onBadgeUpdated,
}: {
	channel: any
	onBadgeUpdated: (url: string | null) => void
}) {
	const [uploading, setUploading] = useState(false)
	const fileInputRef = useRef<HTMLInputElement>(null)

	const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
		const file = e.target.files?.[0]
		if (!file) return

		// Validate file type
		if (!['image/jpeg', 'image/jpg', 'image/png'].includes(file.type)) {
			alert('Only JPG, JPEG, and PNG files are allowed')
			return
		}

		// Validate file size (2MB)
		if (file.size > 2 * 1024 * 1024) {
			alert('File size must be less than 2MB')
			return
		}

		try {
			setUploading(true)
			const result: any = await whatsappChannels.uploadBadge(channel.id, file)
			onBadgeUpdated(result.badge_url)
		} catch (error) {
			console.error('Upload failed:', error)
			alert(error instanceof Error ? error.message : 'Failed to upload badge')
		} finally {
			setUploading(false)
			if (fileInputRef.current) {
				fileInputRef.current.value = ''
			}
		}
	}

	const handleRemove = async () => {
		if (!confirm('Reset badge to default profile picture?')) return

		try {
			const result: any = await whatsappChannels.removeBadge(channel.id)
			onBadgeUpdated(result.badge_url)
		} catch (error) {
			console.error('Remove failed:', error)
			alert('Failed to remove badge')
		}
	}

	const badgeUrl = channel.badge_url || channel.metadata?.profile_picture_url

	return (
		<div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 sm:gap-5">
			<div className="space-y-3 w-full sm:w-auto">
				<div className="mt-2 flex items-start gap-4">
					<div
						className="flex w-fit cursor-pointer items-center rounded-lg border border-dashed transition-colors border-green-500 hover:border-green-600 hover:bg-green-50"
						onClick={() => !uploading && fileInputRef.current?.click()}
					>
						<div className="group relative p-1.5">
							{badgeUrl ? (
								<>
									<img
										src={badgeUrl}
										alt="Channel badge"
										className="max-h-[60px] min-h-[60px] max-w-[60px] min-w-[60px] sm:max-h-[68px] sm:min-h-[68px] sm:max-w-[68px] sm:min-w-[68px] rounded-lg object-cover"
									/>
									<button
										className="absolute inset-0 flex items-center justify-center rounded-lg bg-white opacity-0 shadow-lg transition-all duration-200 group-hover:cursor-pointer group-hover:opacity-60"
										type="button"
										title="Replace image"
										onClick={(e) => {
											e.stopPropagation()
											if (!uploading) fileInputRef.current?.click()
										}}
									>
										<Upload className="h-6 w-6 text-gray-700" />
									</button>
								</>
							) : (
								<div className="flex h-[60px] w-[60px] sm:h-[68px] sm:w-[68px] items-center justify-center rounded-lg bg-gray-100">
									<Upload className="h-6 w-6 text-gray-400" />
								</div>
							)}
						</div>
					</div>

					{channel.badge_url && (
						<button
							onClick={handleRemove}
							className="mt-4 sm:mt-5 p-2 text-red-600 hover:bg-red-50 rounded-lg transition"
							title="Remove badge"
						>
							<X className="h-5 w-5" />
						</button>
					)}
				</div>
				<input
					ref={fileInputRef}
					type="file"
					id="channel-badge-whatsapp"
					accept="image/jpeg,image/jpg,image/png"
					className="hidden"
					onChange={handleFileChange}
					disabled={uploading}
				/>
			</div>
			<div className="flex flex-1 flex-col items-start gap-1 w-full">
				<h4 className="text-sm font-semibold text-gray-700">
					Channel Badge Icon
				</h4>
				<p className="text-xs font-normal text-gray-500 max-w-sm">
					We recommend an image of at least 360x360 pixels. JPG, JPEG, or PNG
					format with a maximum size of 2MB.
				</p>
				{uploading && (
					<p className="text-xs text-blue-600 mt-1 animate-pulse">
						Uploading...
					</p>
				)}
			</div>
		</div>
	)
}
