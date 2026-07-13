import { Buffer } from 'buffer'
import { AIService } from '../ai/service'

type ProviderRuntime = {
	provider: string | null
	baseUrl: string | null
	apiKey: string | null
	apiVersion: string
	deploymentName: string | null
	modelName: string
}

type SourceFileSnapshot = {
	id?: string | null
	fileName?: string | null
	mimeType?: string | null
	fileSizeBytes?: number | null
	storageUrl?: string | null
	storageKey?: string | null
}

export type ExtractKnowledgeSourceInput = {
	appId: string
	title?: string | null
	sourceType?: string | null
	format?: string | null
	sourceUrl?: string | null
	existingContent?: string | null
	file?: SourceFileSnapshot | null
}

export type ExtractKnowledgeSourceResult = {
	content: string
	method: string
	language: string | null
	pageCount: number | null
	durationMs: number | null
	metadata: Record<string, unknown>
}

const DEFAULT_MODEL = 'gpt-5.4'
const FETCH_TIMEOUT_MS = Math.max(
	5_000,
	Number(process.env.KNOWLEDGE_EXTRACTION_FETCH_TIMEOUT_MS || 25_000),
)
const MAX_DOWNLOAD_BYTES = Math.max(
	512_000,
	Number(process.env.KNOWLEDGE_EXTRACTION_MAX_DOWNLOAD_BYTES || 20 * 1024 * 1024),
)
const MAX_TEXT_CHARS = Math.max(
	8_000,
	Number(process.env.KNOWLEDGE_EXTRACTION_MAX_TEXT_CHARS || 220_000),
)
const MAX_LLM_CONTEXT_CHARS = Math.max(
	4_000,
	Number(process.env.KNOWLEDGE_EXTRACTION_MAX_LLM_CONTEXT_CHARS || 60_000),
)
const MAX_BINARY_BASE64_BYTES = Math.max(
	32_000,
	Number(process.env.KNOWLEDGE_EXTRACTION_MAX_BINARY_BASE64_BYTES || 512_000),
)

function normalizeString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function normalizeWhitespace(value: string): string {
	return value.replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').replace(/[ \t]{2,}/g, ' ').trim()
}

function limitText(value: string, maxChars = MAX_TEXT_CHARS): string {
	if (value.length <= maxChars) return value
	return value.slice(0, maxChars)
}

function toRecord(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return null
	return value as Record<string, unknown>
}

function parseCompletionText(payload: unknown): string | null {
	const record = toRecord(payload)
	if (!record) return null

	const outputText = normalizeString(record.output_text)
	if (outputText) return outputText

	const choices = Array.isArray(record.choices) ? (record.choices as unknown[]) : []
	if (choices.length === 0) return null
	const message = toRecord(toRecord(choices[0])?.message)
	if (!message) return null

	const direct = normalizeString(message.content)
	if (direct) return direct

	if (Array.isArray(message.content)) {
		const textParts = (message.content as unknown[])
			.map((item) => normalizeString(toRecord(item)?.text))
			.filter((item): item is string => Boolean(item))
		if (textParts.length > 0) {
			return normalizeWhitespace(textParts.join('\n'))
		}
	}

	return null
}

function extractTitleFromHtml(html: string): string | null {
	const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)
	if (!titleMatch?.[1]) return null
	return normalizeWhitespace(
		titleMatch[1]
			.replace(/&amp;/g, '&')
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>'),
	)
}

