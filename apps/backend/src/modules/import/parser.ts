// Deterministic CSV parsing (RFC 4180) + header mapping + field validation.
// No AI involved in reading the file — parsing must be exact and testable.

export type CsvTable = { headers: string[]; rows: string[][] }

/** RFC 4180 parser: quote-aware, supports "" escapes and newlines inside quotes. */
export function parseCsv(input: string): CsvTable {
	const source = input.replace(/^\uFEFF/, '') // strip BOM
	const rows: string[][] = []
	let field = ''
	let row: string[] = []
	let inQuotes = false
	let i = 0

	while (i < source.length) {
		const ch = source[i]
		if (inQuotes) {
			if (ch === '"') {
				if (source[i + 1] === '"') {
					field += '"'
					i += 2
					continue
				}
				inQuotes = false
				i += 1
				continue
			}
			field += ch
			i += 1
			continue
		}
		if (ch === '"') {
			inQuotes = true
			i += 1
			continue
		}
		if (ch === ',') {
			row.push(field)
			field = ''
			i += 1
			continue
		}
		if (ch === '\r') {
			i += 1
			continue
		}
		if (ch === '\n') {
			row.push(field)
			rows.push(row)
			row = []
			field = ''
			i += 1
			continue
		}
		field += ch
		i += 1
	}
	if (field.length > 0 || row.length > 0) {
		row.push(field)
		rows.push(row)
	}

	if (rows.length === 0) return { headers: [], rows: [] }
	const headers = rows[0].map((h) => h.trim())
	// Drop fully-empty trailing rows.
	const dataRows = rows
		.slice(1)
		.filter((r) => r.some((cell) => String(cell).trim().length > 0))
	return { headers, rows: dataRows }
}

// Canonical field keys expected by the importer.
export type CanonicalField =
	| 'name'
	| 'contact_title'
	| 'phone'
	| 'email'
	| 'company'
	| 'industry'
	| 'company_size'
	| 'city'
	| 'province'
	| 'country'
	| 'source'
	| 'product_interest'
	| 'pipeline_stage'
	| 'lead_score'
	| 'probability'
	| 'estimated_value'
	| 'currency'
	| 'assigned_to'
	| 'last_contact_at'
	| 'next_followup_at'
	| 'expected_close_date'
	| 'external_id'
	| 'notes'
	| 'tags'
	| 'consent_status'

const HEADER_ALIASES: Record<string, CanonicalField> = {
	name: 'name',
	nama: 'name',
	full_name: 'name',
	contact_name: 'name',
	contact_title: 'contact_title',
	title: 'contact_title',
	jabatan: 'contact_title',
	phone: 'phone',
	phone_number: 'phone',
	no_hp: 'phone',
	nomor: 'phone',
	nomor_hp: 'phone',
	whatsapp: 'phone',
	wa: 'phone',
	telepon: 'phone',
	email: 'email',
	e_mail: 'email',
	surel: 'email',
	company: 'company',
	perusahaan: 'company',
	instansi: 'company',
	industry: 'industry',
	industri: 'industry',
	company_size: 'company_size',
	ukuran_perusahaan: 'company_size',
	city: 'city',
	kota: 'city',
	province: 'province',
	provinsi: 'province',
	country: 'country',
	negara: 'country',
	source: 'source',
	sumber: 'source',
	product_interest: 'product_interest',
	produk: 'product_interest',
	pipeline_stage: 'pipeline_stage',
	stage: 'pipeline_stage',
	tahap: 'pipeline_stage',
	status: 'pipeline_stage',
	lead_score: 'lead_score',
	skor: 'lead_score',
	probability: 'probability',
	probabilitas: 'probability',
	estimated_value: 'estimated_value',
	nilai: 'estimated_value',
	value: 'estimated_value',
	currency: 'currency',
	mata_uang: 'currency',
	assigned_to: 'assigned_to',
	assignee: 'assigned_to',
	sales: 'assigned_to',
	pic: 'assigned_to',
	last_contact_at: 'last_contact_at',
	last_contact: 'last_contact_at',
	next_followup_at: 'next_followup_at',
	next_followup: 'next_followup_at',
	followup: 'next_followup_at',
	expected_close_date: 'expected_close_date',
	close_date: 'expected_close_date',
	external_id: 'external_id',
	id_lama: 'external_id',
	legacy_id: 'external_id',
	notes: 'notes',
	catatan: 'notes',
	note: 'notes',
	tags: 'tags',
	label: 'tags',
	consent_status: 'consent_status',
	consent: 'consent_status',
	konsen: 'consent_status',
}

function normalizeHeader(header: string): string {
	return header
		.trim()
		.toLowerCase()
		.replace(/[\s\-]+/g, '_')
		.replace(/[^a-z0-9_]/g, '')
}

/** Map raw headers to canonical field → column index. */
export function mapHeaders(headers: string[]): {
	mapping: Partial<Record<CanonicalField, number>>
	unmapped: string[]
} {
	const mapping: Partial<Record<CanonicalField, number>> = {}
	const unmapped: string[] = []
	headers.forEach((header, index) => {
		const canonical = HEADER_ALIASES[normalizeHeader(header)]
		if (canonical && mapping[canonical] === undefined) {
			mapping[canonical] = index
		} else if (!canonical) {
			unmapped.push(header)
		}
	})
	return { mapping, unmapped }
}

export function normalizePhone(value: string | undefined | null): string | null {
	let digits = String(value || '').replace(/\D/g, '')
	if (!digits) return null
	if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
	else if (digits.startsWith('8')) digits = `62${digits}`
	else if (digits.startsWith('620')) digits = `62${digits.slice(3)}`
	return /^\d{8,15}$/.test(digits) ? digits : null
}

export function isValidEmail(value: string | undefined | null): boolean {
	const v = String(value || '').trim()
	if (!v) return false
	return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)
}

export function parseIsoDate(value: string | undefined | null): Date | null {
	const v = String(value || '').trim()
	if (!v) return null
	const date = new Date(v)
	return Number.isNaN(date.getTime()) ? null : date
}

export function parseIntSafe(value: string | undefined | null): number | null {
	const v = String(value || '').trim()
	if (!v) return null
	const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
	return Number.isFinite(n) ? n : null
}

export function parseAmount(value: string | undefined | null): number | null {
	const v = String(value || '').replace(/[^\d.]/g, '')
	if (!v) return null
	const n = Number.parseFloat(v)
	return Number.isFinite(n) ? n : null
}

export function mapConsent(value: string | undefined | null): string {
	const v = String(value || '').trim().toLowerCase()
	if (v === 'opt_in' || v === 'optin' || v === 'consented') return 'CONSENTED'
	if (v === 'opt_out' || v === 'optout' || v === 'unsubscribed') return 'OPTED_OUT'
	return 'NOT_CONSENTED'
}

export function splitTags(value: string | undefined | null): string[] {
	return String(value || '')
		.split(/[;,]/)
		.map((t) => t.trim())
		.filter(Boolean)
}

const CLOSED_STAGES = new Set(['menang', 'kalah', 'won', 'lost', 'closed'])

export function isClosedStage(stage: string | undefined | null): boolean {
	return CLOSED_STAGES.has(String(stage || '').trim().toLowerCase())
}
