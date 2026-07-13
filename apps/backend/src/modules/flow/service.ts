import prisma from '../../lib/prisma'
import { isUuid, resolveAppId } from '../../lib/utils'

const FLOW_TEST_RECENT_HISTORY_LIMIT = 15

function toRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		return value as Record<string, unknown>
	}
	return {}
}

function toStringOrNull(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

function extractDefaultFlowId(value: unknown): string | null {
	const config = toRecord(value)
	return (
		toStringOrNull(config.default_flow_id) ||
		toStringOrNull(config.defaultFlowId)
	)
}

function withDefaultFlowId(
	value: unknown,
	flowId: string,
): Record<string, unknown> {
	const next: Record<string, unknown> = {
		...toRecord(value),
		default_flow_id: flowId,
	}
	delete next.defaultFlowId
	return next
}

function toStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => String(item || '').trim())
		.filter((item) => item.length > 0)
}

type WhatsAppHistoryRole = 'user' | 'assistant'

type WhatsAppHistoryItem = {
	role: WhatsAppHistoryRole
	content: string
}

function normalizeWhatsAppHistoryRole(
	value: unknown,
): WhatsAppHistoryRole | null {
	const normalized = String(value || '')
		.trim()
		.toLowerCase()
	if (!normalized) return null
	if (normalized === 'user' || normalized === 'contact') return 'user'
	if (
		normalized === 'assistant' ||
		normalized === 'bot' ||
		normalized === 'agent' ||
		normalized === 'system'
	) {
		return 'assistant'
	}
	return null
}

function normalizeWhatsAppHistory(value: unknown): WhatsAppHistoryItem[] {
	if (!Array.isArray(value)) return []
	return value
		.map((rawRow) => {
			const row = toRecord(rawRow)
			const role = normalizeWhatsAppHistoryRole(row.role)
			const content = toStringOrNull(row.content)
			if (!role || !content) return null
			return {
				role,
				content,
			}
		})
		.filter((item): item is WhatsAppHistoryItem => Boolean(item))
}

function normalizeFlowTestInput(
	value: unknown,
	fallbackPath: string[],
): {
	path: string[]
	context: {
		message_: string
		recent_history_message: WhatsAppHistoryItem[]
	}
} {
	const payload = toRecord(value)
	const payloadContext = toRecord(payload.context)
	const explicitPath = toStringArray(payload.path)
	const path = explicitPath.length > 0 ? explicitPath : fallbackPath
	const contextHistory = normalizeWhatsAppHistory(
		payloadContext.recent_history_message,
	)
	const rootHistory = normalizeWhatsAppHistory(payload.recent_history_message)
	const legacyHistory = normalizeWhatsAppHistory(payload.recent_history)
	const recentHistoryMessageCandidate =
		contextHistory.length > 0
			? contextHistory
			: rootHistory.length > 0
				? rootHistory
				: legacyHistory
	const message =
		toStringOrNull(payloadContext.message_) ||
		toStringOrNull(payload.message_) ||
		toStringOrNull(payloadContext.incoming_text) ||
		toStringOrNull(payload.incoming_text) ||
		recentHistoryMessageCandidate.find((item) => item.role === 'user')
			?.content ||
		recentHistoryMessageCandidate[0]?.content ||
		''
	const recentHistoryMessage =
		recentHistoryMessageCandidate.length > 0
			? recentHistoryMessageCandidate.slice(-FLOW_TEST_RECENT_HISTORY_LIMIT)
			: message
				? [{ role: 'user' as const, content: message }]
				: []

	return {
		path,
		context: {
			message_: message,
			recent_history_message: recentHistoryMessage,
		},
	}
}

function summarizeContent(
	content: string | null | undefined,
	contentType: string | null | undefined,
) {
	const normalized = typeof content === 'string' ? content.trim() : ''
	if (normalized.length > 0) return normalized
	if (contentType === 'image') return '[Image message]'
	if (contentType === 'interactive') return '[Interactive message]'
	return '[No content]'
}

function normalizeDate(input: Date | string | null | undefined) {
	if (!input) return null
	if (input instanceof Date) return input
	const parsed = new Date(input)
	return Number.isNaN(parsed.getTime()) ? null : parsed
}

function countJsonArray(value: unknown) {
	return Array.isArray(value) ? value.length : 0
}

function normalizeFlowNodeId(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const trimmed = value.trim()
	return trimmed.length > 0 ? trimmed : null
}

