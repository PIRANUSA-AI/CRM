import prisma from '../src/lib/prisma'

type DistributionMethod = 'round_robin' | 'least_assigned'

type AuditStatus = 'pass' | 'warn' | 'fail'

type AuditCheck = {
  id: string
  status: AuditStatus
  message: string
  details?: Record<string, unknown>
}

type Args = {
  channelId: string
  chatbotId: string
  json: boolean
}

const DEFAULT_CHANNEL_ID = 'ea1bae74-a82f-4f99-a0a8-981b61c0a2e1'
const DEFAULT_CHATBOT_ID = '1c444e9f-f06c-4fe1-b1b7-7ddb35a6f1b9'
const AGENT_TRANSFER_UI_LIMIT = 750

function asRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function asString(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return v.length > 0 ? v : null
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => asString(item))
    .filter((item): item is string => Boolean(item))
}

function parseArgs(argv: string[]): Args {
  let channelId = DEFAULT_CHANNEL_ID
  let chatbotId = DEFAULT_CHATBOT_ID
  let json = false

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    const next = argv[i + 1]

    if (arg === '--json') {
      json = true
      continue
    }

    if (arg === '--channel-id' && next) {
      channelId = next
      i += 1
      continue
    }

    if (arg === '--chatbot-id' && next) {
      chatbotId = next
      i += 1
      continue
    }
  }

  return { channelId, chatbotId, json }
}

function normalizeDistributionMethod(value: unknown): DistributionMethod | null {
  const raw = (asString(value) || '').toLowerCase()
  if (raw === 'round_robin') return 'round_robin'
  if (raw === 'least_assigned') return 'least_assigned'
  return null
}

function pushCheck(
  checks: AuditCheck[],
  id: string,
  status: AuditStatus,
  message: string,
  details?: Record<string, unknown>,
) {
  checks.push({ id, status, message, ...(details ? { details } : {}) })
}

