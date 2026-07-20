import { setContactOwner } from '../../lib/contact-ownership'
import prisma from '../../lib/prisma'
import { getRealtimeIO } from '../../lib/realtime'
import { isMultiTeamRole, type CanonicalRole } from '../../lib/require-role'
import { DEFAULT_STAGE_ID, resolveStage } from '../opportunities/stages'
import {
	isClosedStage,
	isValidEmail,
	mapConsent,
	mapHeaders,
	normalizePhone,
	parseAmount,
	parseCsv,
	parseIntSafe,
	parseIsoDate,
	splitTags,
	type CanonicalField,
} from './parser'

export type ImportActor = {
	appId: string
	userId: string
	role: CanonicalRole
}

export class ImportNotFoundError extends Error {}
export class ImportError extends Error {}

type RowStatus = 'ok' | 'warning' | 'error'

type MappedRow = {
	name: string
	contact_title: string | null
	phone: string | null
	email: string | null
	company: string | null
	industry: string | null
	company_size: string | null
	city: string | null
	province: string | null
	country: string | null
	source: string | null
	product_interest: string | null
	pipeline_stage: string | null
	lead_score: number | null
	probability: number | null
	estimated_value: number | null
	currency: string | null
	assigned_to: string | null
	last_contact_at: string | null
	next_followup_at: string | null
	expected_close_date: string | null
	external_id: string | null
	notes: string | null
	tags: string[]
	consent_status: string
}

type Assignable = { userId: string; teamId: string | null; name: string | null; email: string }

const REQUIRED_HEADERS: CanonicalField[] = ['name', 'phone']

function cell(row: string[], index: number | undefined): string {
	if (index === undefined) return ''
	return String(row[index] ?? '').trim()
}

export const PROSPECT_CHANNELS = [
	'event',
	'linkedin',
	'instagram',
	'whatsapp',
	'referral',
	'other',
] as const
export type ProspectChannel = (typeof PROSPECT_CHANNELS)[number]

const PROSPECT_CHANNEL_LABEL: Record<ProspectChannel, string> = {
	event: 'Event',
	linkedin: 'LinkedIn',
	instagram: 'Instagram',
	whatsapp: 'WhatsApp',
	referral: 'Referral',
	other: 'Lainnya',
}

function normalizeProspectChannel(value: string | null | undefined): ProspectChannel {
	const v = String(value || '').trim().toLowerCase()
	return (PROSPECT_CHANNELS as readonly string[]).includes(v) ? (v as ProspectChannel) : 'other'
}

/** First team the actor belongs to within the current app, or null. */
async function resolveOwnTeamId(actor: ImportActor): Promise<string | null> {
	const appTeams = await prisma.teams.findMany({
		where: { app_id: actor.appId, deleted_at: null },
		select: { id: true },
	})
	const appTeamIds = appTeams.map((team) => team.id)
	if (!appTeamIds.length) return null
	const membership = await prisma.team_members.findFirst({
		where: { team_id: { in: appTeamIds }, user_id: actor.userId },
		select: { team_id: true },
	})
	return membership?.team_id || null
}

function priorityForStage(stage: string | null): string {
	const s = String(stage || '').toLowerCase()
	if (s.includes('negosiasi')) return 'high'
	if (s.includes('penawaran')) return 'high'
	if (s.includes('kualifikasi') || s.includes('dihubungi')) return 'medium'
	return 'low'
}

/**
 * Users the actor may assign imported leads to.
 * - leader: only members that share a team with the leader (task gets that team_id).
 * - ceo/superadmin: any active sales/leader in the app.
 */