function extractMetaDescription(html: string): string | null {
	const patterns = [
		/<meta[^>]+name=["']description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
		/<meta[^>]+property=["']og:description["'][^>]+content=["']([\s\S]*?)["'][^>]*>/i,
	]
	for (const pattern of patterns) {
		const match = html.match(pattern)
		if (match?.[1]) return normalizeWhitespace(match[1])
	}
	return null
}

function stripHtml(value: string): string {
	return normalizeWhitespace(
		value
			.replace(/<style[\s\S]*?<\/style>/gi, ' ')
			.replace(/<script[\s\S]*?<\/script>/gi, ' ')
			.replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
			.replace(/<\/(p|div|h1|h2|h3|h4|h5|h6|li|br|tr)>/gi, '\n')
			.replace(/<[^>]+>/g, ' ')
			.replace(/&nbsp;/gi, ' ')
			.replace(/&amp;/gi, '&')
			.replace(/&lt;/gi, '<')
			.replace(/&gt;/gi, '>')
			.replace(/&#39;/gi, "'")
			.replace(/&quot;/gi, '"'),
	)
}

function detectLanguageHeuristic(value: string): string | null {
	const text = value.toLowerCase()
	if (!text) return null
	const idSignals = ['yang', 'dan', 'untuk', 'dengan', 'tidak', 'adalah']
	const enSignals = ['the', 'and', 'for', 'with', 'not', 'is']
	const score = (signals: string[]) =>
		signals.reduce((sum, token) => sum + (text.includes(` ${token} `) ? 1 : 0), 0)
	const idScore = score(idSignals)
	const enScore = score(enSignals)
	if (idScore === 0 && enScore === 0) return null
	return idScore >= enScore ? 'id' : 'en'
}

function buildStorageUrlCandidates(args: {
	storageUrl: string | null
	sourceUrl: string | null
	storageKey: string | null
}): string[] {
	const candidates: string[] = []
	const pushCandidate = (value: string | null) => {
		const normalized = normalizeString(value)
		if (!normalized || !isPublicUrl(normalized)) return
		if (!candidates.includes(normalized)) {
			candidates.push(normalized)
		}
	}

	const storageUrl = normalizeString(args.storageUrl)
	const sourceUrl = normalizeString(args.sourceUrl)
	const storageKey = normalizeString(args.storageKey)?.replace(/^\/+/, '') || null
	const publicBases = [
		normalizeString(process.env.S3_PUBLIC_URL),
		normalizeString(process.env.R2_PUBLIC_URL),
		normalizeString(process.env.S3_ENDPOINT),
		normalizeString(process.env.R2_ENDPOINT),
	]
		.filter((value): value is string => Boolean(value))
		.map((value) => value.replace(/\/+$/, ''))
	const bucketName = normalizeString(process.env.S3_BUCKET || process.env.R2_BUCKET_NAME)

	pushCandidate(storageUrl)
	pushCandidate(sourceUrl)

	// Backward compatibility: past uploads may accidentally include bucket twice
	// (e.g. custom R2 public domain + /bucket/key). Try bucketless variant.
	if (bucketName) {
		for (const baseCandidate of [storageUrl, sourceUrl]) {
			if (!baseCandidate) continue
			try {
				const parsed = new URL(baseCandidate)
				const path = parsed.pathname.replace(/^\/+/, '')
				if (path.startsWith(`${bucketName}/`)) {
					parsed.pathname = `/${path.slice(bucketName.length + 1)}`
					pushCandidate(parsed.toString())
				}
			} catch {
				// Ignore malformed URLs; caller will handle if no valid candidate can be fetched.
			}
		}
	}

	if (storageKey) {
		for (const base of publicBases) {
			pushCandidate(`${base}/${storageKey}`)
			if (bucketName) {
				pushCandidate(`${base}/${bucketName}/${storageKey}`)
			}
		}
	}

	return candidates
}

function guessFormat(args: {
	format?: string | null
	sourceType?: string | null
	fileName?: string | null
	mimeType?: string | null
	sourceUrl?: string | null
}): string {
	const direct = normalizeString(args.format)?.toLowerCase()
	if (direct) return direct

	const sourceType = normalizeString(args.sourceType)?.toLowerCase()
	if (sourceType === 'url') return 'website'

	const mime = normalizeString(args.mimeType)?.toLowerCase() || ''
	if (mime.includes('pdf')) return 'pdf'
	if (mime.includes('markdown') || mime.includes('md')) return 'markdown'
	if (mime.includes('wordprocessingml') || mime.includes('msword')) return 'docx'
	if (mime.startsWith('image/')) return 'image'
	if (mime.startsWith('audio/')) return 'audio'
	if (mime.includes('json')) return 'json'
	if (mime.includes('csv')) return 'csv'
	if (mime.startsWith('text/')) return 'text'

	const fileName = normalizeString(args.fileName)?.toLowerCase() || ''
	if (fileName.endsWith('.pdf')) return 'pdf'
	if (fileName.endsWith('.md') || fileName.endsWith('.markdown')) return 'markdown'
	if (fileName.endsWith('.docx') || fileName.endsWith('.doc')) return 'docx'
	if (
		fileName.endsWith('.png') ||
		fileName.endsWith('.jpg') ||
		fileName.endsWith('.jpeg') ||
		fileName.endsWith('.webp') ||
		fileName.endsWith('.gif')
	) {
		return 'image'
	}
	if (
		fileName.endsWith('.mp3') ||
		fileName.endsWith('.wav') ||
		fileName.endsWith('.m4a') ||
		fileName.endsWith('.ogg')
	) {
		return 'audio'
	}
	if (fileName.endsWith('.json')) return 'json'
	if (fileName.endsWith('.csv')) return 'csv'
	if (fileName.endsWith('.txt')) return 'text'
	if (fileName.endsWith('.url')) return 'website'

	const sourceUrl = normalizeString(args.sourceUrl)
	if (sourceUrl) return 'website'
	return 'text'
}

function isPublicUrl(input: string): boolean {
	let parsed: URL
	try {
		parsed = new URL(input)
	} catch {
		return false
	}
	if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return false

	const host = parsed.hostname.toLowerCase()
	if (!host) return false
	if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return false
	if (host.endsWith('.local')) return false
	if (/^10\./.test(host)) return false
	if (/^192\.168\./.test(host)) return false
	if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false
	if (/^(fc|fd)[0-9a-f]{2}:/.test(host)) return false
	return true
}

async function fetchWithTimeout(
	url: string,
	init: RequestInit & { maxBytes?: number } = {},
): Promise<{ response: Response; buffer: Buffer }> {
	const controller = new AbortController()
	const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		const response = await fetch(url, {
			...init,
			signal: controller.signal,
		})
		if (!response.ok) {
			throw new Error(`Fetch failed (${response.status}) for ${url}`)
		}
		const arrayBuffer = await response.arrayBuffer()
		const buffer = Buffer.from(arrayBuffer)
		const maxBytes = Math.max(1, Number(init.maxBytes || MAX_DOWNLOAD_BYTES))
		if (buffer.length > maxBytes) {
			throw new Error(
				`Fetched payload too large (${buffer.length} bytes). Max ${maxBytes} bytes.`,
			)
		}
		return { response, buffer }
	} finally {
		clearTimeout(timeout)
	}
}

function decodeTextBuffer(buffer: Buffer): string {
	return normalizeWhitespace(buffer.toString('utf8'))
}

function looksLikeMostlyText(value: string): boolean {
	if (!value) return false
	const sample = value.slice(0, 4_000)
	const printable = sample.match(/[\x09\x0a\x0d\x20-\x7e]/g)?.length || 0
	return printable / sample.length > 0.85
}

async function resolveRuntime(appId: string): Promise<ProviderRuntime> {
	const [settings, providerConfigurations] = await Promise.all([
		AIService.getSettings(appId).catch(() => null),
		AIService.getProviderConfigurations().catch(() => null),
	])

	const activeProvider = providerConfigurations?.active_provider || null
	const runtimeProvider = activeProvider
		? providerConfigurations?.providers?.[activeProvider]
		: null

	const provider =
		normalizeString(runtimeProvider?.provider) ||
		normalizeString(settings?.model_provider) ||
		normalizeString(process.env.AI_PROVIDER)

	const baseUrl =
		normalizeString(runtimeProvider?.base_url) ||
		normalizeString(settings?.api_endpoint) ||
		normalizeString(process.env.AZURE_OPENAI_ENDPOINT)

	const apiKey =
		normalizeString(runtimeProvider?.api_key) ||
		normalizeString(settings?.api_key) ||
		normalizeString(process.env.AZURE_OPENAI_API_KEY) ||
		normalizeString(process.env.OPENAI_API_KEY)

	const apiVersion =
		normalizeString(runtimeProvider?.api_version) ||
		normalizeString(settings?.api_version) ||
		'2024-02-15-preview'

	const deploymentName =
		normalizeString(runtimeProvider?.deployment_name) ||
		normalizeString(settings?.deployment_name) ||
		normalizeString(process.env.AZURE_OPENAI_DEPLOYMENT)

	const modelName =
		normalizeString(settings?.model_name) ||
		normalizeString(runtimeProvider?.model_name) ||
		normalizeString(process.env.AI_MODEL) ||
		DEFAULT_MODEL

	return {
		provider,
		baseUrl,
		apiKey,
		apiVersion,
		deploymentName,
		modelName,
	}
}

function joinUrl(base: string, path: string): string {
	return `${base.replace(/\/+$/g, '')}/${path.replace(/^\/+/, '')}`
}

function isAzureRuntime(runtime: ProviderRuntime): boolean {
	return (
		(runtime.provider || '').toLowerCase() === 'azure' ||
		Boolean(runtime.baseUrl?.includes('.openai.azure.com'))
	)
}

async function requestChatCompletion(args: {
	runtime: ProviderRuntime
	systemPrompt: string
	userContent: string | Array<Record<string, unknown>>
	maxTokens?: number
}): Promise<string | null> {
	if (!args.runtime.baseUrl || !args.runtime.apiKey) return null

	const messages = [
		{ role: 'system', content: args.systemPrompt },
		{ role: 'user', content: args.userContent },
	]
	const maxTokens = Math.max(120, Math.min(2_000, Number(args.maxTokens || 1_200)))

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
	try {
		if (isAzureRuntime(args.runtime)) {
			const deployment = args.runtime.deploymentName || args.runtime.modelName
			const endpoint = joinUrl(
				args.runtime.baseUrl,
				`openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(args.runtime.apiVersion)}`,
			)
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'Content-Type': 'application/json',
					'api-key': args.runtime.apiKey,
				},
				body: JSON.stringify({
					messages,
					temperature: 0,
					max_tokens: maxTokens,
				}),
				signal: controller.signal,
			})
			if (!response.ok) return null
			const payload = await response.json().catch(() => null)
			return parseCompletionText(payload)
		}

		const endpoint = joinUrl(args.runtime.baseUrl, '/v1/chat/completions')
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				'Content-Type': 'application/json',
				Authorization: `Bearer ${args.runtime.apiKey}`,
			},
			body: JSON.stringify({
				model: args.runtime.modelName,
				messages,
				temperature: 0,
				max_tokens: maxTokens,
			}),
			signal: controller.signal,
		})
		if (!response.ok) return null
		const payload = await response.json().catch(() => null)
		return parseCompletionText(payload)
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}

