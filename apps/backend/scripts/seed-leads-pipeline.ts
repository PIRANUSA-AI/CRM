/**
 * Demo data for the Leads board.
 *
 * The Leads pipeline tracks whether a lead has been picked up, not how likely
 * it is to close, so these deals carry no value: a number there would feed the
 * TOTAL row a figure that means nothing on this board. The Sales board keeps
 * the money.
 *
 * Everything it writes is marked `source = 'demo-leads'` and comes back out
 * with --remove. Idempotent: contacts are matched on phone number, so
 * re-running tops up what is missing rather than creating a second copy.
 *
 *   bun run scripts/seed-leads-pipeline.ts --dry-run
 *   bun run scripts/seed-leads-pipeline.ts
 *   bun run scripts/seed-leads-pipeline.ts --remove
 */
import prisma from '../src/lib/prisma'
import { resolveCompany } from '../src/lib/company'
import { setContactOwner } from '../src/lib/contact-ownership'
import { resolveStage } from '../src/modules/opportunities/stages'

const SOURCE = 'demo-leads'
const dryRun = process.argv.includes('--dry-run')
const remove = process.argv.includes('--remove')

type Lead = {
	contact: string
	phone: string
	company: string | null
	city: string | null
	/** Email local part of the sales who owns it, or null for an unassigned lead. */
	owner: string | null
	deal: string
	stage: string
	daysInStage: number
}

/**
 * Spread across every column so the board reads as a board rather than one
 * full column and six empty ones. New Leads has no owner on purpose: that is
 * what "nobody has picked this up" looks like.
 */
const LEADS: Lead[] = [
	{
		contact: 'Rangga Aditya',
		phone: '628121000101',
		company: 'PT Cipta Ruang Selaras',
		city: 'Jakarta Pusat',
		owner: null,
		deal: 'Tanya harga Archicad',
		stage: 'leads_new',
		daysInStage: 1,
	},
	{
		contact: 'Melati Sari',
		phone: '628121000102',
		company: null,
		city: 'Depok',
		owner: null,
		deal: 'Minta demo ZWCAD',
		stage: 'leads_new',
		daysInStage: 2,
	},
	{
		contact: 'Bayu Nugroho',
		phone: '628121000103',
		company: 'CV Karya Baja Sentosa',
		city: 'Bekasi',
		owner: null,
		deal: 'Tanya lisensi ZW3D',
		stage: 'leads_new',
		daysInStage: 4,
	},
	{
		contact: 'Indra Permana',
		phone: '628121000104',
		company: 'PT Adhi Konstruksi Prima',
		city: 'Surabaya',
		owner: 'deska',
		deal: 'Archicad untuk tim BIM',
		stage: 'leads_assigned',
		daysInStage: 1,
	},
	{
		contact: 'Sari Wulandari',
		phone: '628121000105',
		company: 'Universitas Teknologi Bandung',
		city: 'Bandung',
		owner: 'nurhayati',
		deal: 'Lisensi pendidikan Archicad',
		stage: 'leads_assigned',
		daysInStage: 3,
	},
	{
		contact: 'Hendro Susanto',
		phone: '628121000106',
		company: 'PT Logam Jaya Perkasa',
		city: 'Karawang',
		owner: 'yoel',
		deal: 'ZWCAD 10 seat, menunggu kabar',
		stage: 'leads_pending',
		daysInStage: 12,
	},
	{
		contact: 'Fitria Ramadhani',
		phone: '628121000107',
		company: 'Studio Arsitek Ruang Temu',
		city: 'Yogyakarta',
		owner: 'titin',
		deal: 'Konsultasi kebutuhan software',
		stage: 'leads_open',
		daysInStage: 5,
	},
	{
		contact: 'Doni Kurniawan',
		phone: '628121000108',
		company: 'PT Presisi Mesin Nusantara',
		city: 'Tangerang',
		owner: 'fathur',
		deal: 'Evaluasi ZW3D untuk QC',
		stage: 'leads_progress',
		daysInStage: 8,
	},
	{
		contact: 'Ayunda Puspita',
		phone: '628121000109',
		company: 'CV Interior Rasa Rumah',
		city: 'Semarang',
		owner: 'titin',
		deal: 'SketchUp 2 seat',
		stage: 'leads_progress',
		daysInStage: 2,
	},
	{
		contact: 'Wahyu Setiadi',
		phone: '628121000110',
		company: 'PT Baja Presisi Utama',
		city: 'Bekasi',
		owner: 'yoel',
		deal: 'Konfirmasi tambahan 4 seat ZWCAD',
		stage: 'leads_confirmed',
		daysInStage: 6,
	},
	{
		contact: 'Rina Oktaviani',
		phone: '628121000111',
		company: 'PT Swadaya Cipta',
		city: 'Jakarta Selatan',
		owner: 'deska',
		deal: 'Konfirmasi training Archicad',
		stage: 'leads_confirmed',
		daysInStage: 14,
	},
	{
		contact: 'Galih Pratama',
		phone: '628121000112',
		company: null,
		city: 'Malang',
		owner: 'fathur',
		deal: 'Batal, pakai software lain',
		stage: 'leads_cancelled',
		daysInStage: 21,
	},
]