async function resolveAssignables(actor: ImportActor): Promise<Map<string, Assignable>> {
	const appTeams = await prisma.teams.findMany({
		where: { app_id: actor.appId, deleted_at: null },
		select: { id: true },
	})
	const appTeamIds = appTeams.map((team) => team.id)
	const appMembers = appTeamIds.length
		? await prisma.team_members.findMany({
				where: { team_id: { in: appTeamIds } },
				select: { team_id: true, user_id: true },
			})
		: []

	const userTeams = new Map<string, string[]>()
	for (const member of appMembers) {
		const list = userTeams.get(member.user_id) || []
		list.push(member.team_id)
		userTeams.set(member.user_id, list)
	}
	const leaderTeamIds = userTeams.get(actor.userId) || []

	const users = await prisma.users.findMany({
		where: {
			app_id: actor.appId,
			deleted_at: null,
			active: true,
			role: { in: ['sales', 'leader'] },
		},
		select: { id: true, name: true, email: true },
	})

	const map = new Map<string, Assignable>()
	for (const user of users) {
		if (!user.email) continue
		const teamsOfUser = userTeams.get(user.id) || []
		let teamId: string | null = null
		if (actor.role === 'leader') {
			const shared = teamsOfUser.find((id) => leaderTeamIds.includes(id))
			if (!shared) continue // leader can only assign within their team
			teamId = shared
		} else {
			teamId = teamsOfUser[0] || null
		}
		map.set(user.email.trim().toLowerCase(), {
			userId: user.id,
			teamId,
			name: user.name,
			email: user.email,
		})
	}
	return map
}

function buildMappedRow(
	row: string[],
	mapping: Partial<Record<CanonicalField, number>>,
): { mapped: MappedRow; raw: Record<string, string> } {
	const get = (field: CanonicalField) => cell(row, mapping[field])
	const raw: Record<string, string> = {}
	for (const [field, index] of Object.entries(mapping)) {
		raw[field] = cell(row, index as number)
	}
	const mapped: MappedRow = {
		name: get('name'),
		contact_title: get('contact_title') || null,
		phone: normalizePhone(get('phone')),
		email: get('email') || null,
		company: get('company') || null,
		industry: get('industry') || null,
		company_size: get('company_size') || null,
		city: get('city') || null,
		province: get('province') || null,
		country: get('country') || null,
		source: get('source') || null,
		product_interest: get('product_interest') || null,
		pipeline_stage: get('pipeline_stage') || null,
		lead_score: parseIntSafe(get('lead_score')),
		probability: parseIntSafe(get('probability')),
		estimated_value: parseAmount(get('estimated_value')),
		currency: get('currency') || null,
		assigned_to: get('assigned_to') ? get('assigned_to').toLowerCase() : null,
		last_contact_at: get('last_contact_at') || null,
		next_followup_at: get('next_followup_at') || null,
		expected_close_date: get('expected_close_date') || null,
		external_id: get('external_id') || null,
		notes: get('notes') || null,
		tags: splitTags(get('tags')),
		consent_status: mapConsent(get('consent_status')),
	}
	return { mapped, raw }
}

function validateRow(
	mapped: MappedRow,
	rawPhone: string,
	assignables: Map<string, Assignable>,
): { status: RowStatus; messages: string[]; assignee: Assignable | null } {
	const messages: string[] = []
	let status: RowStatus = 'ok'
	let assignee: Assignable | null = null

	if (!mapped.name) {
		messages.push('Nama kosong')
		status = 'error'
	}
	if (!mapped.phone) {
		messages.push(
			rawPhone ? `Nomor telepon tidak valid: "${rawPhone}"` : 'Nomor telepon kosong',
		)
		if (!mapped.email) status = 'error'
		else if (status !== 'error') status = 'warning'
	}
	if (mapped.email && !isValidEmail(mapped.email)) {
		messages.push(`Email tidak valid: "${mapped.email}"`)
		if (status !== 'error') status = 'warning'
	}
	for (const [label, value] of [
		['last_contact_at', mapped.last_contact_at],
		['next_followup_at', mapped.next_followup_at],
		['expected_close_date', mapped.expected_close_date],
	] as const) {
		if (value && !parseIsoDate(value)) {
			messages.push(`Tanggal ${label} tidak valid: "${value}"`)
			if (status !== 'error') status = 'warning'
		}
	}

	if (mapped.assigned_to) {
		assignee = assignables.get(mapped.assigned_to) || null
		if (!assignee) {
			messages.push(
				`Assignee "${mapped.assigned_to}" tidak ditemukan / di luar tim Anda — pilih manual`,
			)
			if (status !== 'error') status = 'warning'
		}
	} else if (!isClosedStage(mapped.pipeline_stage)) {
		messages.push('Belum ada assignee — pilih sales tujuan')
		if (status !== 'error') status = 'warning'
	}

	return { status, messages, assignee }
}

