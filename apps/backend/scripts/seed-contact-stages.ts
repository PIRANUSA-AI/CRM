/**
 * Put the contact lifecycle in working order.
 *
 * Two problems, both from the stages having been created and then never used:
 *
 * 1. stage_order ran backwards, Customer 0, New Leads 3 - so any list sorted
 *    by it showed the funnel upside down.
 * 2. No contact had a stage at all. The column existed (as a JSON key), the UI
 *    rendered it, and every row read "inquiry" because nothing ever wrote one.
 *
 * The starting status is derived from deals rather than guessed: someone who
 * has won a deal is a Customer, someone with a live deal is a Hot Lead, and
 * everyone else is a New Lead. Payment is left alone, money having changed
 * hands is not something this database knows, so a human sets it.
 *
 * After this runs, the field is manually managed. It is deliberately not kept
 * in sync with deals: a customer who buys once stays a customer, and a status
 * that silently rewrote itself would not be worth having.
 *
 *   bun run scripts/seed-contact-stages.ts --dry-run
 *   bun run scripts/seed-contact-stages.ts
 */
import prisma from '../src/lib/prisma'

const dryRun = process.argv.includes('--dry-run')

/** Funnel order, first to last. Names match the rows that already exist. */
const ORDER = ['New Leads', 'Hot Leads', 'Payment', 'Customer']

async function main() {
	const stages = await prisma.pipeline_stages.findMany({
		where: { pipelines: { pipeline_type: 'contact' } },
		select: { id: true, name: true, stage_order: true, pipeline_id: true },
	})
	if (!stages.length) throw new Error('Tidak ada contact pipeline stage')

	const byName = new Map(stages.map((stage) => [stage.name, stage]))
	for (const name of ORDER) {
		if (!byName.has(name)) throw new Error(`Stage "${name}" tidak ditemukan`)
	}

	// Reordered in two passes through a scratch range: (pipeline_id, stage_order)
	// is unique, so writing 3 -> 0 while another row still holds 0 would collide.
	console.log('urutan corong:')
	for (const [index, name] of ORDER.entries()) {
		const stage = byName.get(name)!
		if (stage.stage_order === index) {
			console.log(`  ${name}: sudah di posisi ${index}`)
			continue
		}
		console.log(`  ${name}: ${stage.stage_order} -> ${index}`)
		if (!dryRun) {
			await prisma.pipeline_stages.update({
				where: { id: stage.id },
				data: { stage_order: 1000 + index },
			})
		}
	}
	if (!dryRun) {
		for (const [index, name] of ORDER.entries()) {
			await prisma.pipeline_stages.update({
				where: { id: byName.get(name)!.id },
				data: { stage_order: index },
			})
		}
	}

	const newLeads = byName.get('New Leads')!.id
	const hotLeads = byName.get('Hot Leads')!.id
	const customer = byName.get('Customer')!.id

	// Only contacts with no stage yet, so re-running never overwrites a status
	// somebody set by hand.
	const contacts = await prisma.$queryRaw<
		Array<{ id: string; won: bigint; open: bigint }>
	>`
		SELECT c.id,
			(SELECT COUNT(*) FROM opportunities o WHERE o.contact_id = c.id AND o.status = 'won') AS won,
			(SELECT COUNT(*) FROM opportunities o WHERE o.contact_id = c.id AND o.status = 'open') AS open
		FROM contacts c
		WHERE c.deleted_at IS NULL AND c.pipeline_stage_id IS NULL
	`

	const counts = { customer: 0, hot: 0, new: 0 }
	for (const contact of contacts) {
		const stageId =
			Number(contact.won) > 0 ? customer : Number(contact.open) > 0 ? hotLeads : newLeads
		if (stageId === customer) counts.customer += 1
		else if (stageId === hotLeads) counts.hot += 1
		else counts.new += 1

		if (!dryRun) {
			await prisma.contacts.update({ where: { id: contact.id }, data: { pipeline_stage_id: stageId } })
		}
	}

	console.log(
		`\n${dryRun ? '[dry-run] ' : ''}${contacts.length} kontak diberi status, ` +
			`Customer ${counts.customer}, Hot Leads ${counts.hot}, New Leads ${counts.new}.`,
	)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
