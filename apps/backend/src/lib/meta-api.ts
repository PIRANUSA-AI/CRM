type WhatsAppMessageType =
	| 'text'
	| 'template'
	| 'interactive'
	| 'image'
	| 'video'
	| 'audio'
	| 'document'

type WhatsAppMessageRequest = {
	phoneNumberId: string
	to: string
	apiKey: string
	type: WhatsAppMessageType
	content?: string
	components?: any[]
	templateLanguage?: string
	replyToWamid?: string
	interactive?: Record<string, unknown>
	media?: {
		link: string
		caption?: string
		filename?: string
	}
}

export async function sendWhatsAppMessage(request: WhatsAppMessageRequest) {
	const {
		phoneNumberId,
		to,
		apiKey,
		type,
		content = '',
		components,
		templateLanguage,
		replyToWamid,
		interactive,
		media,
	} = request
	const url = `https://graph.facebook.com/v23.0/${phoneNumberId}/messages`

	const body: any = {
		messaging_product: 'whatsapp',
		recipient_type: 'individual',
		to: to,
		type: type,
		...(replyToWamid ? { context: { message_id: replyToWamid } } : {}),
	}

	if (type === 'text') {
		body.text = { body: content }
	} else if (type === 'template') {
		const languageCode =
			typeof templateLanguage === 'string' && templateLanguage.trim().length > 0
				? templateLanguage
				: 'en_US'
		body.template = {
			name: content, // content is template name when type is template
			language: { code: languageCode },
			...(Array.isArray(components) && components.length > 0
				? { components }
				: {}),
		}
	} else if (type === 'interactive') {
		if (!interactive || typeof interactive !== 'object') {
			throw new Error('Interactive payload is required')
		}
		body.interactive = interactive
	} else if (
		type === 'image' ||
		type === 'video' ||
		type === 'audio' ||
		type === 'document'
	) {
		if (!media?.link || media.link.trim().length === 0) {
			throw new Error(`${type} link is required`)
		}
		body[type] = {
			link: media.link,
			...(media.caption ? { caption: media.caption } : {}),
			...(type === 'document' && media.filename
				? { filename: media.filename }
				: {}),
		}
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${apiKey}`,
		},
		body: JSON.stringify(body),
	})

	const data = (await response.json()) as any

	if (!response.ok) {
		throw new Error(data.error?.message || 'Failed to send WhatsApp message')
	}

	return data
}

export async function sendInstagramMessage(
	_pageId: string,
	recipientId: string,
	content: string,
	token: string,
	mediaType?: string,
	mediaUrl?: string,
) {
	// Instagram Messaging API uses graph.instagram.com/me/messages
	// with the Instagram user token (from Instagram Business Login).
	// Note: Instagram Send API does NOT support replying to specific messages.
	// Reply context is only tracked internally in the dashboard.
	const url = `https://graph.instagram.com/v23.0/me/messages`

	const isMedia = mediaUrl && mediaType && ['image', 'video', 'audio'].includes(mediaType)

	const body: Record<string, unknown> = {
		recipient: { id: recipientId },
		message: isMedia
			? { attachment: { type: mediaType, payload: { url: mediaUrl } } }
			: { text: content },
	}

	const response = await fetch(url, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			Authorization: `Bearer ${token}`,
		},
		body: JSON.stringify(body),
	})

	const data = (await response.json()) as any

	if (!response.ok) {
		throw new Error(data.error?.message || 'Failed to send Instagram message')
	}

	return data
}
