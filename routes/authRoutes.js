import express from 'express'
import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { protect, requireRole } from '../middleware/auth.js'

const router = express.Router()

const genToken = (id) =>
  jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '7d' })

// ============ POST /auth/login ============
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' })
    }

    const user = await User.findOne({ email: email.toLowerCase().trim() })
    if (!user) return res.status(401).json({ message: 'Invalid credentials' })

    const isMatch = await user.matchPassword(password)
    if (!isMatch) return res.status(401).json({ message: 'Invalid credentials' })

    if (!user.active) {
      return res.status(403).json({ message: 'Account inactive' })
    }

    res.json({
      _id: user._id,
      name: user.name,
      email: user.email,
      role: user.role,
      unitNo: user.unitNo,
      isSuperMD: user.isSuperMD,
      token: genToken(user._id),
    })
  } catch (err) {
    console.error('Login error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============ GET /auth/me ============
router.get('/me', protect, (req, res) => {
  res.json(req.user)
})

// ============ POST /auth/users (MD/MD Finance only) ============
router.post('/users', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { name, email, password, role, unitNo } = req.body

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
    })

    const out = user.toObject()
    delete out.password
    res.status(201).json(out)
  } catch (err) {
    console.error('Create user error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router