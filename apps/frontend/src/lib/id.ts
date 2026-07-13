/**
 * crypto.randomUUID() is only available in secure contexts (HTTPS or
 * localhost). Public-IP HTTP installs (no TLS/domain configured) run in an
 * insecure context, where the call is either missing or throws. Always
 * generate ids through this helper instead of calling crypto.randomUUID()
 * directly so the app keeps working on plain http://<ip>:<port> installs.
 */
export function randomId(): string {
	if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
		try {
			return crypto.randomUUID()
		} catch {
			// fall through to the non-crypto fallback below
		}
	}
	return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}
