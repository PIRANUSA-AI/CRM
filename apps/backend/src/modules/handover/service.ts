import prisma from '../../lib/prisma'
import { resolveAppId, isUuid } from '../../lib/utils'
import { getRealtimeIO } from '../../lib/realtime'
import { ConversationService } from '../conversation/service'
import { DecisionEngineService } from '../flow/decision-engine-service'
import { STAFF_ROSTER_ROLES } from '../../lib/require-role'

export type HandoverRequestType = 'take' | 'reassign'
export type HandoverStatus = 'pending' | 'approved' | 'rejected'

export interface CreateHandoverRequest {
	conversationId: string
	requestType: HandoverRequestType
	requestedBy: string
	targetAgentId?: string
	requestNote?: string
	sourceRuleId?: string
}

export interface CreateWorkflowApprovalRequest {
	conversationId: string
	intent?: string | null
	reason?: string | null
	targetAgentId?: string | null
	sourceRuleId?: string | null
	approvalEscalationMinutes?: number[]
}

export interface HandoverQueueItem {
	id: string
	conversationId: string
	contactName: string
	contactPhone: string
	contactAvatar?: string
	preview: string
	reason: string
	intent: string
	aiConfidence: number
	waitingSeconds: number
	priority: 'urgent' | 'high' | 'medium'
	suggestedAgentId?: string
	suggestedAgentName?: string
	approvalState: 'pending' | 'approved' | 'rejected'
	slaDueAt?: Date
	sourceRuleId?: string
	createdAt: Date
}

export interface HandoverRuleItem {
	id: string
	name: string
	conditions: Record<string, unknown>
	action: string
	isActive: boolean
	triggered7d: number
	priority: number
	ruleType: string
}

export interface AgentRosterItem {
	id: string
	name: string
	email: string
	avatarUrl?: string
	role: string
	status: 'online' | 'offline' | 'break'
	activeChats: number
	capacity: number
	skills: string[]
}

export interface HandoverAnalytics {
	handoverRate: number
	avgWaitTimeSeconds: number
	slaCompliance: number
	csatPostHandover: number
	period: string
	totalRequests: number
	approvedRequests: number
	rejectedRequests: number
	pendingRequests: number
}

export interface HandoverLogItem {
	id: string
	conversationId: string
	action: string
	actorId?: string
	actorName?: string
	actorType: string
	targetId?: string
	targetName?: string
	metadata: Record<string, unknown>
	createdAt: Date
}

type EscalationPendingRow = {
	id: string
	conversation_id: string
	ai_intent: string | null
	escalation_count: number | null
	approval_deadline_at: Date | null
	created_at: Date | null
}

type HandoverStatusRow = {
	id: string
	app_id: string
	conversation_id: string
	status: string | null
	target_agent_id: string | null
	approval_deadline_at: Date | null
	escalation_count: number | null
	escalated_at: Date | null
	triage_status: string | null
	triage_note: string | null
	created_at: Date | null
	updated_at: Date | null
}

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

export abstract class HandoverService {
	static async getQueue(appId: string): Promise<HandoverQueueItem[]> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []

		const sevenDaysAgo = new Date()
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

		const pendingConversations = await prisma.conversations.findMany({
			where: {
				app_id: targetAppId,
				OR: [
					{ status: 'pending' },
					{
						additional_attributes: {
							path: ['handover', 'approval_state'],
							equals: 'pending',
						},
					},
				],
			},
			include: {
				contacts: {
					select: {
						name: true,
						phone_number: true,
						avatar_url: true,
						identifier: true,
					},
				},
				messages: {
					orderBy: { created_at: 'desc' },
					take: 1,
					select: {
						content: true,
					},
				},
			},
			orderBy: { last_message_at: 'desc' },
		})

		const conversationIds = pendingConversations.map((c) => c.id)

		const handoverRequests = conversationIds.length
			? await prisma.handover_requests.findMany({
					where: {
						conversation_id: { in: conversationIds },
						created_at: { gte: sevenDaysAgo },
					},
					orderBy: { created_at: 'desc' },
				})
			: []

		const requestsByConversationId = new Map<string, typeof handoverRequests[0]>()
		for (const request of handoverRequests) {
			if (!requestsByConversationId.has(request.conversation_id)) {
				requestsByConversationId.set(request.conversation_id, request)
			}
		}

		const defaultPolicy = await prisma.sla_policies.findFirst({
			where: {
				app_id: targetAppId,
				is_active: true,
				is_default: true,
			},
		})

