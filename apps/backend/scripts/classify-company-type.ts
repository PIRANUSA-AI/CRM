/**
 * Mark the company rows that are not companies.
 *
 * The list was built from whatever people typed into a contact's company field,
 * so it holds occupations as well as firms, "Freelance Arsitek", "Mahasiswa
 * Arsitektur". They are real buyers and must not be deleted, but counting them
 * as corporate accounts overstates how many firms we sell to.
 *
 * Deliberately conservative: it only flags names that say so outright, and
 * prints every decision. Anything ambiguous stays "perusahaan" for a human to
 * correct in the UI, which is cheaper than un-flagging a real firm nobody
 * noticed was mislabelled.
 *
 *   bun run scripts/classify-company-type.ts --dry-run
 *   bun run scripts/classify-company-type.ts
 */
import prisma from '../src/lib/prisma'

const dryRun = process.argv.includes('--dry-run')

/** Words that name a person's role or status rather than an organisation. */
const PERSONAL_MARKERS = [
	'freelance',
	'freelancer',
	'mahasiswa',
	'pelajar',
	'siswa',
	'perorangan',
	'pribadi',
	'individu',
	'personal',
	'sendiri',
]

/** Legal forms. Their presence is decisive evidence of a real firm. */
const CORPORATE_MARKERS = ['pt', 'cv', 'ud', 'pd', 'tbk', 'persero', 'perum', 'koperasi', 'yayasan']

function classify(name: string): 'perusahaan' | 'perorangan' | null {
	const words = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ')
	if (!words.length) return null
	// A firm that happens to employ the word "personal" in its name still has a
	// legal form, so the corporate evidence is checked first.
	if (words.some((word) => CORPORATE_MARKERS.includes(word))) return 'perusahaan'
	if (words.some((word) => PERSONAL_MARKERS.includes(word))) return 'perorangan'
	return null
}

async function main() {
	const companies = await prisma.companies.findMany({
		where: { deleted_at: null },
		select: { id: true, name: true, type: true },
		orderBy: { name: 'asc' },
	})

	const changes: Array<{ id: string; name: string; from: string; to: string }> = []
	const unchanged: string[] = []

	for (const company of companies) {
		const verdict = classify(company.name)
		if (!verdict || verdict === company.type) {
			if (!verdict) unchanged.push(company.name)
			continue
		}
		changes.push({ id: company.id, name: company.name, from: company.type, to: verdict })
	}

	for (const change of changes) {
		console.log(`  ${change.name}: ${change.from} -> ${change.to}`)
		if (!dryRun) {
			await prisma.companies.update({
				where: { id: change.id },
				data: { type: change.to },
			})
		}
	}

	if (unchanged.length) {
		console.log(`\ntidak diputuskan otomatis (tetap "perusahaan"), periksa sendiri bila perlu:`)
		for (const name of unchanged) console.log(`  ${name}`)
	}

	console.log(`\n${dryRun ? '[dry-run] ' : ''}${changes.length} diubah dari ${companies.length} perusahaan.`)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
