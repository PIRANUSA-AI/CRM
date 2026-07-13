import { Elysia, t } from 'elysia'
import { InstagramService } from './service'
import { WebhookService } from '../webhook/service'
import { appContext } from '../../plugins'

const VERIFY_TOKEN = process.env.META_VERIFY_TOKEN || process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN || 'crm_webhook_secret'
const CALLBACK_HEADERS = {
	'content-type': 'text/html; charset=utf-8',
	'cache-control': 'no-store, no-cache, must-revalidate, private',
	pragma: 'no-cache',
	expires: '0',
}

const escapeForHtml = (value: string) =>
	value
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#39;')

const escapeForJs = (value: string) =>
	value
		.replace(/\\/g, '\\\\')
		.replace(/'/g, "\\'")
		.replace(/\r/g, '')
		.replace(/\n/g, '\\n')

const getOAuthErrorDetails = (message?: string) => {
	const normalizedMessage = (message || '').trim()

	if (/authorization code has been used/i.test(normalizedMessage)) {
		return {
			reason: 'authorization_code_used',
			message:
				'This Instagram login link was already used or expired. Please click Connect Instagram again and complete the login in the new popup.',
		}
	}

	return {
		reason: 'instagram_oauth_error',
		message:
			normalizedMessage ||
			'Instagram connection failed. Please try again from the Integrations page.',
	}
}

export const instagram = new Elysia({ tags: ['Instagram'] })
	.use(appContext)
	.get(
		'/',
		async ({ resolvedAppId, set }) => {
			if (!resolvedAppId) {
				set.status = 400
				return { error: 'App ID required' }
			}
			const channels = await InstagramService.getChannels(resolvedAppId)
			return { data: channels }
		},
		{
			query: t.Object({
				appId: t.Optional(t.String()),
				accountId: t.Optional(t.String()),
				search: t.Optional(t.String()),
			}),
		},
	)
	.post('/init-login', async ({ resolvedAppId, set }) => {
		if (!resolvedAppId) {
			set.status = 400
			return { error: 'App ID required' }
		}

		const clientId = process.env.INSTAGRAM_APP_ID || process.env.FB_APP_ID
		const redirectUri =
			process.env.IG_REDIRECT_URI ||
			'https://api.crm.chat/api/instagram-channels/callback'

		// Generate a secure state token
		const stateData = {
			timestamp: Date.now(),
			appId: resolvedAppId,
		}
		const state = Buffer.from(JSON.stringify(stateData)).toString('base64')

		// Instagram Business Login scopes (Instagram-native scopes only)
		const scopes = 'instagram_business_basic,instagram_business_manage_messages,instagram_business_manage_comments'

		// Construct Instagram native OAuth URL (not Facebook dialog)
		const params = new URLSearchParams({
			client_id: clientId || '',
			redirect_uri: redirectUri,
			response_type: 'code',
			scope: scopes,
			state: state,
			enable_fb_login: '1',
		})

		const loginUrl = `https://www.instagram.com/oauth/authorize?${params.toString()}`

		return {
			success: true,
			data: {
				loginUrl: loginUrl,
			},
		}
	})
	.get('/callback', async ({ query, set }) => {
		// Dual-purpose: Meta webhook verification OR OAuth callback
		const hubMode = query['hub.mode']
		const hubToken = query['hub.verify_token']
		const hubChallenge = query['hub.challenge']

		// --- Meta Webhook Verification ---
		if (hubMode === 'subscribe') {
			console.log('[Instagram] Webhook verification request:', {
				mode: hubMode,
				tokenMatch: hubToken === VERIFY_TOKEN,
				challenge: hubChallenge?.substring(0, 10) + '...',
			})

			if (hubToken === VERIFY_TOKEN) {
				console.log('[Instagram] Webhook verification successful')
				set.headers['content-type'] = 'text/plain'
				return hubChallenge
			}

			console.error('[Instagram] Webhook verification failed - token mismatch')
			set.status = 403
			return 'Forbidden'
		}

		// --- OAuth Callback ---
		const { code, state } = query as any

		if (!code || !state) {
			const reason = 'missing_code_or_state'
			const message =
				'Instagram did not return a valid authorization code. Please click Connect Instagram and try again.'

			return new Response(
				`<html><body><script>
					try { window.history.replaceState({}, document.title, window.location.pathname); } catch (error) {}
					if (window.opener) {
						window.opener.postMessage({ type: 'IG_ERROR', reason: '${reason}', message: '${escapeForJs(message)}' }, '*');
						setTimeout(() => window.close(), 500);
					}
				</script><h2>Connection failed</h2><p>${escapeForHtml(message)}</p></body></html>`,
				{ headers: CALLBACK_HEADERS },
			)
		}

		try {
			const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
			const appId = stateData.appId

			const result = await InstagramService.handleCallback(code, appId)

			return new Response(
				`<!DOCTYPE html>
				<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
				<title>Instagram Connected</title>
				<style>
					*{margin:0;padding:0;box-sizing:border-box}
					body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f9fafb;display:flex;align-items:center;justify-content:center;min-height:100vh}
					.card{background:#fff;border-radius:16px;border:1px solid #e5e7eb;padding:48px 40px;max-width:420px;width:100%;text-align:center;box-shadow:0 4px 24px rgba(0,0,0,.06)}
					.icon{width:72px;height:72px;border-radius:50%;background:linear-gradient(135deg,#833ab4,#fd1d1d,#fcb045);display:flex;align-items:center;justify-content:center;margin:0 auto 20px}
					.icon svg{width:36px;height:36px;fill:#fff}
					h1{font-size:22px;font-weight:700;color:#111827;margin-bottom:20px}
					.check{width:48px;height:48px;border-radius:50%;background:#ecfdf5;display:flex;align-items:center;justify-content:center;margin:0 auto 12px}
					.check svg{width:24px;height:24px;color:#059669}
					.username{font-size:16px;color:#374151;margin-bottom:6px}
					.closing{font-size:13px;color:#9ca3af}
				</style></head>
				<body><div class="card">
					<div class="icon"><svg viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg></div>
					<h1>Connection Successful!</h1>
					<div class="check"><svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"/></svg></div>
					<p class="username">Successfully connected @${result.username}!</p>
					<p class="closing">Closing window...</p>
				</div>
				<script>
					try { window.history.replaceState({}, document.title, window.location.pathname); } catch (error) {}
					if (window.opener) {
						window.opener.postMessage({ type: 'INSTAGRAM_CONNECTED', inboxId: '${result.inboxId}' }, '*');
						setTimeout(() => window.close(), 2000);
					} else {
						setTimeout(() => window.close(), 3000);
					}
				</script>
				</body></html>`,
				{ headers: CALLBACK_HEADERS },
			)
		} catch (error: any) {
			const { reason, message } = getOAuthErrorDetails(error?.message)
			return new Response(
				`<html><body>
				<h2>Connection failed</h2>
				<p>${escapeForHtml(message)}</p>
				<script>
					try { window.history.replaceState({}, document.title, window.location.pathname); } catch (error) {}
					if (window.opener) {
						window.opener.postMessage({ type: 'IG_ERROR', reason: '${escapeForJs(reason)}', message: '${escapeForJs(message)}' }, '*');
						setTimeout(() => window.close(), 2500);
					}
				</script>
				</body></html>`,
				{ headers: CALLBACK_HEADERS },
			)
		}
	}, {
		query: t.Object({
			code: t.Optional(t.String()),
			state: t.Optional(t.String()),
			'hub.mode': t.Optional(t.String()),
			'hub.verify_token': t.Optional(t.String()),
			'hub.challenge': t.Optional(t.String()),
		})
	})
	// Instagram Webhook Payload (POST) - receives DMs, comments, etc.
	.post('/callback', async ({ body }) => {
		console.log('[Instagram] Webhook payload received')
		return WebhookService.processInstagramPayload(body)
	})
	.get(
		'/:id/status',
		async ({ params }) => {
			const status = await InstagramService.getStatus(params.id)
			return { data: status }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)
	.delete(
		'/:id',
		async ({ params }) => {
			await InstagramService.deleteConnection(params.id)
			return { success: true }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)