export abstract class ImportService {
	static async preview(actor: ImportActor, filename: string | null, content: string) {
		const table = parseCsv(content)
		if (table.headers.length === 0) throw new ImportError('CSV kosong atau tidak terbaca')
		const { mapping, unmapped } = mapHeaders(table.headers)
		const missing = REQUIRED_HEADERS.filter((field) => mapping[field] === undefined)
		if (missing.length) {
			throw new ImportError(`Kolom wajib tidak ditemukan: ${missing.join(', ')}`)
		}
		if (table.rows.length === 0) throw new ImportError('CSV tidak memiliki baris data')

		const assignables = await resolveAssignables(actor)

		const job = await prisma.import_jobs.create({
			data: {
				app_id: actor.appId,
				created_by: actor.userId,
				source: 'csv',
				filename: filename || 'leads.csv',
				status: 'preview',
				total_rows: table.rows.length,
			},
		})

		const rowsData = table.rows.map((row, index) => {
			const { mapped, raw } = buildMappedRow(row, mapping)
			const rawPhone = cell(row, mapping.phone)
			const { status, messages, assignee } = validateRow(mapped, rawPhone, assignables)
			return {
				job_id: job.id,
				row_number: index + 1,
				raw,
				mapped: { ...mapped, _resolved_assignee_name: assignee?.name || null, _team_id: assignee?.teamId || null } as object,
				resolved_assignee_id: assignee?.userId || null,
				status,
				messages,
			}
		})

		await prisma.import_job_rows.createMany({ data: rowsData })

		return ImportService.getJob(actor, job.id, {
			assignableOptions: [...assignables.values()].map((a) => ({ email: a.email, name: a.name })),
			unmappedHeaders: unmapped,
		})
	}

	static async getJob(
		actor: ImportActor,
		jobId: string,
		extra?: { assignableOptions?: Array<{ email: string; name: string | null }>; unmappedHeaders?: string[] },
	) {
		const job = await prisma.import_jobs.findFirst({
			where: { id: jobId, app_id: actor.appId },
		})
		if (!job) throw new ImportNotFoundError('Import job tidak ditemukan')
		if (actor.role === 'leader' && job.created_by !== actor.userId) {
			throw new ImportNotFoundError('Import job tidak ditemukan')
		}
		const rows = await prisma.import_job_rows.findMany({
			where: { job_id: jobId },
			orderBy: { row_number: 'asc' },
		})
		return {
			job: {
				id: job.id,
				filename: job.filename,
				status: job.status,
				totalRows: job.total_rows,
				imported: job.imported,
				updated: job.updated,
				skipped: job.skipped,
				errors: job.errors,
				tasksCreated: job.tasks_created,
				createdAt: job.created_at,
				completedAt: job.completed_at,
			},
			rows: rows.map((row) => ({
				id: row.id,
				rowNumber: row.row_number,
				status: row.status,
				messages: row.messages,
				mapped: row.mapped,
				resolvedAssigneeId: row.resolved_assignee_id,
				contactId: row.contact_id,
				taskId: row.task_id,
			})),
			...(extra?.assignableOptions ? { assignableOptions: extra.assignableOptions } : {}),
			...(extra?.unmappedHeaders ? { unmappedHeaders: extra.unmappedHeaders } : {}),
		}
	}

