import crypto from 'crypto'
import prisma from '../../lib/prisma'
import {
	buildMessageWebhookPayloadFallback,
	formatMessageWebhookPayload,
	isMessageWebhookEvent,
} from './message-event-formatter'

type DispatchData = {
	event: string
	appId: string | null | undefined
	inboxId?: string | null
	payload?: Record<string, unknown>
}

type DeliveryTarget = {
	id: string
	url: string
	inboxId: string | null
	secret: string | null
	headers: Record<string, string>
	subscriptions: string[]
}

type DispatchPayload = {
	id: string
	event: string
	timestamp: string
	app_id: string
	inbox_id: string | null
	payload: Record<string, unknown>
}

type WrappedDispatchPayload = {
	webhookUrl: string
	events: string
	payload: Record<string, unknown>
}

const WEBHOOK_TIMEOUT_MS = Math.max(
	1_000,
	Number(process.env.BUSINESS_WEBHOOK_TIMEOUT_MS || 10_000),
)

type PostAttemptResult =
	| { ok: true }
	| {
			ok: false
			status: number
			responseText: string
			error: string
	  }

function getAlternativeWebhookUrl(rawUrl: string): string | null {
	try {
		const parsed = new URL(rawUrl)
		const pathname = parsed.pathname

		if (pathname === '/webhook') {
			parsed.pathname = '/webhook-test'
			return parsed.toString()
		}
		if (pathname === '/webhook-test') {
			parsed.pathname = '/webhook'
			return parsed.toString()
		}
		if (pathname.includes('/webhook-test/')) {
			parsed.pathname = pathname.replace('/webhook-test/', '/webhook/')
			return parsed.toString()
		}
		if (pathname.includes('/webhook/')) {
			parsed.pathname = pathname.replace('/webhook/', '/webhook-test/')
			return parsed.toString()
		}

		return null
	} catch {
		return null
	}
}

function shouldRetryWithAlternative(result: PostAttemptResult) {
	if (result.ok) return false
	if (result.status !== 404) return false
	return (
		result.responseText.length === 0 ||
		/not registered|unknown webhook/i.test(result.responseText)
	)
}

async function postWebhookAttempt(args: {
	url: string
	headers: Record<string, string>
	rawBody: string
}): Promise<PostAttemptResult> {
	const controller = new AbortController()
	const timeoutHandle = setTimeout(() => controller.abort(), WEBHOOK_TIMEOUT_MS)

	try {
		const response = await fetch(args.url, {
			method: 'POST',
			headers: args.headers,
			body: args.rawBody,
			signal: controller.signal,
		})

		if (response.ok) {
			return { ok: true as const }
		}

		const responseText = await response.text().catch(() => '')
		return {
			ok: false as const,
			status: response.status,
			responseText,
			error: `HTTP ${response.status}${responseText ? `: ${responseText.slice(0, 200)}` : ''}`,
		}
	} finally {
		clearTimeout(timeoutHandle)
	}
}

function toStringMap(value: unknown): Record<string, string> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		return {}
	}

	const parsed = value as Record<string, unknown>
	const normalized: Record<string, string> = {}
	for (const [key, rawValue] of Object.entries(parsed)) {
		const headerName = String(key || '').trim()
		if (!headerName) continue
		if (rawValue === undefined || rawValue === null) continue
		normalized[headerName] = String(rawValue)
	}
	return normalized
}

function normalizeSubscriptions(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => String(item || '').trim())
		.filter((item) => item.length > 0)
}

function shouldDeliverToInbox(targetInboxId: string | null, inboxId?: string | null) {
	if (!targetInboxId) return true
	if (!inboxId) return false
	return targetInboxId === inboxId
}

async function postWebhook(
	target: DeliveryTarget,
	rawBody: string,
	eventName: string,
	deliveryId: string,
) {
	const headers: Record<string, string> = {
		'content-type': 'application/json',
		'user-agent': 'CRM-Webhooks/1.0',
		'x-crm-event': eventName,
		'x-crm-delivery-id': deliveryId,
		...target.headers,
	}

	if (target.secret) {
		const signature = crypto
			.createHmac('sha256', target.secret)
			.update(rawBody)
			.digest('hex')
		headers['x-crm-signature-256'] = `sha256=${signature}`
	}

	const primary = await postWebhookAttempt({
		url: target.url,
		headers,
		rawBody,
	})
	if (primary.ok) return { ok: true as const }

	const fallbackUrl = getAlternativeWebhookUrl(target.url)
	if (fallbackUrl && shouldRetryWithAlternative(primary)) {
		const fallback = await postWebhookAttempt({
			url: fallbackUrl,
			headers,
			rawBody,
		})
		if (fallback.ok) {
			console.warn(
				`[BusinessWebhookDispatchService] Delivered via fallback endpoint for "${eventName}" (${target.url} -> ${fallbackUrl}).`,
			)
			return { ok: true as const }
		}
		return {
			ok: false as const,
			error: `${primary.error}; fallback ${fallback.error}`,
		}
	}

	return { ok: false as const, error: primary.error }
}

