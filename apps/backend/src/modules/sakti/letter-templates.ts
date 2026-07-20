/**
 * Surat templates.
 *
 * **Isi surat di bawah ini masih DUMMY.** Strukturnya sudah benar — nomor
 * surat, tanggal, penerima, badan surat, penanda tangan — tapi kalimatnya perlu
 * diganti dengan redaksi resmi PIRANUSA sebelum dikirim ke pelanggan atau
 * dilampirkan ke tender. Jangan anggap teks ini sudah disetujui legal.
 *
 * Tiga dari empat template adalah lampiran tender, jadi bentuknya mengikuti
 * kebutuhan panitia: bernomor, bertanggal, dan ada blok tanda tangan. Itu
 * sebabnya `fields` selalu memuat `nomor_surat` dan `tanggal`.
 *
 * Placeholder ditulis `{{nama_field}}` dan diisi oleh renderLetter().
 */

export type LetterField = {
	key: string
	label: string
	required: boolean
	/** Contoh isian, dipakai sebagai placeholder di form. */
	example?: string
}

export type LetterTemplate = {
	id: string
	name: string
	description: string
	fields: LetterField[]
	body: string
}

const COMMON_FIELDS: LetterField[] = [
	{ key: 'nomor_surat', label: 'Nomor surat', required: true, example: '001/PRN/VII/2026' },
	{ key: 'tanggal', label: 'Tanggal', required: true, example: '20 Juli 2026' },
	{ key: 'penerima', label: 'Ditujukan kepada', required: true, example: 'PT Maju Jaya' },
	{ key: 'penandatangan', label: 'Nama penanda tangan', required: true, example: 'Benny' },
	{ key: 'jabatan', label: 'Jabatan penanda tangan', required: true, example: 'Sales Leader' },
]

const KOP = `PIRANUSA
Reseller Resmi Software CAD
Nomor  : {{nomor_surat}}
Tanggal: {{tanggal}}

Kepada Yth.
{{penerima}}
di tempat`

const TTD = `Hormat kami,
PIRANUSA


{{penandatangan}}
{{jabatan}}`

