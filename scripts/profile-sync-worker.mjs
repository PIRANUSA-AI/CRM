import { createHash } from 'node:crypto'

const DB = process.env.DATABASE_URL || 'postgresql://crm:2l8xHHcw0Wai4Qn01C7hbLkaM_vbctog@localhost:5431/crm_db'
const BAILEYS_URL = 'http://127.0.0.1:3012'
const BACKEND_URL = 'http://127.0.0.1:3010'

async function query(sql: string, params?: unknown[]) {
  const res = await fetch(`${BACKEND_URL}/api/internal/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Internal-Token': 'crm-internal-baileys-token' },
    body: JSON.stringify({ sql, params }),
  })
  return res.json()
}

async function getProfilePicture(channelKey: string, phone: string, apiKey: string) {
  const res = await fetch(`${BAILEYS_URL}/api/v1/profile-picture`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
      'X-Crm-Channel-Secret': apiKey,
    },
    body: JSON.stringify({ channelKey, phoneNumber: phone }),
  })
  if (!res.ok) return null
  const data = await res.json()
  return data?.data || null
}

async function main() {
  console.log('[Profile Sync] Starting...')
  
  const { pool } = await import('pg')
  const pg = new pool({ connectionString: DB })
  
  // Get all baileys channels
  const channels = (await pg.query(`
    SELECT c.id, c.api_key, c.app_id, c.inbox_id, s.provider_channel_key
    FROM whatsapp_channels c
    JOIN baileys_sessions s ON s.channel_id = c.id
    WHERE c.provider = 'baileys' AND c.deleted_at IS NULL AND s.status = 'connected'
  `)).rows
  
  for (const ch of channels) {
    if (!ch.inbox_id || !ch.api_key || !ch.provider_channel_key) continue
    
    // Get contacts that need sync
    const contacts = (await pg.query(`
      SELECT ct.id, ct.phone_number, ct.additional_attributes
      FROM contacts ct
      WHERE ct.app_id = $1 AND ct.deleted_at IS NULL
        AND ct.phone_number IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM conversations cv
          WHERE cv.inbox_id = $2 AND cv.contact_id = ct.id AND cv.deleted_at IS NULL
        )
      ORDER BY ct.updated_at ASC
      LIMIT 50
    `, [ch.app_id, ch.inbox_id])).rows
    
    for (const ct of contacts) {
      const phone = String(ct.phone_number || '').replace(/\D/g, '')
      if (!phone) continue
      
      const attrs = ct.additional_attributes || {}
      const lastFetch = new Date(attrs.profile_picture_fetched_at || 0).getTime()
      if (!isNaN(lastFetch) && Date.now() - lastFetch < 7 * 86400000) continue
      
      try {
        console.log(`[Profile Sync] Fetching ${phone}...`)
        const profile = await getProfilePicture(ch.provider_channel_key, phone, ch.api_key)
        
        if (profile?.url) {
          const img = await fetch(profile.url)
          if (img.ok) {
            const buf = Buffer.from(await img.arrayBuffer())
            const hash = createHash('sha256').update(buf).digest('hex')
            const ext = (img.headers.get('content-type') || 'image/jpeg').includes('png') ? 'png' : 'jpg'
            
            // Upload to MinIO via media endpoint
            const form = new FormData()
            form.append('file', new Blob([buf], { type: img.headers.get('content-type') || 'image/jpeg' }), `profile-${ct.id}.${ext}`)
            form.append('purpose', 'whatsapp-profile')
            form.append('userId', 'system')
            form.append('appId', ch.app_id)
            
            const up = await fetch(`${BACKEND_URL}/api/media/upload`, { method: 'POST', body: form })
            if (up.ok) {
              const upData = await up.json()
              if (upData?.url) {
                await pg.query(`
                  UPDATE contacts SET 
                    avatar_url = $1,
                    additional_attributes = additional_attributes || $2::jsonb,
                    updated_at = NOW()
                  WHERE id = $3
                `, [
                  upData.url,
                  JSON.stringify({
                    profile_picture_hash: hash,
                    profile_picture_fetched_at: new Date().toISOString(),
                    profile_picture_available: true,
                  }),
                  ct.id,
                ])
                console.log(`[Profile Sync] Updated ${phone}`)
              }
            }
          }
        } else {
          await pg.query(`
            UPDATE contacts SET
              additional_attributes = additional_attributes || $1::jsonb,
              updated_at = NOW()
            WHERE id = $2
          `, [
            JSON.stringify({
              profile_picture_fetched_at: new Date().toISOString(),
              profile_picture_available: false,
            }),
            ct.id,
          ])
        }
      } catch (err: unknown) {
        console.error(`[Profile Sync] Error ${phone}:`, err instanceof Error ? err.message : String(err))
      }
    }
  }
  
  await pg.end()
  console.log('[Profile Sync] Done')
}

main().catch((err) => {
  console.error('[Profile Sync] Fatal:', err)
  process.exit(1)
})