function toFlowNodeLabel(
	node: Record<string, unknown>,
	fallbackIndex: number,
): string {
	const label = toStringOrNull(node.label) || toStringOrNull(node.name)
	if (label) return label
	const settingKind = toStringOrNull(node.settingKind)
	if (settingKind) return settingKind.replace(/_/g, ' ')
	return `Node ${fallbackIndex + 1}`
}

function resolveFlowNodeContractType(
	node: Record<string, unknown>,
): 'trigger' | 'condition' | 'action' | 'ai' | 'end' | null {
	const rawType = String(node.type || '')
		.trim()
		.toLowerCase()
	if (!rawType) return null
	if (
		rawType === 'trigger' ||
		rawType === 'condition' ||
		rawType === 'action' ||
		rawType === 'ai' ||
		rawType === 'end'
	) {
		return rawType
	}
	if (rawType === 'start') return 'trigger'
	if (
		rawType === 'ai_generate' ||
		rawType === 'ai_classify' ||
		rawType === 'ai_handoff'
	) {
		return 'ai'
	}
	if (
		rawType === 'logic' ||
		rawType === 'rag' ||
		rawType === 'send_message_buttons'
	) {
		return 'action'
	}
	return null
}

function normalizeFlowEdgeRef(
	edge: unknown,
): { source: string; target: string } | null {
	if (Array.isArray(edge) && edge.length >= 2) {
		const source = toStringOrNull(edge[0])
		const target = toStringOrNull(edge[1])
		if (!source || !target) return null
		return { source, target }
	}
	const record = toRecord(edge)
	const source =
		toStringOrNull(record.source) ||
		toStringOrNull(record.from) ||
		toStringOrNull(record.source_id) ||
		toStringOrNull(record.from_id)
	const target =
		toStringOrNull(record.target) ||
		toStringOrNull(record.to) ||
		toStringOrNull(record.target_id) ||
		toStringOrNull(record.to_id)
	if (!source || !target) return null
	return { source, target }
}

function validateFlowContractGraph(nodesRaw: unknown, edgesRaw: unknown): void {
	if (!Array.isArray(nodesRaw)) {
		throw new Error('Flow nodes must be an array')
	}
	if (!Array.isArray(edgesRaw)) {
		throw new Error('Flow edges must be an array')
	}
	if (nodesRaw.length === 0) return

	const nodeIds = new Set<string>()
	let hasTriggerNode = false
	for (let index = 0; index < nodesRaw.length; index += 1) {
		const node = toRecord(nodesRaw[index])
		const nodeId = normalizeFlowNodeId(node.id)
		if (!nodeId) {
			throw new Error(`Flow node at index ${index} is missing a valid id`)
		}
		if (nodeIds.has(nodeId)) {
			throw new Error(`Flow node id must be unique: ${nodeId}`)
		}
		nodeIds.add(nodeId)

		const contractType = resolveFlowNodeContractType(node)
		if (!contractType) {
			throw new Error(
				`Invalid flow node type: ${String(node.type || 'unknown')}`,
			)
		}
		if (contractType === 'trigger') hasTriggerNode = true
	}

	if (!hasTriggerNode) {
		throw new Error('Flow must include at least one trigger node')
	}

	for (let index = 0; index < edgesRaw.length; index += 1) {
		const normalized = normalizeFlowEdgeRef(edgesRaw[index])
		if (!normalized) {
			throw new Error(`Invalid flow edge format at index ${index}`)
		}
		if (!nodeIds.has(normalized.source) || !nodeIds.has(normalized.target)) {
			throw new Error(
				`Flow edge references unknown node: ${normalized.source} -> ${normalized.target}`,
			)
		}
	}
}

export abstract class FlowService {
	static async getFlows(appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.automation_flows.findMany({
			where: { app_id: targetAppId || undefined },
			orderBy: { created_at: 'desc' },
		})
	}

	static async getFlowById(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.automation_flows.findFirst({
			where: { id, app_id: targetAppId || undefined },
		})
	}

