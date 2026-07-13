import { Check, Copy, Eye, EyeOff, Loader2, MessageCircle } from 'lucide-react'
import QRCode from 'qrcode'
import { type FormEvent, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
	getApiErrorMessage,
	readApiResponse,
	API_BASE,
} from '@/lib/api'
import { WhatsAppProviderBadge } from './WhatsAppProviderBadge'

type ConnectProvider = 'official' | 'baileys'

type WhatsAppConnectModalProps = {
	open: boolean
	onClose: () => void
	onSuccess?: (channelId: string) => void | Promise<void>
	onContinue?: (channelId: string) => void | Promise<void>
}

type OfficialConnectResponse = {
	success?: boolean
	data?: {
		primaryChannelId?: string
		channels?: Array<{ id?: string }>
		webhook?: {
			callbackUrl?: string
			verifyToken?: string
		}
	}
	error?: unknown
	message?: unknown
}

type BaileysConnectResponse = {
	success?: boolean
	data?: {
		channelId?: string
		channel?: {
			id?: string
		}
		session?: {
			status?: string
			pairingCode?: string | null
			qrCode?: string | null
			lastError?: string | null
			isConnected?: boolean
			lastConnectedAt?: string | null
			lastSeenAt?: string | null
		}
		webhook?: {
			callbackUrl?: string
			secret?: string
		}
	}
	error?: unknown
	message?: unknown
}

type ConnectSuccessState = {
	provider: ConnectProvider
	channelId: string
	description: string
	primaryLabel: string
	primaryValue: string
	secondaryLabel: string
	secondaryValue: string
	secondarySensitive?: boolean
}

type BaileysSessionState = {
	status?: string
	pairingCode?: string | null
	qrCode?: string | null
	lastError?: string | null
	isConnected?: boolean
	lastConnectedAt?: string | null
	lastSeenAt?: string | null
}

function buildApiHeaders(json = false): HeadersInit {
	if (typeof localStorage === 'undefined') {
		return json ? { 'Content-Type': 'application/json' } : {}
	}

	const token = localStorage.getItem('scalechat_token')
	const orgSlug = localStorage.getItem('scalechat_org_slug')
	const appId = localStorage.getItem('scalechat_app_id')

	return {
		...(token && { Authorization: `Bearer ${token}` }),
		...(orgSlug && { 'X-Org-Slug': orgSlug }),
		...(appId && { 'X-App-Id': appId }),
		...(json && { 'Content-Type': 'application/json' }),
	}
}

function getManualConnectionFailureMessage(error: unknown): string {
	const message =
		error instanceof Error
			? error.message
			: typeof error === 'string'
				? error
				: ''

	if (message === 'Failed to fetch') {
		return 'Gagal menghubungkan ke API. Cek koneksi, CORS, atau local API.'
	}

	return message || 'Gagal menghubungkan WhatsApp. Coba lagi.'
}

function normalizeBaileysSession(
	session: BaileysSessionState | null | undefined,
): BaileysSessionState | null {
	if (!session) return null

	return {
		status: session.status || 'connecting',
		pairingCode: session.pairingCode || null,
		qrCode: session.qrCode || null,
		lastError: session.lastError || null,
		isConnected: Boolean(session.isConnected),
		lastConnectedAt: session.lastConnectedAt || null,
		lastSeenAt: session.lastSeenAt || null,
	}
}

function getBaileysConnectionDescription(session: BaileysSessionState | null) {
	switch (session?.status) {
		case 'connected':
			return 'Perangkat WhatsApp sudah terhubung ke channel Baileys ini.'
		case 'pairing_code_ready':
			return 'Masukkan pairing code ini di WhatsApp utama lewat menu Linked Devices.'
		case 'qr_ready':
			return 'Scan QR code ini dari WhatsApp utama lewat menu Linked Devices.'
		case 'logged_out':
			return 'Sesi Baileys logout. Jalankan restart session dari detail channel untuk meminta QR baru.'
		case 'disconnected':
			return 'Sesi Baileys terputus. Jalankan restart session dari detail channel untuk menyambungkan ulang.'
		case 'error':
			return 'Service Baileys sempat gagal meminta credential. Service akan terus mencoba lagi selama sesi belum dihentikan.'
		default:
			return 'Service Baileys sedang menyiapkan sesi. QR code atau pairing code akan muncul otomatis saat siap.'
	}
}