const ALL_PHONES = LEADS.map((lead) => lead.phone)

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
		const ids = contacts.map((row) => row.id)
		const deals = await prisma.opportunities.deleteMany({
			where: { app_id: appId, source: SOURCE },
		})
		await prisma.tasks.deleteMany({ where: { contact_id: { in: ids } } })
		await prisma.contacts.deleteMany({ where: { id: { in: ids } } })
		console.log(`dihapus: ${deals.count} deal, ${ids.length} kontak`)
		return
	}

	const owners = [...new Set(LEADS.map((lead) => lead.owner).filter(Boolean))] as string[]
	const users = await prisma.users.findMany({
		where: { email: { in: owners.map((name) => `${name}@piranusa.com`) } },
		select: { id: true, email: true },
	})
	const userByKey = new Map(users.map((user) => [user.email.split('@')[0], user.id]))
	for (const key of owners) {
		if (!userByKey.has(key)) throw new Error(`Sales ${key}@piranusa.com tidak ditemukan`)
	}

	let madeContacts = 0
	let madeDeals = 0

	for (const lead of LEADS) {
		const companyId = lead.company
			? await resolveCompany(prisma, { appId, name: lead.company, city: lead.city })
			: null

		const existing = await prisma.contacts.findFirst({
			where: { app_id: appId, phone_number: lead.phone },
			select: { id: true },
		})

		const contactData = {
			name: lead.contact,
			phone_number: lead.phone,
			whatsapp_id: lead.phone,
			city: lead.city,
			company: lead.company,
			company_id: companyId,
			source: SOURCE,
			last_activity_at: daysAgo(lead.daysInStage),
		}

		if (dryRun) {
			console.log(`  ${lead.contact} -> ${lead.stage} (${lead.owner ?? 'belum ditugaskan'})`)
			continue
		}

		const contactId = existing
			? (await prisma.contacts.update({ where: { id: existing.id }, data: contactData })).id
			: (await prisma.contacts.create({ data: { app_id: appId, ...contactData } })).id
		if (!existing) madeContacts += 1

		// A lead sitting in New Leads has no owner yet, which is the whole point of
		// that column. setContactOwner accepts null and clears the team with it.
		const ownerId = lead.owner ? userByKey.get(lead.owner)! : null
		await setContactOwner(prisma, { contactId, ownerId })
		const owned = await prisma.contacts.findUnique({
			where: { id: contactId },
			select: { team_id: true },
		})

		const already = await prisma.opportunities.findFirst({
			where: { app_id: appId, contact_id: contactId, name: lead.deal },
			select: { id: true },
		})
		if (already) continue

		const stage = resolveStage(lead.stage)
		await prisma.opportunities.create({
			data: {
				app_id: appId,
				contact_id: contactId,
				owner_id: ownerId,
				team_id: owned?.team_id ?? null,
				name: lead.deal,
				// No value: this board is about whether anyone has picked the lead up.
				value: null,
				currency: 'IDR',
				status: stage.status,
				stage: stage.id,
				probability: 0,
				source: SOURCE,
				stage_changed_at: daysAgo(lead.daysInStage),
				created_at: daysAgo(lead.daysInStage + 3),
				closed_at: stage.status === 'open' ? null : daysAgo(lead.daysInStage),
			},
		})
		madeDeals += 1
	}

	console.log(
		`\n${dryRun ? '[dry-run] ' : ''}${madeContacts} kontak baru, ${madeDeals} lead baru di papan Leads.`,
	)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