	static async getDefaultFlow(appId: string) {
		const targetAppId = await resolveAppId(appId)
		const resolvedAppId = targetAppId || appId
		const [inboxRows, whatsappRows] = await Promise.all([
			prisma.inboxes.findMany({
				where: { app_id: resolvedAppId, deleted_at: null },
				select: {
					id: true,
					channel_config: true,
				},
				orderBy: { created_at: 'desc' },
			}),
			prisma.whatsapp_channels.findMany({
				where: { app_id: resolvedAppId, deleted_at: null },
				select: {
					id: true,
					extended_metadata: true,
				},
				orderBy: { created_at: 'desc' },
			}),
		])

		const inboxMatch = inboxRows
			.map((row) => ({
				source: 'inbox' as const,
				source_id: row.id,
				default_flow_id: extractDefaultFlowId(row.channel_config),
			}))
			.find((row) => Boolean(row.default_flow_id))
		const whatsappMatch = whatsappRows
			.map((row) => ({
				source: 'whatsapp_channel' as const,
				source_id: row.id,
				default_flow_id: extractDefaultFlowId(row.extended_metadata),
			}))
			.find((row) => Boolean(row.default_flow_id))
		const configured = inboxMatch || whatsappMatch || null
		const defaultFlowId = configured?.default_flow_id || null
		const flow = defaultFlowId
			? await prisma.automation_flows.findFirst({
					where: { id: defaultFlowId, app_id: resolvedAppId },
				})
			: null

		return {
			default_flow_id: defaultFlowId,
			flow,
			source: configured?.source || null,
			source_id: configured?.source_id || null,
		}
	}

	static async setDefaultFlow(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		const resolvedAppId = targetAppId || appId
		const flow = await prisma.automation_flows.findFirst({
			where: { id, app_id: resolvedAppId },
		})
		if (!flow) throw new Error('Flow not found')

		return prisma.$transaction(async (tx) => {
			const now = new Date()
			const [inboxRows, whatsappRows] = await Promise.all([
				tx.inboxes.findMany({
					where: { app_id: resolvedAppId, deleted_at: null },
					select: {
						id: true,
						channel_config: true,
					},
				}),
				tx.whatsapp_channels.findMany({
					where: { app_id: resolvedAppId, deleted_at: null },
					select: {
						id: true,
						extended_metadata: true,
					},
				}),
			])

			await tx.automation_flows.updateMany({
				where: {
					app_id: resolvedAppId,
					id: { not: id },
					active: true,
				},
				data: {
					active: false,
					updated_at: now,
				},
			})
			const updatedFlow = await tx.automation_flows.update({
				where: { id },
				data: {
					active: true,
					updated_at: now,
				},
			})

			await Promise.all([
				...inboxRows.map((row) =>
					tx.inboxes.update({
						where: { id: row.id },
						data: {
							channel_config: withDefaultFlowId(row.channel_config, id) as any,
							updated_at: now,
						},
					}),
				),
				...whatsappRows.map((row) =>
					tx.whatsapp_channels.update({
						where: { id: row.id },
						data: {
							extended_metadata: withDefaultFlowId(
								row.extended_metadata,
								id,
							) as any,
							updated_at: now,
						},
					}),
				),
			])

			return {
				success: true,
				default_flow_id: id,
				flow: updatedFlow,
				updated_inboxes: inboxRows.length,
				updated_whatsapp_channels: whatsappRows.length,
			}
		})
	}

	static async createFlow(appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		const resolvedAppId = targetAppId || appId
		const nextNodes = data.nodes || []
		const nextEdges = data.edges || []
		validateFlowContractGraph(nextNodes, nextEdges)
		const isActive =
			data.active !== undefined
				? data.active
				: data.is_active !== undefined
					? data.is_active
					: true

		if (isActive) {
			return prisma.$transaction(async (tx) => {
				await tx.automation_flows.updateMany({
					where: {
						app_id: resolvedAppId,
						active: true,
					},
					data: {
						active: false,
						updated_at: new Date(),
					},
				})

				return tx.automation_flows.create({
					data: {
						name: data.name,
						description: data.description,
						nodes: data.nodes || [],
						edges: data.edges || [],
						active: true,
						app_id: resolvedAppId,
					},
				})
			})
		}

		return prisma.automation_flows.create({
			data: {
				name: data.name,
				description: data.description,
				nodes: data.nodes || [],
				edges: data.edges || [],
				active: false,
				app_id: resolvedAppId,
			},
		})
	}

