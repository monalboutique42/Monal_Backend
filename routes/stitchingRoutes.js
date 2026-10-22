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
// MULTER
// ============================================================
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
})

// ============================================================
// Cloudinary helpers
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

const deleteFromCloudinary = async (publicId) => {
  if (!publicId) return
  try {
    await cloudinary.uploader.destroy(publicId)
  } catch (err) {
    console.error('⚠️ Cloudinary delete failed:', err.message)
  }
}

// ============================================================
// Photo upload middleware
// ============================================================
const uploadPhotos = (req, res, next) => {
  const uploadFields = upload.fields([
    { name: 'orderPhoto',     maxCount: 1 },
    { name: 'referencePhoto', maxCount: 1 },
  ])

  uploadFields(req, res, async (err) => {
    if (err) {
      return res.status(500).json({ message: err.message || 'File upload failed' })
    }
    try {
      if (req.files?.orderPhoto?.[0]) {
        const file = req.files.orderPhoto[0]
        const result = await uploadToCloudinary(file.buffer)
        req.orderPhotoUrl = result.secure_url
        req.orderPhotoId  = result.public_id
      }
      if (req.files?.referencePhoto?.[0]) {
        const file = req.files.referencePhoto[0]
        const result = await uploadToCloudinary(file.buffer)
        req.referencePhotoUrl = result.secure_url
        req.referencePhotoId  = result.public_id
      }
      next()
    } catch (cloudErr) {
      return res.status(500).json({
        message: 'Cloudinary upload failed: ' + cloudErr.message,
      })
    }
  })
}

// ============================================================
// HELPERS
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
  return `${prefix}${nextSeq.toString().padStart(3, '0')}`
}

async function generateCustomerNo(unitNo) {
  const unit = (unitNo || '1').replace(/^0+/, '')
  const prefix = unit
  const bills = await StitchingBill
    .find({ customerNo: { $regex: `^${prefix}` } })
    .select('customerNo')

  let maxSeq = 0
  bills.forEach((b) => {
    const seqStr = b.customerNo.slice(prefix.length)
    const seq = parseInt(seqStr, 10)
    if (!isNaN(seq) && seq > maxSeq) maxSeq = seq
  })

  const nextSeq = maxSeq + 1
  return `${unit}${nextSeq.toString().padStart(2, '0')}`
}

async function findCustomerByNo(customerNo) {
  if (!customerNo) return null
  return await StitchingBill
    .findOne({ customerNo: customerNo.trim() })
    .sort({ createdAt: -1 })
}

