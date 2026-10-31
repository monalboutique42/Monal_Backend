import express from 'express'
import multer from 'multer'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { clients, initWhatsApp } from '../utils/whatsapp.js'
import { protect } from '../middleware/auth.js'

const router = express.Router()

// ============================================================
// HELPER — get user's session id
// ============================================================
const getUserId = (user) => {
  return user.unitNo || user._id.toString()
}

// ============================================================
// MULTER — memory storage (file buffer in req.file)
// ============================================================
const upload = multer({ storage: multer.memoryStorage() })

// ============================================================
// 1. POST /connect — initialize QR
// ============================================================
router.post('/connect', protect, async (req, res) => {
  try {
    const userId = getUserId(req.user)
    await initWhatsApp(userId)
    res.json({ success: true, message: 'Initializing...' })
  } catch (err) {
    console.error('Connect error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ============================================================
// 2. GET /code — poll for QR or ready status
// ============================================================
router.get('/code', protect, (req, res) => {
  const userId = getUserId(req.user)
  const qr = clients[userId + '_qr']
  const isReady = clients[userId + '_ready']
  const number = clients[userId + '_number']

  if (isReady) {
    return res.json({ connected: true, number: number || 'Connected', userId })
  }

  res.json({
    connected: false,
    qr: qr || null,
    reconnecting: !qr,
  })
})

// ============================================================
// 3. GET /status — check connection (current user)
// ============================================================
router.get('/status', protect, (req, res) => {
  const userId = getUserId(req.user)
  const isReady = clients[userId + '_ready']
  const number = clients[userId + '_number']

  if (isReady) {
    return res.json({ connected: true, number: number || 'Connected', userId })
  }
  res.json({ connected: false })
})

// ============================================================
// 3b. GET /status/all — all users' WhatsApp status (Staffs page)
// ✅ Only MD / MD Finance can view
// ============================================================
router.get('/status/all', protect, async (req, res) => {
  try {
    // ✅ Only MD / MD Finance / Super Admin can view all statuses
    const isAllowed =
      ['md', 'md_finance'].includes(req.user.role) ||
      req.user.isSuperAdmin === true

    if (!isAllowed) {
      return res.status(403).json({ message: 'Access denied' })
    }

    const User = (await import('../models/User.js')).default

    // Get all staff (excluding super admins)
    const staff = await User.find({
      isSuperAdmin: { $ne: true },
    }).select('_id name email role unitNo').lean()

    // Build result with WhatsApp status per user
    const result = staff.map((u) => {
      const userId = u.unitNo || u._id.toString()
      const isReady = clients[userId + '_ready']
      const number = clients[userId + '_number']

      return {
        _id: u._id,
        name: u.name,
        email: u.email,
        role: u.role,
        unitNo: u.unitNo,
        whatsapp: isReady
          ? { connected: true, number: number || 'Connected' }
          : { connected: false, number: null },
      }
    })

    res.json(result)
  } catch (err) {
    console.error('GET /status/all error:', err.message)
    res.status(500).json({ error: err.message })
  }
})

// ============================================================
// 4. POST /logout — manual logout
// ============================================================
router.post('/logout', protect, async (req, res) => {
  try {
    const userId = getUserId(req.user)
    const sock = clients[userId]

    if (sock) {
      try {
        await sock.logout()
      } catch (e) {
        console.error('Logout error:', e.message)
      }
      delete clients[userId]
      delete clients[userId + '_ready']
      delete clients[userId + '_qr']
      delete clients[userId + '_number']
    }

    res.json({ success: true, message: 'Disconnected' })
  } catch (err) {
    res.status(500).json({ error: err.message })
  }
})

// ============================================================
// 5. POST /send — text OR PDF (multipart)
// ============================================================
router.post('/send', protect, upload.single('pdfFile'), async (req, res) => {
  const { number, message } = req.body
  const pdfFile = req.file   // ✅ multer → Buffer in memory

  const userId = getUserId(req.user)
  const sock = clients[userId]
  const isReady = clients[userId + '_ready']

  if (!isReady || !sock) {
    return res.status(400).json({
      error: `WhatsApp not connected for this user. Please connect first.`,
    })
  }

  try {
    // ✅ Format JID for India
    const jid = number.includes('@s.whatsapp.net')
      ? number
      : `91${number.replace(/\D/g, '')}@s.whatsapp.net`

    if (pdfFile) {
      // ✅ Save buffer to temp file — then send as { url }
      const safeName = pdfFile.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')
      const tempPath = path.join(os.tmpdir(), `${Date.now()}-${safeName}`)
      fs.writeFileSync(tempPath, pdfFile.buffer)

      console.log(`📎 [${userId}] Sending PDF: ${safeName} (${pdfFile.buffer.length} bytes)`)

      try {
        await sock.sendMessage(
          jid,
          {
            document: { url: tempPath },   // ✅ { url } — streams from disk
            mimetype: 'application/pdf',
            fileName: pdfFile.originalname,
            caption: message,
          },
          {
            mediaUploadTimeoutMs: 120000,  // ✅ 2 min for large files
          }
        )
      } finally {
        // ✅ Cleanup temp file
        try { fs.unlinkSync(tempPath) } catch {}
      }

      console.log(`✅ [${userId}] PDF sent successfully`)
    } else {
      // ✅ Text only
      await sock.sendMessage(jid, { text: message })
    }

    res.json({ success: true })
  } catch (err) {
    console.error('Send WhatsApp error:', err)
    res.status(500).json({ error: err.message })
  }
})



export default router