async function requestAudioTranscription(args: {
	runtime: ProviderRuntime
	buffer: Buffer
	fileName: string
	mimeType: string
}): Promise<string | null> {
	if (!args.runtime.baseUrl || !args.runtime.apiKey) return null

	const formData = new FormData()
	formData.append(
		'file',
		new Blob([args.buffer], { type: args.mimeType || 'application/octet-stream' }),
		args.fileName || 'audio-file',
	)

	const controller = new AbortController()
	const timer = setTimeout(() => controller.abort(), Math.max(FETCH_TIMEOUT_MS, 45_000))

	try {
		if (isAzureRuntime(args.runtime)) {
			const deployment = args.runtime.deploymentName || 'whisper-1'
			const endpoint = joinUrl(
				args.runtime.baseUrl,
				`openai/deployments/${encodeURIComponent(deployment)}/audio/transcriptions?api-version=${encodeURIComponent(args.runtime.apiVersion)}`,
			)
			const response = await fetch(endpoint, {
				method: 'POST',
				headers: {
					'api-key': args.runtime.apiKey,
				},
				body: formData,
				signal: controller.signal,
			})
			if (!response.ok) return null
			const payload = (await response.json().catch(() => null)) as
				| Record<string, unknown>
				| null
			return normalizeString(payload?.text)
		}

		formData.append('model', 'gpt-4o-mini-transcribe')
		const endpoint = joinUrl(args.runtime.baseUrl, '/v1/audio/transcriptions')
		const response = await fetch(endpoint, {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${args.runtime.apiKey}`,
			},
			body: formData,
			signal: controller.signal,
		})
		if (!response.ok) {
			const fallback = new FormData()
			fallback.append(
				'file',
				new Blob([args.buffer], { type: args.mimeType || 'application/octet-stream' }),
				args.fileName || 'audio-file',
			)
			fallback.append('model', 'whisper-1')
			const retry = await fetch(endpoint, {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${args.runtime.apiKey}`,
				},
				body: fallback,
				signal: controller.signal,
			})
			if (!retry.ok) return null
			const payload = (await retry.json().catch(() => null)) as
				| Record<string, unknown>
				| null
			return normalizeString(payload?.text)
		}
		const payload = (await response.json().catch(() => null)) as
			| Record<string, unknown>
			| null
		return normalizeString(payload?.text)
	} catch {
		return null
	} finally {
		clearTimeout(timer)
	}
}

