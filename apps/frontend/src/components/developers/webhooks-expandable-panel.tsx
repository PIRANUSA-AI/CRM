import { Link } from '@tanstack/react-router'
import { PencilIcon, Trash2Icon } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'

import { cn } from '@/lib/utils'

type ServerBusinessWebhook = {
	id: string
	name?: string | null
	business_id?: string | null
	inbox_id?: string | null
	webhook_url?: string | null
	url?: string | null
	events?: string[] | null
	subscriptions?: string[] | null
	is_active?: boolean | null
	secret?: string | null
	headers?: Record<string, unknown> | null
	created_at?: string | null
	is_hidden?: boolean | null
	board_id?: string | null
}

type BusinessWebhook = {
	id: string
	name: string
	inboxId: string | null
	webhookUrl: string
	events: string[]
	isActive: boolean
}

type InboxRecord = {
	id: string
	name: string
	channel_type?: string | null
	channel_config?: Record<string, unknown> | null
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
	try {
		const parts = token.split('.')
		if (parts.length < 2) return null
		const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
		const padded = encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '=')
		const json = atob(padded)
		const parsed = JSON.parse(json)
		return parsed && typeof parsed === 'object' ? parsed : null
	} catch {
		return null
	}
}

function resolveBusinessIdFromClient(token: string | null): string {
	if (typeof window !== 'undefined') {
		const storageCandidates = [
			localStorage.getItem('scalechat_business_id'),
			localStorage.getItem('scalechat_org_id'),
			localStorage.getItem('scalechat_app_id'),
			localStorage.getItem('scalechat_org_slug'),
		]
		const fromStorage = storageCandidates
			.map((value) => String(value || '').trim())
			.find(Boolean)
		if (fromStorage) return fromStorage
	}

	if (!token) return ''
	const payload = decodeJwtPayload(token)
	if (!payload) return ''

	const appMetadata =
		payload.app_metadata &&
		typeof payload.app_metadata === 'object' &&
		!Array.isArray(payload.app_metadata)
			? (payload.app_metadata as Record<string, unknown>)
			: null
	if (!appMetadata) return ''

	return String(
		appMetadata.biz_id ||
			appMetadata.business_id ||
			appMetadata.org_id ||
			appMetadata.app_id ||
			'',
	).trim()
}

function normalizeWebhookEvents(value: unknown) {
	if (!Array.isArray(value)) return []
	return value.map((item) => String(item || '').trim()).filter(Boolean)
}

function mapServerWebhookToView(source: ServerBusinessWebhook): BusinessWebhook {
	const webhookUrl = String(source.webhook_url || source.url || '').trim()
	const events = normalizeWebhookEvents(source.events || source.subscriptions)

	return {
		id: String(source.id || ''),
		name: String(source.name || 'Webhook').trim() || 'Webhook',
		inboxId: source.inbox_id ? String(source.inbox_id) : null,
		webhookUrl,
		events,
		isActive: Boolean(source.is_active ?? true),
	}
}

function isDebugWebhookUrl(rawUrl: string) {
	return rawUrl.trim().toLowerCase().includes('/webhook-test/')
}

function extractInboxPhone(channelConfig: unknown) {
	if (!channelConfig || typeof channelConfig !== 'object') {
		return ''
	}

	const config = channelConfig as Record<string, unknown>
	const candidates = [
		config.phone_number,
		config.display_phone_number,
		config.phone,
		config.number,
	]
	const value = candidates
		.map((item) => String(item || '').trim())
		.find(Boolean)

	return value || ''
}

function getInboxMeta(inboxId: string | null, inboxes: InboxRecord[]) {
	if (!inboxId) {
		return {
			platformName: 'All Platforms',
			platformDetail: '',
		}
	}

	const inbox = inboxes.find((item) => item.id === inboxId)
	if (!inbox) {
		return {
			platformName: 'Unknown Platform',
			platformDetail: '',
		}
	}

	const channelType = String(inbox.channel_type || '').trim()
	const phone = extractInboxPhone(inbox.channel_config)
	const channelText = channelType ? channelType.toLowerCase() : ''
	const detail = [channelText, phone].filter(Boolean).join(' - ')

	return {
		platformName: inbox.name || 'Unnamed Inbox',
		platformDetail: detail,
	}
}

type DevelopersWebhooksExpandablePanelProps = {
	enabled: boolean
}

