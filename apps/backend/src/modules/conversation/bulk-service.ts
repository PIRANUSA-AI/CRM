import type { Job } from 'bullmq'
import prisma from '../../lib/prisma'
import { conversationBulkQueue } from '../../lib/queue'
import { isUuid } from '../../lib/utils'
import { CRMService } from '../crm/service'
import { LabelService } from '../label/service'
import { ConversationService } from './service'

export type ConversationResolveStatus = 'open' | 'pending' | 'resolved'

export type ConversationBulkEditChanges = {
	collaboratorIds?: string[]
	handledById?: string
	labelId?: string
	pipelineStageId?: string
	resolveStatus?: ConversationResolveStatus
}

export type ConversationBulkEditJobData = {
	appId: string
	actorId: string | null
	conversationIds: string[]
	changes: ConversationBulkEditChanges
}

const BULK_EDIT_JOB_NAME = 'conversation-bulk-update'

type ConversationSnapshot = {
	id: string
	status: string | null
	assignee_id: string | null
	pipeline_id: string | null
	stage_id: string | null
}

function normalizeUniqueUuidList(values: unknown): string[] {
	if (!Array.isArray(values)) return []

	const unique = new Set<string>()
	for (const value of values) {
		if (typeof value !== 'string') continue
		const normalized = value.trim()
		if (!isUuid(normalized)) continue
		unique.add(normalized)
	}

	return Array.from(unique)
}

function normalizeOptionalUuid(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim()
	return isUuid(normalized) ? normalized : undefined
}

function normalizeResolveStatus(
	value: unknown,
): ConversationResolveStatus | undefined {
	if (typeof value !== 'string') return undefined
	const normalized = value.trim().toLowerCase()
	if (normalized === 'open') return 'open'
	if (normalized === 'pending') return 'pending'
	if (normalized === 'resolved') return 'resolved'
	return undefined
}

function normalizeChanges(raw: ConversationBulkEditChanges): ConversationBulkEditChanges {
	const normalized: ConversationBulkEditChanges = {}

	const collaboratorIds = normalizeUniqueUuidList(raw.collaboratorIds)
	if (collaboratorIds.length > 0) {
		normalized.collaboratorIds = collaboratorIds
	}

	const handledById = normalizeOptionalUuid(raw.handledById)
	if (handledById) normalized.handledById = handledById

	const labelId = normalizeOptionalUuid(raw.labelId)
	if (labelId) normalized.labelId = labelId

	const pipelineStageId = normalizeOptionalUuid(raw.pipelineStageId)
	if (pipelineStageId) normalized.pipelineStageId = pipelineStageId

	const resolveStatus = normalizeResolveStatus(raw.resolveStatus)
	if (resolveStatus) normalized.resolveStatus = resolveStatus

	return normalized
}

function hasAnyChanges(changes: ConversationBulkEditChanges): boolean {
	return Boolean(
		(changes.collaboratorIds && changes.collaboratorIds.length > 0) ||
			changes.handledById ||
			changes.labelId ||
			changes.pipelineStageId ||
			changes.resolveStatus,
	)
}

function toErrorMessage(error: unknown): string {
	if (error instanceof Error && error.message) return error.message
	return String(error || 'Unknown error')
}

export abstract class ConversationBulkEditService {
	static async enqueueBulkEdit(input: {
		appId: string
		actorId?: string | null
		conversationIds: string[]
		changes: ConversationBulkEditChanges
	}) {
		const conversationIds = normalizeUniqueUuidList(input.conversationIds)
		if (conversationIds.length === 0) {
			throw new Error('At least one valid conversation is required')
		}

		const changes = normalizeChanges(input.changes)
		if (!hasAnyChanges(changes)) {
			throw new Error('Please choose at least one bulk action')
		}

		await this.validateChangeScope(input.appId, changes)

		const appScopedCount = await prisma.conversations.count({
			where: {
				app_id: input.appId,
				id: { in: conversationIds },
			},
		})
		if (appScopedCount === 0) {
			throw new Error('No selected conversations belong to the current app')
		}

		const job = await conversationBulkQueue.add(
			BULK_EDIT_JOB_NAME,
			{
				appId: input.appId,
				actorId: normalizeOptionalUuid(input.actorId) || null,
				conversationIds,
				changes,
			} satisfies ConversationBulkEditJobData,
			{
				attempts: 3,
				backoff: {
					type: 'exponential',
					delay: 2_000,
				},
				removeOnComplete: 2000,
				removeOnFail: 2000,
			},
		)

		return {
			jobId: String(job.id),
			requested: conversationIds.length,
		}
	}

