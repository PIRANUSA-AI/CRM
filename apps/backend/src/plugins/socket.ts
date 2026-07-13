import type { Elysia } from 'elysia'
import Redis from 'ioredis'
import { createAdapter } from '@socket.io/redis-adapter'
import { Server } from 'socket.io'
import { setRealtimeIO } from '../lib/realtime'
import { resolveAppId } from '../lib/utils'

async function resolveSocketAppRoomIds(
	rawAppId: unknown,
): Promise<string[]> {
	if (typeof rawAppId !== 'string') return []

	const normalized = rawAppId.trim()
	if (!normalized) return []

	const roomIds = new Set<string>([normalized])

	// Legacy app_id format (apps.app_id) -> internal app UUID
	const resolvedFromAppId = await resolveAppId(normalized).catch(() => null)
	if (resolvedFromAppId) {
		roomIds.add(resolvedFromAppId)
	}

	return Array.from(roomIds)
}

export const socketPlugin = (app: Elysia) => {
	const socketPort = Number(process.env.SOCKET_PORT || 3011)
	const socketPath = process.env.SOCKET_IO_PATH || '/socket.io'
	const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'
	const transportList = (process.env.SOCKET_IO_TRANSPORTS || 'websocket')
		.split(',')
		.map((value) => value.trim())
		.filter(Boolean)
	const transports = (transportList.length > 0
		? transportList
		: ['websocket']) as unknown as ('websocket' | 'polling')[]

	const envOrigins = [
		...(process.env.FRONTEND_URL || '')
			.split(',')
			.map((u) => u.trim())
			.filter(Boolean),
		...(process.env.SOCKET_IO_CORS_ORIGIN || '')
			.split(',')
			.map((u) => u.trim())
			.filter(Boolean),
	]

	const allowedOrigins = [
		'https://app.crm.chat',
		'https://crm.chat',
		'http://localhost:5173',
		'http://localhost:3000',
		'http://localhost:3005',
		'http://localhost:3006',
		...envOrigins,
	]

	const io = new Server({
		path: socketPath,
		cors: {
			origin: Array.from(new Set(allowedOrigins)),
			methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
			credentials: true,
		},
		transports,
	} as any)

	try {
		const pubClient = new Redis(redisUrl, {
			maxRetriesPerRequest: null,
		})
		const subClient = pubClient.duplicate()
		pubClient.on('error', (error) => {
			console.error('[socket.io] Redis pub client error:', error)
		})
		subClient.on('error', (error) => {
			console.error('[socket.io] Redis sub client error:', error)
		})
		io.adapter(createAdapter(pubClient, subClient))
		console.log('✅ Socket.IO Redis adapter enabled')
	} catch (error) {
		console.error('Failed to initialize Socket.IO Redis adapter:', error)
	}

	setRealtimeIO(io)

	// Standalone Socket.IO server on port 3011 to avoid Bun/Elysia conflicts
	try {
		io.listen(socketPort)
		console.log(`✅ Socket.IO listening on port ${socketPort} (${socketPath})`)
	} catch (e) {
		console.error(`Failed to start Socket.IO on ${socketPort}:`, e)
	}

	io.on('connection', (socket) => {
		console.log(`🔌 Client connected: ${socket.id}`)

		// Handle generic join (app level)
		socket.on('join', async (data) => {
			console.log(`👋 Client ${socket.id} joined app context`, data)
			const roomIds = await resolveSocketAppRoomIds(data?.appId)

			if (roomIds.length === 0 && data?.appId) {
				socket.join(`app:${String(data.appId)}`)
				return
			}

			for (const roomId of roomIds) {
				socket.join(`app:${roomId}`)
			}
		})

		socket.on('join:account', (accountId) => {
			socket.join(`account:${accountId}`)
			console.log(`👤 Client ${socket.id} joined account: ${accountId}`)
		})

		socket.on('join:conversation', (conversationId) => {
			socket.join(`conversation:${conversationId}`)
			console.log(
				`💬 Client ${socket.id} joined conversation: ${conversationId}`,
			)
		})

		socket.on('disconnect', () => {
			console.log(`🔌 Client disconnected: ${socket.id}`)
		})
	})

	return app.decorate('io', io)
}