async function extractTextFromBinaryWithLlm(args: {
	runtime: ProviderRuntime
	buffer: Buffer
	fileName: string
	mimeType: string
}): Promise<string | null> {
	const sliced = args.buffer.slice(0, MAX_BINARY_BASE64_BYTES)
	const base64 = sliced.toString('base64')
	const text = await requestChatCompletion({
		runtime: args.runtime,
		systemPrompt:
			'Kamu adalah parser dokumen. Ekstrak konten teks murni dari file biner yang diberikan. Jangan halusinasi, jangan beri ringkasan, hanya teks yang berhasil dibaca.',
		userContent: `Nama file: ${args.fileName}\nMIME: ${args.mimeType}\nBase64 (truncated):\n${base64}\n\nKembalikan teks asli dokumen semaksimal mungkin.`,
		maxTokens: 1_600,
	})
	return normalizeString(text)
}

async function extractTextFromImageWithVision(args: {
	runtime: ProviderRuntime
	imageUrl: string
}): Promise<string | null> {
	const content = await requestChatCompletion({
		runtime: args.runtime,
		systemPrompt:
			'Kamu adalah OCR engine. Ekstrak semua teks yang terlihat pada gambar. Pertahankan urutan baca dari atas ke bawah.',
		userContent: [
			{
				type: 'text',
				text: 'Ekstrak semua teks pada gambar berikut. Output hanya teks mentah tanpa komentar tambahan.',
			},
			{
				type: 'image_url',
				image_url: { url: args.imageUrl },
			},
		],
		maxTokens: 1_200,
	})
	return normalizeString(content)
}

