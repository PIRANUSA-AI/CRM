declare global {
	interface Window {
		FB: facebook.FacebookStatic
		fbAsyncInit: () => void
	}
}

declare namespace facebook {
	interface FacebookStatic {
		init(params: InitParams): void
		login(
			callback: (response: LoginResponse) => void,
			params?: LoginParams,
		): void
		logout(callback: (response: any) => void): void
		getLoginStatus(callback: (response: LoginResponse) => void): void
		api(path: string, params: object, callback: (response: any) => void): void
		AppEvents: {
			logPageView(): void
		}
	}

	interface InitParams {
		appId: string
		cookie?: boolean
		xfbml?: boolean
		version: string
	}

	interface LoginParams {
		scope?: string
		auth_type?: string
	}

	interface AuthResponse {
		accessToken: string
		expiresIn: number
		reauthorize_required_in?: number
		signedRequest: string
		userID: string
	}

	interface LoginResponse {
		authResponse: AuthResponse | null
		status: 'connected' | 'not_authorized' | 'unknown'
	}
}

export interface FacebookUser {
	id: string
	name: string
	email?: string
	picture?: {
		data: {
			height: number
			is_silhouette: boolean
			url: string
			width: number
		}
	}
}

export interface FacebookPage {
	id: string
	name: string
	access_token: string
	picture?: {
		data: {
			url: string
		}
	}
	category?: string
	tasks?: string[]
}

export type FacebookLoginResponse = facebook.LoginResponse

const FB_PERMISSIONS = [
	'public_profile',
	'email',
	'pages_show_list',
	'pages_manage_metadata',
	'pages_read_engagement',
	'pages_messaging',
	'business_management',
].join(',')

export function waitForFB(): Promise<facebook.FacebookStatic> {
	return new Promise((resolve) => {
		if (window.FB) {
			resolve(window.FB)
			return
		}
		const interval = setInterval(() => {
			if (window.FB) {
				clearInterval(interval)
				resolve(window.FB)
			}
		}, 100)
	})
}

export async function loginWithFacebook(): Promise<FacebookLoginResponse> {
	const FB = await waitForFB()
	return new Promise((resolve, reject) => {
		FB.login(
			(response) => {
				if (response.authResponse) {
					resolve(response)
				} else {
					reject(new Error('User cancelled login or did not fully authorize'))
				}
			},
			{ scope: FB_PERMISSIONS },
		)
	})
}

export async function getFacebookUserInfo(): Promise<FacebookUser> {
	const FB = await waitForFB()
	return new Promise((resolve, reject) => {
		FB.api(
			'/me',
			{ fields: 'id,name,email,picture' },
			(response: FacebookUser & { error?: { message: string } }) => {
				if (response.error) {
					reject(new Error(response.error.message))
				} else {
					resolve(response)
				}
			},
		)
	})
}

export async function getUserPages(): Promise<FacebookPage[]> {
	const FB = await waitForFB()
	return new Promise((resolve, reject) => {
		FB.api(
			'/me/accounts',
			{ fields: 'id,name,picture,access_token,category,tasks' },
			(response: { data?: FacebookPage[]; error?: { message: string } }) => {
				if (response.error) {
					reject(new Error(response.error.message))
				} else {
					resolve(response.data || [])
				}
			},
		)
	})
}

export async function logoutFromFacebook(): Promise<void> {
	const FB = await waitForFB()
	return new Promise((resolve) => {
		FB.logout(() => {
			resolve()
		})
	})
}

export async function checkLoginStatus(): Promise<FacebookLoginResponse> {
	const FB = await waitForFB()
	return new Promise((resolve) => {
		FB.getLoginStatus((response) => {
			resolve(response)
		})
	})
}

export async function getPageAccessToken(pageId: string): Promise<string> {
	const pages = await getUserPages()
	const page = pages.find((p) => p.id === pageId)
	if (!page) {
		throw new Error(`Page ${pageId} not found`)
	}
	return page.access_token
}