	static async updateRowAssignee(
		actor: ImportActor,
		jobId: string,
		rowId: string,
		assignedTo: string | null,
	) {
		const job = await prisma.import_jobs.findFirst({ where: { id: jobId, app_id: actor.appId } })
		if (!job || (actor.role === 'leader' && job.created_by !== actor.userId)) {
			throw new ImportNotFoundError('Import job tidak ditemukan')
		}
		if (job.status !== 'preview') throw new ImportError('Import sudah diproses, tidak bisa diubah')
		const row = await prisma.import_job_rows.findFirst({ where: { id: rowId, job_id: jobId } })
		if (!row) throw new ImportNotFoundError('Baris tidak ditemukan')

		const assignables = await resolveAssignables(actor)
		const mapped = { ...(row.mapped as Record<string, unknown>) }
		const email = assignedTo ? assignedTo.trim().toLowerCase() : null
		const assignee = email ? assignables.get(email) || null : null

		const messages: string[] = []
		let status: RowStatus = 'ok'
		if (mapped.name === '' || mapped.name === null || mapped.name === undefined) {
			status = 'error'
			messages.push('Nama kosong')
		}
		if (!mapped.phone && !mapped.email) {
			status = 'error'
			messages.push('Tanpa telepon & email')
		}
		if (email && !assignee) {
			messages.push(`Assignee "${email}" di luar tim Anda`)
			if (status !== 'error') status = 'warning'
		}
		if (!email && !isClosedStage(String(mapped.pipeline_stage || ''))) {
			messages.push('Belum ada assignee')
			if (status !== 'error') status = 'warning'
		}

		mapped.assigned_to = email
		mapped._resolved_assignee_name = assignee?.name || null
		mapped._team_id = assignee?.teamId || null

		await prisma.import_job_rows.update({
			where: { id: rowId },
			data: { mapped: mapped as object, resolved_assignee_id: assignee?.userId || null, status, messages },
		})
		return ImportService.getJob(actor, jobId)
	}