export abstract class BusinessWebhookDispatchService {
	private static async getTargets(args: {
		appId: string
		eventName: string
		inboxId?: string | null
	}): Promise<DeliveryTarget[]> {
		const rows = await prisma.webhooks.findMany({
			where: {
				OR: [
					{ app_id: args.appId },
					{
						AND: [{ app_id: null }, { account_id: args.appId }],
					},
				],
				is_active: true,
			},
			select: {
				id: true,
				url: true,
				subscriptions: true,
				inbox_id: true,
				secret: true,
				headers: true,
				is_hidden: true,
			},
			orderBy: {
				created_at: 'desc',
			},
		})

		const targets = rows
			.map((row) => {
				const subscriptions = normalizeSubscriptions(row.subscriptions)
				if (!subscriptions.includes(args.eventName)) return null

				const webhookUrl = String(row.url || '').trim()
				if (!webhookUrl) return null

				const targetInboxId = row.inbox_id ? String(row.inbox_id) : null
				if (!shouldDeliverToInbox(targetInboxId, args.inboxId)) return null
				if (row.is_hidden === true) return null

				return {
					id: row.id,
					url: webhookUrl,
					inboxId: targetInboxId,
					secret:
						typeof row.secret === 'string' && row.secret.trim().length > 0
							? row.secret.trim()
							: null,
					headers: toStringMap(row.headers),
					subscriptions,
				} satisfies DeliveryTarget
			})
			.filter((item): item is DeliveryTarget => Boolean(item))

		const deduplicated = new Map<string, DeliveryTarget>()
		for (const target of targets) {
			const key = `${target.url}::${target.inboxId || ''}`
			if (!deduplicated.has(key)) {
				deduplicated.set(key, target)
			}
		}

		return [...deduplicated.values()]
	}

	static async dispatch(args: DispatchData) {
		const appId = String(args.appId || '').trim()
		if (!appId) return

		const eventName = String(args.event || '').trim()
		if (!eventName) return

		const inboxId = args.inboxId ? String(args.inboxId).trim() : null
		const payload = args.payload || {}

		try {
			const targets = await BusinessWebhookDispatchService.getTargets({
				appId,
				eventName,
				inboxId,
			})
			if (targets.length === 0) return

			const deliveryId = crypto.randomUUID()
			const dispatchedAt = new Date()
			let payloadBody: Record<string, unknown>
			if (isMessageWebhookEvent(eventName)) {
				try {
					payloadBody = await formatMessageWebhookPayload({
						deliveryId,
						eventName,
						appId,
						inboxId,
						payload,
						dispatchedAt,
					})
				} catch (formatError) {
					console.error(
						`[BusinessWebhookDispatchService] Failed to enrich "${eventName}" payload. Sending fallback structure.`,
						formatError,
					)
					payloadBody = buildMessageWebhookPayloadFallback({
						deliveryId,
						eventName,
						appId,
						inboxId,
						payload,
						dispatchedAt,
					})
				}
			} else {
				payloadBody = {
					id: deliveryId,
					event: eventName,
					timestamp: dispatchedAt.toISOString(),
					app_id: appId,
					inbox_id: inboxId,
					payload,
				} satisfies DispatchPayload
			}
			const results = await Promise.allSettled(
				targets.map(async (target) => {
					const wrappedPayload: WrappedDispatchPayload = {
						webhookUrl: target.url,
						events: eventName,
						payload: payloadBody,
					}
					const rawBody = JSON.stringify(wrappedPayload)
					const result = await postWebhook(
						target,
						rawBody,
						eventName,
						deliveryId,
					)
					if (!result.ok) {
						throw new Error(result.error)
					}
					return true
				}),
			)

			const failed = results.filter(
				(result) => result.status === 'rejected',
			).length
			if (failed > 0) {
				console.error(
					`[BusinessWebhookDispatchService] ${failed}/${targets.length} deliveries failed for event "${eventName}"`,
				)
			}
		} catch (error) {
			console.error(
				`[BusinessWebhookDispatchService] Failed dispatch for event "${eventName}":`,
				error,
			)
		}
	}
}
