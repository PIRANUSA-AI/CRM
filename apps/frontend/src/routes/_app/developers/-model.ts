import { randomId } from '@/lib/id'

export type DevelopersSubmenuItem = {
	title: string
	description: string
	iconKey: string
	href: string
	testId: string
}

export const developersSubmenuItems: DevelopersSubmenuItem[] = [
	{
		title: 'Webhooks',
		description:
			'Connect and manage webhook events for API integration and automation',
		iconKey: 'webhooks',
		href: '/developers/webhooks',
		testId: 'developers-subnav-webhooks',
	},
	{
		title: 'API Tools',
		description: 'Manage and configure your API tools for AI agents',
		iconKey: 'terminal',
		href: '/developers/api-tools',
		testId: 'developers-subnav-api-tools',
	},
	{
		title: 'Messages sent by API',
		description: 'View and manage messages sent through the API',
		iconKey: 'message-circle',
		href: '/developers/messages-sent-by-api',
		testId: 'developers-subnav-messages-sent-by-api',
	},
	{
		title: 'API Documentation',
		description:
			'Explore the detailed API documentation with code examples in 15+ programming languages.',
		iconKey: 'api-documentation',
		href: '/developers/api-documentation',
		testId: 'developers-subnav-api-documentation',
	},
]

export const apiKeyAccordionContent = {
	heading: 'Open API Access',
	helperText: 'Copy this key to authenticate every CRM automation call.',
	keyValue: '',
	keyCopyTestId: 'api-keys-copy-primary',
	docsLabel: 'View Postman Documentation',
	docsHref: '',
	openApiLabel: 'OpenAPI Address',
	openApiValue: '',
	openApiCopyTestId: 'api-keys-copy-openapi',
	accordionTestId: 'api-keys-accordion',
}

export const developersBackButtonClass =
	'mb-5 inline-flex w-fit self-start items-center rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50'

export type ApiToolStatus = 'active' | 'draft'
export type ApiToolMethod = 'GET' | 'POST'

export type ApiToolProperty = {
	name: string
	type: string
	description: string
}

export type ApiToolAdditionalPayloadItem = {
	key: string
	type: 'text' | 'number' | 'boolean'
	value: string
}

export type ApiTool = {
	id: string
	name: string
	webhookAddress: string
	description: string
	method: ApiToolMethod
	apiKey: string
	authorizationKey: string
	required: string[]
	properties: ApiToolProperty[]
	additionalPayload: ApiToolAdditionalPayloadItem[]
	status: ApiToolStatus
	createdAt: string
	updatedAt: string
	testId: string
}

export type ApiToolPayload = {
	name: string
	webhookAddress: string
	description: string
	method: ApiToolMethod
	apiKey: string
	authorizationKey: string
	required: string[]
	properties: ApiToolProperty[]
	additionalPayload: ApiToolAdditionalPayloadItem[]
	status: ApiToolStatus
}

export const apiToolsEmptyState = {
	headline: 'No API tools yet',
	body: 'Create your first tool to publish programmable automations.',
}

const API_TOOLS_STORAGE_KEY = 'crm_developers_api_tools_v2'

type ApiToolSeedResponseItem = {
	id: string
	created_at: string
	name: string
	description: string
	webhook_address: string
	required: string[] | null
	properties:
		| Array<{
				name: string
				type: string
				description?: string | null
		  }>
		| null
	additional_payload:
		| Array<{
				key: string
				type: string
				value: string
		  }>
		| null
	method: string
	api_key: string | null
	authorizationKey: string | null
}

