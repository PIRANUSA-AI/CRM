import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'

type ParsedAmount = {
	amount: number
	display: string
	raw: string
}

type TreatmentProduct = {
	name: string
	sku: string
	image_url: string | null
	base_price: number | null
	harga_normal_non_member: number | null
	harga_normal_member: number | null
	harga_promo_flash_sale_new_customer: number | null
	harga_special_non_member: number | null
	harga_special_member: number | null
	promo_label: string | null
	special_label: string | null
	unit: string | null
	treatment_sessions: number | null
	description: string | null
	metadata: Record<string, unknown>
}

const INPUT_PATH = process.env.TREATMENT_INPUT_PATH
	? path.resolve(process.env.TREATMENT_INPUT_PATH)
	: path.resolve(process.cwd(), 'knowledge/treatment-catalog-source.md')

const OUTPUT_JSON_PATH = process.env.TREATMENT_OUTPUT_JSON_PATH
	? path.resolve(process.env.TREATMENT_OUTPUT_JSON_PATH)
	: path.resolve(process.cwd(), 'knowledge/treatment-products.json')

const OUTPUT_CSV_PATH = process.env.TREATMENT_OUTPUT_CSV_PATH
	? path.resolve(process.env.TREATMENT_OUTPUT_CSV_PATH)
	: path.resolve(process.cwd(), 'knowledge/treatment-products.csv')

function normalizeText(value: string): string {
	return String(value || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\r\n/g, '\n')
}

