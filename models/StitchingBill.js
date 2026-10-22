import mongoose from 'mongoose'

const stitchingBillSchema = new mongoose.Schema(
  {
    // ============ Bill Info ============
    billNo:  { type: String, required: true, unique: true, index: true },
    unitNo:  { type: String, required: true, index: true },

    // ============ Customer Info ============
    customerNo:     { type: String, required: true, index: true },   // ✅ NEW — 101, 199, 1100
    customerName:   { type: String, required: true, trim: true },
    customerMobile: { type: String, required: true, match: /^[0-9]{10}$/ },

    // ============ Discount & Shipping ============
    discountPercent: { type: Number, default: 0 },
    discountAmount:  { type: Number, default: 0 },
    shippingAmount:  { type: Number, default: 0 },

    // ============ Order ============
    orderPhoto:   { type: String, default: null },     // Cloudinary URL
    orderPhotoId: { type: String, default: null },     // ✅ NEW — Cloudinary public_id

    referencePhoto:   { type: String, default: null }, // ✅ NEW — optional
    referencePhotoId: { type: String, default: null }, // ✅ NEW

    description: { type: String, default: '' },

    // ============ 18 Measurements ============
    measurements: {
      fullLength:     { type: Number, default: 0 },
      shoulder:       { type: Number, default: 0 },
      armHole:        { type: Number, default: 0 },
      middleArm:      { type: Number, default: 0 },
      upperChest:     { type: Number, default: 0 },
      chestRound:     { type: Number, default: 0 },
      apexPoint:      { type: Number, default: 0 },
      waistLength:    { type: Number, default: 0 },
      waistRound:     { type: Number, default: 0 },
      yokeLength:     { type: Number, default: 0 },
      hipLength:      { type: Number, default: 0 },
      hipRound:       { type: Number, default: 0 },
      sleeveLength:   { type: Number, default: 0 },
      sleeveRound:    { type: Number, default: 0 },
      frontNeck:      { type: Number, default: 0 },
      backNeck:       { type: Number, default: 0 },
      legLoose:       { type: Number, default: 0 },
      pantFullLength: { type: Number, default: 0 },
    },

    customization: { type: String, default: '' },

    // ============ Amount ============
    amount:  { type: Number, required: true },
    total:   { type: Number, required: true },
    advance: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },

    // ============ Payment ============
    paymentMode: { type: String, enum: ['cash', 'gpay'], default: 'cash' },

    // ✅ NEW — Payment reference
    paymentReference: {
      cashDenominations: [
        {
          denomination: { type: Number },   // 500, 200, 100, 50, 20, 10
          count:        { type: Number, default: 0 },
        },
      ],
      gpayReference: { type: String, default: '' },
    },

        // ✅ NEW — Payment history (advance + due clearing entries)
    paymentHistory: [
      {
        amountPaid: { type: Number, required: true, min: 0 },
        paymentDate: { type: String, required: true },   // YYYY-MM-DD

        paymentMode: { type: String, enum: ['cash', 'gpay'], default: 'cash' },

        paymentReference: {
          cashDenominations: [
            {
              denomination: { type: Number },
              count:        { type: Number, default: 0 },
            },
          ],
          gpayReference: { type: String, default: '' },
        },

        billBy: { type: String, default: '' },
        recordedAt: { type: Date, default: Date.now },

        // ✅ NEW — number of times this same-day entry was edited
        editCount: { type: Number, default: 1, min: 1 },
      },
    ],

    // ============ Delivery ============
    deliveryDate: { type: Date, required: true },

    // ============ Status ============
    status: {
      type: String,
      enum: ['received', 'processing', 'ready', 'delivered', 'alteration'],
      default: 'received',
    },

    // ============ Bill By (free text) ============
    billBy: { type: String, required: true, trim: true },
  },
  { timestamps: true }
)

export default mongoose.model('StitchingBill', stitchingBillSchema)