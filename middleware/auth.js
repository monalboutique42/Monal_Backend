import jwt from 'jsonwebtoken'
import User from '../models/User.js'
import { ActiveSession } from '../models/ActiveSession.js'

// ============================================================
// protect — verify JWT + verify session still alive
// ============================================================
export const protect = async (req, res, next) => {
  try {
    let token
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1]
    }
    if (!token) return res.status(401).json({ message: 'Not authorized' })

    const decoded = jwt.verify(token, process.env.JWT_SECRET)

    // ✅ Session must still exist
    const session = await ActiveSession.findOne({
      userId: decoded.id,
      app: decoded.app,
      sessionId: decoded.sessionId,
    })

    if (!session) {
      return res.status(401).json({
        message: 'Session ended — logged in on another device',
        sessionEnded: true,
      })
    }

    session.lastSeenAt = new Date()
    await session.save()

    const user = await User.findById(decoded.id).select('-password')
    if (!user) return res.status(401).json({ message: 'User not found' })
    if (!user.active) return res.status(403).json({ message: 'Account inactive' })

    req.user = user
    req.session = {
      app: decoded.app,
      sessionId: decoded.sessionId,
    }
    next()
  } catch (err) {
    return res.status(401).json({ message: 'Token invalid or expired' })
  }
}

// ============================================================
// requireRole
// ============================================================
export const requireRole = (...roles) => (req, res, next) => {
  if (!req.user) return res.status(401).json({ message: 'Not authorized' })
  if (!roles.includes(req.user.role)) {
    return res.status(403).json({
      message: `Access denied — ${req.user.role} role not permitted`,
    })
  }
  next()
}