export function DevelopersWebhooksExpandablePanel({
	enabled,
}: DevelopersWebhooksExpandablePanelProps) {
	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'

	const [webhooks, setWebhooks] = useState<BusinessWebhook[]>([])
	const [inboxes, setInboxes] = useState<InboxRecord[]>([])
	const [isLoading, setIsLoading] = useState(false)
	const [hasFetchedOnce, setHasFetchedOnce] = useState(false)
	const [errorMessage, setErrorMessage] = useState<string | null>(null)

	const buildAuthHeaders = (includeContentType = false) => {
		const token =
			typeof localStorage !== 'undefined'
				? localStorage.getItem('scalechat_token')
				: null
		const businessId = resolveBusinessIdFromClient(token)

		const headers: Record<string, string> = {}
		if (includeContentType) {
			headers['Content-Type'] = 'application/json'
		}
		if (token) {
			headers.Authorization = `Bearer ${token}`
		}
		if (businessId) {
			headers['x-business-id'] = businessId
		}

		return { headers, businessId }
	}

	const fetchWebhooks = useCallback(async () => {
		const { headers, businessId } = buildAuthHeaders()
		const url = new URL(`${API_URL}/api/business_webhooks`)
		if (businessId) {
			url.searchParams.set('business_id', businessId)
		}

		const response = await fetch(url.toString(), { headers })
		const payload = await response.json().catch(() => null)

		if (!response.ok) {
			throw new Error(String(payload?.error || 'Failed to load webhooks').trim())
		}

		const source = Array.isArray(payload)
			? payload
			: Array.isArray(payload?.data)
				? payload.data
				: []

		const mapped = source.map((item: ServerBusinessWebhook) =>
			mapServerWebhookToView(item),
		)
		setWebhooks(mapped)
	}, [API_URL])

	const fetchInboxes = useCallback(async () => {
		const { headers } = buildAuthHeaders()
		const response = await fetch(`${API_URL}/api/inboxes`, { headers })
		const payload = await response.json().catch(() => null)

		if (!response.ok) {
			throw new Error(
				String(payload?.error || 'Failed to load connected platforms').trim(),
			)
		}

		const source = Array.isArray(payload?.data) ? payload.data : []
		const mapped = source.map((item: any) => ({
			id: String(item.id || ''),
			name: String(item.name || '').trim() || 'Unnamed Inbox',
			channel_type: item.channel_type ? String(item.channel_type) : null,
			channel_config:
				item.channel_config &&
				typeof item.channel_config === 'object' &&
				!Array.isArray(item.channel_config)
					? (item.channel_config as Record<string, unknown>)
					: null,
		}))
		setInboxes(mapped.filter((item) => item.id.length > 0))
	}, [API_URL])

	const refreshData = useCallback(async () => {
		setIsLoading(true)
		setErrorMessage(null)
		try {
			await Promise.all([fetchWebhooks(), fetchInboxes()])
			setHasFetchedOnce(true)
		} catch (error: any) {
			setWebhooks([])
			setInboxes([])
			setErrorMessage(error?.message || 'Failed to load webhooks')
		} finally {
			setIsLoading(false)
		}
	}, [fetchInboxes, fetchWebhooks])

	useEffect(() => {
		if (!enabled || hasFetchedOnce) return
		void refreshData()
	}, [enabled, hasFetchedOnce, refreshData])

	const canRenderTable = useMemo(
		() => hasFetchedOnce && !isLoading && !errorMessage,
		[errorMessage, hasFetchedOnce, isLoading],
	)

	const handleDeleteWebhook = async (webhook: BusinessWebhook) => {
		const confirmed = window.confirm(
			`Delete webhook "${webhook.name}"? This action cannot be undone.`,
		)
		if (!confirmed) return

		try {
			const { headers, businessId } = buildAuthHeaders()
			const url = new URL(`${API_URL}/api/business_webhooks/${webhook.id}`)
			if (businessId) {
				url.searchParams.set('business_id', businessId)
			}

			const response = await fetch(url.toString(), {
				method: 'DELETE',
				headers,
			})
			if (!response.ok) {
				const payload = await response.json().catch(() => null)
				throw new Error(payload?.error || 'Failed to delete webhook')
			}

			toast.success('Webhook deleted')
			await refreshData()
		} catch (error: any) {
			toast.error(error?.message || 'Failed to delete webhook')
		}
	}

	return (
		<div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
			<div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
				<div className="flex items-center justify-between">
					<div>
						<h3 className="text-lg font-semibold text-gray-900">Webhooks</h3>
						<p className="text-sm text-gray-600 mt-1">
							Manage your webhook endpoints for real-time notifications
						</p>
					</div>
				</div>
			</div>

			{isLoading ? (
				<div className="px-6 py-8 text-sm text-gray-500">
					Loading webhooks...
				</div>
			) : null}

			{errorMessage ? (
				<div className="px-6 py-4">
					<div className="rounded-lg border border-red-200 bg-red-50 px-4 py-4">
					<p className="text-sm text-red-700">{errorMessage}</p>
					<button
						type="button"
						onClick={() => void refreshData()}
						className="mt-2 text-sm font-medium text-red-800 underline underline-offset-2"
					>
						Try again
					</button>
				</div>
				</div>
			) : null}

			{canRenderTable && webhooks.length === 0 ? (
				<div className="px-6 py-8 text-sm text-gray-500">
					No webhooks configured.
				</div>
			) : null}

			{canRenderTable && webhooks.length > 0 ? (
				<div className="overflow-x-auto">
					<table
						data-testid="developers-webhooks-expandable-table"
						className="min-w-full divide-y divide-gray-200"
					>
						<thead className="bg-gray-50">
							<tr>
								<th
									scope="col"
									className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									Name
								</th>
								<th
									scope="col"
									className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									Platform
								</th>
								<th
									scope="col"
									className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									Endpoint URL / Events
								</th>
								<th
									scope="col"
									className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider"
								>
									Status
								</th>
								<th scope="col" className="relative px-6 py-3">
									<span className="sr-only">Actions</span>
								</th>
							</tr>
						</thead>
						<tbody className="bg-white divide-y divide-gray-200">
							{webhooks.map((webhook) => {
								const inboxMeta = getInboxMeta(webhook.inboxId, inboxes)
								const isDebug = isDebugWebhookUrl(webhook.webhookUrl)
								return (
									<tr key={webhook.id} className="hover:bg-gray-50">
										<td className="px-6 py-4 whitespace-nowrap">
											<div className="flex items-center">
												<div
													className={cn(
														'h-2 w-2 rounded-full mr-3',
														webhook.isActive ? 'bg-green-400' : 'bg-gray-300',
													)}
												/>
												<div className="text-sm font-medium text-gray-900">
													{webhook.name}
												</div>
											</div>
										</td>
										<td className="px-6 py-4 whitespace-nowrap">
											<div className="text-sm text-gray-900">
												{inboxMeta.platformName}
											</div>
											{inboxMeta.platformDetail ? (
												<div className="text-xs text-gray-500">
													{inboxMeta.platformDetail}
												</div>
											) : null}
										</td>
										<td className="px-6 py-4">
											{isDebug ? (
												<div className="mb-2">
													<span className="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-yellow-900">
														DEBUG
													</span>
												</div>
											) : null}
											{webhook.webhookUrl ? (
												<div className="text-sm text-gray-900 break-all mb-2">
													{webhook.webhookUrl}
												</div>
											) : (
												<div className="text-sm text-gray-400 break-all mb-2">
													No endpoint URL
												</div>
											)}
											<div className="flex flex-wrap gap-1">
												{webhook.events.map((eventName) => (
													<span
														key={`${webhook.id}-${eventName}`}
														className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-blue-100 text-blue-800"
													>
														{eventName}
													</span>
												))}
											</div>
										</td>
										<td className="px-6 py-4 whitespace-nowrap">
											<span
												className={cn(
													'inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium',
													webhook.isActive
														? 'bg-green-100 text-green-800'
														: 'bg-gray-100 text-gray-700',
												)}
											>
												{webhook.isActive ? 'Active' : 'Inactive'}
											</span>
										</td>
										<td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
											<div className="flex items-center justify-end gap-2">
												<Link
													to="/developers/webhooks"
													search={{ webhook_id: webhook.id }}
													className="text-gray-400 hover:text-gray-600"
												>
													<PencilIcon className="size-4" aria-hidden="true" />
													<span className="sr-only">Edit webhook</span>
												</Link>
												<button
													type="button"
													className="text-gray-400 hover:text-red-600"
													onClick={() => void handleDeleteWebhook(webhook)}
												>
													<Trash2Icon className="size-4" aria-hidden="true" />
													<span className="sr-only">Delete webhook</span>
												</button>
											</div>
										</td>
									</tr>
								)
							})}
						</tbody>
					</table>
				</div>
			) : null}
		</div>
	)
}
