import { swagger } from '@elysiajs/swagger'

export const openapiPlugin = swagger({
	path: '/docs',
	documentation: {
		info: {
			version: '2.0.0',
			title: 'CRM API',
			description:
				'CRM Backend API - Omnichannel Customer Engagement Platform',
		},
		tags: [
			{ name: 'Authority', description: 'Authentication & Authorization' },
			{ name: 'User', description: 'User Management' },
			{ name: 'Conversation', description: 'Conversation Management' },
			{ name: 'Message', description: 'Messaging Services' },
			{ name: 'Contact', description: 'Contact Management' },
			{ name: 'WhatsApp', description: 'WhatsApp Channel' },
			{ name: 'Instagram', description: 'Instagram Channel' },
			{ name: 'Webhook', description: 'Webhook Management' },
			{ name: 'AI', description: 'AI & Chatbot Services' },
			{ name: 'Knowledge', description: 'Knowledge Base' },
			{ name: 'Flow', description: 'Automation Flows' },
			{ name: 'Inbox', description: 'Inbox Management' },
			{ name: 'Team', description: 'Team Management' },
			{ name: 'Label', description: 'Label Management' },
			{ name: 'Broadcast', description: 'Broadcast Messaging' },
			{ name: 'CRM', description: 'CRM & Pipeline' },
			{ name: 'Media', description: 'Media Management' },
			{ name: 'Admin', description: 'Admin Operations' },
		],
		components: {
			securitySchemes: {
				bearerAuth: {
					type: 'http',
					scheme: 'bearer',
					bearerFormat: 'JWT',
				},
				apiKeyAuth: {
					type: 'apiKey',
					in: 'header',
					name: 'x-api-key',
				},
			},
		},
	},
})
