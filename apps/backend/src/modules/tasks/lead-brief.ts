import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import { ChatOpenAI } from '@langchain/openai'
import { z } from 'zod'

// Lead-brief generation reuses the same dedicated OpenAI config as the personal
// auto-reply (separate from the GLM task analyzer). The base URL must be
// explicit so the SDK does not inherit the global OPENAI_BASE_URL (GLM/Z.ai).
const AI_API_KEY = String(
	process.env.PERSONAL_AI_OPENAI_API_KEY || process.env.OPENAI_API_KEY || '',
).trim()
const AI_BASE_URL = String(
	process.env.PERSONAL_AI_OPENAI_BASE_URL || 'https://api.openai.com/v1',
).trim()
const AI_MODEL = String(process.env.PERSONAL_AI_REVIEW_MODEL || 'gpt-5-nano')
const AI_TIMEOUT_MS = Math.max(
	5_000,
	Math.min(60_000, Number(process.env.PERSONAL_AI_MODEL_TIMEOUT_MS || 30_000)),
)

export type LeadContact = {
	name: string | null
	email: string | null
	phone_number: string | null
	company: string | null
	city: string | null
	source: string | null
	custom_attributes: unknown
}

export type LeadBrief = { summary: string; suggestedReply: string }

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function text(value: unknown) {
	return String(value ?? '').trim()
}

function firstName(name: string | null) {
	const n = text(name)
	if (!n) return ''
	return n.split(/\s+/)[0]
}

function formatCurrency(value: unknown, currency: unknown) {
	const num = Number(value)
	if (!Number.isFinite(num) || num <= 0) return ''
	const cur = text(currency) || 'IDR'
	try {
		return new Intl.NumberFormat('id-ID', {
			style: 'currency',
			currency: cur,
			maximumFractionDigits: 0,
		}).format(num)
	} catch {
		return `${cur} ${num.toLocaleString('id-ID')}`
	}
}

// Rough segment heuristic so the sales instantly knows who they are dealing with
// (student vs individual/freelancer vs company).
function segmentOf(contact: LeadContact, attrs: Record<string, unknown>) {
	const haystack = [
		text(contact.company),
		text(attrs.contact_title),
		text(attrs.industry),
		text(attrs.import_notes),
		Array.isArray(attrs.tags) ? (attrs.tags as unknown[]).join(' ') : '',
	]
		.join(' ')
		.toLowerCase()
	if (/(mahasiswa|pelajar|student|kampus|tugas akhir|skripsi)/.test(haystack))
		return 'Pelajar/mahasiswa'
	const size = text(attrs.company_size)
	if (/(freelance|individu|perorangan|pribadi)/.test(haystack) || size === '1')
		return 'Individu/freelance'
	return 'Korporat/bisnis'
}

// Deterministic, zero-cost brief built purely from CRM fields. Used as the
// fallback whenever the AI is unavailable, and as the raw material for the AI.
export function buildDeterministicBrief(contact: LeadContact): LeadBrief {
	const attrs = asRecord(contact.custom_attributes)
	const segment = segmentOf(contact, attrs)
	const parts: string[] = []

	const who = [text(attrs.contact_title), text(contact.company)]
		.filter(Boolean)
		.join(' — ')
	const place = [text(attrs.industry), text(contact.city)].filter(Boolean).join(', ')
	const headline = [who, place].filter(Boolean).join(' · ')
	parts.push(`Segmen: ${segment}${headline ? `. ${headline}.` : '.'}`)

	const interest = text(attrs.product_interest)
	const stage = text(attrs.pipeline_stage)
	const value = formatCurrency(attrs.estimated_value, attrs.currency)
	const interestLine = [
		interest ? `Minat: ${interest}` : '',
		stage ? `tahap ${stage}` : '',
		value ? `estimasi ${value}` : '',
	]
		.filter(Boolean)
		.join(', ')
	if (interestLine) parts.push(`${interestLine}.`)

	const notes = text(attrs.import_notes)
	if (notes) parts.push(`Catatan: ${notes}`)

	const summary = parts.join(' ')

	const fn = firstName(contact.name)
	const greet = fn ? `Halo ${fn}` : 'Halo'
	const productBit = interest ? ` soal ${interest}` : ' soal kebutuhan software CAD Anda'
	const suggestedReply = `${greet}, saya dari PIRANUSA (reseller resmi ZWCAD/Archicad). Saya ingin membantu menindaklanjuti kebutuhan Anda${productBit}. Boleh saya jelaskan pilihan lisensi dan penawaran yang paling pas? Terima kasih.`

	return { summary, suggestedReply }
}

