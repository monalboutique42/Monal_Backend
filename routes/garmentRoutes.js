import express from 'express'
import { GarmentBill, GarmentStock, GarmentCounter } from '../models/GarmentBill.js'
import { protect } from '../middleware/auth.js'

const router = express.Router()

// ============================================================
// HELPERS
// ============================================================
const padCode = (val) => {
  const n = parseInt(val, 10)
  if (isNaN(n)) return String(val)
  return n <= 99 ? String(n).padStart(2, '0') : String(n).padStart(3, '0')
}

const buildItemCode = (productCode, itemNo) => {
  return `${padCode(productCode)}${padCode(itemNo)}`
}

async function peekNextSeq(counterId, pad = 2) {
  const counter = await GarmentCounter.findById(counterId)
  const next = (counter?.seq || 0) + 1
  return String(next).padStart(pad, '0')
}

async function bumpSeq(counterId, pad = 2) {
  const counter = await GarmentCounter.findByIdAndUpdate(
    counterId,
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true }
  )
  return String(counter.seq).padStart(pad, '0')
}

// ============================================================
// Generate Garment Bill No
// ============================================================
async function generateGarmentBillNo(firstItemCode) {
  const now = new Date()
  const year  = now.getFullYear().toString()
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const prefix = `${year}${month}${firstItemCode}`

  const lastBill = await GarmentBill
    .findOne({ billNo: { $regex: `^${prefix}` } })
    .sort({ billNo: -1 })

  let nextSeq = 1
  if (lastBill) {
    const lastSeq = parseInt(lastBill.billNo.slice(prefix.length), 10)
    if (!isNaN(lastSeq)) nextSeq = lastSeq + 1
  }
  return `${prefix}${String(nextSeq).padStart(3, '0')}`
}

