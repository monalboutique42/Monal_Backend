import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema(
  {
    name:     { type: String, required: true, trim: true },
    email:    { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },
    role:     {
      type: String,
      enum: ['md', 'md_finance', 'ceo', 'admin'],
      default: 'admin',
    },
    unitNo:   { type: String, default: null },
    active:   { type: Boolean, default: true },

    // ✅ Super MD protection
    isSuperMD: { type: Boolean, default: false },

    // ✅ Who created this account
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
)

// ============================================================
// ✅ FIX — No next callback (Mongoose 7+)
// ============================================================
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 10)
})

// Compare password
userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password)
}

export default mongoose.model('User', userSchema)