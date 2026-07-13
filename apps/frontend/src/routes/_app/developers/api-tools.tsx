import {
	Link,
	Outlet,
	createFileRoute,
	useMatches,
	useNavigate,
} from '@tanstack/react-router'
import { useEffect, useMemo, useState } from 'react'
import { ArrowLeftIcon, PlusIcon, Trash2Icon } from 'lucide-react'
import { toast } from 'sonner'

import { Button, buttonVariants } from '@/components/ui/button'
import {
	Card,
	CardContent,
	CardDescription,
	CardHeader,
	CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import {
	apiToolsEmptyState,
	developersBackButtonClass,
	resolveApiToolsState,
	type ApiTool,
	type ApiToolAdditionalPayloadItem,
	type ApiToolPayload,
	type ApiToolProperty,
	type ApiToolStatus,
} from './-model'

type ToolEditorState = {
	name: string
	description: string
	method: 'GET' | 'POST'
	webhookAddress: string
	apiKey: string
	authorizationKey: string
	status: ApiToolStatus
	properties: ApiToolProperty[]
	additionalPayload: ApiToolAdditionalPayloadItem[]
}

type ToolRequestResult = {
	ok: boolean
	status: number
	statusText: string
	method: 'GET' | 'POST'
	url: string
	durationMs: number
	requestBody: string
	responseBody: string
}

function toEditorState(tool: ApiTool): ToolEditorState {
	return {
		name: tool.name,
		description: tool.description,
		method: tool.method,
		webhookAddress: tool.webhookAddress,
		apiKey: tool.apiKey,
		authorizationKey: tool.authorizationKey,
		status: tool.status,
		properties: tool.properties.map((property) => ({ ...property })),
		additionalPayload: tool.additionalPayload.map((item) => ({ ...item })),
	}
}

function isValidHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
	} catch {
		return false
	}
}

function normalizeProperties(properties: ApiToolProperty[]): ApiToolProperty[] {
	return properties
		.map((property) => ({
			name: property.name.trim(),
			type: property.type.trim() || 'string',
			description: property.description.trim(),
		}))
		.filter((property) => property.name.length > 0)
}

function normalizeAdditionalPayload(
	items: ApiToolAdditionalPayloadItem[],
): ApiToolAdditionalPayloadItem[] {
	return items
		.map((item) => ({
			key: item.key.trim(),
			type: item.type,
			value: item.value,
		}))
		.filter((item) => item.key.length > 0)
}

function buildPayloadFromEditor(editor: ToolEditorState): ApiToolPayload {
	const properties = normalizeProperties(editor.properties)
	return {
		name: editor.name.trim(),
		description: editor.description.trim(),
		method: editor.method,
		webhookAddress: editor.webhookAddress.trim(),
		apiKey: editor.apiKey.trim(),
		authorizationKey: editor.authorizationKey.trim(),
		status: editor.status,
		properties,
		required: properties.map((property) => property.name),
		additionalPayload: normalizeAdditionalPayload(editor.additionalPayload),
	}
}

function validateEditor(editor: ToolEditorState): string | null {
	if (!editor.name.trim()) {
		return 'Tool name is required.'
	}

	if (!editor.webhookAddress.trim()) {
		return 'Webhook address is required.'
	}

	if (!isValidHttpUrl(editor.webhookAddress.trim())) {
		return 'Webhook address must be a valid http(s) URL.'
	}

	return null
}

function parseTypedValue(rawValue: string, typeHint: string): unknown {
	const normalizedType = typeHint.trim().toLowerCase()

	if (normalizedType === 'number') {
		const parsed = Number(rawValue)
		return Number.isFinite(parsed) ? parsed : rawValue
	}

	if (normalizedType === 'boolean') {
		const normalizedValue = rawValue.trim().toLowerCase()
		if (normalizedValue === 'true' || normalizedValue === '1') {
			return true
		}
		if (normalizedValue === 'false' || normalizedValue === '0') {
			return false
		}
	}

	return rawValue
}

function prettifyResponseText(value: string): string {
	const normalized = value.trim()
	if (!normalized) {
		return '(empty response body)'
	}

	try {
		const parsed = JSON.parse(normalized)
		return JSON.stringify(parsed, null, 2)
	} catch {
		return value
	}
}