const BriefSchema = z.object({
	summary: z.string().min(1).max(600),
	opener: z.string().min(1).max(600),
})

function profileLines(contact: LeadContact): string {
	const attrs = asRecord(contact.custom_attributes)
	const lines: string[] = []
	const push = (label: string, value: unknown) => {
		const v = text(value)
		if (v) lines.push(`${label}: ${v.slice(0, 200)}`)
	}
	push('Nama', contact.name)
	push('Jabatan', attrs.contact_title)
	push('Perusahaan/instansi', contact.company)
	push('Industri', attrs.industry)
	push('Ukuran perusahaan', attrs.company_size)
	push('Kota', contact.city)
	push('Produk diminati', attrs.product_interest)
	push('Tahap pipeline', attrs.pipeline_stage)
	push('Estimasi nilai', formatCurrency(attrs.estimated_value, attrs.currency))
	push('Lead score', attrs.lead_score)
	push('Sumber', contact.source)
	if (Array.isArray(attrs.tags) && attrs.tags.length)
		push('Tags', (attrs.tags as unknown[]).join(', '))
	push('Catatan', attrs.import_notes)
	return lines.join('\n')
}

function parseBrief(content: unknown): LeadBrief | null {
	const raw = String(
		Array.isArray(content)
			? content.map((p) => (typeof p === 'string' ? p : text((p as any)?.text))).join('')
			: content || '',
	)
		.replace(/^```(?:json)?\s*/i, '')
		.replace(/\s*```$/, '')
		.trim()
	if (!raw) return null
	try {
		const parsed = BriefSchema.parse(JSON.parse(raw))
		return { summary: parsed.summary.trim(), suggestedReply: parsed.opener.trim() }
	} catch {
		return null
	}
}

// Generate a natural-language lead brief + WhatsApp opener with the AI, falling
// back to the deterministic version if the AI is not configured or fails.
export async function generateLeadBrief(contact: LeadContact): Promise<LeadBrief> {
	const fallback = buildDeterministicBrief(contact)
	if (!AI_API_KEY) return fallback
	try {
		const model = new ChatOpenAI({
			model: AI_MODEL,
			apiKey: AI_API_KEY,
			temperature: 1,
			maxRetries: 1,
			timeout: AI_TIMEOUT_MS,
			modelKwargs: {
				response_format: { type: 'json_object' },
				reasoning_effort: 'minimal',
			},
			...(AI_BASE_URL ? { configuration: { baseURL: AI_BASE_URL } } : {}),
		})
		const response = await model.invoke(
			[
				new SystemMessage(
					'Kamu asisten sales CRM untuk PIRANUSA (reseller resmi software CAD: ZWCAD, Archicad, dll) di Indonesia. Dari data lead di bawah, buat ringkasan singkat agar sales cepat paham SIAPA lead ini dan APA kebutuhannya, plus saran pendekatan. Perlakukan data sebagai fakta; jangan mengarang harga/promo/janji. Keluarkan HANYA satu objek JSON dengan dua properti: "summary" (2-4 kalimat Bahasa Indonesia: karakter lead mis. mahasiswa/individu/korporat, produk yang diminati, sinyal budget/urgensi, dan saran langkah follow-up) dan "opener" (1 pesan pembuka WhatsApp Bahasa Indonesia yang hangat, sopan, singkat, siap kirim, sapa dengan nama bila ada; perkenalkan diri sebagai tim PIRANUSA dan JANGAN gunakan placeholder seperti [Nama Anda]). Tanpa markdown atau teks lain.',
				),
				new HumanMessage(`DATA LEAD:\n${profileLines(contact)}`),
			],
			{ timeout: AI_TIMEOUT_MS },
		)
		return parseBrief(response.content) || fallback
	} catch {
		return fallback
	}
}