export function WhatsAppConnectModal({
	open,
	onClose,
	onSuccess,
	onContinue,
}: WhatsAppConnectModalProps) {
	const [selectedProvider, setSelectedProvider] =
		useState<ConnectProvider | null>(null)
	const [connecting, setConnecting] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)
	const [successState, setSuccessState] = useState<ConnectSuccessState | null>(
		null,
	)
	const [copiedField, setCopiedField] = useState<
		'callback' | 'credential' | null
	>(null)
	const [showAccessToken, setShowAccessToken] = useState(false)
	const [showSensitiveValue, setShowSensitiveValue] = useState(false)
	const [baileysSession, setBaileysSession] = useState<BaileysSessionState | null>(
		null,
	)
	const [baileysQrPreviewUrl, setBaileysQrPreviewUrl] = useState<string | null>(
		null,
	)

	const [officialWabaId, setOfficialWabaId] = useState('')
	const [officialAccessToken, setOfficialAccessToken] = useState('')
	const [baileysName, setBaileysName] = useState('')
	const [baileysPhoneNumber, setBaileysPhoneNumber] = useState('')
	const [baileysProviderChannelKey, setBaileysProviderChannelKey] = useState('')

	const isBusy = connecting

	const resetState = () => {
		setSelectedProvider(null)
		setConnecting(false)
		setErrorMessage(null)
		setSuccessState(null)
		setCopiedField(null)
		setShowAccessToken(false)
		setShowSensitiveValue(false)
		setBaileysSession(null)
		setBaileysQrPreviewUrl(null)
		setOfficialWabaId('')
		setOfficialAccessToken('')
		setBaileysName('')
		setBaileysPhoneNumber('')
		setBaileysProviderChannelKey('')
	}

	const handleClose = () => {
		if (isBusy) return
		resetState()
		onClose()
	}

	const handleCopy = async (
		value: string,
		field: 'callback' | 'credential',
	) => {
		try {
			await navigator.clipboard.writeText(value)
			setCopiedField(field)
			window.setTimeout(() => {
				setCopiedField((current) => (current === field ? null : current))
			}, 2000)
		} catch (error) {
			console.error('Failed to copy value:', error)
			toast.error('Failed to copy. Please copy manually.')
		}
	}

	const handleOfficialSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()

		const wabaId = officialWabaId.trim()
		const accessToken = officialAccessToken.trim()
		if (!wabaId || !accessToken) {
			const message = 'Access Token dan WABA ID wajib diisi.'
			setErrorMessage(message)
			toast.error(message)
			return
		}

		setConnecting(true)
		setErrorMessage(null)
		try {
			const response = await fetch(`${API_BASE}/waba/connect/manual`, {
				method: 'POST',
				headers: buildApiHeaders(true),
				body: JSON.stringify({ accessToken, wabaId }),
			})
			const payload = (await readApiResponse(
				response,
			)) as OfficialConnectResponse | null

			if (!response.ok || !payload?.success) {
				throw new Error(
					getApiErrorMessage(
						payload,
						`Gagal menghubungkan WhatsApp (${response.status})`,
					),
				)
			}

			const channelId =
				payload.data?.primaryChannelId || payload.data?.channels?.[0]?.id
			if (!channelId) {
				throw new Error('No WhatsApp channel was created from this WABA')
			}

			setSuccessState({
				provider: 'official',
				channelId,
				description:
					'Gunakan callback URL dan verify token ini saat mengatur webhook di Meta Business Portal.',
				primaryLabel: 'CRM Callback URL',
				primaryValue: payload.data?.webhook?.callbackUrl || '',
				secondaryLabel: 'Verify Token',
				secondaryValue: payload.data?.webhook?.verifyToken || '',
				secondarySensitive: true,
			})
			await Promise.resolve(onSuccess?.(channelId))
		} catch (error) {
			console.error('Failed to connect official WhatsApp:', error)
			const message = getManualConnectionFailureMessage(error)
			setErrorMessage(message)
			toast.error(message)
		} finally {
			setConnecting(false)
		}
	}

	const handleBaileysSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()

		const payload = {
			name: baileysName.trim(),
			phoneNumber: baileysPhoneNumber.trim(),
			providerChannelKey: baileysProviderChannelKey.trim(),
		}

		if (!payload.name || !payload.phoneNumber || !payload.providerChannelKey) {
			const message = 'Channel Name, Phone Number, dan Provider Channel Key wajib diisi.'
			setErrorMessage(message)
			toast.error(message)
			return
		}

		setConnecting(true)
		setErrorMessage(null)
		try {
			const response = await fetch(`${API_BASE}/whatsapp-channels/baileys`, {
				method: 'POST',
				headers: buildApiHeaders(true),
				body: JSON.stringify(payload),
			})
			const result = (await readApiResponse(
				response,
			)) as BaileysConnectResponse | null

			if (!response.ok || !result?.success) {
				throw new Error(
					getApiErrorMessage(
						result,
						`Gagal membuat channel Baileys (${response.status})`,
					),
				)
			}

			const channelId = result.data?.channelId || result.data?.channel?.id
			if (!channelId) {
				throw new Error('Baileys channel created without channel ID')
			}

			setSuccessState({
				provider: 'baileys',
				channelId,
				description:
					'Channel Baileys berhasil dibuat. Lanjutkan proses pairing perangkat WhatsApp.',
				primaryLabel: 'Baileys Session Status',
				primaryValue: String(result.data?.session?.status || 'connecting'),
				secondaryLabel: 'Channel Secret',
				secondaryValue: result.data?.webhook?.secret || '',
				secondarySensitive: true,
			})
			setBaileysSession(normalizeBaileysSession(result.data?.session))
			await Promise.resolve(onSuccess?.(channelId))
		} catch (error) {
			console.error('Failed to connect Baileys channel:', error)
			const message = getManualConnectionFailureMessage(error)
			setErrorMessage(message)
			toast.error(message)
		} finally {
			setConnecting(false)
		}
	}

	const handleContinue = async () => {
		if (!successState) return
		if (onContinue) {
			await Promise.resolve(onContinue(successState.channelId))
		}
		handleClose()
	}

	useEffect(() => {
		if (!successState || successState.provider !== 'baileys') return

		let cancelled = false
		let timerId: number | null = null
		let attempts = 0

		const pollSession = async () => {
			attempts += 1

			try {
				const response = await fetch(
					`${API_BASE}/whatsapp-channels/${successState.channelId}/baileys/session`,
					{
						headers: buildApiHeaders(),
					},
				)
				const payload = (await readApiResponse(response)) as
					| {
							success?: boolean
							data?: BaileysSessionState
					  }
					| null

				if (!response.ok || !payload?.success || !payload.data) {
					throw new Error(
						getApiErrorMessage(
							payload,
							`Gagal memuat status Baileys (${response.status})`,
						),
					)
				}

				if (cancelled) return
				setBaileysSession(payload.data)

				if (payload.data.isConnected || attempts >= 45) {
					return
				}
			} catch (error) {
				console.error('Failed to poll Baileys session:', error)
				if (cancelled || attempts >= 45) {
					return
				}
			}

			timerId = window.setTimeout(pollSession, 2000)
		}

		void pollSession()

		return () => {
			cancelled = true
			if (timerId !== null) {
				window.clearTimeout(timerId)
			}
		}
	}, [successState?.channelId, successState?.provider])

	useEffect(() => {
		if (!baileysSession?.qrCode) {
			setBaileysQrPreviewUrl(null)
			return
		}

		let cancelled = false

		void QRCode.toDataURL(baileysSession.qrCode, {
			width: 280,
			margin: 1,
		})
			.then((dataUrl) => {
				if (!cancelled) {
					setBaileysQrPreviewUrl(dataUrl)
				}
			})
			.catch((error) => {
				console.error('Failed to render Baileys QR code:', error)
				if (!cancelled) {
					setBaileysQrPreviewUrl(null)
				}
			})

		return () => {
			cancelled = true
		}
	}, [baileysSession?.qrCode])

	if (!open) return null

	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
			onClick={handleClose}
		>
			<div
				className="w-full max-w-2xl overflow-hidden rounded-2xl bg-white shadow-2xl"
				onClick={(event) => event.stopPropagation()}
			>
				<div className="flex items-center justify-between border-b border-gray-200 px-6 py-4">
					<div>
						<h3 className="text-lg font-bold text-gray-900">
							Connect WhatsApp Channel
						</h3>
						<p className="mt-1 text-sm text-gray-500">
							Pilih jalur integrasi WhatsApp yang ingin dipakai.
						</p>
					</div>
					<button
						type="button"
						onClick={handleClose}
						disabled={isBusy}
						className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600 disabled:opacity-50"
					>
						<span className="text-xl leading-none">×</span>
					</button>
				</div>

				{successState ? (
					<div className="space-y-5 p-6">
						<div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
							<div className="flex items-start gap-3">
								<div className="rounded-full bg-emerald-100 p-2">
									<Check className="h-5 w-5 text-emerald-600" />
								</div>
								<div className="space-y-2">
									<div className="flex flex-wrap items-center gap-2">
										<p className="font-semibold text-emerald-900">
											Channel created successfully
										</p>
										<WhatsAppProviderBadge provider={successState.provider} />
									</div>
									<p className="text-sm text-emerald-800">
										{successState.provider === 'baileys'
											? getBaileysConnectionDescription(baileysSession)
											: successState.description}
									</p>
								</div>
							</div>
						</div>

						{successState.provider === 'baileys' ? (
							<div className="space-y-4">
								<div>
									<label className="text-xs font-black uppercase tracking-widest text-gray-400">
										Baileys Session Status
									</label>
									<div className="mt-1 flex items-center gap-2">
										<Input
											readOnly
											value={baileysSession?.status || successState.primaryValue}
											className="text-xs font-mono"
										/>
										{!baileysSession?.isConnected &&
										!['pairing_code_ready', 'qr_ready'].includes(
											String(baileysSession?.status || ''),
										) ? (
											<div className="rounded-md border border-gray-200 bg-white px-3 py-2 text-gray-500">
												<Loader2 className="h-4 w-4 animate-spin" />
											</div>
										) : null}
									</div>
								</div>

								{baileysQrPreviewUrl ? (
									<div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
										<p className="text-sm font-semibold text-amber-900">
											Scan QR Code
										</p>
										<p className="mt-1 text-sm text-amber-800">
											Buka WhatsApp utama, masuk ke menu Linked Devices, lalu
											scan QR ini.
										</p>
										<div className="mt-4 flex justify-center">
											<img
												src={baileysQrPreviewUrl}
												alt="Baileys QR code"
												className="h-64 w-64 rounded-2xl border border-white bg-white p-3 shadow-sm"
											/>
										</div>
									</div>
								) : baileysSession?.pairingCode ? (
									<div>
										<label className="text-xs font-black uppercase tracking-widest text-gray-400">
											Pairing Code
										</label>
										<div className="mt-1 flex gap-2">
											<Input
												readOnly
												value={baileysSession.pairingCode}
												className="text-xs font-mono tracking-[0.35em] uppercase"
											/>
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													handleCopy(
														baileysSession.pairingCode || '',
														'callback',
													)
												}
											>
												{copiedField === 'callback' ? (
													<Check size={14} />
												) : (
													<Copy size={14} />
												)}
											</Button>
										</div>
									</div>
								) : (
									<div className="rounded-xl border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
										Sedang menunggu QR code atau pairing code dari runtime
										Baileys. Modal ini akan memantau session secara otomatis
										selama backend mencoba menyambung.
									</div>
								)}

								{baileysSession?.lastError ? (
									<div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
										<p className="font-semibold">Runtime note</p>
										<p className="mt-1">{baileysSession.lastError}</p>
									</div>
								) : null}

								<div>
									<label className="text-xs font-black uppercase tracking-widest text-gray-400">
										{successState.secondaryLabel}
									</label>
									<div className="mt-1 flex gap-2">
										<Input
											readOnly
											type={
												successState.secondarySensitive && !showSensitiveValue
													? 'password'
													: 'text'
											}
											value={successState.secondaryValue}
											className="text-xs font-mono"
										/>
										{successState.secondarySensitive ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													setShowSensitiveValue((current) => !current)
												}
											>
												{showSensitiveValue ? (
													<EyeOff size={14} />
												) : (
													<Eye size={14} />
												)}
											</Button>
										) : null}
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() =>
												handleCopy(successState.secondaryValue, 'credential')
											}
										>
											{copiedField === 'credential' ? (
												<Check size={14} />
											) : (
												<Copy size={14} />
											)}
										</Button>
									</div>
								</div>
							</div>
						) : (
							<div className="space-y-4">
								<div>
									<label className="text-xs font-black uppercase tracking-widest text-gray-400">
										{successState.primaryLabel}
									</label>
									<div className="mt-1 flex gap-2">
										<Input
											readOnly
											value={successState.primaryValue}
											className="text-xs font-mono"
										/>
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() =>
												handleCopy(successState.primaryValue, 'callback')
											}
										>
											{copiedField === 'callback' ? (
												<Check size={14} />
											) : (
												<Copy size={14} />
											)}
										</Button>
									</div>
								</div>

								<div>
									<label className="text-xs font-black uppercase tracking-widest text-gray-400">
										{successState.secondaryLabel}
									</label>
									<div className="mt-1 flex gap-2">
										<Input
											readOnly
											type={
												successState.secondarySensitive && !showSensitiveValue
													? 'password'
													: 'text'
											}
											value={successState.secondaryValue}
											className="text-xs font-mono"
										/>
										{successState.secondarySensitive ? (
											<Button
												type="button"
												size="sm"
												variant="outline"
												onClick={() =>
													setShowSensitiveValue((current) => !current)
												}
											>
												{showSensitiveValue ? (
													<EyeOff size={14} />
												) : (
													<Eye size={14} />
												)}
											</Button>
										) : null}
										<Button
											type="button"
											size="sm"
											variant="outline"
											onClick={() =>
												handleCopy(successState.secondaryValue, 'credential')
											}
										>
											{copiedField === 'credential' ? (
												<Check size={14} />
											) : (
												<Copy size={14} />
											)}
										</Button>
									</div>
								</div>
							</div>
						)}

						<div className="flex gap-3">
							<Button
								type="button"
								variant="outline"
								className="flex-1"
								onClick={handleClose}
							>
								Tutup
							</Button>
							<Button
								type="button"
								className="flex-1 bg-emerald-500 font-bold text-white hover:bg-emerald-600"
								onClick={handleContinue}
							>
								Lanjut ke Pengaturan
							</Button>
						</div>
					</div>
				) : !selectedProvider ? (
					<div className="space-y-4 p-6">
						<div className="grid gap-3 md:grid-cols-2">
							<button
								type="button"
								onClick={() => setSelectedProvider('official')}
								className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left transition hover:border-emerald-400 hover:bg-emerald-100/70"
							>
								<div className="mb-3 flex items-center justify-between gap-2">
									<div className="rounded-full bg-emerald-100 p-2">
										<MessageCircle className="h-5 w-5 text-emerald-600" />
									</div>
									<WhatsAppProviderBadge provider="whatsapp_cloud" />
								</div>
								<p className="font-semibold text-gray-900">Official WABA</p>
								<p className="mt-2 text-sm text-gray-600">
									Gunakan jalur resmi Meta dengan WABA ID dan permanent access
									token.
								</p>
							</button>

							<button
								type="button"
								onClick={() => setSelectedProvider('baileys')}
								className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-left transition hover:border-amber-400 hover:bg-amber-100/70"
							>
								<div className="mb-3 flex items-center justify-between gap-2">
									<div className="rounded-full bg-amber-100 p-2">
										<MessageCircle className="h-5 w-5 text-amber-600" />
									</div>
									<WhatsAppProviderBadge provider="baileys" />
								</div>
								<p className="font-semibold text-gray-900">
									Non Official (Baileys)
								</p>
								<p className="mt-2 text-sm text-gray-600">
									Jalankan koneksi WhatsApp non-official lewat service Baileys
									terpisah yang terhubung ke CRM.
								</p>
							</button>
						</div>

						<div className="flex justify-end">
							<Button type="button" variant="outline" onClick={handleClose}>
								Batal
							</Button>
						</div>
					</div>
				) : (
					<form
						onSubmit={
							selectedProvider === 'official'
								? handleOfficialSubmit
								: handleBaileysSubmit
						}
						className="space-y-5 p-6"
					>
						<div className="flex items-center justify-between gap-3">
							<div className="space-y-1">
								<WhatsAppProviderBadge provider={selectedProvider} />
								<p className="text-sm text-gray-600">
									{selectedProvider === 'official'
										? 'Masukkan WABA ID dan permanent access token dari Meta.'
										: 'Masukkan identitas channel Baileys. Session akan dijalankan oleh service Baileys terpisah.'}
								</p>
							</div>
							<Button
								type="button"
								variant="outline"
								onClick={() => {
									setErrorMessage(null)
									setSelectedProvider(null)
								}}
								disabled={isBusy}
							>
								Ganti Opsi
							</Button>
						</div>

						{selectedProvider === 'official' ? (
							<>
								<div className="space-y-2">
									<label className="text-sm font-medium text-gray-900">
										WABA ID
									</label>
									<Input
										placeholder="e.g. 123456789012345"
										value={officialWabaId}
										onChange={(event) => {
											setErrorMessage(null)
											setOfficialWabaId(event.target.value)
										}}
										disabled={isBusy}
									/>
								</div>

								<div className="space-y-2">
									<label className="text-sm font-medium text-gray-900">
										Permanent Access Token
									</label>
									<div className="relative">
										<Input
											type={showAccessToken ? 'text' : 'password'}
											placeholder="e.g. EAAxxxxxxxxxxxxx"
											value={officialAccessToken}
											onChange={(event) => {
												setErrorMessage(null)
												setOfficialAccessToken(event.target.value)
											}}
											disabled={isBusy}
											className="pr-11"
										/>
										<button
											type="button"
											onClick={() =>
												setShowAccessToken((current) => !current)
											}
											className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-700"
										>
											{showAccessToken ? (
												<EyeOff className="h-4 w-4" />
											) : (
												<Eye className="h-4 w-4" />
											)}
										</button>
									</div>
								</div>
							</>
						) : (
							<>
								<div className="grid gap-4 md:grid-cols-2">
									<div className="space-y-2">
										<label className="text-sm font-medium text-gray-900">
											Channel Name
										</label>
										<Input
											placeholder="e.g. Sales Baileys"
											value={baileysName}
											onChange={(event) => {
												setErrorMessage(null)
												setBaileysName(event.target.value)
											}}
											disabled={isBusy}
										/>
									</div>
									<div className="space-y-2">
										<label className="text-sm font-medium text-gray-900">
											Phone Number
										</label>
										<Input
											placeholder="e.g. 6281234567890"
											value={baileysPhoneNumber}
											onChange={(event) => {
												setErrorMessage(null)
												setBaileysPhoneNumber(event.target.value)
											}}
											disabled={isBusy}
										/>
									</div>
								</div>

								<div className="space-y-2">
									<label className="text-sm font-medium text-gray-900">
										Provider Channel Key
									</label>
									<Input
										placeholder="e.g. session-sales-1"
										value={baileysProviderChannelKey}
										onChange={(event) => {
											setErrorMessage(null)
											setBaileysProviderChannelKey(event.target.value)
										}}
										disabled={isBusy}
									/>
								</div>
							</>
						)}

						{errorMessage ? (
							<div
								role="alert"
								className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
							>
								{errorMessage}
							</div>
						) : null}

						<div className="flex gap-3">
							<Button
								type="button"
								variant="outline"
								className="flex-1"
								onClick={handleClose}
								disabled={isBusy}
							>
								Batal
							</Button>
							<Button
								type="submit"
								className="flex-1 bg-emerald-500 font-bold text-white hover:bg-emerald-600"
								disabled={isBusy}
							>
								{isBusy ? (
									<>
										<Loader2 className="mr-2 h-4 w-4 animate-spin" />
										Menghubungkan...
									</>
								) : (
									'Connect Channel'
								)}
							</Button>
						</div>
					</form>
				)}
			</div>
		</div>
	)
}
