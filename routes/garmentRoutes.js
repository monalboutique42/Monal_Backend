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
  return `${productCode}${padCode(itemNo)}`
}

// ✅ FIX — quantity-safe availability check
const getAvailableQty = (variant) => {
  const total = Number(variant?.quantity ?? 0)
  const reserved = Number(variant?.reservedQty ?? 0)
  return Math.max(0, total - reserved)
}

// ✅ FIX — auto-update variant status based on quantity
const syncVariantStatus = (variant) => {
  const qty = Number(variant.quantity ?? 0)
  if (qty <= 0) {
    variant.status = 'sold'
  } else if (variant.status === 'sold') {
    // restore to instock if quantity added back
    variant.status = 'instock'
  }
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

  const seqStr = nextSeq <= 99 ? String(nextSeq).padStart(2, '0') : String(nextSeq)
  return `${prefix}${seqStr}`
}

// ============================================================
// CUSTOMER NO — PREVIEW
// ============================================================
router.get('/next-customer-no', protect, async (req, res) => {
  try {
    const bills = await GarmentBill.find().select('customerNo').lean()

    let maxG = 0
    let maxGR = 0

    bills.forEach((b) => {
      const cno = (b.customerNo || '').trim().toUpperCase()

      let m = cno.match(/^GR(\d+)$/)
      if (m) {
        const n = parseInt(m[1], 10)
        if (!isNaN(n) && n > maxGR) maxGR = n
        return
      }

      m = cno.match(/^G(\d+)$/)
      if (m) {
        const n = parseInt(m[1], 10)
        if (!isNaN(n) && n > maxG) maxG = n
      }
    })

    const nextG  = maxG + 1
    const nextGR = maxGR + 1

    res.json({
      customerNo: `G${String(nextG).padStart(2, '0')}`,
      nextNum: nextG,
      suggestions: [
        { series: 'G',  customerNo: `G${String(nextG).padStart(2, '0')}`,  nextNum: nextG  },
        { series: 'GR', customerNo: `GR${String(nextGR).padStart(2, '0')}`, nextNum: nextGR },
      ],
    })
  } catch (err) {
    console.error('❌ next-customer-no error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// ✅ PRODUCT CODE — MANUAL INPUT ONLY (no S/M/T series)
// ============================================================
// GET /garment/product-exists?productCode=XXX
// Returns: { exists, description, variantsCount, productCode }
router.get('/product-exists', protect, async (req, res) => {
  try {
    const pc = (req.query.productCode || '').trim().toUpperCase()
    if (!pc) return res.json({ exists: false })

    const stock = await GarmentStock.findOne({ productCode: pc }).lean()
    if (!stock) return res.json({ exists: false, productCode: pc })

    res.json({
      exists: true,
      productCode: stock.productCode,
      description: stock.description || '',
      variantsCount: stock.variants?.length || 0,
    })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// ✅ NEXT ITEM NO — per product (for preview)
// ============================================================
router.get('/next-item-no', protect, async (req, res) => {
  try {
    const { productCode } = req.query
    if (!productCode) return res.status(400).json({ message: 'productCode required' })

    const cleanCode = String(productCode).trim().toUpperCase()
    const stock = await GarmentStock.findOne({ productCode: cleanCode }).lean()
    const existing = stock?.variants?.length || 0

    let maxNum = 0
    ;(stock?.variants || []).forEach((v) => {
      const n = parseInt(v.itemNo, 10)
      if (!isNaN(n) && n > maxNum) maxNum = n
    })

    const counter = await GarmentCounter.findById(`item_no_${cleanCode}`)
    const maxFromCounter = counter?.seq || 0
    const nextNum = Math.max(existing, maxNum, maxFromCounter) + 1

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
    const { productCode, paymentMode, from, to, search, customerSeries } = req.query
    const filter = {}

    if (paymentMode) filter.paymentMode = paymentMode
    if (productCode) filter['items.productCode'] = productCode

    if (customerSeries === 'GR') {
      filter.customerNo = { $regex: '^GR\\d+$', $options: 'i' }
    } else if (customerSeries === 'G') {
      filter.customerNo = { $regex: '^G\\d+$', $options: 'i' }
    }

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
// ✅ CART RESERVE — cart-la add pannaa quantity reserve
// POST /garment/reserve
// Body: { productCode, itemNo }
// ============================================================
router.post('/reserve', protect, async (req, res) => {
  try {
    const { productCode, itemNo } = req.body
        const qty = Math.max(1, Number(req.body.qty || 1))   // ✅ NEW

    if (!productCode || !itemNo) {
      return res.status(400).json({ message: 'productCode and itemNo required' })
    }

    const stock = await GarmentStock.findOne({ productCode: productCode.trim().toUpperCase() })
    if (!stock) return res.status(404).json({ message: 'Stock not found' })

    const variant = stock.variants.find((v) => v.itemNo === itemNo)
    if (!variant) return res.status(404).json({ message: 'Variant not found' })

    const available = getAvailableQty(variant)
    if (available <= 0) {
      return res.status(400).json({
        message: `Not enough stock. Available: ${available}`,
      })
    }

    variant.reservedQty = Number(variant.reservedQty || 0) + 1
    await stock.save()

    res.json({
      success: true,
      available: getAvailableQty(variant),
      reservedQty: variant.reservedQty,
    })
  } catch (err) {
    console.error('❌ POST /garment/reserve error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// ✅ CART RELEASE — cart-la irundhu remove pannaa release
// POST /garment/release
// Body: { productCode, itemNo }
// ============================================================
router.post('/release', protect, async (req, res) => {
  try {
    const { productCode, itemNo } = req.body
    if (!productCode || !itemNo) {
      return res.status(400).json({ message: 'productCode and itemNo required' })
    }

    const stock = await GarmentStock.findOne({ productCode: productCode.trim().toUpperCase() })
    if (!stock) return res.status(404).json({ message: 'Stock not found' })

    const variant = stock.variants.find((v) => v.itemNo === itemNo)
    if (!variant) return res.status(404).json({ message: 'Variant not found' })

    const qty = Math.max(1, Number(req.body.qty || 1))
    variant.reservedQty = Math.max(0, Number(variant.reservedQty || 0) - 1)
    await stock.save()

    res.json({
      success: true,
      available: getAvailableQty(variant),
      reservedQty: variant.reservedQty,
    })
  } catch (err) {
    console.error('❌ POST /garment/release error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — CREATE (with quantity decrement + reservedQty release)
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

    // Validate items + compute amount
    for (const item of data.items) {
      if (!item.productCode || !item.itemNo) {
        return res.status(400).json({ message: 'Each item needs productCode and itemNo' })
      }
      if (!item.rate || item.rate <= 0) {
        return res.status(400).json({ message: 'Each item needs valid rate' })
      }
      if (!item.qty || item.qty <= 0) {
        return res.status(400).json({ message: 'Each item needs valid quantity' })
      }
      item.productCode = item.productCode.trim().toUpperCase()
      item.rate     = Number(item.rate)
      item.qty      = Number(item.qty)
      item.amount   = item.rate * item.qty   // ✅ rate × qty
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

    // Stock validation + quantity check
    const stockIssues = []
    const stockDocs = {}
    for (const item of data.items) {
      const pc = item.productCode
      if (!stockDocs[pc]) {
        stockDocs[pc] = await GarmentStock.findOne({ productCode: pc })
      }
      const stock = stockDocs[pc]
      if (!stock) {
        stockIssues.push(`Stock not found for product ${pc}`)
        continue
      }
      const variant = stock.variants.find((v) => v.itemNo === item.itemNo)
      if (!variant) {
        stockIssues.push(`Variant not found: ${pc}/${item.itemNo}`)
        continue
      }

      const available = getAvailableQty(variant)
      if (available < Number(item.qty || 1)) {
        stockIssues.push(`Only ${available} available: ${pc}/${item.itemNo}`)
      }

// ✅ Only check if purchasePrice > 0
if (Number(variant.purchasePrice) > 0 && item.rate < variant.purchasePrice) {
  stockIssues.push(
    `Billing price ₹${item.rate} is below purchase price ₹${variant.purchasePrice} for ${pc}/${item.itemNo}`
  )
}
    }

    if (stockIssues.length > 0) {
      return res.status(400).json({ message: 'Stock issues:\n' + stockIssues.join('\n') })
    }

    // Totals
    data.subTotal      = data.items.reduce((sum, i) => sum + i.amount, 0)
    data.shippingAmount = Number(data.shippingAmount || 0)
    data.discountAmount = Number(data.discountAmount || 0)
    data.totalAmount = Math.max(0, data.subTotal + data.shippingAmount - data.discountAmount)
    data.totalItems  = data.items.length

    // Bill No
    const firstItemCode = data.items[0].itemCode
    data.billNo = await generateGarmentBillNo(firstItemCode)

    // Loyalty
    data.loyaltyPoints = 5

    // Save
    const bill = await GarmentBill.create(data)

    // ✅ Decrement quantity + increment soldQty + release reservedQty + auto status
    for (const item of data.items) {
      const stock = stockDocs[item.productCode]
      const variant = stock.variants.find((v) => v.itemNo === item.itemNo)
      const qty = Number(item.qty || 1)

      variant.quantity = Math.max(0, Number(variant.quantity || 0) - qty)
      variant.soldQty = Number(variant.soldQty || 0) + qty   // ✅ NEW
      variant.reservedQty = Math.max(0, Number(variant.reservedQty || 0) - qty)
      syncVariantStatus(variant)

      await stock.save()
    }

    res.status(201).json(bill)
  } catch (err) {
    console.error('❌ POST /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — UPDATE (edit) — quantity adjustments on item changes
// ============================================================
router.put('/bills/:id', protect, async (req, res) => {
  try {
    const billId = req.params.id
    const existing = await GarmentBill.findById(billId)
    if (!existing) return res.status(404).json({ message: 'Bill not found' })

    const data = { ...req.body }

    // Validate
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
      item.productCode = item.productCode.trim().toUpperCase()
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

    // Totals
    data.subTotal      = data.items.reduce((sum, i) => sum + i.amount, 0)
    data.shippingAmount = Number(data.shippingAmount || 0)
    data.discountAmount = Number(data.discountAmount || 0)
    data.totalAmount = Math.max(0, data.subTotal + data.shippingAmount - data.discountAmount)
    data.totalItems  = data.items.length

    // ✅ Restore old items' quantities + revert soldQty
    for (const oldItem of existing.items) {
      const stock = await GarmentStock.findOne({ productCode: oldItem.productCode })
      if (!stock) continue
      const variant = stock.variants.find((v) => v.itemNo === oldItem.itemNo)
      if (!variant) continue
      const oldQty = Number(oldItem.qty || 1)
      variant.quantity = Number(variant.quantity || 0) + oldQty
      variant.soldQty = Math.max(0, Number(variant.soldQty || 0) - oldQty)   // ✅
      syncVariantStatus(variant)
      await stock.save()
    }

    // ✅ Apply new items — decrement + validate
    const stockIssues = []
    const stockDocs = {}
    for (const item of data.items) {
      const pc = item.productCode
      if (!stockDocs[pc]) {
        stockDocs[pc] = await GarmentStock.findOne({ productCode: pc })
      }
      const stock = stockDocs[pc]
      if (!stock) {
        stockIssues.push(`Stock not found for product ${pc}`)
        continue
      }
      const variant = stock.variants.find((v) => v.itemNo === item.itemNo)
      if (!variant) {
        stockIssues.push(`Variant not found: ${pc}/${item.itemNo}`)
        continue
      }
      const qty = Number(variant.quantity ?? 0)
      if (qty <= 0) {
        stockIssues.push(`Out of stock: ${pc}/${item.itemNo}`)
      }
if (Number(variant.purchasePrice) > 0 && item.rate < variant.purchasePrice) {
  stockIssues.push(
    `Billing price ₹${item.rate} is below purchase price ₹${variant.purchasePrice} for ${pc}/${item.itemNo}`
  )
}
    }

    if (stockIssues.length > 0) {
      // Rollback: restore old quantities again (since we restored them above)
      for (const oldItem of existing.items) {
        const stock = await GarmentStock.findOne({ productCode: oldItem.productCode })
        if (!stock) continue
        const variant = stock.variants.find((v) => v.itemNo === oldItem.itemNo)
        if (!variant) continue
        variant.quantity = Math.max(0, Number(variant.quantity || 0) - 1)
        syncVariantStatus(variant)
        await stock.save()
      }
      return res.status(400).json({ message: 'Stock issues:\n' + stockIssues.join('\n') })
    }

    // Decrement new items + increment soldQty
    for (const item of data.items) {
      const stock = stockDocs[item.productCode]
      const variant = stock.variants.find((v) => v.itemNo === item.itemNo)
      const qty = Number(item.qty || 1)
      variant.quantity = Math.max(0, Number(variant.quantity || 0) - qty)
      variant.soldQty = Number(variant.soldQty || 0) + qty   // ✅ NEW
      syncVariantStatus(variant)
      await stock.save()
    }

    // Update bill
    delete data._id
    delete data.billNo
    delete data.createdAt
    delete data.loyaltyPoints

    const updated = await GarmentBill.findByIdAndUpdate(
      billId,
      { $set: data },
      { returnDocument: 'after', runValidators: true }
    )

    res.json(updated)
  } catch (err) {
    console.error('❌ PUT /garment/bills error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// PATCH VARIANT STATUS (manual override)
// ============================================================
router.patch('/stock/:stockId/variant/:itemNo/status', protect, async (req, res) => {
  try {
    const { stockId, itemNo } = req.params
    const { status } = req.body

    if (!['instock', 'sold'].includes(status)) {
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
// GET /garment/reports
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
        // ✅ Use UTC-adjusted local start (India = +05:30)
        const start = new Date(`${from}T00:00:00+05:30`)
        matchStage.createdAt.$gte = start
      }
      if (to) {
        const end = new Date(`${to}T23:59:59.999+05:30`)
        matchStage.createdAt.$lte = end
      }
    }

    const summaryAgg = await GarmentBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: null,
          totalBills:   { $sum: 1 },
          totalRevenue: { $sum: '$totalAmount' },
          totalItems:   { $sum: '$totalItems' },
        },
      },
    ])

    const summary = summaryAgg[0] || {
      totalBills: 0,
      totalRevenue: 0,
      totalItems: 0,
    }

    const bills = await GarmentBill.find(matchStage).lean()

    const productCodes = [...new Set(
      bills.flatMap((b) => (b.items || []).map((it) => it.productCode))
    )]

    const stocks = await GarmentStock.find({
      productCode: { $in: productCodes },
    }).lean()

    const purchaseLookup = {}
    stocks.forEach((s) => {
      purchaseLookup[s.productCode] = {}
      ;(s.variants || []).forEach((v) => {
        purchaseLookup[s.productCode][v.itemNo] = v.purchasePrice || 0
      })
    })

    let totalProfit = 0
    const productStats = {}

    bills.forEach((bill) => {
      ;(bill.items || []).forEach((it) => {
        const purchase = purchaseLookup[it.productCode]?.[it.itemNo] || 0
        const revenue = Number(it.amount || 0)
        const profit = revenue - purchase

        totalProfit += profit

        if (!productStats[it.productCode]) {
          productStats[it.productCode] = {
            productCode: it.productCode,
            description: it.description || '',
            qty: 0,
            revenue: 0,
            profit: 0,
          }
        }
        productStats[it.productCode].qty += Number(it.qty || 1)
        productStats[it.productCode].revenue += revenue
        productStats[it.productCode].profit += profit
      })
    })

    const profitMargin = summary.totalRevenue > 0
      ? ((totalProfit / summary.totalRevenue) * 100).toFixed(1)
      : 0

    // ✅ Add ALL products with 0 qty if not sold
    const allProductCodes = await GarmentStock.find().distinct('productCode')
    allProductCodes.forEach((pc) => {
      if (!productStats[pc]) {
        productStats[pc] = {
          productCode: pc,
          description: '',
          qty: 0,
          revenue: 0,
          profit: 0,
        }
      }
    })

    const topProducts = Object.values(productStats)
      .sort((a, b) => {
        if (b.qty !== a.qty) return b.qty - a.qty
        return a.productCode.localeCompare(b.productCode)
      })

    const paymentAgg = await GarmentBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$paymentMode',
          count: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
        },
      },
    ])
    const paymentBreakdown = paymentAgg.map((p) => ({
      mode: p._id,
      count: p.count,
      totalAmount: p.totalAmount,
    }))

    const customerAgg = await GarmentBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: '$customerNo',
          customerName: { $first: '$customerName' },
          customerMobile: { $first: '$customerMobile' },
          billCount: { $sum: 1 },
          totalAmount: { $sum: '$totalAmount' },
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

    // ✅ Detect grouping type from date range
    let groupType = 'daily'      // default
    let groupFormat = '%Y-%m-%d'
    let dateLabelFn = null

    if (from && to) {
      const start = new Date(from); start.setHours(0, 0, 0, 0)
      const end = new Date(to); end.setHours(23, 59, 59, 999)
      const daysDiff = Math.ceil((end - start) / (1000 * 60 * 60 * 24))

      if (daysDiff <= 1) {
        groupType = 'hourly'
        groupFormat = '%Y-%m-%d %H:00'
      } else if (daysDiff <= 7) {
        groupType = 'daily'
        groupFormat = '%Y-%m-%d'
      } else if (daysDiff <= 60) {
        groupType = 'daily'
        groupFormat = '%Y-%m-%d'
      } else {
        groupType = 'monthly'
        groupFormat = '%Y-%m'
      }
    }

    const trendAgg = await GarmentBill.aggregate([
      { $match: matchStage },
      {
        $group: {
          _id: {
            $dateToString: {
              format: groupFormat,
              date: '$createdAt',
              timezone: 'Asia/Kolkata',   // ✅ IST buckets
            },
          },
                    count: { $sum: 1 },
          revenue: { $sum: '$totalAmount' },
        },
      },
      { $sort: { _id: 1 } },
    ])

    // ✅ Build full timeline (missing days/hours = 0)
    let dailyTrend = []

    if (groupType === 'hourly') {
      // 24-hour buckets for the selected day
      const dayStr = from || (() => {
        const d = new Date()
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      })()
      const map = {}
      trendAgg.forEach((d) => { map[d._id] = d })

      for (let h = 0; h < 24; h++) {
        const hh = String(h).padStart(2, '0')
        const key = `${dayStr} ${hh}:00`
        const found = map[key]
        dailyTrend.push({
          date: `${hh}:00`,
          count: found?.count || 0,
          revenue: found?.revenue || 0,
        })
      }
    } else if (groupType === 'daily' && from && to) {
      // Fill every date in range with 0 if no bills
      const map = {}
      trendAgg.forEach((d) => { map[d._id] = d })

      // ✅ Parse from/to as local (IST)
      const [fy, fm, fd] = from.split('-').map(Number)
      const [ty, tm, td] = to.split('-').map(Number)
      const cursor = new Date(fy, fm - 1, fd)
      const end = new Date(ty, tm - 1, td)

      while (cursor <= end) {
        const yyyy = cursor.getFullYear()
        const mm = String(cursor.getMonth() + 1).padStart(2, '0')
        const dd = String(cursor.getDate()).padStart(2, '0')
        const key = `${yyyy}-${mm}-${dd}`
        const found = map[key]
        dailyTrend.push({
          date: `${dd}/${mm}`,
          count: found?.count || 0,
          revenue: found?.revenue || 0,
        })
        cursor.setDate(cursor.getDate() + 1)
      }
    } else {
      // monthly — raw aggregate
      dailyTrend = trendAgg.map((d) => ({
        date: d._id,
        count: d.count,
        revenue: d.revenue,
      }))
    }

    res.json({
      summary: {
        ...summary,
        totalProfit,
        profitMargin,
      },
      topProducts,
      paymentBreakdown,
      topCustomers,
      dailyTrend,
    })
  } catch (err) {
    console.error('❌ GET /garment/reports error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// BILLS — DELETE (restore stock quantity)
// ============================================================
router.delete('/bills/:id', protect, async (req, res) => {
  try {
    const bill = await GarmentBill.findByIdAndDelete(req.params.id)
    if (!bill) return res.status(404).json({ message: 'Bill not found' })

    // ✅ Restore quantity + revert soldQty
    for (const item of bill.items) {
      const stock = await GarmentStock.findOne({ productCode: item.productCode })
      if (!stock) continue
      const variant = stock.variants.find((v) => v.itemNo === item.itemNo)
      if (!variant) continue
      const qty = Number(item.qty || 1)
      variant.quantity = Number(variant.quantity || 0) + qty
      variant.soldQty = Math.max(0, Number(variant.soldQty || 0) - qty)   // ✅
      syncVariantStatus(variant)
      await stock.save()
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

    // ✅ Only MD/CEO/MD_finance see purchasePrice + seller details
    // Admin + staff (normal user) — hide
    const canSeeSeller = ['md', 'md_finance', 'ceo'].includes(req.user?.role)

    const sanitized = canSeeSeller
      ? stocks
      : stocks.map((s) => {
          const obj = s.toObject()
          // ✅ Hide buying cost + seller details
          obj.variants = (obj.variants || []).map((v) => {
            const { purchasePrice, ...rest } = v
            return rest
          })
          delete obj.sellerName
          delete obj.sellerMobile
          delete obj.sellerAddress
          delete obj.sellerAddedBy
          return obj
        })

    res.json(sanitized)
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// STOCK — CREATE (manual product code, quantity, append-mode)
// ============================================================
router.post('/stock', protect, async (req, res) => {
  try {
    const data = { ...req.body }

    if (!Array.isArray(data.variants) || data.variants.length === 0) {
      return res.status(400).json({ message: 'At least one variant required' })
    }

    if (!data.productCode?.trim()) {
      return res.status(400).json({ message: 'Product Code required' })
    }

    const pc = data.productCode.trim().toUpperCase()
    data.productCode = pc

    // Check existing product
    const existing = await GarmentStock.findOne({ productCode: pc })

    if (existing) {
      // ✅ APPEND mode
      const existingItemNos = existing.variants.map((v) => v.itemNo)
      let maxNum = 0
      existingItemNos.forEach((n) => {
        const num = parseInt(n, 10)
        if (!isNaN(num) && num > maxNum) maxNum = num
      })

      const counter = await GarmentCounter.findById(`item_no_${pc}`)
      if (counter?.seq && counter.seq > maxNum) maxNum = counter.seq

      let nextNum = maxNum + 1

      for (const v of data.variants) {
        if (!v.colour?.trim()) return res.status(400).json({ message: 'Variant colour required' })
        if (!v.size?.trim())   return res.status(400).json({ message: 'Variant size required' })

          // ✅ Admin OR staff — purchasePrice optional (staff ku hide)
v.purchasePrice = Number(v.purchasePrice || 0)

        if (!v.sellingPrice || v.sellingPrice <= 0) {
          return res.status(400).json({ message: 'Variant selling price required' })
        }
// ✅ Only validate if purchasePrice > 0 (staff ku 0, so skip)
if (Number(v.purchasePrice) > 0 && Number(v.sellingPrice) < Number(v.purchasePrice)) {
  return res.status(400).json({ message: 'Selling price cannot be less than purchase price' })
}

        v.itemNo = padCode(nextNum)
        nextNum += 1
        v.description = v.description?.trim() || ''
        v.purchaseYear  = v.purchaseYear  ? Number(v.purchaseYear)  : null
        v.purchaseMonth = v.purchaseMonth ? Number(v.purchaseMonth) : null
        v.purchasePrice = Number(v.purchasePrice)
        v.sellingPrice  = Number(v.sellingPrice)
        v.quantity      = Math.max(1, Number(v.quantity || 1))
        v.soldQty       = 0   // ✅ NEW
        v.reservedQty   = 0
        v.status        = v.quantity > 0 ? 'instock' : 'sold'
      }

      existing.variants.push(...data.variants)
      if (data.description?.trim()) existing.description = data.description.trim()
      await existing.save()

      await GarmentCounter.findByIdAndUpdate(
        `item_no_${pc}`,
        { $max: { seq: nextNum - 1 } },
        { upsert: true, setDefaultsOnInsert: true }
      )

      return res.status(200).json(existing)
    }

    // ✅ New product — validate + assign itemNos
    let nextItemNum = 1
    for (const v of data.variants) {
      if (!v.colour?.trim()) return res.status(400).json({ message: 'Variant colour required' })
      if (!v.size?.trim())   return res.status(400).json({ message: 'Variant size required' })

      // ✅ Admin OR staff — purchasePrice optional (staff ku hide)
      v.purchasePrice = Number(v.purchasePrice || 0)

      if (!v.sellingPrice || v.sellingPrice <= 0) {
        return res.status(400).json({ message: 'Variant selling price required' })
      }
      // ✅ Only validate if purchasePrice > 0 (staff ku 0, so skip)
      if (Number(v.purchasePrice) > 0 && Number(v.sellingPrice) < Number(v.purchasePrice)) {
        return res.status(400).json({ message: 'Selling price cannot be less than purchase price' })
      }

      v.itemNo = padCode(nextItemNum)
      nextItemNum += 1
      v.description = v.description?.trim() || ''
      v.purchaseYear  = v.purchaseYear  ? Number(v.purchaseYear)  : null
      v.purchaseMonth = v.purchaseMonth ? Number(v.purchaseMonth) : null
      v.sellingPrice  = Number(v.sellingPrice)
      v.quantity      = Math.max(1, Number(v.quantity || 1))
      v.soldQty       = 0   // ✅ NEW
      v.reservedQty   = 0
      v.status        = v.quantity > 0 ? 'instock' : 'sold'
    }

    await GarmentCounter.findByIdAndUpdate(
      `item_no_${pc}`,
      { $max: { seq: nextItemNum - 1 } },
      { upsert: true, setDefaultsOnInsert: true }
    )

    // Seller protection — admin can also enter seller details
    const canSeeSeller = ['md', 'md_finance', 'ceo'].includes(req.user?.role)
    const isAdmin = req.user?.role === 'admin'

    if (!canSeeSeller && !isAdmin) {
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
// STOCK — UPDATE (quantity, status sync, append new variants)
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
    const isAdmin = req.user?.role === 'admin'

    if (!canSeeSeller && !isAdmin) {
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
  if (!v.itemNo?.trim()) {
    v.itemNo = padCode(nextNum)
    nextNum += 1
  } else {
    const n = parseInt(v.itemNo, 10)
    if (!isNaN(n) && n >= nextNum) nextNum = n + 1
  }
  v.description = v.description?.trim() || ''
  v.purchaseYear  = v.purchaseYear  ? Number(v.purchaseYear)  : null
  v.purchaseMonth = v.purchaseMonth ? Number(v.purchaseMonth) : null

  const existing = existingStock.variants.find(sv => sv.itemNo === v.itemNo)

  if (isAdmin) {
    v.purchasePrice = existing?.purchasePrice || 0
  } else {
    v.purchasePrice = existing?.purchasePrice ?? Number(v.purchasePrice || 0)
  }

  // ✅ Preserve soldQty from existing variant
  v.soldQty = Number(existing?.soldQty || 0)

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
// STOCK — DELETE (full product)
// ============================================================
router.delete('/stock/:id', protect, async (req, res) => {
  try {
    // ✅ Only MD/CEO/MD_finance can delete
    const canDelete = ['md', 'md_finance', 'ceo'].includes(req.user?.role)
    if (!canDelete) {
      return res.status(403).json({ message: 'Not allowed to delete stock' })
    }

    const stock = await GarmentStock.findByIdAndDelete(req.params.id)
    if (!stock) return res.status(404).json({ message: 'Stock not found' })
    res.json({ message: 'Deleted' })
  } catch (err) {
    res.status(500).json({ message: err.message })
  }
})

// ============================================================
// ✅ STOCK — DELETE SINGLE VARIANT
// ============================================================
router.delete('/stock/:id/variant/:itemNo', protect, async (req, res) => {
  try {
    // ✅ Only MD/CEO/MD_finance can delete
    const canDelete = ['md', 'md_finance', 'ceo'].includes(req.user?.role)
    if (!canDelete) {
      return res.status(403).json({ message: 'Not allowed to delete variant' })
    }

    const { id, itemNo } = req.params

    const stock = await GarmentStock.findById(id)
    if (!stock) return res.status(404).json({ message: 'Stock not found' })

    const variant = stock.variants.find((v) => v.itemNo === itemNo)
    if (!variant) return res.status(404).json({ message: 'Variant not found' })

    // ✅ If it's the last variant, delete entire stock
    if (stock.variants.length === 1) {
      await GarmentStock.findByIdAndDelete(id)
      return res.json({ message: 'Product deleted (last variant)' })
    }

    // ✅ Remove variant
    stock.variants = stock.variants.filter((v) => v.itemNo !== itemNo)
    await stock.save()

    res.json(stock)
  } catch (err) {
    console.error('❌ DELETE variant error:', err.message)
    res.status(500).json({ message: err.message })
  }
})

export default router