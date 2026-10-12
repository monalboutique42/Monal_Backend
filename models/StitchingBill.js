import mongoose from 'mongoose'

const stitchingBillSchema = new mongoose.Schema(
  {
    // Bill Info
    billNo:  { type: String, required: true, unique: true, index: true },
    unitNo:  { type: String, required: true },     // "001", "002", "003"

    // Customer
    customerName:   { type: String, required: true, trim: true },
    customerMobile: { type: String, required: true, match: /^[0-9]{10}$/ },

    // Order
    orderPhoto:  { type: String, default: null },  // Cloudinary URL
    description: { type: String, default: '' },

    // 18 Measurements
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

    // Customization (free text)
    customization: { type: String, default: '' },

    // Amount
    amount:  { type: Number, required: true },
    total:   { type: Number, required: true },
    advance: { type: Number, default: 0 },
    balance: { type: Number, default: 0 },

    // Payment
    paymentMode: { type: String, enum: ['cash', 'gpay'], default: 'cash' },

    // Delivery
    deliveryDate: { type: Date, required: true },

    // Status
    status: {
      type: String,
      enum: ['received', 'processing', 'ready', 'delivered', 'alteration'],
      default: 'received',
    },

    // Bill By
    billBy: { type: String, required: true },
  },
  { timestamps: true }
)

export default mongoose.model('StitchingBill', stitchingBillSchema)