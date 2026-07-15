import { makeWASocket, useMultiFileAuthState, DisconnectReason, Browsers } from '@whiskeysockets/baileys'
import { Boom } from '@hapi/boom'

const PHONE = '628992246000'
const AUTH_DIR = './auth'

async function main() {
  console.log('[POC] Starting pairing code test with Node.js...')
  console.log('[POC] Node version:', process.version)
  console.log('[POC] Phone number:', PHONE)

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR)

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.macOS('Google Chrome'),
    logger: console as any,
  })

  sock.ev.on('creds.update', saveCreds)

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update
    if (qr) {
      console.log('[POC] QR received (should not happen in pairing mode)')
    }
    if (connection === 'open') {
      console.log('[POC] CONNECTED!')
      process.exit(0)
    }
    if (connection === 'close') {
      const code = (lastDisconnect?.error as Boom)?.output?.statusCode
      console.log('[POC] Connection closed, code:', code, lastDisconnect?.error?.message || '')
    }
  })

  // Wait a bit for socket to init, then request pairing code
  setTimeout(async () => {
    try {
      if (!sock.authState.creds.registered) {
        console.log('[POC] Requesting pairing code...')
        const code = await sock.requestPairingCode(PHONE)
        console.log('')
        console.log('========================================')
        console.log('  PAIRING CODE:', code)
        console.log('  Phone:', PHONE)
        console.log('========================================')
        console.log('')
        console.log('[POC] Waiting for connection...')
      } else {
        console.log('[POC] Already registered, skipping pairing code')
      }
    } catch (err: any) {
      console.error('[POC] Pairing code failed:', err.message)
    }
  }, 2000)

  // Timeout after 60s
  setTimeout(() => {
    console.log('[POC] Timeout. Exiting.')
    process.exit(1)
  }, 60_000)
}

main().catch(console.error)