	static async commit(actor: ImportActor, jobId: string) {
		const job = await prisma.import_jobs.findFirst({ where: { id: jobId, app_id: actor.appId } })
		if (!job || (actor.role === 'leader' && job.created_by !== actor.userId)) {
			throw new ImportNotFoundError('Import job tidak ditemukan')
		}
		if (job.status !== 'preview') throw new ImportError('Import sudah diproses')

		await prisma.import_jobs.update({ where: { id: jobId }, data: { status: 'processing' } })

		const rows = await prisma.import_job_rows.findMany({
			where: { job_id: jobId },
			orderBy: { row_number: 'asc' },
		})

		let imported = 0
		let updated = 0
		let skipped = 0
		let errors = 0
		let tasksCreated = 0
		const errorLog: Array<{ row: number; reason: string }> = []
		const now = new Date()

		for (const row of rows) {
			if (row.status === 'error') {
				skipped += 1
				errorLog.push({ row: row.row_number, reason: (row.messages as string[])?.join('; ') || 'error' })
				continue
			}
			const mapped = row.mapped as unknown as MappedRow & { _team_id?: string | null }
			try {
				const result = await prisma.$transaction(async (tx) => {
					const orConds: Array<Record<string, unknown>> = []
					if (mapped.phone) {
						orConds.push({ phone_number: mapped.phone })
						orConds.push({ whatsapp_id: mapped.phone })
					}
					if (mapped.email) orConds.push({ email: mapped.email })
					const existing = orConds.length
						? await tx.contacts.findFirst({
								where: { app_id: actor.appId, deleted_at: null, OR: orConds },
							})
						: null

					// `assigned_user_id` is dropped rather than carried forward: ownership
					// now lives in contacts.owner_id, and leaving a stale copy in the
					// JSON would recreate the two-sources-of-truth problem the column
					// was added to end. See lib/contact-ownership.ts.
					const { assigned_user_id: _legacyOwner, ...priorAttributes } =
						(existing?.custom_attributes as Record<string, unknown>) || {}

					const customAttributes = {
						...priorAttributes,
						contact_title: mapped.contact_title,
						industry: mapped.industry,
						company_size: mapped.company_size,
						province: mapped.province,
						product_interest: mapped.product_interest,
						pipeline_stage: mapped.pipeline_stage,
						lead_score: mapped.lead_score,
						probability: mapped.probability,
						estimated_value: mapped.estimated_value,
						currency: mapped.currency,
						expected_close_date: mapped.expected_close_date,
						external_id: mapped.external_id,
						tags: mapped.tags,
						last_contact_at: mapped.last_contact_at,
						next_followup_at: mapped.next_followup_at,
						import_notes: mapped.notes,
					}

					const contactData = {
						name: mapped.name || existing?.name || mapped.phone || 'Lead',
						email: mapped.email || existing?.email || null,
						phone_number: mapped.phone || existing?.phone_number || null,
						whatsapp_id: mapped.phone || existing?.whatsapp_id || null,
						company: mapped.company || existing?.company || null,
						city: mapped.city || existing?.city || null,
						country: mapped.country || existing?.country || null,
						source: mapped.source || existing?.source || 'import',
						consent_status: mapped.consent_status,
						custom_attributes: customAttributes as object,
						channel_type: existing?.channel_type || 'whatsapp',
						updated_at: now,
					}

					let contactId: string
					let wasUpdate = false
					if (existing) {
						await tx.contacts.update({ where: { id: existing.id }, data: contactData })
						contactId = existing.id
						wasUpdate = true
					} else {
						const created = await tx.contacts.create({
							data: {
								app_id: actor.appId,
								identifier: mapped.phone ? `wa:${actor.appId}:${mapped.phone}` : null,
								first_contact_at: now,
								created_at: now,
								...contactData,
							},
						})
						contactId = created.id
					}

					// An imported row names its sales, so the contact arrives already
					// owned. Rows with no assignee stay in the intake pool.
					await setContactOwner(tx, {
						contactId,
						ownerId: row.resolved_assignee_id || null,
						teamId: mapped._team_id || undefined,
					})

					let taskId: string | null = null
					const closed = isClosedStage(mapped.pipeline_stage)
					if (!closed && row.resolved_assignee_id) {
						const dueAt = parseIsoDate(mapped.next_followup_at) || new Date(now.getTime() + 3 * 24 * 3600_000)
						const title = `Follow-up ${mapped.product_interest || 'lead'} — ${mapped.name}`.slice(0, 255)
						const task = await tx.tasks.create({
							data: {
								app_id: actor.appId,
								assignee_id: row.resolved_assignee_id,
								team_id: mapped._team_id || null,
								created_by: actor.userId,
								contact_id: contactId,
								action_kind: 'follow_up',
								title,
								description: mapped.notes,
								priority: priorityForStage(mapped.pipeline_stage),
								status: 'open',
								due_at: dueAt,
								source: 'import',
								ai_snapshot: {},
							},
						})
						await tx.task_events.create({
							data: {
								task_id: task.id,
								event_type: 'created',
								actor_id: actor.userId,
								metadata: { source: 'import', job_id: jobId, row: row.row_number },
							},
						})
						taskId = task.id
					}

					await tx.import_job_rows.update({
						where: { id: row.id },
						data: { status: taskId ? 'imported' : 'skipped', contact_id: contactId, task_id: taskId },
					})
					return { wasUpdate, taskCreated: Boolean(taskId) }
				})
				if (result.wasUpdate) updated += 1
				else imported += 1
				if (result.taskCreated) tasksCreated += 1
			} catch (error) {
				errors += 1
				errorLog.push({
					row: row.row_number,
					reason: error instanceof Error ? error.message : String(error),
				})
				await prisma.import_job_rows.update({
					where: { id: row.id },
					data: { status: 'error', messages: [error instanceof Error ? error.message : 'gagal'] },
				})
			}
		}

		const finalized = await prisma.import_jobs.update({
			where: { id: jobId },
			data: {
				status: 'completed',
				imported,
				updated,
				skipped,
				errors,
				tasks_created: tasksCreated,
				error_log: errorLog as object,
				completed_at: new Date(),
			},
		})

		getRealtimeIO()?.to(`app:${actor.appId}`).emit('import:completed', {
			jobId,
			imported,
			updated,
			skipped,
			errors,
			tasksCreated,
		})

		return {
			id: finalized.id,
			status: finalized.status,
			imported,
			updated,
			skipped,
			errors,
			tasksCreated,
			errorLog,
		}
	}

	// Sales the actor may assign a lead to (for the manual add-lead dropdown).
	static async listAssignables(actor: ImportActor) {
		const assignables = await resolveAssignables(actor)
		return [...assignables.values()]
			.map((a) => ({ userId: a.userId, name: a.name, email: a.email }))
			.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
	}