const API_TOOLS_SEED_RESPONSE: ApiToolSeedResponseItem[] = [
	{
		id: '29829a3a-913e-4c27-ae76-bbfff8d154b9',
		created_at: '2025-10-23T11:51:45.42706+00:00',
		name: 'define_greeting',
		description:
			'jalankan tools ini saat awal percakapan untuk mendapatkan greeting message yang tepat .',
		webhook_address: 'https://workflows.crm.ai/webhook/define_greeting_sozo',
		required: ['first_message'],
		properties: [
			{
				name: 'first_message',
				type: 'string',
				description: 'message pertama yang dikirimkan customer',
			},
		],
		additional_payload: [],
		method: 'POST',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: '2106b5d6-04e7-49ec-87fa-98a0731c095f',
		created_at: '2025-08-27T13:50:17.706975+00:00',
		name: 'getPricePromo',
		description:
			'Jika user menanykan detail harga promo (hanya untuk user baru) atau user yg blm ada history chat',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbzZlB_IjqdDIY8TkGQhlXCbLbMpEkkn1djyASrXiNAFH6aFktYF7COyKUvJk_lel2lA/exec',
		required: [],
		properties: [],
		additional_payload: null,
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: 'cb2f1130-30fb-4756-abe3-707fa7d9d4b0',
		created_at: '2025-08-27T13:58:26.881974+00:00',
		name: 'getPricePromoMember',
		description: 'jika user existing menanyakan harga promo',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbwDeXDP6k7K6ZaVDVw7Aq6nmmcbPTslxIRGuK5L86dG-UuiYz-_Auc2Q5tnUvNXlJxR/exec',
		required: [],
		properties: [],
		additional_payload: null,
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: '56ee7a9d-c996-445e-9deb-4504b006c109',
		created_at: '2025-08-27T14:05:43.392283+00:00',
		name: 'getTreatmentsByClinic',
		description:
			'Jika user ingin mengecek ketersediaan treatment disuatu clinic',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbzVRBE0Q6Ra2lhKn_X9JCxbhPsygnN4nJ1riRry1VitEYOPFHkma0ZvPHh1UZpfoLtx/exec',
		required: ['clinic'],
		properties: [
			{
				name: 'clinic',
				type: 'string',
				description:
					'Tanjung Barat\nArteri\nBekasi\nBenhil\nBintaro\nBogor\nBSD\nCibinong\nCibubur\nCinere\nGading Serpong\nGreenlake\nJGC\nKarawaci  1\nKarawaci 2\nKelapa Gading 1\nKelapa Gading 2\nRawamangun\nKemang\nDepok\nPIK\nPondok Bambu\nPuri Indah\nSummarecon Bekasi\nTangcity\nTanjung Duren 1\nTebet\nTanjung Duren 2\nMampang\nMangga Besar\nBali\nBanjarmasin \nBuah Batu Bandung\nPaskal Bandung\nBatam\nSMB Bekasi\nCikarang\nCirebon\nDiponegoro Jogjakarta\nMakassar\nMalang\nMedan\nPekanbaru\nSamarinda\nSemarang\nSolo\nSurabaya Darmo\nSurabaya Manyar\nBalikpapan\nPontianak\nPalembang\nLampung',
			},
		],
		additional_payload: null,
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: '7e7aaeea-5cec-45eb-8f60-e287fc5d2245',
		created_at: '2025-10-29T08:47:24.159444+00:00',
		name: 'get_ads_response_blast',
		description: 'jalankan tools ini jika customer mengirimkan pesan "Claim Promo"',
		webhook_address:
			'https://workflows.crm.ai/webhook/dea5846d-c99e-4915-8f32-2f7012216496',
		required: ['bc_message'],
		properties: [
			{
				name: 'bc_message',
				type: 'string',
				description:
					'kirimkan pesan terakhir yang di broadcast oleh nomor 6285117656931',
			},
		],
		additional_payload: null,
		method: 'POST',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: '2eb23890-4a93-4822-863f-4cdd33b2ec78',
		created_at: '2025-11-09T05:03:14.365638+00:00',
		name: 'getPriceNonPromoAfterSales',
		description: 'jika user ingin cek harga treatment (diluar promo)',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbwdxlnOd5VK6tZ-npu74UUbXEPddVwQsRiieFS7PeQ339MeghlYGbuZ7168-I6bojuQEQ/exec',
		required: [],
		properties: [],
		additional_payload: [
			{
				key: 'sheet',
				type: 'text',
				value: 'Sheet8',
			},
		],
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: '98c55825-944f-4095-97f6-aa1295b0df38',
		created_at: '2025-11-10T08:51:38.073963+00:00',
		name: 'getVoucherAfterSales',
		description:
			'jika ingin claim voucher maka wajib hit api ini untuk mendapatkan detail voucher',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbwdxlnOd5VK6tZ-npu74UUbXEPddVwQsRiieFS7PeQ339MeghlYGbuZ7168-I6bojuQEQ/exec',
		required: ['sheet'],
		properties: [
			{
				name: 'sheet',
				type: 'string',
				description: 'ambil semua voucher (Voucher + Special Voucher Bulanan)',
			},
		],
		additional_payload: null,
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: 'e764a0e2-167f-46ff-bc08-9e12621a04c6',
		created_at: '2025-09-30T13:12:50.075986+00:00',
		name: 'getPromoLainnya',
		description: 'Jika user menanyakan promo lainnya',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbwry5HBQhtGtpnS_bz8KYu8Sbvg3JaF30JCenL_p3uB1TXEfn4DnpMiOjuaglzwzJG65g/exec',
		required: [],
		properties: [],
		additional_payload: [],
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: 'e2075169-efb8-478c-a27f-e0ddb7340531',
		created_at: '2025-12-08T08:32:20.230911+00:00',
		name: 'get_location_branch',
		description:
			'Wajib dijalankan jika user menyebutkan nama jalan, daerah, kecamatan, atau kota untuk mendapatkan data alamat yang akurat.',
		webhook_address:
			'https://workflows.crm.ai/webhook/get-location-branch',
		required: ['location'],
		properties: [
			{
				name: 'location',
				type: 'string',
				description:
					'parameter location ini adalah lokasi yang ditanyakan customer',
			},
		],
		additional_payload: null,
		method: 'POST',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: 'ca72848d-c188-4c29-a7c0-0f46f6c176cf',
		created_at: '2025-11-10T18:01:00.203377+00:00',
		name: 'getSpesificPromo',
		description:
			'jika user ingin menanyakan spesific promo atau setelah mendapatkan blast promo tertentu dan tertarik ke satu/beberapa treatment atau user menanyakan harga treatment di promo tertentu',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbwbI4Z5A5IuDwxSGLyKm4jsr0RdQMgDRJb1Z8uVHj1WBqP9v8mEdkNzXV5hJIj_Cc4/exec',
		required: ['sheet'],
		properties: [
			{
				name: 'sheet',
				type: 'string',
				description: '',
			},
		],
		additional_payload: null,
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
	{
		id: 'ee480e31-bf83-4975-8acf-7c2bb59d6180',
		created_at: '2026-03-16T06:15:39.105775+00:00',
		name: 'getPromoSheet',
		description:
			'jika user ingin menanyakan spesific promo atau setelah mendapatkan blast promo tertentu dan tertarik ke satu/beberapa treatment atau user menanyakan harga treatment di promo tertentu',
		webhook_address:
			'https://script.google.com/macros/s/AKfycbw_bSw37Ak5evFwXuOxE6tBVy4dysisHsUpeRmVmPzAUfee-WioGOxQPVK6BJQn9pfK/exec',
		required: ['sheet'],
		properties: [
			{
				name: 'sheet',
				type: 'string',
				description: '',
			},
		],
		additional_payload: null,
		method: 'GET',
		api_key: null,
		authorizationKey: null,
	},
]

const DEFAULT_API_TOOLS: ApiTool[] = API_TOOLS_SEED_RESPONSE.map((tool) => ({
	id: tool.id,
	name: tool.name,
	webhookAddress: tool.webhook_address,
	description: tool.description,
	method: tool.method === 'GET' ? 'GET' : 'POST',
	apiKey: tool.api_key || '',
	authorizationKey: tool.authorizationKey || '',
	required: Array.isArray(tool.required) ? tool.required : [],
	properties: (tool.properties || [])
		.map((property) => ({
			name: String(property.name || '').trim(),
			type: String(property.type || 'string').trim() || 'string',
			description: String(property.description || '').trim(),
		}))
		.filter((property) => property.name.length > 0),
	additionalPayload: (tool.additional_payload || [])
		.map((item) => ({
			key: String(item.key || '').trim(),
			type:
				item.type === 'number' || item.type === 'boolean' ? item.type : 'text',
			value: String(item.value || ''),
		}))
		.filter((item) => item.key.length > 0),
	status: 'active',
	createdAt: tool.created_at,
	updatedAt: tool.created_at,
	testId: buildToolTestId(tool.name, tool.id),
}))

function cloneDefaultApiTools(): ApiTool[] {
	return DEFAULT_API_TOOLS.map((tool) => ({ ...tool }))
}

function isApiToolStatus(value: unknown): value is ApiToolStatus {
	return value === 'active' || value === 'draft'
}

function isApiToolMethod(value: unknown): value is ApiToolMethod {
	return value === 'GET' || value === 'POST'
}

function sanitizeProperty(value: unknown): ApiToolProperty | null {
	if (!value || typeof value !== 'object') {
		return null
	}

	const candidate = value as Partial<ApiToolProperty>
	if (
		typeof candidate.name !== 'string' ||
		typeof candidate.type !== 'string' ||
		typeof candidate.description !== 'string'
	) {
		return null
	}

	return {
		name: candidate.name.trim(),
		type: candidate.type.trim() || 'string',
		description: candidate.description.trim(),
	}
}

function sanitizeAdditionalPayloadItem(
	value: unknown,
): ApiToolAdditionalPayloadItem | null {
	if (!value || typeof value !== 'object') {
		return null
	}

	const candidate = value as Partial<ApiToolAdditionalPayloadItem>
	if (
		typeof candidate.key !== 'string' ||
		typeof candidate.type !== 'string' ||
		typeof candidate.value !== 'string'
	) {
		return null
	}

	const normalizedType = candidate.type.toLowerCase()
	if (
		normalizedType !== 'text' &&
		normalizedType !== 'number' &&
		normalizedType !== 'boolean'
	) {
		return null
	}

	return {
		key: candidate.key.trim(),
		type: normalizedType as ApiToolAdditionalPayloadItem['type'],
		value: candidate.value,
	}
}

function buildToolTestId(name: string, fallbackId: string): string {
	const normalized = name
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 40)

	if (!normalized) {
		return `api-tools-card-${fallbackId}`
	}

	return `api-tools-card-${normalized}`
}

