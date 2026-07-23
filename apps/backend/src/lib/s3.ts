import { S3Client } from '@aws-sdk/client-s3'

const derivedR2Endpoint = process.env.R2_ACCOUNT_ID
	? `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`
	: ''
const endpoint =
	process.env.S3_ENDPOINT || process.env.R2_ENDPOINT || derivedR2Endpoint || ''
const hasCustomEndpoint = Boolean(endpoint)
const staticAccessKeyId =
	process.env.S3_ACCESS_KEY ||
	process.env.AWS_ACCESS_KEY_ID ||
	process.env.R2_ACCESS_KEY_ID ||
	''
const staticSecretAccessKey =
	process.env.S3_SECRET_KEY ||
	process.env.AWS_SECRET_ACCESS_KEY ||
	process.env.R2_SECRET_ACCESS_KEY ||
	''
const hasStaticCredentials = Boolean(staticAccessKeyId && staticSecretAccessKey)
const s3PublicBase =
	(
		process.env.S3_PUBLIC_URL ||
		process.env.R2_PUBLIC_URL ||
		process.env.S3_ENDPOINT ||
		process.env.R2_ENDPOINT ||
		''
	).replace(/\/$/, '')
const publicUrlStyleRaw = (
	process.env.S3_PUBLIC_URL_STYLE || process.env.R2_PUBLIC_URL_STYLE || ''
)
	.trim()
	.toLowerCase()

const s3Config: ConstructorParameters<typeof S3Client>[0] = {
	endpoint: endpoint || undefined,
	region:
		process.env.S3_REGION ||
		process.env.R2_REGION ||
		process.env.AWS_REGION ||
		process.env.AWS_DEFAULT_REGION ||
		(hasCustomEndpoint ? 'auto' : 'us-east-1'),
	forcePathStyle: hasCustomEndpoint,
}

if (hasStaticCredentials) {
	s3Config.credentials = {
		accessKeyId: staticAccessKeyId,
		secretAccessKey: staticSecretAccessKey,
	}
}

export const s3 = new S3Client(s3Config)

export const BUCKET_NAME =
	process.env.S3_BUCKET || process.env.R2_BUCKET_NAME || 'crm-media'

function shouldUsePathStylePublicUrl(base: string): boolean {
	if (publicUrlStyleRaw) {
		if (
			publicUrlStyleRaw === 'path' ||
			publicUrlStyleRaw === 'path-style' ||
			publicUrlStyleRaw === 'bucket'
		) {
			return true
		}
		if (
			publicUrlStyleRaw === 'virtual' ||
			publicUrlStyleRaw === 'virtual-hosted' ||
			publicUrlStyleRaw === 'bucketless' ||
			publicUrlStyleRaw === 'none'
		) {
			return false
		}
	}

	try {
		const parsed = new URL(base)
		const host = parsed.hostname.toLowerCase()
		const path = parsed.pathname.replace(/^\/+|\/+$/g, '')
		const bucket = BUCKET_NAME.toLowerCase()
		if (host.startsWith(`${bucket}.`)) return false
		if (path.length > 0) {
			// URL already scoped to a path (often bucket-bound custom domain).
			return false
		}
		if (host.endsWith('.r2.cloudflarestorage.com')) return true
		if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
		if (host === 's3.amazonaws.com') return true
		if (
			(host.startsWith('s3.') || host.startsWith('s3-')) &&
			host.includes('amazonaws.com')
		) {
			return true
		}
		return false
	} catch {
		return true
	}
}

export function buildS3PublicUrl(key: string): string | null {
	if (!s3PublicBase) return null
	const normalizedKey = String(key || '').replace(/^\/+/, '')
	if (!normalizedKey) return null
	if (shouldUsePathStylePublicUrl(s3PublicBase)) {
		return `${s3PublicBase}/${BUCKET_NAME}/${normalizedKey}`
	}
	return `${s3PublicBase}/${normalizedKey}`
}

export function normalizeS3PublicUrl(value: string | null | undefined): string | null {
	const current = String(value || '').trim()
	if (!current || !s3PublicBase) return current || null
	try {
		const currentUrl = new URL(current)
		const baseUrl = new URL(s3PublicBase)
		const basePath = baseUrl.pathname.replace(/^\/+|\/+$/g, '')
		let key = currentUrl.pathname.replace(/^\/+|\/+$/g, '')
		if (basePath && key.startsWith(`${basePath}/`)) key = key.slice(basePath.length + 1)
		if (key.startsWith(`${BUCKET_NAME}/`)) key = key.slice(BUCKET_NAME.length + 1)
		if (currentUrl.origin !== baseUrl.origin) {
			return buildS3PublicUrl(key) || current
		}
		if (key === BUCKET_NAME) return current
		return buildS3PublicUrl(key) || current
	} catch {
		return current
	}
}

export function getS3KeyFromPublicUrl(value: string | null | undefined): string | null {
	const normalized = normalizeS3PublicUrl(value)
	if (!normalized || !s3PublicBase) return null
	try {
		const objectUrl = new URL(normalized)
		const baseUrl = new URL(s3PublicBase)
		if (objectUrl.origin !== baseUrl.origin) return null
		const basePath = baseUrl.pathname.replace(/^\/+|\/+$/g, '')
		let key = objectUrl.pathname.replace(/^\/+|\/+$/g, '')
		if (basePath && key.startsWith(`${basePath}/`)) key = key.slice(basePath.length + 1)
		if (key.startsWith(`${BUCKET_NAME}/`)) key = key.slice(BUCKET_NAME.length + 1)
		key = decodeURIComponent(key)
		if (!key || key.split('/').some((part) => part === '..')) return null
		return key
	} catch {
		return null
	}
}

export function isS3UploadConfigured(): boolean {
	return Boolean(s3PublicBase)
}

export function getS3UploadConfigurationError(): string | null {
	if (!s3PublicBase) {
		return 'S3 public URL is not configured'
	}

	if (hasCustomEndpoint && !hasStaticCredentials) {
		return 'S3 credentials are not configured'
	}

	return null
}

export default s3
