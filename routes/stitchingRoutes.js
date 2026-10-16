import express from 'express'
import multer from 'multer'
import { v2 as cloudinary } from 'cloudinary'
import StitchingBill from '../models/StitchingBill.js'
import { protect } from '../middleware/auth.js'

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
// MULTER — memory storage
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
})

// ============================================================
// Helper: Upload buffer to Cloudinary (unsigned)
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
// Helper: Delete Cloudinary image by public_id
// ============================================================
const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return
  try {
    await cloudinary.uploader.destroy(publicId)
    console.log('🗑️  Deleted from Cloudinary:', publicId)
  } catch (err) {
    console.error('⚠️  Cloudinary delete failed:', err.message)
  }
}

// ============================================================
// Middleware: Handle both order + reference photo uploads
// ============================================================
const uploadPhotos = (req, res, next) => {
  const uploadFields = upload.fields([
    { name: 'orderPhoto',     maxCount: 1 },
    { name: 'referencePhoto', maxCount: 1 },
  ])

  uploadFields(req, res, async (err) => {
    if (err) {
      console.error('❌ Multer error:', err.message)
      return res.status(500).json({ message: err.message || 'File upload failed' })
    }

    try {
      // Upload order photo (mandatory if provided)
      if (req.files?.orderPhoto?.[0]) {
        const file = req.files.orderPhoto[0]
        console.log('📤 Uploading order photo:', file.originalname, file.size, 'bytes')
        const result = await uploadToCloudinary(file.buffer)
        req.orderPhotoUrl = result.secure_url
        req.orderPhotoId  = result.public_id
        console.log('✅ Order photo uploaded:', result.secure_url)
      }

      // Upload reference photo (optional)
      if (req.files?.referencePhoto?.[0]) {
        const file = req.files.referencePhoto[0]
        console.log('📤 Uploading reference photo:', file.originalname, file.size, 'bytes')
        const result = await uploadToCloudinary(file.buffer)
        req.referencePhotoUrl = result.secure_url
        req.referencePhotoId  = result.public_id
        console.log('✅ Reference photo uploaded:', result.secure_url)
      }

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
// HELPER: Generate Stitching Bill No
// Format: YYYY + MM + UnitNo(3) + BillNo(3)
// ============================================================
async function generateBillNo(unitNo) {
  const now = new Date()
  const year  = now.getFullYear().toString()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const unit  = (unitNo || '001').padStart(3, '0')

  const prefix = `${year}${month}${unit}`

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
// HELPER: Generate Customer No
// Format: <unitNo> + <seq>    Example: 101, 199, 1100
// ============================================================
async function generateCustomerNo(unitNo) {
  const unit = (unitNo || '1').replace(/^0+/, '')   // "001" → "1"

  // Find all customer numbers starting with this unit
  const prefix = unit
  const bills = await StitchingBill
    .find({ customerNo: { $regex: `^${prefix}` } })
    .select('customerNo')

  // Extract sequence numbers
  let maxSeq = 0
  bills.forEach((b) => {
    const seqStr = b.customerNo.slice(prefix.length)
    const seq = parseInt(seqStr, 10)
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq
  })

  const nextSeq = maxSeq + 1
  const seqStr = nextSeq.toString().padStart(2, '0')   // "01", "99", "100"

  return `${unit}${seqStr}`   // "101", "199", "1100"
}

// ============================================================
// HELPER: Find most recent bill by customerNo
// ============================================================
async function findCustomerByNo(customerNo) {
  if (!customerNo) return null
  const bill = await StitchingBill
    .findOne({ customerNo: customerNo.trim() })
    .sort({ createdAt: -1 })
  return bill
}

// ============================================================
// HELPER: Calculate total loyalty points for a customer
// ============================================================
async function getLoyaltyPoints(customerNo) {
  if (!customerNo) return 0
  const bills = await StitchingBill.find({ customerNo: customerNo.trim() })
  return bills.length * 5   // 1 bill = 5 points
}

// ============================================================
// GET /stitching/next-bill-no
// ============================================================
router.get('/next-bill-no', protect, async (req, res) => {
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
// GET /stitching/customer/:customerNo
// Get customer info (auto-fill) + loyalty points
// ============================================================
router.get('/customer/:customerNo', protect, async (req, res) => {
  try {
    const customerNo = req.params.customerNo?.trim()
    if (!customerNo) {
      return res.status(400).json({ message: 'customerNo required' })
    }

    const lastBill = await findCustomerByNo(customerNo)
    const loyaltyPoints = await getLoyaltyPoints(customerNo)

    if (!lastBill) {
      return res.json({
        found: false,
        loyaltyPoints: 0,
      })
    }

    res.json({
      found: true,
      loyaltyPoints,
      customer: {
        customerNo:     lastBill.customerNo,
        customerName:   lastBill.customerName,
        customerMobile: lastBill.customerMobile,
        measurements:   lastBill.measurements,
        customization:  lastBill.customization,
        description:    lastBill.description,
      },
    })
  } catch (err) {
    console.error('❌ GET /stitching/customer/:customerNo error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/next-customer-no
// Auto-generate next customer number for a unit
// ============================================================
router.get('/next-customer-no', protect, async (req, res) => {
  try {
    const { unitNo } = req.query
    if (!unitNo) return res.status(400).json({ message: 'unitNo required' })
    const customerNo = await generateCustomerNo(unitNo)
    res.json({ customerNo })
  } catch (err) {
    console.error('❌ GET next-customer-no error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/reminders
// Role check: Admin BLOCKED, only MD/CEO/MD Finance
// ============================================================
router.get('/reminders', protect, async (req, res) => {
  try {
    // ✅ Admin blocked
    if (req.user.role === 'admin') {
      return res.status(403).json({
        message: 'Reminders are not available for admin role',
      })
    }

    const { unitNo } = req.query

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const dayAfter = new Date(tomorrow)
    dayAfter.setDate(dayAfter.getDate() + 1)

    const filter = {
      deliveryDate: { $gte: tomorrow, $lt: dayAfter },
      status: { $ne: 'delivered' },
    }

    // ✅ Unit filter for MD/CEO (if unit selected)
    if (unitNo) filter.unitNo = unitNo

    const bills = await StitchingBill.find(filter).sort({ deliveryDate: 1 })
    res.json(bills)
  } catch (err) {
    console.error('❌ GET /stitching/reminders error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching (list + filter)
// Unit-wise access control
// ============================================================
router.get('/', protect, async (req, res) => {
  try {
    const { unitNo, status, from, to, search } = req.query

    // ✅ DEBUG — verify unit param received
    console.log('🔍 GET /stitching — role:', req.user.role, '| userUnit:', req.user.unitNo, '| queryUnitNo:', unitNo)

    const filter = {}

    // ✅ Unit access:
    // - Admin → forced to own unit
    // - MD/CEO/MD Finance → respect query param (strict)
    if (req.user.role === 'admin') {
      filter.unitNo = req.user.unitNo
    } else if (unitNo && unitNo.trim()) {
      filter.unitNo = unitNo.trim()
    }

    if (status) filter.status = status

    // Filter by CREATED date
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
        { customerNo:     { $regex: search, $options: 'i' } },
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
// GET /stitching/reports
// Query: ?from=&to=
// Role: MD/CEO/MD_Finance only
// ============================================================
router.get('/reports', protect, async (req, res) => {
  try {
    // ✅ Admin blocked
    if (req.user.role === 'admin') {
      return res.status(403).json({ message: 'Reports not available for admin' })
    }

    const { from, to } = req.query

    const matchStage = {}

    if (from || to) {
      matchStage.createdAt = {}
      if (from) {
        const start = new Date(from)
        start.setHours(0, 0, 0, 0)
        matchStage.createdAt.$gte = start
      }
      if (to) {
        const end = new Date(to)
        end.setHours(23, 59, 59, 999)
        matchStage.createdAt.$lte = end
      }
    }

    // ✅ Summary aggregates
    const summaryAgg = await StitchingBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalBills:   { $sum: 1 },
          totalAmount:  { $sum: '$amount' },
          totalAdvance: { $sum: '$advance' },
          totalBalance: { $sum: '$balance' },
        },
      },
    ])

    const summary = summaryAgg[0] || {
      totalBills: 0,
      totalAmount: 0,
      totalAdvance: 0,
      totalBalance: 0,
    }

    // ✅ Status breakdown
    const statusAgg = await StitchingBill.aggregate([
      { $match: matchStage },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])

    const statusBreakdown = statusAgg.map((s) => ({
      status: s._id,
      count: s.count,
    }))

    // ✅ Unit-wise breakdown
    const unitAgg = await StitchingBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$unitNo',
          count: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    const unitBreakdown = unitAgg.map((u) => ({
      unitNo: u._id,
      count: u.count,
      totalAmount: u.totalAmount,
    }))

    // ✅ Top customers (by bill count)
    const customerAgg = await StitchingBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$customerNo',
          customerName: { $first: '$customerName' },
          customerMobile: { $first: '$customerMobile' },
          billCount: { $sum: 1 },
          totalAmount: { $sum: '$amount' },
        },
      },
      { $sort: { billCount: -1 } },
      { $limit: 10 },
    ])

    const topCustomers = customerAgg.map((c) => ({
      customerNo: c._id,
      customerName: c.customerName,
      customerMobile: c.customerMobile,
      billCount: c.billCount,
      totalAmount: c.totalAmount,
    }))

    // ✅ Daily trend (last 30 days by default within range)
    const trendMatch = { ...matchStage }
    const trendAgg = await StitchingBill.aggregate([
      { $match: trendMatch },
      {
        $group: {
          _id: {
            $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
          },
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    const dailyTrend = trendAgg.map((d) => ({
      date: d._id,
      count: d.count,
      amount: d.amount,
    }))

    res.json({
      summary,
      statusBreakdown,
      unitBreakdown,
      topCustomers,
      dailyTrend,
    })
  } catch (err) {
    console.error('❌ GET /stitching/reports error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/:id
// ============================================================
router.get('/:id', protect, async (req, res) => {
  try {
    const bill = await StitchingBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Not found' })

    // ✅ Admin can only see own unit bills
    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied — other unit bill' })
    }

    res.json(bill)
  } catch (err) {
    console.error('❌ GET /stitching/:id error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// POST /stitching (create)
// ============================================================
router.post('/', protect, uploadPhotos, async (req, res) => {
  try {
    const data = { ...req.body }

    // ✅ Admin → force own unit
    if (req.user.role === 'admin') {
      data.unitNo = req.user.unitNo
    }

    // Parse measurements
    if (typeof data.measurements === 'string') {
      try {
        data.measurements = JSON.parse(data.measurements)
      } catch (e) {
        data.measurements = {}
      }
    }

    // Parse paymentReference
    if (typeof data.paymentReference === 'string') {
      try {
        data.paymentReference = JSON.parse(data.paymentReference)
      } catch (e) {
        data.paymentReference = { cashDenominations: [], gpayReference: '' }
      }
    }

    // ============ Customer No handling ============
    let customerNo = data.customerNo?.trim()

    // Auto-generate if not provided
    if (!customerNo) {
      customerNo = await generateCustomerNo(data.unitNo)
    }
    data.customerNo = customerNo

    // ============ Loyalty points ============
    // 1 bill = 5 points → new bill adds 5
    const previousPoints = await getLoyaltyPoints(customerNo)
    data.loyaltyPoints = previousPoints + 5

    // ============ Generate bill no ============
    data.billNo = await generateBillNo(data.unitNo)

    // ============ Photos ============
    if (req.orderPhotoUrl) {
      data.orderPhoto = req.orderPhotoUrl
      data.orderPhotoId = req.orderPhotoId
    }
    if (req.referencePhotoUrl) {
      data.referencePhoto = req.referencePhotoUrl
      data.referencePhotoId = req.referencePhotoId
    }

    // ============ Amount calculations ============
    data.amount  = Number(data.amount || 0)
    data.total   = Number(data.total || data.amount || 0)
    data.advance = Number(data.advance || 0)
    data.balance = data.total - data.advance

    // ============ Advance validation ============
    // Unit 2 → advance mandatory (must be > 0)
    if (data.unitNo === '002' && data.advance <= 0) {
      return res.status(400).json({
        message: 'Advance amount is mandatory for Unit 002',
      })
    }


    const bill = await StitchingBill.create(data)

    // ✅ Return with loyalty points included
    res.status(201).json(bill)
  } catch (err) {
    console.error('❌ POST /stitching error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PUT /stitching/:id (update)
// ============================================================
router.put('/:id', protect, uploadPhotos, async (req, res) => {
  try {
    const data = { ...req.body }

    // ✅ Admin → only own unit bills
    if (req.user.role === 'admin') {
      const existing = await StitchingBill.findById(req.params.id)
      if (!existing) return res.status(404).json({ message: 'Bill not found' })
      if (existing.unitNo !== req.user.unitNo) {
        return res.status(403).json({ message: 'Access denied — other unit bill' })
      }
      data.unitNo = req.user.unitNo   // Force own unit
    }

    // Remove immutable fields
    delete data._id
    delete data.createdAt
    delete data.updatedAt
    delete data.__v
    delete data.billNo
    delete data.customerNo
    delete data.loyaltyPoints

    // Parse measurements (safe)
    if (typeof data.measurements === 'string') {
      try {
        data.measurements = JSON.parse(data.measurements)
      } catch (e) {
        delete data.measurements
      }
    }

    // Parse paymentReference
    if (typeof data.paymentReference === 'string') {
      try {
        data.paymentReference = JSON.parse(data.paymentReference)
      } catch (e) {
        delete data.paymentReference
      }
    }

    // Convert numeric fields
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

    // ============ Advance validation ============
    const existing = await StitchingBill.findById(req.params.id)
    const checkUnit = data.unitNo || existing?.unitNo
    const checkAdvance = data.advance !== undefined ? data.advance : existing?.advance

    if (checkUnit === '002' && checkAdvance <= 0) {
      return res.status(400).json({
        message: 'Advance amount is mandatory for Unit 002',
      })
    }

    // ============ Photos — destroy old if replaced ============
    if (req.orderPhotoUrl) {
      // Destroy old order photo
      if (existing?.orderPhotoId) {
        await deleteFromCloudinary(existing.orderPhotoId)
      }
      data.orderPhoto = req.orderPhotoUrl
      data.orderPhotoId = req.orderPhotoId
    }

    if (req.referencePhotoUrl) {
      // Destroy old reference photo
      if (existing?.referencePhotoId) {
        await deleteFromCloudinary(existing.referencePhotoId)
      }
      data.referencePhoto = req.referencePhotoUrl
      data.referencePhotoId = req.referencePhotoId
    }

    const bill = await StitchingBill.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json(bill)
  } catch (err) {
    console.error('❌ PUT /stitching error:', err.message)
    res.status(500).json({ message: err.message || 'Update failed' })
  }
})

// ============================================================
// PATCH /stitching/:id/status
// ============================================================
router.patch('/:id/status', protect, async (req, res) => {
  try {
    const bill = await StitchingBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })

    // ✅ Admin → only own unit bills
    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied — other unit bill' })
    }

    bill.status = req.body.status
    await bill.save()

    res.json(bill)
  } catch (err) {
    console.error('❌ PATCH /stitching/:id/status error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// DELETE /stitching/:id
// ============================================================
router.delete('/:id', protect, async (req, res) => {
  try {
    const bill = await StitchingBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })

    // ✅ Admin → only own unit bills
    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied — other unit bill' })
    }

    // ✅ Destroy images from Cloudinary
    if (bill.orderPhotoId)     await deleteFromCloudinary(bill.orderPhotoId)
    if (bill.referencePhotoId) await deleteFromCloudinary(bill.referencePhotoId)

    await StitchingBill.findByIdAndDelete(req.params.id)
    res.json({ message: 'Deleted' })
  } catch (err) {
    console.error('❌ DELETE /stitching error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router