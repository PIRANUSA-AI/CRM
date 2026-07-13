import { createFileRoute, Link, useNavigate } from '@tanstack/react-router'
import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
	ArrowLeftIcon,
	InfoIcon,
} from 'lucide-react'
import { toast } from 'sonner'

import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { developersBackButtonClass } from './-model'

type SearchSchema = {
	webhook_id?: string
}

type WebhookEventOption = {
	name: string
	description: string
}

const WEBHOOK_EVENT_OPTIONS: WebhookEventOption[] = [
	{
		name: 'message.received',
		description: 'Triggered when a new message is received from a contact',
	},
	{
		name: 'message.sent',
		description: 'Triggered when a message is sent to a contact',
	},
	{
		name: 'conversation.created',
		description: 'Triggered when a new conversation is created',
	},
	{
		name: 'conversation.stage_status_updated',
		description: 'Triggered when a conversation stage status is updated',
	},
	{
		name: 'conversation.pipeline_status_updated',
		description: 'Triggered when a conversation pipeline status is updated',
	},
	{
		name: 'conversation.handled_by_updated',
		description: 'Triggered when a conversation handled by is updated',
	},
	{
		name: 'conversation.labels_updated',
		description: 'Triggered when conversation labels are updated',
	},
	{
		name: 'contact.updated',
		description: 'Triggered when a contact is updated',
	},
	{
		name: 'ai_summary.generated',
		description: 'Triggered when the Generate AI Summary is used',
	},
	{
		name: 'conversation_note.created',
		description: 'Triggered when a note is added to a conversation',
	},
	{
		name: 'conversation_note.updated',
		description: 'Triggered when a note on a conversation is edited',
	},
]
const DEFAULT_SELECTED_EVENTS = WEBHOOK_EVENT_OPTIONS.map((option) => option.name)

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
	businessId: string
	inboxId: string | null
	webhookUrl: string
	events: string[]
	isActive: boolean
	secret: string | null
	headers: Record<string, unknown> | null
	createdAt: string
	isHidden: boolean
	boardId: string | null
}

type InboxRecord = {
	id: string
	name: string
	channel_type?: string | null
	channel_config?: Record<string, unknown> | null
}

type WebhookFormState = {
	name: string
	webhookUrl: string
	inboxId: string
	events: string[]
	secret: string
}

const EMPTY_FORM_STATE: WebhookFormState = {
	name: 'N8N Webhook',
	webhookUrl: '',
	inboxId: '',
	events: [...DEFAULT_SELECTED_EVENTS],
	secret: '',
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
		businessId: String(source.business_id || '').trim(),
		inboxId: source.inbox_id ? String(source.inbox_id) : null,
		webhookUrl,
		events,
		isActive: Boolean(source.is_active ?? true),
		secret: typeof source.secret === 'string' ? source.secret : null,
		headers:
			source.headers &&
			typeof source.headers === 'object' &&
			!Array.isArray(source.headers)
				? source.headers
				: null,
		createdAt:
			typeof source.created_at === 'string' ? source.created_at : '',
		isHidden: Boolean(source.is_hidden ?? false),
		boardId: source.board_id ? String(source.board_id) : null,
	}
}

function mapWebhookToFormState(webhook: BusinessWebhook): WebhookFormState {
	return {
		name: webhook.name || 'Webhook',
		webhookUrl: webhook.webhookUrl || '',
		inboxId: webhook.inboxId || '',
		events:
			webhook.events.length > 0
				? webhook.events
				: [...DEFAULT_SELECTED_EVENTS],
		secret: webhook.secret || '',
	}
}

function isDebugWebhookUrl(rawUrl: string) {
	const normalized = rawUrl.trim().toLowerCase()
	return normalized.includes('/webhook-test/')
}

function validateFormState(formState: WebhookFormState) {
	if (!formState.name.trim()) {
		return 'Name is required.'
	}

	if (!formState.webhookUrl.trim()) {
		return 'Remote webhook URL is required.'
	}

	try {
		const parsed = new URL(formState.webhookUrl.trim())
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
			return 'Webhook URL must use http or https.'
		}
	} catch {
		return 'Webhook URL must be a valid URL.'
	}

	if (formState.events.length === 0) {
		return 'Please select at least one event.'
	}

	return null
}

export const Route = createFileRoute('/_app/developers/webhooks')({
	validateSearch: (search): SearchSchema => ({
		webhook_id:
			typeof search.webhook_id === 'string' ? search.webhook_id : undefined,
	}),
	component: DevelopersWebhooksPage,
})

