/**
 * Demo sales profiles.
 *
 * The routing profile is what the lead router reads to pick who gets a lead,
 * and what a leader reads before handing one over by hand. Five of the eight
 * sales had no profile row at all, so the page that exists to show them had
 * nothing to show.
 *
 * The content is invented, the shape is not: product skills and segments match
 * what PIRANUSA actually sells, and the personas are written the way a leader
 * would describe someone rather than as tags, because the useful part is the
 * part that does not fit a tag.
 *
 * Idempotent, and only fills profiles nobody has saved yet, so a profile edited
 * by hand is never overwritten. Pass --force to rewrite them anyway.
 *
 *   bun run scripts/seed-sales-profiles.ts --dry-run
 *   bun run scripts/seed-sales-profiles.ts
 *   bun run scripts/seed-sales-profiles.ts --force
 */
import prisma from '../src/lib/prisma'

const dryRun = process.argv.includes('--dry-run')
const force = process.argv.includes('--force')

type Seed = {
	email: string
	position: string
	phone: string
	joinedAt: string
	experienceYears: number
	level: string
	maxActive: number
	productSkills: string[]
	segments: string[]
	regions: string[]
	languages: string[]
	tags: string[]
	persona: string
	notes: string
}

const PROFILES: Seed[] = [
	{
		email: 'deska@piranusa.com',
		position: 'Account Executive AEC',
		phone: '628112340001',
		joinedAt: '2023-03-06',
		experienceYears: 4,
		level: 'senior',
		maxActive: 18,
		productSkills: ['Archicad', 'BIMcloud', 'Twinmotion'],
		segments: ['AEC', 'Konsultan'],
		regions: ['Jakarta', 'Bandung'],
		languages: ['Indonesia', 'Inggris'],
		tags: ['tender', 'presentasi'],
		persona:
			'Kuat di akun konsultan besar yang butuh banyak seat. Sabar menghadapi proses tender yang panjang dan terbiasa bicara dengan principal maupun procurement. Cenderung lambat membalas di luar jam kerja, jadi lead yang butuh respons cepat sebaiknya ke orang lain.',
		notes: 'Pegang akun PT Swadaya Cipta dan PT Graha Karya sejak awal.',
	},
	{
		email: 'titin@piranusa.com',
		position: 'Account Executive AEC',
		phone: '628112340002',
		joinedAt: '2024-08-19',
		experienceYears: 2,
		level: 'junior',
		maxActive: 12,
		productSkills: ['Archicad', 'Twinmotion'],
		segments: ['AEC', 'Interior'],
		regions: ['Surabaya', 'Jakarta'],
		languages: ['Indonesia'],
		tags: ['studio-kecil', 'respons-cepat'],
		persona:
			'Paling cepat membalas chat di tim dan enak diajak bicara oleh studio kecil yang baru pertama beli lisensi. Belum terbiasa menangani tender besar, jadi deal di atas seratus juta sebaiknya didampingi Deska.',
		notes: 'Masuk dari program management trainee, sedang dilatih untuk akun korporat.',
	},
	{
		email: 'nurhayati@piranusa.com',
		position: 'Inside Sales AEC',
		phone: '628112340003',
		joinedAt: '2025-02-03',
		experienceYears: 1,
		level: 'junior',
		maxActive: 10,
		productSkills: ['Archicad'],
		segments: ['AEC', 'Pendidikan'],
		regions: ['Jakarta'],
		languages: ['Indonesia'],
		tags: ['inbound', 'edukasi'],
		persona:
			'Menangani lead masuk yang belum jelas kebutuhannya dan menyaring mana yang serius. Cocok untuk kampus dan pembeli perorangan yang butuh banyak penjelasan sebelum memutuskan.',
		notes: 'Baru selesai onboarding produk Archicad.',
	},
	{
		email: 'yoel@piranusa.com',
		position: 'Account Executive MFG',
		phone: '628112340004',
		joinedAt: '2022-11-14',
		experienceYears: 6,
		level: 'senior',
		maxActive: 20,
		productSkills: ['ZWCAD', 'ZW3D', 'ZWCAD Mechanical'],
		segments: ['MFG', 'Fabrikasi'],
		regions: ['Bekasi', 'Karawang', 'Jakarta'],
		languages: ['Indonesia', 'Inggris'],
		tags: ['konversi-lisensi', 'volume'],
		persona:
			'Paling kuat mengurus konversi dari software bajakan ke lisensi resmi, termasuk negosiasi bertahap dengan purchasing pabrik. Terbiasa dengan deal puluhan seat dan tidak gentar dengan proses PO yang berbelit.',
		notes: 'Pegang PT Baja Presisi Utama, deal terbesar tim MFG.',
	},
	{
		email: 'fathur@piranusa.com',
		position: 'Technical Sales MFG',
		phone: '628112340005',
		joinedAt: '2023-09-11',
		experienceYears: 3,
		level: 'menengah',
		maxActive: 14,
		productSkills: ['ZW3D', 'ZWCAD', '3D Scanner'],
		segments: ['MFG', 'Otomotif'],
		regions: ['Tangerang', 'Jakarta'],
		languages: ['Indonesia'],
		tags: ['demo-teknis', 'reverse-engineering'],
		persona:
			'Latar belakang teknik mesin, jadi ia yang memimpin demo ZW3D dan pertanyaan soal reverse engineering atau kompatibilitas file. Lebih nyaman di ruang teknis daripada tawar-menawar harga.',
		notes: 'Selalu dilibatkan kalau calon pembeli minta demo produk.',
	},
	{
		email: 'lukman@piranusa.com',
		position: 'Sales Support',
		phone: '628112340006',
		joinedAt: '2025-06-02',
		experienceYears: 1,
		level: 'junior',
		maxActive: 8,
		productSkills: ['ZWCAD'],
		segments: ['MFG'],
		regions: ['Jakarta'],
		languages: ['Indonesia'],
		tags: ['support', 'belum-ada-tim'],
		persona:
			'Membantu menyiapkan penawaran dan menindaklanjuti perpanjangan maintenance. Belum masuk tim mana pun, jadi belum menerima lead otomatis.',
		notes: 'Perlu ditempatkan ke tim AEC atau MFG sebelum bisa menerima lead.',
	},
	{
		email: 'reza@piranusa.com',
		position: 'Sales Leader AEC',
		phone: '628112340007',
		joinedAt: '2021-05-17',
		experienceYears: 8,
		level: 'lead',
		maxActive: 10,
		productSkills: ['Archicad', 'BIMcloud'],
		segments: ['AEC'],
		regions: ['Jakarta', 'Bandung', 'Surabaya'],
		languages: ['Indonesia', 'Inggris'],
		tags: ['eskalasi', 'harga-khusus'],
		persona:
			'Memimpin tim AEC dan tetap memegang beberapa akun besar sendiri. Turun tangan saat negosiasi harga buntu atau customer minta bicara dengan yang berwenang.',
		notes: 'Kapasitas sengaja rendah karena separuh waktunya untuk memimpin tim.',
	},
	{
		email: 'adi@piranusa.com',
		position: 'Sales Leader MFG',
		phone: '628112340008',
		joinedAt: '2021-08-23',
		experienceYears: 9,
		level: 'lead',
		maxActive: 10,
		productSkills: ['ZWCAD', 'ZW3D'],
		segments: ['MFG', 'Energi'],
		regions: ['Bekasi', 'Cikarang', 'Surabaya'],
		languages: ['Indonesia', 'Inggris'],
		tags: ['eskalasi', 'korporat'],
		persona:
			'Memimpin tim MFG. Paling berpengalaman untuk akun manufaktur besar yang butuh kontrak tahunan dan SLA khusus.',
		notes: 'Biasanya masuk di tahap Negotiation & Waiting PO.',
	},
]

