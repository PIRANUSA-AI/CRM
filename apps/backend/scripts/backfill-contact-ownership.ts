/**
 * Fill contacts.owner_id / contacts.team_id from the evidence that used to be
 * OR-ed together at query time in CustomerService.listCustomers.
 *
 * The old read matched a contact if ANY of three things pointed at the viewer,
 * with no precedence. Materialising it means picking one answer, so the passes
 * below run weakest-first and let the stronger evidence overwrite:
 *
 *   owner   task assignee  <  custom_attributes.assigned_user_id  <  conversation assignee
 *   team    owner's team   <  deal team                           <  conversation team
 *
 * Conversation wins because this is a WhatsApp-first CRM: the conversation is
 * the relationship, and handing it over is the act that moves a contact between
 * people. The JSON key beats a task because import writes both together, but a
 * task can also be reassigned on its own without ownership being meant to move
 * — which was exactly the old derivation's silent failure mode.
 *
 * A contact with no evidence at all keeps owner_id NULL. That is not a gap to
 * be papered over: it means nobody has picked the lead up yet, and the read
 * side treats NULL as the administrator's intake pool.
 *
 * Idempotent. By default it only fills rows that are still NULL, so a later
 * manual reassignment survives a re-run. Pass --recompute to rebuild every row
 * from evidence (which DOES clobber manual assignments).
 *
 *   bun run scripts/backfill-contact-ownership.ts [--recompute] [--dry-run]
 */
import prisma from '../src/lib/prisma'

const RECOMPUTE = process.argv.includes('--recompute')
const DRY_RUN = process.argv.includes('--dry-run')

// When not recomputing, every pass is additionally gated on the column still
// being NULL so a stronger pass cannot undo a value a human set by hand.
const ownerGate = RECOMPUTE ? '' : 'AND c.owner_id IS NULL'
const teamGate = RECOMPUTE ? '' : 'AND c.team_id IS NULL'

type Pass = { label: string; sql: string }

const OWNER_PASSES: Pass[] = [
	{
		label: 'owner <- task assignee',
		sql: `
			UPDATE contacts c SET owner_id = t.assignee_id, updated_at = NOW()
			FROM (
				SELECT DISTINCT ON (contact_id) contact_id, assignee_id
				FROM tasks
				WHERE contact_id IS NOT NULL AND assignee_id IS NOT NULL
				ORDER BY contact_id, created_at DESC
			) t
			WHERE t.contact_id = c.id AND c.deleted_at IS NULL ${ownerGate}
		`,
	},
	{
		label: 'owner <- custom_attributes.assigned_user_id',
		sql: `
			UPDATE contacts c SET owner_id = (c.custom_attributes->>'assigned_user_id')::uuid, updated_at = NOW()
			WHERE c.deleted_at IS NULL
				AND c.custom_attributes->>'assigned_user_id' IS NOT NULL
				-- The JSON key is free-form text; skip anything that is not a uuid
				-- rather than letting one bad row abort the whole pass.
				AND c.custom_attributes->>'assigned_user_id' ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
				${ownerGate}
		`,
	},
	{
		label: 'owner <- conversation assignee',
		sql: `
			UPDATE contacts c SET owner_id = v.assignee_id, updated_at = NOW()
			FROM (
				SELECT DISTINCT ON (contact_id) contact_id, assignee_id
				FROM conversations
				WHERE contact_id IS NOT NULL AND assignee_id IS NOT NULL
				ORDER BY contact_id, updated_at DESC
			) v
			WHERE v.contact_id = c.id AND c.deleted_at IS NULL ${ownerGate}
		`,
	},
]

