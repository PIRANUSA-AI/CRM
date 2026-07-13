import { Queue } from 'bullmq'
import { redis } from './redis'

// Define queues
export const incomingMessageQueue = new Queue('incoming-messages', {
	connection: redis,
})

export const outboundMessageQueue = new Queue('outbound-messages', {
	connection: redis,
})

export const aiProcessingQueue = new Queue('ai-processing', {
	connection: redis,
})

export const webhookQueue = new Queue('webhooks', {
	connection: redis,
})

export const maintenanceQueue = new Queue('maintenance', {
	connection: redis,
})

export const cronQueue = new Queue('cron-jobs', {
	connection: redis,
})

export const conversationBulkQueue = new Queue('conversation-bulk', {
	connection: redis,
})

// Helper to add jobs
export const addJob = async (queueName: string, data: any, opts = {}) => {
	const queues: Record<string, Queue> = {
		incoming: incomingMessageQueue,
		outbound: outboundMessageQueue,
		ai: aiProcessingQueue,
		webhook: webhookQueue,
		maintenance: maintenanceQueue,
		cron: cronQueue,
		conversationBulk: conversationBulkQueue,
	}

	const queue = queues[queueName]
	if (!queue) throw new Error(`Queue ${queueName} not found`)

	return queue.add(queueName, data, opts)
}