async function main() {
	const app = await prisma.apps.findFirst({ select: { id: true } })
	if (!app) throw new Error('App tidak ditemukan')

	let filled = 0
	let skipped = 0

	for (const seed of PROFILES) {
		const user = await prisma.users.findUnique({
			where: { email: seed.email },
			select: { id: true, name: true },
		})
		if (!user) {
			console.log(`  ${seed.email}: pengguna tidak ada, dilewati`)
			continue
		}

		const existing = await prisma.sales_profiles.findUnique({
			where: { app_id_user_id: { app_id: app.id, user_id: user.id } },
			select: { id: true },
		})
		if (existing && !force) {
			console.log(`  ${user.name}: sudah punya profil, dibiarkan`)
			skipped += 1
			continue
		}

		console.log(`  ${user.name}: ${seed.position}, ${seed.level}, ${seed.experienceYears} tahun`)
		if (dryRun) {
			filled += 1
			continue
		}

		const data = {
			product_skills: seed.productSkills,
			segments: seed.segments,
			level: seed.level,
			max_active: seed.maxActive,
			regions: seed.regions,
			languages: seed.languages,
			tags: seed.tags,
			notes: seed.notes,
			persona: seed.persona,
			experience_years: seed.experienceYears,
			phone: seed.phone,
			position: seed.position,
			joined_at: new Date(seed.joinedAt),
		}
		await prisma.sales_profiles.upsert({
			where: { app_id_user_id: { app_id: app.id, user_id: user.id } },
			create: { app_id: app.id, user_id: user.id, ...data },
			update: data,
		})
		filled += 1
	}

	console.log(`\n${dryRun ? '[dry-run] ' : ''}${filled} profil diisi, ${skipped} dibiarkan.`)
}

main()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(() => prisma.$disconnect())
