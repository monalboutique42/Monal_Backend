import express from 'express'
import User from '../models/User.js'
import { protect, requireRole } from '../middleware/auth.js'
import bcrypt from 'bcryptjs'

const router = express.Router()

// ============================================================
// HELPER: Default reset password
// ============================================================
const RESET_PASSWORD = '1098765432'

// ============================================================
// HELPER: Ensure 3 unit users exist
// ============================================================
const UNITS = ['001', '002', '003']

async function ensureUnitUsers() {
  for (const unit of UNITS) {
    const email = `unit${parseInt(unit, 10)}@monal.com`
    const exists = await User.findOne({ email })

    if (!exists) {
      await User.create({
        name: `Unit ${unit} Staff`,
        email,
        password: `unit${parseInt(unit, 10)}pass`,
        role: 'admin',
        unitNo: unit,
        isUnitUser: true,
        active: true,
      })
      console.log(`✅ Created unit user: ${email}`)
    }
  }
}

// ============================================================
// GET /staff — List all
// ============================================================
router.get('/', protect, async (req, res) => {
  try {
    await ensureUnitUsers()

    const filter = {}

    if (req.user.role === 'admin') {
      filter.$or = [
        { unitNo: req.user.unitNo },
        { role: { $in: ['md', 'md_finance', 'ceo'] } },
      ]
    }

    const staff = await User.find(filter)
      .select('-password')
      .sort({ role: 1, unitNo: 1, createdAt: -1 })

    res.json(staff)
  } catch (err) {
    console.error('❌ GET /staff error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /staff/unit/:unitNo
// ============================================================
router.get('/unit/:unitNo', protect, async (req, res) => {
  try {
    const unitNo = req.params.unitNo
    const email = `unit${parseInt(unitNo, 10)}@monal.com`

    const user = await User.findOne({ email }).select('-password')
    if (!user) return res.status(404).json({ message: 'Unit user not found' })

    res.json(user)
  } catch (err) {
    console.error('❌ GET /staff/unit/:unitNo error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// POST /staff — Create new staff
// MD/MD Finance only
// ============================================================
router.post('/', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { name, email, password, role, unitNo } = req.body

    if (!email || !password) {
      return res.status(400).json({ message: 'Email and password required' })
    }

    if (role === 'admin' && !unitNo) {
      return res.status(400).json({ message: 'Admin must have a unit' })
    }

    const exists = await User.findOne({ email: email.toLowerCase().trim() })
    if (exists) {
      return res.status(400).json({ message: 'Email already exists' })
    }

    const user = await User.create({
      name: (name || '').trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || 'admin',
      unitNo: unitNo || null,
      createdBy: req.user._id,
    })

    const out = user.toObject()
    delete out.password
    res.status(201).json(out)
  } catch (err) {
    console.error('❌ POST /staff error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PUT /staff/:id — Update (MD/MD Finance)
// ============================================================
router.put('/:id', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { name, role, unitNo, active, password, oldPassword, resetPassword } = req.body

    const target = await User.findById(req.params.id)
    if (!target) return res.status(404).json({ message: 'Staff not found' })

    if (target.isSuperMD && role && role !== 'md') {
      return res.status(403).json({ message: 'Cannot change Super MD role' })
    }

    const update = {}
    if (name !== undefined) update.name = name
    if (role !== undefined) update.role = role
    if (unitNo !== undefined) update.unitNo = unitNo
    if (active !== undefined) update.active = active

    // ✅ Reset password (MD only)
    if (resetPassword) {
      if (req.user.role !== 'md') {
        return res.status(403).json({ message: 'Only MD can reset passwords' })
      }
      update.password = await bcrypt.hash('1098765432', 10)
      update.mustChangePassword = true
    }
    // ✅ Manual password change — verify old password (MD only)
    else if (password) {
      if (req.user.role !== 'md') {
        return res.status(403).json({ message: 'Only MD can change passwords' })
      }
      if (!oldPassword) {
        return res.status(400).json({ message: 'Current password required' })
      }
      if (password.length < 6) {
        return res.status(400).json({ message: 'New password min 6 chars' })
      }

      // ✅ Verify old password
      const match = await target.matchPassword(oldPassword)
      if (!match) {
        return res.status(401).json({ message: 'Current password is incorrect' })
      }

      update.password = await bcrypt.hash(password, 10)
      update.mustChangePassword = false
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      update,
      { returnDocument: 'after' }
    ).select('-password')

    res.json(user)
  } catch (err) {
    console.error('❌ PUT /staff error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PUT /staff/unit/:unitNo/password
// ============================================================
router.put('/unit/:unitNo/password', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { unitNo } = req.params
    const { password } = req.body

    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password min 6 chars' })
    }

    const email = `unit${parseInt(unitNo, 10)}@monal.com`
    const hashed = await bcrypt.hash(password, 10)

    const user = await User.findOneAndUpdate(
      { email },
      { password: hashed },
      { returnDocument: 'after' }
    ).select('-password')

    if (!user) return res.status(404).json({ message: 'Unit user not found' })

    res.json({ message: 'Password updated', user })
  } catch (err) {
    console.error('❌ PUT /staff/unit/:unitNo/password error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// DELETE /staff/:id — Delete (MD only)
// ============================================================
router.delete('/:id', protect, requireRole('md'), async (req, res) => {
  try {
    if (req.params.id === req.user._id.toString()) {
      return res.status(403).json({ message: 'You cannot delete your own account' })
    }

    const target = await User.findById(req.params.id)
    if (!target) return res.status(404).json({ message: 'Staff not found' })

    if (target.isSuperMD) {
      return res.status(403).json({ message: '🔒 Super MD account cannot be deleted' })
    }

    // ✅ Unit user protection
    if (target.isUnitUser) {
      return res.status(403).json({
        message: '🔒 Unit credentials cannot be deleted (used by staff)',
      })
    }

    await User.findByIdAndDelete(req.params.id)
    res.json({ message: 'Deleted' })
  } catch (err) {
    console.error('❌ DELETE /staff error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router