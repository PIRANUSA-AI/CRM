import type { Server } from 'socket.io'
import { emitRealtimeToRoom } from './realtime-emitter'

const REALTIME_IO_KEY = '__CRM_IO__'
const APP_MODE = (process.env.APP_MODE || 'api').toLowerCase()

type RealtimeFallback = {
	to: (room: string) => {
		emit: (event: string, payload: unknown) => void
	}
}

let fallbackRealtime: RealtimeFallback | null = null

export function setRealtimeIO(io: Server) {
	;(globalThis as any)[REALTIME_IO_KEY] = io
}

export function getRealtimeIO(): Server | null {
	const io = (globalThis as any)[REALTIME_IO_KEY] as Server | undefined
	if (io) return io

	if (APP_MODE !== 'api') {
		if (!fallbackRealtime) {
			fallbackRealtime = {
				to: (room: string) => ({
					emit: (event: string, payload: unknown) => {
						emitRealtimeToRoom(room, event, payload)
					},
				}),
			}
		}

		return fallbackRealtime as unknown as Server
	}

	return null
}