export const LETTER_TEMPLATES: LetterTemplate[] = [
	{
		id: 'penawaran_harga',
		name: 'Surat Penawaran Harga',
		description:
			'Quotation resmi: rincian produk, jumlah lisensi, harga, dan masa berlaku penawaran.',
		fields: [
			...COMMON_FIELDS,
			{ key: 'produk', label: 'Produk', required: true, example: 'ZWCAD 2025 Professional' },
			{ key: 'jumlah', label: 'Jumlah lisensi', required: true, example: '5' },
			{ key: 'harga', label: 'Harga total', required: true, example: 'Rp 45.000.000' },
			{ key: 'masa_berlaku', label: 'Penawaran berlaku sampai', required: true, example: '31 Agustus 2026' },
		],
		body: `${KOP}

Perihal: Penawaran Harga {{produk}}

Dengan hormat,

Menindaklanjuti komunikasi kami sebelumnya, bersama ini kami sampaikan
penawaran harga untuk kebutuhan software CAD di perusahaan Bapak/Ibu.

  Produk          : {{produk}}
  Jumlah lisensi  : {{jumlah}}
  Harga total     : {{harga}}

Penawaran ini berlaku sampai dengan {{masa_berlaku}}. Harga sudah termasuk
lisensi resmi, aktivasi, dan dukungan teknis selama masa berlangganan.

Kami siap membantu bila Bapak/Ibu memerlukan penyesuaian jumlah lisensi atau
penjelasan teknis lebih lanjut.

${TTD}`,
	},
	{
		id: 'penunjukan_dealer',
		name: 'Surat Penunjukan Dealer Resmi',
		description:
			'Menyatakan PIRANUSA reseller resmi principal. Lampiran wajib pada banyak tender.',
		fields: [
			...COMMON_FIELDS,
			{ key: 'principal', label: 'Principal / vendor', required: true, example: 'ZWSOFT' },
			{ key: 'produk', label: 'Produk yang ditunjuk', required: true, example: 'ZWCAD' },
			{ key: 'wilayah', label: 'Wilayah penunjukan', required: false, example: 'Indonesia' },
		],
		body: `${KOP}

Perihal: Penunjukan Dealer Resmi {{principal}}

Dengan hormat,

Yang bertanda tangan di bawah ini menerangkan bahwa PIRANUSA merupakan
dealer resmi yang ditunjuk untuk memasarkan dan mendistribusikan produk
{{produk}} dari {{principal}} untuk wilayah {{wilayah}}.

Sehubungan dengan hal tersebut, PIRANUSA berwenang menyediakan lisensi,
melakukan aktivasi, serta memberikan dukungan teknis atas produk dimaksud.

Surat ini dibuat untuk dipergunakan sebagaimana mestinya.

${TTD}`,
	},
	{
		id: 'keterangan_lisensi_asli',
		name: 'Surat Keterangan Lisensi Asli',
		description:
			'Menyatakan lisensi yang dibeli asli dan terdaftar. Biasanya diminta saat audit atau tender.',
		fields: [
			...COMMON_FIELDS,
			{ key: 'produk', label: 'Produk', required: true, example: 'Archicad 27' },
			{ key: 'nomor_lisensi', label: 'Nomor lisensi', required: true, example: 'AC-777-2026' },
			{ key: 'jumlah', label: 'Jumlah lisensi', required: false, example: '3' },
		],
		body: `${KOP}

Perihal: Keterangan Keaslian Lisensi

Dengan hormat,

Dengan ini kami menerangkan bahwa lisensi software berikut yang digunakan oleh
{{penerima}} adalah lisensi asli dan terdaftar resmi:

  Produk         : {{produk}}
  Nomor lisensi  : {{nomor_lisensi}}
  Jumlah         : {{jumlah}}

Lisensi tersebut diperoleh melalui jalur distribusi resmi dan tercatat pada
basis data principal.

Surat keterangan ini dibuat untuk keperluan administrasi dan dapat
dipergunakan sebagaimana mestinya.

${TTD}`,
	},
	{
		id: 'serah_terima',
		name: 'Surat Serah Terima Lisensi',
		description:
			'Bukti lisensi telah diserahkan dan diaktifkan, ditandatangani kedua belah pihak.',
		fields: [
			...COMMON_FIELDS,
			{ key: 'produk', label: 'Produk', required: true, example: 'ZWCAD 2025 Professional' },
			{ key: 'nomor_lisensi', label: 'Nomor lisensi', required: true, example: 'ZW-001-2026' },
			{ key: 'jumlah', label: 'Jumlah lisensi', required: true, example: '5' },
			{ key: 'penerima_pihak_kedua', label: 'Nama penerima (pihak kedua)', required: true, example: 'Budi Santoso' },
		],
		body: `${KOP}

Perihal: Berita Acara Serah Terima Lisensi

Pada hari ini, {{tanggal}}, yang bertanda tangan di bawah ini:

  Pihak Pertama : {{penandatangan}} ({{jabatan}}), PIRANUSA
  Pihak Kedua   : {{penerima_pihak_kedua}}, {{penerima}}

menyatakan bahwa Pihak Pertama telah menyerahkan dan Pihak Kedua telah
menerima lisensi software berikut dalam keadaan aktif dan berfungsi baik:

  Produk         : {{produk}}
  Nomor lisensi  : {{nomor_lisensi}}
  Jumlah         : {{jumlah}}

Demikian berita acara ini dibuat untuk dipergunakan sebagaimana mestinya.


Pihak Pertama,                        Pihak Kedua,



{{penandatangan}}                     {{penerima_pihak_kedua}}
{{jabatan}}                           {{penerima}}`,
	},
]

const TEMPLATE_BY_ID = new Map(LETTER_TEMPLATES.map((template) => [template.id, template]))

export function findTemplate(id: string | null | undefined): LetterTemplate | null {
	return TEMPLATE_BY_ID.get(String(id || '').trim()) || null
}

/**
 * Fill a template's placeholders. Missing optional values become "-" rather
 * than being left as `{{field}}`: a letter that goes out with visible
 * placeholder syntax looks broken, and these get printed and attached to
 * tenders.
 */
export function renderLetter(
	template: LetterTemplate,
	values: Record<string, unknown>,
): { body: string; missing: string[] } {
	const missing = template.fields
		.filter((field) => field.required && !String(values[field.key] ?? '').trim())
		.map((field) => field.label)

	const body = template.body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
		const value = String(values[key] ?? '').trim()
		return value || '-'
	})

	return { body, missing }
}
