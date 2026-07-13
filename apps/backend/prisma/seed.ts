import prisma from '../src/lib/prisma'

async function main() {
	console.log('🌱 Starting database seed...')
	console.log('📦 Seeding AI model pricing...')

	const aiModelPricingData = [
		{
			model_name: 'gpt-4o-mini',
			cost_per_request: 0.00015,
			description: 'OpenAI GPT-4o Mini - Fast and efficient',
			is_active: true,
		},
		{
			model_name: 'gpt-4o',
			cost_per_request: 0.005,
			description: 'OpenAI GPT-4o - Most capable model',
			is_active: true,
		},
		{
			model_name: 'gemini-3-flash',
			cost_per_request: 0.0001,
			description: 'Google Gemini 3 Flash - Fast reasoning',
			is_active: true,
		},
		{
			model_name: 'gemini-3-pro',
			cost_per_request: 0.0035,
			description: 'Google Gemini 3 Pro - Advanced reasoning',
			is_active: true,
		},
		{
			model_name: 'claude-3-haiku',
			cost_per_request: 0.00025,
			description: 'Anthropic Claude 3 Haiku - Fastest',
			is_active: true,
		},
		{
			model_name: 'claude-3-sonnet',
			cost_per_request: 0.003,
			description: 'Anthropic Claude 3 Sonnet - Balanced',
			is_active: true,
		},
		{
			model_name: 'claude-3-opus',
			cost_per_request: 0.015,
			description: 'Anthropic Claude 3 Opus - Highest quality',
			is_active: true,
		},
		// UI catalog tiers (per ai-agents page)
		{
			model_name: 'standard',
			cost_per_request: 11,
			description: 'Standard tier (UI label Standard)',
			is_active: true,
		},
		{
			model_name: 'advanced',
			cost_per_request: 173,
			description: 'Advanced tier (UI label Advanced)',
			is_active: true,
		},
		{
			model_name: 'standard_plus_a',
			cost_per_request: 7,
			description: 'Standard+ A tier (Beta)',
			is_active: true,
		},
		{
			model_name: 'standard_plus_b',
			cost_per_request: 7,
			description: 'Standard+ B tier (Beta)',
			is_active: true,
		},
		{
			model_name: 'standard_plus_c',
			cost_per_request: 7,
			description: 'Standard+ C tier (Beta)',
			is_active: true,
		},
		{
			model_name: 'standard_plus',
			cost_per_request: 28,
			description: 'Standard+ (legacy) tier',
			is_active: true,
		},
		{
			model_name: 'advanced_plus',
			cost_per_request: 139,
			description: 'Advanced+ tier (UI label Advanced+)',
			is_active: true,
		},
		{
			model_name: 'advanced_thinking',
			cost_per_request: 77,
			description: 'Advanced Thinking tier',
			is_active: true,
		},
		{
			model_name: 'standard_vision',
			cost_per_request: 21,
			description: 'Standard Vision tier',
			is_active: true,
		},
		{
			model_name: 'advanced_vision',
			cost_per_request: 21,
			description: 'Advanced Vision tier',
			is_active: true,
		},
		{
			model_name: 'advanced_v4',
			cost_per_request: 87,
			description: 'Advanced V4 tier',
			is_active: true,
		},
		{
			model_name: 'standard_v4',
			cost_per_request: 18,
			description: 'Standard V4 tier',
			is_active: true,
		},
	]

	for (const model of aiModelPricingData) {
		await prisma.ai_model_pricing.upsert({
			where: { model_name: model.model_name },
			update: model,
			create: model,
		})
		console.log(
			`  ✓ ${model.model_name} - ${model.cost_per_request} credits/request`,
		)
	}

	console.log('✅ Database seed completed successfully!')
}

main()
	.catch((e) => {
		console.error('❌ Seed failed:', e)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})