	// Manual single-lead entry by a leader — mirrors the CSV commit path:
	// create/update the contact and (unless the stage is closed) a follow-up task
	// assigned to the chosen sales.
	static async createManualLead(
		actor: ImportActor,
		input: {
			name: string
			phone?: string | null
			email?: string | null
			company?: string | null
			city?: string | null
			productInterest?: string | null
			pipelineStage?: string | null
			notes?: string | null
			assignedTo: string
		},
	) {
		const name = String(input.name || '').trim()
		if (!name) throw new ImportError('Nama lead wajib diisi')

		const phone = input.phone ? normalizePhone(String(input.phone)) : null
		const rawEmail = input.email ? String(input.email).trim().toLowerCase() : ''
		if (rawEmail && !isValidEmail(rawEmail)) throw new ImportError('Format email tidak valid')
		const email = rawEmail || null
		if (!phone && !email) throw new ImportError('Isi minimal nomor WhatsApp atau email')

		const assignables = await resolveAssignables(actor)
		const assignee = [...assignables.values()].find((a) => a.userId === input.assignedTo)
		if (!assignee) throw new ImportError('Sales tujuan tidak valid atau di luar tim Anda')

		const now = new Date()
		const pipelineStage = input.pipelineStage?.trim() || null
		const productInterest = input.productInterest?.trim() || null
		const notes = input.notes?.trim() || null

		const result = await prisma.$transaction(async (tx) => {
			const orConds: Array<Record<string, unknown>> = []
			if (phone) {
				orConds.push({ phone_number: phone })
				orConds.push({ whatsapp_id: phone })
			}
			if (email) orConds.push({ email })
			const existing = orConds.length
				? await tx.contacts.findFirst({
						where: { app_id: actor.appId, deleted_at: null, OR: orConds },
					})
				: null

			// See the note on the bulk path above: ownership moved to contacts.owner_id.
			const { assigned_user_id: _legacyOwner, ...priorAttributes } =
				(existing?.custom_attributes as Record<string, unknown>) || {}

			const customAttributes = {
				...priorAttributes,
				product_interest: productInterest,
				pipeline_stage: pipelineStage,
				import_notes: notes,
			}
			const contactData = {
				name: name || existing?.name || phone || 'Lead',
				email: email || existing?.email || null,
				phone_number: phone || existing?.phone_number || null,
				whatsapp_id: phone || existing?.whatsapp_id || null,
				company: input.company?.trim() || existing?.company || null,
				city: input.city?.trim() || existing?.city || null,
				source: existing?.source || 'manual',
				custom_attributes: customAttributes as object,
				channel_type: existing?.channel_type || 'whatsapp',
				updated_at: now,
			}

			let contactId: string
			let wasUpdate = false
			if (existing) {
				await tx.contacts.update({ where: { id: existing.id }, data: contactData })
				contactId = existing.id
				wasUpdate = true
			} else {
				const created = await tx.contacts.create({
					data: {
						app_id: actor.appId,
						identifier: phone ? `wa:${actor.appId}:${phone}` : null,
						first_contact_at: now,
						created_at: now,
						...contactData,
					},
				})
				contactId = created.id
			}

			await setContactOwner(tx, {
				contactId,
				ownerId: assignee.userId,
				teamId: assignee.teamId || undefined,
			})

			let taskId: string | null = null
			if (!isClosedStage(pipelineStage)) {
				const dueAt = new Date(now.getTime() + 3 * 24 * 3600_000)
				const title = `Follow-up ${productInterest || 'lead'} — ${name}`.slice(0, 255)
				const task = await tx.tasks.create({
					data: {
						app_id: actor.appId,
						assignee_id: assignee.userId,
						team_id: assignee.teamId || null,
						created_by: actor.userId,
						contact_id: contactId,
						action_kind: 'follow_up',
						title,
						description: notes,
						priority: priorityForStage(pipelineStage),
						status: 'open',
						due_at: dueAt,
						source: 'manual',
						ai_snapshot: {},
					},
				})
				await tx.task_events.create({
					data: {
						task_id: task.id,
						event_type: 'created',
						actor_id: actor.userId,
						metadata: { source: 'manual_lead' },
					},
				})
				taskId = task.id
			}
			return { contactId, taskId, wasUpdate }
		})

		return {
			contactId: result.contactId,
			taskId: result.taskId,
			updated: result.wasUpdate,
			assigneeName: assignee.name,
		}
	}

