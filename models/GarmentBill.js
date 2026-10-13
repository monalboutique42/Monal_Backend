import mongoose from 'mongoose'

// ============================================================
// 1. GARMENT BILL MODEL
// ============================================================
const garmentBillSchema = new mongoose.Schema(
  {
    // ============ Bill Info ============
    billNo: {
      type: String,
      required: true,
      unique: true,
      index: true,
      // Format: YYYYMM + PRODUCT_CODE + ITEM_NO + BILL_SEQ
      // Example: 2026100105001
    },

    // ============ Product Info ============
    productCode: { type: String, required: true, trim: true },   // "01", "100"
    itemNo:      { type: String, required: true, trim: true },   // "05", "10"

    // ============ Customer Info ============
    customerName:   { type: String, required: true, trim: true },
    customerNumber: { type: String, trim: true },
    customerMobile: {
      type: String,
      required: true,
      match: /^[0-9]{10}$/,
    },

    // ============ Product Details ============
    description: { type: String, default: '' },
    productRate: { type: Number, required: true, min: 0 },
    noOfItems:   { type: Number, required: true, min: 1, default: 1 },
    size:        { type: String, default: '' },
    colour:      { type: String, default: '' },

    // ============ Amount ============
    amount: { type: Number, required: true, min: 0 },

    // ============ Payment ============
    paymentMode: {
      type: String,
      enum: ['cash', 'gpay'],
      default: 'cash',
    },

    // ============ Bill By ============
    billBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

export const GarmentBill = mongoose.model('GarmentBill', garmentBillSchema)


// ============================================================
// 2. GARMENT STOCK MODEL
// ============================================================
const garmentStockSchema = new mongoose.Schema(
  {
    // ============ Basic (Admin fills) ============
    productCode: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    description: { type: String, default: '' },

    // Variants — multiple colours + sizes
    variants: [
      {
        colour:   { type: String, required: true },
        size:     { type: String, required: true },
        price:    { type: Number, required: true, min: 0 },
        quantity: { type: Number, default: 0, min: 0 },
      },
    ],

    // ============ Confidential (CEO/MD fills) ============
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