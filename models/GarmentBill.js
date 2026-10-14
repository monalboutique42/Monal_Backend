import mongoose from 'mongoose'

// ============================================================
// 1. GARMENT BILL MODEL (Multi-item, no qty, stock status)
// ============================================================
const garmentBillItemSchema = new mongoose.Schema(
  {
    description: { type: String, default: '' },
    productCode: { type: String, required: true, trim: true },
    itemNo:      { type: String, required: true, trim: true },
    itemCode:    { type: String, required: true, trim: true }, // ProductCode + ItemNo
    size:        { type: String, default: '' },
    colour:      { type: String, default: '' },
    rate:        { type: Number, required: true, min: 0 },
    amount:      { type: Number, required: true, min: 0 },     // rate × 1 (each item = 1 piece)
  },
  { _id: false }
)

const garmentBillSchema = new mongoose.Schema(
  {
    // ============ Bill Info ============
    billNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
      // Format: YYYYMM + FIRST_ITEM_CODE + 3-digit-seq
    },

    // ============ Customer Info ============
    customerNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
      // Format: G01, G02, ..., G99, G100
    },
    customerName:   { type: String, required: true, trim: true },
    customerMobile: {
      type: String,
      required: true,
      match: /^[0-9]{10}$/,
    },
    loyaltyPoints: { type: Number, default: 0, min: 0 },

    // ============ Multi-Item Cart (each = 1 piece) ============
    items: {
      type: [garmentBillItemSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'At least one item required',
      },
    },

    // ============ Amount ============
    totalAmount: { type: Number, required: true, min: 0 },
    totalItems:  { type: Number, required: true, min: 1 },

    // ============ Payment ============
    paymentMode: {
      type: String,
      enum: ['cash', 'gpay'],
      default: 'cash',
    },
    paymentReference: {
      cashDenominations: [
        {
          denomination: { type: Number, required: true },
          count:        { type: Number, default: 0 },
        },
      ],
      gpayReference: { type: String, default: '' },
    },

    // ============ Bill By ============
    billBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

export const GarmentBill = mongoose.model('GarmentBill', garmentBillSchema)


// ============================================================
// 2. GARMENT STOCK MODEL (no quantity, has status per variant)
// ============================================================
const garmentStockVariantSchema = new mongoose.Schema(
  {
    itemNo: { type: String, required: true },       // 01, 02, ..., 99, 100
    colour: { type: String, required: true },
    size:   { type: String, required: true },
    purchasePrice: { type: Number, required: true, min: 0 },
    sellingPrice:  { type: Number, required: true, min: 0 },    status: {
      type: String,
      enum: ['instock', 'sold', 'return', 'exchange'],
      default: 'instock',
    },
  },
  { _id: false }
)

const garmentStockSchema = new mongoose.Schema(
  {
    productCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: { type: String, default: '' },

    variants: {
      type: [garmentStockVariantSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'At least one variant required',
      },
    },

    // Confidential (CEO/MD/MD_Finance fills)
    sellerName:    { type: String, default: '' },
    sellerMobile:  { type: String, default: '' },
    sellerAddress: { type: String, default: '' },

    sellerAddedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
  },
  { timestamps: true }
)

export const GarmentStock = mongoose.model('GarmentStock', garmentStockSchema)


// ============================================================
// 3. GARMENT COUNTER (for auto-increment)
// ============================================================
const garmentCounterSchema = new mongoose.Schema(
  {
    _id: { type: String, required: true }, // 'customer_no', 'product_code', 'item_no_01'
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const GarmentCounter = mongoose.model('GarmentCounter', garmentCounterSchema)