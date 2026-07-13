import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import prisma from '../../lib/prisma'

type DeveloperKeyRecord = {
	api_key: string
	created_at: string
	updated_at: string
}

type DeveloperKeyLookupRecord = {
	business_id: string
	updated_at: string
}

type DeveloperApiKeyClaims = {
	business_id: string
	email: string
	business_name: string
	iat: number
	exp?: number
}

type BusinessIdentity = {
	businessId: string
	businessName: string
	email: string
}

const BUSINESS_KEY_PREFIX = 'dev_api_key:'
const LOOKUP_KEY_PREFIX = 'dev_api_lookup:'
const JWT_ALGORITHM = 'HS256'
const JWT_TYPE = 'JWT'
const LEGACY_API_KEY_PREFIX = 'pk_'
const MAX_FUTURE_IAT_SKEW_SECONDS = 5 * 60
const REGISTERED_KEY_CACHE_TTL_MS = Number.parseInt(
	process.env.DEVELOPER_API_KEY_CACHE_TTL_MS || '60000',
	10,
)

const registeredKeyCache = new Map<
	string,
	{ businessId: string; expiresAt: number }
>()

function normalizeBusinessId(value: string): string {
	return String(value || '').trim()
}

function buildBusinessSettingsKey(businessId: string): string {
	return `${BUSINESS_KEY_PREFIX}${businessId}`
}

function buildLookupSettingsKeyFromHash(hash: string): string {
	return `${LOOKUP_KEY_PREFIX}${hash}`
}

function hashApiKey(apiKey: string): string {
	return createHash('sha256').update(apiKey).digest('hex')
}

function buildLookupSettingsKey(apiKey: string): string {
	return buildLookupSettingsKeyFromHash(hashApiKey(apiKey))
}

function normalizeSecret(value: string): string {
	return String(value || '').trim()
}

function uniqueNonEmpty(values: string[]): string[] {
	const seen = new Set<string>()
	const result: string[] = []
	for (const value of values) {
		const trimmed = normalizeSecret(value)
		if (!trimmed || seen.has(trimmed)) continue
		seen.add(trimmed)
		result.push(trimmed)
	}
	return result
}

function getDeveloperApiKeySigningSecret(): string {
	return uniqueNonEmpty([
		String(process.env.DEVELOPER_API_KEY_SECRET || ''),
		String(process.env.BETTER_AUTH_SECRET || ''),
		String(process.env.N8N_EMBED_AUTH_SECRET || ''),
	])[0] || ''
}

function getDeveloperApiKeyVerificationSecrets(): string[] {
	const fromList = String(process.env.DEVELOPER_API_KEY_VERIFICATION_SECRETS || '')
		.split(',')
		.map((value) => value.trim())
	return uniqueNonEmpty([
		getDeveloperApiKeySigningSecret(),
		String(process.env.DEVELOPER_API_KEY_SECRET_PREVIOUS || ''),
		String(process.env.BETTER_AUTH_SECRET_PREVIOUS || ''),
		...fromList,
	])
}

function readRegisteredKeyCache(apiKey: string): string | null {
	const key = hashApiKey(apiKey)
	const cached = registeredKeyCache.get(key)
	if (!cached) return null

	if (cached.expiresAt <= Date.now()) {
		registeredKeyCache.delete(key)
		return null
	}

	return cached.businessId
}

function writeRegisteredKeyCache(apiKey: string, businessId: string): void {
	if (REGISTERED_KEY_CACHE_TTL_MS <= 0) return
	registeredKeyCache.set(hashApiKey(apiKey), {
		businessId,
		expiresAt: Date.now() + REGISTERED_KEY_CACHE_TTL_MS,
	})
}

function clearRegisteredKeyCache(apiKey: string): void {
	registeredKeyCache.delete(hashApiKey(apiKey))
}

function encodeBase64Url(value: unknown): string {
	return Buffer.from(JSON.stringify(value)).toString('base64url')
}

