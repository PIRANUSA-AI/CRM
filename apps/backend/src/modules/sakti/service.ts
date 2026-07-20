import prisma from '../../lib/prisma'
import { isUuid } from '../../lib/utils'
import { parseSaktiSheet } from './import'
import { findTemplate, renderLetter } from './letter-templates'

export type SaktiActor = { appId: string; userId: string | null }

function normalize(value: unknown): string {
	return String(value ?? '')
		.toLowerCase()
		.replace(/[^a-z0-9 ]/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

function tokenSet(value: unknown): Set<string> {
	return new Set(normalize(value).split(' ').filter((t) => t.length > 1))
}

function overlapCount(a: Set<string>, b: Set<string>): number {
	let n = 0
	for (const t of a) if (b.has(t)) n += 1
	return n
}

function recordDTO(row: Record<string, any>) {
	return {
		id: row.id,
		customerName: row.customer_name,
		company: row.company,
		product: row.product,
		vendor: row.vendor,
		licenseNo: row.license_no,
		purchasedAt: row.purchased_at ? row.purchased_at.toISOString() : null,
		notes: row.notes,
		source: row.source,
		createdAt: row.created_at ? row.created_at.toISOString() : null,
	}
}

function letterDTO(row: Record<string, any>) {
	return {
		id: row.id,
		contactId: row.contact_id,
		opportunityId: row.opportunity_id,
		saktiRecordId: row.sakti_record_id,
		customerName: row.customer_name,
		company: row.company,
		product: row.product,
		fromVendor: row.from_vendor,
		status: row.status,
		ourApproved: row.our_approved,
		theirApproved: row.their_approved,
		notes: row.notes,
		template: row.template || null,
		templateValues: (row.template_values as Record<string, unknown> | null) || null,
		// Rendered on read so a letter picks up corrected wording without a
		// migration — the template bodies are still placeholder copy.
		renderedBody: (() => {
			const template = findTemplate(row.template)
			if (!template) return null
			return renderLetter(template, {
				penerima: row.company || row.customer_name,
				produk: row.product || '',
				...((row.template_values as Record<string, unknown> | null) || {}),
			}).body
		})(),
		createdAt: row.created_at ? row.created_at.toISOString() : null,
		updatedAt: row.updated_at ? row.updated_at.toISOString() : null,
	}
}

export abstract class SaktiService {
	// --- Database Sakti records ---------------------------------------------

	static async listRecords(
		appId: string,
		options: { search?: string; limit?: number; offset?: number },
	) {
		// Searching the licence number too: with thousands of rows imported from
		// vendor sheets, a serial is what someone actually has in hand.
		const where = {
			app_id: appId,
			...(options.search
				? {
						OR: [
							{ customer_name: { contains: options.search, mode: 'insensitive' as const } },
							{ company: { contains: options.search, mode: 'insensitive' as const } },
							{ license_no: { contains: options.search, mode: 'insensitive' as const } },
							{ product: { contains: options.search, mode: 'insensitive' as const } },
						],
					}
				: {}),
		}
		const limit = Math.max(1, Math.min(200, options.limit || 100))
		const offset = Math.max(0, options.offset || 0)
		// Total comes back alongside the page so the table can paginate honestly
		// rather than guessing from how full the current page is.
		const [rows, total] = await Promise.all([
			prisma.sakti_records.findMany({
				where,
				orderBy: { created_at: 'desc' },
				skip: offset,
				take: limit,
			}),
			prisma.sakti_records.count({ where }),
		])
		return { data: rows.map(recordDTO), meta: { total, limit, offset } }
	}

	/**
	 * Import a CSV export of licence records. `dryRun` returns the same preview
	 * without writing, so the person importing sees what will be skipped before
	 * committing — these sheets are re-sent often and re-importing one must not
	 * double the database.
	 */
	static async importRecords(
		actor: SaktiActor,
		input: { content: string; dryRun?: boolean },
	) {
		const content = String(input.content || '')
		if (!content.trim()) throw new Error('File CSV kosong')

		const existingRows = await prisma.sakti_records.findMany({
			where: { app_id: actor.appId },
			select: { license_no: true, customer_name: true, product: true },
		})
		const licenseNos = new Set(
			existingRows
				.map((r) => (r.license_no || '').toLowerCase())
				.filter((value) => value.length > 0),
		)
		const keys = new Set(
			existingRows.map(
				(r) => `${r.customer_name.toLowerCase()}|${(r.product || '').toLowerCase()}`,
			),
		)

		const preview = parseSaktiSheet(content, { licenseNos, keys })
		if (input.dryRun) return { ...preview, imported: 0 }

		const importable = preview.rows.filter((row) => row.status === 'ok')
		if (importable.length > 0) {
			await prisma.sakti_records.createMany({
				data: importable.map((row) => ({
					app_id: actor.appId,
					customer_name: row.customerName.slice(0, 255),
					company: row.company?.slice(0, 255) || null,
					product: row.product?.slice(0, 120) || null,
					vendor: row.vendor?.slice(0, 255) || null,
					license_no: row.licenseNo?.slice(0, 120) || null,
					purchased_at: row.purchasedAt,
					notes: row.notes,
					source: 'import',
				})),
			})
		}
		return { ...preview, imported: importable.length }
	}

	static async createRecord(
		actor: SaktiActor,
		input: {
			customerName: string
			company?: string | null
			product?: string | null
			vendor?: string | null
			licenseNo?: string | null
			notes?: string | null
		},
	) {
		const name = input.customerName?.trim()
		if (!name) throw new Error('Nama customer wajib diisi')
		const row = await prisma.sakti_records.create({
			data: {
				app_id: actor.appId,
				customer_name: name.slice(0, 255),
				company: input.company?.slice(0, 255) || null,
				product: input.product?.slice(0, 120) || null,
				vendor: input.vendor?.slice(0, 255) || null,
				license_no: input.licenseNo?.slice(0, 120) || null,
				notes: input.notes || null,
				source: 'manual',
			},
		})
		return recordDTO(row)
	}

	static async removeRecord(appId: string, id: string) {
		if (!isUuid(id)) return false
		const result = await prisma.sakti_records.deleteMany({ where: { id, app_id: appId } })
		return result.count > 0
	}

	// --- The Sakti check -----------------------------------------------------

	/**
	 * Match a lead's name + company against the Database Sakti. Deterministic
	 * token matching: a company-name overlap is a strong signal; otherwise a
	 * strong customer-name overlap. Returns matched records ranked by score and
	 * a recommendation — a foreign license means a Surat Sakti is required
	 * before the lead can become our opportunity.
	 */
	static async check(
		appId: string,
		input: { name: string; company?: string | null; product?: string | null },
	) {
		const nameTokens = tokenSet(input.name)
		const companyTokens = tokenSet(input.company)
		const records = await prisma.sakti_records.findMany({
			where: { app_id: appId },
			take: 2000,
		})

		const scored = records
			.map((row) => {
				const recName = tokenSet(row.customer_name)
				const recCompany = tokenSet(row.company)
				const nameOverlap = overlapCount(nameTokens, recName)
				const companyOverlap = overlapCount(companyTokens, recCompany)
				const score = companyOverlap * 2 + nameOverlap
				return { row, score, nameOverlap, companyOverlap }
			})
			// A match needs either a company-name overlap, or at least two
			// customer-name tokens in common (avoids single-common-name false hits).
			.filter((m) => m.companyOverlap > 0 || m.nameOverlap >= 2)
			.sort((a, b) => b.score - a.score)
			.slice(0, 10)

		const matched = scored.length > 0
		return {
			matched,
			recommendation: matched ? ('surat_sakti' as const) : ('opportunity' as const),
			message: matched
				? 'Lisensi ditemukan di vendor lain — perlu Surat Sakti (alih lisensi) sebelum jadi opportunity kita.'
				: 'Tidak ditemukan lisensi di vendor lain — lead bersih, bisa langsung jadi opportunity kita.',
			records: scored.map((m) => ({ ...recordDTO(m.row), score: m.score })),
		}
	}

	// --- Surat Sakti letters -------------------------------------------------

	static async listLetters(appId: string, options: { status?: string }) {
		const rows = await prisma.surat_sakti.findMany({
			where: {
				app_id: appId,
				...(options.status ? { status: options.status } : {}),
			},
			orderBy: { created_at: 'desc' },
			take: 200,
		})
		return rows.map(letterDTO)
	}

	static async createLetter(
		actor: SaktiActor,
		input: {
			customerName: string
			company?: string | null
			product?: string | null
			fromVendor?: string | null
			contactId?: string | null
			opportunityId?: string | null
			saktiRecordId?: string | null
			notes?: string | null
			template?: string | null
			templateValues?: Record<string, unknown> | null
		},
	) {
		const name = input.customerName?.trim()
		if (!name) throw new Error('Nama customer wajib diisi')

		// An unknown template id is rejected rather than stored: a letter that
		// silently renders nothing is worse than one that fails to save.
		let template: string | null = null
		if (input.template) {
			const found = findTemplate(input.template)
			if (!found) throw new Error(`Template surat "${input.template}" tidak dikenal`)
			template = found.id
		}

		const row = await prisma.surat_sakti.create({
			data: {
				app_id: actor.appId,
				contact_id: input.contactId || null,
				opportunity_id: input.opportunityId || null,
				sakti_record_id: input.saktiRecordId || null,
				customer_name: name.slice(0, 255),
				company: input.company?.slice(0, 255) || null,
				product: input.product?.slice(0, 120) || null,
				from_vendor: input.fromVendor?.slice(0, 255) || null,
				status: 'draft',
				notes: input.notes || null,
				template,
				template_values: (input.templateValues || undefined) as never,
				created_by: actor.userId,
			},
		})
		return letterDTO(row)
	}

	/** Fill a template without saving — used by the live preview in the form. */
	static previewLetter(templateId: string, values: Record<string, unknown>) {
		const template = findTemplate(templateId)
		if (!template) throw new Error('Template surat tidak dikenal')
		const { body, missing } = renderLetter(template, values)
		return { template: template.id, name: template.name, body, missing }
	}

	static async updateLetter(
		appId: string,
		id: string,
		input: {
			status?: string
			ourApproved?: boolean
			theirApproved?: boolean
			notes?: string | null
		},
	) {
		if (!isUuid(id)) return null
		const existing = await prisma.surat_sakti.findFirst({
			where: { id, app_id: appId },
			select: { our_approved: true, their_approved: true, status: true },
		})
		if (!existing) return null

		const ourApproved = input.ourApproved ?? existing.our_approved
		const theirApproved = input.theirApproved ?? existing.their_approved

		// Derive status from the two approvals unless explicitly rejected.
		let status = input.status ?? existing.status
		if (status !== 'rejected') {
			if (ourApproved && theirApproved) status = 'approved'
			else if (ourApproved || theirApproved) status = 'pending'
			else status = 'draft'
		}

		const row = await prisma.surat_sakti.update({
			where: { id },
			data: {
				our_approved: ourApproved,
				their_approved: theirApproved,
				status,
				...(input.notes !== undefined ? { notes: input.notes || null } : {}),
			},
		})
		return letterDTO(row)
	}

	static async removeLetter(appId: string, id: string) {
		if (!isUuid(id)) return false
		const result = await prisma.surat_sakti.deleteMany({ where: { id, app_id: appId } })
		return result.count > 0
	}
}
