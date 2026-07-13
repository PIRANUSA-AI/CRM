import prisma from '../src/lib/prisma'
import { WebhookService } from '../src/modules/webhook/service'

type InboundStep = {
  id: string
  text: string
}

const CHANNEL_PHONE_NUMBER_ID = '814791358387401'
const TARGET_CHANNEL_ID = 'ea1bae74-a82f-4f99-a0a8-981b61c0a2e1'
const TARGET_CHATBOT_ID = '1c444e9f-f06c-4fe1-b1b7-7ddb35a6f1b9'
const FORCE_DEBOUNCED_AUTOREPLY = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.FORCE_DEBOUNCED_AUTOREPLY || '').toLowerCase(),
)
const SMOKE_SCENARIO = String(process.env.SMOKE_SCENARIO || 'full_funnel')
  .trim()
  .toLowerCase()

const now = Date.now()
const testRunId = `escalation-smoke-${now}`
const testWaId = `628000${String(now).slice(-9)}`

const steps: InboundStep[] =
  SMOKE_SCENARIO === 'escalation_only'
    ? [
        {
          id: `${testRunId}-01`,
          text: 'Saya mau booking hari selasa ini jam 15:00 di cabang Bintaro',
        },
      ]
    : [
        { id: `${testRunId}-01`, text: 'Halo SOZO, saya tertarik promo IPL Glow 199rb' },
        { id: `${testRunId}-02`, text: 'Bogor' },
        { id: `${testRunId}-03`, text: 'hari selasa ini di cabang Bintaro' },
      ]

function buildInboundPayload(step: InboundStep, waId: string, timestampSeconds: number) {
  return {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'smoke-test-entry',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: {
                phone_number_id: CHANNEL_PHONE_NUMBER_ID,
              },
              contacts: [
                {
                  profile: {
                    name: `Smoke Test ${testRunId}`,
                  },
                  wa_id: waId,
                },
              ],
              messages: [
                {
                  from: waId,
                  id: step.id,
                  timestamp: String(timestampSeconds),
                  type: 'text',
                  text: {
                    body: step.text,
                  },
                },
              ],
            },
          },
        ],
      },
    ],
  }
}

