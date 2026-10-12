import jwt from 'jsonwebtoken'
import User from '../models/User.js'

// ============ protect: Verify JWT ============
export const protect = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1]
    if (!token) return res.status(401).json({ message: 'No token' })

    const decoded = jwt.verify(token, process.env.JWT_SECRET)
    req.user = await User.findById(decoded.id).select('-password')
    if (!req.user) return res.status(401).json({ message: 'User not found' })

    next()
  } catch (err) {
    res.status(401).json({ message: 'Invalid token' })
  }
}

// ============ requireRole: Check user role ============
export const requireRole = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ message: 'Not authenticated' })
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json({
        message: `Access denied. Required: ${allowedRoles.join(', ')}`,
      })
    }
    next()
  }
}

// ============ restrictToUnit: Admin can only access own unit ============
export const restrictToUnit = (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authenticated' })

  // MD, MD Finance, CEO → all units
  if (['md', 'md_finance', 'ceo'].includes(req.user.role)) {
    return next()
  }

  // Admin → only own unit
  if (req.user.role === 'admin') {
    // Force the unitNo to be the admin's unit
    if (req.query.unitNo && req.query.unitNo !== req.user.unitNo) {
      return res.status(403).json({
        message: 'You can only access your assigned unit',
      })
    }
    req.forcedUnitNo = req.user.unitNo
    return next()
  }

  return res.status(403).json({ message: 'Access denied' })
}