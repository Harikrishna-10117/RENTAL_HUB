const mongoose = require('mongoose');

const equipmentQuantitySchema = new mongoose.Schema({
  equipment: { type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true },
  quantity: { type: Number, required: true, min: 1, max: 1000, default: 1 }
}, { _id: false });

const rentalSchema = new mongoose.Schema({
  booking: { type: mongoose.Schema.Types.ObjectId, ref: 'Booking', required: true, unique: true, index: true },
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  owner: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  equipment: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Equipment', required: true }],
  equipmentQuantities: { type: [equipmentQuantitySchema], default: [] },
  startDate: { type: Date, required: true, index: true },
  endDate: { type: Date, required: true, index: true },
  rentalDays: { type: Number, required: true, min: 1 },
  pricing: {
    rentalSubtotal: { type: Number, required: true, min: 0 },
    securityDeposit: { type: Number, required: true, min: 0 },
    deliveryFee: { type: Number, default: 0, min: 0 },
    fees: { type: Number, default: 0, min: 0 },
    grandTotal: { type: Number, required: true, min: 0 },
    currency: { type: String, uppercase: true, default: 'INR' }
  },
  deliveryAddress: { type: String, trim: true, maxlength: 1000, default: '' },
  status: {
    type: String,
    enum: ['REQUESTED', 'CONFIRMED', 'PREPARING', 'IN_TRANSIT', 'ACTIVE', 'RETURN_PENDING', 'RETURNED', 'INSPECTING', 'COMPLETED', 'CANCELLED', 'DISPUTED'],
    default: 'REQUESTED',
    index: true
  },
  paymentStatus: { type: String, enum: ['PENDING', 'PROCESSING', 'PAID', 'FAILED', 'REFUNDED', 'PARTIALLY_REFUNDED'], default: 'PENDING', index: true },
  cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
  cancellationReason: { type: String, trim: true, maxlength: 1000, default: '' },
  cancelledAt: { type: Date, default: null }
}, { timestamps: true });

rentalSchema.index({ customer: 1, status: 1, startDate: 1 });
rentalSchema.index({ owner: 1, status: 1, startDate: 1 });

module.exports = mongoose.model('Rental', rentalSchema);