	/**
	 * Sales-owned prospecting: a sales enters a lead they sourced themselves
	 * (event, LinkedIn, sosmed, referral…). The contact is created/updated and a
	 * follow-up task is always assigned to the sales (self), due on the date they
	 * pick (defaults to tomorrow 09:00). Leaders/ceo may also use it to log their
	 * own prospects.
	 */
	static async createProspect(
		actor: ImportActor,
		input: {
			name: string
			phone?: string | null
			email?: string | null
			company?: string | null
			city?: string | null
			productInterest?: string | null
			channel?: string | null
			notes?: string | null
			followUpAt?: string | null
			assigneeId?: string | null
		},
	) {
		const name = String(input.name || '').trim()
		if (!name) throw new ImportError('Nama prospek wajib diisi')

		const phone = input.phone ? normalizePhone(String(input.phone)) : null
		const rawEmail = input.email ? String(input.email).trim().toLowerCase() : ''
		if (rawEmail && !isValidEmail(rawEmail)) throw new ImportError('Format email tidak valid')
		const email = rawEmail || null
		if (!phone && !email) throw new ImportError('Isi minimal nomor WhatsApp atau email')

		const channel = normalizeProspectChannel(input.channel)

		// Resolve the follow-up date: the sales-picked date, else tomorrow 09:00.
		let dueAt: Date
		if (input.followUpAt) {
			const parsed = new Date(input.followUpAt)
			if (Number.isNaN(parsed.getTime())) throw new ImportError('Tanggal follow-up tidak valid')
			dueAt = parsed
		} else {
			dueAt = new Date()
			dueAt.setDate(dueAt.getDate() + 1)
			dueAt.setHours(9, 0, 0, 0)
		}

		// A sales keeps their own prospect. A leader hands it to a sales — they
		// assign leads rather than work them, so a task in a leader's name has no
		// one actually following it up (same rule the lead router enforces).
		let assigneeId = actor.userId
		let teamId: string | null
		const chosen = String(input.assigneeId || '').trim()
		// An administrator oversees every team and carries no leads of their own,
		// so a prospect they enter must name who will work it — a sales or a
		// leader, both of whom sell. A leader or sales keeps their own prospect
		// unless they explicitly hand it to someone in their team.
		if (isMultiTeamRole(actor.role) && !chosen) {
			throw new ImportError('Pilih sales atau leader yang akan menangani prospek ini')
		}
		if (chosen && chosen !== actor.userId) {
			const assignables = await resolveAssignables(actor)
			const target = [...assignables.values()].find((a) => a.userId === chosen)
			if (!target) throw new ImportError('Penerima tidak ditemukan atau di luar tim Anda')
			assigneeId = target.userId
			teamId = target.teamId
		} else {
			if (isMultiTeamRole(actor.role)) {
				throw new ImportError('Prospek harus ditugaskan ke sales atau leader')
			}
			teamId = await resolveOwnTeamId(actor)
		}

		const now = new Date()
		const productInterest = input.productInterest?.trim() || null
		const notes = input.notes?.trim() || null

		const result = await prisma.$transaction(async (tx) => {
			const orConds: Array<Record<string, unknown>> = []
			if (phone) {
				orConds.push({ phone_number: phone })
				orConds.push({ whatsapp_id: phone })
			}
			if (email) orConds.push({ email })
			const existing = orConds.length
				? await tx.contacts.findFirst({
						where: { app_id: actor.appId, deleted_at: null, OR: orConds },
					})
				: null

			// See the note on the bulk path above: ownership moved to contacts.owner_id.
			const { assigned_user_id: _legacyOwner, ...priorAttributes } =
				(existing?.custom_attributes as Record<string, unknown>) || {}

			const customAttributes = {
				...priorAttributes,
				product_interest: productInterest,
				prospect_channel: channel,
				import_notes: notes,
			}
			const contactData = {
				name: name || existing?.name || phone || 'Prospek',
				email: email || existing?.email || null,
				phone_number: phone || existing?.phone_number || null,
				whatsapp_id: phone || existing?.whatsapp_id || null,
				company: input.company?.trim() || existing?.company || null,
				city: input.city?.trim() || existing?.city || null,
				source: existing?.source || `prospect:${channel}`,
				custom_attributes: customAttributes as object,
				channel_type: existing?.channel_type || 'whatsapp',
				updated_at: now,
			}

			let contactId: string
			let wasUpdate = false
			if (existing) {
				await tx.contacts.update({ where: { id: existing.id }, data: contactData })
				contactId = existing.id
				wasUpdate = true
			} else {
				const created = await tx.contacts.create({
					data: {
						app_id: actor.appId,
						identifier: phone ? `wa:${actor.appId}:${phone}` : null,
						first_contact_at: now,
						created_at: now,
						...contactData,
					},
				})
				contactId = created.id
			}

			// The owner is the assignee, not the creator. The old JSON key recorded
			// `actor.userId`, so a prospect an administrator entered on someone
			// else's behalf was owned by the administrator while the follow-up task
			// sat with the sales — the contact list and the task list disagreed
			// about whose prospect it was.
			await setContactOwner(tx, { contactId, ownerId: assigneeId, teamId: teamId || undefined })

			const title = `Follow-up prospek ${PROSPECT_CHANNEL_LABEL[channel]} — ${name}`.slice(0, 255)
			const task = await tx.tasks.create({
				data: {
					app_id: actor.appId,
					assignee_id: assigneeId,
					team_id: teamId,
					created_by: actor.userId,
					contact_id: contactId,
					action_kind: 'prospect_followup',
					title,
					description: notes,
					priority: 'medium',
					status: 'open',
					due_at: dueAt,
					source: 'prospect',
					ai_snapshot: { prospect: { channel, productInterest } },
				},
			})
			await tx.task_events.create({
				data: {
					task_id: task.id,
					event_type: 'created',
					actor_id: actor.userId,
					metadata: { source: 'prospect', channel },
				},
			})

			// Open a deal so the prospect shows up in Pipeline without anyone
			// re-typing it. Created in the same transaction as the contact and task
			// because a prospect that exists without its deal is invisible on the
			// page meant to track it. Skipped when the contact already has an open
			// deal — re-adding a prospect should not fork their pipeline.
			const openDeal = await tx.opportunities.findFirst({
				where: { app_id: actor.appId, contact_id: contactId, status: 'open' },
				select: { id: true },
			})
			let dealId: string | null = openDeal?.id ?? null
			if (!openDeal) {
				const stage = resolveStage(DEFAULT_STAGE_ID)
				const deal = await tx.opportunities.create({
					data: {
						app_id: actor.appId,
						contact_id: contactId,
						owner_id: assigneeId,
						team_id: teamId,
						name: productInterest ? `${name} — ${productInterest}` : name,
						product: productInterest,
						currency: 'IDR',
						status: stage.status,
						stage: stage.id,
						probability: stage.probability,
						source: `prospect:${channel}`,
						created_by: actor.userId,
					},
					select: { id: true },
				})
				dealId = deal.id
			}

			return { contactId, taskId: task.id, dealId, wasUpdate }
		})

		return {
			contactId: result.contactId,
			taskId: result.taskId,
			dealId: result.dealId,
			updated: result.wasUpdate,
			dueAt: dueAt.toISOString(),
			channel,
		}
	}

	static async history(actor: ImportActor) {
		const jobs = await prisma.import_jobs.findMany({
			where: {
				app_id: actor.appId,
				...(actor.role === 'leader' ? { created_by: actor.userId } : {}),
			},
			orderBy: { created_at: 'desc' },
			take: 50,
		})
		return jobs.map((job) => ({
			id: job.id,
			filename: job.filename,
			status: job.status,
			totalRows: job.total_rows,
			imported: job.imported,
			updated: job.updated,
			skipped: job.skipped,
			errors: job.errors,
			tasksCreated: job.tasks_created,
			createdAt: job.created_at,
			completedAt: job.completed_at,
		}))
	}
}