function generateToolId(): string {
	return randomId()
}

function sanitizeToolRecord(value: unknown): ApiTool | null {
	if (!value || typeof value !== 'object') {
		return null
	}

	const candidate = value as Partial<ApiTool>
	if (
		typeof candidate.id !== 'string' ||
		typeof candidate.name !== 'string' ||
		typeof candidate.webhookAddress !== 'string' ||
		typeof candidate.description !== 'string' ||
		typeof candidate.apiKey !== 'string' ||
		typeof candidate.authorizationKey !== 'string' ||
		typeof candidate.createdAt !== 'string' ||
		typeof candidate.updatedAt !== 'string' ||
		typeof candidate.testId !== 'string' ||
		!isApiToolMethod(candidate.method) ||
		!Array.isArray(candidate.required) ||
		!Array.isArray(candidate.properties) ||
		!Array.isArray(candidate.additionalPayload) ||
		!isApiToolStatus(candidate.status)
	) {
		return null
	}

	const sanitizedProperties = candidate.properties
		.map((item) => sanitizeProperty(item))
		.filter((item): item is ApiToolProperty => item !== null)

	const sanitizedAdditionalPayload = candidate.additionalPayload
		.map((item) => sanitizeAdditionalPayloadItem(item))
		.filter((item): item is ApiToolAdditionalPayloadItem => item !== null)

	return {
		id: candidate.id,
		name: candidate.name,
		webhookAddress: candidate.webhookAddress,
		description: candidate.description,
		method: candidate.method,
		apiKey: candidate.apiKey,
		authorizationKey: candidate.authorizationKey,
		required: candidate.required
			.map((item) => String(item || '').trim())
			.filter((item) => item.length > 0),
		properties: sanitizedProperties,
		additionalPayload: sanitizedAdditionalPayload,
		status: candidate.status,
		createdAt: candidate.createdAt,
		updatedAt: candidate.updatedAt,
		testId: candidate.testId,
	}
}

