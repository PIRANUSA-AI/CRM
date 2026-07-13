/**
 * Socket.io Client
 *
 * Connects to backend Socket.io server for realtime updates
 */

import { io, type Socket } from 'socket.io-client'

const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || 'http://localhost:3011'
const SOCKET_PATH = import.meta.env.VITE_SOCKET_PATH || '/socket.io'
const SOCKET_TRANSPORTS = parseSocketTransports(
	import.meta.env.VITE_SOCKET_TRANSPORTS,
)

let socket: Socket | null = null

function parseSocketTransports(
	rawValue: string | undefined,
): ('websocket' | 'polling')[] {
	const parsed = (rawValue || '')
		.split(',')
		.map((value) => value.trim().toLowerCase())
		.filter(Boolean)
	if (parsed.includes('polling')) {
		console.warn(
			'[Socket.io] polling transport requested but local backend uses websocket-only; forcing websocket.',
		)
	}
	return ['websocket']
}

export function connectSocket(): Socket {
	const token = localStorage.getItem('scalechat_token')
	const appId = localStorage.getItem('scalechat_app_id')
	console.log('[Socket.io] Initializing', {
		url: SOCKET_URL,
		path: SOCKET_PATH,
		transports: SOCKET_TRANSPORTS,
		hasToken: Boolean(token),
		hasAppId: Boolean(appId),
	})

	if (socket) {
		socket.auth = { token, appId }
		if (!socket.connected) socket.connect()
		return socket
	}

	socket = io(SOCKET_URL, {
		autoConnect: true,
		reconnection: true,
		reconnectionDelay: 1000,
		reconnectionAttempts: 5,
		path: SOCKET_PATH,
		transports: SOCKET_TRANSPORTS,
		auth: {
			token,
			appId,
		},
	})

	socket.on('connect', () => {
		console.log('[Socket.io] Connected:', socket?.id)
	})

	socket.on('disconnect', () => {
		console.log('[Socket.io] Disconnected')
	})

	socket.on('connect_error', (error) => {
		console.error('[Socket.io] Connection error:', error)
	})

	return socket
}

export function disconnectSocket() {
	if (socket) {
		socket.disconnect()
		socket = null
	}
}

export function getSocket(): Socket | null {
	return socket
}

// Event listeners
export function onConversationCreated(callback: (conversation: any) => void) {
	socket?.on('conversation:created', callback)
}

export function onMessageCreated(
	callback: (data: { message: any; conversation: any }) => void,
) {
	socket?.on('message:created', callback)
}

export function onConversationStatusChanged(
	callback: (conversation: any) => void,
) {
	socket?.on('conversation:status_changed', callback)
}

export function onConversationUpdated(callback: (conversation: any) => void) {
	socket?.on('conversation:updated', callback)
}

export function onAISuggestion(
	callback: (data: {
		conversationId: string
		messageId: string
		suggestion: string
		analysis: any
	}) => void,
) {
	socket?.on('ai:suggestion', callback)
}

export function onAgentPresence(
	callback: (data: { userId: string; status: 'online' | 'offline' }) => void,
) {
	socket?.on('agent:presence', callback)
}

// Room management
export function joinConversation(conversationId: string) {
	socket?.emit('join:conversation', conversationId)
}

export function leaveConversation(conversationId: string) {
	socket?.emit('leave:conversation', conversationId)
}

// Cleanup
export function removeAllListeners() {
	socket?.removeAllListeners('conversation:created')
	socket?.removeAllListeners('message:created')
	socket?.removeAllListeners('conversation:status_changed')
	socket?.removeAllListeners('conversation:updated')
	socket?.removeAllListeners('ai:suggestion')
	socket?.removeAllListeners('agent:presence')
}