		const queueItems: HandoverQueueItem[] = []
		for (const conv of pendingConversations) {
			const request = requestsByConversationId.get(conv.id)
			const additionalAttrs =
				conv.additional_attributes &&
				typeof conv.additional_attributes === 'object' &&
				!Array.isArray(conv.additional_attributes)
					? (conv.additional_attributes as Record<string, unknown>)
					: {}

			const handoverState = additionalAttrs.handover as
				| { approval_state?: string; latest_request_id?: string }
				| undefined

			const approvalState = (handoverState?.approval_state as HandoverStatus) || 'pending'

			let slaDueAt: Date | undefined
			if (conv.last_message_at && defaultPolicy) {
				slaDueAt = new Date(conv.last_message_at)
				slaDueAt.setMinutes(slaDueAt.getMinutes() + defaultPolicy.first_response_time)
			} else if (request?.sla_due_at) {
				slaDueAt = request.sla_due_at
			}

			const priority = this.calculatePriority(conv)

			const waitingSeconds = conv.last_message_at
				? Math.floor((Date.now() - new Date(conv.last_message_at).getTime()) / 1000)
				: 0

			const lastMessage = conv.messages[0]?.content || ''
			const preview = lastMessage.length > 60 ? lastMessage.substring(0, 60) + '...' : lastMessage

			const aiAnalytics = additionalAttrs.ai_analytics_last as
				| { intent?: string; confidence?: number }
				| undefined

			queueItems.push({
				id: request?.id || conv.id,
				conversationId: conv.id,
				contactName: conv.contacts?.name || conv.contacts?.identifier || 'Unknown',
				contactPhone: conv.contacts?.phone_number || '',
				contactAvatar: conv.contacts?.avatar_url || undefined,
				preview,
				reason: this.deriveReason(request?.ai_reason, aiAnalytics?.intent),
				intent: aiAnalytics?.intent || request?.ai_intent || 'unknown',
				aiConfidence: aiAnalytics?.confidence || (request?.ai_intent ? 0.5 : 0),
				waitingSeconds,
				priority,
				suggestedAgentId: request?.target_agent_id || undefined,
				suggestedAgentName: undefined,
				approvalState,
				slaDueAt,
				sourceRuleId: request?.source_rule_id || undefined,
				createdAt: request?.created_at || conv.created_at || new Date(),
			})
		}

