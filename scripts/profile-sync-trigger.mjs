// profile-sync-trigger.mjs
// Jalanin: node scripts/profile-sync-trigger.mjs
// Trigger sync-profiles buat semua user yg punya session connected

const BACKEND = 'http://127.0.0.1:3010'

async function main() {
  // Panggil sync-profiles buat semua user via endpoint admin
  // Endpoint ini butuh auth token, kita panggil internal aja
  const res = await fetch(`${BACKEND}/api/personal-whatsapp-inbox/sync-profiles`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': 'Bearer crm-internal-baileys-token',
      'X-App-Id': '5ede81ae-5bc3-4f8a-a3ab-38545de386fe',
    },
    body: JSON.stringify({ force: true }),
  })
  console.log('Status:', res.status)
  const data = await res.json()
  console.log('Response:', JSON.stringify(data, null, 2))
}

main().catch(console.error)
