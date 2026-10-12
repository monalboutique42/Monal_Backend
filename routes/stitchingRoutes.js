import express from 'express'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import StitchingBill from '../models/StitchingBill.js'
import { protect, restrictToUnit } from '../middleware/auth.js'


const router = express.Router()

// ============================================================
// CLOUDINARY SETUP
// ============================================================
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
})

// ============================================================
// MULTER — memory storage (buffer in RAM, then upload to Cloudinary)
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
})

// ============================================================
// Helper: Upload buffer to Cloudinary via UNSIGNED upload
// (upload_stream 403 varudhu on free plan, so unsigned_upload use pandrom)
// ============================================================
const uploadToCloudinary = async (buffer) => {
  const base64 = buffer.toString('base64')
  const dataUri = `data:image/jpeg;base64,${base64}`

  const result = await cloudinary.uploader.unsigned_upload(
    dataUri,
    'monal_unsigned',
    { folder: 'monal-boutique' }
  )

  return result
}

// ============================================================
// Middleware: Handle single photo upload safely
// ============================================================
const uploadSinglePhoto = (req, res, next) => {
  upload.single('orderPhoto')(req, res, async (err) => {
    if (err) {
      console.error('❌ Multer error:', err.message)
      return res.status(500).json({
        message: err.message || 'File upload failed',
      })
    }

    // No file uploaded — skip
    if (!req.file) return next()

    // Upload buffer to Cloudinary
    try {
      console.log('📤 Uploading to Cloudinary (unsigned)...')
      console.log('   File:', req.file.originalname, req.file.size, 'bytes')

      const result = await uploadToCloudinary(req.file.buffer)

      console.log('✅ Cloudinary upload OK:', result.secure_url)

      req.file.path = result.secure_url
      req.file.cloudinaryResult = result
      next()
    } catch (cloudErr) {
      console.error('❌ Cloudinary upload FAIL:', cloudErr.message)
      return res.status(500).json({
        message: 'Cloudinary upload failed: ' + cloudErr.message,
      })
    }
  })
}

// ============================================================
// HELPER: Generate Bill No
// Format: YYYY + MM + UnitNo(3) + BillNo(3)
// Example: 202610001001
// ============================================================
async function generateBillNo(unitNo) {
  const now = new Date()
  const year  = now.getFullYear().toString()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const unit  = (unitNo || '001').padStart(3, '0')

  const prefix = `${year}${month}${unit}` // 202610001

  const lastBill = await StitchingBill
    .findOne({ billNo: { $regex: `^${prefix}` } })
    .sort({ billNo: -1 })

  let nextSeq = 1
  if (lastBill) {
    const lastSeq = parseInt(lastBill.billNo.slice(prefix.length), 10)
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1
  }

  const seq = nextSeq.toString().padStart(3, '0')
  return `${prefix}${seq}`
}