// ============================================================
// Get today's date string (YYYY-MM-DD)
// ============================================================
function getTodayStr() {
  const now = new Date()
  const yyyy = now.getFullYear()
  const mm = String(now.getMonth() + 1).padStart(2, '0')
  const dd = String(now.getDate()).padStart(2, '0')
  return `${yyyy}-${mm}-${dd}`
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
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/customer/:customerNo
// ============================================================
router.get('/customer/:customerNo', protect, async (req, res) => {
  try {
    const customerNo = req.params.customerNo?.trim()
    if (!customerNo) return res.status(400).json({ message: 'customerNo required' })

    const lastBill = await findCustomerByNo(customerNo)
    if (!lastBill) return res.json({ found: false })

    res.json({
      found: true,
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
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/next-customer-no
// ============================================================
router.get('/next-customer-no', protect, async (req, res) => {
  try {
    const { unitNo } = req.query
    if (!unitNo) return res.status(400).json({ message: 'unitNo required' })
    const customerNo = await generateCustomerNo(unitNo)
    res.json({ customerNo })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/reminders
// ============================================================
router.get('/reminders', protect, async (req, res) => {
  try {
    if (req.user.role === 'admin') {
      return res.status(403).json({ message: 'Reminders are not available for admin role' })
    }

    const { unitNo } = req.query

    const tomorrow = new Date()
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(0, 0, 0, 0)

    const dayAfter = new Date(tomorrow)
    dayAfter.setDate(dayAfter.getDate() + 1)

    const filter = { deliveryDate: { $gte: tomorrow, $lt: dayAfter } }
    if (unitNo) filter.unitNo = unitNo

    const bills = await StitchingBill.find(filter).sort({ deliveryDate: 1 })
    res.json(bills)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/dues/summary — Due total for Dashboard
// MUST be before /:id route
// ============================================================
router.get('/dues/summary', protect, async (req, res) => {
  try {
    const { unitNo } = req.query

    const matchStage = {
      balance: { $gt: 0 },
      status: { $ne: 'delivered' },
    }

    if (req.user.role === 'admin') {
      matchStage.unitNo = req.user.unitNo
    } else if (unitNo) {
      matchStage.unitNo = unitNo
    }

    const agg = await StitchingBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$unitNo',
          bills: { $sum: 1 },
          totalDue: { $sum: '$balance' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    const unitWise = agg.map((u) => ({
      unitNo: u._id,
      bills: u.bills,
      totalDue: u.totalDue,
    }))

    const totalDue = unitWise.reduce((s, u) => s + u.totalDue, 0)

    res.json({ unitWise, totalDue })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/denominations/by-date
// MUST be before /:id route
// ============================================================
router.get('/denominations/by-date', protect, async (req, res) => {
  try {
    const { from, to, unitNo } = req.query

    const matchStage = {}
    if (req.user.role === 'admin') {
      matchStage.unitNo = req.user.unitNo
    } else if (unitNo) {
      matchStage.unitNo = unitNo
    }

    const bills = await StitchingBill.find(matchStage)
      .select('paymentHistory unitNo billNo')
      .lean()

    const byDate = {}

    bills.forEach((bill) => {
      ;(bill.paymentHistory || []).forEach((p) => {
        if (from && p.paymentDate < from) return
        if (to && p.paymentDate > to) return
        if (p.paymentMode !== 'cash') return

        const d = p.paymentDate
        if (!byDate[d]) {
          byDate[d] = {
            date: d,
            totalAmount: 0,
            bills: new Set(),
            denominations: {},
          }
        }
        byDate[d].totalAmount += Number(p.amountPaid || 0)
        byDate[d].bills.add(bill.billNo)

        ;(p.paymentReference?.cashDenominations || []).forEach((denom) => {
          const val = Number(denom.denomination || 0)
          const cnt = Number(denom.count || 0)
          if (cnt > 0 && val > 0) {
            byDate[d].denominations[val] = (byDate[d].denominations[val] || 0) + cnt
          }
        })
      })
    })

    const result = Object.values(byDate)
      .sort((a, b) => b.date.localeCompare(a.date))
      .map((d) => ({
        date: d.date,
        totalAmount: d.totalAmount,
        bills: d.bills.size,
        denominations: Object.entries(d.denominations)
          .map(([denom, count]) => ({
            denomination: Number(denom),
            count,
            value: Number(denom) * count,
          }))
          .sort((a, b) => b.denomination - a.denomination),
      }))

    res.json(result)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/:id/payments — payment history
// MUST be before /:id route
// ============================================================
router.get('/:id/payments', protect, async (req, res) => {
  try {
    const bill = await StitchingBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })

    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied' })
    }

    const history = (bill.paymentHistory || []).slice().sort((a, b) =>
      a.paymentDate.localeCompare(b.paymentDate)
    )
    res.json(history)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching (list + filter)
// ============================================================
router.get('/', protect, async (req, res) => {
  try {
const { unitNo, status, from, to, search, deliveryDate, dueStatus } = req.query

    const filter = {}

    if (req.user.role === 'admin') {
      filter.unitNo = req.user.unitNo
    } else if (unitNo && unitNo.trim()) {
      filter.unitNo = unitNo.trim()
    }

    if (status) filter.status = status

    if (deliveryDate) {
      const start = new Date(deliveryDate)
      start.setHours(0, 0, 0, 0)
      const end = new Date(deliveryDate)
      end.setHours(23, 59, 59, 999)
      filter.deliveryDate = { $gte: start, $lte: end }
    }

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

        // ✅ Due Status filter — Pending (balance > 0) | Completed (balance === 0)
    if (dueStatus === 'pending') {
      filter.balance = { $gt: 0 }
    } else if (dueStatus === 'completed') {
      filter.balance = 0
    }

    const bills = await StitchingBill.find(filter).sort({ createdAt: -1 })

    // ✅ Attach lastPayment from paymentHistory
    const enriched = bills.map((b) => {
      const obj = b.toObject()
      const history = obj.paymentHistory || []
      const sorted = history.slice().sort((a, c) =>
        c.paymentDate.localeCompare(a.paymentDate)
      )
      obj.lastPayment = sorted[0] || null
      return obj
    })

    res.json(enriched)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// GET /stitching/reports
// ============================================================
router.get('/reports', protect, async (req, res) => {
  try {
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
      totalBills: 0, totalAmount: 0, totalAdvance: 0, totalBalance: 0,
    }

    const statusAgg = await StitchingBill.aggregate([
      { $match: matchStage },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ])
    const statusBreakdown = statusAgg.map((s) => ({ status: s._id, count: s.count }))

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
      unitNo: u._id, count: u.count, totalAmount: u.totalAmount,
    }))

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

    const trendAgg = await StitchingBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
          count: { $sum: 1 },
          amount: { $sum: '$amount' },
        },
      },
      { $sort: { _id: 1 } },
    ])
    const dailyTrend = trendAgg.map((d) => ({ date: d._id, count: d.count, amount: d.amount }))

    res.json({ summary, statusBreakdown, unitBreakdown, topCustomers, dailyTrend })
  } catch (err) {
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

    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied' })
    }

    res.json(bill)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// POST /stitching (create)
// ============================================================
router.post('/', protect, uploadPhotos, async (req, res) => {
  try {
    const data = { ...req.body }

    if (req.user.role === 'admin') {
      data.unitNo = req.user.unitNo
    }

    if (typeof data.measurements === 'string') {
      try { data.measurements = JSON.parse(data.measurements) }
      catch { data.measurements = {} }
    }

    if (typeof data.paymentReference === 'string') {
      try { data.paymentReference = JSON.parse(data.paymentReference) }
      catch { data.paymentReference = { cashDenominations: [], gpayReference: '' } }
    }

    let customerNo = data.customerNo?.trim()
    if (!customerNo) customerNo = await generateCustomerNo(data.unitNo)
    data.customerNo = customerNo

    data.billNo = await generateBillNo(data.unitNo)

    data.amount = Number(data.amount || 0)
    data.shippingAmount = Number(data.shippingAmount || 0)

    let discountPercent = 0
    if (data.amount >= 10000) discountPercent = 0
    else if (data.amount >= 5000) discountPercent = 5
    else if (data.amount >= 2500) discountPercent = 2.5

    data.discountPercent = discountPercent
    data.discountAmount = (data.amount * discountPercent) / 100

    if (req.orderPhotoUrl) {
      data.orderPhoto = req.orderPhotoUrl
      data.orderPhotoId = req.orderPhotoId
    }
    if (req.referencePhotoUrl) {
      data.referencePhoto = req.referencePhotoUrl
      data.referencePhotoId = req.referencePhotoId
    }

    data.advance = Number(data.advance || 0)
    data.total   = data.amount + data.shippingAmount - data.discountAmount
    data.balance = data.total - data.advance

    if (data.unitNo === '002' && data.advance <= 0) {
      return res.status(400).json({ message: 'Advance is mandatory for Unit 002' })
    }

    // ✅ Build paymentHistory for initial advance
    if (data.advance > 0) {
      const paymentDate = getTodayStr()
      data.paymentHistory = [
        {
          amountPaid: data.advance,
          paymentDate,
          paymentMode: data.paymentMode || 'cash',
          paymentReference: data.paymentReference || {
            cashDenominations: [],
            gpayReference: '',
          },
          billBy: data.billBy || '',
          recordedAt: new Date(),
        },
      ]
    }

    const bill = await StitchingBill.create(data)
    res.status(201).json(bill)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PUT /stitching/:id (update) — with incremental payment logic
// ============================================================
router.put('/:id', protect, uploadPhotos, async (req, res) => {
  try {
    const data = { ...req.body }

    if (req.user.role === 'admin') {
      const existingCheck = await StitchingBill.findById(req.params.id)
      if (!existingCheck) return res.status(404).json({ message: 'Bill not found' })
      if (existingCheck.unitNo !== req.user.unitNo) {
        return res.status(403).json({ message: 'Access denied — other unit bill' })
      }
      data.unitNo = req.user.unitNo
    }

    delete data._id
    delete data.createdAt
    delete data.updatedAt
    delete data.__v
    delete data.billNo
    delete data.customerNo
    delete data.loyaltyPoints
    delete data.paymentHistory     // ← handle separately
    delete data.advance            // ← handle separately
    delete data.balance            // ← handle separately

    if (typeof data.measurements === 'string') {
      try { data.measurements = JSON.parse(data.measurements) }
      catch { delete data.measurements }
    }

    if (typeof data.paymentReference === 'string') {
      try { data.paymentReference = JSON.parse(data.paymentReference) }
      catch { delete data.paymentReference }
    }

    const existing = await StitchingBill.findById(req.params.id)
    if (!existing) return res.status(404).json({ message: 'Bill not found' })

    const amtVal = data.amount !== undefined && data.amount !== ''
      ? Number(data.amount) : existing.amount
    const shipVal = data.shippingAmount !== undefined
      ? (data.shippingAmount === '' ? 0 : Number(data.shippingAmount))
      : existing.shippingAmount

    let discountPercent = 0
    if (amtVal >= 10000) discountPercent = 0
    else if (amtVal >= 5000) discountPercent = 5
    else if (amtVal >= 2500) discountPercent = 2.5

    data.discountPercent = discountPercent
    data.discountAmount = (amtVal * discountPercent) / 100
    data.total = amtVal + shipVal - data.discountAmount

    // ✅ Payment logic — date-aware (same-day overwrite | next-day append)
    const paymentNow = data.payment !== undefined && data.payment !== ''
      ? Number(data.payment) : 0
    delete data.payment

    if (paymentNow > 0) {
      const paymentDate = getTodayStr()
      const history = (existing.paymentHistory || []).slice()

      // Check if there is already a today's entry (same-day edit)
      const idx = history.findIndex((p) => p.paymentDate === paymentDate)
      const existingEntry = idx !== -1 ? history[idx] : null

      if (existingEntry) {
        // ========================================================
        // SAME DAY EDIT
        // ========================================================
        // paymentNow = total paid so far today (includes existing entry)
        if (paymentNow > data.total) {
          return res.status(400).json({
            message: `Payment ₹${paymentNow} exceeds bill total ₹${data.total}`,
          })
        }

        const newEntry = {
          amountPaid: paymentNow,
          paymentDate,
          paymentMode: data.paymentMode || existing.paymentMode || 'cash',
          paymentReference: data.paymentReference || existing.paymentReference || {
            cashDenominations: [],
            gpayReference: '',
          },
          billBy: data.billBy || existing.billBy || '',
          recordedAt: new Date(),
          editCount: (existingEntry.editCount || 1) + 1,
        }

        history[idx] = newEntry
        data.paymentHistory = history
        data.advance = paymentNow
        data.balance = Math.max(0, data.total - data.advance)
      } else {
        // ========================================================
        // NEXT DAY (or later) EDIT — incremental
        // ========================================================
        // paymentNow = NEW payment for this day (fresh entry)

        const currentBalance = existing.balance || 0

        // Overpayment check
        if (paymentNow > currentBalance) {
          return res.status(400).json({
            message: `Payment ₹${paymentNow} exceeds remaining balance ₹${currentBalance}`,
          })
        }

        const newEntry = {
          amountPaid: paymentNow,
          paymentDate,
          paymentMode: data.paymentMode || existing.paymentMode || 'cash',
          paymentReference: data.paymentReference || existing.paymentReference || {
            cashDenominations: [],
            gpayReference: '',
          },
          billBy: data.billBy || existing.billBy || '',
          recordedAt: new Date(),
          editCount: 1,     // fresh day entry
        }

        history.push(newEntry)

        data.paymentHistory = history
        data.advance = (existing.advance || 0) + paymentNow
        data.balance = Math.max(0, currentBalance - paymentNow)
      }
    } else {
      // No new payment — recalc balance from existing advance
      data.advance = existing.advance || 0
      data.balance = Math.max(0, data.total - data.advance)
    }

    // Advance validation for Unit 002
    const checkUnit = data.unitNo || existing.unitNo
    if (checkUnit === '002' && (data.advance || 0) <= 0) {
      return res.status(400).json({ message: 'Advance is mandatory for Unit 002' })
    }

    // Photos
    if (req.orderPhotoUrl) {
      if (existing.orderPhotoId) await deleteFromCloudinary(existing.orderPhotoId)
      data.orderPhoto = req.orderPhotoUrl
      data.orderPhotoId = req.orderPhotoId
    }
    if (req.referencePhotoUrl) {
      if (existing.referencePhotoId) await deleteFromCloudinary(existing.referencePhotoId)
      data.referencePhoto = req.referencePhotoUrl
      data.referencePhotoId = req.referencePhotoId
    }

    const bill = await StitchingBill.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    res.json(bill)
  } catch (err) {
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

    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied' })
    }

    bill.status = req.body.status
    await bill.save()
    res.json(bill)
  } catch (err) {
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

    if (req.user.role === 'admin' && bill.unitNo !== req.user.unitNo) {
      return res.status(403).json({ message: 'Access denied' })
    }

    if (bill.orderPhotoId)     await deleteFromCloudinary(bill.orderPhotoId)
    if (bill.referencePhotoId) await deleteFromCloudinary(bill.referencePhotoId)

    await StitchingBill.findByIdAndDelete(req.params.id)
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router