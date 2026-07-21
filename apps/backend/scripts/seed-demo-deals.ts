/**
 * Demo data for Company -> Contact -> Deal.
 *
 * The three exist and are wired together in the schema, but the data never
 * showed it: every company had exactly one contact, and every deal was worth
 * zero. So the company page could not demonstrate the thing it was built for
 * (one firm, several PIC, one combined value) and the board's TOTAL row read
 * Rp 0 in every column.
 *
 * This seeds a small, coherent set instead of bulk noise: five firms, two or
 * three PIC each, and deals spread across the stages and across both teams so
 * role scoping is visible too — a sales sees their own, a leader their team's.
 *
 * Everything it writes is marked `source = 'demo-seed'` and is removable:
 *
 *   bun run scripts/seed-demo-deals.ts            # create / top up
 *   bun run scripts/seed-demo-deals.ts --remove   # take it all back out
 *
 * Idempotent: contacts are matched on phone number, so re-running tops up what
 * is missing rather than creating a second copy.
 */
import prisma from '../src/lib/prisma'
import { resolveCompany } from '../src/lib/company'
import { setContactOwner } from '../src/lib/contact-ownership'
import { resolveStage } from '../src/modules/opportunities/stages'

const SOURCE = 'demo-seed'
const remove = process.argv.includes('--remove')

type SeedContact = {
	name: string
	role: string
	phone: string
	email: string
	/** Email local part of the sales who owns this contact. */
	owner: string
	deals: Array<{ name: string; product: string; value: number; stage: string; daysInStage: number }>
}

type SeedCompany = {
	name: string
	city: string
	website: string
	notes: string
	contacts: SeedContact[]
}

/**
 * Firms are split across the two teams on purpose: AEC sells Archicad to
 * architects, MFG sells ZWCAD to manufacturers, and the demo is only honest if
 * a leader opening the board sees their own team and not the other one.
 */
