import { Link, createFileRoute, useNavigate } from '@tanstack/react-router'
import { useMemo, useState, type FormEvent } from 'react'
import { ArrowLeftIcon, SparklesIcon } from 'lucide-react'
import { toast } from 'sonner'

import { Button } from '@/components/ui/button'
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
	developersBackButtonClass,
	type ApiToolAdditionalPayloadItem,
	type ApiToolProperty,
	type ApiToolStatus,
} from '../-model'

function isValidHttpUrl(value: string): boolean {
	try {
		const parsed = new URL(value)
		return parsed.protocol === 'http:' || parsed.protocol === 'https:'
	} catch {
		return false
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

function DevelopersApiToolsCreatePage() {
	const navigate = useNavigate()
	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
	const token =
		typeof localStorage !== 'undefined'
			? localStorage.getItem('scalechat_token')
			: null
	const businessId = resolveBusinessIdFromClient(token)
	const [name, setName] = useState('')
	const [description, setDescription] = useState('')
	const [webhookAddress, setWebhookAddress] = useState('')
	const [method, setMethod] = useState<'GET' | 'POST'>('POST')
	const [status, setStatus] = useState<ApiToolStatus>('active')
	const [apiKey, setApiKey] = useState('')
	const [authorizationKey, setAuthorizationKey] = useState('')
	const [properties, setProperties] = useState<ApiToolProperty[]>([
		{ name: '', type: 'string', description: '' },
	])
	const [additionalPayload, setAdditionalPayload] = useState<
		ApiToolAdditionalPayloadItem[]
	>([])
	const [submitError, setSubmitError] = useState<string | null>(null)
	const [isSubmitting, setIsSubmitting] = useState(false)

	const normalizedProperties = useMemo(
		() =>
			properties
				.map((property) => ({
					name: property.name.trim(),
					type: property.type.trim() || 'string',
					description: property.description.trim(),
				}))
				.filter((property) => property.name.length > 0),
		[properties],
	)

	const normalizedAdditionalPayload = useMemo(
		() =>
			additionalPayload
				.map((item) => ({
					key: item.key.trim(),
					type: item.type,
					value: item.value,
				}))
				.filter((item) => item.key.length > 0),
		[additionalPayload],
	)

	const previewToolName = name.trim() || 'get_location_branch'
	const previewWebhook =
		webhookAddress.trim() || 'https://workflows.example.com/webhook/tool'

	const navigateBackAfterCreate = async () => {
		if (typeof window !== 'undefined' && window.history.length > 1) {
			window.history.back()
			return
		}

		await navigate({ to: '/developers/api-tools' })
	}

	const updateProperty = (index: number, patch: Partial<ApiToolProperty>) => {
		setProperties((current) =>
			current.map((property, propertyIndex) =>
				propertyIndex === index ? { ...property, ...patch } : property,
			),
		)
	}

	const addProperty = () => {
		setProperties((current) => [
			...current,
			{ name: '', type: 'string', description: '' },
		])
	}

	const removeProperty = (index: number) => {
		setProperties((current) =>
			current.filter((_, propertyIndex) => propertyIndex !== index),
		)
	}

	const updateAdditionalPayloadItem = (
		index: number,
		patch: Partial<ApiToolAdditionalPayloadItem>,
	) => {
		setAdditionalPayload((current) =>
			current.map((item, itemIndex) =>
				itemIndex === index ? { ...item, ...patch } : item,
			),
		)
	}

	const addAdditionalPayloadItem = () => {
		setAdditionalPayload((current) => [
			...current,
			{ key: '', type: 'text', value: '' },
		])
	}

	const removeAdditionalPayloadItem = (index: number) => {
		setAdditionalPayload((current) =>
			current.filter((_, itemIndex) => itemIndex !== index),
		)
	}

	const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
		event.preventDefault()
		setSubmitError(null)

		if (!name.trim()) {
			setSubmitError('Tool name is required.')
			return
		}

		if (!webhookAddress.trim()) {
			setSubmitError('Webhook address is required.')
			return
		}

		if (!isValidHttpUrl(webhookAddress.trim())) {
			setSubmitError('Webhook address must be a valid http(s) URL.')
			return
		}

		setIsSubmitting(true)
		try {
			const headers: Record<string, string> = {
				'Content-Type': 'application/json',
			}
			if (token) headers.Authorization = `Bearer ${token}`
			if (businessId) headers['x-business-id'] = businessId

			const url = new URL(`${API_URL}/api/ai_tools`)
			if (businessId) url.searchParams.set('business_id', businessId)

			const res = await fetch(url.toString(), {
				method: 'POST',
				headers,
				body: JSON.stringify({
					name: name.trim(),
					description: description.trim(),
					method,
					webhook_address: webhookAddress.trim(),
					api_key: apiKey.trim() || null,
					authorizationKey: authorizationKey.trim() || null,
					required: normalizedProperties.map((property) => property.name),
					properties: normalizedProperties,
					additional_payload: normalizedAdditionalPayload,
					type: 'simple',
				}),
			})
			if (!res.ok) {
				const err = await res.json().catch(() => ({}))
				setSubmitError(err?.error || 'Failed to create tool. Please try again.')
				return
			}
			await res.json().catch(() => null)

			toast.success('API tool created')
			await navigateBackAfterCreate()
		} catch {
			setSubmitError('Failed to create tool. Please try again.')
		} finally {
			setIsSubmitting(false)
		}
	}

	return (
		<div className="flex-1 flex flex-col h-full bg-white px-6 py-8">
			<Link
				to="/developers"
				data-testid="api-tools-new-back-button"
				className={developersBackButtonClass}
			>
				<ArrowLeftIcon className="mr-2 size-4" aria-hidden="true" />
				Back to Developers
			</Link>

			<header className="space-y-1">
				<h1 className="text-2xl font-semibold text-gray-900">Create API Tool</h1>
				<p className="text-sm text-gray-500">
					Configure webhook details, AI inputs, and additional payload defaults.
				</p>
			</header>

			<section
				className="mt-6 grid gap-4 xl:grid-cols-2"
				data-testid="api-tools-new-shell"
			>
				<Card size="sm" data-testid="api-tools-new-form-panel" className="py-0">
					<form onSubmit={handleSubmit}>
						<CardHeader className="px-4 py-4">
							<CardTitle className="text-base">Tool details</CardTitle>
							<CardDescription>
								Create a tool compatible with the AI tools integration flow.
							</CardDescription>
						</CardHeader>
						<CardContent className="space-y-4 pb-4">
							{submitError ? (
								<p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
									{submitError}
								</p>
							) : null}

							<div className="space-y-1.5">
								<label
									htmlFor="toolName"
									className="text-sm font-medium text-gray-900"
								>
									Tool name
								</label>
								<Input
									id="toolName"
									value={name}
									onChange={(event) => setName(event.target.value)}
									placeholder="e.g. get_location_branch"
									data-testid="api-tools-new-input-name"
								/>
							</div>

							<div className="space-y-1.5">
								<label
									htmlFor="toolDescription"
									className="text-sm font-medium text-gray-900"
								>
									Description
								</label>
								<Textarea
									id="toolDescription"
									value={description}
									onChange={(event) => setDescription(event.target.value)}
									placeholder="Explain when the AI should call this tool."
									data-testid="api-tools-new-input-description"
								/>
							</div>

							<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div className="space-y-1.5">
									<label
										htmlFor="toolMethod"
										className="text-sm font-medium text-gray-900"
									>
										Method
									</label>
									<select
										id="toolMethod"
										value={method}
										onChange={(event) =>
											setMethod(event.target.value as 'GET' | 'POST')
										}
										className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									>
										<option value="POST">POST</option>
										<option value="GET">GET</option>
									</select>
								</div>

								<div className="space-y-1.5">
									<label
										htmlFor="toolStatus"
										className="text-sm font-medium text-gray-900"
									>
										Status
									</label>
									<select
										id="toolStatus"
										value={status}
										onChange={(event) =>
											setStatus(event.target.value as ApiToolStatus)
										}
										className="h-8 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
									>
										<option value="active">Active</option>
										<option value="draft">Draft</option>
									</select>
								</div>
							</div>

							<div className="space-y-1.5">
								<label
									htmlFor="toolEndpoint"
									className="text-sm font-medium text-gray-900"
								>
									Webhook address
								</label>
								<Input
									id="toolEndpoint"
									value={webhookAddress}
									onChange={(event) => setWebhookAddress(event.target.value)}
									placeholder="https://workflows.example.com/webhook/tool"
									data-testid="api-tools-new-input-endpoint"
								/>
							</div>

							<div className="grid grid-cols-1 gap-4 md:grid-cols-2">
								<div className="space-y-1.5">
									<label
										htmlFor="toolApiKey"
										className="text-sm font-medium text-gray-900"
									>
										API key
									</label>
									<Input
										id="toolApiKey"
										value={apiKey}
										onChange={(event) => setApiKey(event.target.value)}
										placeholder="Optional"
									/>
								</div>

								<div className="space-y-1.5">
									<label
										htmlFor="toolAuthorizationKey"
										className="text-sm font-medium text-gray-900"
									>
										Authorization key
									</label>
									<Input
										id="toolAuthorizationKey"
										value={authorizationKey}
										onChange={(event) => setAuthorizationKey(event.target.value)}
										placeholder="Optional"
									/>
								</div>
							</div>

							<div className="space-y-3 border-t border-gray-200 pt-4">
								<div className="flex items-center justify-between gap-3">
									<h3 className="text-sm font-semibold text-gray-900">
										AI Inputs
									</h3>
									<Button
										type="button"
										size="sm"
										variant="outline"
										onClick={addProperty}
									>
										Add Input
									</Button>
								</div>

								<div className="space-y-3">
									{properties.map((property, index) => (
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
												placeholder="Description"
												className="mt-3"
											/>
										</div>
									))}
								</div>
							</div>

							<div className="space-y-3 border-t border-gray-200 pt-4">
								<div className="flex items-center justify-between gap-3">
									<h3 className="text-sm font-semibold text-gray-900">
										Additional Payload
									</h3>
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
									{additionalPayload.map((item, index) => (
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
								</div>
							</div>

							<Button
								type="submit"
								disabled={isSubmitting}
								data-testid="api-tools-new-submit-placeholder"
							>
								{isSubmitting ? 'Creating...' : 'Create Tool'}
							</Button>
						</CardContent>
					</form>
				</Card>

				<Card
					size="sm"
					data-testid="api-tools-new-preview-panel"
					className="border-gray-800 bg-[#1a1a1a] py-0 text-white shadow-xl"
				>
					<CardHeader className="px-4 py-4">
						<CardTitle className="flex items-center gap-2 text-base text-white">
							<SparklesIcon className="size-4 text-emerald-500" aria-hidden="true" />
							Request preview
						</CardTitle>
						<CardDescription className="text-gray-400">
							Inspect how the tool payload will be serialized.
						</CardDescription>
					</CardHeader>
					<CardContent className="space-y-4 pb-4">
						<div className="flex flex-col gap-2 sm:flex-row sm:items-center">
							<span className="inline-flex h-7 items-center rounded-md bg-[#2a2a2a] px-3 text-xs font-semibold text-white">
								{method}
							</span>
							<Input
								readOnly
								value={previewWebhook}
								className="h-7 border-gray-700 bg-[#2a2a2a] text-xs text-white"
							/>
						</div>

						<pre
							data-testid="api-tools-new-request-preview"
							className="overflow-x-auto rounded-md bg-[#2a2a2a] p-4 text-xs leading-relaxed text-gray-200"
						>
							{`${method} /ai_tools
{
  "name": "${previewToolName}",
  "description": "${description.trim() || 'Describe when this tool should run.'}",
  "webhook_address": "${previewWebhook}",
  "properties": ${JSON.stringify(normalizedProperties, null, 2)},
  "additional_payload": ${JSON.stringify(normalizedAdditionalPayload, null, 2)}
}`}
						</pre>
					</CardContent>
				</Card>
			</section>
		</div>
	)
}

export const Route = createFileRoute('/_app/developers/api-tools/new')({
	component: DevelopersApiToolsCreatePage,
})
