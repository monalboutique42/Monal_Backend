import express from 'express'
import User from '../models/User.js'
import { protect, requireRole } from '../middleware/auth.js'

const router = express.Router()

// ============================================================
// GET /staff — List all
// Only MD + MD Finance
// ============================================================
// ============ GET /staff (List all) ============
router.get('/', protect, async (req, res) => {
  try {
    const filter = {}

    // ✅ Admin → only own unit staff
    if (req.user.role === 'admin') {
      filter.$or = [
        { unitNo: req.user.unitNo },      // Same unit staff
        { role: { $in: ['md', 'md_finance', 'ceo'] } },   // + Higher roles
      ]
    }

    const staff = await User.find(filter).select('-password').sort({ createdAt: -1 })
    res.json(staff)
  } catch (err) {
    console.error('❌ GET /staff error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// POST /staff — Create new staff
// Only MD + MD Finance
// ============================================================
router.post('/', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { name, email, password, role, unitNo } = req.body

    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email, password required' })
    }

    const exists = await User.findOne({ email: email.toLowerCase().trim() })
    if (exists) {
      return res.status(400).json({ message: 'Email already exists' })
    }

    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      role: role || 'admin',
      unitNo: unitNo || null,
      createdBy: req.user._id,   // ✅ Track who created
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
// PUT /staff/:id — Update
// Only MD + MD Finance
// ============================================================
router.put('/:id', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    const { name, role, unitNo, active } = req.body

    // ✅ Prevent role change on Super MD
    const target = await User.findById(req.params.id)
    if (!target) return res.status(404).json({ message: 'Staff not found' })

    if (target.isSuperMD && role && role !== 'md') {
      return res.status(403).json({
        message: 'Cannot change Super MD role',
      })
    }

    const update = {}
    if (name !== undefined) update.name = name
    if (role !== undefined) update.role = role
    if (unitNo !== undefined) update.unitNo = unitNo
    if (active !== undefined) update.active = active

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
// DELETE /staff/:id — Delete
// Only MD + MD Finance
// ✅ Super MD CANNOT be deleted
// ✅ Also cannot delete yourself
// ============================================================
router.delete('/:id', protect, requireRole('md', 'md_finance'), async (req, res) => {
  try {
    // ✅ Prevent deleting yourself
    if (req.params.id === req.user._id.toString()) {
      return res.status(403).json({
        message: 'You cannot delete your own account',
      })
    }

    const target = await User.findById(req.params.id)
    if (!target) return res.status(404).json({ message: 'Staff not found' })

    // ✅ Super MD protection
    if (target.isSuperMD) {
      return res.status(403).json({
        message: '🔒 Super MD account cannot be deleted',
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