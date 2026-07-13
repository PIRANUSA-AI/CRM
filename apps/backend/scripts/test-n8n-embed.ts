#!/usr/bin/env bun

/**
 * Test script for n8n embedded authentication
 * 
 * Usage: bun run scripts/test-n8n-embed.ts
 */

export {} // Make this a module to allow top-level await

const N8N_BASE_URL = process.env.N8N_BASE_URL || 'http://localhost:3309'
const N8N_EMBED_AUTH_ENABLED = process.env.N8N_EMBED_AUTH_ENABLED === 'true'
const N8N_EMBED_AUTH_SECRET = process.env.N8N_EMBED_AUTH_SECRET || ''

console.log('🔍 Testing n8n Embedded Authentication\n')

// Check configuration
console.log('📋 Configuration:')
console.log(`  N8N_BASE_URL: ${N8N_BASE_URL}`)
console.log(`  N8N_EMBED_AUTH_ENABLED: ${N8N_EMBED_AUTH_ENABLED}`)
console.log(`  N8N_EMBED_AUTH_SECRET: ${N8N_EMBED_AUTH_SECRET ? '✅ Set' : '❌ Not set'}\n`)

if (!N8N_EMBED_AUTH_ENABLED) {
	console.error('❌ N8N_EMBED_AUTH_ENABLED is not true')
	console.log('   Set N8N_EMBED_AUTH_ENABLED=true in .env\n')
	process.exit(1)
}

if (!N8N_EMBED_AUTH_SECRET) {
	console.error('❌ N8N_EMBED_AUTH_SECRET is not set')
	console.log('   Set N8N_EMBED_AUTH_SECRET in .env\n')
	process.exit(1)
}

// Test n8n health
console.log('🏥 Testing n8n health...')
try {
	const healthUrl = `${N8N_BASE_URL}/healthz`
	console.log(`   GET ${healthUrl}`)
	
	const healthResponse = await fetch(healthUrl)
	if (healthResponse.ok) {
		console.log('   ✅ n8n is healthy\n')
	} else {
		console.log(`   ⚠️  n8n returned ${healthResponse.status}\n`)
	}
} catch (err) {
	console.error('   ❌ Failed to connect to n8n')
	console.error(`   Error: ${err instanceof Error ? err.message : err}\n`)
	console.log('   Make sure n8n is running at:', N8N_BASE_URL)
	console.log('   Start n8n with: cd n8n-crm && pnpm exec dotenvx run -f .env.local -- pnpm dev:be\n')
	process.exit(1)
}

// Test embedded auth endpoint
console.log('🔐 Testing embedded auth endpoint...')
const embedUrl = `${N8N_BASE_URL}/rest/embedded-auth/crm/login`
console.log(`   POST ${embedUrl}`)

try {
	const testOrgId = `test-org-${Date.now()}`
	const testOrgName = 'Test Organization'
	
	console.log(`   Organization ID: ${testOrgId}`)
	console.log(`   Organization Name: ${testOrgName}`)
	
	const response = await fetch(embedUrl, {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json',
			'x-embed-auth-secret': N8N_EMBED_AUTH_SECRET,
		},
		body: JSON.stringify({
			organizationId: testOrgId,
			organizationName: testOrgName,
		}),
	})
	
	console.log(`   Response: ${response.status} ${response.statusText}`)
	
	if (response.ok) {
		const setCookieHeader = response.headers.get('set-cookie')
		if (setCookieHeader) {
			console.log('   ✅ Authentication successful')
			console.log(`   ✅ Cookie received: ${setCookieHeader.substring(0, 50)}...`)
			
			const body = await response.json() as { id: string; email: string; firstName: string; lastName: string }
			console.log('   User created/logged in:', {
				id: body.id,
				email: body.email,
				firstName: body.firstName,
				lastName: body.lastName,
			})
		} else {
			console.log('   ⚠️  Authentication succeeded but no cookie received')
		}
	} else {
		const errorBody = await response.text()
		console.error('   ❌ Authentication failed')
		console.error(`   Status: ${response.status} ${response.statusText}`)
		console.error(`   Body: ${errorBody}`)
		
		if (response.status === 403) {
			console.log('\n   💡 Tip: Check that N8N_EMBED_AUTH_SECRET matches in both apps')
		} else if (response.status === 502) {
			console.log('\n   💡 Tip: n8n might not be running or not reachable')
		}
		
		process.exit(1)
	}
} catch (err) {
	console.error('   ❌ Request failed')
	console.error(`   Error: ${err instanceof Error ? err.message : err}`)
	process.exit(1)
}

console.log('\n✅ All tests passed!')
console.log('\n📝 Next steps:')
console.log('   1. Restart CRM backend to pick up configuration changes')
console.log('   2. Navigate to /automation page in CRM')
console.log('   3. n8n should load automatically without login prompt')