const COMPANIES: SeedCompany[] = [
	{
		name: 'PT Swadaya Cipta',
		city: 'Jakarta Selatan',
		website: 'https://www.swadayacipta.com',
		notes: 'Konsultan arsitektur. Sudah pakai Archicad 3 seat, sedang menimbang tambah lisensi untuk tim drafter.',
		contacts: [
			{
				name: 'Wafa Nuraini',
				role: 'Procurement',
				phone: '628233055771',
				email: 'wafa@swadayacipta.com',
				owner: 'deska',
				deals: [
					{ name: 'Archicad 28 — tambah 5 seat', product: 'Archicad 28 Solo', value: 196_000_000, stage: 'negotiation_po', daysInStage: 6 },
				],
			},
			{
				name: 'Bagus Prakoso',
				role: 'Principal Architect',
				phone: '628233055772',
				email: 'bagus@swadayacipta.com',
				owner: 'deska',
				deals: [
					{ name: 'Archicad — training tim desain', product: 'Training on-site', value: 24_500_000, stage: 'budget_timeframe', daysInStage: 11 },
				],
			},
			{
				name: 'Rani Kusumawardani',
				role: 'Drafter Lead',
				phone: '628233055773',
				email: 'rani@swadayacipta.com',
				owner: 'titin',
				deals: [
					{ name: 'Twinmotion — 3 seat', product: 'Twinmotion', value: 18_900_000, stage: 'product_demo', daysInStage: 3 },
				],
			},
		],
	},
	{
		name: 'PT Graha Karya Arsitektur',
		city: 'Bandung',
		website: 'https://grahakarya.co.id',
		notes: 'Proyek rumah sakit dan kampus. Kompetitor menawarkan Revit, sensitif di harga.',
		contacts: [
			{
				name: 'Hendra Wijaya',
				role: 'Direktur',
				phone: '628221144001',
				email: 'hendra@grahakarya.co.id',
				owner: 'deska',
				deals: [
					{ name: 'Archicad 28 — 8 seat', product: 'Archicad 28 Full', value: 312_000_000, stage: 'valid_opportunity', daysInStage: 19 },
				],
			},
			{
				name: 'Sinta Maharani',
				role: 'BIM Coordinator',
				phone: '628221144002',
				email: 'sinta@grahakarya.co.id',
				owner: 'titin',
				deals: [
					{ name: 'BIMcloud — setup server', product: 'BIMcloud Basic', value: 87_500_000, stage: 'initial_quotation', daysInStage: 4 },
				],
			},
		],
	},
	{
		name: 'CV Rancang Ruang Nusantara',
		city: 'Surabaya',
		website: 'https://rancangruang.id',
		notes: 'Studio kecil, 6 orang. Masuk dari pameran Surabaya Build Expo.',
		contacts: [
			{
				name: 'Dimas Anggara',
				role: 'Owner',
				phone: '628315577010',
				email: 'dimas@rancangruang.id',
				owner: 'titin',
				deals: [
					{ name: 'Archicad Solo — 2 seat', product: 'Archicad 28 Solo', value: 78_400_000, stage: 'won', daysInStage: 22 },
				],
			},
			{
				name: 'Ayu Lestari',
				role: 'Arsitek',
				phone: '628315577011',
				email: 'ayu@rancangruang.id',
				owner: 'titin',
				deals: [
					{ name: 'Perpanjangan maintenance', product: 'SSA 1 tahun', value: 15_600_000, stage: 'leads_generation', daysInStage: 2 },
				],
			},
		],
	},
	{
		name: 'PT Baja Presisi Utama',
		city: 'Bekasi',
		website: 'https://bajapresisi.com',
		notes: 'Fabrikasi baja. 24 workstation, sebagian masih AutoCAD bajakan — target konversi lisensi resmi.',
		contacts: [
			{
				name: 'Yusuf Maulana',
				role: 'Manager Engineering',
				phone: '628119922301',
				email: 'yusuf@bajapresisi.com',
				owner: 'yoel',
				deals: [
					{ name: 'ZWCAD 2026 — 24 seat', product: 'ZWCAD 2026 Professional', value: 447_600_000, stage: 'negotiation_po', daysInStage: 9 },
				],
			},
			{
				name: 'Ratna Dewi',
				role: 'Purchasing',
				phone: '628119922302',
				email: 'ratna@bajapresisi.com',
				owner: 'yoel',
				deals: [
					{ name: 'ZWCAD — perpanjangan 6 seat', product: 'ZWCAD SSA', value: 52_800_000, stage: 'budget_timeframe', daysInStage: 16 },
				],
			},
			{
				name: 'Agung Setiawan',
				role: 'Drafter Senior',
				phone: '628119922303',
				email: 'agung@bajapresisi.com',
				owner: 'fathur',
				deals: [
					{ name: 'ZW3D — evaluasi 2 seat', product: 'ZW3D Professional', value: 63_200_000, stage: 'pending', daysInStage: 27 },
				],
			},
		],
	},
	{
		name: 'PT Mitra Teknik Manufaktur',
		city: 'Tangerang',
		website: 'https://mitrateknik.co.id',
		notes: 'Komponen otomotif. Sudah demo ZW3D, menunggu approval budget kuartal depan.',
		contacts: [
			{
				name: 'Bambang Sudarso',
				role: 'Plant Manager',
				phone: '628177340055',
				email: 'bambang@mitrateknik.co.id',
				owner: 'fathur',
				deals: [
					{ name: 'ZW3D — lini produksi baru', product: 'ZW3D Premium', value: 268_000_000, stage: 'product_demo', daysInStage: 7 },
				],
			},
			{
				name: 'Citra Paramita',
				role: 'Procurement Officer',
				phone: '628177340056',
				email: 'citra@mitrateknik.co.id',
				owner: 'fathur',
				deals: [
					{ name: 'ZWCAD Mechanical — 4 seat', product: 'ZWCAD Mechanical', value: 71_200_000, stage: 'lost', daysInStage: 34 },
				],
			},
		],
	},
]

const ALL_PHONES = COMPANIES.flatMap((c) => c.contacts.map((p) => p.phone))
const ALL_COMPANY_NAMES = COMPANIES.map((c) => c.name)

function daysAgo(days: number): Date {
	return new Date(Date.now() - days * 86_400_000)
}

