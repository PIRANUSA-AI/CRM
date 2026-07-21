// Seed product knowledge (CAD/CAE/CAM/3D scanning) into the knowledge base so it
// shows on the leader /knowledge page AND powers the AI auto-reply RAG.
// Idempotent: re-running replaces the seeded sources + FAQs (marked via metadata
// / a keyword tag). Safe to run multiple times.
import prisma from '../src/lib/prisma'

const APP_ID = process.env.SEED_APP_ID || '1713b2f2-0931-45ef-b386-b65799c588fd'
const SEED_TAG = 'seed:product-catalog'
const FAQ_MARKER = '__seed_product_catalog'

type Product = {
	title: string
	summary: string
	keywords: string[]
	chunks: { label: string; text: string }[]
}

const PRODUCTS: Product[] = [
	{
		title: 'ZWCAD: CAD 2D/3D (kompatibel DWG)',
		summary:
			'Software drafting/CAD 2D (dengan sebagian kemampuan 3D) berbasis DWG. Alternatif AutoCAD yang hemat biaya, lisensi perpetual (beli putus).',
		keywords: ['zwcad', 'zw cad', 'cad murah', 'alternatif autocad', 'dwg', 'gambar 2d', 'drafting', 'cad 2d'],
		chunks: [
			{ label: 'ZWCAD: Ringkasan', text: 'ZWCAD adalah software CAD 2D (dengan sebagian kemampuan 3D) berbasis format DWG. Posisi jual: alternatif AutoCAD yang lebih hemat biaya, kompatibilitas tinggi dengan DWG/DXF/DWT, dan lisensi perpetual (beli putus), pembeda utama dibanding kompetitor berlangganan.' },
			{ label: 'ZWCAD: Edisi', text: 'Edisi ZWCAD: (1) Standard untuk kebutuhan drafting 2D esensial; (2) Professional untuk 2D lengkap plus kustomisasi/API (LISP, .NET) dan tampilan 2D dari model 3D; (3) MFG (Manufacturing) yaitu Professional plus alat mekanikal kompatibel AutoCAD Mechanical (frame, title block, balloon, part reference, BOM, simbol mekanikal).' },
			{ label: 'ZWCAD: Lisensi', text: 'Model lisensi ZWCAD: perpetual standalone (beli putus), network license (NLM) untuk berbagi lisensi dalam satu jaringan, serta ZWCAD Flex sebagai opsi berlangganan. Untuk kebutuhan banyak seat/volume arahkan ke penawaran khusus tim sales.' },
			{ label: 'ZWCAD: Target & pertanyaan umum', text: 'Target: AEC (arsitektur, sipil, konstruksi), manufaktur, kontraktor, konsultan, drafter, kampus. Pertanyaan beli umum: beda Standard vs Professional vs MFG, kompatibilitas dengan AutoCAD, lisensi jaringan/berapa seat, harga volume, perpetual vs langganan.' },
		],
	},
	{
		title: 'ZW3D: CAD + CAM + CAE terintegrasi',
		summary:
			'Software 3D all-in-one: desain produk 3D, CAM (machining), dan CAE dalam satu paket. Dari konsep hingga manufaktur. Lisensi perpetual + maintenance.',
		keywords: ['zw3d', 'zw 3d', 'cad cam', 'cam', 'mold design', 'desain cetakan', 'machining', 'cnc', '3d modeling'],
		chunks: [
			{ label: 'ZW3D: Ringkasan', text: 'ZW3D adalah software 3D all-in-one yang menggabungkan desain produk 3D, CAM (machining), dan CAE dalam satu paket. Posisi jual: solusi tunggal dari konsep, desain, simulasi, hingga manufaktur; hemat karena CAD dan CAM menyatu.' },
			{ label: 'ZW3D: Modul', text: 'Modul utama ZW3D: desain part & assembly, sheet metal, reverse engineering, mold design (desain cetakan), CAM/CNC machining 2–5 axis. Versi terbaru menambah simulasi CFD dan PDM (ZWTeammate).' },
			{ label: 'ZW3D: Varian & lisensi', text: 'ZW3D tersedia beberapa tingkat, dari 3D modeling dasar hingga mold design lanjutan plus machining terintegrasi (pilih sesuai kompleksitas workflow dan budget). Model lisensi: perpetual plus maintenance 1 tahun.' },
			{ label: 'ZW3D: Target & pertanyaan umum', text: 'Target: manufaktur, permesinan, fabrikasi, cetakan/mold, otomotif, produk consumer. Pertanyaan beli umum: apakah ZW3D bisa CAM sekalian, dukungan mold design, jumlah axis machining, reverse engineering dari hasil scan, versi mana yang cocok.' },
		],
	},
	{
		title: 'SketchUp: Desain 3D (arsitektur & interior)',
		summary:
			'Software modeling 3D yang mudah dipakai, populer untuk arsitektur, interior, dan woodworking. Edisi Free/Go/Pro/Studio, berlangganan.',
		keywords: ['sketchup', 'sketch up', 'su pro', 'desain 3d arsitektur', 'interior 3d', 'layout', 'v-ray'],
		chunks: [
			{ label: 'SketchUp: Ringkasan', text: 'SketchUp adalah software modeling 3D yang mudah dipakai dan populer untuk arsitektur, interior, dan woodworking. Terkenal karena kurva belajar yang cepat.' },
			{ label: 'SketchUp: Edisi', text: 'Edisi SketchUp: Free (web dasar, gratis); Go (web + aplikasi iPad, berlangganan); Pro (desktop fitur penuh termasuk LayOut untuk dokumentasi); Studio (paling lengkap, Windows, termasuk Scan Essentials point cloud dan V-Ray untuk rendering).' },
			{ label: 'SketchUp: Lisensi & target', text: 'Model lisensi SketchUp: berlangganan (bulanan/tahunan). Target: arsitek, desainer interior, kontraktor, woodworking, event/booth. Pertanyaan umum: beda Pro vs Studio, bisa rendering (V-Ray), versi iPad, langganan tahunan, harga edukasi.' },
		],
	},
	{
		title: 'Ansys: Simulasi engineering (CAE)',
		summary:
			'Suite simulasi engineering multiphysics: struktur (FEA), fluida (CFD), elektronik, dll. Produk inti Mechanical, Fluent, Discovery.',
		keywords: ['ansys', 'simulasi', 'fea', 'cfd', 'analisa struktur', 'fluent', 'mechanical', 'simulation'],
		chunks: [
			{ label: 'Ansys: Ringkasan', text: 'Ansys adalah suite simulasi engineering (multiphysics) untuk analisa struktur, fluida, elektronik, optik, dan lainnya. Dipakai untuk memvalidasi desain sebelum produksi.' },
			{ label: 'Ansys: Produk inti', text: 'Produk inti Ansys: Ansys Mechanical (FEA/analisa struktur), Ansys Fluent (CFD/aliran fluida), Ansys Discovery (simulasi awal cepat), dan banyak modul lain.' },
			{ label: 'Ansys: Kemampuan & lisensi', text: 'Kemampuan Ansys: analisa tegangan, getaran, benturan/drop, perpindahan panas, fatigue, aliran fluida. Model lisensi: berlangganan/komersial (bervariasi per modul dan jumlah task); tersedia Ansys Student gratis untuk edukasi.' },
			{ label: 'Ansys: Target & pertanyaan umum', text: 'Target: otomotif, aerospace, energi, elektronik, manufaktur, R&D, kampus/riset. Pertanyaan umum: pilih modul mana (Mechanical/Fluent), simulasi struktur vs CFD, lisensi riset/kampus, kebutuhan hardware.' },
		],
	},
	{
		title: '3D Scanner: SHINING 3D / EinScan',
		summary:
			'Perangkat 3D scanning (handheld & metrologi) plus software. Untuk reverse engineering, QC, 3D printing, medis. Model EinScan Pro 2X, HX/HX2, H/H1.',
		keywords: ['3d scanner', 'scan 3d', 'einscan', 'shining 3d', 'scanology', 'reverse engineering', 'scan objek', 'scan produk'],
		chunks: [
			{ label: '3D Scanner: Ringkasan', text: 'Kami menyediakan 3D scanner (handheld dan metrologi) beserta software pemrosesan, terutama lini SHINING 3D / EinScan. Digunakan untuk reverse engineering, input CAD/CAM, 3D printing, quality control/metrologi, dan healthcare.' },
			{ label: '3D Scanner: Model populer', text: 'Model populer EinScan/SHINING 3D: EinScan Pro 2X V2 (handheld multifungsi, akurasi single-shot hingga ~0.04 mm); EinScan HX/HX2 (cahaya hibrida LED biru + laser biru, HX2 sangat cepat); EinScan H/H1 (LED + inframerah, cocok scan wajah/manusia, ada kamera warna); serta laser handheld metrology presisi tinggi untuk QC.' },
			{ label: '3D Scanner: Kegunaan & target', text: 'Kegunaan: reverse engineering, input untuk CAD/CAM (mis. nyambung ke ZW3D), 3D printing, quality control/metrologi, healthcare. Target: manufaktur, fabrikasi, otomotif, medis/dental, pendidikan, seni/heritage. Catatan: bila customer menyebut "Scanology", perlakukan sebagai minat pada solusi 3D scanning dan arahkan ke model yang cocok.' },
			{ label: '3D Scanner: Pertanyaan umum', text: 'Pertanyaan beli umum: akurasi berapa, ukuran objek yang bisa discan, untuk reverse engineering, hasil bisa masuk ke software CAD, handheld vs desktop, harga unit.' },
		],
	},
	{
		title: 'Archicad: BIM untuk arsitektur (Graphisoft)',
		summary:
			'Software BIM untuk arsitek: desain, dokumentasi, dan visualisasi bangunan dalam satu model. Fitur BIMx untuk presentasi klien. Berlangganan.',
		keywords: ['archicad', 'bim', 'bimx', 'software arsitek', 'rendering arsitektur'],
		chunks: [
			{ label: 'Archicad: Ringkasan', text: 'Archicad (Graphisoft) adalah software BIM (Building Information Modeling) untuk arsitek: desain, dokumentasi, dan visualisasi bangunan dalam satu model informasi.' },
			{ label: 'Archicad: Fitur', text: 'Fitur Archicad: alat native Wall/Window/Roof yang membentuk model informasi bangunan lengkap; BIMx untuk visualisasi 3D interaktif (hyper-model) yang bisa dieksplor klien di mobile/desktop/web; serta rendering dan visualisasi desain.' },
			{ label: 'Archicad: Lisensi & target', text: 'Model lisensi Archicad: berlangganan (mis. paket Archicad Studio). Target: arsitek, biro/konsultan arsitektur, developer, kontraktor desain. Pertanyaan umum: BIM untuk arsitek, BIMx untuk presentasi klien, rendering, lisensi studio/tim, harga edukasi.' },
		],
	},
]

