import { createHash } from 'node:crypto'
import { redis } from './redis'

export function hashCacheKey(value: string): string {
	return createHash('sha256').update(value).digest('hex')
}

// Redis shares one long-lived ioredis connection with BullMQ, which sets
// maxRetriesPerRequest: null so its jobs retry forever instead of erroring -
// but that also means a command can hang indefinitely if the connection is
// ever stuck reconnecting. A cache lookup must never be able to block a
// request that long, so every op here is raced against a short timeout and
// degrades to "cache miss" / "skip the write" rather than hanging the caller.
const CACHE_OP_TIMEOUT_MS = 300

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const timer = setTimeout(() => reject(new Error('cache op timed out')), ms)
		promise.then(
			(value) => {
				clearTimeout(timer)
				resolve(value)
			},
			(error) => {
				clearTimeout(timer)
				reject(error)
			},
		)
	})
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
	const raw = await withTimeout(redis.get(key), CACHE_OP_TIMEOUT_MS).catch(() => null)
	if (raw !== null) {
		try {
			return JSON.parse(raw) as T
		} catch {
			// corrupt cache entry - fall through to a fresh lookup
		}
	}

	const value = await fn()
	if (value !== null && value !== undefined) {
		void withTimeout(
			redis.set(key, JSON.stringify(value), 'EX', ttlSeconds),
			CACHE_OP_TIMEOUT_MS,
		).catch(() => {})
	}
	return value
}