function decodeBase64Url(value: string): unknown | null {
	try {
		const decoded = Buffer.from(value, 'base64url').toString('utf8')
		return JSON.parse(decoded)
	} catch {
		return null
	}
}

function isLikelyJwt(token: string): boolean {
	return token.split('.').length === 3
}

function matchesToken(a: string, b: string): boolean {
	const aBuffer = Buffer.from(a)
	const bBuffer = Buffer.from(b)
	if (aBuffer.length !== bBuffer.length) return false
	return timingSafeEqual(aBuffer, bBuffer)
}

function normalizeClaims(input: unknown): DeveloperApiKeyClaims | null {
	if (!input || typeof input !== 'object' || Array.isArray(input)) {
		return null
	}

	const payload = input as Partial<DeveloperApiKeyClaims>
	const businessId = normalizeBusinessId(payload.business_id || '')
	if (!businessId) return null

	const email = String(payload.email || '').trim()
	const businessName = String(payload.business_name || '').trim()
	const iatRaw = Number(payload.iat)
	const iat = Number.isFinite(iatRaw) ? Math.floor(iatRaw) : 0
	if (!iat || iat <= 0) return null
	if (iat - MAX_FUTURE_IAT_SKEW_SECONDS > Math.floor(Date.now() / 1000)) {
		return null
	}
	const expRaw = Number(payload.exp)
	const exp =
		Number.isFinite(expRaw) && expRaw > 0 ? Math.floor(expRaw) : undefined
	if (exp && exp <= Math.floor(Date.now() / 1000)) {
		return null
	}

	return {
		business_id: businessId,
		email:
			email || `api-key+${businessId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 12)}@crm.local`,
		business_name: businessName || 'CRM Workspace',
		iat,
		exp,
	}
}

function parseAndVerifyDeveloperApiKey(apiKey: string): DeveloperApiKeyClaims | null {
	if (!isLikelyJwt(apiKey)) return null

	const [encodedHeader, encodedPayload, encodedSignature] = apiKey.split('.')
	if (!encodedHeader || !encodedPayload || !encodedSignature) return null

	const headerPayload = decodeBase64Url(encodedHeader)
	if (!headerPayload || typeof headerPayload !== 'object' || Array.isArray(headerPayload)) {
		return null
	}
	const header = headerPayload as Record<string, unknown>
	if (String(header.alg || '') !== JWT_ALGORITHM) return null
	if (String(header.typ || '') !== JWT_TYPE) return null

	const secrets = getDeveloperApiKeyVerificationSecrets()
	if (secrets.length === 0) return null

	let isValidSignature = false
	for (const secret of secrets) {
		const expectedSignature = createHmac('sha256', secret)
			.update(`${encodedHeader}.${encodedPayload}`)
			.digest('base64url')
		if (matchesToken(expectedSignature, encodedSignature)) {
			isValidSignature = true
			break
		}
	}
	if (!isValidSignature) return null

	return normalizeClaims(decodeBase64Url(encodedPayload))
}

function signDeveloperApiKey(claims: DeveloperApiKeyClaims): string {
	const secret = getDeveloperApiKeySigningSecret()
	if (!secret) {
		throw new Error(
			'Developer API key secret missing. Set DEVELOPER_API_KEY_SECRET or BETTER_AUTH_SECRET.',
		)
	}

	const header = encodeBase64Url({
		alg: JWT_ALGORITHM,
		typ: JWT_TYPE,
	})
	const payload = encodeBase64Url(claims)
	const signature = createHmac('sha256', secret)
		.update(`${header}.${payload}`)
		.digest('base64url')

	return `${header}.${payload}.${signature}`
}

function buildClaims(identity: BusinessIdentity, issuedAt = Math.floor(Date.now() / 1000)) {
	return normalizeClaims({
		business_id: identity.businessId,
		email: identity.email,
		business_name: identity.businessName,
		iat: issuedAt,
	}) as DeveloperApiKeyClaims
}