function normalizeYoutubeUrl(url: URL): URL {
	const host = url.hostname.toLowerCase()
	if (host === 'youtu.be') {
		const id = url.pathname.replace(/^\/+/, '')
		return new URL(`https://www.youtube.com/watch?v=${encodeURIComponent(id)}`)
	}
	return url
}

function normalizeGoogleDriveUrl(url: URL): URL {
	const host = url.hostname.toLowerCase()
	if (!host.includes('drive.google.com') && !host.includes('docs.google.com')) return url

	const fileMatch = url.pathname.match(/\/file\/d\/([^/]+)/)
	if (fileMatch?.[1]) {
		return new URL(
			`https://drive.google.com/uc?export=download&id=${encodeURIComponent(fileMatch[1])}`,
		)
	}

	const docMatch = url.pathname.match(/\/document\/d\/([^/]+)/)
	if (docMatch?.[1]) {
		return new URL(
			`https://docs.google.com/document/d/${encodeURIComponent(docMatch[1])}/export?format=txt`,
		)
	}

	const sheetMatch = url.pathname.match(/\/spreadsheets\/d\/([^/]+)/)
	if (sheetMatch?.[1]) {
		return new URL(
			`https://docs.google.com/spreadsheets/d/${encodeURIComponent(sheetMatch[1])}/export?format=csv`,
		)
	}

	return url
}