function sortToolsByUpdatedAt(tools: ApiTool[]): ApiTool[] {
	return [...tools].sort((a, b) => {
		const aDate = new Date(a.updatedAt).getTime()
		const bDate = new Date(b.updatedAt).getTime()
		return bDate - aDate
	})
}

function writeApiTools(tools: ApiTool[]): void {
	if (typeof localStorage === 'undefined') {
		return
	}

	localStorage.setItem(API_TOOLS_STORAGE_KEY, JSON.stringify(tools))
}

export function listApiTools(): ApiTool[] {
	if (typeof localStorage === 'undefined') {
		return sortToolsByUpdatedAt(cloneDefaultApiTools())
	}

	const raw = localStorage.getItem(API_TOOLS_STORAGE_KEY)
	if (!raw) {
		const defaults = sortToolsByUpdatedAt(cloneDefaultApiTools())
		writeApiTools(defaults)
		return defaults
	}

	try {
		const parsed = JSON.parse(raw)
		if (!Array.isArray(parsed)) {
			return sortToolsByUpdatedAt(cloneDefaultApiTools())
		}

		const sanitized = parsed
			.map((item) => sanitizeToolRecord(item))
			.filter((item): item is ApiTool => item !== null)

		// Explicitly stored empty arrays should remain empty.
		if (parsed.length === 0) {
			return []
		}

		if (sanitized.length === 0) {
			return sortToolsByUpdatedAt(cloneDefaultApiTools())
		}

		return sortToolsByUpdatedAt(sanitized)
	} catch {
		return sortToolsByUpdatedAt(cloneDefaultApiTools())
	}
}