function parseDeveloperKeyRecord(value: string): DeveloperKeyRecord | null {
	try {
		const parsed = JSON.parse(value) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null
		}

		const candidate = parsed as Partial<DeveloperKeyRecord>
		const apiKey = String(candidate.api_key || '').trim()
		if (!apiKey) return null

		return {
			api_key: apiKey,
			created_at:
				typeof candidate.created_at === 'string' && candidate.created_at.trim()
					? candidate.created_at
					: new Date().toISOString(),
			updated_at:
				typeof candidate.updated_at === 'string' && candidate.updated_at.trim()
					? candidate.updated_at
					: new Date().toISOString(),
		}
	} catch {
		return null
	}
}

function parseLookupRecord(value: string): DeveloperKeyLookupRecord | null {
	try {
		const parsed = JSON.parse(value) as unknown
		if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return null
		}

		const candidate = parsed as Partial<DeveloperKeyLookupRecord>
		const businessId = String(candidate.business_id || '').trim()
		if (!businessId) return null

		return {
			business_id: businessId,
			updated_at:
				typeof candidate.updated_at === 'string' && candidate.updated_at.trim()
					? candidate.updated_at
					: new Date().toISOString(),
		}
	} catch {
		return null
	}
}

function extractMemberEmail(
	members: Array<{ user: { email: string } | null }> | null | undefined,
): string {
	const firstEmail = members?.[0]?.user?.email
	return String(firstEmail || '').trim()
}

async function resolveBusinessIdentity(businessIdInput: string): Promise<BusinessIdentity> {
	const normalizedInput = normalizeBusinessId(businessIdInput)
	if (!normalizedInput) {
		throw new Error('Business ID required')
	}

	const orgById = await prisma.organization.findUnique({
		where: { id: normalizedInput },
		select: {
			id: true,
			name: true,
			members: {
				orderBy: { createdAt: 'asc' },
				take: 1,
				select: { user: { select: { email: true } } },
			},
		},
	})

	if (orgById) {
		return {
			businessId: orgById.id,
			businessName: String(orgById.name || '').trim() || 'CRM Workspace',
			email: extractMemberEmail(orgById.members),
		}
	}

	const orgBySlug = await prisma.organization.findUnique({
		where: { slug: normalizedInput },
		select: {
			id: true,
			name: true,
			members: {
				orderBy: { createdAt: 'asc' },
				take: 1,
				select: { user: { select: { email: true } } },
			},
		},
	})

	if (orgBySlug) {
		return {
			businessId: orgBySlug.id,
			businessName: String(orgBySlug.name || '').trim() || 'CRM Workspace',
			email: extractMemberEmail(orgBySlug.members),
		}
	}

	const appByUuid = await prisma.apps.findUnique({
		where: { id: normalizedInput },
		select: {
			app_id: true,
			app_name: true,
			business_name: true,
			organization: {
				select: {
					id: true,
					name: true,
					members: {
						orderBy: { createdAt: 'asc' },
						take: 1,
						select: { user: { select: { email: true } } },
					},
				},
			},
		},
	})

	if (appByUuid?.organization) {
		return {
			businessId: appByUuid.organization.id,
			businessName:
				String(appByUuid.organization.name || '').trim() || 'CRM Workspace',
			email: extractMemberEmail(appByUuid.organization.members),
		}
	}

	if (appByUuid) {
		return {
			businessId: normalizedInput,
			businessName:
				String(appByUuid.business_name || appByUuid.app_name || '').trim() ||
				'CRM Workspace',
			email: '',
		}
	}

	const appByPublicId = await prisma.apps.findUnique({
		where: { app_id: normalizedInput },
		select: {
			id: true,
			app_name: true,
			business_name: true,
			organization: {
				select: {
					id: true,
					name: true,
					members: {
						orderBy: { createdAt: 'asc' },
						take: 1,
						select: { user: { select: { email: true } } },
					},
				},
			},
		},
	})

	if (appByPublicId?.organization) {
		return {
			businessId: appByPublicId.organization.id,
			businessName:
				String(appByPublicId.organization.name || '').trim() || 'CRM Workspace',
			email: extractMemberEmail(appByPublicId.organization.members),
		}
	}

	if (appByPublicId) {
		return {
			businessId: appByPublicId.id,
			businessName:
				String(appByPublicId.business_name || appByPublicId.app_name || '').trim() ||
				'CRM Workspace',
			email: '',
		}
	}

	return {
		businessId: normalizedInput,
		businessName: 'CRM Workspace',
		email: '',
	}
}