	static async updateFlow(id: string, appId: string, data: any) {
		const targetAppId = await resolveAppId(appId)
		const resolvedAppId = targetAppId || appId
		if (data.nodes !== undefined || data.edges !== undefined) {
			const existing = await prisma.automation_flows.findFirst({
				where: { id, app_id: resolvedAppId },
				select: { nodes: true, edges: true },
			})
			if (!existing) throw new Error('Flow not found')
			const nextNodes =
				data.nodes !== undefined ? data.nodes : existing.nodes || []
			const nextEdges =
				data.edges !== undefined ? data.edges : existing.edges || []
			validateFlowContractGraph(nextNodes, nextEdges)
		}
		const nextActive =
			typeof data.active === 'boolean'
				? data.active
				: data.is_active !== undefined
					? Boolean(data.is_active)
					: undefined

		if (nextActive === true) {
			return prisma.$transaction(async (tx) => {
				await tx.automation_flows.updateMany({
					where: {
						app_id: resolvedAppId,
						id: { not: id },
						active: true,
					},
					data: {
						active: false,
						updated_at: new Date(),
					},
				})

				return tx.automation_flows.update({
					where: { id, app_id: resolvedAppId },
					data: {
						...(data.name !== undefined && { name: data.name }),
						...(data.description !== undefined && {
							description: data.description,
						}),
						...(data.nodes !== undefined && { nodes: data.nodes }),
						...(data.edges !== undefined && { edges: data.edges }),
						active: true,
						updated_at: new Date(),
					},
				})
			})
		}

		return prisma.automation_flows.update({
			where: { id, app_id: resolvedAppId },
			data: {
				...(data.name !== undefined && { name: data.name }),
				...(data.description !== undefined && {
					description: data.description,
				}),
				...(data.nodes !== undefined && { nodes: data.nodes }),
				...(data.edges !== undefined && { edges: data.edges }),
				...(nextActive !== undefined && { active: nextActive }),
				updated_at: new Date(),
			},
		})
	}

	static async deleteFlow(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		return prisma.automation_flows.delete({
			where: { id, app_id: targetAppId || undefined },
		})
	}

	static async runFlowTest(
		id: string,
		appId: string,
		options?: { input?: unknown },
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return { executed: 0, flow_id: id }

		const flow = await prisma.automation_flows.findFirst({
			where: { id, app_id: targetAppId },
			select: {
				id: true,
				nodes: true,
			},
		})
		if (!flow) {
			throw new Error('Flow not found')
		}

		const rawNodes = Array.isArray(flow.nodes) ? flow.nodes : []
		const normalizedNodes = rawNodes.map((rawNode) => toRecord(rawNode))
		const triggerNodeId = normalizeFlowNodeId(
			normalizedNodes.find(
				(node) => resolveFlowNodeContractType(node) === 'trigger',
			)?.id,
		)
		const triggerPath = triggerNodeId ? [String(triggerNodeId)] : []
		const normalizedInput = normalizeFlowTestInput(options?.input, triggerPath)
		const runId = `test-run-${Date.now()}`
		let executed = 0

		for (let index = 0; index < normalizedNodes.length; index += 1) {
			const node = normalizedNodes[index]
			const nodeId = normalizeFlowNodeId(node.id) || `node-${index + 1}`
			const preview = toFlowNodeLabel(node, index)
			await prisma.messages.create({
				data: {
					app_id: targetAppId,
					conversation_id: null,
					inbox_id: null,
					message_type: 'outgoing',
					content_type: 'text',
					content: `[Test Run] ${preview}`,
					sender_type: 'system',
					private: true,
					status: 'sent',
					content_attributes: {
						type: 'flow_test_run',
						source: 'flow_runtime',
						flow_id: id,
						node_id: nodeId,
						event: 'test_run_node',
						status: 'success',
						test_run: true,
						test_run_id: runId,
						execution_id: runId,
						path: normalizedInput.path,
						input: JSON.parse(JSON.stringify(normalizedInput)),
					},
				},
			})
			executed += 1
		}

		await prisma.messages.create({
			data: {
				app_id: targetAppId,
				conversation_id: null,
				inbox_id: null,
				message_type: 'outgoing',
				content_type: 'text',
				content: `[Test Run] Completed ${executed} node(s)`,
				sender_type: 'system',
				private: true,
				status: 'sent',
				content_attributes: {
					type: 'flow_test_run',
					source: 'flow_runtime',
					flow_id: id,
					node_id: null,
					event: 'test_run_completed',
					status: 'success',
					test_run: true,
					test_run_id: runId,
					execution_id: runId,
					executed_nodes: executed,
					path: normalizedInput.path,
					input: JSON.parse(JSON.stringify(normalizedInput)),
				},
			},
		})

		return {
			flow_id: id,
			executed,
			test_run_id: runId,
			input: normalizedInput,
		}
	}

