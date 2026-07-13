import { Elysia, t } from 'elysia'
import { UserModel, UserRequestModel } from './model'
import { UserService } from './service'

export const user = new Elysia({ prefix: '/user', tags: ['User'] })
	// Get all users for an account
	.get(
		'/',
		async ({ query }) => {
			const users = await UserService.getUsers(query.accountId)
			return { data: users }
		},
		{
			query: t.Object({
				accountId: t.String(),
			}),
			response: {
				200: t.Object({ data: UserModel.users }),
			},
		},
	)

	// Get user by ID
	.get(
		'/:id',
		async ({ params }) => {
			const user = await UserService.getUserById(params.id)
			if (!user) {
				return { error: 'User not found' }
			}
			return { data: user }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Update user profile
	.patch(
		'/:id',
		async ({ params, body }) => {
			const user = await UserService.updateUser(params.id, body)
			return { data: user }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: UserRequestModel.updateProfile,
		},
	)

	// Get user presence
	.get(
		'/:id/presence',
		async ({ params }) => {
			const presence = await UserService.getUserPresence(params.id)
			return { data: presence }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
		},
	)

	// Update user presence
	.post(
		'/:id/presence',
		async ({ params, body }) => {
			const presence = await UserService.updateUserPresence(
				params.id,
				body.status,
			)
			return { data: presence }
		},
		{
			params: t.Object({
				id: t.String(),
			}),
			body: t.Object({
				status: t.String(),
			}),
		},
	)

	// Get user timezone
	.get('/timezone', async () => {
		return { success: true, timezone: 'Asia/Jakarta' }
	})

	// Update user timezone
	.put(
		'/timezone',
		async ({ body }) => {
			return { success: true, timezone: body.timezone }
		},
		{
			body: t.Object({
				timezone: t.String(),
			}),
		},
	)

	// Detect user timezone
	.post(
		'/timezone/detect',
		async ({ body }) => {
			return {
				success: true,
				payload: {
					timezone: body.detected_timezone || 'Asia/Jakarta',
					timezone_auto_detected: true,
					updated: true,
				},
			}
		},
		{
			body: t.Object({
				detected_timezone: t.Optional(t.String()),
			}),
		},
	)

	// Reset user timezone
	.post('/timezone/reset', async () => {
		return { success: true, timezone: 'Asia/Jakarta' }
	})
