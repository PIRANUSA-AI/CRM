import './src/modules/personal-whatsapp-inbox/profile-sync' // starts the worker
import { whatsappProfileSyncQueue } from './src/lib/queue'
import prisma from './src/lib/prisma'
const APP='1713b2f2-0931-45ef-b386-b65799c588fd'
const INBOX='fc296103-a131-4a2a-9778-a235af18bcbb'
async function avatars(){
  const r = await prisma.$queryRawUnsafe<any[]>(`SELECT COUNT(*) FILTER (WHERE avatar_url IS NOT NULL) w, COUNT(*) t FROM contacts c WHERE app_id=$1 AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM conversations cv WHERE cv.contact_id=c.id AND cv.inbox_id=$2)`, APP, INBOX)
  return `${Number(r[0].w)}/${Number(r[0].t)}`
}
const start=Date.now()
while (Date.now()-start < 170000) {
  const c = await whatsappProfileSyncQueue.getJobCounts('waiting','active','completed','failed','delayed')
  console.log(new Date().toISOString().slice(11,19), JSON.stringify(c), 'avatars=', await avatars())
  if ((c.waiting||0)+(c.active||0)+(c.delayed||0) === 0 && c.completed) break
  await new Promise(r=>setTimeout(r,15000))
}
console.log('done, final avatars=', await avatars())
process.exit(0)