	static async getFlowExecutions(
		id: string,
		appId: string,
		conversationId?: string,
		executionId?: string,
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []
		const conversationFilter = isUuid(conversationId || '')
			? conversationId
			: undefined
		const executionFilter = toStringOrNull(executionId?.trim())
		const andFilters: Array<Record<string, unknown>> = [
			{ content_attributes: { path: ['flow_id'], equals: id } },
		]
		if (executionFilter) {
			andFilters.push({
				OR: [
					{
						content_attributes: {
							path: ['execution_id'],
							equals: executionFilter,
						},
					},
					{
						content_attributes: {
							path: ['test_run_id'],
							equals: executionFilter,
						},
					},
					{ id: executionFilter },
				],
			})
		}

		const rows = await prisma.messages.findMany({
			where: {
				app_id: targetAppId,
				...(conversationFilter ? { conversation_id: conversationFilter } : {}),
				deleted_at: null,
				OR: [{ is_deleted: false }, { is_deleted: null }],
				content_attributes: { path: ['source'], equals: 'flow_runtime' },
				AND: andFilters,
			},
			orderBy: { created_at: 'desc' },
			take: 120,
			select: {
				id: true,
				conversation_id: true,
				content_type: true,
				content: true,
				status: true,
				sender_type: true,
				created_at: true,
				content_attributes: true,
			},
		})

		return rows.map((row) => {
			const attrs = toRecord(row.content_attributes)
			const nodeId = toStringOrNull(attrs.node_id)
			const trace = toRecord(attrs.trace)
			const nodeType = toStringOrNull(attrs.node_type)
			const traceInput = toRecord(attrs.input)
			const traceOutput = toRecord(attrs.output)
			const traceVariablesDelta = toRecord(attrs.variables_delta)
			const traceBranch = toRecord(attrs.branch)
			const fallbackTraceInput = toRecord(trace.input)
			const fallbackTraceOutput = toRecord(trace.output)
			const fallbackTraceVariablesDelta = toRecord(trace.variables_delta)
			const fallbackTraceBranch = toRecord(trace.branch)
			const traceInputContext = toRecord(traceInput.context)
			const fallbackTraceInputContext = toRecord(fallbackTraceInput.context)
			const executionId =
				toStringOrNull(attrs.execution_id) ||
				toStringOrNull(attrs.test_run_id) ||
				toStringOrNull(traceInput.execution_id) ||
				toStringOrNull(traceInputContext.execution_id) ||
				toStringOrNull(fallbackTraceInput.execution_id) ||
				toStringOrNull(fallbackTraceInputContext.execution_id) ||
				toStringOrNull(traceInputContext.incoming_message_id) ||
				toStringOrNull(fallbackTraceInputContext.incoming_message_id) ||
				row.id
			const path = toStringArray(attrs.path)
			const senderType = toStringOrNull(row.sender_type) || 'bot'
			const contentType = toStringOrNull(row.content_type) || 'text'
			const event =
				toStringOrNull(attrs.event) ||
				(contentType === 'interactive'
					? 'interactive_reply'
					: contentType === 'image'
						? 'image_reply'
						: 'text_reply')

			return {
				id: row.id,
				conversation_id: row.conversation_id || null,
				node_id: nodeId,
				event,
				status: toStringOrNull(row.status) || 'sent',
				preview: summarizeContent(row.content, contentType),
				content_type: contentType,
				sender_type: senderType,
				node_type: nodeType,
				execution_id: executionId,
				path,
				trace:
					attrs.trace === true ||
					Object.keys(traceInput).length > 0 ||
					Object.keys(traceOutput).length > 0 ||
					Object.keys(traceVariablesDelta).length > 0 ||
					Object.keys(traceBranch).length > 0,
				input:
					Object.keys(traceInput).length > 0 ? traceInput : fallbackTraceInput,
				output:
					Object.keys(traceOutput).length > 0
						? traceOutput
						: fallbackTraceOutput,
				variables_delta:
					Object.keys(traceVariablesDelta).length > 0
						? traceVariablesDelta
						: fallbackTraceVariablesDelta,
				branch:
					Object.keys(traceBranch).length > 0
						? traceBranch
						: fallbackTraceBranch,
				error: toStringOrNull(attrs.error) || toStringOrNull(trace.error),
				created_at: row.created_at,
			}
		})
	}

	static async getFlowVersions(id: string, appId: string) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return []

		const flow = await prisma.automation_flows.findFirst({
			where: {
				id,
				app_id: targetAppId,
			},
			select: {
				id: true,
				active: true,
				nodes: true,
				edges: true,
				created_at: true,
				updated_at: true,
			},
		})