function DevelopersWebhooksPage() {
	const search = Route.useSearch()
	const navigate = useNavigate()

	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
	const token =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_token')
			: null
	const businessId = resolveBusinessIdFromClient(token)

	const [webhooks, setWebhooks] = useState<BusinessWebhook[]>([])
	const [inboxes, setInboxes] = useState<InboxRecord[]>([])
	const [isLoading, setIsLoading] = useState(true)
	const [isSubmitting, setIsSubmitting] = useState(false)
	const [formState, setFormState] = useState<WebhookFormState>(EMPTY_FORM_STATE)
	const [formError, setFormError] = useState<string | null>(null)

	const rawSelectedWebhookId =
		typeof search.webhook_id === 'string' ? search.webhook_id.trim() : ''
	const selectedWebhookId = rawSelectedWebhookId || 'new'
	const isEditing = Boolean(selectedWebhookId)
	const isCreating = selectedWebhookId === 'new'

	const selectedWebhook = useMemo(() => {
		if (!selectedWebhookId || selectedWebhookId === 'new') {
			return null
		}

		return webhooks.find((item) => item.id === selectedWebhookId) || null
	}, [selectedWebhookId, webhooks])
	const areAllEventsSelected = useMemo(
		() =>
			WEBHOOK_EVENT_OPTIONS.length > 0 &&
			WEBHOOK_EVENT_OPTIONS.every((option) =>
				formState.events.includes(option.name),
			),
		[formState.events],
	)
	const liveValidationError = useMemo(
		() => validateFormState(formState),
		[formState],
	)
	const isSubmitDisabled = isSubmitting || Boolean(liveValidationError)

	const buildAuthHeaders = (includeContentType = false) => {
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
		return headers
	}

	const fetchWebhooks = async () => {
		const headers = buildAuthHeaders()
		const url = new URL(`${API_URL}/api/business_webhooks`)
		if (businessId) {
			url.searchParams.set('business_id', businessId)
		}

		const response = await fetch(url.toString(), { headers })
		const payload = await response.json().catch(() => null)

		if (!response.ok) {
			throw new Error(
				String(payload?.error || 'Failed to load webhooks').trim(),
			)
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
	}

	const fetchInboxes = async () => {
		const headers = buildAuthHeaders()
		const response = await fetch(`${API_URL}/api/inboxes`, { headers })
		const payload = await response.json().catch(() => null)

		if (!response.ok) {
			throw new Error(
				String(payload?.error || 'Failed to load connected platforms').trim(),
			)
		}

		const source = Array.isArray(payload?.data) ? payload.data : []
		const mapped: InboxRecord[] = source.map((item: any) => ({
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
	}

	const refreshData = async () => {
		setIsLoading(true)
		try {
			await Promise.all([fetchWebhooks(), fetchInboxes()])
		} catch (error: any) {
			toast.error(error?.message || 'Failed to load webhooks')
			setWebhooks([])
			setInboxes([])
		} finally {
			setIsLoading(false)
		}
	}

	useEffect(() => {
		void refreshData()
	}, [])

	useEffect(() => {
		if (!isEditing) {
			setFormState(EMPTY_FORM_STATE)
			setFormError(null)
			return
		}

		if (isCreating) {
			setFormState(EMPTY_FORM_STATE)
			setFormError(null)
			return
		}

		if (selectedWebhook) {
			setFormState(mapWebhookToFormState(selectedWebhook))
			setFormError(null)
		}
	}, [isEditing, isCreating, selectedWebhook])

	const handleToggleEvent = (eventName: string) => {
		setFormState((current) => {
			const exists = current.events.includes(eventName)
			if (exists) {
				return {
					...current,
					events: current.events.filter((item) => item !== eventName),
				}
			}

			return {
				...current,
				events: [...current.events, eventName],
			}
		})
	}

	const handleSelectAllEvents = () => {
		setFormState((current) => ({
			...current,
			events: WEBHOOK_EVENT_OPTIONS.map((option) => option.name),
		}))
	}

	const handleDeleteWebhook = async (webhook: BusinessWebhook) => {
		const confirmed = window.confirm(
			`Delete webhook "${webhook.name}"? This action cannot be undone.`,
		)
		if (!confirmed) return

		try {
			const headers = buildAuthHeaders()
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

			await refreshData()
			toast.success('Webhook deleted')

			if (selectedWebhookId === webhook.id) {
				await navigate({
					to: '/developers/webhooks',
				})
			}
		} catch (error: any) {
			toast.error(error?.message || 'Failed to delete webhook')
		}
	}

	const handleSubmitForm = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()

		const validationError = validateFormState(formState)
		if (validationError) {
			setFormError(validationError)
			return
		}

		setFormError(null)
		setIsSubmitting(true)
		try {
			const headers = buildAuthHeaders(true)
			const url = isCreating
				? new URL(`${API_URL}/api/business_webhooks`)
				: new URL(
						`${API_URL}/api/business_webhooks/${String(selectedWebhook?.id || '')}`,
					)
			if (businessId) {
				url.searchParams.set('business_id', businessId)
			}

				const payload = {
					name: formState.name.trim(),
					webhook_url: formState.webhookUrl.trim(),
					inbox_id: formState.inboxId || null,
					events: formState.events,
					is_active: isCreating ? true : (selectedWebhook?.isActive ?? true),
					secret: formState.secret.trim() || null,
				}

			const response = await fetch(url.toString(), {
				method: isCreating ? 'POST' : 'PATCH',
				headers,
				body: JSON.stringify(payload),
			})
			const responsePayload = await response.json().catch(() => null)
			if (!response.ok) {
				throw new Error(
					responsePayload?.error ||
						(isCreating
						? 'Failed to create webhook'
							: 'Failed to update webhook'),
				)
			}

			const createdOrUpdatedSource =
				responsePayload &&
				typeof responsePayload === 'object' &&
				!Array.isArray(responsePayload)
					? (responsePayload.data && typeof responsePayload.data === 'object'
							? responsePayload.data
							: responsePayload)
					: null

			const createdOrUpdatedWebhook = createdOrUpdatedSource
				? mapServerWebhookToView(createdOrUpdatedSource as ServerBusinessWebhook)
				: null

			await refreshData()
			toast.success(isCreating ? 'Webhook created' : 'Webhook updated')
			if (isCreating && createdOrUpdatedWebhook?.id) {
				await navigate({
					to: '/developers/webhooks',
					search: { webhook_id: createdOrUpdatedWebhook.id },
				})
			} else if (!isCreating && selectedWebhook?.id) {
				await navigate({
					to: '/developers/webhooks',
					search: { webhook_id: selectedWebhook.id },
				})
			} else {
				await navigate({
					to: '/developers/webhooks',
					search: { webhook_id: 'new' },
				})
			}
		} catch (error: any) {
			setFormError(
				error?.message ||
					(isCreating ? 'Failed to create webhook' : 'Failed to update webhook'),
			)
		} finally {
			setIsSubmitting(false)
		}
	}

	if (isEditing && !isCreating && !selectedWebhook && !isLoading) {
		return (
			<div className="flex-1 min-h-0 overflow-y-auto bg-white px-6 py-8">
				<Link to="/developers" className={developersBackButtonClass}>
					<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
					Back to developers
				</Link>
				<Card size="sm" className="border-dashed py-0">
					<CardHeader className="px-4 py-4">
						<CardTitle className="text-base">Webhook not found</CardTitle>
						<CardDescription>
							The selected webhook is no longer available.
						</CardDescription>
					</CardHeader>
						<CardContent className="pb-4">
							<Link
								to="/developers"
								className="inline-flex h-7 items-center justify-center gap-1 rounded-[min(var(--radius-md),12px)] border border-transparent bg-blue-600 px-2.5 text-[0.8rem] font-medium text-white transition-colors hover:bg-blue-700"
							>
								Back to developers
							</Link>
						</CardContent>
					</Card>
				</div>
		)
	}

	if (isEditing) {
		return (
			<div className="flex-1 min-h-0 overflow-y-auto bg-white px-6 py-8">
				<Link
					to="/developers"
					className="mb-4 inline-flex items-center text-sm font-medium text-gray-600 transition-colors hover:text-gray-900"
				>
					<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
					Back
				</Link>

				<Card size="sm" className="py-0" data-testid="webhooks-edit-form">
					<CardHeader className="px-6 py-5">
						<CardTitle className="text-2xl font-bold text-gray-900">
							{isCreating ? 'Create webhook' : 'Edit webhook'}
						</CardTitle>
					</CardHeader>
					<CardContent className="px-6 pb-6">
						<form className="space-y-6" onSubmit={handleSubmitForm}>
							<div className="space-y-2">
								<Label className="text-sm font-medium text-gray-700">Name</Label>
								<Input
									required
									value={formState.name}
									onChange={(event) =>
										setFormState((current) => ({
											...current,
											name: event.target.value,
										}))
									}
									placeholder="My webhook name"
								/>
							</div>

							<div className="space-y-2">
								<div className="flex items-center gap-2">
									<Label className="text-sm font-medium text-gray-700">
										Remote webhook URL
									</Label>
									{isDebugWebhookUrl(formState.webhookUrl) ? (
										<span className="inline-flex items-center rounded-full border border-yellow-300 bg-yellow-100 px-2 py-0.5 text-xs font-semibold uppercase tracking-wide text-yellow-900">
											DEBUG
										</span>
									) : null}
								</div>
								<Input
									required
									type="url"
									value={formState.webhookUrl}
									onChange={(event) =>
										setFormState((current) => ({
											...current,
											webhookUrl: event.target.value,
										}))
									}
									placeholder="https://company.com/webhook?secret=token"
								/>
								<div className="mt-2 flex items-start gap-2 text-sm text-gray-600">
									<InfoIcon className="mt-0.5 size-4 shrink-0 text-blue-500" />
									<div className="space-y-1">
										<p>
											It is strongly advised to use HTTPS for encrypted and
											secure communication.
										</p>
										<p>
											If you want to protect your endpoint from public access,
											add a private token as URL query parameter.
										</p>
									</div>
								</div>
							</div>

							<div className="space-y-2">
								<Label className="text-sm font-medium text-gray-700">
									Optionally restrict webhook notifications from Connected
									Platforms
								</Label>
								<select
									value={formState.inboxId}
									onChange={(event) =>
										setFormState((current) => ({
											...current,
											inboxId: event.target.value,
										}))
									}
									className="h-10 w-full rounded-lg border border-gray-300 bg-white px-3 text-sm shadow-xs outline-none transition-colors focus-visible:border-blue-500 focus-visible:ring-2 focus-visible:ring-blue-500/20"
								>
									<option value="">All connected platforms</option>
									{inboxes.map((inbox) => (
										<option key={inbox.id} value={inbox.id}>
											{inbox.name}
											{inbox.channel_type
												? ` - ${String(inbox.channel_type).toLowerCase()}`
												: ''}
										</option>
									))}
								</select>
							</div>

							<div className="space-y-4">
								<div className="flex items-start justify-between gap-3">
									<Label className="text-sm font-medium text-gray-700">
										Events to notify: select the events you want to receive
										notifications on your webhook.{' '}
										<a
											href="https://chat.crm.ai/developers/webhooks"
											target="_blank"
											rel="noreferrer"
											className="text-blue-600 underline transition-colors hover:text-blue-800"
										>
											Documentation and examples ↗
										</a>
									</Label>
									<button
										type="button"
										onClick={handleSelectAllEvents}
										disabled={areAllEventsSelected}
										className="shrink-0 text-sm font-medium text-blue-600 transition-colors hover:text-blue-800 disabled:cursor-not-allowed disabled:text-gray-400"
									>
										Select all
									</button>
								</div>
								<div className="space-y-3">
									{WEBHOOK_EVENT_OPTIONS.map((option) => {
										const checked = formState.events.includes(option.name)
										return (
											<label
												key={option.name}
												className="flex cursor-pointer items-start gap-3 rounded-lg border border-gray-200 px-3 py-2 hover:bg-gray-50"
											>
												<input
													type="checkbox"
													checked={checked}
													onChange={() => handleToggleEvent(option.name)}
													className="mt-1 size-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
												/>
												<div className="space-y-1">
													<p className="text-sm font-medium text-gray-900">
														{option.name}
													</p>
													<p className="text-sm text-gray-600">
														{option.description}
													</p>
												</div>
											</label>
										)
									})}
								</div>
							</div>

							{formError ? (
								<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
									{formError}
								</p>
							) : null}

							<div
								className={`flex items-center gap-2 pt-2 ${
									!isCreating && selectedWebhook
										? 'justify-between'
										: 'justify-end'
								}`}
							>
								{!isCreating && selectedWebhook ? (
									<button
										type="button"
										className="inline-flex items-center px-6 py-3 border border-red-200 text-sm font-medium rounded-lg shadow-sm text-red-700 bg-white hover:bg-red-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 transition-colors"
										onClick={() => void handleDeleteWebhook(selectedWebhook)}
									>
										Delete
									</button>
								) : null}
								<button
									type="submit"
									disabled={isSubmitDisabled}
									className="inline-flex items-center px-6 py-3 border border-transparent text-sm font-medium rounded-lg shadow-sm text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
								>
									{isSubmitting
										? isCreating
											? 'Creating...'
											: 'Updating...'
										: isCreating
											? 'Create webhook'
											: 'Update webhook'}
								</button>
							</div>
						</form>
					</CardContent>
				</Card>
			</div>
		)
	}

	return null
}
