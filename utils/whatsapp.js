import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  makeCacheableSignalKeyStore,
  fetchLatestBaileysVersion,
  fetchLatestWaWebVersion 
} from '@whiskeysockets/baileys'
import fs from 'fs'
import path from 'path'
import pino from 'pino'

// ============================================================
// IN-MEMORY CLIENT REGISTRY
// ============================================================
export const clients = {}

// ============================================================
// SESSION STORAGE PATH
// ============================================================
const SESSION_BASE_PATH = path.join(process.cwd(), 'whatsapp-sessions')

// ✅ Ensure session base folder exists
if (!fs.existsSync(SESSION_BASE_PATH)) {
  fs.mkdirSync(SESSION_BASE_PATH, { recursive: true })
}

const logger = pino({ level: 'silent' })

// ============================================================
// INIT WHATSAPP CLIENT (per user) — Baileys
// ============================================================
export const initWhatsApp = async (userId, forceNew = false) => {
  const uid = String(userId)

  // ✅ Already initialized — return existing client (unless forceNew)
  if (clients[uid] && !forceNew) return clients[uid]

  console.log(`🚀 [${uid}] Initializing Baileys WhatsApp client...${forceNew ? ' (reconnect)' : ''}`)

  const sessionPath = path.join(SESSION_BASE_PATH, `monal-user-${uid}`)
  const { state, saveCreds } = await useMultiFileAuthState(sessionPath)
const { version } = await fetchLatestWaWebVersion()

  const sock = makeWASocket({
    version,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, logger),
    },
    logger,
    printQRInTerminal: false, // QR ஐ frontend இல் காட்டுகிறோம்
    generateHighQualityLinkPreview: true,
  })

  // ============================================================
  // SAVE CREDENTIALS (critical for session persistence)
  // ============================================================
  sock.ev.on('creds.update', saveCreds)

  // ============================================================
  // CONNECTION UPDATE (QR / open / close)
  // ============================================================
  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update

    if (qr) {
      console.log(`📱 [${uid}] QR Code Ready`)
      clients[uid + '_qr'] = qr
      clients[uid + '_ready'] = false
    }

if (connection === 'open') {
  console.log(`✅ [${uid}] WhatsApp is READY!`)
  clients[uid + '_ready'] = true
  clients[uid + '_qr'] = null

  // ✅ Get connected number (with retry — sock.user may not be ready instantly)
  const tryGetNumber = (attempts = 0) => {
    const userJid = sock.user?.id
    if (userJid) {
      const phoneNumber = userJid.split(':')[0] || userJid.split('@')[0]
      clients[uid + '_number'] = phoneNumber
      console.log(`📞 [${uid}] Connected Number: ${phoneNumber}`)
    } else if (attempts < 5) {
      setTimeout(() => tryGetNumber(attempts + 1), 500)
    } else {
      console.log(`⚠️  [${uid}] Could not get number after retries`)
    }
  }
  tryGetNumber()
}

if (connection === 'close') {
  const statusCode = lastDisconnect?.error?.output?.statusCode
  const shouldReconnect = statusCode !== DisconnectReason.loggedOut

  console.log(`⚠️  [${uid}] Connection closed. Reason: ${statusCode}, Reconnect: ${shouldReconnect}`)
  clients[uid + '_ready'] = false
  clients[uid + '_qr'] = null

  // ✅ CRITICAL: remove old dead socket first
  delete clients[uid]

  if (shouldReconnect) {
    setTimeout(() => {
      console.log(`🔄 [${uid}] Attempting reconnect...`)
      initWhatsApp(uid, true)   // ✅ forceNew = true → new socket
    }, 3000)
  }
}
  })

  clients[uid] = sock
  return sock
}

// ============================================================
// GET EXISTING CLIENT
// ============================================================
export const getClient = (userId) => {
  const uid = String(userId)
  return clients[uid] || null
}

// ============================================================
// AUTO-RESTORE ALL SESSIONS ON BOOT
// ============================================================
export const restoreAllSessions = () => {
  try {
    if (!fs.existsSync(SESSION_BASE_PATH)) {
      console.log('ℹ️  No WhatsApp sessions to restore')
      return
    }

    const folders = fs.readdirSync(SESSION_BASE_PATH)
    const userFolders = folders.filter((f) => f.startsWith('monal-user-'))

    if (userFolders.length === 0) {
      console.log('ℹ️  No WhatsApp sessions to restore')
      return
    }

    console.log(`🔁 Restoring ${userFolders.length} WhatsApp session(s)...`)

    for (const folder of userFolders) {
      const userId = folder.replace('monal-user-', '')
      if (userId) {
        console.log(`🔁 Restoring session for user: ${userId}`)
        initWhatsApp(userId)
      }
    }
  } catch (err) {
    console.error('❌ Session restore error:', err.message)
  }
}