async function main() {
	const app = await prisma.apps.findFirst({ select: { id: true } })
	if (!app) throw new Error('App tidak ditemukan')
	const appId = app.id

	if (remove) {
		const contacts = await prisma.contacts.findMany({
			where: { app_id: appId, phone_number: { in: ALL_PHONES } },
			select: { id: true },
		})
		const contactIds = contacts.map((c) => c.id)
		const deals = await prisma.opportunities.deleteMany({
			where: { app_id: appId, source: SOURCE },
		})
		await prisma.tasks.deleteMany({ where: { contact_id: { in: contactIds } } })
		await prisma.contacts.deleteMany({ where: { id: { in: contactIds } } })
		// Companies are only removed when nothing else moved in behind the demo
		// contacts — a real contact that happens to work at one of these firms
		// must not lose its company row.
		let companiesRemoved = 0
		for (const name of ALL_COMPANY_NAMES) {
			const company = await prisma.companies.findFirst({
				where: { app_id: appId, name },
				select: { id: true, _count: { select: { contacts: true } } },
			})
			if (company && company._count.contacts === 0) {
				await prisma.companies.delete({ where: { id: company.id } })
				companiesRemoved += 1
			}
		}
		console.log(
			`dihapus: ${deals.count} deal, ${contactIds.length} kontak, ${companiesRemoved} perusahaan`,
		)
		return
	}

	const salesEmails = [...new Set(COMPANIES.flatMap((c) => c.contacts.map((p) => p.owner)))]
	const users = await prisma.users.findMany({
		where: { email: { in: salesEmails.map((e) => `${e}@piranusa.com`) } },
		select: { id: true, email: true, name: true },
	})
	const userByKey = new Map(users.map((u) => [u.email.split('@')[0], u]))
	for (const key of salesEmails) {
		if (!userByKey.has(key)) throw new Error(`Sales ${key}@piranusa.com tidak ditemukan`)
	}

	let madeCompanies = 0
	let madeContacts = 0
	let madeDeals = 0

	for (const company of COMPANIES) {
		const companyId = await resolveCompany(prisma, {
			appId,
			name: company.name,
			city: company.city,
		})
		if (!companyId) throw new Error(`Gagal membuat perusahaan ${company.name}`)
		// resolveCompany only fills name/city, so the fields the detail page shows
		// beneath the heading are set here.
		await prisma.companies.update({
			where: { id: companyId },
			data: { city: company.city, website: company.website, notes: company.notes },
		})
		madeCompanies += 1

		for (const person of company.contacts) {
			const owner = userByKey.get(person.owner)!
			const existing = await prisma.contacts.findFirst({
				where: { app_id: appId, phone_number: person.phone },
				select: { id: true },
			})

			const contactData = {
				name: person.name,
				email: person.email,
				phone_number: person.phone,
				whatsapp_id: person.phone,
				city: company.city,
				company: company.name,
				company_id: companyId,
				source: SOURCE,
				// Drives "Aktivitas Terakhir" on the company list, which otherwise
				// reads "Belum ada aktivitas" for every row.
				last_activity_at: daysAgo(Math.max(1, person.deals[0]?.daysInStage ?? 5)),
			}

			const contactId = existing
				? (await prisma.contacts.update({ where: { id: existing.id }, data: contactData })).id
				: (await prisma.contacts.create({ data: { app_id: appId, ...contactData } })).id
			if (!existing) madeContacts += 1

			// Ownership goes through the single writer rather than being set in the
			// data above, so team_id is derived the same way every other path does
			// it and cannot drift from contacts.owner_id.
			await setContactOwner(prisma, { contactId, ownerId: owner.id })
			const owned = await prisma.contacts.findUnique({
				where: { id: contactId },
				select: { team_id: true },
			})

			for (const deal of person.deals) {
				const already = await prisma.opportunities.findFirst({
					where: { app_id: appId, contact_id: contactId, name: deal.name },
					select: { id: true },
				})
				if (already) continue

				const stage = resolveStage(deal.stage)
				await prisma.opportunities.create({
					data: {
						app_id: appId,
						contact_id: contactId,
						owner_id: owner.id,
						team_id: owned?.team_id ?? null,
						name: deal.name,
						product: deal.product,
						value: deal.value,
						currency: 'IDR',
						status: stage.status,
						stage: stage.id,
						probability: stage.probability ?? 40,
						source: SOURCE,
						// Spread out so the board shows a real range of staleness —
						// including a couple past the 14-day mark that turns amber.
						stage_changed_at: daysAgo(deal.daysInStage),
						created_at: daysAgo(deal.daysInStage + 14),
						closed_at: stage.status === 'open' ? null : daysAgo(deal.daysInStage),
					},
				})
				madeDeals += 1
			}
		}
	}

	console.log(
		`${madeCompanies} perusahaan disiapkan, ${madeContacts} kontak baru, ${madeDeals} deal baru`,
	)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