async function persistDeveloperApiKey(args: {
	businessId: string
	apiKey: string
	createdAt?: string
	previousApiKey?: string | null
}) {
	const now = new Date().toISOString()
	const createdAt = args.createdAt || now
	const businessSettingsKey = buildBusinessSettingsKey(args.businessId)
	const lookupSettingsKey = buildLookupSettingsKey(args.apiKey)
	const previousLookupSettingsKey = args.previousApiKey
		? buildLookupSettingsKey(args.previousApiKey)
		: null

	await prisma.$transaction(async (tx) => {
		await tx.platform_settings.upsert({
			where: { key: businessSettingsKey },
			update: {
				value: JSON.stringify({
					api_key: args.apiKey,
					created_at: createdAt,
					updated_at: now,
				}),
				updated_at: new Date(),
			},
			create: {
				key: businessSettingsKey,
				value: JSON.stringify({
					api_key: args.apiKey,
					created_at: createdAt,
					updated_at: now,
				}),
			},
		})

		await tx.platform_settings.upsert({
			where: { key: lookupSettingsKey },
			update: {
				value: JSON.stringify({
					business_id: args.businessId,
					updated_at: now,
				}),
				updated_at: new Date(),
			},
			create: {
				key: lookupSettingsKey,
				value: JSON.stringify({
					business_id: args.businessId,
					updated_at: now,
				}),
			},
		})

		if (
			previousLookupSettingsKey &&
			previousLookupSettingsKey !== lookupSettingsKey
		) {
			await tx.platform_settings.deleteMany({
				where: { key: previousLookupSettingsKey },
			})
		}
	})

	clearRegisteredKeyCache(args.apiKey)
	if (args.previousApiKey) {
		clearRegisteredKeyCache(args.previousApiKey)
	}
}

export abstract class DeveloperKeysService {
	static async getOrCreateByBusinessId(
		businessIdInput: string,
	): Promise<DeveloperKeyRecord> {
		const identity = await resolveBusinessIdentity(businessIdInput)
		const businessId = identity.businessId

		const settingsKey = buildBusinessSettingsKey(businessId)
		const existing = await prisma.platform_settings.findUnique({
			where: { key: settingsKey },
			select: { value: true },
		})

		if (existing?.value) {
			const parsed = parseDeveloperKeyRecord(existing.value)
			const claims = parsed ? parseAndVerifyDeveloperApiKey(parsed.api_key) : null
			if (parsed && claims?.business_id === businessId) {
				await persistDeveloperApiKey({
					businessId,
					apiKey: parsed.api_key,
					createdAt: parsed.created_at,
				})
				writeRegisteredKeyCache(parsed.api_key, businessId)
				return parsed
			}
		}

		const apiKey = signDeveloperApiKey(buildClaims(identity))
		const now = new Date().toISOString()
		await persistDeveloperApiKey({
			businessId,
			apiKey,
			createdAt: now,
		})
		writeRegisteredKeyCache(apiKey, businessId)

		return {
			api_key: apiKey,
			created_at: now,
			updated_at: now,
		}
	}