const TEAM_PASSES: Pass[] = [
	{
		// Only when the owner belongs to exactly one team. An administrator sits
		// in every team, so inferring a team from their membership would stamp an
		// arbitrary one onto the contact.
		label: 'team <- owner\'s sole team',
		sql: `
			UPDATE contacts c SET team_id = m.team_id, updated_at = NOW()
			FROM (
				SELECT user_id, (array_agg(team_id))[1] AS team_id
				FROM team_members GROUP BY user_id HAVING COUNT(*) = 1
			) m
			WHERE m.user_id = c.owner_id AND c.deleted_at IS NULL ${teamGate}
		`,
	},
	{
		label: 'team <- deal team',
		sql: `
			UPDATE contacts c SET team_id = o.team_id, updated_at = NOW()
			FROM (
				SELECT DISTINCT ON (contact_id) contact_id, team_id
				FROM opportunities
				WHERE contact_id IS NOT NULL AND team_id IS NOT NULL
				ORDER BY contact_id, updated_at DESC
			) o
			WHERE o.contact_id = c.id AND c.deleted_at IS NULL ${teamGate}
		`,
	},
	{
		label: 'team <- conversation team',
		sql: `
			UPDATE contacts c SET team_id = v.team_id, updated_at = NOW()
			FROM (
				SELECT DISTINCT ON (contact_id) contact_id, team_id
				FROM conversations
				WHERE contact_id IS NOT NULL AND team_id IS NOT NULL
				ORDER BY contact_id, updated_at DESC
			) v
			WHERE v.contact_id = c.id AND c.deleted_at IS NULL ${teamGate}
		`,
	},
]

async function run(passes: Pass[]) {
	for (const pass of passes) {
		if (DRY_RUN) {
			console.log(`  (dry-run) ${pass.label}`)
			continue
		}
		const affected = await prisma.$executeRawUnsafe(pass.sql)
		console.log(`  ${pass.label}: ${affected} baris`)
	}
}

async function main() {
	console.log(RECOMPUTE ? 'Mode: recompute (menimpa nilai lama)' : 'Mode: isi yang masih kosong')
	if (DRY_RUN) console.log('Dry-run: tidak ada yang ditulis.\n')

	console.log('\nKepemilikan:')
	await run(OWNER_PASSES)

	console.log('\nTim:')
	await run(TEAM_PASSES)

	// Ownership pointing at a user that no longer exists is worse than no
	// ownership: the contact becomes invisible to everyone instead of landing
	// back in the intake pool.
	if (!DRY_RUN) {
		const orphaned = await prisma.$executeRawUnsafe(`
			UPDATE contacts c SET owner_id = NULL, updated_at = NOW()
			WHERE c.owner_id IS NOT NULL
				AND NOT EXISTS (SELECT 1 FROM users u WHERE u.id = c.owner_id AND u.deleted_at IS NULL)
		`)
		if (orphaned > 0) console.log(`\nDilepas (pemilik sudah tidak ada): ${orphaned} baris`)

		// Drop the legacy JSON key now that the column carries the answer. Guarded
		// on owner_id being set so this can never destroy the only record of who
		// owned a contact — a row that failed to backfill keeps its key.
		const purged = await prisma.$executeRawUnsafe(`
			UPDATE contacts SET custom_attributes = custom_attributes - 'assigned_user_id', updated_at = NOW()
			WHERE custom_attributes ? 'assigned_user_id' AND owner_id IS NOT NULL
		`)
		if (purged > 0) console.log(`Kunci JSON lama dihapus: ${purged} baris`)

		const stranded = await prisma.$queryRawUnsafe<Array<{ jumlah: bigint }>>(`
			SELECT COUNT(*) AS jumlah FROM contacts
			WHERE custom_attributes ? 'assigned_user_id' AND owner_id IS NULL AND deleted_at IS NULL
		`)
		if (Number(stranded[0]?.jumlah || 0) > 0) {
			console.log(
				`PERHATIAN: ${stranded[0].jumlah} kontak masih menyimpan assigned_user_id tapi gagal dapat owner_id — periksa manual.`,
			)
		}
	}

	console.log('\n--- hasil ---')
	const rows = await prisma.$queryRawUnsafe<
		Array<{ pemilik: string | null; tim: string | null; jumlah: bigint }>
	>(`
		SELECT u.name AS pemilik, t.name AS tim, COUNT(*) AS jumlah
		FROM contacts c
		LEFT JOIN users u ON u.id = c.owner_id
		LEFT JOIN teams t ON t.id = c.team_id
		WHERE c.deleted_at IS NULL
		GROUP BY 1, 2 ORDER BY 3 DESC
	`)
	for (const row of rows) {
		console.log(
			`  ${(row.pemilik || '(belum ada pemilik)').padEnd(28)} ${(row.tim || '-').padEnd(10)} ${row.jumlah}`,
		)
	}
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
