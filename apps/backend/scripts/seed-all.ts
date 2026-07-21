/**
 * Bring an empty environment up to the state this project expects.
 *
 * Runs every seed in dependency order, stopping at the first failure. Each step
 * is idempotent on its own, so this is safe to re-run: it tops up what is
 * missing rather than duplicating what is there.
 *
 *   bun run scripts/seed-all.ts --dry-run   # print the plan, change nothing
 *   bun run scripts/seed-all.ts
 *
 * WHAT THIS DOES NOT DO
 *
 * It does not copy conversations, messages, or the contacts that came from
 * WhatsApp. Those are real customers: their names, phone numbers and message
 * history. Reproducing them from a script in this repository would put that
 * history into version control, where it stays for everyone who ever clones it.
 * If production genuinely needs the existing history, move it with pg_dump
 * between databases, not through git.
 *
 * It also does not copy logins. Each seed creates its accounts with a password
 * from the environment (SIM_PASSWORD / SEED_CEO_PASSWORD), so production sets
 * its own rather than inheriting whatever local uses.
 */
const dryRun = process.argv.includes('--dry-run')

type Step = {
	script: string
	label: string
	/** Passed through only when the script understands it. */
	supportsDryRun: boolean
}

/**
 * Order is dependency order, not importance:
 * accounts and teams have to exist before anything can be assigned to them,
 * stages before rows are filed onto them, and companies before the contacts
 * that point at them.
 */
const STEPS: Step[] = [
	{ script: 'seed-dev-users.ts', label: 'App, organisasi, dan akun dasar', supportsDryRun: false },
	{ script: 'seed-sim-sales.ts', label: 'Akun sales dan tim (AEC, MFG)', supportsDryRun: false },
	{ script: 'seed-ceo.ts', label: 'Akun CEO', supportsDryRun: false },
	{
		script: 'seed-org-structure.ts',
		label: 'Struktur peran: administrator, leader per tim',
		supportsDryRun: false,
	},
	{
		script: 'migrate-deal-stages.ts',
		label: 'Stage deal ke penamaan sekarang (no-op di database baru)',
		supportsDryRun: true,
	},
	{
		script: 'seed-contact-stages.ts',
		label: 'Status kontak: urutan corong dan status awal',
		supportsDryRun: true,
	},
	{
		script: 'seed-knowledge-products.ts',
		label: 'Knowledge base produk untuk AI',
		supportsDryRun: false,
	},
	{ script: 'seed-sales-profiles.ts', label: 'Profil sales', supportsDryRun: true },
	{
		script: 'seed-demo-deals.ts',
		// No --dry-run of its own. It would ignore the flag and write, which is
		// the one thing --dry-run must never do, so it is described and skipped.
		label: 'Perusahaan, kontak, dan deal contoh (papan Sales)',
		supportsDryRun: false,
	},
	{ script: 'seed-leads-pipeline.ts', label: 'Lead contoh (papan Leads)', supportsDryRun: true },
	{
		script: 'classify-company-type.ts',
		label: 'Tandai perusahaan yang sebenarnya perorangan',
		supportsDryRun: true,
	},
]

async function main() {
	console.log(
		dryRun
			? `Rencana ${STEPS.length} langkah. Tidak ada yang diubah.\n`
			: `Menjalankan ${STEPS.length} langkah.\n`,
	)

	for (const [index, step] of STEPS.entries()) {
		const position = `[${index + 1}/${STEPS.length}]`
		console.log(`${position} ${step.label}`)
		console.log(`        ${step.script}`)

		// A script that cannot dry-run is described but not executed, so --dry-run
		// never writes anything anywhere.
		if (dryRun && !step.supportsDryRun) {
			console.log('        (tidak mendukung --dry-run, dilewati)\n')
			continue
		}

		const args = ['bun', 'run', `scripts/${step.script}`]
		if (dryRun) args.push('--dry-run')

		const proc = Bun.spawnSync(args, {
			cwd: new URL('..', import.meta.url).pathname,
			stdout: 'pipe',
			stderr: 'pipe',
		})

		const out = new TextDecoder().decode(proc.stdout).trim()
		const err = new TextDecoder().decode(proc.stderr).trim()
		if (out) console.log(out.split('\n').map((line) => `        ${line}`).join('\n'))

		if (proc.exitCode !== 0) {
			// Stop rather than continue: a later step almost always depends on an
			// earlier one, so carrying on turns one clear failure into several
			// confusing ones.
			console.error(`\n${position} GAGAL (exit ${proc.exitCode})`)
			if (err) console.error(err)
			process.exit(1)
		}
		console.log('')
	}

	console.log(
		dryRun
			? 'Rencana selesai. Jalankan tanpa --dry-run untuk menerapkannya.'
			: 'Selesai. Semua langkah berhasil.',
	)
	console.log(
		'\nCatatan: percakapan dan pesan WhatsApp yang sudah ada TIDAK ikut. Itu data\n' +
			'pelanggan asli dan dipindahkan dengan pg_dump antar database, bukan lewat repo.',
	)
}

main().catch((error) => {
	console.error(error)
	process.exit(1)
})