async function extractUrlContent(args: {
	runtime: ProviderRuntime
	url: string
	title: string | null
}): Promise<ExtractKnowledgeSourceResult> {
	if (!isPublicUrl(args.url)) {
		throw new Error('URL tidak publik atau tidak valid (hanya http/https publik).')
	}

	let parsed = new URL(args.url)
	parsed = normalizeYoutubeUrl(parsed)
	parsed = normalizeGoogleDriveUrl(parsed)

	const providerHints: string[] = []
	const host = parsed.hostname.toLowerCase()
	if (host.includes('youtube.com') || host.includes('youtu.be')) providerHints.push('youtube')
	if (host.includes('notion.so')) providerHints.push('notion')
	if (host.includes('drive.google.com') || host.includes('docs.google.com')) {
		providerHints.push('google-drive')
	}

	let oembedTitle: string | null = null
	if (providerHints.includes('youtube')) {
		try {
			const oembedUrl = `https://www.youtube.com/oembed?url=${encodeURIComponent(parsed.toString())}&format=json`
			const { buffer } = await fetchWithTimeout(oembedUrl, {
				headers: {
					Accept: 'application/json',
				},
				maxBytes: 256_000,
			})
			const payload = JSON.parse(buffer.toString('utf8')) as Record<string, unknown>
			oembedTitle = normalizeString(payload.title)
		} catch {
			// Keep extraction flow running even when oEmbed unavailable.
		}
	}

	const { response, buffer } = await fetchWithTimeout(parsed.toString(), {
		headers: {
			Accept:
				'text/html, text/plain, text/markdown, application/json, application/pdf, application/octet-stream;q=0.8',
			'User-Agent': 'CRM-KnowledgeBot/1.0 (+https://crm.local)',
		},
		maxBytes: MAX_DOWNLOAD_BYTES,
	})
	const contentType = String(response.headers.get('content-type') || '').toLowerCase()
	const methodHints = providerHints.length > 0 ? providerHints.join('+') : 'website'

	if (
		contentType.includes('application/pdf') ||
		contentType.includes('wordprocessingml') ||
		contentType.includes('msword')
	) {
		const extracted = await extractTextFromBinaryWithLlm({
			runtime: args.runtime,
			buffer,
			fileName: 'url-document',
			mimeType: contentType || 'application/octet-stream',
		})
		if (!extracted) {
			throw new Error('Gagal mengekstrak konten dari dokumen URL publik.')
		}
		const language = detectLanguageHeuristic(extracted)
		return {
			content: limitText(normalizeWhitespace(extracted)),
			method: `${methodHints}-ai-document`,
			language,
			pageCount: null,
			durationMs: null,
			metadata: {
				content_type: contentType || null,
				provider_hints: providerHints,
				oembed_title: oembedTitle,
				fetch_url: parsed.toString(),
			},
		}
	}

	if (contentType.startsWith('image/')) {
		const text = await extractTextFromImageWithVision({
			runtime: args.runtime,
			imageUrl: parsed.toString(),
		})
		if (!text) throw new Error('Gagal OCR dari URL gambar publik.')
		return {
			content: limitText(normalizeWhitespace(text)),
			method: `${methodHints}-vision-ocr`,
			language: detectLanguageHeuristic(text),
			pageCount: null,
			durationMs: null,
			metadata: {
				content_type: contentType || null,
				provider_hints: providerHints,
				oembed_title: oembedTitle,
				fetch_url: parsed.toString(),
			},
		}
	}

	const rawText = buffer.toString('utf8')
	let extracted = ''
	let method = `${methodHints}-text`
	if (contentType.includes('text/html') || rawText.includes('<html')) {
		const title = extractTitleFromHtml(rawText) || oembedTitle || args.title || null
		const description = extractMetaDescription(rawText)
		const plain = stripHtml(rawText)
		extracted = [title, description, plain].filter(Boolean).join('\n\n')
		method = `${methodHints}-html`
	} else {
		extracted = normalizeWhitespace(rawText)
	}

	const llmRefined = await requestChatCompletion({
		runtime: args.runtime,
		systemPrompt:
			'Kamu membersihkan konten web untuk indexing RAG. Pertahankan fakta, struktur, angka, heading penting. Hapus boilerplate navigasi berulang.',
		userContent: limitText(extracted, MAX_LLM_CONTEXT_CHARS),
		maxTokens: 1_600,
	})
	const finalText = normalizeString(llmRefined) || extracted
	if (!finalText) throw new Error('URL publik berhasil diambil tetapi tidak ada konten yang dapat diekstrak.')

	return {
		content: limitText(normalizeWhitespace(finalText)),
		method: `${method}-llm-clean`,
		language: detectLanguageHeuristic(finalText),
		pageCount: null,
		durationMs: null,
		metadata: {
			content_type: contentType || null,
			provider_hints: providerHints,
			oembed_title: oembedTitle,
			fetch_url: parsed.toString(),
		},
	}
}