		if (!flow) return []

		const nodesCount = countJsonArray(flow.nodes)
		const edgesCount = countJsonArray(flow.edges)
		const createdAt = normalizeDate(flow.created_at)
		const updatedAt = normalizeDate(flow.updated_at) || createdAt
		const hasMultipleSnapshots =
			Boolean(createdAt && updatedAt) &&
			Math.abs((updatedAt?.getTime() || 0) - (createdAt?.getTime() || 0)) >
				1_000

		const versions: Array<{
			id: string
			flow_id: string
			label: string
			status: 'current' | 'archived'
			summary: string
			saved_at: Date | null
			nodes_count: number
			edges_count: number
			is_active: boolean
		}> = []

		if (createdAt) {
			versions.push({
				id: `${flow.id}-v1`,
				flow_id: flow.id,
				label: 'v1',
				status: hasMultipleSnapshots ? 'archived' : 'current',
				summary: 'Initial save',
				saved_at: createdAt,
				nodes_count: nodesCount,
				edges_count: edgesCount,
				is_active: Boolean(flow.active),
			})
		}

		if (hasMultipleSnapshots && updatedAt) {
			versions.push({
				id: `${flow.id}-v2`,
				flow_id: flow.id,
				label: 'v2',
				status: 'current',
				summary: 'Last saved snapshot',
				saved_at: updatedAt,
				nodes_count: nodesCount,
				edges_count: edgesCount,
				is_active: Boolean(flow.active),
			})
		}

		if (versions.length === 0) {
			versions.push({
				id: `${flow.id}-v1`,
				flow_id: flow.id,
				label: 'v1',
				status: 'current',
				summary: 'Current workflow snapshot',
				saved_at: updatedAt,
				nodes_count: nodesCount,
				edges_count: edgesCount,
				is_active: Boolean(flow.active),
			})
		}

		return versions.sort((a, b) => {
			const aTime = a.saved_at ? a.saved_at.getTime() : 0
			const bTime = b.saved_at ? b.saved_at.getTime() : 0
			return bTime - aTime
		})
	}

	static async debugNodeRun(
		id: string,
		appId: string,
		params: { nodeId: string; input: Record<string, unknown> },
	) {
		const targetAppId = await resolveAppId(appId)
		if (!targetAppId) return { success: false, error: 'App ID not resolved' }

		const flow = await prisma.automation_flows.findFirst({
			where: { id, app_id: targetAppId },
			select: { id: true, nodes: true },
		})
		if (!flow) throw new Error('Flow not found')

		const rawNodes = Array.isArray(flow.nodes) ? flow.nodes : []
		const targetNode = rawNodes
			.map((n) => toRecord(n))
			.find((n) => toStringOrNull(n.id) === params.nodeId)

		if (!targetNode) {
			return {
				success: false,
				error: `Node ${params.nodeId} not found in flow`,
			}
		}

		const debugRunId = `debug-${Date.now()}-${params.nodeId}`
		const nodeLabel = toFlowNodeLabel(targetNode, 0)
		const startedAt = new Date()

		// Record the debug run trace
		await prisma.messages.create({
			data: {
				app_id: targetAppId,
				conversation_id: null,
				inbox_id: null,
				message_type: 'outgoing',
				content_type: 'text',
				content: `[Debug Run] ${nodeLabel} — re-run with adjusted input`,
				sender_type: 'system',
				private: true,
				status: 'sent',
				content_attributes: {
					type: 'flow_debug_run',
					source: 'flow_runtime',
					flow_id: id,
					node_id: params.nodeId,
					event: 'debug_node_run',
					status: 'success',
					execution_id: debugRunId,
					input: JSON.parse(JSON.stringify(params.input)),
					output: JSON.parse(
						JSON.stringify({
							debug: true,
							node_id: params.nodeId,
							node_label: nodeLabel,
							adjusted_input: params.input,
							ran_at: startedAt.toISOString(),
						}),
					),
				},
			},
		})

		return {
			success: true,
			debug_run_id: debugRunId,
			node_id: params.nodeId,
			node_label: nodeLabel,
			input: params.input,
			output: {
				debug: true,
				node_id: params.nodeId,
				node_label: nodeLabel,
				adjusted_input: params.input,
				ran_at: startedAt.toISOString(),
			},
			ran_at: startedAt.toISOString(),
		}
	}
}