	static async regenerateByBusinessId(
		businessIdInput: string,
	): Promise<DeveloperKeyRecord> {
		const identity = await resolveBusinessIdentity(businessIdInput)
		const businessId = identity.businessId

		const settingsKey = buildBusinessSettingsKey(businessId)
		const existing = await prisma.platform_settings.findUnique({
			where: { key: settingsKey },
			select: { value: true },
		})
		const previousRecord = existing?.value
			? parseDeveloperKeyRecord(existing.value)
			: null

		const createdAt = previousRecord?.created_at || new Date().toISOString()
		const updatedAt = new Date().toISOString()
		let issuedAt = Math.floor(Date.now() / 1000)
		let apiKey = signDeveloperApiKey(buildClaims(identity, issuedAt))
		if (previousRecord?.api_key && previousRecord.api_key === apiKey) {
			issuedAt += 1
			apiKey = signDeveloperApiKey(buildClaims(identity, issuedAt))
		}

		await persistDeveloperApiKey({
			businessId,
			apiKey,
			createdAt,
			previousApiKey: previousRecord?.api_key || null,
		})
		writeRegisteredKeyCache(apiKey, businessId)

		return {
			api_key: apiKey,
			created_at: createdAt,
			updated_at: updatedAt,
		}
	}

	static async resolveBusinessIdByApiKey(
		apiKeyInput: string,
	): Promise<string | null> {
		const apiKey = String(apiKeyInput || '').trim()
		if (!apiKey) return null
		const cachedBusinessId = readRegisteredKeyCache(apiKey)
		if (cachedBusinessId) return cachedBusinessId

		const lookupSettingsKey = buildLookupSettingsKey(apiKey)
		const lookup = await prisma.platform_settings.findUnique({
			where: { key: lookupSettingsKey },
			select: { value: true },
		})

		if (lookup?.value) {
			const parsedLookup = parseLookupRecord(lookup.value)
			if (parsedLookup?.business_id) {
				writeRegisteredKeyCache(apiKey, parsedLookup.business_id)
				return parsedLookup.business_id
			}
		}

		const isJwt = isLikelyJwt(apiKey)
		const jwtClaims = parseAndVerifyDeveloperApiKey(apiKey)
		if (isJwt && !jwtClaims) {
			return null
		}

		if (jwtClaims?.business_id) {
			const identity = await resolveBusinessIdentity(jwtClaims.business_id).catch(
				() => null,
			)
			const businessId = identity?.businessId || normalizeBusinessId(jwtClaims.business_id)
			if (businessId) {
				const settingsKey = buildBusinessSettingsKey(businessId)
				const existing = await prisma.platform_settings.findUnique({
					where: { key: settingsKey },
					select: { value: true },
				})
				const parsed = existing?.value
					? parseDeveloperKeyRecord(existing.value)
					: null

					if (parsed && matchesToken(parsed.api_key, apiKey)) {
						await persistDeveloperApiKey({
							businessId,
							apiKey,
							createdAt: parsed.created_at,
						})
						writeRegisteredKeyCache(apiKey, businessId)
						return businessId
					}
				}

				return null
			}

		if (!apiKey.startsWith(LEGACY_API_KEY_PREFIX)) {
			return null
		}

		const maybeBusinessKey = await prisma.platform_settings.findFirst({
			where: {
				key: { startsWith: BUSINESS_KEY_PREFIX },
				value: { contains: apiKey },
			},
			select: { key: true, value: true },
		})

		if (!maybeBusinessKey?.value) {
			return null
		}

		const parsedDeveloperKey = parseDeveloperKeyRecord(maybeBusinessKey.value)
		if (!parsedDeveloperKey || !matchesToken(parsedDeveloperKey.api_key, apiKey)) {
			return null
		}

		const businessId = maybeBusinessKey.key.slice(BUSINESS_KEY_PREFIX.length).trim()
		if (!businessId) return null

		await persistDeveloperApiKey({
			businessId,
			apiKey,
			createdAt: parsedDeveloperKey.created_at,
		})
		writeRegisteredKeyCache(apiKey, businessId)

		return businessId
	}
}
