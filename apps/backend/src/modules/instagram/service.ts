import prisma from '../../lib/prisma'

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

export abstract class InstagramService {
	static async getChannels(appId: string) {
		const inboxes = await prisma.inboxes.findMany({
			where: {
				channel_type: 'instagram',
				is_active: true,
				deleted_at: null,
				app_id: appId,
			},
			orderBy: { created_at: 'desc' },
		})

		return inboxes.map((inbox) => {
			const config: any = inbox.channel_config || {}
			return {
				id: inbox.id,
				name: inbox.name,
				channel_type: inbox.channel_type,
				is_active: inbox.is_active,
				created_at: inbox.created_at,
				updated_at: inbox.updated_at,
				instagram_id: config.instagram_id || null,
				username: config.username || null,
				profile_picture_url: config.profile_picture_url || null,
				token_expires_at: config.token_expires_at || null,
				fb_page_id: config.fb_page_id || null,
			}
		})
	}

	static async getChannelById(inboxId: string) {
		const inbox = await prisma.inboxes.findUnique({
			where: { id: inboxId },
		})

		if (!inbox) return null

		const config: any = inbox.channel_config || {}
		return {
			id: inbox.id,
			name: inbox.name,
			channel_type: inbox.channel_type,
			is_active: inbox.is_active,
			created_at: inbox.created_at,
			updated_at: inbox.updated_at,
			instagram_id: config.instagram_id || null,
			username: config.username || null,
			profile_picture_url: config.profile_picture_url || null,
			token_expires_at: config.token_expires_at || null,
			fb_page_id: config.fb_page_id || null,
		}
	}

	static async handleCallback(code: string, appId: string) {
		const igAppId = process.env.INSTAGRAM_APP_ID
		const igAppSecret = process.env.INSTAGRAM_APP_SECRET
		const fbAppId = process.env.FB_APP_ID
		const fbAppSecret = process.env.FB_APP_SECRET
		const redirectUri =
			process.env.IG_REDIRECT_URI ||
			'https://api.crm.chat/api/instagram-channels/callback'

		// Use Instagram app credentials for token exchange (Instagram native OAuth)
		// Fall back to FB credentials if Instagram-specific ones aren't set
		const clientId = igAppId || fbAppId
		const clientSecret = igAppSecret || fbAppSecret

		// 1. Exchange code for short-lived access token via Instagram API
		// Instagram native OAuth codes must be exchanged at api.instagram.com, not graph.facebook.com
		const tokenResponse = await fetch(
			'https://api.instagram.com/oauth/access_token',
			{
				method: 'POST',
				headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
				body: new URLSearchParams({
					client_id: clientId || '',
					client_secret: clientSecret || '',
					grant_type: 'authorization_code',
					redirect_uri: redirectUri,
					code: code,
				}).toString(),
			}
		)

		if (!tokenResponse.ok) {
			const error: any = await tokenResponse.json()
			console.error('[InstagramService] Token exchange failed:', JSON.stringify(error))
			throw new Error(`Instagram API error (token exchange): ${error?.error?.message || JSON.stringify(error)}`)
		}

		const tokenData: any = await tokenResponse.json()
		const shortLivedToken = tokenData.access_token

		console.log('[InstagramService] Short-lived token acquired, exchanging for long-lived...')

		// 2. Exchange short-lived token for long-lived access token (60 days)
		// Instagram Business Login uses graph.instagram.com for token exchange
		const longLivedTokenResponse = await fetch(
			`https://graph.instagram.com/access_token?grant_type=ig_exchange_token&client_secret=${clientSecret}&access_token=${shortLivedToken}`
		)

		let accessToken = shortLivedToken
		let expiresAt = new Date(Date.now() + 3600 * 1000) // 1 hour default for short-lived

		if (longLivedTokenResponse.ok) {
			const longLivedTokenData: any = await longLivedTokenResponse.json()
			if (longLivedTokenData.access_token) {
				accessToken = longLivedTokenData.access_token
				const expiresIn = longLivedTokenData.expires_in // seconds
				expiresAt = new Date(Date.now() + (expiresIn || 5184000) * 1000)
				console.log('[InstagramService] Long-lived token acquired, expires in', expiresIn, 'seconds')
			} else {
				console.warn('[InstagramService] Long-lived token response missing access_token:', JSON.stringify(longLivedTokenData))
			}
		} else {
			const errBody = await longLivedTokenResponse.text().catch(() => '')
			console.error('[InstagramService] Failed to get long-lived token:', longLivedTokenResponse.status, errBody)
		}

		// 3. Get the Instagram user profile using the token
		const meResponse = await fetch(
			`https://graph.instagram.com/v23.0/me?fields=user_id,username,profile_picture_url&access_token=${accessToken}`
		)

		if (!meResponse.ok) {
			const error: any = await meResponse.json()
			console.error('[InstagramService] Failed to get IG profile:', JSON.stringify(error))
			throw new Error(`Instagram API error (profile): ${error?.error?.message || JSON.stringify(error)}`)
		}

		const meData: any = await meResponse.json()
		const igUserId = meData.user_id || meData.id
		const igUsername = meData.username
		const igProfilePicture = meData.profile_picture_url

		console.log('[InstagramService] Instagram profile:', { igUserId, igUsername })

		// 4. Try to get linked Facebook Page for sending messages
		// Instagram Business accounts need a Page access token for the Send API
		let pageId: string | null = null
		let pageAccessToken: string | null = null

		try {
			// Try using FB credentials to get pages (if user authorized via enable_fb_login)
			const pagesResponse = await fetch(
				`https://graph.facebook.com/v23.0/me/accounts?access_token=${accessToken}&fields=name,access_token,instagram_business_account{id,username}`
			)

			if (pagesResponse.ok) {
				const pagesData: any = await pagesResponse.json()
				const pages = pagesData.data || []
				const igPage = pages.find((p: any) =>
					p.instagram_business_account?.id === igUserId ||
					p.instagram_business_account?.username === igUsername
				) || pages.find((p: any) => p.instagram_business_account)

				if (igPage) {
					pageId = igPage.id
					pageAccessToken = igPage.access_token
					console.log('[InstagramService] Found linked FB Page:', pageId)
				}
			}
		} catch (e) {
			console.warn('[InstagramService] Could not fetch FB pages (may not have FB login scope):', e)
		}

		// 5. Find existing or create new inbox
		const existingInbox = await prisma.inboxes.findFirst({
			where: {
				app_id: appId,
				channel_type: 'instagram',
				channel_config: {
					path: ['instagram_id'],
					equals: igUserId
				}
			}
		})

		const channelConfig = {
			instagram_id: igUserId,
			username: igUsername,
			profile_picture_url: igProfilePicture,
			access_token: accessToken,
			page_access_token: pageAccessToken || accessToken,
			token_expires_at: expiresAt.toISOString(),
			fb_page_id: pageId || igUserId,
		}

		let inbox
		if (existingInbox) {
			const mergedChannelConfig = {
				...asRecord(existingInbox.channel_config),
				...channelConfig,
			}
			inbox = await prisma.inboxes.update({
				where: { id: existingInbox.id },
				data: {
					name: `Instagram: @${igUsername}`,
					channel_config: mergedChannelConfig,
					is_active: true,
					deleted_at: null,
					updated_at: new Date()
				}
			})
		} else {
			inbox = await prisma.inboxes.create({
				data: {
					app_id: appId,
					channel_type: 'instagram',
					name: `Instagram: @${igUsername}`,
					channel_config: channelConfig
				}
			})
		}

		return {
			inboxId: inbox.id,
			username: igUsername,
			profilePicture: igProfilePicture
		}
	}

