import { betterAuth } from 'better-auth'
import { prismaAdapter } from 'better-auth/adapters/prisma'
import { bearer } from 'better-auth/plugins'
import { Elysia } from 'elysia'
import prisma from './lib/prisma'

const debugPrisma = new Proxy(prisma, {
	get(target, prop) {
		const val = (target as any)[prop]
		if (val && typeof val === 'object') {
			return new Proxy(val, {
				get(t, p) {
					const fn = (t as any)[p]
					if (typeof fn === 'function') {
						return async (...args: any[]) => {
							console.log(
								`[PRISMA] ${String(prop)}.${String(p)}`,
								JSON.stringify(
									args[0]?.data || args[0]?.where || args[0],
								)?.substring(0, 500),
							)
							try {
								const result = await fn.apply(t, args)
								console.log(`[PRISMA OK] ${String(prop)}.${String(p)}`)
								return result
							} catch (e: any) {
								console.error(
									`[PRISMA ERR] ${String(prop)}.${String(p)}:`,
									e?.message?.substring(0, 300),
								)
								console.error(`[PRISMA ERR META]:`, JSON.stringify(e?.meta))
								throw e
							}
						}
					}
					return fn
				},
			})
		}
		return val
	},
})

export const auth = betterAuth({
	baseURL: process.env.BETTER_AUTH_URL || process.env.FRONTEND_URL || 'http://localhost:3010',
	basePath: '/auth',
	database: prismaAdapter(debugPrisma, {
		provider: 'postgresql',
	}),
	advanced: {
		database: {
			generateId: () => crypto.randomUUID(),
		},
	},
	onAPIError: {
		throw: true,
	},
	user: {
		modelName: 'users',
		fields: {
			image: 'avatar_url',
			createdAt: 'created_at',
			updatedAt: 'updated_at',
		},
		additionalFields: {
			role: {
				type: 'string',
				required: false,
				input: false,
			},
		},
	},
	session: {
		modelName: 'session',
		expiresIn: 60 * 60 * 24 * 7,
		updateAge: 60 * 60 * 24,
	},
	account: {
		modelName: 'account',
	},
	verification: {
		modelName: 'verification',
	},
	emailAndPassword: {
		enabled: true,
		autoSignInAfterRegistration: true,
	},
	trustedOrigins: [
		...(process.env.FRONTEND_URL
			? process.env.FRONTEND_URL.split(',').flatMap((u) =>
					/^https?:\/\//i.test(u.trim())
						? [u.trim()]
						: [`https://${u.trim()}`, `http://${u.trim()}`],
				)
			: ['http://localhost:3005']),
		...(process.env.TUNNEL_FE_HOST
			? [`https://${process.env.TUNNEL_FE_HOST}`, `http://${process.env.TUNNEL_FE_HOST}`]
			: []),
		'http://localhost:3005',
		'http://localhost:3006',
	],
	plugins: [bearer()],
})

const betterAuthView = async (request: Request) => {
	const BETTER_AUTH_ACCEPT_METHODS = ['POST', 'GET']
	if (BETTER_AUTH_ACCEPT_METHODS.includes(request.method)) {
		const url = new URL(request.url)
		if (request.method === 'POST' && url.pathname.endsWith('/sign-up/email')) {
			return Response.json(
				{ message: 'Public sign-up is disabled', code: 'SIGNUP_DISABLED' },
				{ status: 403 },
			)
		}
		try {
			return await auth.handler(request)
		} catch (e: any) {
			console.error('[AUTH ERROR]', e?.message)
			console.error('[AUTH ERROR STACK]', e?.stack?.substring(0, 500))
			console.error('[AUTH ERROR META]', JSON.stringify(e?.meta))
			return Response.json(
				{
					message: e?.message || 'Auth error',
					code: 'AUTH_ERROR',
					meta: e?.meta,
				},
				{ status: 500 },
			)
		}
	} else {
		return Response.json({ message: 'Method Not Allowed' }, { status: 405 })
	}
}

export const betterAuthPlugin = new Elysia({ name: 'better-auth' }).mount(
	betterAuthView,
)
