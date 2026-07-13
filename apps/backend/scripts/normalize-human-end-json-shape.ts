import prisma from '../src/lib/prisma'

type Args = {
	channelId: string
	flowId?: string
	dryRun: boolean
}

const DEFAULT_CHANNEL_ID = 'ea1bae74-a82f-4f99-a0a8-981b61c0a2e1'

function asRecord(value: unknown): Record<string, unknown> {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
	return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
	if (typeof value !== 'string') return null
	const normalized = value.trim()
	return normalized.length > 0 ? normalized : null
}

function asStringArray(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	return value
		.map((item) => asString(item))
		.filter((item): item is string => Boolean(item))
}

function parseArgs(argv: string[]): Args {
	let channelId = DEFAULT_CHANNEL_ID
	let flowId: string | undefined
	let dryRun = false

	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]
		const next = argv[i + 1]

		if (arg === '--dry-run') {
			dryRun = true
			continue
		}
		if (arg === '--channel-id' && next) {
			channelId = next
			i += 1
			continue
		}
		if (arg === '--flow-id' && next) {
			flowId = next
			i += 1
			continue
		}
	}

	return {
		channelId,
		flowId,
		dryRun,
	}
}

function dedupeById<T extends { id?: unknown }>(items: T[]): T[] {
	const seen = new Set<string>()
	const output: T[] = []
	for (const item of items) {
		const id = asString(item.id)
		if (!id) continue
		if (seen.has(id)) continue
		seen.add(id)
		output.push(item)
	}
	return output
}

