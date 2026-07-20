/**
 * Create `companies` rows from the free-text contacts.company column and point
 * contacts at them.
 *
 * Runs through the same normaliser the write paths use (lib/company.ts) rather
 * than reimplementing it in SQL, so a name that collapses one way here collapses
 * the same way when a leader types it into the form tomorrow. Two spellings of
 * one firm therefore land on one row without anyone having to merge them.
 *
 * The free-text column is left exactly as it was. It stays the fallback for a
 * contact whose company never resolved, and keeping it means this backfill can
 * be re-run or reverted without having destroyed the source it read from.
 *
 * Idempotent. By default it only fills contacts whose company_id is still NULL,
 * so a link a human corrected by hand survives a re-run. Pass --recompute to
 * relink every contact that has company text.
 *
 *   bun run scripts/backfill-companies.ts [--recompute] [--dry-run]
 */
import prisma from '../src/lib/prisma'
import { displayCompanyName, normalizeCompanyName } from '../src/lib/company'

const RECOMPUTE = process.argv.includes('--recompute')
const DRY_RUN = process.argv.includes('--dry-run')

type Row = { id: string; app_id: string | null; company: string | null }

async function main() {
	console.log(RECOMPUTE ? 'Mode: recompute (menimpa tautan lama)' : 'Mode: isi yang masih kosong')
	if (DRY_RUN) console.log('Dry-run: tidak ada yang ditulis.\n')

	const contacts = await prisma.$queryRawUnsafe<Row[]>(`
		SELECT id, app_id, company FROM contacts
		WHERE deleted_at IS NULL
			AND btrim(coalesce(company, '')) <> ''
			${RECOMPUTE ? '' : 'AND company_id IS NULL'}
		ORDER BY created_at
	`)
	console.log(`Kontak dengan teks company: ${contacts.length}`)

	// Group first so the report can show which spellings collapsed together
	// before anything is written — that is the one decision worth eyeballing.
	const groups = new Map<string, { appId: string; display: string; ids: string[]; spellings: Set<string> }>()
	let skipped = 0

	for (const row of contacts) {
		if (!row.app_id) {
			skipped++
			continue
		}
		const norm = normalizeCompanyName(row.company)
		if (!norm) {
			// Punctuation or a bare legal form ("PT", "-"). Nothing to link to.
			skipped++
			continue
		}
		const key = `${row.app_id}::${norm}`
		const existing = groups.get(key)
		if (existing) {
			existing.ids.push(row.id)
			existing.spellings.add(displayCompanyName(String(row.company)))
		} else {
			groups.set(key, {
				appId: row.app_id,
				display: displayCompanyName(String(row.company)),
				ids: [row.id],
				spellings: new Set([displayCompanyName(String(row.company))]),
			})
		}
	}

	const merged = [...groups.values()].filter((g) => g.spellings.size > 1)
	if (merged.length) {
		console.log('\nEjaan berbeda yang digabung jadi satu perusahaan:')
		for (const g of merged) console.log(`  ${[...g.spellings].join(' | ')}  ->  ${g.display}`)
	} else {
		console.log('\nTidak ada ejaan berbeda yang perlu digabung.')
	}

	if (skipped > 0) console.log(`\nDilewati (tanpa app_id / nama kosong setelah normalisasi): ${skipped}`)

	if (DRY_RUN) {
		console.log(`\n(dry-run) akan membuat/memakai ${groups.size} perusahaan untuk ${contacts.length - skipped} kontak.`)
		return
	}

	let created = 0
	let reused = 0
	let linked = 0

	for (const [key, group] of groups) {
		const norm = key.split('::')[1]

		// Not resolveCompany() — this needs to report created vs reused, and an
		// upsert keeps the pass safe to re-run against a half-finished previous run.
		const existing = await prisma.companies.findFirst({
			where: { app_id: group.appId, norm_name: norm },
			select: { id: true },
		})

		let companyId: string
		if (existing) {
			companyId = existing.id
			reused++
		} else {
			const row = await prisma.companies.create({
				data: { app_id: group.appId, name: group.display, norm_name: norm },
				select: { id: true },
			})
			companyId = row.id
			created++
		}

		const result = await prisma.contacts.updateMany({
			where: { id: { in: group.ids } },
			data: { company_id: companyId, updated_at: new Date() },
		})
		linked += result.count
	}

	console.log(`\nPerusahaan baru: ${created}`)
	console.log(`Perusahaan dipakai ulang: ${reused}`)
	console.log(`Kontak ditautkan: ${linked}`)

	console.log('\n--- hasil ---')
	const rows = await prisma.$queryRawUnsafe<Array<{ nama: string; jumlah: bigint }>>(`
		SELECT co.name AS nama, COUNT(c.id) AS jumlah
		FROM companies co
		LEFT JOIN contacts c ON c.company_id = co.id AND c.deleted_at IS NULL
		WHERE co.deleted_at IS NULL
		GROUP BY co.id, co.name ORDER BY 2 DESC, 1
	`)
	for (const row of rows) console.log(`  ${String(row.jumlah).padStart(4)}  ${row.nama}`)

	const orphan = await prisma.$queryRawUnsafe<Array<{ jumlah: bigint }>>(`
		SELECT COUNT(*) AS jumlah FROM contacts
		WHERE deleted_at IS NULL AND btrim(coalesce(company, '')) <> '' AND company_id IS NULL
	`)
	const stranded = Number(orphan[0]?.jumlah || 0)
	if (stranded > 0) {
		console.log(`\nPERHATIAN: ${stranded} kontak punya teks company tapi belum tertaut — periksa manual.`)
	}
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
