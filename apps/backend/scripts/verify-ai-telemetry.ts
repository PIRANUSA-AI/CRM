import 'dotenv/config'
import { Client } from 'pg'

type CliOptions = {
  hours: number
  appId: string | null
  chatbotId: string | null
  conversationId: string | null
  requireEntrypoints: boolean
}

type EntrypointCount = {
  entrypoint: string
  total: string
}

type StatusCount = {
  status: string
  total: string
}

const REQUIRED_COLUMNS = [
  'id',
  'app_id',
  'chatbot_id',
  'conversation_id',
  'entrypoint',
  'provider',
  'model_name',
  'prompt_tokens',
  'completion_tokens',
  'total_tokens',
  'usage_credits',
  'usage_usd',
  'usage_idr',
  'billed_credits',
  'knowledge_references',
  'rtk_summary',
  'message_ids',
  'status',
  'retry_count',
  'knowledge_snapshot_at',
  'created_at',
  'updated_at',
]

const MANDATORY_ENTRYPOINTS = ['simulate', 'webhook_live', 'flow_runtime', 'followup']

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    hours: 24,
    appId: null,
    chatbotId: null,
    conversationId: null,
    requireEntrypoints: false,
  }

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index]
    const next = argv[index + 1]

    if (token === '--hours' && next) {
      const parsed = Number(next)
      if (Number.isFinite(parsed) && parsed > 0) {
        options.hours = Math.max(1, Math.min(24 * 30, Math.trunc(parsed)))
      }
      index += 1
      continue
    }

    if (token === '--app-id' && next) {
      options.appId = next.trim() || null
      index += 1
      continue
    }

    if (token === '--chatbot-id' && next) {
      options.chatbotId = next.trim() || null
      index += 1
      continue
    }

    if (token === '--conversation-id' && next) {
      options.conversationId = next.trim() || null
      index += 1
      continue
    }

    if (token === '--require-entrypoints') {
      options.requireEntrypoints = true
    }
  }

  return options
}

function buildFilterSql(options: CliOptions, startIndex: number) {
  const clauses = ['created_at >= NOW() - make_interval(hours => $1::int)']
  const params: Array<string | number> = [options.hours]
  let paramIndex = startIndex

  if (options.appId) {
    clauses.push(`app_id = $${paramIndex}::uuid`)
    params.push(options.appId)
    paramIndex += 1
  }

  if (options.chatbotId) {
    clauses.push(`chatbot_id = $${paramIndex}::uuid`)
    params.push(options.chatbotId)
    paramIndex += 1
  }

  if (options.conversationId) {
    clauses.push(`conversation_id = $${paramIndex}::uuid`)
    params.push(options.conversationId)
    paramIndex += 1
  }

  return {
    whereSql: clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : '',
    params,
  }
}

