import Redis from 'ioredis'
import { Emitter } from '@socket.io/redis-emitter'

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

let emitter: Emitter | null = null

function getEmitter(): Emitter {
	if (emitter) return emitter

	const client = new Redis(redisUrl, {
		maxRetriesPerRequest: null,
	})

	client.on('error', (error) => {
		console.error('[realtime-emitter] Redis error:', error)
	})

	emitter = new Emitter(client)
	return emitter
}

export function emitRealtimeToRoom(
	room: string,
	event: string,
	payload: unknown,
): boolean {
	try {
		getEmitter().to(room).emit(event, payload)
		return true
	} catch (error) {
		console.error('[realtime-emitter] Failed to emit event', {
			room,
			event,
			error,
		})
		return false
	}
}