function normalizeWhitespace(value: string): string {
	return String(value || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function normalizeHttpUrl(value: string): string | null {
	const trimmed = String(value || '').trim()
	if (!trimmed) return null
	try {
		const parsed = new URL(trimmed)
		if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
		return parsed.toString()
	} catch {
		return null
	}
}

function isLikelyImageUrl(value: string): boolean {
	const normalized = String(value || '').toLowerCase()
	if (!normalized) return false
	if (!/^https?:\/\//.test(normalized)) return false
	if (/\.((png|jpe?g|gif|webp|svg|bmp|heic|avif))(?:$|[?#])/i.test(normalized)) {
		return true
	}
	return normalized.includes('files.cekat.ai')
}

function cleanHeadingName(value: string): string {
	return normalizeWhitespace(
		String(value || '')
			.replace(/^#{1,6}\s*/, '')
			.replace(/\s*[:|-]\s*$/, ''),
	)
}

function parseHeadingLine(
	value: string,
): { name: string; imageUrl: string | null } | null {
	const raw = normalizeWhitespace(value)
	if (!raw.startsWith('#')) return null
	if (/^#{1,6}\s*harga\b/i.test(raw)) return null

	const withoutHash = normalizeWhitespace(raw.replace(/^#{1,6}\s*/, ''))
	if (!withoutHash) return null

	const withUrl = withoutHash.match(
		/^(.{2,220}?)(?:\s*:\s*|\s+)(https?:\/\/[^\s)]+)\s*$/i,
	)
	if (withUrl?.[1]) {
		const name = cleanHeadingName(withUrl[1])
		const imageUrl = normalizeHttpUrl(withUrl[2] || '')
		return {
			name,
			imageUrl: imageUrl && isLikelyImageUrl(imageUrl) ? imageUrl : null,
		}
	}

	const name = cleanHeadingName(withoutHash)
	if (!name) return null
	return {
		name,
		imageUrl: null,
	}
}

function normalizeRawPriceToken(value: string): string {
	return String(value || '')
		.replace(/\u00a0/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function parseAmountFromToken(value: string): ParsedAmount | null {
	const raw = normalizeRawPriceToken(value)
	if (!raw) return null

	const compact = raw.toLowerCase().replace(/\s+/g, '')
	const hasRp = compact.startsWith('rp')
	const hasThousandSuffix = /(rb|ribu|k)$/.test(compact)
	const digits = compact.replace(/[^\d]/g, '')
	if (!digits) return null

	let amount = Number(digits)
	if (!Number.isFinite(amount) || amount <= 0) return null

	if (hasThousandSuffix) {
		amount *= 1_000
	} else if (!hasRp && /[.,]/.test(raw) && amount <= 10_000) {
		// Heuristic for shorthand like "1.197" => 1,197,000.
		amount *= 1_000
	}

	return {
		raw,
		amount,
		display: `Rp ${new Intl.NumberFormat('id-ID').format(amount)}`,
	}
}

function extractAllPriceTokens(line: string): string[] {
	const source = String(line || '')
	const hits: Array<{ token: string; index: number }> = []

	const patterns = [
		/rp\.?\s*[0-9][0-9.,]*(?:\s*(?:rb|ribu|k))?/gi,
		/[0-9][0-9.,]*\s*(?:rb|ribu|k)/gi,
		/\b[0-9][0-9.,]{2,}\b/g,
	]

	for (const pattern of patterns) {
		let match: RegExpExecArray | null = null
		while ((match = pattern.exec(source)) !== null) {
			const token = normalizeRawPriceToken(match[0] || '')
			if (!token) continue
			hits.push({ token, index: match.index })
		}
	}

	hits.sort((left, right) => left.index - right.index)

	const seen = new Set<string>()
	const results: string[] = []
	for (const hit of hits) {
		const key = `${hit.index}:${hit.token.toLowerCase()}`
		if (seen.has(key)) continue
		seen.add(key)
		results.push(hit.token)
	}
	return results
}

function parseFirstAmount(line: string): ParsedAmount | null {
	const tokens = extractAllPriceTokens(line)
	for (const token of tokens) {
		const parsed = parseAmountFromToken(token)
		if (parsed) return parsed
	}
	return null
}

function parseAllAmounts(line: string): ParsedAmount[] {
	const tokens = extractAllPriceTokens(line)
	const parsed = tokens
		.map((token) => parseAmountFromToken(token))
		.filter((item): item is ParsedAmount => Boolean(item))

	const deduped = new Map<number, ParsedAmount>()
	for (const item of parsed) {
		if (!deduped.has(item.amount)) {
			deduped.set(item.amount, item)
		}
	}
	return Array.from(deduped.values())
}

function parseTreatmentSessions(value: string): number | null {
	const line = String(value || '')
	const match = line.match(/(\d+)\s*x\s*(?:treatment|trx|sesi|session)\b/i)
	if (!match?.[1]) return null
	const parsed = Number(match[1])
	return Number.isFinite(parsed) && parsed > 0 ? parsed : null
}

function parseUnit(value: string): string | null {
	const line = String(value || '')
	const match = line.match(/\/\s*([0-9]+\s*unit)\b/i)
	if (!match?.[1]) return null
	return normalizeWhitespace(match[1]).toLowerCase()
}

function slugify(value: string): string {
	return normalizeWhitespace(value)
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-')
}

function csvEscape(value: string | number | null): string {
	if (value === null || value === undefined) return ''
	const text = String(value)
	if (/[",\n]/.test(text)) {
		return `"${text.replace(/"/g, '""')}"`
	}
	return text
}

function buildCsv(products: TreatmentProduct[]): string {
	const headers = [
		'name',
		'sku',
		'image_url',
		'base_price',
		'harga_normal_non_member',
		'harga_normal_member',
		'harga_promo_flash_sale_new_customer',
		'harga_special_non_member',
		'harga_special_member',
		'promo_label',
		'special_label',
		'unit',
		'treatment_sessions',
		'description',
	]

	const rows = [headers.join(',')]
	for (const product of products) {
		rows.push(
			[
				product.name,
				product.sku,
				product.image_url,
				product.base_price,
				product.harga_normal_non_member,
				product.harga_normal_member,
				product.harga_promo_flash_sale_new_customer,
				product.harga_special_non_member,
				product.harga_special_member,
				product.promo_label,
				product.special_label,
				product.unit,
				product.treatment_sessions,
				product.description,
			]
				.map((item) => csvEscape(item))
				.join(','),
		)
	}
	return `${rows.join('\n')}\n`
}

function buildProductsFromCatalog(source: string): TreatmentProduct[] {
	const lines = normalizeText(source)
		.split('\n')
		.map((line) => line.trim())
		.filter(Boolean)

	const sections: Array<{
		name: string
		imageUrl: string | null
		lines: string[]
	}> = []

	let current: { name: string; imageUrl: string | null; lines: string[] } | null =
		null

	const flushCurrent = () => {
		if (!current) return
		if (current.lines.length === 0) {
			current = null
			return
		}
		sections.push(current)
		current = null
	}

	for (const line of lines) {
		const heading = parseHeadingLine(line)
		if (heading) {
			flushCurrent()
			current = {
				name: heading.name,
				imageUrl: heading.imageUrl,
				lines: [],
			}
			continue
		}

		if (!current) continue
		if (!current.imageUrl) {
			const url = normalizeHttpUrl(line.match(/https?:\/\/[^\s)]+/i)?.[0] || '')
			if (url && isLikelyImageUrl(url)) {
				current.imageUrl = url
			}
		}
		current.lines.push(line)
	}
	flushCurrent()

	const usedSkus = new Map<string, number>()
	const products: TreatmentProduct[] = []

	for (const section of sections) {
		let normalNonMember: number | null = null
		let normalMember: number | null = null
		let promo: number | null = null
		let specialNonMember: number | null = null
		let specialMember: number | null = null
		let promoLabel: string | null = null
		let specialLabel: string | null = null
		let unit: string | null = null
		let treatmentSessions: number | null = null
		const notes: string[] = []

		for (const line of section.lines) {
			const lower = line.toLowerCase()
			const detectedSessions = parseTreatmentSessions(line)
			if (detectedSessions !== null) {
				treatmentSessions = treatmentSessions || detectedSessions
			}
			const detectedUnit = parseUnit(line)
			if (detectedUnit) {
				unit = unit || detectedUnit
			}

			if (!lower.includes('harga')) {
				if (!/^https?:\/\//i.test(line)) {
					notes.push(normalizeWhitespace(line))
				}
				continue
			}

			if (/harga\s+promo/.test(lower)) {
				const parsed = parseFirstAmount(line)
				if (parsed) promo = promo || parsed.amount
				const label = normalizeWhitespace(line.split(':')[0] || '')
				promoLabel = promoLabel || label || 'Harga Promo'
				continue
			}

			if (/harga\s+normal\s+member/.test(lower)) {
				const parsed = parseFirstAmount(line)
				if (parsed) normalMember = normalMember || parsed.amount
				continue
			}

			if (/harga\s+normal/.test(lower)) {
				const parsed = parseFirstAmount(line)
				if (parsed) normalNonMember = normalNonMember || parsed.amount
				continue
			}

			if (/harga\s+(special|spesial)/.test(lower)) {
				const parsedAll = parseAllAmounts(line)
				if (/\bnon\s*member\b/i.test(line) && /\bmember\b/i.test(line)) {
					if (parsedAll[0]) specialNonMember = specialNonMember || parsedAll[0].amount
					if (parsedAll[1]) specialMember = specialMember || parsedAll[1].amount
				} else if (parsedAll[0]) {
					specialNonMember = specialNonMember || parsedAll[0].amount
				}
				const label = normalizeWhitespace(line.split(':')[0] || '')
				specialLabel = specialLabel || label || 'Harga Special'
				continue
			}
		}

		const hasAnyPrice = [
			normalNonMember,
			normalMember,
			promo,
			specialNonMember,
			specialMember,
		].some((value) => value !== null)
		if (!hasAnyPrice) continue

		const basePrice =
			normalNonMember ||
			normalMember ||
			promo ||
			specialNonMember ||
			specialMember ||
			null

		const rawSku = `TRT-${slugify(section.name)}`
		const seenCount = usedSkus.get(rawSku) || 0
		usedSkus.set(rawSku, seenCount + 1)
		const sku = seenCount === 0 ? rawSku : `${rawSku}-${seenCount + 1}`

		const description = normalizeWhitespace(notes.join(' ')) || null
		products.push({
			name: section.name,
			sku,
			image_url: section.imageUrl,
			base_price: basePrice,
			harga_normal_non_member: normalNonMember,
			harga_normal_member: normalMember,
			harga_promo_flash_sale_new_customer: promo,
			harga_special_non_member: specialNonMember,
			harga_special_member: specialMember,
			promo_label: promoLabel,
			special_label: specialLabel,
			unit,
			treatment_sessions: treatmentSessions,
			description,
			metadata: {
				source: 'HARGA TREATMENT',
				pricing: {
					normal_non_member: normalNonMember,
					normal_member: normalMember,
					promo_flash_sale_new_customer: promo,
					special_non_member: specialNonMember,
					special_member: specialMember,
				},
				promo_label: promoLabel,
				special_label: specialLabel,
				unit,
				treatment_sessions: treatmentSessions,
				notes: notes,
			},
		})
	}

	return products
}

async function main() {
	const source = await readFile(INPUT_PATH, 'utf8')
	const products = buildProductsFromCatalog(source)

	await mkdir(path.dirname(OUTPUT_JSON_PATH), { recursive: true })
	await mkdir(path.dirname(OUTPUT_CSV_PATH), { recursive: true })

	const payload = {
		schema: 'treatment_product_catalog.v1',
		generated_at: new Date().toISOString(),
		input_path: INPUT_PATH,
		product_count: products.length,
		products,
	}

	await writeFile(OUTPUT_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8')
	await writeFile(OUTPUT_CSV_PATH, buildCsv(products), 'utf8')

	const withoutPromo = products.filter(
		(item) => item.harga_promo_flash_sale_new_customer === null,
	).length
	const promoHigherThanNormal = products.filter(
		(item) =>
			item.harga_promo_flash_sale_new_customer !== null &&
			item.harga_normal_non_member !== null &&
			item.harga_promo_flash_sale_new_customer > item.harga_normal_non_member,
	).length

	console.log(`Converted ${products.length} treatment(s).`)
	console.log(`JSON output: ${OUTPUT_JSON_PATH}`)
	console.log(`CSV output: ${OUTPUT_CSV_PATH}`)
	console.log(`Missing promo price: ${withoutPromo}`)
	console.log(`Promo > normal anomalies: ${promoHigherThanNormal}`)
}

main().catch((error) => {
	console.error('Failed converting treatment catalog:', error)
	process.exitCode = 1
})
