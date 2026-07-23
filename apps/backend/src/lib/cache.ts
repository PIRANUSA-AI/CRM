import { createHash } from 'node:crypto'
import { redis } from './redis'

export function hashCacheKey(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

// Cache-aside helper. Only successful (non-null/undefined) resolutions are
// cached, so a fixed credential/app doesn't stay "not found" for the TTL
// window. Invalidation is TTL-only - app/org data changes rarely enough that
// a short TTL (seconds, not minutes) is an acceptable staleness window.
export async function cached<T>(
	key: string,
	ttlSeconds: number,
	fn: () => Promise<T>,
): Promise<T> {
	const raw = await redis.get(key)
	if (raw !== null) {
		return JSON.parse(raw) as T
	}

	const value = await fn()
	if (value !== null && value !== undefined) {
		await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds)
	}
	return value
}