// ============================================================
// GET /stitching/next-bill-no
// ============================================================
router.get('/next-bill-no', async (req, res) => {
  try {
    const { unitNo } = req.query
    if (!unitNo) return res.status(400).json({ message: 'unitNo required' })
    const billNo = await generateBillNo(unitNo)
    res.json({ billNo })
  } catch (err) {
    console.error('❌ GET next-bill-no error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching (list + filter)
// ============================================================
router.get('/', async (req, res) => {
  try {
    const { unitNo, status, from, to, search } = req.query
    const filter = {}

    if (unitNo) filter.unitNo = unitNo
    if (status) filter.status = status

    // Filter by CREATED date (full day range)
    if (from || to) {
      filter.createdAt = {}
      if (from) {
        const startOfDay = new Date(from)
        startOfDay.setHours(0, 0, 0, 0)
        filter.createdAt.$gte = startOfDay
      }
      if (to) {
        const endOfDay = new Date(to)
        endOfDay.setHours(23, 59, 59, 999)
        filter.createdAt.$lte = endOfDay
      }
    }

    if (search) {
      filter.$or = [
        { customerName:   { $regex: search, $options: 'i' } },
        { customerMobile: { $regex: search, $options: 'i' } },
        { billNo:         { $regex: search, $options: 'i' } },
      ]
    }

    const bills = await StitchingBill.find(filter).sort({ createdAt: -1 })
    res.json(bills)
  } catch (err) {
    console.error('❌ GET /stitching error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/reminders (tomorrow's deliveries)
// ============================================================
router.get('/reminders', async (req, res) => {
  try {
    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const dayAfter = new Date(tomorrow)
    dayAfter.setDate(dayAfter.getDate() + 1)

    const bills = await StitchingBill.find({
      deliveryDate: { $gte: tomorrow, $lt: dayAfter },
      status: { $ne: 'delivered' },
    }).sort({ deliveryDate: 1 })

    res.json(bills)
  } catch (err) {
    console.error('❌ GET /stitching/reminders error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/:id
// ============================================================
router.get('/:id', async (req, res) => {
  try {
    const bill = await StitchingBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Not found' })
    res.json(bill)
  } catch (err) {
    console.error('❌ GET /stitching/:id error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// POST /stitching (create)
// ============================================================
router.post('/', uploadSinglePhoto, async (req, res) => {
  try {
    const data = { ...req.body }

    // Parse measurements
    if (typeof data.measurements === 'string') {
      try {
        data.measurements = JSON.parse(data.measurements)
      } catch (e) {
        data.measurements = {}
      }
    }

    // Generate bill no
    data.billNo = await generateBillNo(data.unitNo)

    // Photo URL from Cloudinary
    if (req.file) {
      data.orderPhoto = req.file.path
    }

    // Amount calculations
    data.amount  = Number(data.amount || 0)
    data.total   = Number(data.total || data.amount || 0)
    data.advance = Number(data.advance || 0)
    data.balance = data.total - data.advance

    const bill = await StitchingBill.create(data)
    res.status(201).json(bill)
  } catch (err) {
    console.error('❌ POST /stitching error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PUT /stitching/:id (update)
// ============================================================
router.put('/:id', uploadSinglePhoto, async (req, res) => {
  try {
    const data = { ...req.body }

    // Remove immutable/meta fields
    delete data._id
    delete data.createdAt
    delete data.updatedAt
    delete data.__v

    // Parse measurements (safe)
    if (typeof data.measurements === 'string') {
      try {
        data.measurements = JSON.parse(data.measurements)
      } catch (e) {
        delete data.measurements
      }
    }

    // Convert empty string numeric fields to Numbers
    if (data.amount !== undefined && data.amount !== '') {
      data.amount = Number(data.amount)
    }
    if (data.total !== undefined && data.total !== '') {
      data.total = Number(data.total)
    }
    if (data.advance !== undefined) {
      data.advance = data.advance === '' ? 0 : Number(data.advance)
    }

    // Recalculate balance
    const totalVal = data.total !== undefined ? data.total : data.amount
    if (totalVal !== undefined) {
      data.balance = Number(totalVal || 0) - Number(data.advance || 0)
    }

    // Attach uploaded photo URL if present
    if (req.file) {
      data.orderPhoto = req.file.path
    }

    const bill = await StitchingBill.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    if (!bill) {
      return res.status(404).json({ message: 'Bill not found' })
    }

    res.json(bill)
  } catch (err) {
    console.error('❌ PUT /stitching error:', err.message)
    res.status(500).json({ message: err.message || 'Update failed' })
  }
})

// ============================================================
// PATCH /stitching/:id/status
// ============================================================
router.patch('/:id/status', async (req, res) => {
  try {
    const bill = await StitchingBill.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { returnDocument: 'after' }
    )
    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json(bill)
  } catch (err) {
    console.error('❌ PATCH /stitching/:id/status error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// DELETE /stitching/:id
// ============================================================
router.delete('/:id', async (req, res) => {
  try {
    const bill = await StitchingBill.findByIdAndDelete(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json({ message: 'Deleted' })
  } catch (err) {
    console.error('❌ DELETE /stitching error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router