import 'dotenv/config'
import prisma from '../src/lib/prisma'
import { ChatbotFollowupService } from '../src/modules/chatbot/followup-service'

type CliOptions = {
  conversationId: string | null
  limit: number
  execute: boolean
  confirm: boolean
  json: boolean
}

type DueConversationRow = {
  id: string
  app_id: string | null
  inbox_id: string | null
  status: string | null
  assignee_id: string | null
  contact_name: string | null
  identifier: string | null
  chatbot_id: string | null
  next_due_at: string | null
  anchor_at: string | null
  processing_token: string | null
  processing_started_at: string | null
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    conversationId: null,
    limit: 50,
    execute: false,
    confirm: false,
    json: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]

    if (token === '--conversation-id' && next) {
      options.conversationId = next.trim() || null
      index += 1
      continue
    }

    if (token === '--limit' && next) {
      const parsed = Number(next)
      if (Number.isFinite(parsed) && parsed > 0) {
        options.limit = Math.max(1, Math.min(500, Math.trunc(parsed)))
      }
      index += 1
      continue
    }

    if (token === '--execute') {
      options.execute = true
      continue
    }

    if (token === '--yes') {
      options.confirm = true
      continue
    }

    if (token === '--json') {
      options.json = true
    }
  }

  return options
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`)
}

async function listDueConversations(options: CliOptions) {
  return prisma.$queryRaw<DueConversationRow[]>`
    SELECT
      c.id,
      c.app_id,
      c.inbox_id,
      c.status,
      c.assignee_id,
      ct.name AS contact_name,
      ct.identifier,
      COALESCE(
        c.additional_attributes->'chatbot_followup'->>'chatbot_id',
        i.chatbot_id::text
      ) AS chatbot_id,
      c.additional_attributes->'chatbot_followup'->>'next_due_at' AS next_due_at,
      c.additional_attributes->'chatbot_followup'->>'anchor_at' AS anchor_at,
      c.additional_attributes->'chatbot_followup'->>'processing_token' AS processing_token,
      c.additional_attributes->'chatbot_followup'->>'processing_started_at' AS processing_started_at
    FROM conversations c
    LEFT JOIN inboxes i ON i.id = c.inbox_id
    LEFT JOIN contacts ct ON ct.id = c.contact_id
    WHERE c.deleted_at IS NULL
      AND COALESCE(c.status, 'open') <> 'resolved'
      AND c.additional_attributes ? 'chatbot_followup'
      AND (c.additional_attributes->'chatbot_followup'->>'next_due_at') IS NOT NULL
      AND (c.additional_attributes->'chatbot_followup'->>'next_due_at') ~ '^\\d{4}-\\d{2}-\\d{2}T'
      AND ((c.additional_attributes->'chatbot_followup'->>'next_due_at')::timestamptz <= NOW())
      AND (${options.conversationId}::uuid IS NULL OR c.id = ${options.conversationId}::uuid)
    ORDER BY (c.additional_attributes->'chatbot_followup'->>'next_due_at')::timestamptz ASC
    LIMIT ${options.limit}
  `
}

async function main() {
  const options = parseArgs(process.argv.slice(2))

  if (options.execute && !options.confirm) {
    throw new Error(
      'Refusing to execute follow-ups without confirmation. Re-run with --execute --yes.',
    )
  }

  const dueConversations = await listDueConversations(options)

  const result = {
    mode: options.execute ? 'execute' : 'dry-run',
    requestedConversationId: options.conversationId,
    limit: options.limit,
    dueCount: dueConversations.length,
    conversations: dueConversations,
    processed: [] as Array<{
      conversationId: string
      sent: boolean
      error?: string
    }>,
  }

  if (options.execute) {
    for (const row of dueConversations) {
      try {
        const sent = await ChatbotFollowupService.processDueConversation(row.id)
        result.processed.push({
          conversationId: row.id,
          sent,
        })
      } catch (error) {
        result.processed.push({
          conversationId: row.id,
          sent: false,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(result, null, 2))
    return
  }

  printSection('Recover Chatbot Followups')
  console.log(
    JSON.stringify(
      {
        mode: result.mode,
        requestedConversationId: result.requestedConversationId,
        limit: result.limit,
        dueCount: result.dueCount,
      },
      null,
      2,
    ),
  )

  if (dueConversations.length === 0) {
    console.log('\nNo overdue chatbot follow-ups found.')
    return
  }

  printSection('Due Conversations')
  for (const row of dueConversations) {
    console.log(
      [
        `conversation=${row.id}`,
        `contact=${row.contact_name || row.identifier || '-'}`,
        `chatbot=${row.chatbot_id || '-'}`,
        `next_due_at=${row.next_due_at || '-'}`,
        `status=${row.status || '-'}`,
        `processing_token=${row.processing_token || '-'}`,
      ].join(' | '),
    )
  }

  if (!options.execute) {
    console.log(
      '\nDry-run only. Re-run with --execute --yes to process these overdue follow-ups.',
    )
    return
  }

  printSection('Execution Result')
  for (const row of result.processed) {
    console.log(
      [
        `conversation=${row.conversationId}`,
        `sent=${row.sent ? 'yes' : 'no'}`,
        row.error ? `error=${row.error}` : null,
      ]
        .filter(Boolean)
        .join(' | '),
    )
  }
}

await main()
  .catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => undefined)
  })
