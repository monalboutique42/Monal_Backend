import mongoose from 'mongoose'
import dotenv from 'dotenv'
import User from '../models/User.js'

dotenv.config()

const seedMD = async () => {
  try {
    const email = process.argv[2] || 'md@monal.com'
    const password = process.argv[3] || 'monal123'
    const name = process.argv[4] || 'Super MD'

    console.log('🔌 Connecting to MongoDB...')
    await mongoose.connect(process.env.MONGO_URI)
    console.log('✅ MongoDB connected')

    // Check if super MD already exists
    const existingSuperMD = await User.findOne({ isSuperMD: true })
    if (existingSuperMD) {
      console.log('⚠️  Super MD account already exists:')
      console.log('   Email:', existingSuperMD.email)
      console.log('   Name:', existingSuperMD.name)
      console.log('   This account cannot be re-created.')
      await mongoose.disconnect()
      process.exit(0)
    }

    // Check if email already in use
    const existingEmail = await User.findOne({ email: email.toLowerCase() })
    if (existingEmail) {
      console.log('❌ Email already in use:', email)
      await mongoose.disconnect()
      process.exit(1)
    }

    // Create Super MD
    console.log('📝 Creating Super MD account...')
    const md = await User.create({
      name,
      email,
      password,
      role: 'md',
      unitNo: null,
      active: true,
      isSuperMD: true,    // ✅ Unremovable flag
      createdBy: null,    // ✅ Seeded — no creator
    })

    console.log('✅ Super MD created successfully!')
    console.log('   ID:', md._id)
    console.log('   Name:', md.name)
    console.log('   Email:', md.email)
    console.log('   Role:', md.role)
    console.log('   🔒 Super MD — Cannot be deleted')
    console.log('')
    console.log('🎉 You can now login with these credentials.')

    await mongoose.disconnect()
    process.exit(0)
  } catch (err) {
    console.error('❌ Error:', err.message)
    await mongoose.disconnect()
    process.exit(1)
  }
}

seedMD()