function buildExtractionMetadata(args: {
	format: string
	file: SourceFileSnapshot | null
	sourceUrl: string | null
	result: ExtractKnowledgeSourceResult
}): Record<string, unknown> {
	return {
		format: args.format,
		method: args.result.method,
		content_length: args.result.content.length,
		language: args.result.language,
		page_count: args.result.pageCount,
		duration_ms: args.result.durationMs,
		file_name: normalizeString(args.file?.fileName),
		mime_type: normalizeString(args.file?.mimeType),
		file_size_bytes: Number.isFinite(Number(args.file?.fileSizeBytes))
			? Number(args.file?.fileSizeBytes)
			: null,
		storage_url: normalizeString(args.file?.storageUrl),
		storage_key: normalizeString(args.file?.storageKey),
		source_url: args.sourceUrl,
		...args.result.metadata,
	}
}

export abstract class KnowledgeExtractionService {
	static async extractSourceContent(
		input: ExtractKnowledgeSourceInput,
	): Promise<ExtractKnowledgeSourceResult> {
		const runtime = await resolveRuntime(input.appId)
		const sourceUrl = normalizeString(input.sourceUrl)
		const file = input.file || null
		const format = guessFormat({
			format: input.format,
			sourceType: input.sourceType,
			fileName: file?.fileName,
			mimeType: file?.mimeType,
			sourceUrl,
		})

		if (normalizeString(input.sourceType)?.toLowerCase() === 'url' && sourceUrl) {
			const result = await extractUrlContent({
				runtime,
				url: sourceUrl,
				title: normalizeString(input.title),
			})
			return {
				...result,
				metadata: buildExtractionMetadata({
					format,
					file,
					sourceUrl,
					result,
				}),
			}
		}

		const fallbackContent = normalizeString(input.existingContent)
		const fetchCandidates = buildStorageUrlCandidates({
			storageUrl: normalizeString(file?.storageUrl),
			sourceUrl,
			storageKey: normalizeString(file?.storageKey),
		})
		if (fetchCandidates.length === 0) {
			if (fallbackContent) {
				const fallback: ExtractKnowledgeSourceResult = {
					content: limitText(normalizeWhitespace(fallbackContent)),
					method: 'existing-content-fallback',
					language: detectLanguageHeuristic(fallbackContent),
					pageCount: null,
					durationMs: null,
					metadata: {
						reason: 'storage_url_missing_or_non_public',
					},
				}
				return {
					...fallback,
					metadata: buildExtractionMetadata({
						format,
						file,
						sourceUrl,
						result: fallback,
					}),
				}
			}
			throw new Error('File source URL tidak tersedia atau tidak publik untuk proses extraction.')
		}

		let response: Response | null = null
		let buffer: Buffer | null = null
		let resolvedStorageUrl: string | null = null
		let lastFetchError: Error | null = null

		for (const candidate of fetchCandidates) {
			try {
				const fetched = await fetchWithTimeout(candidate, {
					headers: {
						Accept:
							'text/plain, text/markdown, application/json, text/csv, application/pdf, application/octet-stream;q=0.8, image/*, audio/*',
					},
					maxBytes: MAX_DOWNLOAD_BYTES,
				})
				response = fetched.response
				buffer = fetched.buffer
				resolvedStorageUrl = candidate
				break
			} catch (error) {
				lastFetchError =
					error instanceof Error
						? error
						: new Error('Failed to fetch knowledge source from storage.')
			}
		}

		if (!response || !buffer || !resolvedStorageUrl) {
			if (fallbackContent) {
				const fallback: ExtractKnowledgeSourceResult = {
					content: limitText(normalizeWhitespace(fallbackContent)),
					method: 'existing-content-fetch-fallback',
					language: detectLanguageHeuristic(fallbackContent),
					pageCount: null,
					durationMs: null,
					metadata: {
						reason: 'storage_fetch_failed',
						fetch_attempted_urls: fetchCandidates,
						fetch_error: lastFetchError?.message || null,
					},
				}
				return {
					...fallback,
					metadata: buildExtractionMetadata({
						format,
						file,
						sourceUrl,
						result: fallback,
					}),
				}
			}

			throw (
				lastFetchError ||
				new Error('Gagal mengambil file source dari storage untuk proses extraction.')
			)
		}

		const storageUrl = resolvedStorageUrl
		const mimeType =
			normalizeString(file?.mimeType)?.toLowerCase() ||
			normalizeString(response.headers.get('content-type'))?.toLowerCase() ||
			'application/octet-stream'
		const fileName = normalizeString(file?.fileName) || 'knowledge-source'

		if (
			format === 'text' ||
			format === 'markdown' ||
			format === 'json' ||
			format === 'csv' ||
			mimeType.startsWith('text/') ||
			mimeType.includes('json')
		) {
			const decoded = decodeTextBuffer(buffer)
			if (!decoded) throw new Error('File teks kosong atau tidak bisa dibaca.')
			const result: ExtractKnowledgeSourceResult = {
				content: limitText(decoded),
				method: 'direct-text',
				language: detectLanguageHeuristic(decoded),
				pageCount: null,
				durationMs: null,
				metadata: {
					content_type: mimeType,
					storage_fetch_url: storageUrl,
				},
			}
			return {
				...result,
				metadata: buildExtractionMetadata({
					format,
					file,
					sourceUrl,
					result,
				}),
			}
		}

		if (format === 'image' || mimeType.startsWith('image/')) {
			const text = await extractTextFromImageWithVision({
				runtime,
				imageUrl: storageUrl,
			})
			if (!text) throw new Error('OCR gambar gagal diproses oleh AI parser.')
			const result: ExtractKnowledgeSourceResult = {
				content: limitText(normalizeWhitespace(text)),
				method: 'vision-ocr',
				language: detectLanguageHeuristic(text),
				pageCount: null,
				durationMs: null,
				metadata: {
					content_type: mimeType,
					storage_fetch_url: storageUrl,
				},
			}
			return {
				...result,
				metadata: buildExtractionMetadata({
					format,
					file,
					sourceUrl,
					result,
				}),
			}
		}

		if (format === 'audio' || mimeType.startsWith('audio/')) {
			const transcript = await requestAudioTranscription({
				runtime,
				buffer,
				fileName,
				mimeType,
			})
			if (!transcript) throw new Error('Transkripsi audio gagal diproses oleh AI parser.')
			const result: ExtractKnowledgeSourceResult = {
				content: limitText(normalizeWhitespace(transcript)),
				method: 'audio-transcription',
				language: detectLanguageHeuristic(transcript),
				pageCount: null,
				durationMs: null,
				metadata: {
					content_type: mimeType,
					storage_fetch_url: storageUrl,
				},
			}
			return {
				...result,
				metadata: buildExtractionMetadata({
					format,
					file,
					sourceUrl,
					result,
				}),
			}
		}

		const binaryExtracted = await extractTextFromBinaryWithLlm({
			runtime,
			buffer,
			fileName,
			mimeType,
		})
		if (binaryExtracted) {
			const result: ExtractKnowledgeSourceResult = {
				content: limitText(normalizeWhitespace(binaryExtracted)),
				method: `ai-document-${format}`,
				language: detectLanguageHeuristic(binaryExtracted),
				pageCount: null,
				durationMs: null,
				metadata: {
					content_type: mimeType,
					storage_fetch_url: storageUrl,
				},
			}
			return {
				...result,
				metadata: buildExtractionMetadata({
					format,
					file,
					sourceUrl,
					result,
				}),
			}
		}

		const decoded = decodeTextBuffer(buffer)
		if (looksLikeMostlyText(decoded)) {
			const result: ExtractKnowledgeSourceResult = {
				content: limitText(decoded),
				method: `heuristic-binary-text-${format}`,
				language: detectLanguageHeuristic(decoded),
				pageCount: null,
				durationMs: null,
				metadata: {
					content_type: mimeType,
					fallback: true,
					storage_fetch_url: storageUrl,
				},
			}
			return {
				...result,
				metadata: buildExtractionMetadata({
					format,
					file,
					sourceUrl,
					result,
				}),
			}
		}

		throw new Error(
			`Tidak ada konten yang bisa diekstrak dari file format "${format}" (mime: ${mimeType}).`,
		)
	}
}