	static async getBulkEditJobStatus(appId: string, jobId: string) {
		const job = await conversationBulkQueue.getJob(jobId)
		if (!job) return null

		const data = (job.data || {}) as ConversationBulkEditJobData
		if (data.appId !== appId) return null

		const state = await job.getState()

		return {
			jobId: String(job.id),
			state,
			progress: job.progress,
			result: state === 'completed' ? job.returnvalue || null : null,
			error: state === 'failed' ? job.failedReason || 'Job failed' : null,
			requested: data.conversationIds?.length || 0,
			createdAt: job.timestamp ? new Date(job.timestamp).toISOString() : null,
			finishedAt: job.finishedOn ? new Date(job.finishedOn).toISOString() : null,
		}
	}

	static async processBulkEditJob(job: Job<ConversationBulkEditJobData>) {
		const data = (job.data || {}) as ConversationBulkEditJobData
		const conversationIds = normalizeUniqueUuidList(data.conversationIds)
		const changes = normalizeChanges(data.changes || {})

		const snapshots = await prisma.conversations.findMany({
			where: {
				app_id: data.appId,
				id: { in: conversationIds },
			},
			select: {
				id: true,
				status: true,
				assignee_id: true,
				pipeline_id: true,
				stage_id: true,
			},
		})

		const totalTargeted = snapshots.length
		const failures: Array<{ conversationId: string; error: string }> = []
		let processed = 0
		let updated = 0

		await job.updateProgress({
			totalTargeted,
			processed,
			updated,
			failed: failures.length,
		})

		for (const snapshot of snapshots) {
			try {
				await this.processSingleConversation(snapshot, data.appId, changes, {
					actorId: normalizeOptionalUuid(data.actorId) || null,
					jobId: String(job.id),
				})
				updated += 1
			} catch (error) {
				failures.push({
					conversationId: snapshot.id,
					error: toErrorMessage(error),
				})
			}

			processed += 1

			await job.updateProgress({
				totalTargeted,
				processed,
				updated,
				failed: failures.length,
				currentConversationId: snapshot.id,
			})
		}

		return {
			totalRequested: conversationIds.length,
			totalTargeted,
			processed,
			updated,
			failed: failures.length,
			skipped: Math.max(0, conversationIds.length - totalTargeted),
			failures,
		}
	}

	private static async validateChangeScope(
		appId: string,
		changes: ConversationBulkEditChanges,
	) {
		if (changes.labelId) {
			const label = await prisma.labels.findFirst({
				where: {
					id: changes.labelId,
					app_id: appId,
					is_visible: true,
				},
				select: { id: true },
			})
			if (!label) throw new Error('Selected label is not available in this app')
		}

		if (changes.pipelineStageId) {
			const stage = await prisma.pipeline_stages.findFirst({
				where: {
					id: changes.pipelineStageId,
					pipelines: { app_id: appId },
				},
				select: { id: true },
			})
			if (!stage) {
				throw new Error('Selected pipeline stage is not available in this app')
			}
		}
	}

	private static async processSingleConversation(
		snapshot: ConversationSnapshot,
		appId: string,
		changes: ConversationBulkEditChanges,
		context: { actorId: string | null; jobId: string },
	) {
		const appliedChanges: Record<string, unknown> = {}

		if (changes.handledById) {
			await ConversationService.assignAgent(snapshot.id, changes.handledById)
			appliedChanges.handled_by = changes.handledById
		}

		if (changes.collaboratorIds && changes.collaboratorIds.length > 0) {
			await this.syncCollaborators({
				conversationId: snapshot.id,
				collaboratorIds: changes.collaboratorIds,
				actorId: context.actorId,
				primaryAgentId: changes.handledById || snapshot.assignee_id || null,
			})
			appliedChanges.collaborators = changes.collaboratorIds
		}

		if (changes.labelId) {
			await this.addLabelIfNeeded(snapshot.id, changes.labelId)
			appliedChanges.label_id = changes.labelId
		}

		if (changes.pipelineStageId) {
			await this.updatePipelineStage(snapshot, appId, changes.pipelineStageId, {
				actorId: context.actorId,
			})
			appliedChanges.pipeline_stage_id = changes.pipelineStageId
		}

		if (changes.resolveStatus) {
			const currentStatus = String(snapshot.status || 'open').toLowerCase()
			if (currentStatus !== changes.resolveStatus) {
				await ConversationService.updateStatus(snapshot.id, changes.resolveStatus)
				appliedChanges.resolve_status = changes.resolveStatus
			}
		}

		await prisma.conversation_activity_log.create({
			data: {
				conversation_id: snapshot.id,
				action: 'bulk_updated',
				actor_id: context.actorId,
				metadata: {
					job_id: context.jobId,
					changes: appliedChanges,
				} as any,
			},
		})
	}

