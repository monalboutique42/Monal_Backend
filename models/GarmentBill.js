import mongoose from 'mongoose'

// ============================================================
// 1. GARMENT BILL MODEL
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
    qty:         { type: Number, required: true, min: 1, default: 1 }, // ✅ NEW
    amount:      { type: Number, required: true, min: 0 },             // rate × qty
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
    },

    // ============ Customer Info ============
    customerNo: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    customerName:   { type: String, required: true, trim: true },
    customerMobile: {
      type: String,
      required: true,
      match: /^[0-9]{10}$/,
    },
    loyaltyPoints: { type: Number, default: 0, min: 0 },

    // ============ Multi-Item Cart ============
    items: {
      type: [garmentBillItemSchema],
      validate: {
        validator: (arr) => arr.length > 0,
        message: 'At least one item required',
      },
    },

    // ============ Amount ============
    subTotal:        { type: Number, default: 0, min: 0 },
    shippingAmount:  { type: Number, default: 0, min: 0 },
    discountAmount:  { type: Number, default: 0, min: 0 },
    totalAmount:     { type: Number, required: true, min: 0 },
    totalItems:      { type: Number, required: true, min: 1 },
    totalQty:        { type: Number, default: 0, min: 0 },   // ✅ NEW — sum of item.qty

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
// 2. GARMENT STOCK MODEL
// ============================================================
const garmentStockVariantSchema = new mongoose.Schema(
  {
    itemNo: { type: String, required: true },       // 01, 02, ..., 99, 100

    colour: { type: String, required: true },
    size:   { type: String, required: true },

    description: { type: String, default: '' },

    purchaseYear:  { type: Number, default: null, min: 2000, max: 2100 },
    purchaseMonth: { type: Number, default: null, min: 1, max: 12 },

    purchasePrice: { type: Number, required: true, min: 0 },
    sellingPrice:  { type: Number, required: true, min: 0 },

    // ✅ Current quantity in stock
    //   - stock add: initial quantity
    //   - bill save: decrement by qty
    //   - bill delete: increment by qty
    quantity: { type: Number, default: 1, min: 0 },

    // ✅ Total sold count
    //   - bill save: increment by qty
    //   - bill edit/delete: decrement by qty
    soldQty: { type: Number, default: 0, min: 0 },

    // ✅ Reserved count (if cart-reserve system used)
    //   - set to 0 if reserve system not used
    reservedQty: { type: Number, default: 0, min: 0 },

    // ✅ Status — auto-managed by quantity
    status: {
      type: String,
      enum: ['instock', 'sold'],
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

    // Confidential (CEO/MD/MD_Finance only)
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
    _id: { type: String, required: true }, // 'item_no_<productCode>'
    seq: { type: Number, default: 0 },
  },
  { timestamps: true }
)

export const GarmentCounter = mongoose.model('GarmentCounter', garmentCounterSchema)