async function run() {
  const args = parseArgs(process.argv.slice(2))
  const checks: AuditCheck[] = []

  const channel = await prisma.whatsapp_channels.findUnique({
    where: { id: args.channelId },
    select: {
      id: true,
      name: true,
      app_id: true,
      inbox_id: true,
      extended_metadata: true,
    },
  })

  if (!channel) {
    pushCheck(checks, 'channel.exists', 'fail', 'Channel not found')
    output({ args, checks })
    return
  }

  const inbox = channel.inbox_id
    ? await prisma.inboxes.findUnique({
        where: { id: channel.inbox_id },
        select: {
          id: true,
          name: true,
          app_id: true,
          chatbot_id: true,
          channel_config: true,
        },
      })
    : null

  const chatbot = await prisma.chatbots.findUnique({
    where: { id: args.chatbotId },
    select: {
      id: true,
      name: true,
      app_id: true,
      agent_transfer: true,
      is_silent_handoff_agent: true,
      stop_after_handoff: true,
      plugin_data: true,
    },
  })

  const metadata = asRecord(channel.extended_metadata)
  const channelConfig = asRecord(inbox?.channel_config)

  const defaultTeamIds = asStringArray(
    metadata.default_team_ids ?? channelConfig.default_team_ids,
  )
  const defaultAgentIds = asStringArray(
    metadata.default_agent_ids ?? channelConfig.default_agent_ids,
  )
  const defaultFlowId =
    asString(metadata.default_flow_id) || asString(channelConfig.default_flow_id)
  const defaultChatbotId =
    asString(metadata.default_chatbot_id) ||
    asString(channelConfig.default_chatbot_id) ||
    asString(inbox?.chatbot_id)

  const metadataDistribution = normalizeDistributionMethod(
    metadata.distribution_method,
  )
  const configDistribution = normalizeDistributionMethod(
    channelConfig.distribution_method,
  )

  if (metadataDistribution && configDistribution && metadataDistribution === configDistribution) {
    pushCheck(checks, 'distribution.sync', 'pass', 'Distribution method is synced', {
      distribution_method: metadataDistribution,
    })
  } else {
    pushCheck(checks, 'distribution.sync', 'warn', 'Distribution method mismatch between metadata and channel_config', {
      metadata_distribution_method: metadataDistribution,
      channel_config_distribution_method: configDistribution,
    })
  }

  if (metadataDistribution === 'round_robin' || configDistribution === 'round_robin') {
    pushCheck(checks, 'distribution.mode', 'pass', 'Assignment mode is Round Robin')
  } else if (metadataDistribution === 'least_assigned' || configDistribution === 'least_assigned') {
    pushCheck(checks, 'distribution.mode', 'warn', 'Assignment mode is Least Assigned First')
  } else {
    pushCheck(checks, 'distribution.mode', 'fail', 'Assignment mode is not configured correctly')
  }

  if (defaultChatbotId === args.chatbotId) {
    pushCheck(checks, 'chatbot.binding', 'pass', 'Inbox default chatbot matches target AI agent')
  } else {
    pushCheck(checks, 'chatbot.binding', 'warn', 'Inbox default chatbot does not match target AI agent', {
      expected_chatbot_id: args.chatbotId,
      actual_chatbot_id: defaultChatbotId,
    })
  }

  if (!chatbot) {
    pushCheck(checks, 'chatbot.exists', 'fail', 'Chatbot not found')
  } else {
    const transferLength = (chatbot.agent_transfer || '').length
    if (transferLength <= AGENT_TRANSFER_UI_LIMIT) {
      pushCheck(checks, 'agent_transfer.length', 'pass', 'Agent transfer prompt within UI limit', {
        length: transferLength,
        max: AGENT_TRANSFER_UI_LIMIT,
      })
    } else {
      pushCheck(checks, 'agent_transfer.length', 'warn', 'Agent transfer prompt exceeds UI counter', {
        length: transferLength,
        max: AGENT_TRANSFER_UI_LIMIT,
      })
    }

    if (chatbot.is_silent_handoff_agent === true && chatbot.stop_after_handoff === true) {
      pushCheck(checks, 'handoff.flags', 'pass', 'Silent handoff and stop-after-handoff are enabled')
    } else {
      pushCheck(checks, 'handoff.flags', 'warn', 'Handoff safety flags are not fully enabled', {
        is_silent_handoff_agent: chatbot.is_silent_handoff_agent,
        stop_after_handoff: chatbot.stop_after_handoff,
      })
    }

    const pluginData = asRecord(chatbot.plugin_data)
    const aiTools = Array.isArray(pluginData.ai_tools) ? pluginData.ai_tools : []
    const locationTool = aiTools.find((tool) => {
      const rec = asRecord(tool)
      const name = (asString(rec.name) || '').toLowerCase()
      return name === 'get_location_branch'
    })

    if (locationTool) {
      const locationToolRecord = asRecord(locationTool)
      const requiredKeys = ['id', 'name', 'description', 'is_active']
      const missingKeys = requiredKeys.filter(
        (key) => !Object.prototype.hasOwnProperty.call(locationToolRecord, key),
      )
      if (missingKeys.length === 0) {
        pushCheck(
          checks,
          'tool.location.json_shape',
          'pass',
          'get_location_branch JSON shape matches reference',
        )
      } else {
        pushCheck(
          checks,
          'tool.location.json_shape',
          'warn',
          'get_location_branch JSON shape is missing reference keys',
          { missing_keys: missingKeys },
        )
      }
    } else {
      pushCheck(
        checks,
        'tool.location.json_shape',
        'warn',
        'get_location_branch tool JSON not found in ai_tools',
      )
    }

    if (locationTool && asRecord(locationTool).is_active === true) {
      pushCheck(checks, 'tool.location', 'pass', 'get_location_branch is active')
    } else {
      pushCheck(checks, 'tool.location', 'warn', 'get_location_branch is not active')
    }
  }

  if (defaultFlowId) {
    const flow = await prisma.automation_flows.findUnique({
      where: { id: defaultFlowId },
      select: { id: true, name: true, active: true, nodes: true },
    })

    if (!flow) {
      pushCheck(checks, 'flow.exists', 'fail', 'Default flow ID does not exist', {
        flow_id: defaultFlowId,
      })
    } else {
      const nodes = Array.isArray(flow.nodes) ? flow.nodes : []
      const humanEndNodes = nodes.filter((node) => {
        const rec = asRecord(node)
        if (asString(rec.type) !== 'end') return false
        const data = asRecord(rec.data)
        return (asString(data.endType) || asString(data.type)) === 'human_agent'
      })

      const labelActionNodes = nodes.filter((node) => {
        const rec = asRecord(node)
        if (asString(rec.type) !== 'action') return false
        const data = asRecord(rec.data)
        return (asString(data.actionType) || asString(data.type)) === 'label'
      })

      pushCheck(checks, 'flow.summary', 'pass', 'Loaded active default flow', {
        flow_id: flow.id,
        flow_name: flow.name,
        active: flow.active,
        node_count: nodes.length,
        human_end_nodes: humanEndNodes.length,
        label_action_nodes: labelActionNodes.length,
      })

      const labelIds = labelActionNodes.flatMap((node) => {
        const data = asRecord(asRecord(node).data)
        return asStringArray(data.labels)
      })

      const invalidLabelNodes = labelActionNodes
        .map((node) => {
          const rec = asRecord(node)
          const data = asRecord(rec.data)
          const labels = asStringArray(data.labels)
          const actionType = asString(data.actionType) || asString(data.type)
          const issues: string[] = []
          if (actionType !== 'label') issues.push('actionType must be "label"')
          if (labels.length === 0) issues.push('labels array must be non-empty')
          return {
            id: asString(rec.id) || null,
            issues,
          }
        })
        .filter((item) => item.issues.length > 0)

      if (labelActionNodes.length === 0) {
        pushCheck(
          checks,
          'flow.intent_labeling.json_shape',
          'warn',
          'No intent-labeling action node found in default flow',
        )
      } else if (invalidLabelNodes.length === 0) {
        pushCheck(
          checks,
          'flow.intent_labeling.json_shape',
          'pass',
          'Intent-labeling nodes JSON shape matches reference',
          { node_count: labelActionNodes.length },
        )
      } else {
        pushCheck(
          checks,
          'flow.intent_labeling.json_shape',
          'warn',
          'Some intent-labeling nodes do not match reference JSON shape',
          { invalid_nodes: invalidLabelNodes },
        )
      }

      const humanNodeShapeBuckets = {
        teams_and_agents: [] as string[],
        teams_only: [] as string[],
        agents_only: [] as string[],
        invalid: [] as string[],
      }

      for (const node of humanEndNodes) {
        const rec = asRecord(node)
        const data = asRecord(rec.data)
        const nodeId = asString(rec.id) || 'unknown'
        const hasTeams = Array.isArray(data.teams) && data.teams.length > 0
        const hasAgents = Array.isArray(data.agents) && data.agents.length > 0

        if (hasTeams && hasAgents) {
          humanNodeShapeBuckets.teams_and_agents.push(nodeId)
          continue
        }
        if (hasTeams) {
          humanNodeShapeBuckets.teams_only.push(nodeId)
          continue
        }
        if (hasAgents) {
          humanNodeShapeBuckets.agents_only.push(nodeId)
          continue
        }
        humanNodeShapeBuckets.invalid.push(nodeId)
      }

      if (humanEndNodes.length === 0) {
        pushCheck(
          checks,
          'flow.escalation_human.json_shape',
          'fail',
          'No human escalation end node found in default flow',
        )
      } else if (humanNodeShapeBuckets.invalid.length > 0) {
        pushCheck(
          checks,
          'flow.escalation_human.json_shape',
          'fail',
          'Some human escalation nodes have invalid JSON shape',
          { invalid_node_ids: humanNodeShapeBuckets.invalid },
        )
      } else {
        pushCheck(
          checks,
          'flow.escalation_human.json_shape',
          'pass',
          'Human escalation nodes have valid JSON shape',
          {
            teams_and_agents: humanNodeShapeBuckets.teams_and_agents.length,
            teams_only: humanNodeShapeBuckets.teams_only.length,
            agents_only: humanNodeShapeBuckets.agents_only.length,
          },
        )

        const usedShapeKinds = [
          humanNodeShapeBuckets.teams_and_agents.length > 0 ? 'teams_and_agents' : null,
          humanNodeShapeBuckets.teams_only.length > 0 ? 'teams_only' : null,
          humanNodeShapeBuckets.agents_only.length > 0 ? 'agents_only' : null,
        ].filter((item): item is string => Boolean(item))

        if (usedShapeKinds.length === 1) {
          pushCheck(
            checks,
            'flow.escalation_human.json_consistency',
            'pass',
            'Human escalation node JSON shape is consistent',
            { shape: usedShapeKinds[0] },
          )
        } else {
          pushCheck(
            checks,
            'flow.escalation_human.json_consistency',
            'warn',
            'Human escalation node JSON shape is mixed; align to one reference shape',
            { used_shapes: usedShapeKinds, buckets: humanNodeShapeBuckets },
          )
        }
      }

      if (labelIds.length > 0 && channel.app_id) {
        const labels = await prisma.labels.findMany({
          where: {
            app_id: channel.app_id,
            id: { in: labelIds },
            deleted_at: null,
          },
          select: { id: true, title: true },
        })

        const found = new Set(labels.map((label) => label.id))
        const missing = Array.from(new Set(labelIds.filter((id) => !found.has(id))) )

        if (missing.length === 0) {
          pushCheck(checks, 'flow.labels', 'pass', 'All flow label IDs resolve in current app')
        } else {
          pushCheck(checks, 'flow.labels', 'warn', 'Some flow label IDs are missing in current app', {
            missing_label_ids: missing,
          })
        }
      }
    }
  } else {
    pushCheck(checks, 'flow.exists', 'fail', 'No default flow ID configured')
  }

  if (defaultTeamIds.length > 0) {
    const teams = await prisma.teams.findMany({
      where: { id: { in: defaultTeamIds } },
      select: { id: true, name: true, allow_auto_assign: true, deleted_at: true },
    })

    if (teams.length === defaultTeamIds.length) {
      pushCheck(checks, 'team.exists', 'pass', 'All default teams exist')
    } else {
      pushCheck(checks, 'team.exists', 'warn', 'Some default teams are missing', {
        expected_team_ids: defaultTeamIds,
        found_team_ids: teams.map((team) => team.id),
      })
    }

    if (defaultAgentIds.length > 0) {
      const members = await prisma.team_members.findMany({
        where: {
          team_id: { in: defaultTeamIds },
          user_id: { in: defaultAgentIds },
        },
        select: { team_id: true, user_id: true },
      })

      const memberKeys = new Set(
        members.map((member) => `${member.team_id}:${member.user_id}`),
      )
      const missingMemberships: Array<{ team_id: string; user_id: string }> = []

      for (const teamId of defaultTeamIds) {
        for (const agentId of defaultAgentIds) {
          const key = `${teamId}:${agentId}`
          if (!memberKeys.has(key)) {
            missingMemberships.push({ team_id: teamId, user_id: agentId })
          }
        }
      }

      if (missingMemberships.length === 0) {
        pushCheck(checks, 'team.membership', 'pass', 'Default agents are members of default teams')
      } else {
        pushCheck(checks, 'team.membership', 'warn', 'Default agent-team membership is incomplete', {
          missing_pairs: missingMemberships,
        })
      }
    }
  }

  if (defaultAgentIds.length > 0 && channel.app_id) {
    const users = await prisma.users.findMany({
      where: { id: { in: defaultAgentIds } },
      select: {
        id: true,
        name: true,
        active: true,
        role: true,
        deleted_at: true,
      },
    })

    const invalidUsers = users.filter(
      (user) => user.deleted_at !== null || user.active !== true || (user.role !== 'agent' && user.role !== 'supervisor'),
    )

    if (invalidUsers.length === 0 && users.length === defaultAgentIds.length) {
      pushCheck(checks, 'agents.valid', 'pass', 'All default agents are active and valid')
    } else {
      pushCheck(checks, 'agents.valid', 'warn', 'Some default agents are invalid/inactive/missing', {
        expected_agent_ids: defaultAgentIds,
        found_agent_ids: users.map((user) => user.id),
        invalid_agents: invalidUsers,
      })
    }

    const availability = await prisma.agent_availability.findMany({
      where: {
        app_id: channel.app_id,
        user_id: { in: defaultAgentIds },
      },
      select: {
        user_id: true,
        is_available: true,
        last_assigned_at: true,
      },
    })

    if (availability.length === defaultAgentIds.length) {
      pushCheck(checks, 'round_robin.seed', 'pass', 'agent_availability rows exist for all default agents')
    } else {
      pushCheck(checks, 'round_robin.seed', 'warn', 'agent_availability rows are missing for some default agents', {
        expected_agent_ids: defaultAgentIds,
        available_agent_ids: availability.map((row) => row.user_id),
      })
    }
  }

  output({
    args,
    snapshot: {
      checked_at: new Date().toISOString(),
      channel: {
        id: channel.id,
        name: channel.name,
        app_id: channel.app_id,
      },
      inbox: inbox
        ? {
            id: inbox.id,
            name: inbox.name,
            app_id: inbox.app_id,
          }
        : null,
      chatbot: chatbot
        ? {
            id: chatbot.id,
            name: chatbot.name,
            app_id: chatbot.app_id,
          }
        : null,
      resolved_defaults: {
        default_flow_id: defaultFlowId,
        default_chatbot_id: defaultChatbotId,
        default_team_ids: defaultTeamIds,
        default_agent_ids: defaultAgentIds,
        distribution_method: metadataDistribution || configDistribution,
      },
    },
    checks,
  })
}