async function run() {
  const channel = await prisma.whatsapp_channels.findUnique({
    where: { id: TARGET_CHANNEL_ID },
    select: {
      id: true,
      app_id: true,
      inbox_id: true,
      phone_number_id: true,
      extended_metadata: true,
    },
  })

  if (!channel?.app_id || !channel.inbox_id) {
    throw new Error('Target channel not found or incomplete')
  }

  const chatbot = await prisma.chatbots.findUnique({
    where: { id: TARGET_CHATBOT_ID },
    select: {
      id: true,
      name: true,
      agent_transfer: true,
      plugin_data: true,
      is_silent_handoff_agent: true,
      stop_after_handoff: true,
    },
  })

  if (!chatbot) {
    throw new Error('Target chatbot not found')
  }

  const inboundResults: Array<{ stepId: string; success: boolean; errors: string[] }> = []
  let ts = Math.floor(now / 1000)

  for (const step of steps) {
    const payload = buildInboundPayload(step, testWaId, ts)
    const result = await WebhookService.handleWhatsAppInbound(payload)
    inboundResults.push({
      stepId: step.id,
      success: Boolean(result?.success),
      errors: Array.isArray(result?.errors)
        ? result.errors.map((item) => String(item || ''))
        : [],
    })
    ts += 1
  }

  const contact = await prisma.contacts.findFirst({
    where: {
      app_id: channel.app_id,
      whatsapp_id: testWaId,
      deleted_at: null,
    },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      name: true,
      phone_number: true,
      identifier: true,
      whatsapp_id: true,
      created_at: true,
      updated_at: true,
    },
  })

  if (!contact) {
    throw new Error('Smoke contact not found after inbound simulation')
  }

  const conversation = await prisma.conversations.findFirst({
    where: {
      app_id: channel.app_id,
      inbox_id: channel.inbox_id,
      contact_id: contact.id,
      deleted_at: null,
    },
    orderBy: { updated_at: 'desc' },
    select: {
      id: true,
      status: true,
      assignee_id: true,
      team_id: true,
      unread_count: true,
      updated_at: true,
      created_at: true,
    },
  })

  if (!conversation) {
    throw new Error('Smoke conversation not found')
  }

  if (FORCE_DEBOUNCED_AUTOREPLY) {
    const lastStep = steps[steps.length - 1]
    await WebhookService.processDebouncedAutoReplyJob({
      appId: channel.app_id,
      inboxId: channel.inbox_id,
      conversationId: conversation.id,
      incomingMessage: {
        id: lastStep?.id || `${testRunId}-fallback`,
        content: lastStep?.text || '',
      },
      contact: {
        id: contact.id,
        name: contact.name || null,
        phone_number: contact.phone_number || contact.whatsapp_id || null,
        identifier: contact.identifier || contact.whatsapp_id || null,
      },
      channelType: 'whatsapp',
      channelName: 'Smoke Test',
      channelBadgeUrl: null,
      isNewLead: false,
      aggregatePendingInbound: true,
      debounceToken: null,
    })
  }

  const conversationAgents = await prisma.conversation_agents.findMany({
    where: {
      conversation_id: conversation.id,
      status: 'active',
    },
    select: {
      id: true,
      agent_id: true,
      is_primary: true,
      assigned_at: true,
    },
    orderBy: [{ is_primary: 'desc' }, { assigned_at: 'asc' }],
  })

  const assignmentHistory = await prisma.assignment_history.findMany({
    where: { conversation_id: conversation.id },
    select: {
      id: true,
      assigned_from: true,
      assigned_to: true,
      assignment_type: true,
      created_at: true,
    },
    orderBy: { created_at: 'asc' },
  })

  const recentMessages = await prisma.messages.findMany({
    where: {
      conversation_id: conversation.id,
      deleted_at: null,
    },
    select: {
      id: true,
      sender_type: true,
      content: true,
      content_type: true,
      status: true,
      created_at: true,
      content_attributes: true,
    },
    orderBy: { created_at: 'asc' },
    take: 100,
  })

  const systemMessages = recentMessages
    .filter((message) => message.sender_type === 'system')
    .map((message) => String(message.content || '').trim())

  const toolStatusMessages = systemMessages.filter(
    (content) =>
      content.includes('Successfully executed tool calls') ||
      content.includes('Tool output') ||
      content.includes('Location tool output') ||
      content.includes('Successfully labeled conversation with'),
  )

  const containsHandoffHint = recentMessages.some((message) => {
    const content = String(message.content || '').toLowerCase()
    if (!content) return false
    return (
      content.includes('handing off') ||
      content.includes('assigned this conversation to') ||
      content.includes('human agent') ||
      content.includes('diteruskan')
    )
  })

  const summary = {
    testRunId,
    testWaId,
    target: {
      channel_id: TARGET_CHANNEL_ID,
      chatbot_id: TARGET_CHATBOT_ID,
      app_id: channel.app_id,
      inbox_id: channel.inbox_id,
      phone_number_id: channel.phone_number_id,
    },
    chatbot_flags: {
      is_silent_handoff_agent: chatbot.is_silent_handoff_agent,
      stop_after_handoff: chatbot.stop_after_handoff,
      agent_transfer_length: (chatbot.agent_transfer || '').length,
    },
    inbound_results: inboundResults,
    contact,
    conversation,
    active_agents: conversationAgents,
    assignment_history: assignmentHistory,
    status_checks: {
      conversation_pending: conversation.status === 'pending',
      has_assignee: Boolean(conversation.assignee_id),
      has_active_agent_row: conversationAgents.length > 0,
      has_tool_status_messages: toolStatusMessages.length > 0,
      has_handoff_hint_message: containsHandoffHint,
    },
    system_messages: systemMessages,
    tool_status_messages: toolStatusMessages,
    recent_messages: recentMessages.map((message) => ({
      id: message.id,
      sender_type: message.sender_type,
      content_type: message.content_type,
      status: message.status,
      created_at: message.created_at,
      content: String(message.content || '').slice(0, 400),
    })),
  }

  console.log(JSON.stringify(summary, null, 2))
}

await run()
  .catch((error) => {
    console.error('E2E escalation smoke failed:', error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
