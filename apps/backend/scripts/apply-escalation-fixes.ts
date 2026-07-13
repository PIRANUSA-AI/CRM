import { readFileSync } from 'node:fs'
import { Client } from 'pg'

type Config = {
  chatbotId: string
  appId: string
  teamId: string
  agentIds: string[]
  promptPath: string
}

const config: Config = {
  chatbotId: '1c444e9f-f06c-4fe1-b1b7-7ddb35a6f1b9',
  appId: '4522bdf9-9447-44d7-a470-72211bb00f93',
  teamId: 'f0e54088-e286-40e1-809a-1b8b40f0a929',
  agentIds: [
    'd05bd2d2-641a-4234-9dae-68e6af2db3d5',
    'ff1e6640-5c06-4756-bf15-22b6bc9c82a5',
    '99666850-5cff-40c4-b0f9-6f665e47642c',
  ],
  promptPath:
    '/Users/triasjaya/Sites/crm-app/crm/AGENT_TRANSFER_CONDITIONS_V2.txt',
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

const prompt = readFileSync(config.promptPath, 'utf8').trim()
const client = new Client({ connectionString })

await client.connect()

try {
  await client.query('BEGIN')

  await client.query(
    'UPDATE chatbots SET agent_transfer = $1, updated_at = now() WHERE id = $2',
    [prompt, config.chatbotId],
  )

  for (const userId of config.agentIds) {
    await client.query(
      'INSERT INTO team_members (team_id, user_id) VALUES ($1, $2) ON CONFLICT (team_id, user_id) DO NOTHING',
      [config.teamId, userId],
    )
  }

  for (const userId of config.agentIds) {
    await client.query(
      `INSERT INTO agent_availability (
        user_id, app_id, is_available, max_conversations, current_conversations,
        skills, languages, last_assigned_at, updated_at
      ) VALUES ($1, $2, true, 5, 0, ARRAY[]::text[], ARRAY['en'], NULL, now())
      ON CONFLICT (user_id, app_id)
      DO UPDATE SET is_available = EXCLUDED.is_available, updated_at = now()`,
      [userId, config.appId],
    )
  }

  await client.query('COMMIT')

  console.log(
    JSON.stringify(
      {
        ok: true,
        updated_prompt_length: prompt.length,
        team_members_upserted: config.agentIds.length,
        agent_availability_upserted: config.agentIds.length,
      },
      null,
      2,
    ),
  )
} catch (error) {
  await client.query('ROLLBACK')
  throw error
} finally {
  await client.end()
}