const FAQS: { question: string; answer: string; keywords: string[]; priority: number }[] = [
	{ question: 'Apakah lisensinya perpetual (beli putus) atau berlangganan?', answer: 'ZWCAD dan ZW3D umumnya perpetual (beli putus). SketchUp, Ansys, dan Archicad umumnya berlangganan. Detail dan periode lisensi dikonfirmasi lewat penawaran resmi.', keywords: ['perpetual', 'langganan', 'beli putus', 'subscription', 'lisensi'], priority: 10 },
	{ question: 'Bisa lisensi jaringan / banyak seat?', answer: 'ZWCAD mendukung network license (NLM) untuk berbagi lisensi dalam satu jaringan. Untuk kebutuhan volume/banyak seat, tim sales akan menyiapkan penawaran khusus.', keywords: ['network license', 'nlm', 'banyak seat', 'volume', 'jaringan'], priority: 8 },
	{ question: 'Apakah ZWCAD kompatibel dengan AutoCAD/DWG?', answer: 'Ya, ZWCAD kompatibel dengan format DWG/DXF setara AutoCAD, sehingga file bisa dibuka dan dikerjakan lintas software.', keywords: ['zwcad', 'autocad', 'dwg', 'dxf', 'kompatibel'], priority: 9 },
	{ question: 'Apakah ZW3D bisa sekaligus untuk CAM/machining?', answer: 'Ya, ZW3D adalah solusi all-in-one CAD+CAM+CAE. Modul CAM mendukung machining CNC 2–5 axis, termasuk workflow mold design dan reverse engineering.', keywords: ['zw3d', 'cam', 'machining', 'cnc', 'axis', 'mold'], priority: 8 },
	{ question: 'Beda SketchUp Pro dan Studio?', answer: 'Pro adalah aplikasi desktop fitur penuh termasuk LayOut untuk dokumentasi. Studio (Windows) paling lengkap: menambah Scan Essentials (point cloud) dan V-Ray untuk rendering.', keywords: ['sketchup', 'pro', 'studio', 'v-ray', 'rendering'], priority: 7 },
	{ question: 'Ansys pilih Mechanical atau Fluent?', answer: 'Ansys Mechanical untuk analisa struktur (FEA: tegangan, getaran, fatigue, panas). Ansys Fluent untuk simulasi aliran fluida (CFD). Pilih sesuai jenis simulasi yang dibutuhkan; keduanya bisa dikombinasikan.', keywords: ['ansys', 'mechanical', 'fluent', 'fea', 'cfd', 'simulasi'], priority: 7 },
	{ question: 'Berapa akurasi 3D scanner dan bisa untuk reverse engineering?', answer: 'Akurasi bervariasi per model (mis. EinScan Pro 2X V2 hingga ~0.04 mm). Hasil scan bisa diekspor ke software CAD/CAM (mis. ZW3D) untuk reverse engineering, QC, dan 3D printing. Tim sales membantu memilih model sesuai ukuran objek dan kebutuhan presisi.', keywords: ['3d scanner', 'einscan', 'akurasi', 'reverse engineering', 'qc'], priority: 7 },
	{ question: 'Apa itu BIMx di Archicad?', answer: 'BIMx adalah fitur visualisasi 3D interaktif (hyper-model) dari Archicad yang bisa dieksplor klien di mobile, desktop, atau web, cocok untuk presentasi desain ke klien.', keywords: ['archicad', 'bimx', 'presentasi', 'visualisasi', 'bim'], priority: 6 },
	{ question: 'Apakah ada lisensi edukasi/kampus?', answer: 'Beberapa produk punya opsi edukasi, misalnya Ansys Student gratis dan lisensi pelajar untuk produk tertentu. Ketersediaan dan syaratnya dikonfirmasi ke tim sales.', keywords: ['edukasi', 'kampus', 'pelajar', 'student', 'mahasiswa'], priority: 6 },
	{ question: 'Berapa harganya?', answer: 'Harga bervariasi tergantung produk, edisi, jumlah lisensi, dan periode. Untuk penawaran akurat, tim sales akan menyiapkan quotation resmi sesuai kebutuhan Anda.', keywords: ['harga', 'price', 'quotation', 'penawaran', 'biaya'], priority: 10 },
]