	private static async addLabelIfNeeded(conversationId: string, labelId: string) {
		const existing = await prisma.conversation_labels.findUnique({
			where: {
				conversation_id_label_id: {
					conversation_id: conversationId,
					label_id: labelId,
				},
			},
			select: {
				label_id: true,
			},
		})

		if (existing) return
		await LabelService.addLabelToConversation(conversationId, labelId)
	}

	private static async updatePipelineStage(
		snapshot: ConversationSnapshot,
		appId: string,
		stageId: string,
		context: { actorId: string | null },
	) {
		const targetStage = await prisma.pipeline_stages.findFirst({
			where: {
				id: stageId,
				pipelines: { app_id: appId },
			},
			select: {
				id: true,
				pipeline_id: true,
			},
		})

		if (!targetStage) {
			throw new Error('Pipeline stage not found')
		}

		await prisma.conversation_sales.upsert({
			where: { conversation_id: snapshot.id },
			update: {},
			create: {
				conversation_id: snapshot.id,
				pipeline_id: snapshot.pipeline_id,
				stage_id: snapshot.stage_id,
				updated_at: new Date(),
			},
		})

		await CRMService.updateDeal(
			snapshot.id,
			{
				pipeline_id: targetStage.pipeline_id,
				stage_id: targetStage.id,
			},
			context.actorId || undefined,
		)
	}

	private static async syncCollaborators(input: {
		conversationId: string
		collaboratorIds: string[]
		actorId: string | null
		primaryAgentId: string | null
	}) {
		const collaboratorIds = normalizeUniqueUuidList(input.collaboratorIds)
		const primaryAgentId =
			input.primaryAgentId && isUuid(input.primaryAgentId)
				? input.primaryAgentId
				: null

		if (primaryAgentId && !collaboratorIds.includes(primaryAgentId)) {
			collaboratorIds.push(primaryAgentId)
		}

		if (collaboratorIds.length === 0) return

		const now = new Date()

		const existingRows = await prisma.conversation_agents.findMany({
			where: {
				conversation_id: input.conversationId,
				agent_id: { in: collaboratorIds },
			},
			orderBy: [{ assigned_at: 'desc' }, { id: 'desc' }],
		})

		const latestByAgentId = new Map<string, (typeof existingRows)[number]>()
		for (const row of existingRows) {
			if (!latestByAgentId.has(row.agent_id)) {
				latestByAgentId.set(row.agent_id, row)
			}
		}

		for (const collaboratorId of collaboratorIds) {
			const existing = latestByAgentId.get(collaboratorId)
			const shouldBePrimary = primaryAgentId
				? collaboratorId === primaryAgentId
				: undefined

			if (existing) {
				await prisma.conversation_agents.update({
					where: { id: existing.id },
					data: {
						status: 'active',
						removed_at: null,
						removed_by: null,
						...(shouldBePrimary !== undefined
							? { is_primary: shouldBePrimary }
							: {}),
					},
				})

				await prisma.conversation_agents.updateMany({
					where: {
						conversation_id: input.conversationId,
						agent_id: collaboratorId,
						status: 'active',
						id: { not: existing.id },
					},
					data: {
						status: 'inactive',
						is_primary: false,
						removed_at: now,
						...(input.actorId ? { removed_by: input.actorId } : {}),
					},
				})
			} else {
				await prisma.conversation_agents.create({
					data: {
						conversation_id: input.conversationId,
						agent_id: collaboratorId,
						assigned_by: input.actorId || undefined,
						assigned_at: now,
						status: 'active',
						...(shouldBePrimary !== undefined
							? { is_primary: shouldBePrimary }
							: {}),
					},
				})
			}
		}

		await prisma.conversation_agents.updateMany({
			where: {
				conversation_id: input.conversationId,
				status: 'active',
				agent_id: { notIn: collaboratorIds },
			},
			data: {
				status: 'inactive',
				is_primary: false,
				removed_at: now,
				...(input.actorId ? { removed_by: input.actorId } : {}),
			},
		})
	}
}
