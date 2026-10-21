import mongoose from 'mongoose'

const activeSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    app: {
      type: String,
      enum: ['admin', 'billing'],
      required: true,
    },
    sessionId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    device: { type: String, default: '' },
    ip:     { type: String, default: '' },
    lastSeenAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

activeSessionSchema.index({ userId: 1, app: 1, createdAt: 1 })

export const ActiveSession = mongoose.model('ActiveSession', activeSessionSchema)