function output(payload: {
  args: Args
  snapshot?: Record<string, unknown>
  checks: AuditCheck[]
}) {
  const failCount = payload.checks.filter((check) => check.status === 'fail').length
  const warnCount = payload.checks.filter((check) => check.status === 'warn').length
  const passCount = payload.checks.filter((check) => check.status === 'pass').length

  const report = {
    ...payload,
    summary: {
      pass: passCount,
      warn: warnCount,
      fail: failCount,
      overall: failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass',
    },
  }

  if (payload.args.json) {
    console.log(JSON.stringify(report, null, 2))
    return
  }

  console.log('=== Escalation Workflow Audit ===')
  if (payload.snapshot) {
    console.log(`Channel : ${String((payload.snapshot.channel as any)?.name || '')}`)
    console.log(`Inbox   : ${String((payload.snapshot.inbox as any)?.name || '')}`)
    console.log(`Agent   : ${String((payload.snapshot.chatbot as any)?.name || '')}`)
    console.log(
      `Method  : ${String((payload.snapshot.resolved_defaults as any)?.distribution_method || 'unknown')}`,
    )
    console.log('')
  }

  for (const check of payload.checks) {
    const prefix = check.status === 'pass' ? '[PASS]' : check.status === 'warn' ? '[WARN]' : '[FAIL]'
    console.log(`${prefix} ${check.id} - ${check.message}`)
    if (check.details) {
      console.log(`        ${JSON.stringify(check.details)}`)
    }
  }

  console.log('')
  console.log(
    `Summary: pass=${passCount} warn=${warnCount} fail=${failCount} overall=${report.summary.overall}`,
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
