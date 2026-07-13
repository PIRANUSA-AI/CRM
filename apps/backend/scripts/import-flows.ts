/**
 * Script to import flows from legacy system into automation_flows table.
 *
 * The legacy data has separate flow_nodes/flow_edges arrays per flow.
 * Our system stores nodes/edges as JSON columns in automation_flows.
 *
 * By default, resolves app_id automatically from business_id in the JSON data.
 * You can also target a specific app or organization.
 *
 * Usage:
 *   bun run apps/backend/scripts/import-flows.ts
 *   bun run apps/backend/scripts/import-flows.ts --org-id <organizationId> --mode skip --dry-run
 *   bun run apps/backend/scripts/import-flows.ts --app-id <appId> --input /path/to/flows.json
 */

import prisma from '../src/lib/prisma'
import { readFileSync } from 'fs'
import { resolve } from 'path'

interface LegacyFlowNode {
	id: string
	data: Record<string, unknown>
	type: string
	flow_id: string
	position: { x: number; y: number }
	simple_id: number | string | null
	created_at: string
	last_assigned_agent: string | null
}

interface LegacyFlowEdge {
	id: string
	data: Record<string, unknown>
	type: string
	source: string
	target: string
	flow_id: string
	created_at: string
}

interface LegacyFlow {
	id: string
	name: string
	description: string | null
	created_at: string
	inbox_id: string | null
	business_id: string
	updated_at: string
	is_deleted: boolean
	flow_nodes: LegacyFlowNode[]
	flow_edges: LegacyFlowEdge[]
}

type ConflictMode = 'skip' | 'replace' | 'duplicate'

interface ScriptOptions {
	inputPath: string
	orgId: string | null
	appId: string | null
	mode: ConflictMode
	dryRun: boolean
}

interface AppSummary {
	id: string
	app_name: string
}

function transformNode(node: LegacyFlowNode) {
	return {
		id: node.id,
		data: node.data,
		type: node.type,
		position: node.position,
		simple_id: node.simple_id,
		last_assigned_agent: node.last_assigned_agent,
	}
}

function transformEdge(edge: LegacyFlowEdge) {
	return {
		id: edge.id,
		data: edge.data,
		type: edge.type,
		source: edge.source,
		target: edge.target,
	}
}

function parseArgs(argv: string[]): ScriptOptions {
	const defaultInputPath = resolve(__dirname, '../../../flows.json')
	const options: ScriptOptions = {
		inputPath: defaultInputPath,
		orgId: null,
		appId: null,
		mode: 'skip',
		dryRun: false,
	}

	const readArgValue = (argName: string, currentArg: string, index: number) => {
		const [, inlineValue] = currentArg.split('=')
		if (inlineValue) {
			return { value: inlineValue, nextIndex: index }
		}

		const next = argv[index + 1]
		if (!next || next.startsWith('--')) {
			throw new Error(`Missing value for ${argName}`)
		}
		return { value: next, nextIndex: index + 1 }
	}

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i]

		if (arg === '--dry-run') {
			options.dryRun = true
			continue
		}

		if (arg.startsWith('--input')) {
			const { value, nextIndex } = readArgValue('--input', arg, i)
			options.inputPath = resolve(value)
			i = nextIndex
			continue
		}

		if (arg.startsWith('--org-id')) {
			const { value, nextIndex } = readArgValue('--org-id', arg, i)
			options.orgId = value
			i = nextIndex
			continue
		}

		if (arg.startsWith('--app-id')) {
			const { value, nextIndex } = readArgValue('--app-id', arg, i)
			options.appId = value
			i = nextIndex
			continue
		}

		if (arg.startsWith('--mode')) {
			const { value, nextIndex } = readArgValue('--mode', arg, i)
			if (value !== 'skip' && value !== 'replace' && value !== 'duplicate') {
				throw new Error(`Invalid --mode "${value}". Allowed values: skip, replace, duplicate`)
			}
			options.mode = value
			i = nextIndex
			continue
		}

		throw new Error(`Unknown argument: ${arg}`)
	}

	return options
}

async function resolveTargetApp(options: ScriptOptions): Promise<AppSummary | null> {
	if (options.appId) {
		const app = await prisma.apps.findUnique({
			where: { id: options.appId },
			select: { id: true, app_name: true },
		})
		if (!app) {
			throw new Error(`Target app not found for --app-id ${options.appId}`)
		}
		return app
	}

	if (!options.orgId) {
		return null
	}

	const org = await prisma.organization.findUnique({
		where: { id: options.orgId },
		select: { id: true, name: true, appId: true },
	})

	if (!org) {
		throw new Error(`Organization not found for --org-id ${options.orgId}`)
	}

	if (!org.appId) {
		throw new Error(`Organization ${org.id} (${org.name}) has no appId`)
	}

	const app = await prisma.apps.findUnique({
		where: { id: org.appId },
		select: { id: true, app_name: true },
	})

	if (!app) {
		throw new Error(
			`Target app ${org.appId} (from organization ${org.id}) was not found in apps table`,
		)
	}

	return app
}