	static async getStatus(inboxId: string) {
		const inbox = await prisma.inboxes.findUnique({
			where: { id: inboxId },
		})

		if (!inbox) throw new Error('Inbox not found')

		const config: any = inbox.channel_config || {}

		return {
			connected: true,
			id: inbox.id,
			igId: config.instagram_id || 'unknown',
			username: config.username || 'unknown',
			profilePicUrl: config.profile_picture_url,
			connectionStatus: 'connected',
			connectedAt: inbox.created_at,
			tokenExpiresAt: config.token_expires_at,
			daysUntilTokenExpiry: config.token_expires_at 
				? Math.floor((new Date(config.token_expires_at).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
				: 0,
		}
	}

	static async deleteConnection(inboxId: string) {
		return prisma.inboxes.update({
			where: { id: inboxId },
			data: {
				deleted_at: new Date(),
				is_active: false
			},
		})
	}

	static async refreshTokens() {
		const expiryThreshold = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7 days from now

		const inboxesToRefresh = await prisma.inboxes.findMany({
			where: {
				channel_type: 'instagram',
				is_active: true,
				deleted_at: null,
				channel_config: {
					path: ['token_expires_at'],
					lt: expiryThreshold.toISOString()
				}
			}
		})

		console.log(`[InstagramService] Refreshing tokens for ${inboxesToRefresh.length} inboxes`)

		for (const inbox of inboxesToRefresh) {
			try {
				const config = inbox.channel_config as any

				// Use Instagram's long-lived token refresh endpoint
				const refreshResponse = await fetch(
					`https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${config.access_token}`
				)

				if (!refreshResponse.ok) {
					console.error(`[InstagramService] Failed to refresh token for inbox ${inbox.id}:`, await refreshResponse.text())
					continue
				}

				const refreshData: any = await refreshResponse.json()
				const newAccessToken = refreshData.access_token
				const expiresIn = refreshData.expires_in
				const expiresAt = new Date(Date.now() + (expiresIn || 5184000) * 1000)

				await prisma.inboxes.update({
					where: { id: inbox.id },
					data: {
						channel_config: {
							...config,
							access_token: newAccessToken,
							token_expires_at: expiresAt.toISOString()
						},
						updated_at: new Date()
					}
				})

				console.log(`[InstagramService] Refreshed token for inbox ${inbox.id}, expires at ${expiresAt.toISOString()}`)
			} catch (error) {
				console.error(`[InstagramService] Failed to refresh token for inbox ${inbox.id}:`, error)
			}
		}
	}
}
