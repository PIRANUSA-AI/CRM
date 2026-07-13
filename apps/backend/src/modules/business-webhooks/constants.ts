export const BUSINESS_WEBHOOK_EVENTS = [
	'message.received',
	'message.sent',
	'conversation.created',
	'conversation.stage_status_updated',
	'conversation.pipeline_status_updated',
	'conversation.handled_by_updated',
	'conversation.labels_updated',
	'contact.updated',
	'ai_summary.generated',
	'conversation_note.created',
	'conversation_note.updated',
	'order.add_to_cart',
	'order.checkout',
	'order.payment_link_sent',
	'order.paid',
	'order.cancelled',
] as const

export type BusinessWebhookEvent = (typeof BUSINESS_WEBHOOK_EVENTS)[number]