		return queueItems
	}

	static async createRequest(
		appId: string,
		data: CreateHandoverRequest,
		userRole: string,
	): Promise<{ request: any; autoApproved: boolean }> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('App ID required')

		if (!isUuid(data.conversationId)) {
			throw new Error('Invalid conversation ID')
		}

		const conversation = await prisma.conversations.findUnique({
			where: { id: data.conversationId },
			include: { contacts: true },
		})

		if (!conversation) {
			throw new Error('Conversation not found')
		}

		const isSupervisorOrAdmin = userRole === 'leader' || userRole === 'ceo' || userRole === 'superadmin'
		const status = isSupervisorOrAdmin ? 'approved' : 'pending'

		const aiReason = await this.generateAiReason(data.conversationId)
		const intent = await this.extractIntent(data.conversationId)

		let slaDueAt: Date | undefined
		const defaultPolicy = await prisma.sla_policies.findFirst({
			where: { app_id: targetAppId, is_active: true, is_default: true },
		})
		if (conversation.last_message_at && defaultPolicy) {
			slaDueAt = new Date(conversation.last_message_at)
			slaDueAt.setMinutes(slaDueAt.getMinutes() + defaultPolicy.first_response_time)
		}

		const sourceRuleId = data.sourceRuleId || (await this.evaluateEscalationRoute(conversation))

		const request = await prisma.handover_requests.create({
			data: {
				app_id: targetAppId,
				conversation_id: data.conversationId,
				request_type: data.requestType,
				requested_by: data.requestedBy,
				target_agent_id: data.targetAgentId,
				status,
				request_note: data.requestNote,
				ai_reason: aiReason,
				ai_intent: intent,
				sla_due_at: slaDueAt,
				source_rule_id: sourceRuleId,
			},
		})

		const approvalState = status === 'approved' ? 'approved' : 'pending'
		const additionalAttrs =
			conversation.additional_attributes &&
			typeof conversation.additional_attributes === 'object' &&
			!Array.isArray(conversation.additional_attributes)
				? (conversation.additional_attributes as Record<string, unknown>)
				: {}

		await prisma.conversations.update({
			where: { id: data.conversationId },
			data: {
				status: approvalState === 'pending' ? 'pending' : conversation.status,
				additional_attributes: {
					...additionalAttrs,
					handover: {
						...((additionalAttrs.handover as Record<string, unknown>) || {}),
						approval_state: approvalState,
						latest_request_id: request.id,
					},
				} as any,
				updated_at: new Date(),
			},
		})

		await this.logActivity({
			conversationId: data.conversationId,
			action: status === 'approved' ? 'handover_approved' : 'handover_requested',
			actorId: data.requestedBy,
			actorType: 'user',
			targetId: data.targetAgentId,
			metadata: {
				request_id: request.id,
				request_type: data.requestType,
				status,
				auto_approved: isSupervisorOrAdmin,
			},
		})

		if (status === 'approved' && data.targetAgentId) {
			await ConversationService.assignAgent(
				data.conversationId,
				data.targetAgentId,
				'manual',
			)
		}

		this.emitHandoverEvent(targetAppId, 'handover:request_created', {
			requestId: request.id,
			conversationId: data.conversationId,
			status,
		})

		return { request, autoApproved: isSupervisorOrAdmin }
	}

	static async createWorkflowApprovalRequest(
		appId: string,
		data: CreateWorkflowApprovalRequest,
	): Promise<{ request: any; created: boolean }> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('App ID required')

		if (!isUuid(data.conversationId)) {
			throw new Error('Invalid conversation ID')
		}

		const conversation = await prisma.conversations.findUnique({
			where: { id: data.conversationId },
			select: {
				id: true,
				app_id: true,
				additional_attributes: true,
			},
		})
		if (!conversation || conversation.app_id !== targetAppId) {
			throw new Error('Conversation not found')
		}

		let targetAgentId =
			typeof data.targetAgentId === 'string' && isUuid(data.targetAgentId)
				? data.targetAgentId
				: null
		if (!targetAgentId) {
			targetAgentId = await DecisionEngineService.resolveBestAssignee({
				appId: targetAppId,
				intent: data.intent || null,
			})
		}

		const existingPending =
			await DecisionEngineService.getLatestPendingHandoverRequest({
				appId: targetAppId,
				conversationId: data.conversationId,
			})
		if (existingPending?.id) {
			if (targetAgentId) {
				await prisma.handover_requests.update({
					where: { id: existingPending.id },
					data: {
						target_agent_id: targetAgentId,
						updated_at: new Date(),
					},
				})
			}
			const current = await prisma.handover_requests.findUnique({
				where: { id: existingPending.id },
			})
			return {
				request: current,
				created: false,
			}
		}

		const requestNote =
			asString(data.reason) ||
			'Workflow decision engine triggered approval gate before handover.'
		const request = await prisma.handover_requests.create({
			data: {
				app_id: targetAppId,
				conversation_id: data.conversationId,
				request_type: 'reassign',
				requested_by: null,
				target_agent_id: targetAgentId,
				status: 'pending',
				request_note: requestNote,
				ai_reason: requestNote,
				ai_intent: asString(data.intent),
				source_rule_id:
					typeof data.sourceRuleId === 'string' && isUuid(data.sourceRuleId)
						? data.sourceRuleId
						: null,
			},
		})

		const escalationMinutes =
			Array.isArray(data.approvalEscalationMinutes) &&
			data.approvalEscalationMinutes.length > 0
				? data.approvalEscalationMinutes
						.map((value) => Math.max(1, Math.round(Number(value))))
						.filter((value) => Number.isFinite(value))
				: [5, 15, 30]
		const deadline = new Date(
			Date.now() + (escalationMinutes[0] || 5) * 60 * 1000,
		)
		await prisma.$executeRawUnsafe(
			`
				UPDATE "handover_requests"
				SET
					"approval_deadline_at" = $2::timestamptz,
					"escalation_count" = 0,
					"triage_status" = 'none',
					"updated_at" = NOW()
				WHERE "id" = $1::uuid
			`,
			request.id,
			deadline,
		)

		const additionalAttrs = asRecord(conversation.additional_attributes)
		await prisma.conversations.update({
			where: { id: data.conversationId },
			data: {
				status: 'pending',
				additional_attributes: {
					...additionalAttrs,
					handover: {
						...asRecord(additionalAttrs.handover),
						approval_state: 'pending',
						latest_request_id: request.id,
						triage_status: 'none',
					},
				} as any,
				updated_at: new Date(),
			},
		})

		await this.logActivity({
			conversationId: data.conversationId,
			action: 'handover_requested',
			actorType: 'system',
			targetId: targetAgentId || undefined,
			metadata: {
				request_id: request.id,
				request_type: 'reassign',
				status: 'pending',
				trigger: 'workflow_decision_engine',
				intent: data.intent || null,
				approval_deadline_at: deadline.toISOString(),
			},
		})

		this.emitHandoverEvent(targetAppId, 'handover:request_created', {
			requestId: request.id,
			conversationId: data.conversationId,
			status: 'pending',
		})

		const current = await prisma.handover_requests.findUnique({
			where: { id: request.id },
		})
		return {
			request: current,
			created: true,
		}
	}

	static async approveRequest(
		requestId: string,
		approverId: string,
		approvalNote?: string,
	): Promise<any> {
		if (!isUuid(requestId)) throw new Error('Invalid request ID')

		const request = await prisma.handover_requests.findUnique({
			where: { id: requestId },
		})

		if (!request) throw new Error('Request not found')
		if (request.status !== 'pending') {
			throw new Error('Request is not pending')
		}

		const updatedRequest = await prisma.handover_requests.update({
			where: { id: requestId },
			data: {
				status: 'approved',
				approved_by: approverId,
				approved_at: new Date(),
				approval_note: approvalNote,
			},
		})

		const conversation = await prisma.conversations.findUnique({
			where: { id: request.conversation_id },
		})

		const additionalAttrs =
			conversation?.additional_attributes &&
			typeof conversation?.additional_attributes === 'object' &&
			!Array.isArray(conversation?.additional_attributes)
				? (conversation?.additional_attributes as Record<string, unknown>)
				: {}

		await prisma.conversations.update({
			where: { id: request.conversation_id },
			data: {
				status: 'open',
				additional_attributes: {
					...additionalAttrs,
					handover: {
						...((additionalAttrs.handover as Record<string, unknown>) || {}),
						approval_state: 'approved',
						latest_request_id: requestId,
					},
				} as any,
				updated_at: new Date(),
			},
		})

		let assignedAgentId = request.target_agent_id || null
		if (!assignedAgentId && request.app_id) {
			assignedAgentId = await DecisionEngineService.resolveBestAssignee({
				appId: request.app_id,
				intent: request.ai_intent,
			})
			if (assignedAgentId) {
				await prisma.handover_requests.update({
					where: { id: requestId },
					data: {
						target_agent_id: assignedAgentId,
						updated_at: new Date(),
					},
				})
			}
		}

		if (assignedAgentId) {
			await ConversationService.assignAgent(
				request.conversation_id,
				assignedAgentId,
				'manual',
			)
		}

		await this.logActivity({
			conversationId: request.conversation_id,
			action: 'handover_approved',
			actorId: approverId,
			actorType: 'user',
			targetId: assignedAgentId || undefined,
			metadata: {
				request_id: requestId,
				approval_note: approvalNote,
			},
		})

		if (request.app_id) {
			this.emitHandoverEvent(request.app_id, 'handover:request_approved', {
				requestId,
				conversationId: request.conversation_id,
			})
		}

		return updatedRequest
	}

	static async rejectRequest(
		requestId: string,
		rejecterId: string,
		rejectionNote?: string,
	): Promise<any> {
		if (!isUuid(requestId)) throw new Error('Invalid request ID')

		const request = await prisma.handover_requests.findUnique({
			where: { id: requestId },
		})

		if (!request) throw new Error('Request not found')
		if (request.status !== 'pending') {
			throw new Error('Request is not pending')
		}

		const updatedRequest = await prisma.handover_requests.update({
			where: { id: requestId },
			data: {
				status: 'rejected',
				rejected_by: rejecterId,
				rejected_at: new Date(),
				approval_note: rejectionNote,
			},
		})

		const conversation = await prisma.conversations.findUnique({
			where: { id: request.conversation_id },
		})

		const additionalAttrs =
			conversation?.additional_attributes &&
			typeof conversation?.additional_attributes === 'object' &&
			!Array.isArray(conversation?.additional_attributes)
				? (conversation?.additional_attributes as Record<string, unknown>)
				: {}

		await prisma.conversations.update({
			where: { id: request.conversation_id },
			data: {
				status: 'open',
				additional_attributes: {
					...additionalAttrs,
					handover: {
						...((additionalAttrs.handover as Record<string, unknown>) || {}),
						approval_state: 'rejected',
						latest_request_id: requestId,
					},
				} as any,
				updated_at: new Date(),
			},
		})

		await this.logActivity({
			conversationId: request.conversation_id,
			action: 'handover_rejected',
			actorId: rejecterId,
			actorType: 'user',
			metadata: {
				request_id: requestId,
				rejection_note: rejectionNote,
			},
		})

		if (request.app_id) {
			this.emitHandoverEvent(request.app_id, 'handover:request_rejected', {
				requestId,
				conversationId: request.conversation_id,
			})
		}

		return updatedRequest
	}

	static async getRequestStatus(appId: string, requestId: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) throw new Error('App ID required')
		if (!isUuid(requestId)) throw new Error('Invalid request ID')

		const rows = await prisma.$queryRawUnsafe<HandoverStatusRow[]>(
			`
				SELECT
					"id",
					"app_id",
					"conversation_id",
					"status",
					"target_agent_id",
					"approval_deadline_at",
					"escalation_count",
					"escalated_at",
					"triage_status",
					"triage_note",
					"created_at",
					"updated_at"
				FROM "handover_requests"
				WHERE "id" = $1::uuid
				  AND "app_id" = $2::uuid
				LIMIT 1
			`,
			requestId,
			targetAppId,
		)
		const row = rows[0]
		if (!row) throw new Error('Request not found')

		return {
			id: row.id,
			app_id: row.app_id,
			conversation_id: row.conversation_id,
			status: row.status || 'pending',
			target_agent_id: row.target_agent_id,
			approval_deadline_at: row.approval_deadline_at,
			escalation_count: Number(row.escalation_count || 0),
			escalated_at: row.escalated_at,
			triage_status: row.triage_status || 'none',
			triage_note: row.triage_note,
			created_at: row.created_at,
			updated_at: row.updated_at,
		}
	}

	static async runEscalationSweep(appId: string): Promise<{
		scanned: number
		escalated: number
		triaged: number
	}> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return { scanned: 0, escalated: 0, triaged: 0 }

		const now = new Date()
		const pendingRows = await prisma.$queryRawUnsafe<EscalationPendingRow[]>(
			`
				SELECT
					"id",
					"conversation_id",
					"ai_intent",
					"escalation_count",
					"approval_deadline_at",
					"created_at"
				FROM "handover_requests"
				WHERE "app_id" = $1::uuid
				  AND "status" = 'pending'
				  AND (
					"approval_deadline_at" IS NULL
					OR "approval_deadline_at" <= NOW()
				  )
				ORDER BY "created_at" ASC NULLS LAST
				LIMIT 200
			`,
			targetAppId,
		)

		if (pendingRows.length === 0) {
			return { scanned: 0, escalated: 0, triaged: 0 }
		}

		const supervisors = await prisma.users.findMany({
			where: {
				app_id: targetAppId,
				active: true,
				deleted_at: null,
				role: { in: ['leader', 'ceo', 'superadmin'] },
			},
			select: { id: true },
			orderBy: [{ updated_at: 'desc' }, { created_at: 'desc' }],
			take: 12,
		})
		const supervisorIds = supervisors.map((row) => row.id)

		let escalated = 0
		let triaged = 0
		for (const row of pendingRows) {
			const escalationCount = Math.max(0, Number(row.escalation_count || 0))
			if (escalationCount < 2 && supervisorIds.length > 0) {
				const supervisorId =
					supervisorIds[escalationCount % supervisorIds.length] ||
					supervisorIds[0] ||
					null
				const nextDeadline = new Date(now)
				nextDeadline.setMinutes(nextDeadline.getMinutes() + 15)
				await prisma.$executeRawUnsafe(
					`
						UPDATE "handover_requests"
						SET
							"escalation_count" = $2,
							"escalated_to" = $3::uuid,
							"escalated_at" = NOW(),
							"approval_deadline_at" = $4::timestamptz,
							"updated_at" = NOW()
						WHERE "id" = $1::uuid
					`,
					row.id,
					escalationCount + 1,
					supervisorId,
					nextDeadline,
				)
				await this.logActivity({
					conversationId: row.conversation_id,
					action: 'handover_escalated',
					actorType: 'system',
					targetId: supervisorId || undefined,
					metadata: {
						request_id: row.id,
						escalation_count: escalationCount + 1,
						next_deadline_at: nextDeadline.toISOString(),
					},
				})
				escalated += 1
				continue
			}

			await prisma.$executeRawUnsafe(
				`
					UPDATE "handover_requests"
					SET
						"triage_status" = 'pending_supervisor_note',
						"triage_note" = COALESCE("triage_note", 'Approval timeout. Routed to supervisor triage queue.'),
						"updated_at" = NOW()
					WHERE "id" = $1::uuid
				`,
				row.id,
			)

			const conversation = await prisma.conversations.findUnique({
				where: { id: row.conversation_id },
				select: { additional_attributes: true },
			})
			const additionalAttrs = asRecord(conversation?.additional_attributes)
			await prisma.conversations.update({
				where: { id: row.conversation_id },
				data: {
					additional_attributes: {
						...additionalAttrs,
						handover: {
							...asRecord(additionalAttrs.handover),
							approval_state: 'pending',
							triage_status: 'pending_supervisor_note',
							latest_request_id: row.id,
						},
					} as any,
					updated_at: new Date(),
				},
			})

			await this.logActivity({
				conversationId: row.conversation_id,
				action: 'handover_triage_pending',
				actorType: 'system',
				metadata: {
					request_id: row.id,
					reason: 'approval_timeout',
				},
			})
			triaged += 1
		}

		return {
			scanned: pendingRows.length,
			escalated,
			triaged,
		}
	}

	static async getLogs(
		appId: string,
		options?: {
			conversationId?: string
			limit?: number
			period?: string
		},
	): Promise<HandoverLogItem[]> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []

		const limit = options?.limit || 100
		const handoverActions = [
			'handover_requested',
			'handover_approved',
			'handover_rejected',
			'handover_reassigned',
			'handover_escalated',
			'handover_triage_pending',
		]

		const sevenDaysAgo = new Date()
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

		const whereClause: any = {
			action: { in: handoverActions },
			created_at: { gte: sevenDaysAgo },
		}

		if (options?.conversationId) {
			whereClause.conversation_id = options.conversationId
		} else {
			const conversations = await prisma.conversations.findMany({
				where: { app_id: targetAppId },
				select: { id: true },
			})
			whereClause.conversation_id = { in: conversations.map((c) => c.id) }
		}

		const logs = await prisma.conversation_activity_log.findMany({
			where: whereClause,
			orderBy: { created_at: 'desc' },
			take: limit,
		})

		const actorIds = [...new Set(logs.map((l) => l.actor_id).filter(Boolean) as string[])]
		const targetIds = [...new Set(logs.map((l) => l.target_id).filter(Boolean) as string[])]
		const allIds = [...new Set([...actorIds, ...targetIds])]

		const users = allIds.length
			? await prisma.users.findMany({
					where: { id: { in: allIds } },
					select: { id: true, name: true },
				})
			: []

		const userMap = new Map(users.map((u) => [u.id, u.name]))

		return logs.map((log) => ({
			id: log.id,
			conversationId: log.conversation_id,
			action: log.action,
			actorId: log.actor_id || undefined,
			actorName: log.actor_id ? userMap.get(log.actor_id) : undefined,
			actorType: log.actor_type || 'user',
			targetId: log.target_id || undefined,
			targetName: log.target_id ? userMap.get(log.target_id) : undefined,
			metadata:
				typeof log.metadata === 'object' && log.metadata !== null
					? (log.metadata as Record<string, unknown>)
					: {},
			createdAt: log.created_at || new Date(),
		}))
	}

	static async getAnalytics(appId: string, period: string = '24h'): Promise<HandoverAnalytics> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) {
			return {
				handoverRate: 0,
				avgWaitTimeSeconds: 0,
				slaCompliance: 0,
				csatPostHandover: 0,
				period,
				totalRequests: 0,
				approvedRequests: 0,
				rejectedRequests: 0,
				pendingRequests: 0,
			}
		}

		const periodMs = this.parsePeriod(period)
		const fromDate = new Date(Date.now() - periodMs)

		const [requests, totalConversations, slaBreaches, ratings] = await Promise.all([
			prisma.handover_requests.findMany({
				where: {
					app_id: targetAppId,
					created_at: { gte: fromDate },
				},
			}),
			prisma.conversations.count({
				where: {
					app_id: targetAppId,
					created_at: { gte: fromDate },
				},
			}),
			prisma.sla_breach_events.count({
				where: {
					sla_policies: { app_id: targetAppId },
					created_at: { gte: fromDate },
					breach_type: 'first_response',
				},
			}),
			prisma.conversation_ratings.findMany({
				where: {
					conversation_id: {
						in: await prisma.handover_requests
							.findMany({
								where: { app_id: targetAppId, created_at: { gte: fromDate } },
								select: { conversation_id: true },
							})
							.then((reqs) => reqs.map((r) => r.conversation_id)),
					},
					created_at: { gte: fromDate },
				},
			}),
		])

		const approved = requests.filter((r) => r.status === 'approved').length
		const rejected = requests.filter((r) => r.status === 'rejected').length
		const pending = requests.filter((r) => r.status === 'pending').length

		const handoverRate = totalConversations > 0 ? (requests.length / totalConversations) * 100 : 0

		const waitTimes = requests
			.filter((r) => r.created_at)
			.map((r) =>
				r.created_at
					? Math.floor(
							(new Date(r.created_at).getTime() - new Date(fromDate).getTime()) / 1000,
						)
					: 0,
			)
		const avgWaitTimeSeconds =
			waitTimes.length > 0
				? Math.floor(waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length)
				: 0

		const totalFirstResponseBreaches = slaBreaches
		const slaCompliance =
			totalConversations > 0
				? Math.max(0, 100 - (totalFirstResponseBreaches / totalConversations) * 100)
				: 100

		const avgRating =
			ratings.length > 0
				? ratings.reduce((sum, r) => sum + r.rating, 0) / ratings.length
				: 0

		return {
			handoverRate: Math.round(handoverRate * 10) / 10,
			avgWaitTimeSeconds,
			slaCompliance: Math.round(slaCompliance * 10) / 10,
			csatPostHandover: Math.round(avgRating * 10) / 10,
			period,
			totalRequests: requests.length,
			approvedRequests: approved,
			rejectedRequests: rejected,
			pendingRequests: pending,
		}
	}

	static async getRules(appId: string): Promise<HandoverRuleItem[]> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []

		const sevenDaysAgo = new Date()
		sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7)

		const [rules, requestCounts] = await Promise.all([
			prisma.auto_assign_rules.findMany({
				where: { app_id: targetAppId },
				orderBy: { priority: 'asc' },
			}),
			prisma.handover_requests.groupBy({
				by: ['source_rule_id'],
				where: {
					app_id: targetAppId,
					source_rule_id: { not: null },
					created_at: { gte: sevenDaysAgo },
				},
				_count: { id: true },
			}),
		])

		const countByRuleId = new Map<string, number>()
		for (const rc of requestCounts) {
			if (rc.source_rule_id) {
				countByRuleId.set(rc.source_rule_id, rc._count.id)
			}
		}

		return rules.map((rule) => {
			const conditions = (rule.conditions || {}) as Record<string, unknown>
			let actionStr = `Assign to ${rule.target_type || 'agent'}`
			if (rule.rule_type === 'priority') {
				actionStr = `Priority: ${conditions.priority || 'normal'}`
			}

			return {
				id: rule.id,
				name: rule.name,
				conditions,
				action: actionStr,
				isActive: rule.is_active || false,
				triggered7d: countByRuleId.get(rule.id) || 0,
				priority: rule.priority || 0,
				ruleType: rule.rule_type || 'round_robin',
			}
		})
	}

	static async getRoster(appId: string): Promise<AgentRosterItem[]> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []

		const [users, availability] = await Promise.all([
			prisma.users.findMany({
				where: {
					app_id: targetAppId,
					role: { in: STAFF_ROSTER_ROLES },
					deleted_at: null,
				},
				select: {
					id: true,
					name: true,
					email: true,
					avatar_url: true,
					role: true,
					status: true,
				},
			}),
			prisma.agent_availability.findMany({
				where: { app_id: targetAppId },
			}),
		])

		const availabilityByUserId = new Map(availability.map((a) => [a.user_id, a]))

		const userIds = users.map((u) => u.id)
		const assignmentsByAgent = await prisma.conversation_agents.groupBy({
			by: ['agent_id'],
			where: {
				agent_id: { in: userIds },
				status: 'active',
			},
			_count: { agent_id: true },
		})

		const assignmentsCountByAgent = new Map(
			assignmentsByAgent.map((a) => [a.agent_id, a._count.agent_id]),
		)

		return users.map((user) => {
			const avail = availabilityByUserId.get(user.id)
			const activeChats = assignmentsCountByAgent.get(user.id) || 0
			const capacity = avail?.max_conversations || 5

			return {
				id: user.id,
				name: user.name,
				email: user.email,
				avatarUrl: user.avatar_url || undefined,
				role: user.role || 'sales',
				status: (user.status as 'online' | 'offline' | 'break') || 'offline',
				activeChats,
				capacity,
				skills: avail?.skills || [],
			}
		})
	}

	static async updateSLAPolicy(
		policyId: string,
		appId: string,
		data: {
			name?: string
			first_response_time?: number
			resolution_time?: number
			is_active?: boolean
			is_default?: boolean
		},
	): Promise<any> {
		const targetAppId = await resolveAppId(appId)

		if (data.is_default) {
			await prisma.sla_policies.updateMany({
				where: { app_id: targetAppId || appId, id: { not: policyId } },
				data: { is_default: false },
			})
		}

		return prisma.sla_policies.update({
			where: { id: policyId, app_id: targetAppId || undefined },
			data: {
				...data,
				updated_at: new Date(),
			},
		})
	}

	static async getSLAStats(
		appId: string,
		period: string = '24h',
	): Promise<{ breaches: number; compliance: number; total: number }> {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return { breaches: 0, compliance: 100, total: 0 }

		const periodMs = this.parsePeriod(period)
		const fromDate = new Date(Date.now() - periodMs)

		const [totalConversations, breaches] = await Promise.all([
			prisma.conversations.count({
				where: {
					app_id: targetAppId,
					created_at: { gte: fromDate },
				},
			}),
			prisma.sla_breach_events.count({
				where: {
					sla_policies: { app_id: targetAppId },
					created_at: { gte: fromDate },
					breach_type: 'first_response',
				},
			}),
		])

		const compliance =
			totalConversations > 0
				? Math.max(0, 100 - (breaches / totalConversations) * 100)
				: 100

		return {
			breaches,
			compliance: Math.round(compliance * 10) / 10,
			total: totalConversations,
		}
	}

	private static async logActivity(params: {
		conversationId: string
		action: string
		actorId?: string
		actorType?: string
		targetId?: string
		metadata?: Record<string, unknown>
	}): Promise<void> {
		await prisma.conversation_activity_log.create({
			data: {
				conversation_id: params.conversationId,
				action: params.action,
				actor_id: params.actorId,
				actor_type: params.actorType || 'user',
				target_id: params.targetId,
				metadata: (params.metadata || {}) as any,
			},
		})
	}

	private static async generateAiReason(conversationId: string): Promise<string | null> {
		const conversation = await prisma.conversations.findUnique({
			where: { id: conversationId },
			include: {
				contacts: true,
				messages: {
					orderBy: { created_at: 'desc' },
					take: 5,
				},
			},
		})

		if (!conversation) return null

		const additionalAttrs =
			conversation.additional_attributes &&
			typeof conversation.additional_attributes === 'object' &&
			!Array.isArray(conversation.additional_attributes)
				? (conversation.additional_attributes as Record<string, unknown>)
				: {}

		const aiAnalytics = additionalAttrs.ai_analytics_last as
			| { intent?: string; confidence?: number; rag_intent?: string }
			| undefined

		if (aiAnalytics?.intent) {
			return `AI detected intent: ${aiAnalytics.intent} (confidence: ${aiAnalytics.confidence?.toFixed(2) || 'N/A'})`
		}

		const lastMessages = conversation.messages
			.map((m) => m.content)
			.join(' ')
			.substring(0, 200)

		return lastMessages ? `Customer message context: "${lastMessages}..."` : null
	}

	private static async extractIntent(conversationId: string): Promise<string | null> {
		const conversation = await prisma.conversations.findUnique({
			where: { id: conversationId },
		})

		if (!conversation) return null

		const additionalAttrs =
			conversation.additional_attributes &&
			typeof conversation.additional_attributes === 'object' &&
			!Array.isArray(conversation.additional_attributes)
				? (conversation.additional_attributes as Record<string, unknown>)
				: {}

		const aiAnalytics = additionalAttrs.ai_analytics_last as
			| { intent?: string; rag_intent?: string }
			| undefined

		return aiAnalytics?.intent || aiAnalytics?.rag_intent || null
	}

	private static async evaluateEscalationRoute(conversation: any): Promise<string | null> {
		const rules = await prisma.auto_assign_rules.findMany({
			where: {
				app_id: conversation.app_id,
				is_active: true,
			},
			orderBy: { priority: 'asc' },
			take: 1,
		})

		if (rules.length === 0) return null

		return rules[0].id
	}

	private static calculatePriority(
		conversation: any,
	): 'urgent' | 'high' | 'medium' {
		const additionalAttrs =
			conversation.additional_attributes &&
			typeof conversation.additional_attributes === 'object' &&
			!Array.isArray(conversation.additional_attributes)
				? (conversation.additional_attributes as Record<string, unknown>)
				: {}

		if (additionalAttrs.priority === 'urgent') return 'urgent'

		const aiAnalytics = additionalAttrs.ai_analytics_last as { confidence?: number } | undefined

		if (aiAnalytics?.confidence !== undefined && aiAnalytics.confidence < 0.4) {
			return 'high'
		}

		const waitingMs = conversation.last_message_at
			? Date.now() - new Date(conversation.last_message_at).getTime()
			: 0
		const waitingMinutes = waitingMs / (1000 * 60)

		if (waitingMinutes > 10) return 'urgent'
		if (waitingMinutes > 5) return 'high'

		return 'medium'
	}

	private static deriveReason(aiReason?: string | null, intent?: string | null): string {
		if (aiReason) return aiReason
		if (intent) return `Intent: ${intent}`
		return 'Manual handover request'
	}

	private static parsePeriod(period: string): number {
		const match = period.match(/^(\d+)(h|d)$/)
		if (!match) return 24 * 60 * 60 * 1000

		const value = parseInt(match[1], 10)
		const unit = match[2]

		if (unit === 'h') return value * 60 * 60 * 1000
		if (unit === 'd') return value * 24 * 60 * 60 * 1000
		return 24 * 60 * 60 * 1000
	}

	private static emitHandoverEvent(
		appId: string,
		event: string,
		payload: unknown,
	): void {
		try {
			const io = getRealtimeIO()
			if (io) {
				io.to(`app:${appId}`).emit(event, payload)
			}
		} catch (error) {
			console.error('[HandoverService] Failed to emit socket event:', error)
		}
	}
}
