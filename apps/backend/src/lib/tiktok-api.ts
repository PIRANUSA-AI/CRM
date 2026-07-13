type TikTokMessageType = 'text' | 'image' | 'video' | 'audio' | 'document'

type TikTokSendMessageRequest = {
	accessToken: string
	recipientId: string
	content: string
	type?: TikTokMessageType
	mediaUrl?: string
	replyToMessageId?: string
}

type TikTokSendMessageResponse = {
	messageId: string | null
	raw: Record<string, unknown>
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function resolveTikTokSendUrl(): string {
	return (
		process.env.TIKTOK_MESSAGE_SEND_URL ||
		process.env.TIKTOK_SEND_MESSAGE_URL ||
		'https://open.tiktokapis.com/v2/business/message/send/'
	)
}

function buildTikTokPayload(request: TikTokSendMessageRequest): Record<string, unknown> {
	const type = request.type || 'text'
	const base: Record<string, unknown> = {
		recipient_id: request.recipientId,
		msg_type: type,
		...(request.replyToMessageId
			? { reply_to_message_id: request.replyToMessageId }
			: {}),
	}

	if (type === 'text') {
		return {
			...base,
			text: {
				text: request.content,
			},
		}
	}

	if (!request.mediaUrl || request.mediaUrl.trim().length === 0) {
		throw new Error(`TikTok ${type} message requires mediaUrl`)
	}

	const mediaPayload: Record<string, unknown> = {
		media_url: request.mediaUrl,
	}
	if (request.content.trim().length > 0) {
		mediaPayload.caption = request.content
	}

	return {
		...base,
		[type]: mediaPayload,
	}
}

export async function sendTikTokMessage(
	request: TikTokSendMessageRequest,
): Promise<TikTokSendMessageResponse> {
	const accessToken = String(request.accessToken || '').trim()
	if (!accessToken) {
		throw new Error('TikTok access token is missing')
	}

	const recipientId = String(request.recipientId || '').trim()
	if (!recipientId) {
		throw new Error('TikTok recipient id is missing')
	}

	const url = resolveTikTokSendUrl()
	const payload = buildTikTokPayload({
		...request,
		recipientId,
		accessToken,
		content: String(request.content || ''),
	})

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${accessToken}`,
		},
		body: JSON.stringify(payload),
	})

	const responseBody = (await response.json().catch(() => null)) as unknown
	const data = asRecord(responseBody)
	if (!response.ok) {
		const errorRecord = asRecord(data.error)
		const detail =
			String(errorRecord.message || errorRecord.description || '').trim() ||
			JSON.stringify(data)
		throw new Error(detail || 'Failed to send TikTok message')
	}

	const nestedData = asRecord(data.data)
	const messageId =
		typeof nestedData.message_id === 'string'
			? nestedData.message_id
			: typeof nestedData.id === 'string'
				? nestedData.id
				: typeof data.message_id === 'string'
					? data.message_id
					: null

	return {
		messageId,
		raw: data,
	}
}
