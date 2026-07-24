import { Queue } from 'bullmq'
import { redis } from './redis'

// Safety-net defaults so a call site that forgets job options doesn't retry
// forever or leave job records in Redis forever. Call sites can still
// override any of these per-job.
const defaultJobOptions = {
	attempts: 3,
	backoff: { type: 'exponential', delay: 2_000 },
	removeOnComplete: { age: 3_600, count: 1_000 },
	removeOnFail: { age: 86_400 },
}

// Define queues
export const incomingMessageQueue = new Queue('incoming-messages', {
	connection: redis,
	defaultJobOptions,
})

export const outboundMessageQueue = new Queue('outbound-messages', {
	connection: redis,
	defaultJobOptions,
})

export const aiProcessingQueue = new Queue('ai-processing', {
	connection: redis,
	defaultJobOptions,
})

export const webhookQueue = new Queue('webhooks', {
	connection: redis,
	defaultJobOptions,
})

export const maintenanceQueue = new Queue('maintenance', {
	connection: redis,
	defaultJobOptions,
})

export const cronQueue = new Queue('cron-jobs', {
	connection: redis,
	defaultJobOptions,
})

export const conversationBulkQueue = new Queue('conversation-bulk', {
	connection: redis,
	defaultJobOptions,
})

export const whatsappProfileSyncQueue = new Queue('whatsapp-profile-sync', {
	connection: redis,
	defaultJobOptions,
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
		whatsappProfileSync: whatsappProfileSyncQueue,
	}

	const queue = queues[queueName]
	if (!queue) throw new Error(`Queue ${queueName} not found`)

	return queue.add(queueName, data, opts)
}
