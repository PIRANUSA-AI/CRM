import { Link, createFileRoute } from '@tanstack/react-router'
import { useEffect, useState } from 'react'
import {
	Globe2Icon,
	KeyRoundIcon,
	MessageCircleIcon,
	PlusIcon,
	SquareArrowOutUpRightIcon,
	TerminalIcon,
} from 'lucide-react'

import { DevelopersSubmenuRow } from '@/components/developers/submenu-row'
import { DevelopersWebhooksExpandablePanel } from '@/components/developers/webhooks-expandable-panel'
import { apiKeyAccordionContent, developersSubmenuItems } from './-model'

type DeveloperKeyPayload = {
	api_key?: string
	openapi_url?: string
	docs_url?: string
}

function getSubmenuIcon(iconKey: string) {
	if (iconKey === 'terminal') {
		return <TerminalIcon className="size-5" aria-hidden="true" />
	}

	if (iconKey === 'message-circle') {
		return <MessageCircleIcon className="size-5" aria-hidden="true" />
	}

	if (iconKey === 'webhooks') {
		return <Globe2Icon className="size-5" aria-hidden="true" />
	}

	return <SquareArrowOutUpRightIcon className="size-5" aria-hidden="true" />
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

function DevelopersIndexPage() {
	const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3010'
	const [copiedField, setCopiedField] = useState<'api-key' | 'openapi' | null>(
		null,
	)
	const [isApiKeyLoading, setIsApiKeyLoading] = useState(true)
	const [apiKeyError, setApiKeyError] = useState<string | null>(null)
	const [apiKeyValue, setApiKeyValue] = useState(apiKeyAccordionContent.keyValue)
	const [openApiValue, setOpenApiValue] = useState(
		apiKeyAccordionContent.openApiValue || `${API_URL}/docs/json`,
	)
	const [docsHref, setDocsHref] = useState(
		apiKeyAccordionContent.docsHref || `${API_URL}/docs`,
	)

	const getRequestContext = () => {
		if (typeof localStorage === 'undefined') {
			return {
				token: null as string | null,
				businessId: '',
			}
		}

		const token = localStorage.getItem('scalechat_token')
		const businessId = resolveBusinessIdFromClient(token)
		return { token, businessId }
	}

	const applyDeveloperKeyPayload = (payload: DeveloperKeyPayload | null) => {
		const apiKey = String(payload?.api_key || '').trim()
		const openApiUrl = String(payload?.openapi_url || '').trim()
		const docsUrl = String(payload?.docs_url || '').trim()

		setApiKeyValue(apiKey)
		setOpenApiValue(openApiUrl || `${API_URL}/docs/json`)
		setDocsHref(docsUrl || `${API_URL}/docs`)
	}

	const fetchDeveloperKey = async () => {
		const { token, businessId } = getRequestContext()
		const headers: Record<string, string> = {}
		if (token) headers.Authorization = `Bearer ${token}`
		if (businessId) headers['x-business-id'] = businessId

		const path = '/api/developer_keys'
		const url = new URL(`${API_URL}${path}`)
		if (businessId) {
			url.searchParams.set('business_id', businessId)
		}

		const response = await fetch(url.toString(), {
			method: 'GET',
			headers,
		})
		const payload = await response.json().catch(() => null)

		if (!response.ok) {
			const message =
				payload &&
				typeof payload === 'object' &&
				typeof (payload as Record<string, unknown>).error === 'string'
					? String((payload as Record<string, unknown>).error)
					: 'Failed to load API key'
			throw new Error(message)
		}

		const data =
			payload &&
			typeof payload === 'object' &&
			(payload as Record<string, unknown>).data &&
			typeof (payload as Record<string, unknown>).data === 'object'
				? ((payload as Record<string, unknown>).data as DeveloperKeyPayload)
				: null

		applyDeveloperKeyPayload(data)
	}

	useEffect(() => {
		let isMounted = true

		const run = async () => {
			setIsApiKeyLoading(true)
			try {
				await fetchDeveloperKey()
				if (isMounted) setApiKeyError(null)
			} catch (error) {
				if (isMounted) {
					setApiKeyError(
						error instanceof Error
							? error.message
							: 'Failed to load API key from server',
					)
				}
			} finally {
				if (isMounted) setIsApiKeyLoading(false)
			}
		}

		void run()
		return () => {
			isMounted = false
		}
	}, [])

	const copyValue = async (value: string, field: 'api-key' | 'openapi') => {
		if (!value.trim()) {
			setCopiedField(null)
			return
		}

		try {
			await navigator.clipboard.writeText(value)
			setCopiedField(field)
			setTimeout(() => {
				setCopiedField((current) => (current === field ? null : current))
			}, 2000)
		} catch {
			setCopiedField(null)
		}
	}

	return (
		<div className="flex-1 flex flex-col h-full overflow-y-auto px-8 py-8">
			<header className="mb-8">
				<h1 className="mb-2 text-3xl font-bold text-gray-900">Developers</h1>
				<p className="text-gray-600">
					Manage your API keys, webhooks, tools, and development integrations
				</p>
			</header>

			<section className="space-y-4">
				<DevelopersSubmenuRow
					mode="expandable"
					icon={<KeyRoundIcon className="size-5" aria-hidden="true" />}
					title="API keys"
					description="Manage your account API keys"
					defaultExpanded={false}
					data-testid={apiKeyAccordionContent.accordionTestId}
					content={
						<div className="space-y-6">
							<div className="relative rounded-lg border border-gray-200 bg-white p-6 shadow-sm">
								<h2 className="mb-4 text-xl font-bold text-gray-900">
									{apiKeyAccordionContent.heading}
								</h2>

								{apiKeyError ? (
									<p className="mb-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">
										{apiKeyError}
									</p>
								) : null}

								<div className="space-y-4">
									<div>
										<label className="mb-2 block text-sm font-medium text-gray-700">
											API Key
										</label>
										<div className="flex items-center gap-2">
											<input
												type="text"
												readOnly
												value={
													isApiKeyLoading
														? 'Loading API key...'
														: apiKeyValue || 'No API key available'
												}
												className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm"
											/>
											<button
												type="button"
												data-testid={apiKeyAccordionContent.keyCopyTestId}
												disabled={isApiKeyLoading || !apiKeyValue.trim()}
												onClick={() => void copyValue(apiKeyValue, 'api-key')}
												className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
											>
												{copiedField === 'api-key' ? 'Copied' : 'Copy'}
											</button>
										</div>
									</div>

									<div>
										<label className="mb-2 block text-sm font-medium text-gray-700">
											API Documentation
										</label>
										<a
											href={docsHref}
											target="_blank"
											rel="noreferrer"
											className="inline-block text-sm text-blue-600 hover:underline"
										>
											{apiKeyAccordionContent.docsLabel}
										</a>
									</div>

									<div>
										<label className="mb-2 block text-sm font-medium text-gray-700">
											{apiKeyAccordionContent.openApiLabel}
										</label>
										<div className="flex items-center gap-2">
											<input
												type="text"
												readOnly
												value={
													isApiKeyLoading
														? 'Loading OpenAPI address...'
														: openApiValue
												}
												className="w-full rounded-lg border border-gray-200 bg-gray-50 px-4 py-2 text-sm"
											/>
											<button
												type="button"
												data-testid={apiKeyAccordionContent.openApiCopyTestId}
												disabled={isApiKeyLoading || !openApiValue.trim()}
												onClick={() => void copyValue(openApiValue, 'openapi')}
												className="rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-60"
											>
												{copiedField === 'openapi' ? 'Copied' : 'Copy'}
											</button>
										</div>
									</div>
								</div>
							</div>
						</div>
					}
				/>

				<DevelopersSubmenuRow
					mode="expandable"
					icon={<Globe2Icon className="size-5" aria-hidden="true" />}
					title="Webhooks"
					description="Connect and manage webhook events for API integration and automation"
					data-testid="developers-subnav-webhooks"
					rightAction={
						<Link
							to="/developers/webhooks"
							onClick={(event) => event.stopPropagation()}
							className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700"
						>
							<PlusIcon className="size-4" aria-hidden="true" />
							Create webhook
						</Link>
					}
					content={({ expanded }) => (
						<DevelopersWebhooksExpandablePanel enabled={expanded} />
					)}
				/>

				{developersSubmenuItems
					.filter((item) => item.href !== '/developers/webhooks')
					.map((item) => (
						<DevelopersSubmenuRow
							key={item.href}
							mode="link"
							href={item.href}
							icon={getSubmenuIcon(item.iconKey)}
							title={item.title}
							description={item.description}
							data-testid={item.testId}
						/>
					))}
			</section>
		</div>
	)
}

export const Route = createFileRoute('/_app/developers/')({
	component: DevelopersIndexPage,
})
