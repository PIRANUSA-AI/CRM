/**
 * Migration Script: Apps → Better Auth Organizations
 * 
 * This script migrates existing apps and users to Better Auth organization structure.
 * Run after deploying the schema changes.
 * 
 * Usage: bun run scripts/migrate-to-orgs.ts
 */

import prisma from '../src/lib/prisma'

// Generate a human-readable slug from app name or app_id
function generateSlug(appName: string, appId: string): string {
	// If app_name exists and is not empty, use it
	if (appName && appName.trim()) {
		return appName
			.toLowerCase()
			.replace(/[^a-z0-9]+/g, '-') // Replace non-alphanumeric with hyphens
			.replace(/^-+|-+$/g, '') // Remove leading/trailing hyphens
			.substring(0, 64) // Max 64 chars
	}
	
	// Fallback to app_id with "org-" prefix
	return `org-${appId.substring(0, 60)}`
}

async function migrate() {
	console.log('🚀 Starting migration: Apps → Organizations\n')
	
	try {
		// Step 1: Get all existing apps
		console.log('📋 Step 1: Fetching existing apps...')
		const apps = await prisma.apps.findMany({
			include: {
				users: true,
			},
		})
		console.log(`   Found ${apps.length} apps\n`)
		
		let orgsCreated = 0
		let membersCreated = 0
		let appsUpdated = 0
		
		// Step 2: Create organization for each app
		console.log('🏢 Step 2: Creating organizations...')
		for (const app of apps) {
			// Skip if already has org_id
			if (app.org_id) {
				console.log(`   ⏭️  Skipping ${app.app_name} (already migrated)`)
				continue
			}
			
			// Generate slug
			const slug = generateSlug(app.app_name, app.app_id)
			
			// Check if slug already exists
			const existingOrg = await prisma.organization.findUnique({
				where: { slug },
			})
			
			const finalSlug = existingOrg ? `${slug}-${Date.now()}` : slug
			
			// Create organization
			const org = await prisma.organization.create({
				data: {
					name: app.app_name || app.business_name || 'Unnamed Organization',
					slug: finalSlug,
					metadata: {
						migratedFrom: 'apps',
						originalAppId: app.app_id,
						migratedAt: new Date().toISOString(),
					},
					// Link to app (will be updated after we have the org id)
				},
			})
			
			console.log(`   ✓ Created org: ${org.name} (${org.slug})`)
			orgsCreated++
			
			// Step 3: Update app with org_id and org_slug
			await prisma.apps.update({
				where: { id: app.id },
				data: {
					org_id: org.id,
					org_slug: org.slug,
				},
			})
			
			// Update organization to link back to app
			await prisma.organization.update({
				where: { id: org.id },
				data: {
					appId: app.id,
				},
			})
			
			appsUpdated++
			
			// Step 4: Create member records for users
			console.log(`   👥 Creating members for ${app.users.length} users...`)
			for (const user of app.users) {
				// Determine role based on existing user role
				let memberRole = 'member'
				if (user.role === 'admin' || user.role === 'owner') {
					memberRole = 'owner'
				} else if (user.role === 'supervisor') {
					memberRole = 'admin'
				}
				
				// Check if member already exists
				const existingMember = await prisma.member.findFirst({
					where: {
						organizationId: org.id,
						userId: user.id,
					},
				})
				
				if (!existingMember) {
					await prisma.member.create({
						data: {
							organizationId: org.id,
							userId: user.id,
							role: memberRole,
						},
					})
					membersCreated++
				}
			}
		}
		
		console.log('\n✅ Migration completed successfully!')
		console.log(`   Organizations created: ${orgsCreated}`)
		console.log(`   Apps updated: ${appsUpdated}`)
		console.log(`   Members created: ${membersCreated}`)
		
	} catch (error) {
		console.error('\n❌ Migration failed:', error)
		process.exit(1)
	} finally {
		await prisma.$disconnect()
	}
}

// Run migration
migrate()
