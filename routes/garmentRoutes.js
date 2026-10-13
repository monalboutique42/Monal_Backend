import express from 'express'
import { GarmentBill, GarmentStock } from '../models/GarmentBill.js'
import { protect } from '../middleware/auth.js'

const router = express.Router()

// ============================================================
// HELPER: Generate Garment Bill No
// Format: YYYYMM + PRODUCT_CODE + ITEM_NO + BILL_SEQ
// Example: 2026100105001
// ============================================================
async function generateGarmentBillNo(productCode, itemNo) {
  const now = new Date()
  const year  = now.getFullYear().toString()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')

  const prodCode = String(productCode).padStart(2, '0')   // "01", "100"
  const item     = String(itemNo).padStart(2, '0')        // "05", "100"

  const prefix = `${year}${month}${prodCode}${item}`

  const lastBill = await GarmentBill
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
// BILLING ROUTES
// ============================================================

// GET /garment/next-bill-no?productCode=01&itemNo=05
router.get('/next-bill-no', protect, async (req, res) => {
  try {
    const { productCode, itemNo } = req.query
    if (!productCode || !itemNo) {
      return res.status(400).json({ message: 'productCode and itemNo required' })
    }
    const billNo = await generateGarmentBillNo(productCode, itemNo)
    res.json({ billNo })
  } catch (err) {
    console.error('❌ GET next-bill-no error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// GET /garment/bills (list + filter)
router.get('/bills', protect, async (req, res) => {
  try {
    const { productCode, paymentMode, from, to, search } = req.query
    const filter = {}

    if (productCode) filter.productCode = productCode
    if (paymentMode) filter.paymentMode = paymentMode

    if (from || to) {
      filter.createdAt = {}
      if (from) {
        const start = new Date(from)
        start.setHours(0, 0, 0, 0)
        filter.createdAt.$gte = start
      }
      if (to) {
        const end = new Date(to)
        end.setHours(23, 59, 59, 999)
        filter.createdAt.$lte = end
      }
    }

    if (search) {
      filter.$or = [
        { customerName:   { $regex: search, $options: 'i' } },
        { customerMobile: { $regex: search, $options: 'i' } },
        { billNo:         { $regex: search, $options: 'i' } },
        { productCode:    { $regex: search, $options: 'i' } },
      ]
    }

    const bills = await GarmentBill.find(filter).sort({ createdAt: -1 })
    res.json(bills)
  } catch (err) {
    console.error('❌ GET /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// GET /garment/bills/:id
router.get('/bills/:id', protect, async (req, res) => {
  try {
    const bill = await GarmentBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json(bill)
  } catch (err) {
    console.error('❌ GET /garment/bills/:id error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// POST /garment/bills (create)
router.post('/bills', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    // Validate
    if (!data.productCode || !data.itemNo) {
      return res.status(400).json({ message: 'Product Code and Item No required' })
    }
    if (!data.customerName?.trim()) {
      return res.status(400).json({ message: 'Customer name required' })
    }
    if (!/^[0-9]{10}$/.test(data.customerMobile)) {
      return res.status(400).json({ message: 'Valid 10-digit mobile required' })
    }
    if (!data.productRate || data.productRate <= 0) {
      return res.status(400).json({ message: 'Product rate required' })
    }
    if (!data.noOfItems || data.noOfItems <= 0) {
      return res.status(400).json({ message: 'No. of items required' })
    }

    // Calculate amount
    data.productRate = Number(data.productRate)
    data.noOfItems   = Number(data.noOfItems)
    data.amount      = data.productRate * data.noOfItems

    // Generate bill no
    data.billNo = await generateGarmentBillNo(data.productCode, data.itemNo)

    // Save bill
    const bill = await GarmentBill.create(data)

    // ✅ Reduce stock quantity (if stock exists)
    if (data.productCode && data.size && data.colour) {
      await GarmentStock.findOneAndUpdate(
        {
          productCode: data.productCode,
          'variants.size': data.size,
          'variants.colour': data.colour,
        },
        {
          $inc: { 'variants.$.quantity': -data.noOfItems },
        }
      ).catch((err) => console.warn('Stock update skip:', err.message))
    }

    res.status(201).json(bill)
  } catch (err) {
    console.error('❌ POST /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// PUT /garment/bills/:id (update)
router.put('/bills/:id', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    delete data._id
    delete data.createdAt
    delete data.updatedAt
    delete data.__v
    delete data.billNo   // Don't allow bill no change

    // Recalculate amount
    if (data.productRate && data.noOfItems) {
      data.productRate = Number(data.productRate)
      data.noOfItems   = Number(data.noOfItems)
      data.amount      = data.productRate * data.noOfItems
    }

    const bill = await GarmentBill.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json(bill)
  } catch (err) {
    console.error('❌ PUT /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// DELETE /garment/bills/:id
router.delete('/bills/:id', protect, async (req, res) => {
  try {
    const bill = await GarmentBill.findByIdAndDelete(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json({ message: 'Deleted' })
  } catch (err) {
    console.error('❌ DELETE /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// STOCK ROUTES
// ============================================================

// GET /garment/stock (list + filter)
router.get('/stock', protect, async (req, res) => {
  try {
    const { search, lowStock } = req.query
    const filter = {}

    if (search) {
      filter.$or = [
        { productCode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ]
    }

    const stocks = await GarmentStock.find(filter).sort({ createdAt: -1 })
    res.json(stocks)
  } catch (err) {
    console.error('❌ GET /garment/stock error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// GET /garment/stock/:productCode
router.get('/stock/:productCode', protect, async (req, res) => {
  try {
    const stock = await GarmentStock.findOne({
      productCode: req.params.productCode,
    })
    if (!stock) return res.status(404).json({ message: 'Stock not found' })
    res.json(stock)
  } catch (err) {
    console.error('❌ GET /garment/stock/:productCode error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// POST /garment/stock (create)
router.post('/stock', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    if (!data.productCode?.trim()) {
      return res.status(400).json({ message: 'Product Code required' })
    }

    // Check unique
    const exists = await GarmentStock.findOne({ productCode: data.productCode })
    if (exists) {
      return res.status(400).json({ message: 'Product Code already exists' })
    }

    // Admin can't set seller details — will be added by CEO/MD later
    const stock = await GarmentStock.create(data)
    res.status(201).json(stock)
  } catch (err) {
    console.error('❌ POST /garment/stock error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// PUT /garment/stock/:id (update)
router.put('/stock/:id', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    delete data._id
    delete data.createdAt
    delete data.updatedAt
    delete data.__v

    const stock = await GarmentStock.findByIdAndUpdate(
      req.params.id,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    if (!stock) return res.status(404).json({ message: 'Stock not found' })
    res.json(stock)
  } catch (err) {
    console.error('❌ PUT /garment/stock error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// DELETE /garment/stock/:id
router.delete('/stock/:id', protect, async (req, res) => {
  try {
    const stock = await GarmentStock.findByIdAndDelete(req.params.id)
    if (!stock) return res.status(404).json({ message: 'Stock not found' })
    res.json({ message: 'Deleted' })
  } catch (err) {
    console.error('❌ DELETE /garment/stock error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router