function printSection(title: string) {
  console.log(`\n=== ${title} ===`)
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const options = parseArgs(process.argv.slice(2))
const client = new Client({ connectionString })

await client.connect()

let hasFailure = false

try {
  printSection('AI Telemetry Verification Context')
  console.log(
    JSON.stringify(
      {
        hours: options.hours,
        appId: options.appId,
        chatbotId: options.chatbotId,
        conversationId: options.conversationId,
        requireEntrypoints: options.requireEntrypoints,
      },
      null,
      2,
    ),
  )

  const tableResult = await client.query<{ table_name: string | null }>(
    "SELECT to_regclass('public.ai_response_logs')::text AS table_name",
  )
  const tableName = tableResult.rows[0]?.table_name || null

  printSection('Schema Check')
  if (!tableName) {
    hasFailure = true
    console.error('FAIL: ai_response_logs table does not exist. Apply pending migrations first.')
  } else {
    console.log('PASS: ai_response_logs table exists.')

    const columnsResult = await client.query<{ column_name: string }>(
      `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'ai_response_logs'
      `,
    )

    const existingColumns = new Set(columnsResult.rows.map((row) => row.column_name))
    const missingColumns = REQUIRED_COLUMNS.filter((column) => !existingColumns.has(column))
    if (missingColumns.length > 0) {
      hasFailure = true
      console.error('FAIL: Missing columns:', missingColumns.join(', '))
    } else {
      console.log(`PASS: All required columns are present (${REQUIRED_COLUMNS.length}).`)
    }
  }

  if (!tableName) {
    process.exitCode = 2
  } else {
    const { whereSql, params } = buildFilterSql(options, 2)

    const totalResult = await client.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total FROM ai_response_logs ${whereSql}`,
      params,
    )

    printSection('Row Volume')
    const totalRows = Number(totalResult.rows[0]?.total || '0')
    console.log(`rows_in_window=${totalRows}`)
    if (totalRows === 0) {
      hasFailure = true
      console.error('FAIL: No ai_response_logs rows found in selected window/filter.')
    } else {
      console.log('PASS: ai_response_logs rows found.')
    }

    const entrypointResult = await client.query<EntrypointCount>(
      `
        SELECT entrypoint, COUNT(*)::text AS total
        FROM ai_response_logs
        ${whereSql}
        GROUP BY entrypoint
        ORDER BY entrypoint ASC
      `,
      params,
    )

    printSection('Entrypoint Coverage')
    const entrypointMap = new Map(
      entrypointResult.rows.map((row) => [row.entrypoint, Number(row.total || '0')]),
    )
    console.log(
      JSON.stringify(
        Object.fromEntries(
          [...entrypointMap.entries()].sort((a, b) => a[0].localeCompare(b[0])),
        ),
        null,
        2,
      ),
    )

    const missingEntrypoints = MANDATORY_ENTRYPOINTS.filter(
      (name) => (entrypointMap.get(name) || 0) <= 0,
    )
    if (options.requireEntrypoints && missingEntrypoints.length > 0) {
      hasFailure = true
      console.error(
        `FAIL: Missing mandatory entrypoints in window: ${missingEntrypoints.join(', ')}`,
      )
    } else if (missingEntrypoints.length > 0) {
      console.warn(
        `WARN: Missing mandatory entrypoints in window: ${missingEntrypoints.join(', ')}`,
      )
    } else {
      console.log('PASS: All mandatory entrypoints have at least 1 row in this window.')
    }

    const statusResult = await client.query<StatusCount>(
      `
        SELECT COALESCE(status, 'null') AS status, COUNT(*)::text AS total
        FROM ai_response_logs
        ${whereSql}
        GROUP BY COALESCE(status, 'null')
        ORDER BY status ASC
      `,
      params,
    )

    printSection('Status Distribution')
    console.log(
      JSON.stringify(
        statusResult.rows.reduce<Record<string, number>>((acc, row) => {
          acc[row.status] = Number(row.total || '0')
          return acc
        }, {}),
        null,
        2,
      ),
    )

    const invalidFieldResult = await client.query<{
      invalid_tokens: string
      invalid_costs: string
      invalid_snapshot: string
    }>(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE COALESCE(prompt_tokens, 0) < 0
               OR COALESCE(completion_tokens, 0) < 0
               OR COALESCE(total_tokens, 0) < 0
               OR COALESCE(total_tokens, 0) < (COALESCE(prompt_tokens, 0) + COALESCE(completion_tokens, 0))
          )::text AS invalid_tokens,
          COUNT(*) FILTER (
            WHERE usage_credits IS NULL OR usage_usd IS NULL OR usage_idr IS NULL
          )::text AS invalid_costs,
          COUNT(*) FILTER (
            WHERE knowledge_snapshot_at IS NULL
          )::text AS invalid_snapshot
        FROM ai_response_logs
        ${whereSql}
      `,
      params,
    )

    printSection('Field Integrity')
    const invalid = invalidFieldResult.rows[0]
    console.log(
      JSON.stringify(
        {
          invalid_tokens: Number(invalid?.invalid_tokens || '0'),
          invalid_costs: Number(invalid?.invalid_costs || '0'),
          invalid_snapshot: Number(invalid?.invalid_snapshot || '0'),
        },
        null,
        2,
      ),
    )

    if (
      Number(invalid?.invalid_tokens || '0') > 0 ||
      Number(invalid?.invalid_costs || '0') > 0
    ) {
      hasFailure = true
      console.error('FAIL: Found invalid usage/cost fields in ai_response_logs.')
    } else {
      console.log('PASS: Usage/cost fields are valid for sampled rows.')
    }

    const refsResult = await client.query<{
      with_refs: string
      with_rtk_summary: string
    }>(
      `
        SELECT
          COUNT(*) FILTER (
            WHERE jsonb_typeof(COALESCE(knowledge_references, '[]'::jsonb)) = 'array'
              AND jsonb_array_length(COALESCE(knowledge_references, '[]'::jsonb)) > 0
          )::text AS with_refs,
          COUNT(*) FILTER (
            WHERE jsonb_typeof(COALESCE(rtk_summary, '{}'::jsonb)) = 'object'
          )::text AS with_rtk_summary
        FROM ai_response_logs
        ${whereSql}
      `,
      params,
    )

    printSection('References & RTK Summary')
    console.log(
      JSON.stringify(
        {
          rows_with_knowledge_references: Number(refsResult.rows[0]?.with_refs || '0'),
          rows_with_rtk_summary_object: Number(
            refsResult.rows[0]?.with_rtk_summary || '0',
          ),
        },
        null,
        2,
      ),
    )

    const retryResult = await client.query<{
      retry_pending: string
      failed: string
    }>(
      `
        SELECT
          COUNT(*) FILTER (WHERE status = 'retry_pending')::text AS retry_pending,
          COUNT(*) FILTER (WHERE status = 'failed')::text AS failed
        FROM ai_response_logs
        ${whereSql}
      `,
      params,
    )

    printSection('Retry Health')
    console.log(
      JSON.stringify(
        {
          retry_pending: Number(retryResult.rows[0]?.retry_pending || '0'),
          failed: Number(retryResult.rows[0]?.failed || '0'),
        },
        null,
        2,
      ),
    )
  }
} finally {
  await client.end()
}

if (hasFailure) {
  process.exitCode = 2
  console.error('\nVerification result: FAIL')
} else {
  console.log('\nVerification result: PASS')
}
