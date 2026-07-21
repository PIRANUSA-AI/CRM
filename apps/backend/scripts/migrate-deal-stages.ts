/**
 * Move existing deals off the Indonesian stage ids onto the Qontak-derived ones.
 *
 * Mapping is by meaning, not by probability: "Penawaran" becomes Initial
 * Quotation even though that drops it from 75% to 20%, because sending a first
 * quote is an early step in this pipeline, not a late one. The probability moves
 * with the stage so the two cannot disagree — a deal left at 75% while sitting
 * in a 20% column is exactly the drift this pipeline is meant to remove. Only a
 * handful of deals exist, so anything mapped to the wrong column is one drag to
 * fix; the alternative, keeping the old probability, is wrong silently.
 *
 * Idempotent: rows already on a current stage id are left alone.
 *
 *   bun run scripts/migrate-deal-stages.ts --dry-run
 *   bun run scripts/migrate-deal-stages.ts
 */
import prisma from '../src/lib/prisma'
import { DEAL_STAGES, DEFAULT_DEAL_THRESHOLD, resolveStage } from '../src/modules/opportunities/stages'

const dryRun = process.argv.includes('--dry-run')

const CURRENT_IDS = new Set(DEAL_STAGES.map((stage) => stage.id))

async function main() {
	const deals = await prisma.opportunities.findMany({
		select: { id: true, name: true, stage: true, probability: true, status: true },
	})

	let moved = 0
	let skipped = 0

	for (const deal of deals) {
		const from = String(deal.stage || '').trim().toLowerCase()
		if (CURRENT_IDS.has(from)) {
			skipped += 1
			continue
		}

		// resolveStage carries the alias table, so the script and the running app
		// agree on what an old id means rather than each keeping their own list.
		const stage = resolveStage(from)
		// Pending asserts no probability, but nothing maps onto it, so a null here
		// would mean the alias table gained an entry without this script noticing.
		const probability = stage.probability ?? deal.probability ?? 0

		console.log(
			`  ${deal.name}: ${from || '(kosong)'} ${deal.probability ?? '-'}% -> ${stage.id} ${probability}%`,
		)

		if (!dryRun) {
			await prisma.opportunities.update({
				where: { id: deal.id },
				data: {
					stage: stage.id,
					probability,
					status: stage.status,
					closed_at: stage.status === 'open' ? null : new Date(),
				},
			})
		}
		moved += 1
	}

	// The threshold that decides prospek vs opportunity was 50, which under the
	// new stages sits above the column literally named Valid Opportunity. Teams
	// still on the old default are moved with it; a team that has deliberately
	// picked something else is left alone.
	const staleTeams = await prisma.teams.findMany({
		where: { deal_threshold: 50 },
		select: { id: true, name: true },
	})
	for (const team of staleTeams) {
		console.log(`  tim ${team.name}: deal_threshold 50 -> ${DEFAULT_DEAL_THRESHOLD}`)
		if (!dryRun) {
			await prisma.teams.update({
				where: { id: team.id },
				data: { deal_threshold: DEFAULT_DEAL_THRESHOLD },
			})
		}
	}

	console.log(
		`\n${dryRun ? '[dry-run] ' : ''}${moved} deal dipindah, ${skipped} sudah benar, ${staleTeams.length} tim disesuaikan.`,
	)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