async function run() {
	const args = parseArgs(process.argv.slice(2))

	const channel = await prisma.whatsapp_channels.findUnique({
		where: { id: args.channelId },
		select: {
			id: true,
			app_id: true,
			inbox_id: true,
			extended_metadata: true,
		},
	})

	if (!channel) throw new Error('Channel not found')

	const inbox = channel.inbox_id
		? await prisma.inboxes.findUnique({
				where: { id: channel.inbox_id },
				select: {
					id: true,
					channel_config: true,
				},
			})
		: null

	const metadata = asRecord(channel.extended_metadata)
	const channelConfig = asRecord(inbox?.channel_config)

	const resolvedFlowId =
		args.flowId ||
		asString(metadata.default_flow_id) ||
		asString(channelConfig.default_flow_id) ||
		null
	if (!resolvedFlowId) throw new Error('No flow ID resolved from args/channel config')

	const defaultTeamIds = asStringArray(
		metadata.default_team_ids ?? channelConfig.default_team_ids,
	)
	const defaultAgentIds = asStringArray(
		metadata.default_agent_ids ?? channelConfig.default_agent_ids,
	)

	const flow = await prisma.automation_flows.findUnique({
		where: { id: resolvedFlowId },
		select: { id: true, name: true, nodes: true },
	})
	if (!flow) throw new Error('Flow not found')

	const nodes = Array.isArray(flow.nodes) ? [...flow.nodes] : []

	const teamRows =
		defaultTeamIds.length > 0
			? await prisma.teams.findMany({
					where: { id: { in: defaultTeamIds } },
					select: { id: true, name: true },
				})
			: []
	const teamById = new Map(teamRows.map((team) => [team.id, team]))

	const memberRows =
		defaultTeamIds.length > 0
			? await prisma.team_members.findMany({
					where: {
						team_id: { in: defaultTeamIds },
						...(defaultAgentIds.length > 0
							? { user_id: { in: defaultAgentIds } }
							: {}),
					},
					select: { team_id: true, user_id: true },
				})
			: []

	const userIds = Array.from(
		new Set([
			...defaultAgentIds,
			...memberRows.map((member) => member.user_id),
		]),
	)

	const userRows =
		userIds.length > 0
			? await prisma.users.findMany({
					where: { id: { in: userIds } },
					select: { id: true, name: true, role: true, email: true },
				})
			: []
	const userById = new Map(userRows.map((user) => [user.id, user]))

	const fallbackTeams = defaultTeamIds.map((teamId) => {
		const team = teamById.get(teamId)
		const membersForTeam = memberRows
			.filter((member) => member.team_id === teamId)
			.map((member) => {
				const user = userById.get(member.user_id)
				return {
					id: member.user_id,
					name: user?.name || member.user_id,
				}
			})
		return {
			id: teamId,
			name: team?.name || teamId,
			agents: dedupeById(membersForTeam),
		}
	})

	let changedCount = 0
	const changedNodeIds: string[] = []

	const normalizedNodes = nodes.map((rawNode) => {
		const node = asRecord(rawNode)
		const nodeType = asString(node.type)
		if (nodeType !== 'end') return rawNode

		const data = asRecord(node.data)
		const endType = asString(data.endType) || asString(data.type)
		if (endType !== 'human_agent') return rawNode

		const currentTeams = Array.isArray(data.teams) ? data.teams : []
		const currentAgents = Array.isArray(data.agents) ? data.agents : []

		const normalizedTeams =
			currentTeams.length > 0
				? currentTeams
				: fallbackTeams.length > 0
					? fallbackTeams
					: []

		const flattenedAgentsFromTeams = normalizedTeams.flatMap((teamRaw) => {
			const team = asRecord(teamRaw)
			const teamAgents = Array.isArray(team.agents) ? team.agents : []
			return teamAgents
				.map((agentRaw) => {
					const agent = asRecord(agentRaw)
					const userId = asString(agent.id)
					if (!userId) return null
					const user = userById.get(userId)
					return {
						id: userId,
						name: asString(agent.name) || user?.name || userId,
						role: asString(agent.role) || user?.role || 'agent',
						email: asString(agent.email) || user?.email || null,
					}
				})
				.filter((item): item is { id: string; name: string; role: string; email: string | null } =>
					Boolean(item),
				)
		})

		const normalizedAgents =
			currentAgents.length > 0
				? dedupeById(
						currentAgents
							.map((agentRaw) => {
								const agent = asRecord(agentRaw)
								const userId = asString(agent.id)
								if (!userId) return null
								const user = userById.get(userId)
								return {
									id: userId,
									name: asString(agent.name) || user?.name || userId,
									role: asString(agent.role) || user?.role || 'agent',
									email: asString(agent.email) || user?.email || null,
								}
							})
							.filter((item): item is { id: string; name: string; role: string; email: string | null } =>
								Boolean(item),
							),
				  )
				: dedupeById(flattenedAgentsFromTeams)

		const hasTeams = normalizedTeams.length > 0
		const hasAgents = normalizedAgents.length > 0
		if (!hasTeams || !hasAgents) return rawNode

		const alreadyConsistent =
			Array.isArray(data.teams) &&
			data.teams.length > 0 &&
			Array.isArray(data.agents) &&
			data.agents.length > 0
		if (alreadyConsistent) return rawNode

		changedCount += 1
		const nodeId = asString(node.id) || 'unknown'
		changedNodeIds.push(nodeId)

		return {
			...rawNode,
			data: {
				...data,
				teams: normalizedTeams,
				agents: normalizedAgents,
			},
		}
	})

	if (!args.dryRun && changedCount > 0) {
		await prisma.automation_flows.update({
			where: { id: flow.id },
			data: {
				nodes: normalizedNodes,
				updated_at: new Date(),
			},
		})
	}

	console.log(
		JSON.stringify(
			{
				ok: true,
				flow_id: flow.id,
				flow_name: flow.name,
				dry_run: args.dryRun,
				changed_nodes: changedCount,
				changed_node_ids: changedNodeIds,
				fallback_team_ids: defaultTeamIds,
				fallback_agent_ids: defaultAgentIds,
			},
			null,
			2,
		),
	)
}

run()
	.catch((error) => {
		console.error(error)
		process.exit(1)
	})
	.finally(async () => {
		await prisma.$disconnect()
	})

