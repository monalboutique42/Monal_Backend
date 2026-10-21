import express from 'express'
import jwt from 'jsonwebtoken'
import crypto from 'crypto'
import User from '../models/User.js'
import { ActiveSession } from '../models/ActiveSession.js'
import { protect, requireRole } from '../middleware/auth.js'

const router = express.Router()

const genToken = (id, sessionId, app) =>
  jwt.sign({ id, sessionId, app }, process.env.JWT_SECRET, { expiresIn: '7d' })

// ============================================================
// Role → which apps can login
// ============================================================
const APP_ACCESS = {
  admin:      ['billing'],               // admin panel illa
  md_finance: ['admin', 'billing'],
  md:         ['admin', 'billing'],
  ceo:        ['admin', 'billing'],
}

// ============================================================
// Max sessions per role per app
// ============================================================
const SESSION_LIMIT = {
  admin:      { billing: 2, admin: 0 },   // staff: 2 billing, 0 admin
  md_finance: { billing: 1, admin: 1 },
  md:         { billing: 1, admin: 1 },
  ceo:        { billing: 1, admin: 1 },
}

// ============================================================
// POST /auth/login
// ============================================================
router.post('/login', async (req, res) => {
  try {
    const { email, password, app } = req.body

    // ---- Validation
    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' })
    }
    if (!app || !['admin', 'billing'].includes(app)) {
      return res.status(400).json({ message: 'Valid app required (admin or billing)' })
    }

    // ---- User
    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    // ---- Password
    const isMatch = await user.matchPassword(password)
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' })

    if (!user.active) {
      return res.status(403).json({ message: 'Account inactive' })
    }

    // ---- Role + app access
    const allowedApps = APP_ACCESS[user.role] || []
    if (!allowedApps.includes(app)) {
      return res.status(403).json({
        message: `Your role (${user.role}) does not have access to ${app} app`,
      })
    }

    // ---- Session limit
    const limit = SESSION_LIMIT[user.role]?.[app] ?? 1
    if (limit <= 0) {
      return res.status(403).json({
        message: `Your role is not allowed to login to ${app}`,
      })
    }

    const existing = await ActiveSession.find({ userId: user._id, app })
      .sort({ createdAt: 1 })   // oldest first

    if (existing.length >= limit) {
      // ✅ Kick oldest sessions until under limit
      const toDelete = existing.slice(0, existing.length - limit + 1)
      await ActiveSession.deleteMany({
        _id: { $in: toDelete.map((s) => s._id) },
      })
    }

    // ---- Create new session
    const sessionId = crypto.randomBytes(32).toString('hex')
    await ActiveSession.create({
      userId: user._id,
      app,
      sessionId,
      device: (req.headers['user-agent'] || '').slice(0, 200),
      ip: req.ip || '',
      lastSeenAt: new Date(),
    })

    const token = genToken(user._id, sessionId, app)

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      unitNo: user.unitNo,
      isSuperMD: user.isSuperMD,
      isUnitUser: user.isUnitUser,
      app,
      token,
    })
  } catch (err) {
    console.error('Login error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// POST /auth/logout — clear current session
// ============================================================
router.post('/logout', protect, async (req, res) => {
  try {
    await ActiveSession.deleteOne({
      userId: req.user._id,
      app: req.session.app,
      sessionId: req.session.sessionId,
    })
    res.json({ message: 'Logged out' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /auth/me
// ============================================================
router.get('/me', protect, (req, res) => {
  res.json(req.user)
})

// ============================================================
// POST /auth/users (MD/MD Finance only)
// ============================================================
router.post('/users', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { name, email, password, role, unitNo, isUnitUser } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, password required' })
    }

    const exists = await User.findOne({ email: email.toLowerCase() })
    if (exists) return res.status(400).json({ message: 'Email already exists' })

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || 'admin',
      unitNo: unitNo || null,
      isUnitUser: isUnitUser || false,
    })

    const out = user.toObject()
    delete out.password
    res.status(201).json(out)
  } catch (err) {
    console.error('Create user error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /auth/sessions — MD/CEO/MD_Finance can view all active sessions
// ============================================================
router.get(
  '/sessions',
  protect,
  requireRole('md', 'ceo', 'md_finance'),
  async (req, res) => {
    try {
      const sessions = await ActiveSession.find()
        .populate('userId', 'name email role unitNo')
        .sort({ lastSeenAt: -1 })
      res.json(sessions)
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

// ============================================================
// DELETE /auth/sessions/:id — force logout a session (MD/CEO/MD_Finance only)
// ============================================================
router.delete(
  '/sessions/:id',
  protect,
  requireRole('md', 'ceo', 'md_finance'),
  async (req, res) => {
    try {
      const result = await ActiveSession.findByIdAndDelete(req.params.id)
      if (!result) return res.status(404).json({ message: 'Session not found' })
      res.json({ message: 'Session revoked' })
    } catch (err) {
      res.status(500).json({ message: err.message })
    }
  }
)

export default router