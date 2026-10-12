import express from 'express'
import mongoose from 'mongoose'
import cors from 'cors'
import dotenv from 'dotenv'

// ✅ STEP 1: dotenv FIRST — before any routes import
dotenv.config()

// ✅ STEP 2: Dynamic import — AFTER dotenv.config()
const { default: authRoutes }     = await import('./routes/authRoutes.js')
const { default: stitchingRoutes } = await import('./routes/stitchingRoutes.js')
const { default: staffRoutes }    = await import('./routes/staffRoutes.js')

const app = express()

// ============================================================
// CORS
// ============================================================
const allowedOrigins = [
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:3000',
  'https://monal-admin-pied.vercel.app',
  'https://monal-frontend.vercel.app',
]

app.use(cors({
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps, curl, Postman)
    if (!origin) return callback(null, true)
    if (allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true)
    } else {
      console.warn('❌ Blocked by CORS:', origin)
      callback(new Error('Not allowed by CORS'))
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}))

app.use(express.json({ limit: '50mb' }))
app.use(express.urlencoded({ extended: true, limit: '50mb' }))

// ============================================================
// ROUTES
// ============================================================
app.use('/staff',     staffRoutes)
app.use('/auth',      authRoutes)
app.use('/stitching', stitchingRoutes)

// Health check
app.get('/', (req, res) => {
  res.json({ message: 'Monal Boutiques API ✅' })
})

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'OK',
    mongodb: mongoose.connection.readyState === 1 ? 'Connected' : 'Disconnected',
    database: mongoose.connection.name,
    host: mongoose.connection.host,
  })
})

// ============================================================
// 404 HANDLER
// ============================================================
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.originalUrl} not found`,
  })
})

// ============================================================
// ERROR HANDLER
// ============================================================
app.use((err, req, res, next) => {
  console.error('❌ Server Error:', err.message)
  res.status(500).json({
    success: false,
    message: 'Internal Server Error',
    error: process.env.NODE_ENV === 'development' ? err.message : undefined,
  })
})

// ============================================================
// MONGODB CONNECTION WITH RETRY
// ============================================================
const connectWithRetry = async (retries = 5, delay = 5000) => {
  const mongoURI = process.env.MONGO_URI || 'mongodb://localhost:27017/Monal_billing'

  console.log(`📊 Attempting to connect to MongoDB... (${retries} retries left)`)
  console.log(`📍 MONGO_URI: ${mongoURI}`)

  try {
    await mongoose.connect(mongoURI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 45000,
      connectTimeoutMS: 30000,
      maxPoolSize: 10,
      minPoolSize: 2,
    })

    console.log('✅ MongoDB connected')
    console.log(`📍 Connected to: ${mongoose.connection.host}`)
    console.log(`📍 Database name: ${mongoose.connection.name}`)

    const PORT = process.env.PORT || 5000
    app.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`)
      console.log(`🔗 Health check: http://localhost:${PORT}/health`)
    })
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message)

    if (retries > 0) {
      console.log(`🔄 Retrying in ${delay / 1000} seconds... (${retries - 1} retries left)`)
      setTimeout(() => connectWithRetry(retries - 1, delay), delay)
    } else {
      console.error('❌ All retries failed. Exiting...')
      process.exit(1)
    }
  }
}

connectWithRetry()

// ============================================================
// GRACEFUL SHUTDOWN
// ============================================================
process.on('SIGINT', async () => {
  try {
    await mongoose.connection.close()
    console.log('✅ MongoDB connection closed')
    process.exit(0)
  } catch (err) {
    console.error('❌ Error closing MongoDB:', err)
    process.exit(1)
  }
})