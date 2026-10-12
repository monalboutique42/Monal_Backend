import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'

// ✅ STEP 1: dotenv FIRST — before any routes import
dotenv.config()

// ✅ STEP 2: Dynamic import — AFTER dotenv.config()
const { default: authRoutes } = await import('./routes/authRoutes.js')
const { default: stitchingRoutes } = await import('./routes/stitchingRoutes.js')
const { default: staffRoutes } = await import('./routes/staffRoutes.js')

const app = express()

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://localhost:5174',
    'https://monal-admin-pied.vercel.app',
    'https://monal-frontend.vercel.app',
  ],
  credentials: true,
}))
app.use(express.json({ limit: '10mb' }))

// Routes
app.use('/staff', staffRoutes)
app.use('/auth', authRoutes)
app.use('/stitching', stitchingRoutes)

app.get('/', (req, res) => {
  res.json({ message: 'Monal Boutiques API ✅' })
})

mongoose
  .connect(process.env.MONGO_URI)
  .then(() => console.log('MongoDB connected ✅'))
  .catch((err) => console.log('MongoDB error:', err.message))

const PORT = process.env.PORT || 5000
app.listen(PORT, () => console.log(`Server on port ${PORT} 🚀`))