export function createApiTool(payload: ApiToolPayload): ApiTool {
	const now = new Date().toISOString()
	const id = generateToolId()
	const name = payload.name.trim()
	const sanitizedProperties = payload.properties
		.map((item) => sanitizeProperty(item))
		.filter((item): item is ApiToolProperty => item !== null)
	const sanitizedRequired = payload.required
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
	const sanitizedAdditionalPayload = payload.additionalPayload
		.map((item) => sanitizeAdditionalPayloadItem(item))
		.filter((item): item is ApiToolAdditionalPayloadItem => item !== null)
	const tool: ApiTool = {
		id,
		name,
		webhookAddress: payload.webhookAddress.trim(),
		description: payload.description.trim(),
		method: payload.method,
		apiKey: payload.apiKey.trim(),
		authorizationKey: payload.authorizationKey.trim(),
		required: sanitizedRequired,
		properties: sanitizedProperties,
		additionalPayload: sanitizedAdditionalPayload,
		status: payload.status,
		createdAt: now,
		updatedAt: now,
		testId: buildToolTestId(name, id),
	}

	const next = sortToolsByUpdatedAt([tool, ...listApiTools()])
	writeApiTools(next)

	return tool
}

export function updateApiTool(
	id: string,
	payload: ApiToolPayload,
): ApiTool | null {
	const current = listApiTools()
	const existing = current.find((tool) => tool.id === id)
	if (!existing) {
		return null
	}

	const updatedTool: ApiTool = {
		...existing,
		name: payload.name.trim(),
		webhookAddress: payload.webhookAddress.trim(),
		description: payload.description.trim(),
		method: payload.method,
		apiKey: payload.apiKey.trim(),
		authorizationKey: payload.authorizationKey.trim(),
		required: payload.required
			.map((item) => item.trim())
			.filter((item) => item.length > 0),
		properties: payload.properties
			.map((item) => sanitizeProperty(item))
			.filter((item): item is ApiToolProperty => item !== null),
		additionalPayload: payload.additionalPayload
			.map((item) => sanitizeAdditionalPayloadItem(item))
			.filter((item): item is ApiToolAdditionalPayloadItem => item !== null),
		status: payload.status,
		updatedAt: new Date().toISOString(),
	}

	const next = sortToolsByUpdatedAt(
		current.map((tool) => (tool.id === id ? updatedTool : tool)),
	)
	writeApiTools(next)

	return updatedTool
}

