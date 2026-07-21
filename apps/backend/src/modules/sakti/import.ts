import { parseCsv, parseIsoDate } from '../import/parser'

/**
 * Spreadsheet import for the Sakti license database.
 *
 * Deliberately CSV-only. The records arrive as vendor exports and hand-kept
 * spreadsheets, and every sheet tool can save CSV; pulling in an XLSX parser
 * would add a dependency for a format we would immediately flatten to the same
 * rows anyway. "Save as CSV" is one step for the person doing the import.
 */

export type SaktiImportField =
	| 'customer_name'
	| 'company'
	| 'product'
	| 'vendor'
	| 'license_no'
	| 'purchased_at'
	| 'notes'

/** Column headings seen in the wild, normalised to lower-case without punctuation. */
const HEADER_ALIASES: Record<string, SaktiImportField> = {
	// customer
	nama: 'customer_name',
	'nama customer': 'customer_name',
	'nama pelanggan': 'customer_name',
	customer: 'customer_name',
	'customer name': 'customer_name',
	'end user': 'customer_name',
	// company
	perusahaan: 'company',
	instansi: 'company',
	company: 'company',
	'nama perusahaan': 'company',
	pt: 'company',
	// product
	produk: 'product',
	product: 'product',
	software: 'product',
	lisensi: 'product',
	// vendor
	vendor: 'vendor',
	'vendor asal': 'vendor',
	principal: 'vendor',
	distributor: 'vendor',
	'dibeli dari': 'vendor',
	// license number
	'no lisensi': 'license_no',
	'nomor lisensi': 'license_no',
	'license no': 'license_no',
	'license number': 'license_no',
	'serial number': 'license_no',
	serial: 'license_no',
	sn: 'license_no',
	// purchase date
	'tanggal beli': 'purchased_at',
	'tgl beli': 'purchased_at',
	'tanggal pembelian': 'purchased_at',
	'purchase date': 'purchased_at',
	'purchased at': 'purchased_at',
	// notes
	catatan: 'notes',
	keterangan: 'notes',
	notes: 'notes',
	note: 'notes',
	remark: 'notes',
	remarks: 'notes',
}

function normalizeHeader(value: string): string {
	return String(value || '')
		.toLowerCase()
		.replace(/[._\-/]+/g, ' ')
		.replace(/[^a-z0-9 ]/g, '')
		.replace(/\s+/g, ' ')
		.trim()
}

export type SaktiImportRow = {
	line: number
	customerName: string
	company: string | null
	product: string | null
	vendor: string | null
	licenseNo: string | null
	purchasedAt: Date | null
	notes: string | null
	status: 'ok' | 'skipped' | 'error'
	messages: string[]
}

export type SaktiImportPreview = {
	headers: string[]
	mapped: SaktiImportField[]
	unmapped: string[]
	rows: SaktiImportRow[]
	summary: { total: number; ok: number; skipped: number; error: number }
}

function cell(row: string[], index: number | undefined): string {
	if (index === undefined) return ''
	return String(row[index] ?? '').trim()
}

/**
 * Parse and validate without touching the database. `existingLicenseNos` and
 * `existingKeys` let the caller mark rows that are already stored, so an import
 * run twice does not double the database. These sheets get re-sent often.
 */
export function parseSaktiSheet(
	content: string,
	existing: { licenseNos: Set<string>; keys: Set<string> },
): SaktiImportPreview {
	const table = parseCsv(content)
	const mapping: Partial<Record<SaktiImportField, number>> = {}
	const unmapped: string[] = []

	table.headers.forEach((header, index) => {
		const canonical = HEADER_ALIASES[normalizeHeader(header)]
		if (canonical && mapping[canonical] === undefined) mapping[canonical] = index
		else if (!canonical && header.trim()) unmapped.push(header)
	})

	// Rows already accepted in this same file, so a sheet that repeats a licence
	// internally is caught too rather than only against what is stored.
	const seenLicense = new Set<string>()
	const seenKey = new Set<string>()

	const rows: SaktiImportRow[] = table.rows.map((raw, index) => {
		const customerName = cell(raw, mapping.customer_name)
		const company = cell(raw, mapping.company) || null
		const product = cell(raw, mapping.product) || null
		const vendor = cell(raw, mapping.vendor) || null
		const licenseNo = cell(raw, mapping.license_no) || null
		const purchasedRaw = cell(raw, mapping.purchased_at)
		const notes = cell(raw, mapping.notes) || null

		const messages: string[] = []
		let status: SaktiImportRow['status'] = 'ok'

		if (!customerName) {
			status = 'error'
			messages.push('Nama customer kosong')
		}

		let purchasedAt: Date | null = null
		if (purchasedRaw) {
			purchasedAt = parseIsoDate(purchasedRaw)
			if (!purchasedAt) messages.push(`Tanggal "${purchasedRaw}" tidak dikenali, dikosongkan`)
		}

		// A licence number identifies a record outright. Without one, fall back to
		// the customer + product pair, which is what a duplicate row looks like in
		// these sheets.
		const licenseKey = licenseNo ? licenseNo.toLowerCase() : ''
		const fallbackKey = `${customerName.toLowerCase()}|${(product || '').toLowerCase()}`

		if (status === 'ok') {
			if (licenseKey && (existing.licenseNos.has(licenseKey) || seenLicense.has(licenseKey))) {
				status = 'skipped'
				messages.push(`Nomor lisensi ${licenseNo} sudah ada`)
			} else if (!licenseKey && (existing.keys.has(fallbackKey) || seenKey.has(fallbackKey))) {
				status = 'skipped'
				messages.push('Customer + produk yang sama sudah ada')
			} else {
				if (licenseKey) seenLicense.add(licenseKey)
				seenKey.add(fallbackKey)
			}
		}

		return {
			line: index + 2, // +1 for the header row, +1 for 1-based counting
			customerName,
			company,
			product,
			vendor,
			licenseNo,
			purchasedAt,
			notes,
			status,
			messages,
		}
	})

	return {
		headers: table.headers,
		mapped: Object.keys(mapping) as SaktiImportField[],
		unmapped,
		rows,
		summary: {
			total: rows.length,
			ok: rows.filter((r) => r.status === 'ok').length,
			skipped: rows.filter((r) => r.status === 'skipped').length,
			error: rows.filter((r) => r.status === 'error').length,
		},
	}
}