type ServerApiTool = {
	id: string
	created_at: string
	name: string
	description: string
	webhook_address: string
	required: string[] | null
	properties: Array<Record<string, unknown>> | null
	additional_payload: Array<Record<string, unknown>> | null
	method: string
	api_key: string | null
	authorizationKey: string | null
}

function buildToolTestId(name: string, fallbackId: string): string {
	const normalized = String(name || '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)

	if (!normalized) {
		return `api-tools-card-${fallbackId}`
	}

	return `api-tools-card-${normalized}`
}

function mapServerToolToView(tool: ServerApiTool): ApiTool {
	const properties = (Array.isArray(tool.properties) ? tool.properties : [])
		.map((item) => ({
			name: String(item?.name || '').trim(),
			type: String(item?.type || 'string').trim() || 'string',
			description: String(item?.description || '').trim(),
		}))
		.filter((item) => item.name.length > 0)

	const additionalPayload = (
		Array.isArray(tool.additional_payload) ? tool.additional_payload : []
	)
		.map((item) => ({
			key: String(item?.key || '').trim(),
			type:
				item?.type === 'number' || item?.type === 'boolean'
					? item.type
					: ('text' as const),
			value: String(item?.value || ''),
		}))
		.filter((item) => item.key.length > 0)

	const createdAt = String(tool.created_at || new Date().toISOString())
	return {
		id: String(tool.id || ''),
		name: String(tool.name || '').trim(),
		webhookAddress: String(tool.webhook_address || '').trim(),
		description: String(tool.description || '').trim(),
		method: String(tool.method || '').toUpperCase() === 'GET' ? 'GET' : 'POST',
		apiKey: String(tool.api_key || ''),
		authorizationKey: String(tool.authorizationKey || ''),
		required: Array.isArray(tool.required)
			? tool.required.map((item) => String(item || '').trim()).filter(Boolean)
			: properties.map((property) => property.name),
		properties,
		additionalPayload,
		status: 'active',
		createdAt,
		updatedAt: createdAt,
		testId: buildToolTestId(String(tool.name || ''), String(tool.id || 'tool')),
	}
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

function DevelopersApiToolsPage() {
	const search = Route.useSearch() as { state?: string; tool_id?: string }
	const navigate = useNavigate()
	const matches = useMatches()
	const isCreateRoute = matches.some((match) =>
		match.routeId.endsWith('/api-tools/new'),
	)
	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
	const token =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_token')
			: null
	const businessId = resolveBusinessIdFromClient(token)
	const [tools, setTools] = useState<ApiTool[]>([])
	const [isLoadingTools, setIsLoadingTools] = useState(true)
	const [editor, setEditor] = useState<ToolEditorState | null>(null)
	const [editorError, setEditorError] = useState<string | null>(null)
	const [previewValues, setPreviewValues] = useState<Record<string, string>>({})
	const [isSaving, setIsSaving] = useState(false)
	const [isDeleting, setIsDeleting] = useState(false)
	const [isSendingRequest, setIsSendingRequest] = useState(false)
	const [requestResult, setRequestResult] = useState<ToolRequestResult | null>(
		null,
	)

	const fetchTools = async () => {
		setIsLoadingTools(true)
		try {
			const headers: Record<string, string> = {}
			if (token) headers.Authorization = `Bearer ${token}`
			if (businessId) headers['x-business-id'] = businessId

			const url = new URL(`${API_URL}/api/ai_tools`)
			if (businessId) url.searchParams.set('business_id', businessId)

			const res = await fetch(url.toString(), { headers })
			const payload = await res.json()
			const source = Array.isArray(payload?.data) ? payload.data : []
			setTools(source.map((item: ServerApiTool) => mapServerToolToView(item)))
		} catch (error) {
			console.error('Failed to fetch API tools:', error)
			toast.error('Failed to load API tools')
			setTools([])
		} finally {
			setIsLoadingTools(false)
		}
	}

	useEffect(() => {
		void fetchTools()
	}, [])

	const selectedToolId =
		typeof search.tool_id === 'string' ? search.tool_id : undefined
	const selectedTool = useMemo(
		() =>
			selectedToolId
				? tools.find((tool) => tool.id === selectedToolId) || null
				: null,
		[tools, selectedToolId],
	)

	useEffect(() => {
		if (!selectedTool) {
			setEditor(null)
			setPreviewValues({})
			setEditorError(null)
			return
		}

		const nextEditor = toEditorState(selectedTool)
		const nextPreviewValues: Record<string, string> = {}
		for (const property of nextEditor.properties) {
			const normalizedName = property.name.trim()
			if (normalizedName) {
				nextPreviewValues[normalizedName] = ''
			}
		}

		setEditor(nextEditor)
		setPreviewValues(nextPreviewValues)
		setEditorError(null)
		setRequestResult(null)
	}, [selectedTool])

	if (isCreateRoute) {
		return <Outlet />
	}

	const requestedState = search.state
	const state = resolveApiToolsState(requestedState)
	const isEmpty = !isLoadingTools && (state === 'empty' || tools.length === 0)

	const refreshTools = async () => {
		await fetchTools()
	}

	const updateEditorField = <K extends keyof ToolEditorState>(
		field: K,
		value: ToolEditorState[K],
	) => {
		setEditor((current) => (current ? { ...current, [field]: value } : current))
	}

	const updateProperty = (index: number, patch: Partial<ApiToolProperty>) => {
		setEditor((current) => {
			if (!current) return current
			const next = current.properties.map((property, propertyIndex) =>
				propertyIndex === index ? { ...property, ...patch } : property,
			)
			return { ...current, properties: next }
		})
	}

	const addProperty = () => {
		setEditor((current) =>
			current
				? {
						...current,
						properties: [
							...current.properties,
							{ name: '', type: 'string', description: '' },
						],
					}
				: current,
		)
	}

	const removeProperty = (index: number) => {
		setEditor((current) => {
			if (!current) return current
			return {
				...current,
				properties: current.properties.filter(
					(_, propertyIndex) => propertyIndex !== index,
				),
			}
		})
	}

	const updateAdditionalPayloadItem = (
		index: number,
		patch: Partial<ApiToolAdditionalPayloadItem>,
	) => {
		setEditor((current) => {
			if (!current) return current
			const next = current.additionalPayload.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item,
			)
			return { ...current, additionalPayload: next }
		})
	}

	const addAdditionalPayloadItem = () => {
		setEditor((current) =>
			current
				? {
						...current,
						additionalPayload: [
							...current.additionalPayload,
							{ key: '', type: 'text', value: '' },
						],
					}
				: current,
		)
	}

	const removeAdditionalPayloadItem = (index: number) => {
		setEditor((current) => {
			if (!current) return current
			return {
				...current,
				additionalPayload: current.additionalPayload.filter(
					(_, itemIndex) => itemIndex !== index,
				),
			}
		})
	}

	const handleSaveTool = async () => {
		if (!selectedTool || !editor) return

		const validationError = validateEditor(editor)
		if (validationError) {
			setEditorError(validationError)
			return
		}

		setIsSaving(true)
		try {
			const payload = buildPayloadFromEditor(editor)
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			}
			if (token) headers.Authorization = `Bearer ${token}`
			if (businessId) headers['x-business-id'] = businessId

			const url = new URL(`${API_URL}/api/ai_tools/${selectedTool.id}`)
			if (businessId) url.searchParams.set('business_id', businessId)

			const res = await fetch(url.toString(), {
				method: 'PATCH',
				headers,
				body: JSON.stringify({
					name: payload.name,
					description: payload.description,
					method: payload.method,
					webhook_address: payload.webhookAddress,
					api_key: payload.apiKey || null,
					authorizationKey: payload.authorizationKey || null,
					required: payload.required,
					properties: payload.properties,
					additional_payload: payload.additionalPayload,
				}),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				setEditorError(err?.error || 'Failed to update tool. Please try again.')
				return
			}

			setEditorError(null)
			await refreshTools()
			toast.success('API tool updated')
		} catch {
			setEditorError('Failed to update tool. Please try again.')
		} finally {
			setIsSaving(false)
		}
	}

	const handleDeleteTool = async () => {
		if (!selectedTool) return

		const confirmed = window.confirm(
			`Delete API tool "${selectedTool.name}"? This action cannot be undone.`,
		)
		if (!confirmed) {
			return
		}

		setIsDeleting(true)
		try {
			const headers: Record<string, string> = {}
			if (token) headers.Authorization = `Bearer ${token}`
			if (businessId) headers['x-business-id'] = businessId

			const url = new URL(`${API_URL}/api/ai_tools/${selectedTool.id}`)
			if (businessId) url.searchParams.set('business_id', businessId)

			const res = await fetch(url.toString(), {
				method: 'DELETE',
				headers,
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				toast.error(err?.error || 'Failed to delete tool')
				return
			}

			await refreshTools()
			toast.success('API tool deleted')
			await navigate({ to: '/developers/api-tools' })
		} finally {
			setIsDeleting(false)
		}
	}

	const handleSendRequest = async () => {
		if (!editor) {
			return
		}

		const validationError = validateEditor(editor)
		if (validationError) {
			toast.error(validationError)
			return
		}

		const normalizedProperties = normalizeProperties(editor.properties)
		const normalizedAdditionalPayload = normalizeAdditionalPayload(
			editor.additionalPayload,
		)
		const requestPayload: Record<string, unknown> = {}
		const missingRequired: string[] = []
		const requiredFields = new Set(
			(selectedTool?.required || []).map((field) => field.trim()).filter(Boolean),
		)

		for (const property of normalizedProperties) {
			const rawValue = previewValues[property.name] || ''
			if (!rawValue.trim()) {
				if (requiredFields.has(property.name)) {
					missingRequired.push(property.name)
				}
				continue
			}

			requestPayload[property.name] = parseTypedValue(rawValue, property.type)
		}

		for (const item of normalizedAdditionalPayload) {
			requestPayload[item.key] = parseTypedValue(item.value, item.type)
		}

		if (missingRequired.length > 0) {
			toast.error(`Missing required inputs: ${missingRequired.join(', ')}`)
			return
		}

		const headers: Record<string, string> = {}
		const apiKey = editor.apiKey.trim()
		const authKey = editor.authorizationKey.trim()
		if (token) headers.Authorization = `Bearer ${token}`
		if (businessId) headers['x-business-id'] = businessId
		headers['Content-Type'] = 'application/json'

		setIsSendingRequest(true)
		setRequestResult(null)

		try {
			const proxyUrl = new URL(`${API_URL}/api/ai_tools/execute`)
			if (businessId) proxyUrl.searchParams.set('business_id', businessId)

			const startedAt = Date.now()
			const response = await fetch(proxyUrl.toString(), {
				method: 'POST',
				headers,
				body: JSON.stringify({
					method: editor.method,
					webhook_address: editor.webhookAddress.trim(),
					api_key: apiKey || null,
					authorizationKey: authKey || null,
					payload: requestPayload,
				}),
			})
			const durationMs = Date.now() - startedAt
			const payload = await response.json().catch(() => null)
			const data =
				payload &&
				typeof payload === 'object' &&
				(payload as Record<string, unknown>).data &&
				typeof (payload as Record<string, unknown>).data === 'object'
					? ((payload as Record<string, unknown>).data as Record<string, unknown>)
					: null

			if (!response.ok || !data) {
				const failureMessage =
					payload &&
					typeof payload === 'object' &&
					typeof (payload as Record<string, unknown>).error === 'string'
						? String((payload as Record<string, unknown>).error)
						: `Request failed (${response.status})`
				setRequestResult({
					ok: false,
					status: response.status,
					statusText: response.statusText || 'REQUEST_FAILED',
					method: editor.method,
					url: editor.webhookAddress.trim(),
					durationMs,
					requestBody:
						editor.method === 'GET'
							? '(sent as query params)'
							: JSON.stringify(requestPayload, null, 2) || '{}',
					responseBody: failureMessage,
				})
				toast.error(failureMessage)
				return
			}

			const nextResult: ToolRequestResult = {
				ok: Boolean(data.ok),
				status: Number(data.status || 0),
				statusText: String(data.statusText || ''),
				method: editor.method,
				url: String(data.url || editor.webhookAddress.trim()),
				durationMs: Number(data.durationMs || durationMs),
				requestBody: String(
					data.requestBody ||
						(editor.method === 'GET'
							? '(sent as query params)'
							: JSON.stringify(requestPayload, null, 2) || '{}'),
				),
				responseBody: prettifyResponseText(String(data.responseBody || '')),
			}
			setRequestResult(nextResult)

			if (nextResult.ok) {
				toast.success(`Request sent successfully (${nextResult.status})`)
			} else {
				toast.error(`Request failed (${nextResult.status})`)
			}
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: 'Request failed. It may be blocked by CORS or network policy.'
			setRequestResult({
				ok: false,
				status: 0,
				statusText: 'NETWORK_ERROR',
				method: editor.method,
				url: editor.webhookAddress.trim(),
				durationMs: 0,
				requestBody:
					editor.method === 'GET'
						? '(sent as query params)'
						: JSON.stringify(requestPayload, null, 2) || '{}',
				responseBody: message,
			})
			toast.error('Request could not be sent (network or CORS)')
		} finally {
			setIsSendingRequest(false)
		}
	}

	if (selectedToolId) {
		if (isLoadingTools) {
			return (
				<div className="flex-1 flex flex-col h-full bg-white px-6 py-8">
					<Card size="sm" className="py-0">
						<CardHeader className="px-4 py-4">
							<CardTitle className="text-base">Loading tool...</CardTitle>
						</CardHeader>
					</Card>
				</div>
			)
		}

		if (!selectedTool || !editor) {
			return (
				<div className="flex-1 flex flex-col h-full bg-white px-6 py-8">
					<Link
						to="/developers/api-tools"
						className="mb-4 inline-flex items-center text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700"
					>
						<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
						Back to tools
					</Link>

					<Card size="sm" className="border-dashed py-0">
						<CardHeader className="px-4 py-4">
							<CardTitle className="text-base">Tool not found</CardTitle>
							<CardDescription>
								The selected tool is no longer available. Open the tools list and
								choose another tool.
							</CardDescription>
						</CardHeader>
						<CardContent className="pb-4">
							<Link
								to="/developers/api-tools"
								className={buttonVariants({ size: 'sm' })}
							>
								Back to tools
							</Link>
						</CardContent>
					</Card>
				</div>
			)
		}

		const normalizedProperties = normalizeProperties(editor.properties)
		const normalizedAdditionalPayload = normalizeAdditionalPayload(
			editor.additionalPayload,
		)

		return (
			<div className="flex-1 flex flex-col h-full bg-white px-6 py-8">
				<Link
					to="/developers/api-tools"
					data-testid="api-tools-back-button"
					className="mb-4 inline-flex items-center text-sm font-medium text-emerald-600 transition-colors hover:text-emerald-700"
				>
					<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
					Back to tools
				</Link>

				<section className="grid grid-cols-1 gap-6 xl:grid-cols-2">
					<Card size="sm" className="py-0">
						<CardHeader className="px-4 py-4">
							<div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
								<div>
									<CardTitle className="text-2xl">{selectedTool.name}</CardTitle>
									<CardDescription className="mt-1">
										Edit tool details, AI inputs, and payload defaults.
									</CardDescription>
								</div>
								<div className="flex gap-2">
									<Button
										type="button"
										size="sm"
										onClick={() => void handleSaveTool()}
										disabled={isSaving || isDeleting}
									>
										{isSaving ? 'Saving...' : 'Save Changes'}
									</Button>
									<Button
										type="button"
										size="sm"
										variant="destructive"
										onClick={() => void handleDeleteTool()}
										disabled={isSaving || isDeleting}
									>
										<Trash2Icon className="size-4" aria-hidden="true" />
										{isDeleting ? 'Deleting...' : 'Delete Tool'}
									</Button>
								</div>
							</div>
						</CardHeader>
						<CardContent className="space-y-6 pb-4">
							{editorError ? (
								<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
									{editorError}
								</p>
							) : null}

							<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div className="space-y-1.5 md:col-span-2">
									<label className="text-sm font-medium text-gray-900">
										Tool name
									</label>
									<Input
										value={editor.name}
										onChange={(event) =>
											updateEditorField('name', event.target.value)
										}
										placeholder="e.g. get_location_branch"
									/>
								</div>

								<div className="space-y-1.5 md:col-span-2">
									<label className="text-sm font-medium text-gray-900">
										Description
									</label>
									<Textarea
										value={editor.description}
										onChange={(event) =>
											updateEditorField('description', event.target.value)
										}
										placeholder="Explain when this tool should run."
									/>
								</div>

								<div className="space-y-1.5">
									<label className="text-sm font-medium text-gray-900">
										Method
									</label>
									<select
										value={editor.method}
										onChange={(event) =>
											updateEditorField(
												'method',
												event.target.value as ToolEditorState['method'],
											)
										}
										className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									>
										<option value="POST">POST</option>
										<option value="GET">GET</option>
									</select>
								</div>

								<div className="space-y-1.5">
									<label className="text-sm font-medium text-gray-900">
										Status
									</label>
									<select
										value={editor.status}
										onChange={(event) =>
											updateEditorField(
												'status',
												event.target.value as ApiToolStatus,
											)
										}
										className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									>
										<option value="active">Active</option>
										<option value="draft">Draft</option>
									</select>
								</div>

								<div className="space-y-1.5 md:col-span-2">
									<label className="text-sm font-medium text-gray-900">
										Webhook address
									</label>
									<Input
										value={editor.webhookAddress}
										onChange={(event) =>
											updateEditorField('webhookAddress', event.target.value)
										}
										placeholder="https://workflows.example.com/webhook/tool"
									/>
								</div>

								<div className="space-y-1.5">
									<label className="text-sm font-medium text-gray-900">
										API key
									</label>
									<Input
										value={editor.apiKey}
										onChange={(event) =>
											updateEditorField('apiKey', event.target.value)
										}
										placeholder="Optional"
									/>
								</div>

								<div className="space-y-1.5">
									<label className="text-sm font-medium text-gray-900">
										Authorization key
									</label>
									<Input
										value={editor.authorizationKey}
										onChange={(event) =>
											updateEditorField('authorizationKey', event.target.value)
										}
										placeholder="Optional"
									/>
								</div>
							</div>

							<div className="space-y-3 border-t border-gray-200 pt-4">
								<div className="flex items-center justify-between gap-3">
									<div>
										<h3 className="text-sm font-semibold text-gray-900">
											AI Inputs
										</h3>
										<p className="text-xs text-gray-500">
											Inputs the AI will fill from conversation context.
										</p>
									</div>
									<Button type="button" size="sm" variant="outline" onClick={addProperty}>
										Add Input
									</Button>
								</div>

								<div className="space-y-3">
									{editor.properties.map((property, index) => (
										<div
											key={`property-${index}`}
											className="rounded-lg border border-gray-200 bg-gray-50 p-3"
										>
											<div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_140px_auto]">
												<Input
													value={property.name}
													onChange={(event) =>
														updateProperty(index, { name: event.target.value })
													}
													placeholder="name"
												/>
												<Input
													value={property.type}
													onChange={(event) =>
														updateProperty(index, { type: event.target.value })
													}
													placeholder="string"
												/>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => removeProperty(index)}
												>
													Remove
												</Button>
											</div>
											<Textarea
												value={property.description}
												onChange={(event) =>
													updateProperty(index, {
														description: event.target.value,
													})
												}
												placeholder="Describe how AI should fill this input."
												className="mt-3"
											/>
										</div>
									))}

									{editor.properties.length === 0 ? (
										<p className="text-xs text-gray-500">
											No AI inputs yet. Add one to shape the request body.
										</p>
									) : null}
								</div>
							</div>

							<div className="space-y-3 border-t border-gray-200 pt-4">
								<div className="flex items-center justify-between gap-3">
									<div>
										<h3 className="text-sm font-semibold text-gray-900">
											Additional Payload
										</h3>
										<p className="text-xs text-gray-500">
											Static key-value pairs always sent with the request.
										</p>
									</div>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={addAdditionalPayloadItem}
									>
										Add Payload
									</Button>
								</div>

								<div className="space-y-3">
									{editor.additionalPayload.map((item, index) => (
										<div
											key={`payload-${index}`}
											className="rounded-lg border border-gray-200 bg-gray-50 p-3"
										>
											<div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_120px_auto]">
												<Input
													value={item.key}
													onChange={(event) =>
														updateAdditionalPayloadItem(index, {
															key: event.target.value,
														})
													}
													placeholder="key"
												/>
												<select
													value={item.type}
													onChange={(event) =>
														updateAdditionalPayloadItem(index, {
															type:
																event.target
																	.value as ApiToolAdditionalPayloadItem['type'],
														})
													}
													className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
												>
													<option value="text">text</option>
													<option value="number">number</option>
													<option value="boolean">boolean</option>
												</select>
												<Button
													type="button"
													size="sm"
													variant="outline"
													onClick={() => removeAdditionalPayloadItem(index)}
												>
													Remove
												</Button>
											</div>
											<Input
												value={item.value}
												onChange={(event) =>
													updateAdditionalPayloadItem(index, {
														value: event.target.value,
													})
												}
												placeholder="value"
												className="mt-3"
											/>
										</div>
									))}

									{editor.additionalPayload.length === 0 ? (
										<p className="text-xs text-gray-500">
											No additional payload rows configured.
										</p>
									) : null}
								</div>
							</div>
						</CardContent>
					</Card>

					<Card
						size="sm"
						className="border-gray-800 bg-[#1a1a1a] py-0 text-white shadow-xl"
					>
						<CardHeader className="px-4 py-4">
							<CardTitle className="text-base text-white">
								Request Preview
							</CardTitle>
							<CardDescription className="text-gray-400">
								Preview body payload and test values before triggering requests.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 pb-4">
							<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
								<span className="inline-flex h-7 items-center rounded-md bg-[#2a2a2a] px-3 text-xs font-semibold text-white">
									{editor.method}
								</span>
								<Input
									readOnly
									value={editor.webhookAddress}
									className="h-7 border-gray-700 bg-[#2a2a2a] text-xs text-white"
								/>
							</div>

							<div className="rounded-md bg-[#2a2a2a] p-4">
								<p className="mb-2 text-xs font-medium text-gray-400">POST Body</p>
								<div className="font-mono text-sm text-white">
									<div>{'{'}</div>
									<div className="ml-4 space-y-3">
										{normalizedProperties.map((property) => (
											<div key={property.name}>
												<div className="flex flex-col gap-1">
													<div className="text-green-400">
														&quot;{property.name}&quot;
													</div>
													<Input
														value={previewValues[property.name] || ''}
														onChange={(event) =>
															setPreviewValues((current) => ({
																...current,
																[property.name]: event.target.value,
															}))
														}
														placeholder="Enter value..."
														className="h-8 border-gray-700 bg-[#1a1a1a] text-green-300"
													/>
												</div>
												{property.description ? (
													<p className="mt-1 text-xs text-gray-500">
														{property.description}
													</p>
												) : null}
											</div>
										))}

										{normalizedAdditionalPayload.map((item) => (
											<div key={`payload-${item.key}`} className="text-cyan-300">
												&quot;{item.key}&quot;: {item.value || '""'}
											</div>
										))}
									</div>
									<div>{'}'}</div>
								</div>
							</div>

							<div className="flex justify-end">
								<Button
									type="button"
									size="sm"
									onClick={() => void handleSendRequest()}
									disabled={isSendingRequest}
								>
									{isSendingRequest ? 'Sending...' : 'Send Request'}
								</Button>
							</div>

							{requestResult ? (
								<div className="rounded-md bg-[#2a2a2a] p-4">
									<div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
										<span
											className={
												requestResult.ok ? 'text-emerald-400' : 'text-red-400'
											}
										>
											{requestResult.ok ? 'Success' : 'Failed'}
										</span>
										<span className="text-gray-500">•</span>
										<span className="text-gray-300">{requestResult.method}</span>
										<span className="text-gray-500">•</span>
										<span className="text-gray-300">
											{requestResult.status}
											{' '}
											{requestResult.statusText}
										</span>
										<span className="text-gray-500">•</span>
										<span className="text-gray-300">
											{requestResult.durationMs}
											ms
										</span>
									</div>

									<p className="mb-2 break-all text-[11px] text-gray-500">
										{requestResult.url}
									</p>

									<div className="grid gap-3 md:grid-cols-2">
										<div>
											<p className="mb-1 text-xs font-medium text-gray-400">
												Request
											</p>
											<pre className="max-h-40 overflow-auto rounded border border-gray-700 bg-[#1a1a1a] p-2 text-[11px] text-gray-300">
												{requestResult.requestBody}
											</pre>
										</div>
										<div>
											<p className="mb-1 text-xs font-medium text-gray-400">
												Response
											</p>
											<pre className="max-h-40 overflow-auto rounded border border-gray-700 bg-[#1a1a1a] p-2 text-[11px] text-gray-300">
												{requestResult.responseBody}
											</pre>
										</div>
									</div>
								</div>
							) : null}
						</CardContent>
					</Card>
				</section>
			</div>
		)
	}

	const toolCardAccents: Array<[string, string]> = [
		['rgb(221, 160, 221)', 'rgb(216, 191, 216)'],
		['rgb(135, 206, 235)', 'rgb(135, 206, 250)'],
		['rgb(240, 230, 140)', 'rgb(238, 232, 170)'],
		['rgb(152, 251, 152)', 'rgb(144, 238, 144)'],
		['rgb(255, 182, 193)', 'rgb(255, 192, 203)'],
	]

	return (
		<div className="flex-1 h-full bg-white py-8 px-4 sm:px-6 lg:px-8">
			<Link
				to="/developers"
				data-testid="api-tools-back-button"
				className={developersBackButtonClass}
			>
				<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
				Back to Developers
			</Link>

			<div className="mt-1 pb-6">
				<div className="mb-2 flex flex-wrap items-center justify-between gap-4">
					<h1
						className="text-xl font-semibold text-gray-900"
						data-testid="api-tools-page-title"
					>
						Tools
					</h1>
					<Link
						to="/developers/api-tools/new"
						data-testid="api-tools-create-action"
						className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
					>
						<PlusIcon className="h-4 w-4" aria-hidden="true" />
						Create New Tool
					</Link>
				</div>

				<p
					className="mb-4 text-sm text-gray-500"
					data-testid="api-tools-page-description"
				>
					Don&apos;t forget to activate tools in AI Agent →
					{' '}
					Integrations →
					{' '}
					API Tools.
				</p>

				<section data-testid="api-tools-list-shell">
					{isEmpty ? (
						<Card
							size="sm"
							data-testid="api-tools-empty-state"
							className="border-dashed py-0"
						>
							<CardHeader className="px-4 py-4">
								<CardTitle className="text-base">
									{apiToolsEmptyState.headline}
								</CardTitle>
								<CardDescription>{apiToolsEmptyState.body}</CardDescription>
							</CardHeader>
							<CardContent className="pb-4">
								<Link
									to="/developers/api-tools/new"
									className={buttonVariants({ size: 'sm' })}
								>
									<PlusIcon className="size-4" aria-hidden="true" />
									Create New Tool
								</Link>
							</CardContent>
						</Card>
					) : (
						<div
							className="mx-4 grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3"
							data-testid="api-tools-cards-grid"
						>
								<Link
									to="/developers/api-tools/new"
									className="group relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-lg border bg-white p-4 shadow-md transition-all duration-300 ease-in-out hover:bg-gray-50"
								>
									<div
										className="absolute right-0 top-0 h-3/6 w-6/12 rounded-full opacity-10 blur-2xl"
										style={{ backgroundColor: 'rgb(135, 206, 235)' }}
									/>
									<div
										className="absolute right-8 top-12 h-3/6 w-6/12 rounded-full opacity-10 blur-2xl"
										style={{ backgroundColor: 'rgb(135, 206, 250)' }}
									/>
									<div className="z-10 flex items-center justify-between">
										<span className="text-gray-500">Tool</span>
										<span className="text-gray-500">•</span>
									</div>
									<div className="z-10 flex flex-1 flex-col items-center justify-center gap-3">
										<PlusIcon className="h-10 w-10 text-gray-600 transition-transform duration-200 group-hover:scale-110" />
										<span className="text-center text-lg font-semibold text-gray-900">
											Add New API Tool
										</span>
									</div>
									<div className="z-10 mt-4" />
								</Link>

							{tools.map((tool, index) => {
								const [accentA, accentB] =
									toolCardAccents[index % toolCardAccents.length]

								return (
									<div
										key={tool.id}
										data-testid={tool.testId}
										className="relative flex min-h-[180px] flex-col justify-between overflow-hidden rounded-lg border bg-white p-4 shadow-md"
									>
										<div
											className="absolute right-0 top-0 h-3/6 w-6/12 rounded-full opacity-10 blur-2xl"
											style={{ backgroundColor: accentA }}
										/>
										<div
											className="absolute right-8 top-12 h-3/6 w-6/12 rounded-full opacity-10 blur-2xl"
											style={{ backgroundColor: accentB }}
										/>

										<div className="z-10 flex items-center justify-between">
											<span className="text-gray-500">Tool</span>
											<span className="text-gray-500">•</span>
										</div>

										<div className="z-10 mt-2 flex flex-col justify-center">
											<h2 className="text-lg font-bold text-gray-900">
												{tool.name}
											</h2>
											<p className="mt-1 text-sm text-gray-600">
												{tool.description}
											</p>
										</div>

										<div className="z-10 mt-4 flex flex-wrap gap-2">
											<Link
												to={`/developers/api-tools?tool_id=${encodeURIComponent(tool.id)}`}
												className="w-auto rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-all duration-300 ease-in-out hover:bg-gray-50 active:scale-95"
												data-testid={`${tool.testId}-settings`}
											>
												Settings
											</Link>
										</div>
									</div>
								)
							})}
						</div>
					)}
				</section>
			</div>
		</div>
	)
}

export const Route = createFileRoute('/_app/developers/api-tools')({
	component: DevelopersApiToolsPage,
})