// ============================================================
// CUSTOMER NO — PREVIEW
// ============================================================
router.get('/next-customer-no', protect, async (req, res) => {
  try {
    // ✅ Find highest numeric customerNo from bills
    const bills = await GarmentBill.find().select('customerNo').lean()

    let maxNum = 0
    bills.forEach((b) => {
      const cno = b.customerNo || ''
      const match = cno.match(/^G(\d+)$/i)
      if (match) {
        const n = parseInt(match[1], 10)
        if (!isNaN(n) && n > maxNum) maxNum = n
      }
    })

    // Next = maxNum + 1, or 1 if no customers
    const nextNum = maxNum + 1
    const customerNo = `G${String(nextNum).padStart(2, '0')}`

    res.json({ customerNo, nextNum })
  } catch (err) {
    console.error('❌ next-customer-no error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PRODUCT CODE — PREVIEW
// ============================================================
router.get('/next-product-code', protect, async (req, res) => {
  try {
    const stocks = await GarmentStock.find().select('productCode').lean()
    const codes = stocks.map((s) => parseInt(s.productCode, 10)).filter((n) => !isNaN(n))
    const maxFromStock = codes.length ? Math.max(...codes) : 0
    const counter = await GarmentCounter.findById('product_code')
    const maxFromCounter = counter?.seq || 0
    const nextNum = Math.max(maxFromStock, maxFromCounter) + 1
    res.json({ productCode: padCode(nextNum), nextNum })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// ITEM NO — PREVIEW (per product)
// ============================================================
router.get('/next-item-no', protect, async (req, res) => {
  try {
    const { productCode } = req.query
    if (!productCode) return res.status(400).json({ message: 'productCode required' })

    const stock = await GarmentStock.findOne({ productCode }).lean()
    const existing = stock?.variants?.length || 0
    const counter = await GarmentCounter.findById(`item_no_${productCode}`)
    const maxFromCounter = counter?.seq || 0
    const nextNum = Math.max(existing, maxFromCounter) + 1

    res.json({ itemNo: padCode(nextNum), nextNum })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// NEXT BILL NO
// ============================================================
router.get('/next-bill-no', protect, async (req, res) => {
  try {
    const { productCode, itemNo } = req.query
    if (!productCode || !itemNo) {
      return res.status(400).json({ message: 'productCode and itemNo required' })
    }
    const itemCode = buildItemCode(productCode, itemNo)
    const billNo = await generateGarmentBillNo(itemCode)
    res.json({ billNo })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// CUSTOMER LOOKUP
// ============================================================
router.get('/customer/:customerNo', protect, async (req, res) => {
  try {
    const { customerNo } = req.params
    const lastBill = await GarmentBill.findOne({ customerNo }).sort({ createdAt: -1 })
    if (!lastBill) return res.json({ found: false })

    const agg = await GarmentBill.aggregate([
      { $match: { customerNo } },
      { $group: { _id: null, total: { $sum: '$loyaltyPoints' } } },
    ])
    const loyaltyPoints = agg[0]?.total || 0

    res.json({
      found: true,
      customerNo,
      loyaltyPoints,
      customer: {
        customerName:   lastBill.customerName,
        customerMobile: lastBill.customerMobile,
      },
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — LIST
// ============================================================
router.get('/bills', protect, async (req, res) => {
  try {
    const { productCode, paymentMode, from, to, search } = req.query
    const filter = {}

    if (paymentMode) filter.paymentMode = paymentMode
    if (productCode) filter['items.productCode'] = productCode

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
        { customerNo:     { $regex: search, $options: 'i' } },
        { 'items.itemCode': { $regex: search, $options: 'i' } },
      ]
    }

    const bills = await GarmentBill.find(filter).sort({ createdAt: -1 })
    res.json(bills)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — GET ONE
// ============================================================
router.get('/bills/:id', protect, async (req, res) => {
  try {
    const bill = await GarmentBill.findById(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })
    res.json(bill)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — CREATE
// ============================================================
router.post('/bills', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    // Validation
    if (!data.customerNo?.trim())   return res.status(400).json({ message: 'Customer No required' })
    if (!data.customerName?.trim()) return res.status(400).json({ message: 'Customer name required' })
    if (!/^[0-9]{10}$/.test(data.customerMobile)) {
      return res.status(400).json({ message: 'Valid 10-digit mobile required' })
    }
    if (!data.billBy?.trim()) return res.status(400).json({ message: 'Bill By required' })
    if (!Array.isArray(data.items) || data.items.length === 0) {
      return res.status(400).json({ message: 'At least one item required' })
    }

    // Validate items
    for (const item of data.items) {
      if (!item.productCode || !item.itemNo) {
        return res.status(400).json({ message: 'Each item needs productCode and itemNo' })
      }
      if (!item.rate || item.rate <= 0) {
        return res.status(400).json({ message: 'Each item needs valid rate' })
      }
      item.rate     = Number(item.rate)
      item.amount   = item.rate * 1
      item.itemCode = buildItemCode(item.productCode, item.itemNo)
    }

    // Payment validation
    if (data.paymentMode === 'cash') {
      const hasDenom = data.paymentReference?.cashDenominations?.some((d) => Number(d.count) > 0)
      if (!hasDenom) return res.status(400).json({ message: 'Enter at least one cash denomination' })
    }
    if (data.paymentMode === 'gpay') {
      if (!data.paymentReference?.gpayReference?.trim()) {
        return res.status(400).json({ message: 'GPay reference required' })
      }
    }

    // Stock status check
    // Stock status + purchase price check
    const stockIssues = []
    for (const item of data.items) {
      const stock = await GarmentStock.findOne({ productCode: item.productCode })
      if (!stock) {
        stockIssues.push(`Stock not found for product ${item.productCode}`)
        continue
      }
      const variant = stock.variants.find((v) => v.itemNo === item.itemNo)
      if (!variant) {
        stockIssues.push(`Variant not found: ${item.productCode}/${item.itemNo}`)
        continue
      }
      if (variant.status !== 'instock') {
        stockIssues.push(`Not in stock: ${item.productCode}/${item.itemNo} (${variant.status})`)
      }
      // ✅ NEW: Billing rate must be >= purchase price
      if (item.rate < variant.purchasePrice) {
        stockIssues.push(
          `Billing price ₹${item.rate} is below purchase price ₹${variant.purchasePrice} for ${item.productCode}/${item.itemNo}`
        )
      }
    }

    if (stockIssues.length > 0) {
      return res.status(400).json({ message: 'Stock issues:\n' + stockIssues.join('\n') })
    }

    // Totals
    data.totalAmount = data.items.reduce((sum, i) => sum + i.amount, 0)
    data.totalItems  = data.items.length

    // Bill No
    const firstItemCode = data.items[0].itemCode
    data.billNo = await generateGarmentBillNo(firstItemCode)

    // Loyalty
    data.loyaltyPoints = 5

    // Save
    const bill = await GarmentBill.create(data)

    // Mark variants SOLD
    for (const item of data.items) {
      await GarmentStock.updateOne(
        { productCode: item.productCode, 'variants.itemNo': item.itemNo },
        { $set: { 'variants.$.status': 'sold' } }
      )
    }

    // Bump customer counter
 

    res.status(201).json(bill)
  } catch (err) {
    console.error('❌ POST /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PATCH VARIANT STATUS
// ============================================================
router.patch('/stock/:stockId/variant/:itemNo/status', protect, async (req, res) => {
  try {
    const { stockId, itemNo } = req.params
    const { status } = req.body

    if (!['instock', 'sold', 'return', 'exchange'].includes(status)) {
      return res.status(400).json({ message: 'Invalid status' })
    }

    const stock = await GarmentStock.findById(stockId)
    if (!stock) return res.status(404).json({ message: 'Stock not found' })

    const variant = stock.variants.find((v) => v.itemNo === itemNo)
    if (!variant) return res.status(404).json({ message: 'Variant not found' })

    variant.status = status
    await stock.save()

    res.json(stock)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — DELETE (restore stock)
// ============================================================
router.delete('/bills/:id', protect, async (req, res) => {
  try {
    const bill = await GarmentBill.findByIdAndDelete(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })

    for (const item of bill.items) {
      await GarmentStock.updateOne(
        { productCode: item.productCode, 'variants.itemNo': item.itemNo },
        { $set: { 'variants.$.status': 'instock' } }
      ).catch(() => {})
    }

    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// STOCK — LIST
// ============================================================
router.get('/stock', protect, async (req, res) => {
  try {
    const { search, itemCode, status } = req.query
    const filter = {}

    if (search) {
      filter.$or = [
        { productCode: { $regex: search, $options: 'i' } },
        { description: { $regex: search, $options: 'i' } },
      ]
    }

    let stocks = await GarmentStock.find(filter).sort({ createdAt: -1 })

    if (itemCode) {
      stocks = stocks.filter((s) =>
        s.variants.some((v) => `${s.productCode}${v.itemNo}`.includes(itemCode))
      )
    }
    if (status) {
      stocks = stocks.filter((s) => s.variants.some((v) => v.status === status))
    }

    const isAdmin = req.user?.role === 'admin'
    const sanitized = isAdmin
      ? stocks.map((s) => {
          const obj = s.toObject()
          delete obj.sellerName
          delete obj.sellerMobile
          delete obj.sellerAddress
          delete obj.sellerAddedBy
          return obj
        })
      : stocks

    res.json(sanitized)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// STOCK — CREATE
// ✅ NEW: If productCode exists → APPEND variants
// ✅ NEW: productCode editable (user types)
// ============================================================
router.post('/stock', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    // Validate variants
    if (!Array.isArray(data.variants) || data.variants.length === 0) {
      return res.status(400).json({ message: 'At least one variant required' })
    }

    // ---------- If productCode provided → check existing ----------
    if (data.productCode?.trim()) {
      const existing = await GarmentStock.findOne({ productCode: data.productCode.trim() })

      if (existing) {
        // ✅ APPEND mode: add new variants to existing product
        const existingItemNos = existing.variants.map((v) => v.itemNo)
        let maxNum = 0
        existingItemNos.forEach((n) => {
          const num = parseInt(n, 10)
          if (!isNaN(num) && num > maxNum) maxNum = num
        })

        const counter = await GarmentCounter.findById(`item_no_${existing.productCode}`)
        if (counter?.seq && counter.seq > maxNum) maxNum = counter.seq

        let nextNum = maxNum + 1

        for (const v of data.variants) {
          if (!v.colour?.trim()) return res.status(400).json({ message: 'Variant colour required' })
          if (!v.size?.trim())   return res.status(400).json({ message: 'Variant size required' })
          if (!v.purchasePrice || v.purchasePrice <= 0) {
            return res.status(400).json({ message: 'Variant purchase price required' })
          }
          if (!v.sellingPrice || v.sellingPrice <= 0) {
            return res.status(400).json({ message: 'Variant selling price required' })
          }
          if (Number(v.sellingPrice) < Number(v.purchasePrice)) {
            return res.status(400).json({ message: 'Selling price cannot be less than purchase price' })
          }

          // Always auto-assign new itemNo (ignore user's itemNo)
          v.itemNo = padCode(nextNum)
          nextNum += 1

          v.purchasePrice = Number(v.purchasePrice)
          v.sellingPrice  = Number(v.sellingPrice)
          v.status = v.status || 'instock'
        }

        existing.variants.push(...data.variants)

        // Update description if provided
        if (data.description?.trim()) existing.description = data.description.trim()

        await existing.save()

        // Bump item_no counter
        await GarmentCounter.findByIdAndUpdate(
          `item_no_${existing.productCode}`,
          { $max: { seq: nextNum - 1 } },
          { upsert: true, setDefaultsOnInsert: true }
        )

        return res.status(200).json(existing)
      }
    }

    // ---------- New product ----------
    if (!data.productCode?.trim()) {
      // Auto-generate
      const stocks = await GarmentStock.find().select('productCode').lean()
      const codes = stocks.map((s) => parseInt(s.productCode, 10)).filter((n) => !isNaN(n))
      const maxFromStock = codes.length ? Math.max(...codes) : 0

      const counter = await GarmentCounter.findById('product_code')
      const maxFromCounter = counter?.seq || 0

      const nextNum = Math.max(maxFromStock, maxFromCounter) + 1
      data.productCode = padCode(nextNum)

      await GarmentCounter.findByIdAndUpdate(
        'product_code',
        { $max: { seq: nextNum } },
        { upsert: true, setDefaultsOnInsert: true }
      )
    } else {
      data.productCode = data.productCode.trim()
      const numPC = parseInt(data.productCode, 10)
      if (!isNaN(numPC)) {
        await GarmentCounter.findByIdAndUpdate(
          'product_code',
          { $max: { seq: numPC } },
          { upsert: true, setDefaultsOnInsert: true }
        )
      }
    }

    // Validate + auto itemNo
    let nextItemNum = 1
    for (const v of data.variants) {
      if (!v.colour?.trim()) return res.status(400).json({ message: 'Variant colour required' })
      if (!v.size?.trim())   return res.status(400).json({ message: 'Variant size required' })
      if (!v.purchasePrice || v.purchasePrice <= 0) {
        return res.status(400).json({ message: 'Variant purchase price required' })
      }
      if (!v.sellingPrice || v.sellingPrice <= 0) {
        return res.status(400).json({ message: 'Variant selling price required' })
      }
      if (Number(v.sellingPrice) < Number(v.purchasePrice)) {
        return res.status(400).json({ message: 'Selling price cannot be less than purchase price' })
      }
      v.itemNo = padCode(nextItemNum)
      nextItemNum += 1
      v.purchasePrice = Number(v.purchasePrice)
      v.sellingPrice  = Number(v.sellingPrice)
      v.status = v.status || 'instock'
    }

    await GarmentCounter.findByIdAndUpdate(
      `item_no_${data.productCode}`,
      { $max: { seq: nextItemNum - 1 } },
      { upsert: true, setDefaultsOnInsert: true }
    )

    // Seller protection (silently strip if admin)
    const canSeeSeller = ['md', 'md_finance', 'ceo'].includes(req.user?.role)
    if (!canSeeSeller) {
      delete data.sellerName
      delete data.sellerMobile
      delete data.sellerAddress
    } else if (req.user?._id) {
      data.sellerAddedBy = req.user._id
    }

    const stock = await GarmentStock.create(data)
    res.status(201).json(stock)
  } catch (err) {
    console.error('❌ POST /garment/stock error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// STOCK — UPDATE
// productCode immutable
// ============================================================
router.put('/stock/:id', protect, async (req, res) => {
  try {
    const data = { ...req.body }
    const stockId = req.params.id

    delete data._id
    delete data.createdAt
    delete data.updatedAt
    delete data.__v
    delete data.productCode

    const existingStock = await GarmentStock.findById(stockId)
    if (!existingStock) return res.status(404).json({ message: 'Stock not found' })

    const canSeeSeller = ['md', 'md_finance', 'ceo'].includes(req.user?.role)
    if (!canSeeSeller) {
      delete data.sellerName
      delete data.sellerMobile
      delete data.sellerAddress
    }

    if (Array.isArray(data.variants)) {
      const existingItemNos = existingStock.variants.map((v) => v.itemNo)

      let maxNum = 0
      existingItemNos.forEach((n) => {
        const num = parseInt(n, 10)
        if (!isNaN(num) && num > maxNum) maxNum = num
      })

      const counter = await GarmentCounter.findById(`item_no_${existingStock.productCode}`)
      if (counter?.seq && counter.seq > maxNum) maxNum = counter.seq

      let nextNum = maxNum + 1

      for (const v of data.variants) {
        // If variant has existing itemNo → keep it
        // If no itemNo → assign new
        if (!v.itemNo?.trim()) {
          v.itemNo = padCode(nextNum)
          nextNum += 1
        } else {
          const n = parseInt(v.itemNo, 10)
          if (!isNaN(n) && n >= nextNum) nextNum = n + 1
        }
        v.purchasePrice = Number(v.purchasePrice || 0)
        v.sellingPrice  = Number(v.sellingPrice || 0)
        v.status = v.status || 'instock'
      }

      if (nextNum > 1) {
        await GarmentCounter.findByIdAndUpdate(
          `item_no_${existingStock.productCode}`,
          { $max: { seq: nextNum - 1 } },
          { upsert: true, setDefaultsOnInsert: true }
        )
      }
    }

    const stock = await GarmentStock.findByIdAndUpdate(
      stockId,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    res.json(stock)
  } catch (err) {
    console.error('❌ PUT /garment/stock error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// STOCK — DELETE
// ============================================================
router.delete('/stock/:id', protect, async (req, res) => {
  try {
    const stock = await GarmentStock.findByIdAndDelete(req.params.id)
    if (!stock) return res.status(404).json({ message: 'Stock not found' })
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

export default router