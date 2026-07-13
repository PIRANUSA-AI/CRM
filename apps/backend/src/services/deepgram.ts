import prisma from '../lib/prisma'

const DEEPGRAM_BASE_URL = 'https://api.deepgram.com/v1/listen'

type DeepgramWord = {
	word?: string
	punctuated_word?: string
}

type DeepgramResponse = {
	results?: {
		channels?: Array<{
			alternatives?: Array<{
				transcript?: string
				words?: DeepgramWord[]
			}>
		}>
	}
	err_code?: string
	err_msg?: string
}

const INDONESIAN_DIGITS: Record<string, string> = {
	nol: '0', kosong: '0', zero: '0',
	satu: '1', one: '1',
	dua: '2', two: '2',
	tiga: '3', three: '3',
	empat: '4', four: '4',
	lima: '5', five: '5',
	enam: '6', six: '6',
	tujuh: '7', seven: '7',
	delapan: '8', eight: '8',
	sembilan: '9', nine: '9',
}

function configuredKeywords() {
	return String(process.env.DEEPGRAM_KEYWORDS || '')
		.split(',')
		.map((keyword) => keyword.trim())
		.filter(Boolean)
}

async function getUserKeywords(appId: string) {
	const users = await prisma.users.findMany({
		where: { app_id: appId, deleted_at: null, active: { not: false } },
		select: { name: true },
		take: 500,
	})
	return users.map((user) => user.name.trim()).filter(Boolean)
}

export function extractPhoneNumber(transcript: string) {
	const normalizedWords = transcript
		.toLowerCase()
		.replace(/[+]/g, ' plus ')
		.replace(/[^a-z0-9]+/g, ' ')
		.trim()
		.split(/\s+/)

	let digits = ''
	for (const token of normalizedWords) {
		if (/^\d+$/.test(token)) digits += token
		else if (INDONESIAN_DIGITS[token]) digits += INDONESIAN_DIGITS[token]
	}

	if (digits.startsWith('0')) digits = `62${digits.slice(1)}`
	else if (digits.startsWith('8')) digits = `62${digits}`

	return /^\d{8,15}$/.test(digits) ? digits : null
}

export async function transcribePhoneNumber(params: {
	appId: string
	audio: ArrayBuffer
	mimeType: string
	language?: 'id' | 'en' | 'auto'
}) {
	const apiKey = String(process.env.DEEPGRAM_API_KEY || '').trim()
	if (!apiKey) throw new Error('DEEPGRAM_API_KEY belum dikonfigurasi')

	const query = new URLSearchParams({
		model: String(process.env.DEEPGRAM_MODEL || 'nova-3-general'),
		diarize: 'true',
		punctuate: 'true',
		smart_format: 'true',
		utterances: 'false',
	})
	const language = params.language || 'id'
	if (language === 'auto') query.set('detect_language', 'true')
	else query.set('language', language)

	const keywords = new Set([
		...configuredKeywords(),
		...(await getUserKeywords(params.appId)),
	])
	for (const keyword of keywords) query.append('keyterm', keyword)

	const response = await fetch(`${DEEPGRAM_BASE_URL}?${query}`, {
		method: 'POST',
		headers: {
			Authorization: `Token ${apiKey}`,
			'Content-Type': params.mimeType || 'audio/webm',
		},
		body: params.audio,
	})
	const payload = (await response.json()) as DeepgramResponse
	if (!response.ok) {
		throw new Error(payload.err_msg || payload.err_code || `Deepgram gagal (HTTP ${response.status})`)
	}

	const alternative = payload.results?.channels?.[0]?.alternatives?.[0]
	const transcript = String(
		alternative?.transcript ||
		alternative?.words?.map((word) => word.punctuated_word || word.word || '').join(' ') ||
		'',
	).trim()

	return {
		transcript,
		phoneNumber: extractPhoneNumber(transcript),
	}
}
