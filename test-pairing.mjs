// test-pairing.mjs — pure Baileys, no DB, no CRM
import makeWASocket, { useMultiFileAuthState, Browsers } from '@whiskeysockets/baileys'

const PHONE = '628992246000'

async function main() {
  console.log('Phone:', PHONE)
  console.log('Node:', process.version, '| Bun:', !!process.isBun)
  console.log('Baileys:', (await import('@whiskeysockets/baileys/package.json')).version)

  const { state, saveCreds } = await useMultiFileAuthState('./test-auth')

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.windows('Chrome'),
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (u) => {
    if (u.connection === 'open') {
      console.log('\n✅ CONNECTED! Pairing successful!')
      process.exit(0)
    }
    if (u.connection === 'close') {
      console.log('\n❌ Closed:', u.lastDisconnect?.error?.message || 'unknown')
    }
  })

  // Wait a moment, then request pairing code
  await new Promise(r => setTimeout(r, 2000))

  if (!sock.authState.creds.registered) {
    console.log('Requesting pairing code...')
    try {
      const code = await sock.requestPairingCode(PHONE)
      console.log('\n═══════════════════════════════')
      console.log('  PAIRING CODE:', code)
      console.log('  Nomor:', PHONE)
      console.log('═══════════════════════════════')
      console.log('\nMasukin kode ini di WhatsApp > Titik 3 > Perangkat tertaut')
      console.log('Tunggu koneksi... (30 detik)')
    } catch (e) {
      console.error('\n❌ Pairing code gagal:', e.message)
      process.exit(1)
    }
  }

  // Timeout
  setTimeout(() => { console.log('\n⏰ Timeout 30s'); process.exit(1) }, 30_000)
}

main().catch(console.error)
