import { Client } from 'pg'

type JsonValue = string | number | boolean | null | { [k: string]: JsonValue } | JsonValue[]

type Config = {
  flowId: string
  mapping: Record<string, string>
}

const config: Config = {
  flowId: 'de838c5e-ffb7-4ad2-87db-d982a4dfbafd',
  mapping: {
    '44d42190-742c-4657-aedb-dc426c60397d': '422846c5-4466-4ed9-a401-852cd77c09d2', // Promo / Price
    'b94f94e9-bfed-40f6-ad87-50a46c807d3d': '9553b593-aeff-42c0-af2e-6c2dabf98280', // Ads
    'b4c92f08-4b2c-4c36-9c66-1439671bebe9': '870ab050-c6e9-45cf-90e6-4f8ad72c4189', // Existing Customer
  },
}

const connectionString = process.env.DATABASE_URL
if (!connectionString) {
  throw new Error('DATABASE_URL is required')
}

function asObject(v: JsonValue | undefined | null): Record<string, JsonValue> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  return v as Record<string, JsonValue>
}

const client = new Client({ connectionString })
await client.connect()

try {
  await client.query('BEGIN')

  const res = await client.query<{ nodes: JsonValue }>(
    'SELECT nodes FROM automation_flows WHERE id = $1 FOR UPDATE',
    [config.flowId],
  )

  if (res.rowCount !== 1) {
    throw new Error(`Flow not found: ${config.flowId}`)
  }

  const rawNodes = res.rows[0]?.nodes
  const nodes: JsonValue[] = Array.isArray(rawNodes)
    ? rawNodes
    : typeof rawNodes === 'string'
      ? (JSON.parse(rawNodes) as JsonValue[])
      : []

  let touchedNodes = 0
  let replacedEntries = 0

  for (const node of nodes) {
    const nodeObj = asObject(node)
    const data = asObject(nodeObj.data as JsonValue)
    const labels = Array.isArray(data.labels) ? data.labels : null

    if (!labels || labels.length === 0) continue

    let nodeChanged = false
    const remapped = labels.map((labelId) => {
      if (typeof labelId !== 'string') return labelId
      const mapped = config.mapping[labelId]
      if (mapped && mapped !== labelId) {
        replacedEntries += 1
        nodeChanged = true
        return mapped
      }
      return labelId
    })

    if (nodeChanged) {
      data.labels = remapped
      nodeObj.data = data
      touchedNodes += 1
    }
  }

  await client.query(
    'UPDATE automation_flows SET nodes = $1::jsonb, updated_at = now() WHERE id = $2',
    [JSON.stringify(nodes), config.flowId],
  )

  await client.query('COMMIT')

  console.log(
    JSON.stringify(
      {
        ok: true,
        flow_id: config.flowId,
        touched_nodes: touchedNodes,
        replaced_entries: replacedEntries,
        mapping: config.mapping,
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