async function main() {
	console.log('Seeding product knowledge for app', APP_ID)

	// Clean up previously seeded sources (chunks cascade) + FAQs.
	const oldSources = await prisma.knowledge_sources.findMany({
		where: { app_id: APP_ID, metadata: { path: ['seed'], equals: SEED_TAG } },
		select: { id: true },
	})
	if (oldSources.length) {
		await prisma.knowledge_sources.deleteMany({ where: { id: { in: oldSources.map((s) => s.id) } } })
		console.log('Removed old seeded sources:', oldSources.length)
	}
	const removedFaqs = await prisma.knowledge_faqs.deleteMany({
		where: { app_id: APP_ID, keywords: { has: FAQ_MARKER } },
	})
	if (removedFaqs.count) console.log('Removed old seeded FAQs:', removedFaqs.count)

	let sourceCount = 0
	let chunkCount = 0
	for (const product of PRODUCTS) {
		const source = await prisma.knowledge_sources.create({
			data: {
				app_id: APP_ID,
				title: product.title,
				content: product.summary + '\n\n' + product.chunks.map((c) => c.text).join('\n\n'),
				type: 'text',
				format: 'text',
				source_type: 'manual',
				status: 'ready',
				is_active: true,
				chunk_count: product.chunks.length,
				embedding_model: 'text-embedding-3-small',
				metadata: { seed: SEED_TAG, tags: [], keywords: product.keywords },
			},
		})
		sourceCount += 1
		for (let i = 0; i < product.chunks.length; i += 1) {
			const chunk = product.chunks[i]
			await prisma.knowledge_chunks.create({
				data: {
					app_id: APP_ID,
					source_id: source.id,
					chunk_index: i,
					chunk_text: chunk.text,
					locator_label: chunk.label,
					char_count: chunk.text.length,
					token_count: Math.ceil(chunk.text.length / 4),
					embedding_model: 'text-embedding-3-small',
				},
			})
			chunkCount += 1
		}
	}

	let faqCount = 0
	for (const faq of FAQS) {
		await prisma.knowledge_faqs.create({
			data: {
				app_id: APP_ID,
				question: faq.question,
				answer: faq.answer,
				keywords: [...faq.keywords, FAQ_MARKER],
				priority: faq.priority,
				is_active: true,
			},
		})
		faqCount += 1
	}

	console.log(`Done: ${sourceCount} sources, ${chunkCount} chunks, ${faqCount} FAQs.`)
}

main()
	.then(() => process.exit(0))
	.catch((e) => {
		console.error(e)
		process.exit(1)
	})