export function deleteApiTool(id: string): boolean {
	const current = listApiTools()
	const next = current.filter((tool) => tool.id !== id)
	if (next.length === current.length) {
		return false
	}

	writeApiTools(next)
	return true
}

const apiToolsUpdatedFormatter = new Intl.DateTimeFormat('en-US', {
	month: 'short',
	day: 'numeric',
	year: 'numeric',
	hour: '2-digit',
	minute: '2-digit',
	hour12: false,
	timeZone: 'UTC',
})

export function formatApiToolUpdatedAt(value: string): string {
	const asDate = new Date(value)
	if (Number.isNaN(asDate.getTime())) {
		return 'Updated recently'
	}

	return `Updated ${apiToolsUpdatedFormatter.format(asDate)} UTC`
}

export type ApiToolsState = 'ready' | 'empty'

const apiToolsStateValues: ApiToolsState[] = ['ready', 'empty']

export function resolveApiToolsState(value?: string | null): ApiToolsState {
	if (!value) return 'ready'
	const normalized = value.toLowerCase()
	if (apiToolsStateValues.includes(normalized as ApiToolsState)) {
		return normalized as ApiToolsState
	}
	return 'ready'
}

export type MessagesState = 'ready' | 'loading' | 'empty' | 'error'

export type MessagesTableRow = {
	id: string
	message: string
	createdAt: string
	status: 'delivered' | 'read' | 'failed'
	error?: string
	inbox: string
	contact: string
	actionLabel: string
}

export type MessagesFixture = {
	heading: string
	description: string
	rows?: MessagesTableRow[]
	errorText?: string
}

export const messagesFixtures: Record<MessagesState, MessagesFixture> = {
	ready: {
		heading: 'Ready state',
		description:
			'Recent API sends with delivery outcomes and actionable status.',
		rows: [
			{
				id: 'row-1',
				message: 'Welcome series triggered',
				createdAt: '3m ago',
				status: 'delivered',
				inbox: 'Inbox A',
				contact: 'John Doe',
				actionLabel: 'View',
			},
			{
				id: 'row-2',
				message: 'Invoice reminder',
				createdAt: '12m ago',
				status: 'read',
				inbox: 'Inbox B',
				contact: 'Acme Co',
				actionLabel: 'View',
			},
			{
				id: 'row-3',
				message: 'Payment failed follow-up',
				createdAt: '19m ago',
				status: 'failed',
				error: 'Error: Recipient number rejected by downstream provider.',
				inbox: 'Inbox C',
				contact: 'Jules Harper',
				actionLabel: 'Retry',
			},
		],
	},
	loading: {
		heading: 'Loading messages',
		description: 'Fetching the most recent API sends.',
	},
	empty: {
		heading: 'No messages yet',
		description: 'Send a message to see it appear in this view.',
	},
	error: {
		heading: 'Error loading messages',
		description: 'Something went wrong while fetching the message history.',
		errorText:
			'We could not reach the messaging service. Please try again later.',
	},
}

const messageStateValues: MessagesState[] = [
	'ready',
	'loading',
	'empty',
	'error',
]

export function resolveMessagesState(value?: string | null): MessagesState {
	if (!value) return 'ready'
	const normalized = value.toLowerCase()
	if (messageStateValues.includes(normalized as MessagesState)) {
		return normalized as MessagesState
	}
	return 'ready'
}
