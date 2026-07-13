import { Elysia, t } from 'elysia'
import { FormService } from './service'
import { FormModel, FormRequestModel } from './model'

export const form = new Elysia({ prefix: '/forms', tags: ['Advanced'] })
	.get(
		'/',
		async ({ query }) => {
			const forms = await FormService.getForms(query.appId)
			return { data: forms }
		},
		{
			query: t.Object({ appId: t.String() }),
		},
	)
	.get(
		'/:id',
		async ({ params }) => {
			const f = await FormService.getFormById(params.id)
			if (!f) return { error: 'Form not found' }
			return { data: f }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/',
		async ({ query, body }) => {
			const f = await FormService.createForm(query.appId, body)
			return { data: f }
		},
		{
			query: t.Object({ appId: t.String() }),
			body: FormRequestModel.create,
		},
	)
	.get(
		'/conversation/:id',
		async ({ params }) => {
			const submission = await FormService.getSubmission(params.id)
			return { data: submission }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
	.post(
		'/conversation/:id/extract',
		async ({ params }) => {
			// Mock extraction logic
			return { success: true, message: 'AI Extraction started' }
		},
		{
			params: t.Object({ id: t.String() }),
		},
	)
