import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const userSchema = new mongoose.Schema(
  {
    // ✅ Name optional (unit users-ku venaam)
    name:     { type: String, trim: true, default: '' },

    email:    { type: String, required: true, unique: true, lowercase: true },
    password: { type: String, required: true, minlength: 6 },

    role: {
      type: String,
      enum: ['md', 'md_finance', 'ceo', 'admin'],
      default: 'admin',
    },

    // ✅ Unit-based user-ku unitNo mandatory (admin role-ku)
    unitNo:   { type: String, default: null },
    active:   { type: Boolean, default: true },

    // ✅ Super MD protection
    isSuperMD: { type: Boolean, default: false },

    // ✅ Super Admin (developer-only, invisible to all staff)
    isSuperAdmin: { type: Boolean, default: false },

    // ✅ Unit user flag (unit email + pass shared by staff)
    isUnitUser: { type: Boolean, default: false },

    mustChangePassword: { type: Boolean, default: false },   // ✅ ADD

    // ✅ Who created this account
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
)

// ✅ Hash password (Mongoose 7+ style)
userSchema.pre('save', async function () {
  if (!this.isModified('password')) return
  this.password = await bcrypt.hash(this.password, 10)
})

// Compare password
userSchema.methods.matchPassword = function (entered) {
  return bcrypt.compare(entered, this.password)
}

export default mongoose.model('User', userSchema)