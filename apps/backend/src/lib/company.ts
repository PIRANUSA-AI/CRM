/**
 * Resolving free-text company names to `companies` rows.
 *
 * Every path that accepts a company name from a human — the contact form, the
 * CSV import, a prospect entered off the back of a WhatsApp chat — goes through
 * `resolveCompany` so that two people typing the same firm differently still
 * land on one row. The normalisation is deliberately conservative: it collapses
 * casing, punctuation and Indonesian legal forms, and nothing else. It does NOT
 * do fuzzy matching, because merging "PT Maju" into "PT Maju Jaya" when they
 * are genuinely different customers is a far worse outcome than two rows a
 * leader can merge by hand.
 */
import { Prisma } from '../generated/prisma'
import prisma from './prisma'

type Client = Prisma.TransactionClient | typeof prisma

/**
 * Legal forms that carry no identity — a firm is "Maju Jaya" whether it is
 * written PT, CV or UD. Stripped from both ends because "Maju Jaya, PT" is a
 * common way to write it on invoices.
 */
const LEGAL_FORMS = ['pt', 'cv', 'ud', 'pd', 'persero', 'tbk', 'perum', 'koperasi']

/**
 * The key a company is deduplicated on. Returns an empty string for anything
 * that normalises away to nothing (punctuation only, or a bare "PT"), which
 * callers must treat as "no company given" rather than creating a nameless row.
 */
export function normalizeCompanyName(raw: string | null | undefined): string {
	if (!raw) return ''

	let value = raw.toLowerCase()
	// Anything that is not a letter or digit becomes a single space, so
	// "PT. Maju-Jaya" and "PT Maju Jaya" converge before the words are compared.
	value = value.replace(/[^a-z0-9]+/g, ' ').trim()
	if (!value) return ''

	// Guarded on length so "Persero Baja" keeps a word rather than stripping to
	// nothing — the firm is "Baja", not blank.
	const words = value.split(' ')
	while (words.length > 1 && LEGAL_FORMS.includes(words[0])) words.shift()
	while (words.length > 1 && LEGAL_FORMS.includes(words[words.length - 1])) words.pop()

	// That guard leaves a lone legal form intact, so a contact whose company was
	// typed as just "PT" would normalise to "pt" — and every other bare "PT"
	// would then join onto that one row as if they were the same firm. A legal
	// form on its own names nobody, so it is treated as no company at all.
	if (words.length === 1 && LEGAL_FORMS.includes(words[0])) return ''

	return words.join(' ').slice(0, 255)
}

/**
 * Tidy a name for display without changing what it is. The stored `name` keeps
 * the legal form — dropping "PT" from what a leader reads would be wrong — so
 * this only squashes whitespace.
 */
export function displayCompanyName(raw: string): string {
	return raw.replace(/\s+/g, ' ').trim().slice(0, 255)
}

export type ResolveCompanyInput = {
	appId: string
	name: string | null | undefined
	city?: string | null
}

/**
 * Find the company for `name`, creating it if this is the first time we have
 * seen it. Returns null when the name is blank or normalises to nothing — the
 * caller should leave `company_id` null and keep whatever text it was given.
 *
 * Safe to call concurrently: the unique index on (app_id, norm_name) is the
 * real arbiter, and a lost race is resolved by reading back the winner rather
 * than surfacing a constraint error to whoever submitted the form second.
 */
export async function resolveCompany(
	client: Client,
	input: ResolveCompanyInput,
): Promise<string | null> {
	const norm = normalizeCompanyName(input.name)
	if (!norm) return null

	const existing = await client.companies.findFirst({
		where: { app_id: input.appId, norm_name: norm, deleted_at: null },
		select: { id: true },
	})
	if (existing) return existing.id

	const name = displayCompanyName(String(input.name))
	try {
		const created = await client.companies.create({
			data: {
				app_id: input.appId,
				name,
				norm_name: norm,
				city: input.city?.trim() || null,
			},
			select: { id: true },
		})
		return created.id
	} catch (error) {
		if (
			error instanceof Prisma.PrismaClientKnownRequestError &&
			error.code === 'P2002'
		) {
			const winner = await client.companies.findFirst({
				where: { app_id: input.appId, norm_name: norm },
				select: { id: true },
			})
			return winner?.id ?? null
		}
		throw error
	}
}

/**
 * Point a contact at a company, resolving the name first. Keeps the free-text
 * `company` column in step so a contact never displays one firm and links to
 * another — the text stays the fallback, not a second opinion.
 */
export async function setContactCompany(
	client: Client,
	params: { appId: string; contactId: string; name: string | null | undefined },
): Promise<string | null> {
	const companyId = await resolveCompany(client, {
		appId: params.appId,
		name: params.name,
	})

	await client.contacts.update({
		where: { id: params.contactId },
		data: {
			company_id: companyId,
			company: params.name ? displayCompanyName(params.name) : null,
			updated_at: new Date(),
		},
	})

	return companyId
}