async function importFlows() {
	const options = parseArgs(process.argv.slice(2))

	// Read legacy data from JSON file
	const raw = readFileSync(options.inputPath, 'utf-8')
	const legacyFlows: LegacyFlow[] = JSON.parse(raw)

	console.log(`Input file: ${options.inputPath}`)
	console.log(
		`Mode: ${options.mode}${options.dryRun ? ' (dry-run)' : ''}${options.orgId ? `, org=${options.orgId}` : ''}${options.appId ? `, app=${options.appId}` : ''}`,
	)

	const forcedTargetApp = await resolveTargetApp(options)
	const usingForcedTarget = !!forcedTargetApp
	let appMap = new Map<string, AppSummary>()

	if (usingForcedTarget && forcedTargetApp) {
		console.log(`Target app: ${forcedTargetApp.app_name} (${forcedTargetApp.id})`)
	} else {
		// Default behavior: resolve business_id -> apps.id
		const businessIds = [...new Set(legacyFlows.map((f) => f.business_id))]
		console.log(`Found ${legacyFlows.length} flows from ${businessIds.length} business(es)`)

		const apps = await prisma.apps.findMany({
			where: { id: { in: businessIds } },
			select: { id: true, app_name: true },
		})

		appMap = new Map(apps.map((a) => [a.id, a]))

		if (apps.length === 0) {
			console.error('No matching apps found in database for business_ids:', businessIds)
			process.exit(1)
		}

		for (const app of apps) {
			console.log(`  Found app: ${app.app_name} (${app.id})`)
		}
	}
	console.log()

	let created = 0
	let replaced = 0
	let skippedDeleted = 0
	let skippedEmpty = 0
	let skippedExisting = 0
	let skippedMissingApp = 0

	for (const flow of legacyFlows) {
		const app = forcedTargetApp ?? appMap.get(flow.business_id)

		if (!app) {
			console.log(`  ⏭ Skipping "${flow.name}" — no app found for business_id ${flow.business_id}`)
			skippedMissingApp++
			continue
		}

		if (flow.is_deleted) {
			console.log(`  ⏭ Skipping deleted flow: ${flow.name}`)
			skippedDeleted++
			continue
		}

		if (!flow.flow_nodes.length) {
			console.log(`  ⏭ Skipping empty flow: ${flow.name}`)
			skippedEmpty++
			continue
		}

		const shouldCheckExisting = options.mode !== 'duplicate'
		const existing = shouldCheckExisting
			? await prisma.automation_flows.findFirst({
					where: { app_id: app.id, name: flow.name },
					select: { id: true },
				})
			: null

		if (existing && options.mode === 'skip') {
			console.log(`  ⏭ Flow "${flow.name}" already exists, skipping`)
			skippedExisting++
			continue
		}

		const nodes = flow.flow_nodes.map(transformNode)
		const edges = flow.flow_edges.map(transformEdge)

		if (options.dryRun) {
			if (existing && options.mode === 'replace') {
				console.log(`  • Would replace: ${flow.name} (${nodes.length} nodes, ${edges.length} edges)`)
				replaced++
			} else {
				console.log(`  • Would import: ${flow.name} (${nodes.length} nodes, ${edges.length} edges)`)
				created++
			}
			continue
		}

		if (existing && options.mode === 'replace') {
			await prisma.automation_flows.update({
				where: { id: existing.id },
				data: {
					description: flow.description,
					nodes: JSON.parse(JSON.stringify(nodes)),
					edges: JSON.parse(JSON.stringify(edges)),
					active: true,
				},
			})
			console.log(`  ↺ Replaced: ${flow.name} (${nodes.length} nodes, ${edges.length} edges)`)
			replaced++
			continue
		}

		await prisma.automation_flows.create({
			data: {
				app_id: app.id,
				name: flow.name,
				description: flow.description,
				nodes: JSON.parse(JSON.stringify(nodes)),
				edges: JSON.parse(JSON.stringify(edges)),
				active: true,
			},
		})

		console.log(`  ✓ Imported: ${flow.name} (${nodes.length} nodes, ${edges.length} edges)`)
		created++
	}

	const skippedTotal = skippedDeleted + skippedEmpty + skippedExisting + skippedMissingApp
	const importable = created + replaced

	console.log('\nSummary:')
	console.log(`  Importable: ${importable}`)
	console.log(`  Created: ${created}`)
	console.log(`  Replaced: ${replaced}`)
	console.log(`  Skipped total: ${skippedTotal}`)
	console.log(`    - deleted: ${skippedDeleted}`)
	console.log(`    - empty: ${skippedEmpty}`)
	console.log(`    - existing (${options.mode}): ${skippedExisting}`)
	console.log(`    - missing app mapping: ${skippedMissingApp}`)
	console.log(`\nDone${options.dryRun ? ' (dry-run)' : ''}!`)
	process.exit(0)
}

importFlows().catch((err) => {
	console.error('Import failed:', err)
	process.exit(1)
})
